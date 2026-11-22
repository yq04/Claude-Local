# [INPUT]: CLI relay switches (-AutoContinue override, -MaxRelays, -ThresholdPct, -Strategy, -ContinuationPrompt, -HandoffMode clean_handoff|fork_resume, -Status), optional ClaudeArgs, local HTTP proxy config (~/.claude/settings(.local).json prioritized ahead of shell env), %APPDATA%\ai.local.claude-local\quota_ledger.json change stamp, and claude-local.exe --orchestrate JSON status/relay_switch state (including defaultCliModel / defaultCliEffort, relayHandoffMode, relay_trigger_kind, handoff_reason and handoff_md_path).
# [OUTPUT]: Interactive TTY or print Claude Code execution with value/variadic-safe persistent-flag preservation, persistent default --model / --effort injection, telemetry/credential/CLAUDE_CONFIG_DIR env scrubbing, explicit HTTP proxy + NO_PROXY injection with retryable preflight, humanized 429/exit breather plus 6-15s anti-ban cross-account breather, ephemeral StopFailure/Stop/PostToolUse hooks (Python WindowsApps stub rejection -> ps1 fallback, Stop-prose rate-limit guard, 2-stage proactive threshold wrap-up & forced_stop safety net respecting external workers + internal bg subagents up to 300s unless spent >= hard_cap_pct), live transcript 429/auto-wait polling (ignoring api-request-blob/metadata and non-error assistant prose), external worker deferral, Ctrl+C rescue, TUI raw-mode-gated phased CONIN$ WriteConsoleInputW (MapVirtualKeyW scan codes, sleep exit checks, cooked-mode pause, Esc x1-2, Ctrl+E/U, /exit, conditional Option '2' with 4s migration grace), daemon stop before breather, relay_switch retries (forwarding external_worker_timeout / forced_stop handoff_reason), synthetic-error-filtered continued-in validation, parent-first source selection for cross-account clean_handoff/fork_resume (1200-char final progress digest + 64-hex redaction), single-shot rapid-exit self-healing fallback with diagnostics, disk script drift warning, and --resume continuation strictly on the same account.
# [POS]: Independent CLI relay wrapper installed to ~/.local/bin/claude-relay.ps1; never kills unrelated live claude.exe or edits ~/.claude/settings.json.
# [PROTOCOL]: Update this header and scripts/CLAUDE.md when changing relay parameters or orchestrator schema.
$ErrorActionPreference = 'Stop'
$AutoContinue = $false
$AutoContinueSpecified = $false
$MaxRelays = 10
$ThresholdPct = 0
$Strategy = ''
$ContinuationPrompt = ''
$HandoffMode = ''
$Status = $false
$parsedClaudeArgs = New-Object System.Collections.Generic.List[string]
for ($argIdx = 0; $argIdx -lt $args.Count; $argIdx++) {
    $rawTok = [string]$args[$argIdx]
    if ($rawTok -eq '--') {
        for ($restIdx = $argIdx; $restIdx -lt $args.Count; $restIdx++) {
            [void]$parsedClaudeArgs.Add([string]$args[$restIdx])
        }
        break
    }
    if ($rawTok -match '^(?i)-AutoContinue(?:[:=](\$?true|\$?false|1|0))?$') {
        $acVal = $Matches[1]
        if ($acVal) {
            $AutoContinue = (-not ($acVal -match '^(?i)\$?false|0$'))
        } elseif (($argIdx + 1 -lt $args.Count) -and ([string]$args[$argIdx + 1] -match '^(?i)(\$?true|\$?false|1|0)$')) {
            $argIdx++
            $AutoContinue = (-not ([string]$args[$argIdx] -match '^(?i)\$?false|0$'))
        } else {
            $AutoContinue = $true
        }
        $AutoContinueSpecified = $true
        continue
    }
    if ($rawTok -match '^(?i)-Status(?:[:=](\$?true|\$?false|1|0))?$') {
        $stVal = $Matches[1]
        if ($stVal) {
            $Status = (-not ($stVal -match '^(?i)\$?false|0$'))
        } elseif (($argIdx + 1 -lt $args.Count) -and ([string]$args[$argIdx + 1] -match '^(?i)(\$?true|\$?false|1|0)$')) {
            $argIdx++
            $Status = (-not ([string]$args[$argIdx] -match '^(?i)\$?false|0$'))
        } else {
            $Status = $true
        }
        continue
    }
    if ($rawTok -match '^(?i)-MaxRelays(?:=(.+))?$') {
        $valStr = if ($Matches[1]) { $Matches[1] } elseif ($argIdx + 1 -lt $args.Count) { $argIdx++; [string]$args[$argIdx] } else { '' }
        $parsedInt = 0
        if (-not [int]::TryParse($valStr, [ref]$parsedInt)) {
            throw ("[Claude-Local Relay] Invalid -MaxRelays value: '{0}'" -f $valStr)
        }
        $MaxRelays = $parsedInt
        continue
    }
    if ($rawTok -match '^(?i)-ThresholdPct(?:=(.+))?$') {
        $valStr = if ($Matches[1]) { $Matches[1] } elseif ($argIdx + 1 -lt $args.Count) { $argIdx++; [string]$args[$argIdx] } else { '' }
        $parsedInt = 0
        if (-not [int]::TryParse($valStr, [ref]$parsedInt)) {
            throw ("[Claude-Local Relay] Invalid -ThresholdPct value: '{0}'" -f $valStr)
        }
        $ThresholdPct = $parsedInt
        continue
    }
    if ($rawTok -match '^(?i)-Strategy(?:=(.+))?$') {
        $Strategy = if ($Matches[1]) { [string]$Matches[1] } elseif ($argIdx + 1 -lt $args.Count) { $argIdx++; [string]$args[$argIdx] } else { '' }
        continue
    }
    if ($rawTok -match '^(?i)-ContinuationPrompt(?:=(.+))?$') {
        $ContinuationPrompt = if ($Matches[1]) { [string]$Matches[1] } elseif ($argIdx + 1 -lt $args.Count) { $argIdx++; [string]$args[$argIdx] } else { '' }
        continue
    }
    if ($rawTok -match '^(?i)-HandoffMode(?:[:=](.+))?$') {
        $HandoffMode = if ($Matches[1]) { [string]$Matches[1] } elseif ($argIdx + 1 -lt $args.Count) { $argIdx++; [string]$args[$argIdx] } else { '' }
        $HandoffMode = $HandoffMode.Trim().ToLowerInvariant()
        if (@('clean_handoff', 'fork_resume') -notcontains $HandoffMode) {
            throw ("[Claude-Local Relay] Invalid -HandoffMode value: '{0}' (expected clean_handoff or fork_resume)" -f $HandoffMode)
        }
        continue
    }
    [void]$parsedClaudeArgs.Add($rawTok)
}
$ClaudeArgs = [string[]]$parsedClaudeArgs.ToArray()
try {
    $utf8NoBomConsole = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8NoBomConsole
    [Console]::InputEncoding = $utf8NoBomConsole
    $OutputEncoding = $utf8NoBomConsole
} catch {
}

$DefaultContinuationPrompt = "Continue the unfinished part of the user's latest task from this saved history. Keep completed work and recorded tool results. Check existing files before deciding what remains. Do not repeat completed commands or external actions."

function Get-SafeProp {
    param(
        $Obj,
        [string[]]$Names,
        $Default = $null
    )
    if ($null -eq $Obj) { return $Default }
    foreach ($n in $Names) {
        if ($Obj -is [System.Collections.IDictionary]) {
            if ($Obj.Contains($n) -and $null -ne $Obj[$n]) {
                return $Obj[$n]
            }
        } else {
            $prop = $Obj.PSObject.Properties[$n]
            if ($null -ne $prop -and $null -ne $prop.Value) {
                return $prop.Value
            }
        }
    }
    return $Default
}

function Get-UserHomeDir {
    if ($env:USERPROFILE) { return $env:USERPROFILE }
    if ($HOME) { return $HOME }
    return [Environment]::GetFolderPath('UserProfile')
}

function Resolve-ClaudeLocalExe {
    if ($env:CLAUDE_LOCAL_EXE) {
        if (Test-Path -LiteralPath $env:CLAUDE_LOCAL_EXE -PathType Leaf) {
            return [IO.Path]::GetFullPath($env:CLAUDE_LOCAL_EXE)
        }
        throw ("CLAUDE_LOCAL_EXE does not exist: " + $env:CLAUDE_LOCAL_EXE)
    }
    $localApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
    $candidate = Join-Path $localApp 'Programs\Claude-Local\claude-local.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return [IO.Path]::GetFullPath($candidate)
    }
    throw ("claude-local.exe not found at " + $candidate + ". Set CLAUDE_LOCAL_EXE or install Claude-Local.")
}

function Resolve-ClaudeExe {
    if ($env:CLAUDE_EXE -and (Test-Path -LiteralPath $env:CLAUDE_EXE -PathType Leaf)) {
        return [IO.Path]::GetFullPath($env:CLAUDE_EXE)
    }
    $userHome = Get-UserHomeDir
    $native = Join-Path $userHome '.local\bin\claude.exe'
    if (Test-Path -LiteralPath $native -PathType Leaf) {
        return [IO.Path]::GetFullPath($native)
    }
    $cmd = Get-Command 'claude' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }
    $cmdAny = Get-Command 'claude' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmdAny -and $cmdAny.Source) {
        return $cmdAny.Source
    }
    throw ("claude.exe not found at " + $native + " or on PATH.")
}

function Format-WinCmdArg {
    param([string]$Arg)
    if ($null -eq $Arg -or $Arg.Length -eq 0) { return '""' }
    if ($Arg -notmatch '[\s"]') { return $Arg }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    $backslashes = 0
    for ($i = 0; $i -lt $Arg.Length; $i++) {
        $ch = $Arg[$i]
        if ($ch -eq '\') {
            $backslashes++
        } elseif ($ch -eq '"') {
            if ($backslashes -gt 0) { [void]$sb.Append(('\' * ($backslashes * 2))) }
            $backslashes = 0
            [void]$sb.Append('\"')
        } else {
            if ($backslashes -gt 0) { [void]$sb.Append(('\' * $backslashes)) }
            $backslashes = 0
            [void]$sb.Append($ch)
        }
    }
    if ($backslashes -gt 0) { [void]$sb.Append(('\' * ($backslashes * 2))) }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Format-HookPathArg {
    param([string]$Arg)
    if ($null -eq $Arg -or $Arg.Length -eq 0) { return '""' }
    $posix = $Arg -replace '\\', '/'
    $escaped = $posix.Replace('"', '\"')
    return '"' + $escaped + '"'
}

function Format-WinCmdLine {
    param([string[]]$ArgList)
    if ($null -eq $ArgList -or $ArgList.Count -eq 0) { return '' }
    $encoded = New-Object System.Collections.Generic.List[string]
    foreach ($item in $ArgList) {
        [void]$encoded.Add((Format-WinCmdArg $item))
    }
    return ($encoded -join ' ')
}

function Invoke-Orchestrate {
    param(
        [string]$ClaudeLocalExe,
        [hashtable]$Payload
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $jsonBody = ($Payload | ConvertTo-Json -Depth 10 -Compress)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($ClaudeLocalExe -match '\.(cmd|bat)$') {
        $psi.FileName = if ($env:ComSpec) { $env:ComSpec } else { 'cmd.exe' }
        $psi.Arguments = '/d /s /c "' + (Format-WinCmdArg $ClaudeLocalExe) + ' --orchestrate"'
    } elseif ($ClaudeLocalExe -match '\.ps1$') {
        $psHost = (Get-Process -Id $PID).Path
        $psi.FileName = if ($psHost) { $psHost } else { 'powershell.exe' }
        $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File ' + (Format-WinCmdArg $ClaudeLocalExe) + ' --orchestrate'
    } else {
        $psi.FileName = $ClaudeLocalExe
        $psi.Arguments = '--orchestrate'
    }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = $utf8NoBom
    $psi.StandardErrorEncoding = $utf8NoBom

    $proc = [System.Diagnostics.Process]::Start($psi)
    if ($null -eq $proc) {
        throw ("Failed to start orchestrator: " + $ClaudeLocalExe)
    }
    $procExitCode = 0
    try {
        $sw = New-Object System.IO.StreamWriter($proc.StandardInput.BaseStream, $utf8NoBom)
        $sw.Write($jsonBody)
        $sw.Flush()
        $sw.Close()

        $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
        $stderrTask = $proc.StandardError.ReadToEndAsync()
        if (-not $proc.WaitForExit(60000)) {
            try { $proc.Kill() } catch {}
            throw 'claude-local.exe --orchestrate timed out after 60s.'
        }
        $stdoutText = $stdoutTask.GetAwaiter().GetResult()
        $stderrText = $stderrTask.GetAwaiter().GetResult()
        $procExitCode = [int]$proc.ExitCode
    } finally {
        $proc.Dispose()
    }

    $trimmed = if ($stdoutText) { $stdoutText.Trim() } else { '' }
    if ($trimmed) {
        try {
            return ($trimmed | ConvertFrom-Json)
        } catch {
            if ($procExitCode -ne 0) {
                throw ("claude-local.exe --orchestrate failed (exit " + $procExitCode + "): " + $stderrText)
            }
            throw ("claude-local.exe --orchestrate returned invalid JSON: " + $trimmed)
        }
    }
    throw ("claude-local.exe --orchestrate returned empty output (exit " + $procExitCode + "): " + $stderrText)
}

function Get-SettingsProxyRaw {
    param([string]$SettingsPath)
    if (-not $SettingsPath -or -not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
        return ''
    }
    $rawText = ''
    try {
        $rawText = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 -ErrorAction Stop
    } catch {
        return ''
    }
    if (-not $rawText -or -not $rawText.Trim()) { return '' }
    $proxyKeys = @('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy')

    # PowerShell 7+ System.Text.Json handles case-variant keys (e.g. HTTPS_PROXY + https_proxy) without collision.
    $jsonDocType = 'System.Text.Json.JsonDocument' -as [type]
    if ($null -ne $jsonDocType) {
        $doc = $null
        try {
            $doc = $jsonDocType::Parse($rawText)
            $root = $doc.RootElement
            if ($root.ValueKind.ToString() -eq 'Object') {
                foreach ($prop in $root.EnumerateObject()) {
                    if ($prop.Name -eq 'env' -and $prop.Value.ValueKind.ToString() -eq 'Object') {
                        $envMap = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::Ordinal)
                        foreach ($ep in $prop.Value.EnumerateObject()) {
                            if ($ep.Value.ValueKind.ToString() -eq 'String') {
                                $envMap[$ep.Name] = $ep.Value.GetString()
                            }
                        }
                        foreach ($pk in $proxyKeys) {
                            if ($envMap.ContainsKey($pk)) {
                                $v = [string]$envMap[$pk]
                                if ($v -and $v.Trim()) { return $v.Trim() }
                            }
                        }
                    }
                }
            }
        } catch {
        } finally {
            if ($null -ne $doc) { $doc.Dispose() }
        }
    }

    # Windows PowerShell 5.1 fallback: ConvertFrom-Json first; if duplicate case-variant keys throw, extract from "env" block.
    try {
        $obj = $rawText | ConvertFrom-Json -ErrorAction Stop
        $envObj = Get-SafeProp $obj @('env') $null
        if ($null -ne $envObj) {
            $val = [string](Get-SafeProp $envObj $proxyKeys '')
            if ($val -and $val.Trim()) { return $val.Trim() }
        }
    } catch {
        try {
            $envMatch = [regex]::Match($rawText, '"env"\s*:\s*\{(?<body>[^{}]*)\}', [System.Text.RegularExpressions.RegexOptions]::Singleline)
            $searchScope = if ($envMatch.Success) { $envMatch.Groups['body'].Value } else { $rawText }
            foreach ($pk in $proxyKeys) {
                $pat = '"' + [regex]::Escape($pk) + '"\s*:\s*"(?<val>(?:\\.|[^"\\])*)"'
                $m = [regex]::Match($searchScope, $pat)
                if ($m.Success) {
                    $unescaped = [regex]::Unescape($m.Groups['val'].Value)
                    if ($unescaped -and $unescaped.Trim()) { return $unescaped.Trim() }
                }
            }
        } catch {
        }
    }
    return ''
}

function Get-SmartRelaySlotProxyRaw {
    param(
        [string]$AppDataDir,
        [string]$ActiveRecordId
    )
    if (-not $AppDataDir -or -not $ActiveRecordId) { return '' }
    $cleanId = $ActiveRecordId.Trim()
    if ($cleanId -notmatch '^[0-9a-f]{32}$') { return '' }
    $cfgPath = Join-Path $AppDataDir 'smart_relay_v1.json'
    if (-not (Test-Path -LiteralPath $cfgPath -PathType Leaf)) { return '' }
    try {
        $item = Get-Item -LiteralPath $cfgPath -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return '' }
        if ($item.Length -le 0 -or $item.Length -gt 131072) { return '' }
        $cfgObj = (Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8) | ConvertFrom-Json
        $spObj = Get-SafeProp $cfgObj @('slotProxies', 'slot_proxies') $null
        if ($null -ne $spObj) {
            $pVal = [string](Get-SafeProp $spObj @($cleanId) '')
            if ($pVal -and $pVal.Trim()) { return $pVal.Trim() }
        }
    } catch {
    }
    return ''
}

function Resolve-RelayProxyEndpoint {
    param(
        [string]$ClaudeDir,
        [string]$AppDataDir = '',
        [string]$ActiveRecordId = ''
    )
    $fromSlot = Get-SmartRelaySlotProxyRaw -AppDataDir $AppDataDir -ActiveRecordId $ActiveRecordId
    if ($fromSlot) { return $fromSlot }
    $fromLocal = Get-SettingsProxyRaw (Join-Path $ClaudeDir 'settings.local.json')
    if ($fromLocal) { return $fromLocal }
    $fromMain = Get-SettingsProxyRaw (Join-Path $ClaudeDir 'settings.json')
    if ($fromMain) { return $fromMain }
    foreach ($envVal in @($env:HTTPS_PROXY, $env:HTTP_PROXY, $env:ALL_PROXY, $env:https_proxy, $env:http_proxy, $env:all_proxy)) {
        if ($envVal -and $envVal.Trim()) { return $envVal.Trim() }
    }
    return ''
}

function Clear-StaleRelayTempDirs {
    try {
        $tmpRoot = [IO.Path]::GetTempPath()
        if (-not $tmpRoot -or -not (Test-Path -LiteralPath $tmpRoot -PathType Container)) { return }
        $cutoffUtc = [DateTime]::UtcNow.AddHours(-24)
        $dirs = @(Get-ChildItem -LiteralPath $tmpRoot -Directory -Filter 'cl-relay-*' -ErrorAction SilentlyContinue)
        foreach ($d in $dirs) {
            try {
                if ((($d.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) -and ($d.LastWriteTimeUtc -lt $cutoffUtc)) {
                    Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
                }
            } catch {}
        }
    } catch {}
}

function Merge-RelayArgsBeforeDoubleDash {
    param(
        [AllowNull()][AllowEmptyCollection()][string[]]$PrimaryArgs = @(),
        [AllowNull()][AllowEmptyCollection()][string[]]$ExtraFlags = @()
    )
    $out = New-Object System.Collections.Generic.List[string]
    $pList = New-Object System.Collections.Generic.List[string]
    if ($null -ne $PrimaryArgs) {
        foreach ($item in $PrimaryArgs) { [void]$pList.Add([string]$item) }
    }
    $eList = New-Object System.Collections.Generic.List[string]
    if ($null -ne $ExtraFlags) {
        foreach ($item in $ExtraFlags) { [void]$eList.Add([string]$item) }
    }
    $ddIdx = -1
    for ($k = 0; $k -lt $pList.Count; $k++) {
        if ($pList[$k] -eq '--') { $ddIdx = $k; break }
    }
    if ($ddIdx -ge 0) {
        for ($k = 0; $k -lt $ddIdx; $k++) { [void]$out.Add($pList[$k]) }
        foreach ($ex in $eList) { [void]$out.Add($ex) }
        for ($k = $ddIdx; $k -lt $pList.Count; $k++) { [void]$out.Add($pList[$k]) }
    } else {
        foreach ($p in $pList) { [void]$out.Add($p) }
        foreach ($ex in $eList) { [void]$out.Add($ex) }
    }
    return [string[]]$out.ToArray()
}

function Normalize-HttpProxyUri {
    param([string]$ProxyRaw)
    if (-not $ProxyRaw -or -not $ProxyRaw.Trim()) { return '' }
    $candidate = $ProxyRaw.Trim()
    if ($candidate -notmatch '^[a-zA-Z][a-zA-Z0-9+\-.]*://') {
        $candidate = 'http://' + $candidate
    }
    return $candidate
}

function Assert-LocalProxyReachable {
    param([string]$ProxyRaw)
    if ($env:CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT -eq '1') { return }
    if (-not $ProxyRaw -or -not $ProxyRaw.Trim()) {
        if ($env:CLAUDE_LOCAL_ALLOW_DIRECT -eq '1') { return }
        throw '[Claude-Local Relay] Explicit HTTP proxy required in ~/.claude/settings(.local).json (e.g. http://127.0.0.1:7899) to prevent direct IP leak. Set CLAUDE_LOCAL_ALLOW_DIRECT=1 to allow direct/TUN mode or CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT=1 in offline tests.'
    }
    $candidate = Normalize-HttpProxyUri $ProxyRaw
    $uri = $null
    if (-not [System.Uri]::TryCreate($candidate, [System.UriKind]::Absolute, [ref]$uri)) {
        throw ("[Claude-Local Relay] Invalid proxy URI '{0}' (expected http://host:port)." -f $ProxyRaw)
    }
    $scheme = $uri.Scheme.ToLowerInvariant()
    if ($scheme -notin @('http', 'https')) {
        throw ("[Claude-Local Relay] Unsupported proxy scheme '{0}://' in '{1}' (expected http://host:port)." -f $scheme, $ProxyRaw)
    }
    $hostName = $uri.DnsSafeHost.ToLowerInvariant()
    $port = $uri.Port
    if (-not $hostName -or $port -le 0 -or $port -gt 65535) {
        throw ("[Claude-Local Relay] Invalid proxy host or port in '{0}' (expected http://host:port)." -f $ProxyRaw)
    }
    $waitMs = if ($hostName -in @('127.0.0.1', 'localhost', '::1')) { 220 } else { 300 }

    $lastErr = $null
    for ($try = 0; $try -le 2; $try++) {
        $tcp = New-Object System.Net.Sockets.TcpClient
        try {
            $iar = $tcp.BeginConnect($hostName, $port, $null, $null)
            if (-not $iar.AsyncWaitHandle.WaitOne($waitMs, $false)) {
                throw ("timeout")
            }
            $tcp.EndConnect($iar)
            return
        } catch {
            $lastErr = $_
            if ($try -lt 2) {
                Start-Sleep -Milliseconds 200
            }
        } finally {
            try { $tcp.Close() } catch {}
        }
    }
    throw ("[Claude-Local Relay] Local proxy unreachable at {0}:{1} (fail-closed <250ms preflight). Start your local proxy listener or set CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT=1." -f $hostName, $port)
}

function Get-HumanizedRelayDelayMs {
    param([bool]$IsRateLimited)
    if ($env:CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT -eq '1') {
        return 50
    }
    if ($IsRateLimited) {
        return (Get-Random -Minimum 2500 -Maximum 4801)
    }
    return (Get-Random -Minimum 1200 -Maximum 2401)
}

function Format-CompactEta {
    param($SecondsRaw)
    if ($null -eq $SecondsRaw) { return 'unknown' }
    $sec = [int][Math]::Max(0, [double]$SecondsRaw)
    if ($sec -ge 86400) {
        $d = [Math]::Floor($sec / 86400)
        $h = [Math]::Floor(($sec % 86400) / 3600)
        return ("{0}d {1}h" -f $d, $h)
    }
    if ($sec -ge 3600) {
        $h = [Math]::Floor($sec / 3600)
        $m = [Math]::Floor(($sec % 3600) / 60)
        return ("{0}h {1}m" -f $h, $m)
    }
    $mOnly = [Math]::Max(1, [Math]::Ceiling($sec / 60.0))
    return ("{0}m" -f $mOnly)
}

function Format-ResetTimestamp {
    param($ResetTs)
    if ($null -eq $ResetTs) { return '' }
    $ts = [int64]$ResetTs
    if ($ts -le 0) { return '' }
    $dt = [DateTimeOffset]::FromUnixTimeSeconds($ts).ToLocalTime()
    return $dt.ToString('MM-dd HH:mm')
}

function Show-AwaitingResetReminders {
    param($Resp)
    $list = Get-SafeProp $Resp @('awaiting_reset_accounts', 'awaitingResetAccounts') $null
    if ($null -eq $list) { return }
    $items = @($list)
    if ($items.Count -eq 0) { return }
    foreach ($item in $items) {
        $n = Get-SafeProp $item @('name', 'display_name', 'id') 'unknown'
        $cnt = Get-SafeProp $item @('manual_resets_remaining', 'manualResetsRemaining') 0
        $u7 = Get-SafeProp $item @('quota_7d_used', 'used_7d', 'used7d') 0
        Write-Host ("[Claude-Local Relay] Reset Card ready: {0} has {1} reset card(s) at {2}% 7d usage -- pop on claude.ai/settings/usage." -f $n, $cnt, $u7)
    }
}

function Show-RelayExhaustion {
    param($SwitchResp, $StatusResp)
    $errCode = Get-SafeProp $SwitchResp @('error', 'reason') $null
    if ($errCode -and (-not [bool](Get-SafeProp $SwitchResp @('ok') $true))) {
        Write-Host ("[Claude-Local Relay] Relay switch unavailable: {0}" -f $errCode)
    } else {
        Write-Host '[Claude-Local Relay] No healthy relay candidate available (all included accounts exhausted or unavailable).'
    }
    $soonestTs = Get-SafeProp $SwitchResp @('soonest_reset_ts') $null
    $soonestEta = Get-SafeProp $SwitchResp @('soonest_reset_eta_sec', 'soonestResetSec') $null
    $soonestName = Get-SafeProp $SwitchResp @('soonest_reset_name', 'soonest_reset_account') $null
    $pool = if ($null -ne $StatusResp) { Get-SafeProp $StatusResp @('pool', 'pool_summary') $null } else { $null }
    if ($null -eq $soonestTs -and $null -ne $StatusResp) {
        $soonestTs = Get-SafeProp $StatusResp @('soonest_reset_ts') (Get-SafeProp $pool @('soonest_reset_ts') $null)
    }
    if ($null -eq $soonestEta -and $null -ne $StatusResp) {
        $soonestEta = Get-SafeProp $pool @('soonestResetSec', 'soonest_reset_eta_sec') (Get-SafeProp $StatusResp @('soonest_reset_eta_sec') $null)
    }
    $nowSec = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($null -ne $soonestTs -and [int64]$soonestTs -gt 0) {
        $eta = if ($null -ne $soonestEta) { [int64]$soonestEta } else { [Math]::Max(0, [int64]$soonestTs - $nowSec) }
        $who = if ($soonestName) { " (" + $soonestName + ")" } else { '' }
        Write-Host ("[Claude-Local Relay] Soonest reset{0}: {1} (in {2})" -f $who, (Format-ResetTimestamp $soonestTs), (Format-CompactEta $eta))
    } elseif ($null -ne $soonestEta -and [int64]$soonestEta -gt 0) {
        $eta = [int64]$soonestEta
        $derivedTs = $nowSec + $eta
        $who = if ($soonestName) { " (" + $soonestName + ")" } else { '' }
        Write-Host ("[Claude-Local Relay] Soonest reset{0}: {1} (in {2})" -f $who, (Format-ResetTimestamp $derivedTs), (Format-CompactEta $eta))
    }

    $resetSources = @()
    $fromSwitch = Get-SafeProp $SwitchResp @('reset_card_accounts', 'awaiting_reset_accounts') $null
    if ($null -ne $fromSwitch) {
        $resetSources = @($fromSwitch)
    } elseif ($null -ne $StatusResp) {
        $accts = Get-SafeProp $StatusResp @('accounts') $null
        if ($null -ne $accts) {
            $resetSources = @($accts | Where-Object {
                [int](Get-SafeProp $_ @('manual_resets_remaining', 'manualResetsRemaining') 0) -gt 0
            })
        }
    }
    foreach ($rc in $resetSources) {
        $rcCnt = [int](Get-SafeProp $rc @('manual_resets_remaining', 'manualResetsRemaining') 0)
        if ($rcCnt -gt 0) {
            $rcName = Get-SafeProp $rc @('name', 'display_name', 'id') 'unknown'
            Write-Host ("[Claude-Local Relay] Account with Reset Card: {0} (manual_resets_remaining={1}) -- open claude.ai/settings/usage to reset." -f $rcName, $rcCnt)
        }
    }
}

function Show-RelayStatus {
    param($StatusResp)
    $active = Get-SafeProp $StatusResp @('active', 'active_account') $null
    $activeName = [string](Get-SafeProp $StatusResp @('active_name') '')
    if (-not $activeName) {
        if ($active -is [string] -and $active.Trim()) {
            $activeName = $active.Trim()
        } else {
            $activeName = [string](Get-SafeProp $active @('name', 'display_name') '(none)')
        }
    }
    $cliRunning = [bool](Get-SafeProp $StatusResp @('cli_running') $false)
    $shouldRelay = [bool](Get-SafeProp $StatusResp @('should_relay_now') $false)
    $cfg = Get-SafeProp $StatusResp @('config') $null
    $strategyVal = Get-SafeProp $cfg @('strategy') 'smart'
    $thresholdVal = Get-SafeProp $cfg @('spentThresholdPct') 98
    $autoContVal = [bool](Get-SafeProp $cfg @('autoContinueOnRelay') $false)
    $maxConcVal = Get-SafeProp $cfg @('maxSameExitConcurrency', 'max_same_exit_concurrency') 1
    $defModelVal = ([string](Get-SafeProp $cfg @('defaultCliModel', 'default_cli_model') '')).Trim()
    $defEffortVal = ([string](Get-SafeProp $cfg @('defaultCliEffort', 'default_cli_effort') '')).Trim()
    $pool = Get-SafeProp $StatusResp @('pool', 'pool_summary') $null

    Write-Host '=========================================================================='
    Write-Host ' Claude-Local SmartRelay & CLI Orchestrator Status'
    Write-Host '=========================================================================='
    Write-Host (" Active Account  : {0}  (cli_running={1}, should_relay_now={2})" -f $activeName, $cliRunning, $shouldRelay)
    Write-Host (" Relay Config    : strategy={0}, threshold={1}%, autoContinue={2}, maxSameExitConcurrency={3}" -f $strategyVal, $thresholdVal, $autoContVal, $maxConcVal)
    if ($defModelVal -or $defEffortVal) {
        $mLabel = if ($defModelVal) { $defModelVal } else { '(follow settings)' }
        $eLabel = if ($defEffortVal) { $defEffortVal } else { '(follow settings)' }
        Write-Host (" Default Model   : model={0}, effort={1}" -f $mLabel, $eLabel)
    }
    if ($null -ne $pool) {
        $ready = Get-SafeProp $pool @('readyCount', 'ready_count') 0
        $low = Get-SafeProp $pool @('lowCount', 'low_count') 0
        $spent = Get-SafeProp $pool @('spentCount', 'spent_count') 0
        $unavail = Get-SafeProp $pool @('unavailableCount', 'unavailable_count') 0
        $resetsTotal = Get-SafeProp $pool @('totalManualResetsRemaining', 'total_manual_resets_remaining') 0
        Write-Host (" Pool Summary    : ready={0}, low={1}, spent={2}, unavailable={3}, resetCards={4}" -f $ready, $low, $spent, $unavail, $resetsTotal)
    }

    $accts = Get-SafeProp $StatusResp @('accounts') $null
    if ($null -ne $accts -and @($accts).Count -gt 0) {
        Write-Host '--------------------------------------------------------------------------'
        Write-Host (" {0,-2} {1,-18} {2,-6} {3,-8} {4,-8} {5,-7} {6}" -f '*', 'Account', 'Tier', '5h Rem', '7d Rem', 'Cards', 'Slots')
        foreach ($a in @($accts)) {
            $isCurr = [bool](Get-SafeProp $a @('is_current', 'isCurrent') $false)
            $mark = if ($isCurr) { '*' } else { ' ' }
            $name = [string](Get-SafeProp $a @('name', 'display_name', 'id') 'unknown')
            if ($name.Length -gt 18) { $name = $name.Substring(0, 17) + '~' }
            $tier = Get-SafeProp $a @('tier') '-'
            $no5h = [bool](Get-SafeProp $a @('no_5h_limit', 'quota_no_5h_limit') $false)
            $rem5 = Get-SafeProp $a @('rem_5h', 'rem5h') $null
            $rem7 = Get-SafeProp $a @('rem_7d', 'rem7d') $null
            $rem5Str = if ($no5h) { 'unlim' } elseif ($null -ne $rem5) { ("{0}%" -f $rem5) } else { '--' }
            $rem7Str = if ($null -ne $rem7) { ("{0}%" -f $rem7) } else { '--' }
            $cards = Get-SafeProp $a @('manual_resets_remaining', 'manualResetsRemaining') 0
            $slots = Get-SafeProp $a @('slot_pids', 'active_slots') $null
            $slotCount = if ($null -ne $slots) { @($slots).Count } else { 0 }
            Write-Host (" {0,-2} {1,-18} {2,-6} {3,-8} {4,-8} {5,-7} {6}" -f $mark, $name, $tier, $rem5Str, $rem7Str, $cards, $slotCount)
        }
    }
    Show-AwaitingResetReminders $StatusResp
    Write-Host '=========================================================================='
}

function Get-BestStandbyLabel {
    param(
        $StatusResp,
        [string]$ExcludeRecordId = ''
    )
    $accts = Get-SafeProp $StatusResp @('accounts') $null
    if ($null -eq $accts) { return '(none)' }
    $acctList = @($accts)
    $rankedTargets = Get-SafeProp $StatusResp @('ranked_auto_targets', 'rankedAutoTargets') $null
    if ($null -ne $rankedTargets) {
        foreach ($tidObj in @($rankedTargets)) {
            $tid = ([string]$tidObj).Trim()
            if (-not $tid) { continue }
            if ($ExcludeRecordId -and ($tid -eq $ExcludeRecordId)) { continue }
            foreach ($a in $acctList) {
                $aid = [string](Get-SafeProp $a @('id', 'record_id') '')
                if ($aid -and ($aid -eq $tid)) {
                    $bName = [string](Get-SafeProp $a @('name', 'display_name', 'id') 'standby')
                    $effVal = [int](Get-SafeProp $a @('effective_rem', 'effectiveRem') -1)
                    if ($effVal -gt 0) {
                        return ("{0} ({1}%)" -f $bName, $effVal)
                    }
                    return $bName
                }
            }
        }
    }
    $best = $null
    $bestEff = -1
    foreach ($a in $acctList) {
        $aid = [string](Get-SafeProp $a @('id', 'record_id') '')
        if ($ExcludeRecordId -and $aid -and ($aid -eq $ExcludeRecordId)) { continue }
        if ([bool](Get-SafeProp $a @('is_current', 'isCurrent') $false)) { continue }
        if ([bool](Get-SafeProp $a @('excluded') $false)) { continue }
        if ([bool](Get-SafeProp $a @('unavailable') $false)) { continue }
        if ([bool](Get-SafeProp $a @('awaiting_manual_reset', 'awaitingManualReset') $false)) { continue }
        if ([bool](Get-SafeProp $a @('spent') $false)) { continue }
        $cd = Get-SafeProp $a @('cooldown_until_sec', 'cooldownUntilSec') $null
        if ($null -ne $cd -and [int64]$cd -gt [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) { continue }
        $eff = [int](Get-SafeProp $a @('effective_rem', 'effectiveRem') -1)
        if ($eff -lt 0) {
            $r5 = Get-SafeProp $a @('rem_5h', 'rem5h') $null
            $r7 = Get-SafeProp $a @('rem_7d', 'rem7d') $null
            if ($null -ne $r5 -and $null -ne $r7) {
                $eff = [Math]::Min([int]$r5, [int]$r7)
            } elseif ($null -ne $r7) {
                $eff = [int]$r7
            } else {
                $eff = 0
            }
        }
        if ($eff -gt $bestEff) {
            $bestEff = $eff
            $best = $a
        }
    }
    if ($null -eq $best) { return '(none)' }
    $bName = [string](Get-SafeProp $best @('name', 'display_name', 'id') 'standby')
    if ($bestEff -gt 0) {
        return ("{0} ({1}%)" -f $bName, $bestEff)
    }
    return $bName
}

function ConvertTo-ProjectSlug {
    param([string]$DirPath)
    if (-not $DirPath) { return '' }
    return ($DirPath -replace '[^A-Za-z0-9\-]', '-')
}

function Find-ActiveSession {
    param(
        [string]$ClaudeDir,
        [datetime]$RunStartUtc,
        [string]$WorkingDir,
        [string]$FallbackSessionId,
        [int]$ChildPid = 0
    )
    $cutoff = $RunStartUtc.AddSeconds(-2)
    $foundId = $FallbackSessionId
    $foundJsonl = $null
    $resolvedFromChildPid = $false

    $sessDir = Join-Path $ClaudeDir 'sessions'
    if (Test-Path -LiteralPath $sessDir -PathType Container) {
        if ($ChildPid -gt 0) {
            $pidSessPath = Join-Path $sessDir ("{0}.json" -f $ChildPid)
            if (Test-Path -LiteralPath $pidSessPath -PathType Leaf) {
                try {
                    $pidObj = (Get-Content -LiteralPath $pidSessPath -Raw -Encoding UTF8) | ConvertFrom-Json
                    $pidSid = ([string](Get-SafeProp $pidObj @('sessionId', 'session_id') '')).Trim()
                    if ($pidSid) {
                        $foundId = $pidSid
                        $resolvedFromChildPid = $true
                    }
                } catch {}
            }
        }
        if ((-not $resolvedFromChildPid) -and (-not $foundId)) {
            $sessFiles = @(Get-ChildItem -LiteralPath $sessDir -Filter '*.json' -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTimeUtc -ge $cutoff } |
                Sort-Object LastWriteTimeUtc -Descending)
            foreach ($sf in $sessFiles) {
                try {
                    $obj = (Get-Content -LiteralPath $sf.FullName -Raw -Encoding UTF8) | ConvertFrom-Json
                    $sid = ([string](Get-SafeProp $obj @('sessionId', 'session_id') '')).Trim()
                    $scwd = [string](Get-SafeProp $obj @('cwd') '')
                    if ($sid) {
                        if (-not $scwd -or $scwd -ieq $WorkingDir) {
                            $foundId = $sid
                            break
                        }
                        if (-not $foundId) {
                            $foundId = $sid
                        }
                    }
                } catch {}
            }
        }
    }

    $projRoot = Join-Path $ClaudeDir 'projects'
    if (Test-Path -LiteralPath $projRoot -PathType Container) {
        $slug = ConvertTo-ProjectSlug $WorkingDir
        $candidateDirs = @()
        if ($slug) {
            $slugDir = Join-Path $projRoot $slug
            if (Test-Path -LiteralPath $slugDir -PathType Container) {
                $candidateDirs += Get-Item -LiteralPath $slugDir
            }
        }
        $allDirs = @(Get-ChildItem -LiteralPath $projRoot -Directory -ErrorAction SilentlyContinue)
        if ($candidateDirs.Count -eq 0) {
            $candidateDirs = $allDirs
        }

        if ($foundId) {
            foreach ($d in $candidateDirs) {
                $exact = Join-Path $d.FullName ($foundId + '.jsonl')
                if (Test-Path -LiteralPath $exact -PathType Leaf) {
                    $foundJsonl = $exact
                    break
                }
            }
            if ($null -eq $foundJsonl) {
                foreach ($d in $allDirs) {
                    $exact = Join-Path $d.FullName ($foundId + '.jsonl')
                    if (Test-Path -LiteralPath $exact -PathType Leaf) {
                        $foundJsonl = $exact
                        break
                    }
                }
            }
        }

        if ($null -eq $foundJsonl -and (-not $resolvedFromChildPid) -and (-not $foundId)) {
            $recentJsonls = @()
            foreach ($d in $candidateDirs) {
                $files = @(Get-ChildItem -LiteralPath $d.FullName -Filter '*.jsonl' -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.LastWriteTimeUtc -ge $cutoff -and $_.Name -notlike 'agent-*' })
                foreach ($f in $files) { $recentJsonls += $f }
            }
            if ($recentJsonls.Count -eq 0 -and $allDirs.Count -gt 0) {
                foreach ($d in $allDirs) {
                    $files = @(Get-ChildItem -LiteralPath $d.FullName -Filter '*.jsonl' -File -ErrorAction SilentlyContinue |
                        Where-Object { $_.LastWriteTimeUtc -ge $cutoff -and $_.Name -notlike 'agent-*' })
                    foreach ($f in $files) { $recentJsonls += $f }
                }
            }
            if ($recentJsonls.Count -gt 0) {
                $newest = $recentJsonls | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
                $foundJsonl = $newest.FullName
                $foundId = [IO.Path]::GetFileNameWithoutExtension($newest.Name)
            }
        }
    }

    return @{
        SessionId = $foundId
        JsonlPath = $foundJsonl
    }
}

function Get-EntryText {
    param($Entry)
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($candidate in @(
        (Get-SafeProp $Entry @('text') $null),
        (Get-SafeProp $Entry @('content') $null),
        (Get-SafeProp $Entry @('result') $null),
        (Get-SafeProp $Entry @('error_details', 'errorDetails') $null),
        (Get-SafeProp (Get-SafeProp $Entry @('error') $null) @('message') $null),
        (Get-SafeProp (Get-SafeProp $Entry @('message') $null) @('content') $null)
    )) {
        if ($null -eq $candidate) { continue }
        if ($candidate -is [string]) {
            if ($candidate) { [void]$parts.Add($candidate) }
        } else {
            foreach ($blk in @($candidate)) {
                if ($null -eq $blk) { continue }
                if ($blk -is [string]) {
                    if ($blk) { [void]$parts.Add($blk) }
                } else {
                    $t = Get-SafeProp $blk @('text', 'content') $null
                    if ($t -is [string] -and $t) { [void]$parts.Add($t) }
                }
            }
        }
    }
    return ($parts -join ' ')
}

function Test-EntryHasMeaningfulContent {
    param(
        $Entry,
        [string]$BodyText = ''
    )
    if ($BodyText -and $BodyText.Trim().Length -gt 0) {
        return $true
    }
    $msg = Get-SafeProp $Entry @('message') $Entry
    $content = Get-SafeProp $msg @('content') $null
    if ($content -is [string] -and $content.Trim().Length -gt 0) {
        return $true
    }
    if ($null -ne $content -and ($content -isnot [string])) {
        foreach ($blk in @($content)) {
            if ($null -eq $blk) { continue }
            $bType = [string](Get-SafeProp $blk @('type') '')
            if ($bType -in @('tool_use', 'server_tool_use', 'tool_result')) {
                return $true
            }
            $t = Get-SafeProp $blk @('text', 'content') $null
            if ($t -is [string] -and $t.Trim().Length -gt 0) {
                return $true
            }
        }
    }
    return $false
}

function Get-JsonlByteOffsets {
    param([string]$ClaudeDir)
    $offsets = @{}
    $projRoot = Join-Path $ClaudeDir 'projects'
    if (Test-Path -LiteralPath $projRoot -PathType Container) {
        $files = @(Get-ChildItem -LiteralPath $projRoot -Recurse -Filter '*.jsonl' -File -ErrorAction SilentlyContinue)
        foreach ($f in $files) {
            $offsets[$f.FullName] = [int64]$f.Length
        }
    }
    return $offsets
}

function Read-JsonlTailLines {
    param(
        [string]$JsonlPath,
        [int64]$StartOffset = 0,
        [int]$MaxTail = 120
    )
    if ($StartOffset -le 0) {
        return @(Get-Content -LiteralPath $JsonlPath -Tail $MaxTail -Encoding UTF8 -ErrorAction SilentlyContinue)
    }
    $fs = New-Object System.IO.FileStream($JsonlPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        if ($fs.Length -le $StartOffset) {
            return @()
        }
        [void]$fs.Seek($StartOffset, [System.IO.SeekOrigin]::Begin)
        $sr = New-Object System.IO.StreamReader($fs, (New-Object System.Text.UTF8Encoding($false)), $true)
        try {
            $queue = New-Object 'System.Collections.Generic.Queue[string]'
            while (-not $sr.EndOfStream) {
                $ln = $sr.ReadLine()
                $queue.Enqueue($ln)
                if ($queue.Count -gt $MaxTail) {
                    [void]$queue.Dequeue()
                }
            }
            return $queue.ToArray()
        } finally {
            $sr.Dispose()
        }
    } finally {
        $fs.Dispose()
    }
}

$script:RelayRatePattern = '(?i)(you''ve hit your (?:5-hour |weekly )?limit|you have hit your (?:5-hour |weekly )?limit|session limit reached|5-hour limit|5h limit|weekly limit|usage limit reached|continuing automatically|spend limit|usage credits required|billing_error|rate_limit_error|rate[_\s-]?limit|apierrorstatus\s*:\s*429|"apiErrorStatus"\s*:\s*429|exceeded your current quota|out of extra usage|overloaded_error|authentication_failed|authentication_error|invalid_grant)'
$script:RelayNonResponseRecordTypes = @(
    'cost-state', 'last-prompt', 'tools-used', 'queue-operation', 'session-owner',
    'atis-latch', 'progress', 'summary', 'file-history-snapshot', 'continued-in',
    'api-request-blob', 'api-request', 'ai-title', 'mode', 'permission-mode',
    'custom-title', 'agent-name'
)
$script:RelayPartialSkipTypePattern = '(?i)"type"\s*:\s*"(?:user|api-request-blob|api-request|ai-title|mode|permission-mode|custom-title|agent-name|cost-state|last-prompt|tools-used|queue-operation|session-owner|atis-latch|progress|summary|file-history-snapshot|continued-in)"'
$script:RelayPartialErrorMarkerPattern = '(?i)"isApiErrorMessage"\s*:\s*true|"apiErrorStatus"\s*:\s*429|"is_error"\s*:\s*true|"error"\s*:\s*"(?:rate_limit|billing_error|overloaded|authentication_failed|authentication_error|invalid_grant)"|"model"\s*:\s*"<synthetic>"|"type"\s*:\s*"(?:system|error)"'
$script:RelayPartialAutoContinueMarkerPattern = '(?i)(?:"type"\s*:\s*"(?:system|error)"|"isApiErrorMessage"\s*:\s*true|"model"\s*:\s*"<synthetic>")'

function Get-JsonlEntryErrorState {
    <#
    .SYNOPSIS
        Extract normalized record-type and error-eligibility flags from a parsed JSONL line.
    #>
    param($Parsed)
    $recType = ([string](Get-SafeProp $Parsed @('type') '')).Trim()
    $skipNonResponse = ($script:RelayNonResponseRecordTypes -contains $recType)
    $isUser = ($recType -eq 'user')
    $isApiErr = [bool](Get-SafeProp $Parsed @('isApiErrorMessage', 'is_api_error_message') $false)
    $isErrFlag = [bool](Get-SafeProp $Parsed @('is_error', 'isError') $false)
    $errProp = Get-SafeProp $Parsed @('error') $null
    $apiErrStatus = Get-SafeProp $Parsed @('apiErrorStatus', 'api_error_status') $null
    $errText = if ($errProp -is [string]) { $errProp } elseif ($null -ne $errProp) { ($errProp | ConvertTo-Json -Depth 5 -Compress) } else { '' }
    $msgObj = Get-SafeProp $Parsed @('message') $null
    $msgModel = ([string](Get-SafeProp $msgObj @('model') (Get-SafeProp $Parsed @('model') ''))).Trim()
    $isSyntheticModel = ($msgModel -eq '<synthetic>')
    $isEligible = ($recType -in @('system', 'error')) -or $isApiErr -or $isErrFlag -or $isSyntheticModel -or ([bool]$errText)
    return @{
        RecType          = $recType
        SkipNonResponse  = $skipNonResponse
        IsUser           = $isUser
        IsApiErr         = $isApiErr
        IsErrFlag        = $isErrFlag
        IsSyntheticModel = $isSyntheticModel
        ApiErrStatus     = $apiErrStatus
        ErrText          = $errText
        IsEligible       = $isEligible
    }
}

function Test-PartialJsonLineHasRateLimit {
    <#
    .SYNOPSIS
        Guard unparseable JSONL tail lines against metadata/prose rate-limit false positives.
    #>
    param([string]$RawLine)
    if (-not $RawLine) { return $false }
    if ($RawLine.TrimStart().StartsWith('{')) {
        if ($RawLine -match $script:RelayPartialSkipTypePattern) {
            return $false
        }
        if (-not ($RawLine -match $script:RelayPartialErrorMarkerPattern)) {
            return $false
        }
        if ($RawLine -match '(?i)(?:"apiErrorStatus"\s*:\s*429|"error"\s*:\s*"rate_limit")') {
            return $true
        }
        return ($RawLine -match $script:RelayRatePattern)
    }
    return ($RawLine -match $script:RelayRatePattern)
}

function Test-SingleJsonlRateLimited {
    param(
        [string]$JsonlPath,
        [int64]$StartOffset = 0,
        [datetime]$RunStartUtc = [DateTime]::MinValue
    )
    if (-not $JsonlPath -or -not (Test-Path -LiteralPath $JsonlPath -PathType Leaf)) {
        return $false
    }
    $lines = @(Read-JsonlTailLines -JsonlPath $JsonlPath -StartOffset $StartOffset -MaxTail 120)
    if ($lines.Count -eq 0) { return $false }

    $cutoff = if ($RunStartUtc -gt [DateTime]::MinValue) { $RunStartUtc.AddSeconds(-5) } else { [DateTime]::MinValue }
    $sawRateLimit = $false
    foreach ($rawLine in $lines) {
        if (-not $rawLine -or -not $rawLine.Trim()) { continue }
        $parsed = $null
        try {
            $parsed = $rawLine | ConvertFrom-Json
        } catch {
            $parsed = $null
        }
        if ($null -ne $parsed) {
            $tsVal = Get-SafeProp $parsed @('timestamp') $null
            if ($tsVal -is [string] -and $tsVal -and $cutoff -gt [DateTime]::MinValue) {
                try {
                    $parsedDt = [DateTimeOffset]::Parse($tsVal).UtcDateTime
                    if ($parsedDt -lt $cutoff) { continue }
                } catch {}
            }
            $entryState = Get-JsonlEntryErrorState $parsed
            if ($entryState.SkipNonResponse -or $entryState.IsUser) {
                continue
            }
            if ($null -ne $entryState.ApiErrStatus -and ([string]$entryState.ApiErrStatus).Trim() -eq '429') {
                $sawRateLimit = $true
                continue
            }
            if ($entryState.ErrText -match '(?i)(rate[_\s-]?limit|billing_error|spend limit|usage credits required|out of extra usage|429|5h|5-hour|weekly limit|usage limit|overloaded|authentication_failed|authentication_error|invalid_grant)') {
                $sawRateLimit = $true
                continue
            }
            $bodyText = Get-EntryText $parsed
            if ($entryState.IsEligible -and ($bodyText -match $script:RelayRatePattern)) {
                $sawRateLimit = $true
                continue
            }
            if (($entryState.RecType -eq 'assistant' -or $entryState.RecType -eq 'result') -and (-not $entryState.IsApiErr) -and (-not $entryState.IsErrFlag) -and (-not $entryState.ErrText) -and ($null -eq $entryState.ApiErrStatus)) {
                if (Test-EntryHasMeaningfulContent -Entry $parsed -BodyText $bodyText) {
                    $sawRateLimit = $false
                }
            }
        } elseif (Test-PartialJsonLineHasRateLimit $rawLine) {
            $sawRateLimit = $true
        }
    }
    return $sawRateLimit
}

function Test-TranscriptRateLimited {
    param(
        [string]$JsonlPath,
        [int64]$StartOffset = 0,
        [datetime]$RunStartUtc = [DateTime]::MinValue,
        [hashtable]$PreRunOffsets = @{}
    )
    if (Test-SingleJsonlRateLimited -JsonlPath $JsonlPath -StartOffset $StartOffset -RunStartUtc $RunStartUtc) {
        return $true
    }
    if (-not $JsonlPath) { return $false }
    try {
        $projDir = Split-Path -Parent $JsonlPath
        $sessStem = [IO.Path]::GetFileNameWithoutExtension($JsonlPath)
        if (-not $projDir -or -not $sessStem) { return $false }
        $subDir = Join-Path (Join-Path $projDir $sessStem) 'subagents'
        if (-not (Test-Path -LiteralPath $subDir -PathType Container)) { return $false }
        $cutoff = if ($RunStartUtc -gt [DateTime]::MinValue) { $RunStartUtc.AddSeconds(-5) } else { [DateTime]::MinValue }
        $subFiles = @(Get-ChildItem -LiteralPath $subDir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue |
            Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and $_.LastWriteTimeUtc -ge $cutoff })
        foreach ($sf in $subFiles) {
            $subOffset = if ($PreRunOffsets -and $PreRunOffsets.ContainsKey($sf.FullName)) { [int64]$PreRunOffsets[$sf.FullName] } else { [int64]0 }
            if (Test-SingleJsonlRateLimited -JsonlPath $sf.FullName -StartOffset $subOffset -RunStartUtc $RunStartUtc) {
                return $true
            }
        }
    } catch {}
    return $false
}

function Test-TranscriptAutoContinueNotice {
    param(
        [string]$JsonlPath,
        [int64]$StartOffset = 0,
        [datetime]$RunStartUtc = [DateTime]::MinValue
    )
    if (-not $JsonlPath -or -not (Test-Path -LiteralPath $JsonlPath -PathType Leaf)) {
        return $false
    }
    $lines = @(Read-JsonlTailLines -JsonlPath $JsonlPath -StartOffset $StartOffset -MaxTail 120)
    if ($lines.Count -eq 0) { return $false }
    $cutoff = if ($RunStartUtc -gt [DateTime]::MinValue) { $RunStartUtc.AddSeconds(-5) } else { [DateTime]::MinValue }
    foreach ($rawLine in $lines) {
        if (-not $rawLine -or -not $rawLine.Trim()) { continue }
        $parsed = $null
        try {
            $parsed = $rawLine | ConvertFrom-Json
        } catch {
            $parsed = $null
        }
        if ($null -ne $parsed) {
            $tsVal = Get-SafeProp $parsed @('timestamp') $null
            if ($tsVal -is [string] -and $tsVal -and $cutoff -gt [DateTime]::MinValue) {
                try {
                    $parsedDt = [DateTimeOffset]::Parse($tsVal).UtcDateTime
                    if ($parsedDt -lt $cutoff) { continue }
                } catch {}
            }
            $entryState = Get-JsonlEntryErrorState $parsed
            if ($entryState.SkipNonResponse -or $entryState.IsUser) { continue }
            $bodyText = Get-EntryText $parsed
            if ($entryState.IsEligible -and ($bodyText -match '(?i)continuing automatically')) {
                return $true
            }
        } elseif ($rawLine.TrimStart().StartsWith('{')) {
            if (($rawLine -notmatch $script:RelayPartialSkipTypePattern) -and
                ($rawLine -match $script:RelayPartialAutoContinueMarkerPattern) -and
                ($rawLine -match '(?i)continuing automatically')) {
                return $true
            }
        } elseif ($rawLine -match '(?i)continuing automatically') {
            return $true
        }
    }
    return $false
}

function Test-TranscriptHasPendingToolUse {
    param(
        [string]$JsonlPath,
        [int64]$StartOffset = 0,
        [int]$MaxTail = 120
    )
    if (-not $JsonlPath -or -not (Test-Path -LiteralPath $JsonlPath -PathType Leaf)) {
        return $false
    }
    $lines = @(Read-JsonlTailLines -JsonlPath $JsonlPath -StartOffset $StartOffset -MaxTail $MaxTail)
    if ($lines.Count -eq 0) { return $false }
    $pending = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($rawLine in $lines) {
        if (-not $rawLine -or -not $rawLine.Trim()) { continue }
        try {
            $entry = $rawLine | ConvertFrom-Json
            if ($null -eq $entry) { continue }
            $recType = ([string](Get-SafeProp $entry @('type') '')).Trim()
            if ($recType -and ($recType -ne 'user') -and ($recType -ne 'assistant')) { continue }
            $msg = Get-SafeProp $entry @('message') $entry
            $content = Get-SafeProp $msg @('content') $null
            if ($null -ne $content -and ($content -isnot [string])) {
                foreach ($blk in @($content)) {
                    if ($null -eq $blk) { continue }
                    $bType = [string](Get-SafeProp $blk @('type') '')
                    if ($bType -eq 'tool_use') {
                        $tid = [string](Get-SafeProp $blk @('id') '')
                        if ($tid) { [void]$pending.Add($tid) }
                    } elseif ($bType -eq 'tool_result') {
                        $tuid = [string](Get-SafeProp $blk @('tool_use_id', 'toolUseId') '')
                        if ($tuid) { [void]$pending.Remove($tuid) }
                    }
                }
            }
        } catch {}
    }
    return ($pending.Count -gt 0)
}

function Test-SessionJsonlHasTurns {
    param([string]$JsonlPath)
    if (-not $JsonlPath -or -not (Test-Path -LiteralPath $JsonlPath -PathType Leaf)) {
        return $false
    }
    try {
        $item = Get-Item -LiteralPath $JsonlPath -Force -ErrorAction Stop
        if ((($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or ($item.Length -le 0)) {
            return $false
        }
        $fs = New-Object System.IO.FileStream($JsonlPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $sr = New-Object System.IO.StreamReader($fs, (New-Object System.Text.UTF8Encoding($false)), $true)
            try {
                while (-not $sr.EndOfStream) {
                    $ln = $sr.ReadLine()
                    if (-not $ln -or -not $ln.Trim()) { continue }
                    try {
                        $obj = $ln | ConvertFrom-Json
                        if ($null -eq $obj) { continue }
                        $isApiErr = [bool](Get-SafeProp $obj @('isApiErrorMessage', 'is_api_error_message') $false)
                        $isMeta = [bool](Get-SafeProp $obj @('isMeta', 'is_meta') $false)
                        if ($isApiErr -or $isMeta) { continue }
                        $t = [string](Get-SafeProp $obj @('type') '')
                        if ($t -ne 'user' -and $t -ne 'assistant') { continue }
                        $msgObj = Get-SafeProp $obj @('message') $null
                        $modelVal = ([string](Get-SafeProp $msgObj @('model') (Get-SafeProp $obj @('model') ''))).Trim()
                        if ($modelVal -eq '<synthetic>') { continue }
                        $content = Get-SafeProp $msgObj @('content') (Get-SafeProp $obj @('content', 'text') $null)
                        if ($content -is [string]) {
                            if ($content.Trim().Length -gt 0) {
                                return $true
                            }
                        } elseif ($null -ne $content) {
                            foreach ($part in @($content)) {
                                if ($null -eq $part) { continue }
                                if ($part -is [string]) {
                                    if ($part.Trim().Length -gt 0) { return $true }
                                    continue
                                }
                                $pType = ([string](Get-SafeProp $part @('type') '')).Trim()
                                if ($pType -eq 'thinking' -or $pType -eq 'redacted_thinking') { continue }
                                if ($pType -eq 'text') {
                                    $pText = [string](Get-SafeProp $part @('text') '')
                                    if ($pText.Trim().Length -gt 0) { return $true }
                                } elseif ($pType -eq 'tool_use') {
                                    $pName = [string](Get-SafeProp $part @('name') '')
                                    if ($pName.Trim().Length -gt 0) { return $true }
                                } elseif ($pType -eq 'tool_result') {
                                    $trContent = Get-SafeProp $part @('content') $null
                                    if ($trContent -is [string] -and $trContent.Trim().Length -gt 0) {
                                        return $true
                                    } elseif ($null -ne $trContent -and -not ($trContent -is [string])) {
                                        foreach ($trItem in @($trContent)) {
                                            if ($trItem -is [string] -and $trItem.Trim().Length -gt 0) { return $true }
                                            if (([string](Get-SafeProp $trItem @('text') '')).Trim().Length -gt 0) { return $true }
                                        }
                                    }
                                }
                            }
                        }
                    } catch {}
                }
            } finally {
                $sr.Dispose()
            }
        } finally {
            $fs.Dispose()
        }
    } catch {}
    return $false
}

function Get-ContinuedInSessionId {
    param(
        [string]$JsonlPath,
        [int64]$StartOffset = 0
    )
    if (-not $JsonlPath -or -not (Test-Path -LiteralPath $JsonlPath -PathType Leaf)) {
        return ''
    }
    $projDir = Split-Path -Parent $JsonlPath
    $lines = @(Read-JsonlTailLines -JsonlPath $JsonlPath -StartOffset $StartOffset -MaxTail 25)
    if ($lines.Count -eq 0) { return '' }
    for ($idx = $lines.Count - 1; $idx -ge 0; $idx--) {
        $rawLine = $lines[$idx]
        if (-not $rawLine -or -not $rawLine.Trim()) { continue }
        try {
            $entry = $rawLine | ConvertFrom-Json
            if ($null -eq $entry) { continue }
            $eType = [string](Get-SafeProp $entry @('type') '')
            if ($eType -eq 'continued-in') {
                $cid = ([string](Get-SafeProp $entry @('continuedInSessionId', 'continued_in_session_id') '')).Trim()
                if ($cid -match '^[A-Za-z0-9][A-Za-z0-9_-]{3,127}$') {
                    $cidJsonl = Join-Path $projDir ($cid + '.jsonl')
                    if (Test-SessionJsonlHasTurns $cidJsonl) {
                        return $cid
                    }
                    return ''
                }
            }
            if ($eType -eq 'user' -or $eType -eq 'assistant') {
                break
            }
        } catch {}
    }
    return ''
}

function Get-InitialSessionArg {
    param([string[]]$ArgList)
    if ($null -eq $ArgList) { return '' }
    for ($i = 0; $i -lt $ArgList.Count; $i++) {
        $a = $ArgList[$i]
        if ($a -eq '--') { break }
        if ($a -match '^(?:--resume|-r|--session-id)=(.+)$') {
            $eqVal = $Matches[1]
            if ($eqVal -and (-not $eqVal.StartsWith('-'))) {
                return $eqVal
            }
            continue
        }
        if ($a -eq '--resume' -or $a -eq '-r' -or $a -eq '--session-id') {
            if ($i + 1 -lt $ArgList.Count) {
                $nextTok = $ArgList[$i + 1]
                if ($nextTok -and (-not $nextTok.StartsWith('-'))) {
                    return $nextTok
                }
            }
        }
    }
    return ''
}

function Split-RelayClaudeArgs {
    param([string[]]$ArgList)
    $persistent = New-Object System.Collections.Generic.List[string]
    $hasPrint = $false
    $printFlag = ''
    $hasSettings = $false
    $hasAgents = $false
    $hasModel = $false
    $hasEffort = $false
    $hadResumeOrContinue = $false

    if ($null -eq $ArgList -or $ArgList.Count -eq 0) {
        return @{
            BasePersistentArgs  = [string[]]@()
            HasPrint            = $false
            PrintFlag           = ''
            HasSettings         = $false
            HasAgents           = $false
            HasModel            = $false
            HasEffort           = $false
            HadResumeOrContinue = $false
        }
    }

    $flagsTakingValue = @(
        '-m', '--model', '--effort', '--permission-mode', '--inherit-permission-mode',
        '--append-system-prompt', '--append-system-prompt-file',
        '--append-subagent-system-prompt', '--append-subagent-system-prompt-file',
        '--system-prompt', '--system-prompt-file', '--plan-mode-instructions',
        '-n', '--name', '--plugin-dir', '--agents', '--agent',
        '--settings', '--setting-sources', '--fallback-model',
        '--max-budget-usd', '--max-turns', '--output-format',
        '--input-format', '--json-schema', '--debug-file',
        '--file', '--watch-artifact', '--watch-artifact-no-autoreact',
        '--deep-link-repo', '--deep-link-last-fetch', '--deep-link-cwd-b64'
    )
    $variadicFlags = @(
        '--add-dir', '--mcp-config', '--allowedTools', '--allowed-tools',
        '--disallowedTools', '--disallowed-tools', '--tools', '--betas'
    )
    $optionalValueFlags = @(
        '-d', '--debug', '-w', '--worktree'
    )
    $sessionOnlyFlags = @(
        '-r', '--resume', '--session-id', '-c', '--continue',
        '--from-pr', '--prefill', '--prefill-b64',
        '--resume-session-at', '--resume-drops-turn'
    )

    for ($i = 0; $i -lt $ArgList.Count; $i++) {
        $a = $ArgList[$i]
        if ($a -eq '--') { break }
        if ($a -eq '--settings' -or $a -like '--settings=*') { $hasSettings = $true }
        if ($a -eq '--agents' -or $a -like '--agents=*') { $hasAgents = $true }
        if ($a -eq '-m' -or $a -eq '--model' -or $a -like '-m=*' -or $a -like '--model=*') { $hasModel = $true }
        if ($a -eq '--effort' -or $a -like '--effort=*') { $hasEffort = $true }

        if ($a -match '^(?:-p|--print)=') {
            $hasPrint = $true
            if (-not $printFlag) { $printFlag = '--print' }
            continue
        }
        if ($a -match '^(?:-r|--resume|--session-id|-c|--continue|--from-pr|--prefill|--prefill-b64|--resume-session-at|--resume-drops-turn)=') {
            $hadResumeOrContinue = $true
            continue
        }
        if ($a -eq '-p' -or $a -eq '--print') {
            $hasPrint = $true
            if (-not $printFlag) { $printFlag = $a }
            if (($i + 1 -lt $ArgList.Count) -and (-not $ArgList[$i + 1].StartsWith('-'))) {
                $i++
            }
            continue
        }
        if ($sessionOnlyFlags -contains $a) {
            $hadResumeOrContinue = $true
            if (($i + 1 -lt $ArgList.Count) -and (-not $ArgList[$i + 1].StartsWith('-'))) {
                $i++
            }
            continue
        }

        if (-not $a.StartsWith('-')) {
            continue
        }

        [void]$persistent.Add($a)
        if ($a.Contains('=')) {
            continue
        }
        if ($flagsTakingValue -contains $a) {
            if (($i + 1 -lt $ArgList.Count) -and ($ArgList[$i + 1] -ne '--')) {
                $i++
                [void]$persistent.Add($ArgList[$i])
            }
            continue
        }
        if ($variadicFlags -contains $a) {
            while (($i + 1 -lt $ArgList.Count) -and (-not $ArgList[$i + 1].StartsWith('-'))) {
                $i++
                [void]$persistent.Add($ArgList[$i])
            }
            continue
        }
        if ($optionalValueFlags -contains $a) {
            if (($i + 1 -lt $ArgList.Count) -and (-not $ArgList[$i + 1].StartsWith('-')) -and ($ArgList[$i + 1] -notmatch '\s')) {
                $i++
                [void]$persistent.Add($ArgList[$i])
            }
            continue
        }
        # Any other flag (including new boolean CLI flags) is kept as a standalone flag
        # without swallowing a trailing positional prompt into BasePersistentArgs.
    }

    return @{
        BasePersistentArgs  = [string[]]$persistent.ToArray()
        HasPrint            = $hasPrint
        PrintFlag           = $printFlag
        HasSettings         = $hasSettings
        HasAgents           = $hasAgents
        HasModel            = $hasModel
        HasEffort           = $hasEffort
        HadResumeOrContinue = $hadResumeOrContinue
    }
}

function Write-RelayAtomicJsonFile {
    param(
        [string]$Path,
        $Obj
    )
    if (-not $Path) { return }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $json = ($Obj | ConvertTo-Json -Depth 10 -Compress)
    $tmp = $Path + '.' + $PID + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $json, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Write-EphemeralHookSettings {
    param(
        [string]$SettingsPath,
        [string]$HookCommand,
        [bool]$RegisterStopHook
    )
    if (-not $SettingsPath -or -not $HookCommand) { return }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $hookEntry = @(
        @{
            hooks = @(
                @{
                    type    = 'command'
                    command = $HookCommand
                }
            )
        }
    )
    $hooksMap = [ordered]@{
        StopFailure = $hookEntry
    }
    if ($RegisterStopHook) {
        $hooksMap['Stop'] = $hookEntry
        $hooksMap['PostToolUse'] = $hookEntry
    }
    $settingsObj = @{ hooks = $hooksMap }
    $settingsJson = ($settingsObj | ConvertTo-Json -Depth 10) -replace "`r`n", "`n"
    $tmpSettings = $SettingsPath + '.' + $PID + '.tmp'
    [System.IO.File]::WriteAllText($tmpSettings, $settingsJson + "`n", $utf8NoBom)
    Move-Item -LiteralPath $tmpSettings -Destination $SettingsPath -Force
}

function Resolve-WorkingPythonPath {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    foreach ($cmdName in @('python', 'py')) {
        $candidates = @(Get-Command $cmdName -All -CommandType Application -ErrorAction SilentlyContinue)
        foreach ($cand in $candidates) {
            if (-not $cand -or -not $cand.Source) { continue }
            $src = [string]$cand.Source
            if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { continue }
            $fi = $null
            try { $fi = Get-Item -LiteralPath $src -Force -ErrorAction Stop } catch { continue }
            if ($src -match '(?i)\\WindowsApps\\' -and $fi.Length -le 0) {
                continue
            }
            $probePsi = New-Object System.Diagnostics.ProcessStartInfo
            if ($src -match '\.(cmd|bat)$') {
                $probePsi.FileName = if ($env:ComSpec) { $env:ComSpec } else { 'cmd.exe' }
                $probePsi.Arguments = '/d /s /c "' + (Format-WinCmdArg $src) + ' -c "import sys; print(1)""'
            } else {
                $probePsi.FileName = $src
                $probePsi.Arguments = '-c "import sys; print(1)"'
            }
            $probePsi.UseShellExecute = $false
            $probePsi.CreateNoWindow = $true
            $probePsi.RedirectStandardInput = $true
            $probePsi.RedirectStandardOutput = $true
            $probePsi.RedirectStandardError = $true
            $probePsi.StandardOutputEncoding = $utf8NoBom
            $probePsi.StandardErrorEncoding = $utf8NoBom
            $probeProc = $null
            try {
                $probeProc = [System.Diagnostics.Process]::Start($probePsi)
                if ($null -eq $probeProc) { continue }
                try { $probeProc.StandardInput.Close() } catch {}
                $outTask = $probeProc.StandardOutput.ReadToEndAsync()
                $errTask = $probeProc.StandardError.ReadToEndAsync()
                if (-not $probeProc.WaitForExit(2500)) {
                    try { $probeProc.Kill() } catch {}
                    continue
                }
                $probeExit = [int]$probeProc.ExitCode
                $probeOut = $outTask.GetAwaiter().GetResult()
                $null = $errTask.GetAwaiter().GetResult()
                if ($probeExit -eq 0 -and $probeOut -and $probeOut.Trim() -eq '1') {
                    return $src
                }
            } catch {
            } finally {
                if ($null -ne $probeProc) { $probeProc.Dispose() }
            }
        }
    }
    return ''
}

function Initialize-EphemeralRelayArtifacts {
    param(
        [string]$TempDir,
        [string]$ClaudeDir,
        [string]$UserHome,
        [bool]$InjectSettings,
        [bool]$InjectAgents,
        [bool]$RegisterStopHook = $false
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $triggerPath = Join-Path $TempDir 'trigger.json'
    $turnEndPath = Join-Path $TempDir 'turn_end.json'
    $proactiveStatePath = Join-Path $TempDir 'proactive_handoff.json'
    $thresholdArmedPath = Join-Path $TempDir 'threshold_armed.json'
    $settingsPath = ''
    $hookCommand = ''
    $agentsInlineJson = ''

    if ($InjectSettings) {
        $pySentinel = Join-Path $TempDir 'sentinel_hook.py'
        $pyCode = @'
import json, os, re, sys, time
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
trigger_path = sys.argv[1]
turn_end_path = sys.argv[2] if len(sys.argv) > 2 else ""
proactive_state_path = sys.argv[3] if len(sys.argv) > 3 else ""
threshold_armed_path = sys.argv[4] if len(sys.argv) > 4 else ""
raw = ""
try:
    raw = sys.stdin.read(65536)
except Exception:
    raw = ""
event_name = ""
err = ""
details = ""
last_msg = ""
sid = ""
tpath = ""
stop_active = False
has_bg = False
if raw.strip():
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            event_name = str(data.get("hook_event_name") or "")
            err = str(data.get("error") or "")
            details = str(data.get("error_details") or data.get("message") or "")
            last_msg = str(data.get("last_assistant_message") or "")
            sid = str(data.get("session_id") or "")
            tpath = str(data.get("transcript_path") or "")
            stop_active = bool(data.get("stop_hook_active"))
            has_bg = bool(data.get("background_tasks")) or bool(data.get("session_crons"))
    except Exception:
        details = raw[:1024]

def write_atomic(dest, obj):
    if not dest:
        return
    tmp_path = dest + "." + str(os.getpid()) + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp_path, dest)

def read_json_dict(path):
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None

if event_name == "PostToolUse":
    armed = read_json_dict(threshold_armed_path)
    if not armed or armed.get("armed") is not True:
        sys.exit(0)
    try:
        threshold_pct = int(armed.get("threshold_pct") or 98)
    except Exception:
        threshold_pct = 98
    default_hard_cap = min(threshold_pct + 1, 99) if threshold_pct >= 98 else min(threshold_pct + 5, 97)
    try:
        hc_raw = armed.get("hard_cap_pct")
        hard_cap_pct = int(hc_raw) if (hc_raw is not None and not isinstance(hc_raw, bool)) else default_hard_cap
    except Exception:
        hard_cap_pct = default_hard_cap
    u5_raw = armed.get("used_5h")
    u7_raw = armed.get("used_7d")
    try:
        u5_val = int(u5_raw) if (u5_raw is not None and not isinstance(u5_raw, bool)) else None
    except Exception:
        u5_val = None
    try:
        u7_val = int(u7_raw) if (u7_raw is not None and not isinstance(u7_raw, bool)) else None
    except Exception:
        u7_val = None
    max_used = max(u5_val or 0, u7_val or 0)
    standby = str(armed.get("standby_name") or "next").strip() or "next"

    pstate = read_json_dict(proactive_state_path) or {}
    cur_stage = str(pstate.get("stage") or "")
    try:
        post_notice_tools = int(pstate.get("post_notice_tools") or 0)
    except Exception:
        post_notice_tools = 0
    try:
        max_wrapup_tools = int(pstate.get("max_wrapup_tools") or 2)
        if max_wrapup_tools <= 0:
            max_wrapup_tools = 2
    except Exception:
        max_wrapup_tools = 2

    eff_sid = sid or str(pstate.get("session_id") or "")
    eff_tpath = tpath or str(pstate.get("transcript_path") or "")
    now_ms = int(time.time() * 1000)

    if (not cur_stage) and (max_used < hard_cap_pct):
        write_atomic(proactive_state_path, {
            "stage": "wrapping_up",
            "post_notice_tools": 0,
            "max_wrapup_tools": max_wrapup_tools,
            "threshold_pct": threshold_pct,
            "used_5h": u5_val,
            "used_7d": u7_val,
            "standby_name": standby,
            "session_id": eff_sid,
            "transcript_path": eff_tpath,
            "ts_ms": now_ms,
        })
        out = {
            "systemMessage": f"[Claude-Local Relay] Quota reached {max_used}% (threshold {threshold_pct}%); wrapping up current step for automatic handoff to [{standby}].",
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": (
                    f"[Claude-Local Relay Handoff] Account quota has reached {max_used}% "
                    f"(threshold {threshold_pct}%, standby: {standby}). Do NOT start new subtasks or large refactors. "
                    f"Finish only the immediate atomic step in progress (at most {max_wrapup_tools} quick tool calls) so files "
                    "remain in a clean, consistent state, then output a concise structured handoff summary "
                    "(Completed / Files Modified / Exact Next Step) and end your turn immediately so Claude-Local "
                    "can automatically switch accounts before hitting the 5h limit."
                ),
            },
        }
        print(json.dumps(out, ensure_ascii=False), flush=True)
    elif (cur_stage == "wrapping_up") and (max_used < hard_cap_pct) and ((post_notice_tools + 1) < max_wrapup_tools):
        new_cnt = post_notice_tools + 1
        write_atomic(proactive_state_path, {
            "stage": "wrapping_up",
            "post_notice_tools": new_cnt,
            "max_wrapup_tools": max_wrapup_tools,
            "threshold_pct": threshold_pct,
            "used_5h": u5_val,
            "used_7d": u7_val,
            "standby_name": standby,
            "session_id": eff_sid,
            "transcript_path": eff_tpath,
            "ts_ms": now_ms,
        })
        rem_tools = max(1, max_wrapup_tools - new_cnt)
        out = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": (
                    f"[Claude-Local Relay Handoff] Final wrap-up step ({rem_tools} tool call left before automatic handoff "
                    f"at {max_used}% / threshold {threshold_pct}%, standby: {standby}). Finish only this step, "
                    "output your concise structured handoff summary (Completed / Files Modified / Exact Next Step), and end your turn now."
                ),
            },
        }
        print(json.dumps(out, ensure_ascii=False), flush=True)
    else:
        new_cnt = (post_notice_tools + 1) if cur_stage else post_notice_tools
        write_atomic(proactive_state_path, {
            "stage": "forced_stop",
            "post_notice_tools": new_cnt,
            "max_wrapup_tools": max_wrapup_tools,
            "threshold_pct": threshold_pct,
            "used_5h": u5_val,
            "used_7d": u7_val,
            "standby_name": standby,
            "session_id": eff_sid,
            "transcript_path": eff_tpath,
            "ts_ms": now_ms,
        })
        out = {
            "continue": False,
            "stopReason": f"Claude-Local Relay: quota safety threshold reached ({max_used}% / {threshold_pct}%); stopping cleanly after tool call to switch to [{standby}] before hitting the 5h limit.",
        }
        print(json.dumps(out, ensure_ascii=False), flush=True)
    sys.exit(0)

broad_re = r"(rate[_\s-]?limit|overloaded|billing_error|authentication_failed|authentication_error|invalid_grant|429|hit your limit|hit your 5-hour limit|5-hour limit|5h limit|weekly limit|session limit reached|usage limit reached|spend limit|out of extra usage|exceeded your current quota|usage credits required)"
synthetic_banner_re = r"^\s*(?:api\s+error\s*:\s*429|you(?:'ve| have)\s+hit\s+your\s+(?:5-hour\s+|weekly\s+)?limit|usage\s+limit\s+reached|session\s+limit\s+reached|spend\s+limit|out\s+of\s+extra\s+usage|exceeded\s+your\s+current\s+quota|usage\s+credits\s+required|rate[_\s-]?limit(?:_error)?|billing_error|overloaded_error|authentication_failed|authentication_error|invalid_grant)"
err_details = (err + " " + details).strip().lower()
last_stripped = last_msg.strip()
is_rate = bool(err_details and re.search(broad_re, err_details))
if (not is_rate) and last_stripped:
    if event_name == "StopFailure":
        is_rate = bool(re.search(broad_re, last_stripped.lower()))
    elif len(last_stripped) <= 400:
        is_rate = bool(re.search(synthetic_banner_re, last_stripped, re.IGNORECASE))
if is_rate:
    write_atomic(trigger_path, {
        "reason": "rate_limit",
        "error": err or "rate_limit",
        "session_id": sid,
        "transcript_path": tpath,
        "has_bg": has_bg,
    })
    sys.exit(0)

if event_name == "Stop":
    if (not stop_active) and (not has_bg) and turn_end_path:
        pstate = read_json_dict(proactive_state_path)
        proactive_wrapup = bool(pstate and pstate.get("stage") in ("wrapping_up", "forced_stop"))
        write_atomic(turn_end_path, {
            "event": "Stop",
            "session_id": sid,
            "transcript_path": tpath,
            "has_bg": has_bg,
            "proactive_wrapup": proactive_wrapup,
            "ts_ms": int(time.time() * 1000),
        })
    sys.exit(0)
'@
        [System.IO.File]::WriteAllText($pySentinel, ($pyCode -replace "`r`n", "`n"), $utf8NoBom)

        $pySource = Resolve-WorkingPythonPath
        if ($pySource) {
            $hookCommand = (Format-HookPathArg $pySource) + ' -E -s ' + (Format-HookPathArg $pySentinel) + ' ' + (Format-HookPathArg $triggerPath) + ' ' + (Format-HookPathArg $turnEndPath) + ' ' + (Format-HookPathArg $proactiveStatePath) + ' ' + (Format-HookPathArg $thresholdArmedPath)
        } else {
            $psSentinel = Join-Path $TempDir 'sentinel_hook.ps1'
            $psCode = @'
param([string]$TriggerPath, [string]$TurnEndPath, [string]$ProactiveStatePath, [string]$ThresholdArmedPath)
$utf8 = New-Object System.Text.UTF8Encoding($false)
try {
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
} catch {}
$raw = ''
try { if ([Console]::IsInputRedirected) { $raw = [Console]::In.ReadToEnd() } } catch {}
function Write-AtomicJson([string]$Dest, $Obj) {
    if (-not $Dest) { return }
    $tmp = $Dest + '.' + $PID + '.tmp'
    $json = ($Obj | ConvertTo-Json -Depth 6 -Compress)
    [System.IO.File]::WriteAllText($tmp, $json, $utf8)
    Move-Item -LiteralPath $tmp -Destination $Dest -Force
}
function Read-SafeJson([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $txt = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
        if (-not $txt -or -not $txt.Trim()) { return $null }
        return ($txt | ConvertFrom-Json)
    } catch {
        return $null
    }
}
function Get-JsonProp($Obj, [string]$Name, $Default = $null) {
    if ($null -eq $Obj) { return $Default }
    $p = $Obj.PSObject.Properties[$Name]
    if ($null -ne $p -and $null -ne $p.Value) { return $p.Value }
    return $Default
}
$eventName = ''
$err = ''
$details = ''
$lastMsg = ''
$sid = ''
$tpath = ''
$stopActive = $false
$hasBg = $false
if ($raw -and $raw.Trim()) {
    try {
        $d = $raw | ConvertFrom-Json
        if ($null -ne $d) {
            if ($null -ne $d.PSObject.Properties['hook_event_name']) { $eventName = [string]$d.hook_event_name }
            if ($null -ne $d.PSObject.Properties['error']) { $err = [string]$d.error }
            if ($null -ne $d.PSObject.Properties['error_details'] -and $d.error_details) { $details = [string]$d.error_details }
            elseif ($null -ne $d.PSObject.Properties['message'] -and $d.message) { $details = [string]$d.message }
            if ($null -ne $d.PSObject.Properties['last_assistant_message']) { $lastMsg = [string]$d.last_assistant_message }
            if ($null -ne $d.PSObject.Properties['session_id']) { $sid = [string]$d.session_id }
            if ($null -ne $d.PSObject.Properties['transcript_path']) { $tpath = [string]$d.transcript_path }
            if ($null -ne $d.PSObject.Properties['stop_hook_active']) { $stopActive = [bool]$d.stop_hook_active }
            $bgTasks = if ($null -ne $d.PSObject.Properties['background_tasks']) { $d.background_tasks } else { $null }
            $crons = if ($null -ne $d.PSObject.Properties['session_crons']) { $d.session_crons } else { $null }
            $hasBg = (($null -ne $bgTasks -and @($bgTasks).Count -gt 0) -or ($null -ne $crons -and @($crons).Count -gt 0))
        }
    } catch {
        $details = $raw
    }
}
if ($eventName -eq 'PostToolUse') {
    $armedObj = Read-SafeJson $ThresholdArmedPath
    $armedVal = Get-JsonProp $armedObj 'armed' $false
    if (-not ($armedVal -is [bool] -and $armedVal)) { exit 0 }
    $thresholdPct = 98
    try {
        $tRaw = Get-JsonProp $armedObj 'threshold_pct' 98
        if ($tRaw -and -not ($tRaw -is [bool])) { $thresholdPct = [int]$tRaw }
    } catch { $thresholdPct = 98 }
    $defaultHardCap = if ($thresholdPct -ge 98) { [Math]::Min($thresholdPct + 1, 99) } else { [Math]::Min($thresholdPct + 5, 97) }
    $hardCapPct = $defaultHardCap
    try {
        $hcRaw = Get-JsonProp $armedObj 'hard_cap_pct' $null
        if ($null -ne $hcRaw -and -not ($hcRaw -is [bool])) { $hardCapPct = [int]$hcRaw }
    } catch { $hardCapPct = $defaultHardCap }
    $u5Val = $null
    $u7Val = $null
    try {
        $u5Raw = Get-JsonProp $armedObj 'used_5h' $null
        if ($null -ne $u5Raw -and -not ($u5Raw -is [bool])) { $u5Val = [int]$u5Raw }
    } catch { $u5Val = $null }
    try {
        $u7Raw = Get-JsonProp $armedObj 'used_7d' $null
        if ($null -ne $u7Raw -and -not ($u7Raw -is [bool])) { $u7Val = [int]$u7Raw }
    } catch { $u7Val = $null }
    $u5Int = if ($null -ne $u5Val) { $u5Val } else { 0 }
    $u7Int = if ($null -ne $u7Val) { $u7Val } else { 0 }
    $maxUsed = [Math]::Max($u5Int, $u7Int)
    $standby = ([string](Get-JsonProp $armedObj 'standby_name' 'next')).Trim()
    if (-not $standby) { $standby = 'next' }

    $pState = Read-SafeJson $ProactiveStatePath
    $curStage = [string](Get-JsonProp $pState 'stage' '')
    $postNoticeTools = 0
    try { $postNoticeTools = [int](Get-JsonProp $pState 'post_notice_tools' 0) } catch { $postNoticeTools = 0 }
    $maxWrapupTools = 2
    try {
        $maxWrapupTools = [int](Get-JsonProp $pState 'max_wrapup_tools' 2)
        if ($maxWrapupTools -le 0) { $maxWrapupTools = 2 }
    } catch { $maxWrapupTools = 2 }

    $effSid = if ($sid) { $sid } else { [string](Get-JsonProp $pState 'session_id' '') }
    $effTpath = if ($tpath) { $tpath } else { [string](Get-JsonProp $pState 'transcript_path' '') }
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    if ((-not $curStage) -and ($maxUsed -lt $hardCapPct)) {
        Write-AtomicJson $ProactiveStatePath ([ordered]@{
            stage             = 'wrapping_up'
            post_notice_tools = 0
            max_wrapup_tools  = $maxWrapupTools
            threshold_pct     = $thresholdPct
            used_5h           = $u5Val
            used_7d           = $u7Val
            standby_name      = $standby
            session_id        = $effSid
            transcript_path   = $effTpath
            ts_ms             = $nowMs
        })
        $outObj = [ordered]@{
            systemMessage      = ('[Claude-Local Relay] Quota reached {0}% (threshold {1}%); wrapping up current step for automatic handoff to [{2}].' -f $maxUsed, $thresholdPct, $standby)
            hookSpecificOutput = [ordered]@{
                hookEventName     = 'PostToolUse'
                additionalContext = ('[Claude-Local Relay Handoff] Account quota has reached {0}% (threshold {1}%, standby: {2}). Do NOT start new subtasks or large refactors. Finish only the immediate atomic step in progress (at most {3} quick tool calls) so files remain in a clean, consistent state, then output a concise structured handoff summary (Completed / Files Modified / Exact Next Step) and end your turn immediately so Claude-Local can automatically switch accounts before hitting the 5h limit.' -f $maxUsed, $thresholdPct, $standby, $maxWrapupTools)
            }
        }
        [Console]::WriteLine(($outObj | ConvertTo-Json -Depth 6 -Compress))
    } elseif (($curStage -eq 'wrapping_up') -and ($maxUsed -lt $hardCapPct) -and (($postNoticeTools + 1) -lt $maxWrapupTools)) {
        $newCnt = $postNoticeTools + 1
        Write-AtomicJson $ProactiveStatePath ([ordered]@{
            stage             = 'wrapping_up'
            post_notice_tools = $newCnt
            max_wrapup_tools  = $maxWrapupTools
            threshold_pct     = $thresholdPct
            used_5h           = $u5Val
            used_7d           = $u7Val
            standby_name      = $standby
            session_id        = $effSid
            transcript_path   = $effTpath
            ts_ms             = $nowMs
        })
        $remTools = [Math]::Max(1, $maxWrapupTools - $newCnt)
        $outObj = [ordered]@{
            hookSpecificOutput = [ordered]@{
                hookEventName     = 'PostToolUse'
                additionalContext = ('[Claude-Local Relay Handoff] Final wrap-up step ({0} tool call left before automatic handoff at {1}% / threshold {2}%, standby: {3}). Finish only this step, output your concise structured handoff summary (Completed / Files Modified / Exact Next Step), and end your turn now.' -f $remTools, $maxUsed, $thresholdPct, $standby)
            }
        }
        [Console]::WriteLine(($outObj | ConvertTo-Json -Depth 6 -Compress))
    } else {
        $newCnt = if ($curStage) { $postNoticeTools + 1 } else { $postNoticeTools }
        Write-AtomicJson $ProactiveStatePath ([ordered]@{
            stage             = 'forced_stop'
            post_notice_tools = $newCnt
            max_wrapup_tools  = $maxWrapupTools
            threshold_pct     = $thresholdPct
            used_5h           = $u5Val
            used_7d           = $u7Val
            standby_name      = $standby
            session_id        = $effSid
            transcript_path   = $effTpath
            ts_ms             = $nowMs
        })
        $outObj = [ordered]@{
            'continue' = $false
            stopReason = ('Claude-Local Relay: quota safety threshold reached ({0}% / {1}%); stopping cleanly after tool call to switch to [{2}] before hitting the 5h limit.' -f $maxUsed, $thresholdPct, $standby)
        }
        [Console]::WriteLine(($outObj | ConvertTo-Json -Depth 6 -Compress))
    }
    exit 0
}
$broadPattern = '(?i)(rate[_\s-]?limit|overloaded|billing_error|authentication_failed|authentication_error|invalid_grant|429|hit your limit|hit your 5-hour limit|5-hour limit|5h limit|weekly limit|session limit reached|usage limit reached|spend limit|out of extra usage|exceeded your current quota|usage credits required)'
$syntheticBannerPattern = '(?i)^\s*(?:api\s+error\s*:\s*429|you(?:''ve| have)\s+hit\s+your\s+(?:5-hour\s+|weekly\s+)?limit|usage\s+limit\s+reached|session\s+limit\s+reached|spend\s+limit|out\s+of\s+extra\s+usage|exceeded\s+your\s+current\s+quota|usage\s+credits\s+required|rate[_\s-]?limit(?:_error)?|billing_error|overloaded_error|authentication_failed|authentication_error|invalid_grant)'
$errDetails = ($err + ' ' + $details).Trim()
$lastTrimmed = if ($lastMsg) { $lastMsg.Trim() } else { '' }
$isRateLimit = [bool]($errDetails -and ($errDetails -match $broadPattern))
if ((-not $isRateLimit) -and $lastTrimmed) {
    if ($eventName -eq 'StopFailure') {
        $isRateLimit = [bool]($lastTrimmed -match $broadPattern)
    } elseif ($lastTrimmed.Length -le 400) {
        $isRateLimit = [bool]($lastTrimmed -match $syntheticBannerPattern)
    }
}
if ($isRateLimit) {
    Write-AtomicJson $TriggerPath @{
        reason          = 'rate_limit'
        error           = $(if ($err) { $err } else { 'rate_limit' })
        session_id      = $sid
        transcript_path = $tpath
        has_bg          = [bool]$hasBg
    }
    exit 0
}
if ($eventName -eq 'Stop') {
    if ((-not $stopActive) -and (-not $hasBg) -and $TurnEndPath) {
        $pState = Read-SafeJson $ProactiveStatePath
        $pStage = [string](Get-JsonProp $pState 'stage' '')
        $proactiveWrapup = ($pStage -in @('wrapping_up', 'forced_stop'))
        Write-AtomicJson $TurnEndPath @{
            event            = 'Stop'
            session_id       = $sid
            transcript_path  = $tpath
            has_bg           = [bool]$hasBg
            proactive_wrapup = [bool]$proactiveWrapup
            ts_ms            = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        }
    }
    exit 0
}
'@
            [System.IO.File]::WriteAllText($psSentinel, ($psCode -replace "`r`n", "`n"), $utf8NoBom)
            $psExe = (Get-Process -Id $PID).Path
            if (-not $psExe) { $psExe = 'powershell.exe' }
            $hookCommand = (Format-HookPathArg $psExe) + ' -NoProfile -ExecutionPolicy Bypass -File ' + (Format-HookPathArg $psSentinel) + ' ' + (Format-HookPathArg $triggerPath) + ' ' + (Format-HookPathArg $turnEndPath) + ' ' + (Format-HookPathArg $proactiveStatePath) + ' ' + (Format-HookPathArg $thresholdArmedPath)
        }

        $settingsPath = Join-Path $TempDir 'ephemeral-settings.json'
        Write-EphemeralHookSettings -SettingsPath $settingsPath -HookCommand $hookCommand -RegisterStopHook $RegisterStopHook
    }

    if ($InjectAgents) {
        $proPoolWorkerMd = Join-Path $ClaudeDir 'agents\pro-pool-worker.md'
        if (-not (Test-Path -LiteralPath $proPoolWorkerMd -PathType Leaf)) {
            $subagentPs1 = (Join-Path $UserHome '.local\bin\claude-subagent.ps1') -replace '\\', '/'
            $agentsObj = @{
                'pro-pool-worker' = @{
                    description = 'Delegate scoped subtasks to an isolated secondary Claude Pro or Max slot via ~/.local/bin/claude-subagent.ps1 without switching ~/.claude.'
                    tools       = @('Bash', 'Read', 'Grep', 'Glob')
                    prompt      = ('Run secondary-account subtasks in an isolated CLAUDE_CONFIG_DIR slot via {0}. Before fanning out 3 or more parallel workers, run {0} -Status to check readyCount and maxSameExitConcurrency. Pass -ReadOnly unless the worker owns disjoint file edits, and pass -Resume with the session UUID from [CL-SLOT-TRACE] for follow-up turns.' -f $subagentPs1)
                }
            }
            $agentsInlineJson = ($agentsObj | ConvertTo-Json -Depth 6 -Compress)
            $agentsPath = Join-Path $TempDir 'ephemeral-agents.json'
            [System.IO.File]::WriteAllText($agentsPath, $agentsInlineJson + "`n", $utf8NoBom)
        }
    }

    return @{
        TriggerPath        = $triggerPath
        TurnEndPath        = $turnEndPath
        ProactiveStatePath = $proactiveStatePath
        ThresholdArmedPath = $thresholdArmedPath
        SettingsPath       = $settingsPath
        HookCommand        = $hookCommand
        StopHookEnabled    = $RegisterStopHook
        AgentsInlineJson   = $agentsInlineJson
    }
}

function Read-TurnEndMarker {
    param([string]$TurnEndPath)
    if (-not $TurnEndPath -or -not (Test-Path -LiteralPath $TurnEndPath -PathType Leaf)) {
        return @{ Present = $false; SessionId = ''; TranscriptPath = ''; HasBg = $false; ProactiveWrapup = $false; TsMs = [int64]0 }
    }
    try {
        $obj = (Get-Content -LiteralPath $TurnEndPath -Raw -Encoding UTF8) | ConvertFrom-Json
        return @{
            Present         = $true
            SessionId       = [string](Get-SafeProp $obj @('session_id', 'sessionId') '')
            TranscriptPath  = [string](Get-SafeProp $obj @('transcript_path', 'transcriptPath') '')
            HasBg           = [bool](Get-SafeProp $obj @('has_bg', 'hasBg') $false)
            ProactiveWrapup = [bool](Get-SafeProp $obj @('proactive_wrapup', 'proactiveWrapup') $false)
            TsMs            = [int64](Get-SafeProp $obj @('ts_ms', 'tsMs') 0)
        }
    } catch {
        return @{ Present = $false; SessionId = ''; TranscriptPath = ''; HasBg = $false; ProactiveWrapup = $false; TsMs = [int64]0 }
    }
}

function Read-ProactiveHandoffState {
    param([string]$ProactiveStatePath)
    $empty = @{
        Present         = $false
        Stage           = ''
        PostNoticeTools = 0
        MaxWrapupTools  = 2
        ThresholdPct    = 0
        Used5h          = $null
        Used7d          = $null
        StandbyName     = ''
        SessionId       = ''
        TranscriptPath  = ''
        TsMs            = [int64]0
    }
    if (-not $ProactiveStatePath -or -not (Test-Path -LiteralPath $ProactiveStatePath -PathType Leaf)) {
        return $empty
    }
    try {
        $obj = (Get-Content -LiteralPath $ProactiveStatePath -Raw -Encoding UTF8) | ConvertFrom-Json
        return @{
            Present         = $true
            Stage           = [string](Get-SafeProp $obj @('stage') '')
            PostNoticeTools = [int](Get-SafeProp $obj @('post_notice_tools', 'postNoticeTools') 0)
            MaxWrapupTools  = [int](Get-SafeProp $obj @('max_wrapup_tools', 'maxWrapupTools') 2)
            ThresholdPct    = [int](Get-SafeProp $obj @('threshold_pct', 'thresholdPct') 0)
            Used5h          = Get-SafeProp $obj @('used_5h', 'used5h') $null
            Used7d          = Get-SafeProp $obj @('used_7d', 'used7d') $null
            StandbyName     = [string](Get-SafeProp $obj @('standby_name', 'standbyName') '')
            SessionId       = [string](Get-SafeProp $obj @('session_id', 'sessionId') '')
            TranscriptPath  = [string](Get-SafeProp $obj @('transcript_path', 'transcriptPath') '')
            TsMs            = [int64](Get-SafeProp $obj @('ts_ms', 'tsMs') 0)
        }
    } catch {
        return $empty
    }
}

function Read-RelayTrigger {
    param([string]$TriggerPath)
    if (-not $TriggerPath -or -not (Test-Path -LiteralPath $TriggerPath -PathType Leaf)) {
        return @{ Reason = ''; SessionId = ''; TranscriptPath = ''; HasBg = $false }
    }
    try {
        $obj = (Get-Content -LiteralPath $TriggerPath -Raw -Encoding UTF8) | ConvertFrom-Json
        return @{
            Reason         = [string](Get-SafeProp $obj @('reason') '')
            SessionId      = [string](Get-SafeProp $obj @('session_id', 'sessionId') '')
            TranscriptPath = [string](Get-SafeProp $obj @('transcript_path', 'transcriptPath') '')
            HasBg          = [bool](Get-SafeProp $obj @('has_bg', 'hasBg') $false)
        }
    } catch {
        return @{ Reason = ''; SessionId = ''; TranscriptPath = ''; HasBg = $false }
    }
}

function Initialize-ConsoleInputInjectorType {
    if (-not ('ClaudeLocal.ConsoleInputInjector' -as [type])) {
        Add-Type -Namespace 'ClaudeLocal' -Name 'ConsoleInputInjector' -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct KEY_EVENT_RECORD {
    public int bKeyDown;
    public ushort wRepeatCount;
    public ushort wVirtualKeyCode;
    public ushort wVirtualScanCode;
    public char UnicodeChar;
    public uint dwControlKeyState;
}
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct INPUT_RECORD {
    public ushort EventType;
    public KEY_EVENT_RECORD KeyEvent;
}
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr CreateFileW(
    string lpFileName,
    uint dwDesiredAccess,
    uint dwShareMode,
    IntPtr lpSecurityAttributes,
    uint dwCreationDisposition,
    uint dwFlagsAndAttributes,
    IntPtr hTemplateFile
);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool CloseHandle(IntPtr hObject);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool WriteConsoleInputW(IntPtr hConsoleInput, INPUT_RECORD[] lpBuffer, uint nLength, out uint lpNumberOfEventsWritten);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern uint MapVirtualKeyW(uint uCode, uint uMapType);

private static void AppendKey(System.Collections.Generic.List<INPUT_RECORD> list, ushort vk, char ch, uint ctrl) {
    ushort scan = (ushort)MapVirtualKeyW((uint)vk, 0u);
    for (int down = 1; down >= 0; down--) {
        INPUT_RECORD r = new INPUT_RECORD();
        r.EventType = 1;
        r.KeyEvent.bKeyDown = down;
        r.KeyEvent.wRepeatCount = 1;
        r.KeyEvent.wVirtualKeyCode = vk;
        r.KeyEvent.wVirtualScanCode = scan;
        r.KeyEvent.UnicodeChar = ch;
        r.KeyEvent.dwControlKeyState = ctrl;
        list.Add(r);
    }
}

private static IntPtr OpenConInHandle(out bool ownHandle) {
    ownHandle = false;
    IntPtr hIn = CreateFileW("CONIN$", 0xC0000000u, 3u, IntPtr.Zero, 3u, 0u, IntPtr.Zero);
    if (hIn != IntPtr.Zero && hIn != new IntPtr(-1)) {
        ownHandle = true;
        return hIn;
    }
    return GetStdHandle(-10);
}

public static bool IsConsoleInRawMode() {
    bool ownHandle;
    IntPtr hIn = OpenConInHandle(out ownHandle);
    if (hIn == IntPtr.Zero || hIn == new IntPtr(-1)) return false;
    try {
        uint mode;
        if (!GetConsoleMode(hIn, out mode)) return false;
        return (mode & 0x0006u) == 0u;
    } finally {
        if (ownHandle) {
            CloseHandle(hIn);
        }
    }
}

private static bool WriteRecordsToConIn(System.Collections.Generic.List<INPUT_RECORD> recs) {
    bool ownHandle;
    IntPtr hIn = OpenConInHandle(out ownHandle);
    if (hIn == IntPtr.Zero || hIn == new IntPtr(-1)) return false;
    try {
        uint mode;
        if (!GetConsoleMode(hIn, out mode)) return false;
        if ((mode & 0x0006u) != 0u) return false;
        uint written = 0;
        INPUT_RECORD[] arr = recs.ToArray();
        return WriteConsoleInputW(hIn, arr, (uint)arr.Length, out written) && written > 0;
    } finally {
        if (ownHandle) {
            CloseHandle(hIn);
        }
    }
}

public static bool TrySendStandaloneEscape() {
    var recs = new System.Collections.Generic.List<INPUT_RECORD>(2);
    AppendKey(recs, 0x1B, (char)0x1B, 0u);
    return WriteRecordsToConIn(recs);
}

public static bool TrySendClearDraft() {
    var clearRecs = new System.Collections.Generic.List<INPUT_RECORD>(4);
    AppendKey(clearRecs, 0x45, (char)0x05, 0x0008u);
    AppendKey(clearRecs, 0x55, (char)0x15, 0x0008u);
    return WriteRecordsToConIn(clearRecs);
}

public static bool TrySendSlashExitLiteral() {
    var cmdRecs = new System.Collections.Generic.List<INPUT_RECORD>(10);
    AppendKey(cmdRecs, 0xBF, '/', 0u);
    AppendKey(cmdRecs, 0x45, 'e', 0u);
    AppendKey(cmdRecs, 0x58, 'x', 0u);
    AppendKey(cmdRecs, 0x49, 'i', 0u);
    AppendKey(cmdRecs, 0x54, 't', 0u);
    return WriteRecordsToConIn(cmdRecs);
}

public static bool TrySendEnter() {
    var enterRecs = new System.Collections.Generic.List<INPUT_RECORD>(2);
    AppendKey(enterRecs, 0x0D, '\r', 0u);
    return WriteRecordsToConIn(enterRecs);
}

public static bool TrySendClearAndSlashExit() {
    if (!TrySendClearDraft()) return false;
    System.Threading.Thread.Sleep(60);
    if (!TrySendSlashExitLiteral()) return false;
    System.Threading.Thread.Sleep(150);
    return TrySendEnter();
}

public static bool TrySendExitLine() {
    if (!TrySendStandaloneEscape()) return false;
    System.Threading.Thread.Sleep(150);
    return TrySendClearAndSlashExit();
}

public static bool TrySendBackgroundChoiceKey() {
    // Select option "2. Move to background and exit" in Claude Code's /exit interstitial modal.
    // Never send Escape here: Escape cancels the modal into "Stay".
    var recs = new System.Collections.Generic.List<INPUT_RECORD>(2);
    AppendKey(recs, 0x32, '2', 0u);
    return WriteRecordsToConIn(recs);
}
'@
    }
}

function Test-ConsoleRawMode {
    if ($env:CLAUDE_LOCAL_DISABLE_CONSOLE_INJECT -eq '1') { return $false }
    if ([Console]::IsInputRedirected) { return $false }
    try {
        Initialize-ConsoleInputInjectorType
        return [ClaudeLocal.ConsoleInputInjector]::IsConsoleInRawMode()
    } catch {
        return $false
    }
}

function Wait-RelayProcessAliveMs {
    param(
        [System.Diagnostics.Process]$ChildProcess,
        [int]$DelayMs
    )
    if ($DelayMs -le 0) {
        return (($null -eq $ChildProcess) -or (-not $ChildProcess.HasExited))
    }
    if ($null -ne $ChildProcess) {
        if ($ChildProcess.HasExited) { return $false }
        return (-not $ChildProcess.WaitForExit($DelayMs))
    }
    [System.Threading.Thread]::Sleep($DelayMs)
    return $true
}

function Send-ConsolePhasedExitCommand {
    param(
        [bool]$SendSecondEscape = $false,
        [System.Diagnostics.Process]$ChildProcess = $null
    )
    if ($env:CLAUDE_LOCAL_DISABLE_CONSOLE_INJECT -eq '1') { return $false }
    if ([Console]::IsInputRedirected) { return $false }
    if (($null -ne $ChildProcess) -and $ChildProcess.HasExited) { return $false }
    try {
        Initialize-ConsoleInputInjectorType
        if (-not [ClaudeLocal.ConsoleInputInjector]::TrySendStandaloneEscape()) {
            return $false
        }
        if (-not (Wait-RelayProcessAliveMs -ChildProcess $ChildProcess -DelayMs 150)) { return $false }
        if ($SendSecondEscape) {
            if (-not [ClaudeLocal.ConsoleInputInjector]::TrySendStandaloneEscape()) {
                return $false
            }
            if (-not (Wait-RelayProcessAliveMs -ChildProcess $ChildProcess -DelayMs 150)) { return $false }
        }
        if (-not [ClaudeLocal.ConsoleInputInjector]::TrySendClearDraft()) {
            return $false
        }
        if (-not (Wait-RelayProcessAliveMs -ChildProcess $ChildProcess -DelayMs 60)) { return $false }
        if (-not [ClaudeLocal.ConsoleInputInjector]::TrySendSlashExitLiteral()) {
            return $false
        }
        if (-not (Wait-RelayProcessAliveMs -ChildProcess $ChildProcess -DelayMs 150)) { return $false }
        return [ClaudeLocal.ConsoleInputInjector]::TrySendEnter()
    } catch {
        return $false
    }
}

function Send-ConsoleBackgroundChoice {
    if ($env:CLAUDE_LOCAL_DISABLE_CONSOLE_INJECT -eq '1') { return $false }
    if ([Console]::IsInputRedirected) { return $false }
    try {
        Initialize-ConsoleInputInjectorType
        return [ClaudeLocal.ConsoleInputInjector]::TrySendBackgroundChoiceKey()
    } catch {
        return $false
    }
}

function Get-Win32ProcessSnapshot {
    try {
        return @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
    } catch {
        try {
            return @(Get-WmiObject Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
        } catch {
            return @()
        }
    }
}

function Get-DescendantProcessInfo {
    param([int]$RootPid)
    if ($RootPid -le 0) { return @() }
    $procs = Get-Win32ProcessSnapshot
    if ($procs.Count -eq 0) { return @() }
    $byParent = @{}
    foreach ($p in $procs) {
        $ppid = [int]$p.ParentProcessId
        if (-not $byParent.ContainsKey($ppid)) {
            $byParent[$ppid] = New-Object System.Collections.ArrayList
        }
        [void]$byParent[$ppid].Add($p)
    }
    $result = New-Object System.Collections.ArrayList
    $visited = New-Object 'System.Collections.Generic.HashSet[int]'
    $queue = New-Object 'System.Collections.Generic.Queue[int]'
    [void]$visited.Add($RootPid)
    $queue.Enqueue($RootPid)
    while ($queue.Count -gt 0) {
        $cur = $queue.Dequeue()
        if ($byParent.ContainsKey($cur)) {
            foreach ($child in $byParent[$cur]) {
                $cid = [int]$child.ProcessId
                if ($visited.Add($cid)) {
                    [void]$result.Add($child)
                    $queue.Enqueue($cid)
                }
            }
        }
    }
    return @($result.ToArray())
}

function Get-SubagentsDirForTranscript {
    param([string]$JsonlPath)
    if (-not $JsonlPath) { return '' }
    try {
        $projDir = Split-Path -Parent $JsonlPath
        $sessStem = [IO.Path]::GetFileNameWithoutExtension($JsonlPath)
        if (-not $projDir -or -not $sessStem) { return '' }
        $subDir = Join-Path (Join-Path $projDir $sessStem) 'subagents'
        if (Test-Path -LiteralPath $subDir -PathType Container) {
            $item = Get-Item -LiteralPath $subDir -Force -ErrorAction SilentlyContinue
            if ($null -ne $item -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)) {
                return $subDir
            }
        }
    } catch {}
    return ''
}

function Test-HasUnfinishedSubagentMeta {
    param(
        [string]$JsonlPath,
        [datetime]$RunStartUtc = [DateTime]::MinValue,
        [bool]$ExternalOnly = $false
    )
    $subDir = Get-SubagentsDirForTranscript $JsonlPath
    if (-not $subDir) { return $false }
    $cutoff = if ($RunStartUtc -gt [DateTime]::MinValue) { $RunStartUtc.AddSeconds(-5) } else { [DateTime]::MinValue }
    try {
        $metas = @(Get-ChildItem -LiteralPath $subDir -Filter '*.meta.json' -File -ErrorAction SilentlyContinue |
            Where-Object { (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) -and $_.LastWriteTimeUtc -ge $cutoff })
        foreach ($mf in $metas) {
            try {
                $obj = (Get-Content -LiteralPath $mf.FullName -Raw -Encoding UTF8) | ConvertFrom-Json
                $finishedVal = Get-SafeProp $obj @('finished') $null
                if ($null -ne $finishedVal -and [bool]$finishedVal) { continue }
                if ($ExternalOnly) {
                    $agentType = [string](Get-SafeProp $obj @('agentType', 'agent_type', 'subagent_type') '')
                    if ($agentType -match '(?i)gemini|gpt|codex|argon|carbon|hydrogen') {
                        return $true
                    }
                } else {
                    return $true
                }
            } catch {}
        }
    } catch {}
    return $false
}

function Test-HasActiveExternalWorker {
    param(
        [int]$ChildPid,
        [string]$JsonlPath,
        [datetime]$RunStartUtc = [DateTime]::MinValue
    )
    if ($ChildPid -le 0) { return $false }
    $descendants = Get-DescendantProcessInfo $ChildPid
    if ($descendants.Count -eq 0) { return $false }
    $hasUnfinishedExternalMeta = Test-HasUnfinishedSubagentMeta -JsonlPath $JsonlPath -RunStartUtc $RunStartUtc -ExternalOnly $true
    foreach ($p in $descendants) {
        $pName = [string]$p.Name
        $pCmd = [string]$p.CommandLine
        if ($pCmd -match '(?i)(sentinel_hook\.|claude_quota\.py|mock_driver\.py)') { continue }
        if ($pName -match '^(?i)(agy|codex)(\.exe)?$') {
            return $true
        }
        if ($pName -match '^(?i)(pwsh|powershell)(\.exe)?$') {
            if ($pCmd -match '(?i)(claude-relay\.ps1|claude-subagent\.ps1)') { continue }
            if ($hasUnfinishedExternalMeta -or ($pCmd -match '(?i)(\.(ps1|py|mjs|js)\b|agy|codex|gemini|gpt|argon|carbon|hydrogen|external|subagent|worker)')) {
                return $true
            }
        }
    }
    return $false
}

function Test-HasLiveChildShellOrWork {
    param(
        [int]$ChildPid,
        [string]$JsonlPath,
        [datetime]$RunStartUtc = [DateTime]::MinValue
    )
    if (Test-HasUnfinishedSubagentMeta -JsonlPath $JsonlPath -RunStartUtc $RunStartUtc -ExternalOnly $false) {
        return $true
    }
    if ($ChildPid -le 0) { return $false }
    $descendants = Get-DescendantProcessInfo $ChildPid
    foreach ($p in $descendants) {
        $pName = [string]$p.Name
        $pCmd = [string]$p.CommandLine
        if ($pName -match '^(?i)(conhost|OpenConsole|werfault)(\.exe)?$') { continue }
        if ($pCmd -match '(?i)(sentinel_hook\.|claude_quota\.py|mock_driver\.py|mcp[-_]?server|--mcp|\bnpx\b|\buvx\b|dual[-_]?collab|claude-local|node_modules)') { continue }
        if ($pName -match '^(?i)(agy|codex|pwsh|powershell|bash|sh|cmd)(\.exe)?$') {
            return $true
        }
        if ($pName -match '^(?i)claude(\.exe)?$' -and $pCmd -match '(?i)--bg-pty-host') {
            return $true
        }
    }
    return $false
}

function Stop-ClaudeDaemonIfAlive {
    param(
        [string]$ClaudeExe,
        [string]$ResolvedProxy = ''
    )
    if (-not $ClaudeExe) { return }
    $hasDaemon = $false
    $procs = Get-Win32ProcessSnapshot
    foreach ($p in $procs) {
        $pName = [string]$p.Name
        $pCmd = [string]$p.CommandLine
        if ($pName -match '^(?i)claude(\.exe)?$' -and ($pCmd -match '(?i)\bdaemon\b') -and ($pCmd -notmatch '(?i)--bg-pty-host')) {
            $hasDaemon = $true
            break
        }
    }
    if (-not $hasDaemon) { return }

    $scrubKeys = @(
        'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
        'CLAUDE_CONFIG_DIR',
        'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
        'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
        'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
        'CLAUDE_CODE_USE_GATEWAY', 'CLAUDE_CODE_SIMPLE', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'
    )
    $proxyEnvKeys = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'GRPC_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'grpc_proxy')
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($ClaudeExe -match '\.(cmd|bat)$') {
        $psi.FileName = if ($env:ComSpec) { $env:ComSpec } else { 'cmd.exe' }
        $psi.Arguments = '/d /s /c "' + (Format-WinCmdArg $ClaudeExe) + ' daemon stop --any"'
    } else {
        $psi.FileName = $ClaudeExe
        $psi.Arguments = 'daemon stop --any'
    }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($k in $scrubKeys) { $psi.Environment.Remove($k) | Out-Null }
    foreach ($pk in $proxyEnvKeys) { $psi.Environment.Remove($pk) | Out-Null }
    $normProxy = Normalize-HttpProxyUri $ResolvedProxy
    if ($normProxy) {
        foreach ($pk in $proxyEnvKeys) { $psi.Environment[$pk] = $normProxy }
    }
    $psi.Environment['NO_PROXY'] = 'localhost,127.0.0.1,::1'
    $psi.Environment['no_proxy'] = 'localhost,127.0.0.1,::1'
    $psi.Environment['DISABLE_TELEMETRY'] = '1'
    $psi.Environment['DISABLE_ERROR_REPORTING'] = '1'
    $psi.Environment['DO_NOT_TRACK'] = '1'

    $dProc = $null
    try {
        $dProc = [System.Diagnostics.Process]::Start($psi)
        if ($null -ne $dProc) {
            try { $dProc.StandardInput.Close() } catch {}
            $null = $dProc.WaitForExit(4000)
        }
    } catch {
    } finally {
        if ($null -ne $dProc) { $dProc.Dispose() }
    }
}

function Invoke-RelaySwitchWithRetry {
    param(
        [string]$ClaudeLocalExe,
        [hashtable]$Payload
    )
    $retryDelaysMs = @(800, 1600, 2500)
    $lastResp = $null
    $lastErr = $null
    for ($attempt = 0; $attempt -le $retryDelaysMs.Count; $attempt++) {
        try {
            $resp = Invoke-Orchestrate $ClaudeLocalExe $Payload
            $lastResp = $resp
            if ([bool](Get-SafeProp $resp @('switched') $false)) {
                return $resp
            }
            $errText = [string](Get-SafeProp $resp @('error') '')
            $reasonText = [string](Get-SafeProp $resp @('reason') '')
            $combinedErr = ($errText + ' ' + $reasonText)
            $isTransient = ($combinedErr -match '(?i)(请先结束\s*Claude\s*进程|lock|busy|正在运行|acquire.*lock|process.*running)')
            if (-not $isTransient -or $attempt -ge $retryDelaysMs.Count) {
                return $resp
            }
        } catch {
            $lastErr = $_
            $msg = $_.Exception.Message
            $isTransient = ($msg -match '(?i)(请先结束\s*Claude\s*进程|lock|busy|正在运行|timed out|orchestrate failed)')
            if (-not $isTransient -or $attempt -ge $retryDelaysMs.Count) {
                throw
            }
        }
        Start-Sleep -Milliseconds $retryDelaysMs[$attempt]
    }
    if ($null -ne $lastResp) { return $lastResp }
    if ($null -ne $lastErr) { throw $lastErr }
    return @{ ok = $false; switched = $false; error = 'relay_switch_failed' }
}

function Classify-SubagentTranscript {
    param(
        [string]$JsonlPath,
        [datetime]$RunStartUtc = [DateTime]::MinValue
    )
    $lastCompletedToolIdx = -1
    $lastRateLimitIdx = -1
    if ($JsonlPath -and (Test-Path -LiteralPath $JsonlPath -PathType Leaf)) {
        $lines = @(Read-JsonlTailLines -JsonlPath $JsonlPath -StartOffset 0 -MaxTail 120)
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $rawLine = $lines[$i]
            if (-not $rawLine -or -not $rawLine.Trim()) { continue }
            $parsed = $null
            try { $parsed = $rawLine | ConvertFrom-Json } catch { $parsed = $null }
            if ($null -ne $parsed) {
                $entryState = Get-JsonlEntryErrorState $parsed
                if ($entryState.SkipNonResponse) { continue }
                $recType = $entryState.RecType

                if ((-not $recType) -or ($recType -eq 'user') -or ($recType -eq 'assistant')) {
                    $msg = Get-SafeProp $parsed @('message') $parsed
                    $content = Get-SafeProp $msg @('content') $null
                    if ($null -ne $content -and ($content -isnot [string])) {
                        foreach ($blk in @($content)) {
                            if ($null -eq $blk) { continue }
                            $bType = [string](Get-SafeProp $blk @('type') '')
                            if ($bType -eq 'tool_result') {
                                $blkErr = [bool](Get-SafeProp $blk @('is_error', 'isError') $false)
                                if (-not $blkErr) {
                                    $lastCompletedToolIdx = $i
                                }
                            }
                        }
                    }
                }
                if ($entryState.IsUser) { continue }

                $bodyText = Get-EntryText $parsed
                $isRl = ($null -ne $entryState.ApiErrStatus -and ([string]$entryState.ApiErrStatus).Trim() -eq '429') -or
                    ($entryState.ErrText -match '(?i)(rate[_\s-]?limit|billing_error|429|5h|5-hour|weekly limit|usage limit|overloaded|authentication_failed)') -or
                    ($entryState.IsEligible -and ($bodyText -match $script:RelayRatePattern))
                if ($isRl) {
                    $lastRateLimitIdx = $i
                }
            } elseif (Test-PartialJsonLineHasRateLimit $rawLine) {
                $lastRateLimitIdx = $i
            }
        }
    }
    if ($lastRateLimitIdx -ge 0 -and $lastCompletedToolIdx -ge 0 -and $lastRateLimitIdx -gt $lastCompletedToolIdx) {
        return 'tool_output_ready_wrapper_429'
    }
    if ($lastRateLimitIdx -ge 0) {
        return 'rate_limited'
    }
    return 'interrupted'
}

function Get-InterruptedSubagentsSummary {
    param(
        [string]$ClaudeDir,
        [string]$WorkingDir,
        [string]$SessionId,
        [string]$ContinuedSessionId = '',
        [datetime]$RunStartUtc = [DateTime]::MinValue,
        [switch]$AsItems
    )
    if (-not $ClaudeDir) { return '' }
    $cutoff = if ($RunStartUtc -gt [DateTime]::MinValue) { $RunStartUtc.AddSeconds(-5) } else { [DateTime]::MinValue }
    $sessionIds = New-Object System.Collections.Generic.List[string]
    foreach ($s in @($SessionId, $ContinuedSessionId)) {
        if ($s -and ($s.Trim()) -and ($sessionIds -notcontains $s.Trim())) {
            [void]$sessionIds.Add($s.Trim())
        }
    }
    if ($sessionIds.Count -eq 0) { return '' }

    $items = New-Object System.Collections.ArrayList
    $seenIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    $projRoot = Join-Path $ClaudeDir 'projects'
    if (Test-Path -LiteralPath $projRoot -PathType Container) {
        $slug = ConvertTo-ProjectSlug $WorkingDir
        $candidateDirs = @()
        if ($slug) {
            $sd = Join-Path $projRoot $slug
            if (Test-Path -LiteralPath $sd -PathType Container) {
                $candidateDirs += Get-Item -LiteralPath $sd
            }
        }
        $allDirs = @(Get-ChildItem -LiteralPath $projRoot -Directory -ErrorAction SilentlyContinue)
        foreach ($d in $allDirs) {
            if (-not ($candidateDirs | Where-Object { $_.FullName -ieq $d.FullName })) {
                $candidateDirs += $d
            }
        }

        foreach ($sid in $sessionIds) {
            foreach ($d in $candidateDirs) {
                $subDir = Join-Path (Join-Path $d.FullName $sid) 'subagents'
                if (-not (Test-Path -LiteralPath $subDir -PathType Container)) { continue }
                $subDirItem = Get-Item -LiteralPath $subDir -Force -ErrorAction SilentlyContinue
                if ($null -eq $subDirItem -or (($subDirItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { continue }

                $metaMap = @{}
                $jsonlMap = @{}
                foreach ($mf in @(Get-ChildItem -LiteralPath $subDir -Filter '*.meta.json' -File -ErrorAction SilentlyContinue)) {
                    if (($mf.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                    $stem = $mf.Name.Substring(0, $mf.Name.Length - '.meta.json'.Length)
                    $metaMap[$stem] = $mf
                }
                foreach ($jf in @(Get-ChildItem -LiteralPath $subDir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue)) {
                    if (($jf.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                    $stem = [IO.Path]::GetFileNameWithoutExtension($jf.Name)
                    $jsonlMap[$stem] = $jf
                }
                $allStems = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
                foreach ($k in $metaMap.Keys) { [void]$allStems.Add([string]$k) }
                foreach ($k in $jsonlMap.Keys) { [void]$allStems.Add([string]$k) }
                foreach ($stem in @($allStems | Sort-Object)) {
                    $mf = if ($metaMap.ContainsKey($stem)) { $metaMap[$stem] } else { $null }
                    $jf = if ($jsonlMap.ContainsKey($stem)) { $jsonlMap[$stem] } else { $null }
                    $finished = $false
                    $agentType = 'subagent'
                    $agentId = if ($stem -like 'agent-*') { $stem.Substring(6) } else { $stem }
                    if ($null -ne $mf) {
                        try {
                            $mObj = (Get-Content -LiteralPath $mf.FullName -Raw -Encoding UTF8) | ConvertFrom-Json
                            $finProp = Get-SafeProp $mObj @('finished') $null
                            if ($null -ne $finProp) { $finished = [bool]$finProp }
                            $at = ([string](Get-SafeProp $mObj @('agentType', 'agent_type', 'subagent_type') '')).Trim()
                            if ($at) { $agentType = $at }
                            $aid = ([string](Get-SafeProp $mObj @('agentId', 'agent_id', 'id') '')).Trim()
                            if ($aid) { $agentId = $aid }
                        } catch {}
                    }
                    $metaRecent = ($null -ne $mf -and $mf.LastWriteTimeUtc -ge $cutoff)
                    $jsonlRecent = ($null -ne $jf -and $jf.LastWriteTimeUtc -ge $cutoff)
                    if ((-not $metaRecent) -and (-not $jsonlRecent) -and $finished) {
                        continue
                    }
                    $jPath = if ($null -ne $jf) { $jf.FullName } else { '' }
                    $bucket = Classify-SubagentTranscript -JsonlPath $jPath -RunStartUtc $RunStartUtc
                    if ($finished -and $bucket -eq 'interrupted') {
                        continue
                    }
                    if ($seenIds.Add($agentId)) {
                        $safeType = [regex]::Replace($agentType, '[^\w\-\.:]', '')
                        if (-not $safeType) { $safeType = 'subagent' }
                        $safeId = [regex]::Replace($agentId, '[^\w\-]', '')
                        if (-not $safeId) { $safeId = 'unknown' }
                        $safePath = if ($jPath) { $jPath -replace '\\', '/' } else { '(no transcript)' }
                        [void]$items.Add(@{
                            Bucket         = $bucket
                            AgentId        = $safeId
                            AgentType      = $safeType
                            TranscriptPath = $safePath
                        })
                    }
                }
            }
        }
    }

    $jobsDir = Join-Path $ClaudeDir 'jobs'
    if (Test-Path -LiteralPath $jobsDir -PathType Container) {
        foreach ($jd in @(Get-ChildItem -LiteralPath $jobsDir -Directory -ErrorAction SilentlyContinue)) {
            if (($jd.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            $adoptPath = Join-Path $jd.FullName 'adopt.json'
            if (-not (Test-Path -LiteralPath $adoptPath -PathType Leaf)) { continue }
            try {
                $aItem = Get-Item -LiteralPath $adoptPath -Force -ErrorAction Stop
                if ((($aItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or ($aItem.Length -gt 524288)) { continue }
                $aObj = (Get-Content -LiteralPath $adoptPath -Raw -Encoding UTF8) | ConvertFrom-Json
                $refSids = New-Object System.Collections.Generic.List[string]
                foreach ($k in @('sessionId', 'session_id', 'parentSessionId', 'parent_session_id')) {
                    $v = ([string](Get-SafeProp $aObj @($k) '')).Trim()
                    if ($v) { [void]$refSids.Add($v) }
                }
                $sArr = Get-SafeProp $aObj @('sessions') $null
                if ($null -ne $sArr) {
                    foreach ($sv in @($sArr)) {
                        $svs = ([string]$sv).Trim()
                        if ($svs) { [void]$refSids.Add($svs) }
                    }
                }
                $matchesSession = $false
                foreach ($rs in $refSids) {
                    if ($sessionIds -contains $rs) { $matchesSession = $true; break }
                }
                if (-not $matchesSession) { continue }

                $agentsArr = Get-SafeProp $aObj @('agents') $null
                if ($null -ne $agentsArr) {
                    foreach ($ag in @($agentsArr)) {
                        $agFin = Get-SafeProp $ag @('finished') $null
                        $agStatus = ([string](Get-SafeProp $ag @('status') '')).Trim().ToLowerInvariant()
                        if (($null -ne $agFin -and [bool]$agFin) -or ($agStatus -in @('completed', 'done', 'finished'))) { continue }
                        $agId = ([string](Get-SafeProp $ag @('agentId', 'agent_id', 'id') '')).Trim()
                        if (-not $agId) { continue }
                        $safeId = [regex]::Replace($agId, '[^\w\-]', '')
                        if (-not $safeId -or (-not $seenIds.Add($safeId))) { continue }
                        $agType = ([string](Get-SafeProp $ag @('agentType', 'agent_type', 'type') 'subagent')).Trim()
                        $safeType = [regex]::Replace($agType, '[^\w\-\.:]', '')
                        if (-not $safeType) { $safeType = 'subagent' }
                        $agPath = ([string](Get-SafeProp $ag @('transcriptPath', 'transcript_path') '')).Trim()
                        $bucket = if ($agPath -and (Test-Path -LiteralPath $agPath -PathType Leaf)) {
                            Classify-SubagentTranscript -JsonlPath $agPath -RunStartUtc $RunStartUtc
                        } else {
                            'interrupted'
                        }
                        $safePath = if ($agPath) { $agPath -replace '\\', '/' } else { '(no transcript)' }
                        [void]$items.Add(@{
                            Bucket         = $bucket
                            AgentId        = $safeId
                            AgentType      = $safeType
                            TranscriptPath = $safePath
                        })
                    }
                }
            } catch {}
        }
    }

    if ($items.Count -eq 0) { return '' }
    if ($AsItems) { return ,@($items.ToArray()) }

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('[RELAY-SUBAGENT-RECOVERY]')
    $maxAgents = 12
    $shown = 0
    foreach ($it in $items) {
        if ($shown -ge $maxAgents) { break }
        $action = if ($it.Bucket -eq 'tool_output_ready_wrapper_429') {
            ("Read completed output from {0}; DO NOT re-run external agent." -f $it.TranscriptPath)
        } elseif ($it.Bucket -eq 'rate_limited') {
            ("Resume via Agent(resume: '{0}') or inspect {1} and finish remaining work (prefer pro-pool-worker if slots available)." -f $it.AgentId, $it.TranscriptPath)
        } else {
            ("Resume via Agent(resume: '{0}') or continue remaining steps." -f $it.AgentId)
        }
        $line = ("- [{0}] id={1} type={2} transcript={3} :: {4}" -f $it.Bucket, $it.AgentId, $it.AgentType, $it.TranscriptPath, $action)
        if (($sb.Length + $line.Length + 64) -gt 3000) {
            break
        }
        [void]$sb.AppendLine($line)
        $shown++
    }
    $remaining = $items.Count - $shown
    if ($remaining -gt 0) {
        $tail = ("- (+{0} more interrupted subagent(s) omitted)" -f $remaining)
        if (($sb.Length + $tail.Length + 4) -le 3000) {
            [void]$sb.AppendLine($tail)
        }
    }
    return $sb.ToString().TrimEnd()
}

$script:RelayHandoffModes = @('clean_handoff', 'fork_resume')
$script:CleanContinuationPrompt = "Continue the user's latest task in this fresh session. First read the relay handoff note named in your system prompt, then check existing files before deciding what remains. Do not repeat completed commands or external actions."

function Resolve-RelayHandoffMode {
    param([string]$Explicit = '', $Cfg = $null)
    foreach ($cand in @($Explicit, [string](Get-SafeProp $Cfg @('relayHandoffMode', 'relay_handoff_mode') ''))) {
        $c = ([string]$cand).Trim().ToLowerInvariant()
        if ($script:RelayHandoffModes -contains $c) { return $c }
    }
    return 'clean_handoff'
}

function Get-AntiBanBreatherMs {
    if ($env:CLAUDE_RELAY_TEST_FAST -eq '1') { return 0 }
    return [int](Get-Random -Minimum 6000 -Maximum 15000)
}

function Remove-HandoffSensitiveText {
    param([string]$Text, [string[]]$Literals = @(), [int]$MaxLen = 0)
    if ($null -eq $Text) { return '' }
    $t = [string]$Text
    foreach ($lit in @($Literals)) {
        if ($lit -and ([string]$lit).Trim().Length -ge 4) {
            $t = $t.Replace(([string]$lit).Trim(), '[id]')
        }
    }
    $t = [regex]::Replace($t, '(?i)\bsk-ant-[A-Za-z0-9_\-]+', '[token]')
    $t = [regex]::Replace($t, '(?i)\bBearer\s+[A-Za-z0-9._~+/=\-]{8,}', 'Bearer [token]')
    $t = [regex]::Replace($t, '\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]*', '[token]')
    $t = [regex]::Replace($t, '(?i)\b(?:srvtoolu|toolu|msg|req|sig)_[A-Za-z0-9]{4,}', '[id]')
    $t = [regex]::Replace($t, '(?i)\bagent-[0-9a-f]{6,}', 'agent-[id]')
    $t = [regex]::Replace($t, '(?i)\b(?:session|agent)_?id\b["'']?\s*[:=]\s*["'']?[A-Za-z0-9_\-]+["'']?', '[redacted]')
    $t = [regex]::Replace($t, '(?i)[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+', '[email]')
    $t = [regex]::Replace($t, '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', '[id]')
    $t = [regex]::Replace($t, '\b[0-9a-fA-F]{64}\b', '[redacted-hex]')
    $t = [regex]::Replace($t, '(?i)\b[0-9a-f]{32}\b', '[id]')
    $t = [regex]::Replace($t, '(?i)[^\s"'']*[\\/]\.claude[\\/]projects[\\/][^\s"'']*', '[transcript]')
    $t = [regex]::Replace($t, '(?i)[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'']+', '~')
    $t = [regex]::Replace($t, '(?i)/home/[^/\s"'']+', '~')
    if ($MaxLen -gt 0 -and $t.Length -gt $MaxLen) {
        $t = $t.Substring(0, $MaxLen).TrimEnd() + '...'
    }
    return $t
}

function Read-HandoffTextWindow {
    param([string]$Path, [int]$MaxBytes = 262144, [switch]$Head)
    $fs = $null
    try {
        $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $len = [int64]$fs.Length
        $take = [int][Math]::Min([int64]$MaxBytes, $len)
        $start = if ($Head) { [int64]0 } else { [int64]($len - $take) }
        [void]$fs.Seek($start, [System.IO.SeekOrigin]::Begin)
        $buf = New-Object byte[] $take
        $got = 0
        while ($got -lt $take) {
            $n = $fs.Read($buf, $got, ($take - $got))
            if ($n -le 0) { break }
            $got += $n
        }
        $text = (New-Object System.Text.UTF8Encoding($false)).GetString($buf, 0, $got)
        $parts = $text -split "`n"
        $lines = New-Object System.Collections.Generic.List[string]
        for ($i = 0; $i -lt $parts.Length; $i++) {
            if ((-not $Head) -and ($start -gt 0) -and ($i -eq 0)) { continue }
            if ($Head -and ($len -gt $take) -and ($i -eq ($parts.Length - 1))) { continue }
            $ln = ([string]$parts[$i]).TrimEnd("`r")
            if ($ln.Trim()) { [void]$lines.Add($ln) }
        }
        return [string[]]$lines.ToArray()
    } catch {
        return [string[]]@()
    } finally {
        if ($null -ne $fs) { $fs.Dispose() }
    }
}

function Get-HandoffTranscriptDigest {
    param([string]$JsonlPath, [string]$WorkingDir = '', [string[]]$Literals = @())
    $digest = @{ FirstPrompt = ''; LastPrompt = ''; Progress = @(); Files = @(); LastToolResult = '' }
    if ((-not $JsonlPath) -or (-not (Test-Path -LiteralPath $JsonlPath -PathType Leaf))) { return $digest }
    $item = Get-Item -LiteralPath $JsonlPath -Force -ErrorAction SilentlyContinue
    if ($null -eq $item -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $digest }

    $editTools = @('Edit', 'Write', 'MultiEdit', 'NotebookEdit')
    $wd = ''
    if ($WorkingDir) { $wd = ($WorkingDir -replace '\\', '/').TrimEnd('/') }
    $firstPrompt = ''
    $lastPrompt = ''
    $progress = New-Object System.Collections.Generic.List[string]
    $files = New-Object System.Collections.Generic.List[string]
    $lastToolResult = ''

    $headLines = @(Read-HandoffTextWindow -Path $JsonlPath -MaxBytes 16384 -Head)
    $tailLines = @(Read-HandoffTextWindow -Path $JsonlPath -MaxBytes 262144)
    $scanSets = @(
        @{ Lines = $headLines; HeadOnly = $true },
        @{ Lines = $tailLines; HeadOnly = $false }
    )
    foreach ($set in $scanSets) {
        foreach ($ln in $set.Lines) {
            $obj = $null
            try { $obj = $ln | ConvertFrom-Json } catch { $obj = $null }
            if ($null -eq $obj) { continue }
            if ([bool](Get-SafeProp $obj @('isApiErrorMessage') $false)) { continue }
            $recType = [string](Get-SafeProp $obj @('type') '')
            if ($recType -ne 'user' -and $recType -ne 'assistant') { continue }
            $msg = Get-SafeProp $obj @('message') $obj
            $content = Get-SafeProp $msg @('content') $null
            $texts = New-Object System.Collections.Generic.List[string]
            if ($content -is [string]) {
                if ($content.Trim()) { [void]$texts.Add($content) }
            } elseif ($null -ne $content) {
                foreach ($blk in @($content)) {
                    if ($null -eq $blk) { continue }
                    $bType = [string](Get-SafeProp $blk @('type') '')
                    if ($bType -eq 'text') {
                        $bt = [string](Get-SafeProp $blk @('text') '')
                        if ($bt.Trim()) { [void]$texts.Add($bt) }
                    } elseif ($bType -eq 'tool_use' -and $recType -eq 'assistant' -and (-not $set.HeadOnly)) {
                        $tName = [string](Get-SafeProp $blk @('name') '')
                        if ($editTools -contains $tName) {
                            $inp = Get-SafeProp $blk @('input') $null
                            $fp = [string](Get-SafeProp $inp @('file_path', 'notebook_path', 'path') '')
                            if ($fp) {
                                $fpn = $fp -replace '\\', '/'
                                if ($wd -and $fpn.StartsWith($wd + '/', [StringComparison]::OrdinalIgnoreCase)) {
                                    $fpn = $fpn.Substring($wd.Length + 1)
                                } elseif ([IO.Path]::IsPathRooted($fp)) {
                                    $fpn = [IO.Path]::GetFileName($fp)
                                }
                                $fpn = Remove-HandoffSensitiveText -Text $fpn -Literals $Literals -MaxLen 160
                                if ($fpn -and ($files -notcontains $fpn)) { [void]$files.Add($fpn) }
                            }
                        }
                    } elseif ($bType -eq 'tool_result' -and $recType -eq 'user' -and (-not $set.HeadOnly)) {
                        $rc = Get-SafeProp $blk @('content') $null
                        $rText = ''
                        if ($rc -is [string]) {
                            $rText = $rc
                        } elseif ($null -ne $rc) {
                            $rParts = New-Object System.Collections.Generic.List[string]
                            foreach ($rb in @($rc)) {
                                $rbt = [string](Get-SafeProp $rb @('text') '')
                                if ($rbt) { [void]$rParts.Add($rbt) }
                            }
                            $rText = ($rParts -join ' ')
                        }
                        if ($rText.Trim()) { $lastToolResult = $rText }
                    }
                }
            }
            if ($texts.Count -eq 0) { continue }
            $joined = ($texts -join ' ').Trim()
            if ($recType -eq 'user') {
                if ($joined -match '^(?i)\s*<(?:system-reminder|command-name|command-message|local-command|ide_)') { continue }
                if (-not $firstPrompt) { $firstPrompt = $joined }
                if (-not $set.HeadOnly) { $lastPrompt = $joined }
            } elseif (-not $set.HeadOnly) {
                [void]$progress.Add($joined)
            }
        }
    }
    $rawRecent = @($progress.ToArray() | Select-Object -Last 3)
    $recentList = New-Object System.Collections.Generic.List[string]
    for ($pIdx = 0; $pIdx -lt $rawRecent.Count; $pIdx++) {
        $pLimit = if ($pIdx -eq ($rawRecent.Count - 1)) { 1200 } else { 600 }
        [void]$recentList.Add((Remove-HandoffSensitiveText -Text ([string]$rawRecent[$pIdx]) -Literals $Literals -MaxLen $pLimit))
    }
    $recentProgress = [string[]]$recentList.ToArray()
    $digest.FirstPrompt = Remove-HandoffSensitiveText -Text $firstPrompt -Literals $Literals -MaxLen 1200
    $digest.LastPrompt = if ($lastPrompt -and $lastPrompt -ne $firstPrompt) { Remove-HandoffSensitiveText -Text $lastPrompt -Literals $Literals -MaxLen 800 } else { '' }
    $digest.Progress = $recentProgress
    $digest.Files = @($files.ToArray() | Select-Object -Last 20)
    $digest.LastToolResult = Remove-HandoffSensitiveText -Text $lastToolResult -Literals $Literals -MaxLen 2048
    return $digest
}

function Write-LocalRelayHandoff {
    param(
        [string]$HandoffDir,
        [string]$JsonlPath = '',
        [string]$WorkingDir = '',
        [object[]]$SubagentItems = @(),
        [string[]]$Literals = @()
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $outDir = Join-Path $HandoffDir 'subagent-outputs'
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    foreach ($stale in @(Get-ChildItem -LiteralPath $outDir -Filter 'sub-*.md' -File -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $stale.FullName -Force -ErrorAction SilentlyContinue
    }
    $digest = Get-HandoffTranscriptDigest -JsonlPath $JsonlPath -WorkingDir $WorkingDir -Literals $Literals

    $nl = "`n"
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('# Relay handoff (fresh session)' + $nl + $nl)
    [void]$sb.Append('Scrubbed local digest: no session ids, account identifiers, tokens, request ids or thinking blocks.' + $nl + $nl)
    [void]$sb.Append('## Original task' + $nl)
    [void]$sb.Append($(if ($digest.FirstPrompt) { $digest.FirstPrompt } else { '(not recorded)' }) + $nl + $nl)
    if ($digest.LastPrompt) {
        [void]$sb.Append('## Latest request' + $nl + $digest.LastPrompt + $nl + $nl)
    }
    [void]$sb.Append('## Recent progress' + $nl)
    if (@($digest.Progress).Count -gt 0) {
        foreach ($pg in @($digest.Progress)) { [void]$sb.Append('- ' + (($pg -replace '\s+', ' ').Trim()) + $nl) }
    } else {
        [void]$sb.Append('- (none recorded)' + $nl)
    }
    [void]$sb.Append($nl + '## Files touched (relative)' + $nl)
    if (@($digest.Files).Count -gt 0) {
        foreach ($f in @($digest.Files)) { [void]$sb.Append('- ' + $f + $nl) }
    } else {
        [void]$sb.Append('- (none recorded)' + $nl)
    }

    [void]$sb.Append($nl + '## Subagents' + $nl)
    $subIdx = 0
    $totalBytes = 0
    foreach ($it in @($SubagentItems)) {
        if ($subIdx -ge 12) { break }
        if ($null -eq $it) { continue }
        $subIdx++
        $label = ('sub-{0:00}' -f $subIdx)
        $safeType = [regex]::Replace([string](Get-SafeProp $it @('AgentType') 'subagent'), '[^A-Za-z\-\.:]', '')
        if (-not $safeType) { $safeType = 'subagent' }
        $bucket = [string](Get-SafeProp $it @('Bucket') 'interrupted')
        $wrote = $false
        if ($bucket -eq 'tool_output_ready_wrapper_429') {
            $tPath = [string](Get-SafeProp $it @('TranscriptPath') '')
            if ($tPath -and $tPath -ne '(no transcript)') {
                $sd = Get-HandoffTranscriptDigest -JsonlPath $tPath -WorkingDir $WorkingDir -Literals $Literals
                $outText = if ($sd.LastToolResult) { $sd.LastToolResult } elseif (@($sd.Progress).Count -gt 0) { [string]@($sd.Progress)[-1] } else { '' }
                $outText = Remove-HandoffSensitiveText -Text $outText -Literals $Literals -MaxLen 2048
                if ($outText -and (($totalBytes + $outText.Length) -le 24576)) {
                    $totalBytes += $outText.Length
                    [System.IO.File]::WriteAllText((Join-Path $outDir ($label + '.md')), ($outText + $nl), $utf8NoBom)
                    $wrote = $true
                }
            }
        }
        if ($wrote) {
            [void]$sb.Append(('- {0} ({1}, output ready): read subagent-outputs/{0}.md directly; do NOT re-run this worker.' -f $label, $safeType) + $nl)
        } else {
            [void]$sb.Append(('- {0} ({1}, interrupted): spawn a fresh independent subagent from scratch for this task; never resume an earlier subagent by id.' -f $label, $safeType) + $nl)
        }
    }
    if ($subIdx -eq 0) { [void]$sb.Append('- (none)' + $nl) }

    [void]$sb.Append($nl + '## Rules' + $nl)
    [void]$sb.Append('- This is a fresh session on a different account: there is no prior conversation to resume.' + $nl)
    [void]$sb.Append('- Verify the working tree before repeating any step; keep completed work.' + $nl)

    $mdPath = Join-Path $HandoffDir 'latest-handoff.md'
    $tmpPath = $mdPath + '.' + $PID + '.tmp'
    [System.IO.File]::WriteAllText($tmpPath, $sb.ToString(), $utf8NoBom)
    Move-Item -LiteralPath $tmpPath -Destination $mdPath -Force
    return @{ MdPath = $mdPath; Dir = $HandoffDir; Source = 'local' }
}

function Resolve-RelayHandoffFiles {
    param(
        $SwitchResp,
        [string]$AppDataDir,
        [string]$JsonlPath = '',
        [string]$WorkingDir = '',
        [object[]]$SubagentItems = @(),
        [string[]]$Literals = @()
    )
    $native = ([string](Get-SafeProp $SwitchResp @('handoff_md_path', 'handoffMdPath') '')).Trim()
    if ($native -and [IO.Path]::IsPathRooted($native) -and (Test-Path -LiteralPath $native -PathType Leaf)) {
        return @{ MdPath = $native; Dir = (Split-Path -Parent $native); Source = 'native' }
    }
    $dir = if ($AppDataDir) { Join-Path $AppDataDir 'handoff' } else { Join-Path ([IO.Path]::GetTempPath()) 'cl-relay-handoff' }
    try {
        return (Write-LocalRelayHandoff -HandoffDir $dir -JsonlPath $JsonlPath -WorkingDir $WorkingDir -SubagentItems $SubagentItems -Literals $Literals)
    } catch {
        return $null
    }
}

function Build-RelayHandoffNote {
    param([string]$MdPath = '')
    if (-not $MdPath) {
        return '[RELAY-HANDOFF] This is a fresh session continuing earlier work that ran on another account; the earlier conversation is not available. Verify the working tree before repeating any step, and spawn any needed subagent from scratch as a new independent task; never try to resume an earlier subagent or session by id.'
    }
    $outDir = Join-Path (Split-Path -Parent $MdPath) 'subagent-outputs'
    return ('[RELAY-HANDOFF] This is a fresh session continuing earlier work that ran on another account. Read the scrubbed handoff note first (path: {0}). If it lists completed external worker outputs, read the matching sub-NN.md under {1} directly instead of re-running that worker. Re-spawn any interrupted subagent cleanly from scratch as a new independent task; never try to resume an earlier subagent or session by id. Verify the working tree before repeating any step.' -f $MdPath, $outDir)
}

function Add-AppendSystemPromptNote {
    param([string[]]$ArgList, [string]$Note)
    $out = New-Object System.Collections.Generic.List[string]
    $merged = $false
    $list = New-Object System.Collections.Generic.List[string]
    if ($null -ne $ArgList) {
        foreach ($argItem in $ArgList) { [void]$list.Add([string]$argItem) }
    }
    for ($i = 0; $i -lt $list.Count; $i++) {
        $a = [string]$list[$i]
        if ((-not $merged) -and $a -eq '--append-system-prompt' -and ($i + 1 -lt $list.Count)) {
            [void]$out.Add($a)
            [void]$out.Add(([string]$list[$i + 1] + ' ' + $Note))
            $i++
            $merged = $true
            continue
        }
        if ((-not $merged) -and $a -like '--append-system-prompt=*') {
            [void]$out.Add($a + ' ' + $Note)
            $merged = $true
            continue
        }
        [void]$out.Add($a)
    }
    if (-not $merged) {
        [void]$out.Add('--append-system-prompt')
        [void]$out.Add($Note)
    }
    return [string[]]$out.ToArray()
}

function Find-TranscriptBySessionId {
    param([string]$ClaudeDir, [string]$SessionId, [string]$PreferredPath = '')
    if ($PreferredPath -and (Test-Path -LiteralPath $PreferredPath -PathType Leaf) -and (([IO.Path]::GetFileNameWithoutExtension($PreferredPath)) -eq $SessionId)) {
        return $PreferredPath
    }
    if ((-not $SessionId) -or ($SessionId -notmatch '^[A-Za-z0-9][A-Za-z0-9_\-]{3,127}$')) { return '' }
    $projRoot = Join-Path $ClaudeDir 'projects'
    if (-not (Test-Path -LiteralPath $projRoot -PathType Container)) { return '' }
    foreach ($d in @(Get-ChildItem -LiteralPath $projRoot -Directory -ErrorAction SilentlyContinue)) {
        if (($d.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        $cand = Join-Path $d.FullName ($SessionId + '.jsonl')
        if (Test-Path -LiteralPath $cand -PathType Leaf) { return $cand }
    }
    return ''
}

function Remove-TranscriptForkMarkers {
    param($Node)
    if ($null -eq $Node) { return $null }
    if ($Node -is [string]) {
        if ($Node -match '(?i)<system-reminder>') {
            $kept = @(($Node -split "`n") | Where-Object { $_ -notmatch '[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+' })
            return ($kept -join "`n")
        }
        return $Node
    }
    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($drop in @('signature', 'credential_org', 'accountUuid', 'organizationUuid', 'emailAddress')) {
            if ($null -ne $Node.PSObject.Properties[$drop]) { $Node.PSObject.Properties.Remove($drop) }
        }
        foreach ($prop in @($Node.PSObject.Properties)) {
            $Node.($prop.Name) = Remove-TranscriptForkMarkers $prop.Value
        }
        return $Node
    }
    if ($Node -is [System.Collections.IList]) {
        $outList = New-Object System.Collections.ArrayList
        foreach ($el in $Node) {
            if ($el -is [System.Management.Automation.PSCustomObject]) {
                $elType = [string](Get-SafeProp $el @('type') '')
                if ($elType -eq 'thinking' -or $elType -eq 'redacted_thinking') { continue }
            }
            [void]$outList.Add((Remove-TranscriptForkMarkers $el))
        }
        return ,($outList.ToArray())
    }
    return $Node
}

function New-ScrubbedForkTranscript {
    param([string]$SourceJsonl)
    if ((-not $SourceJsonl) -or (-not (Test-Path -LiteralPath $SourceJsonl -PathType Leaf))) { return $null }
    $srcItem = Get-Item -LiteralPath $SourceJsonl -Force -ErrorAction SilentlyContinue
    if ($null -eq $srcItem -or (($srcItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $null }
    $newId = [guid]::NewGuid().ToString()
    $destPath = Join-Path (Split-Path -Parent $SourceJsonl) ($newId + '.jsonl')
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $writer = $null
    $reader = $null
    $kept = 0
    try {
        $reader = New-Object System.IO.StreamReader($SourceJsonl, $utf8NoBom, $true)
        $writer = New-Object System.IO.StreamWriter($destPath, $false, $utf8NoBom)
        while ($null -ne ($ln = $reader.ReadLine())) {
            if (-not $ln.Trim()) { continue }
            $obj = $null
            try { $obj = $ln | ConvertFrom-Json } catch { $obj = $null }
            if ($null -eq $obj) { continue }
            $recType = [string](Get-SafeProp $obj @('type') '')
            if ($recType -eq 'session-owner') { continue }
            if ([bool](Get-SafeProp $obj @('isApiErrorMessage') $false)) { continue }
            $clean = Remove-TranscriptForkMarkers $obj
            if ($null -ne $clean.PSObject.Properties['sessionId']) { $clean.sessionId = $newId }
            $outLine = ($clean | ConvertTo-Json -Depth 64 -Compress)
            $writer.Write($outLine + "`n")
            if ($recType -eq 'user' -or $recType -eq 'assistant') { $kept++ }
        }
    } catch {
        $kept = 0
    } finally {
        if ($null -ne $writer) { $writer.Dispose() }
        if ($null -ne $reader) { $reader.Dispose() }
    }
    if ($kept -le 0) {
        Remove-Item -LiteralPath $destPath -Force -ErrorAction SilentlyContinue
        return $null
    }
    return @{ SessionId = $newId; Path = $destPath }
}

function Test-StatusProactiveEligible {
    param(
        $StatusResp,
        [switch]$RequireExplicitTargets
    )
    if ($null -eq $StatusResp -or (-not [bool](Get-SafeProp $StatusResp @('ok') $false))) {
        return $false
    }
    if (-not [bool](Get-SafeProp $StatusResp @('should_relay_now') $false)) {
        return $false
    }
    $kind = [string](Get-SafeProp $StatusResp @('relay_trigger_kind', 'relayTriggerKind') '')
    if ($kind -notin @('threshold_reached', 'awaiting_manual_reset', 'current_spent')) {
        return $false
    }
    if ($null -ne $StatusResp.PSObject.Properties['ranked_auto_targets']) {
        return (($null -ne $StatusResp.ranked_auto_targets) -and (@($StatusResp.ranked_auto_targets).Count -gt 0))
    }
    if ($null -ne $StatusResp.PSObject.Properties['rankedAutoTargets']) {
        return (($null -ne $StatusResp.rankedAutoTargets) -and (@($StatusResp.rankedAutoTargets).Count -gt 0))
    }
    return (-not [bool]$RequireExplicitTargets)
}

function Clear-ProactiveRelayStateFiles {
    param(
        [string]$ThresholdArmedPath,
        [string]$ProactiveStatePath
    )
    if ($ThresholdArmedPath -and (Test-Path -LiteralPath $ThresholdArmedPath -PathType Leaf)) {
        Remove-Item -LiteralPath $ThresholdArmedPath -Force -ErrorAction SilentlyContinue
    }
    if ($ProactiveStatePath -and (Test-Path -LiteralPath $ProactiveStatePath -PathType Leaf)) {
        Remove-Item -LiteralPath $ProactiveStatePath -Force -ErrorAction SilentlyContinue
    }
}

function Get-ExternalWorkerTimeoutSec {
    $timeoutSec = 300.0
    if ($env:CLAUDE_RELAY_TEST_FAST -eq '1' -and $env:CLAUDE_RELAY_TEST_EXT_TIMEOUT_SEC) {
        $parsedSec = 0.0
        if ([double]::TryParse($env:CLAUDE_RELAY_TEST_EXT_TIMEOUT_SEC, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsedSec) -and $parsedSec -gt 0.0) {
            $timeoutSec = $parsedSec
        }
    }
    return $timeoutSec
}

function Invoke-ClaudeRelayChild {
    param(
        [string]$ClaudeExe,
        [string]$ClaudeLocalExe,
        [string[]]$ArgList,
        [int]$EffectiveThreshold,
        [string]$EffectiveStrategy,
        [bool]$MonitorAutoExit,
        [string]$TriggerPath,
        [string]$TurnEndPath,
        [string]$ProactiveStatePath = '',
        [string]$ThresholdArmedPath = '',
        [string]$ClaudeDir,
        [string]$AppDataDir = '',
        [datetime]$RunStartUtc,
        [string]$KnownSessionId,
        [string]$ResolvedProxy = '',
        [hashtable]$PreRunOffsets = @{},
        [string]$StandbyLabel = 'next'
    )
    $scrubRelayEnvKeys = @(
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'CLAUDE_CONFIG_DIR',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
        'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_USE_VERTEX',
        'CLAUDE_CODE_USE_FOUNDRY',
        'CLAUDE_CODE_USE_GATEWAY',
        'CLAUDE_CODE_SIMPLE',
        'CLAUDECODE',
        'CLAUDE_CODE_ENTRYPOINT'
    )
    $proxyEnvKeys = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'GRPC_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'grpc_proxy')
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $argString = Format-WinCmdLine $ArgList
    if ($ClaudeExe -match '\.(cmd|bat)$') {
        $psi.FileName = if ($env:ComSpec) { $env:ComSpec } else { 'cmd.exe' }
        $inner = (Format-WinCmdArg $ClaudeExe) + $(if ($argString) { ' ' + $argString } else { '' })
        $psi.Arguments = '/d /s /c "' + $inner + '"'
    } elseif ($ClaudeExe -match '\.ps1$') {
        $psHost = (Get-Process -Id $PID).Path
        $psi.FileName = if ($psHost) { $psHost } else { 'powershell.exe' }
        $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File ' + (Format-WinCmdArg $ClaudeExe) + $(if ($argString) { ' ' + $argString } else { '' })
    } else {
        $psi.FileName = $ClaudeExe
        $psi.Arguments = $argString
    }
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $false
    $psi.RedirectStandardInput = $false
    $psi.RedirectStandardOutput = $false
    $psi.RedirectStandardError = $false
    foreach ($scrubKey in $scrubRelayEnvKeys) {
        $psi.Environment.Remove($scrubKey) | Out-Null
    }
    foreach ($pKey in $proxyEnvKeys) {
        $psi.Environment.Remove($pKey) | Out-Null
    }
    $normalizedProxy = Normalize-HttpProxyUri $ResolvedProxy
    if ($normalizedProxy) {
        foreach ($pKey in $proxyEnvKeys) {
            $psi.Environment[$pKey] = $normalizedProxy
        }
    }
    $psi.Environment['NO_PROXY'] = 'localhost,127.0.0.1,::1'
    $psi.Environment['no_proxy'] = 'localhost,127.0.0.1,::1'
    $psi.Environment['DISABLE_TELEMETRY'] = '1'
    $psi.Environment['DISABLE_ERROR_REPORTING'] = '1'
    $psi.Environment['DO_NOT_TRACK'] = '1'
    $psi.Environment['CLAUDE_LOCAL_RELAY_ACTIVE'] = '1'
    $psi.Environment['CLAUDE_LOCAL_RELAY_THRESHOLD'] = [string]$EffectiveThreshold

    $cancelHandler = [ConsoleCancelEventHandler]{
        param($sender, $eventArgs)
        $eventArgs.Cancel = $true
    }
    $cancelRegistered = $false
    try {
        [Console]::add_CancelKeyPress($cancelHandler)
        $cancelRegistered = $true
    } catch {}

    $ledgerPath = if ($AppDataDir) { Join-Path $AppDataDir 'quota_ledger.json' } else { '' }
    $lastLedgerStamp = ''
    if ($ledgerPath -and (Test-Path -LiteralPath $ledgerPath -PathType Leaf)) {
        try {
            $li = Get-Item -LiteralPath $ledgerPath -Force -ErrorAction Stop
            if (($li.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
                $lastLedgerStamp = ('{0}:{1}' -f $li.LastWriteTimeUtc.Ticks, $li.Length)
            }
        } catch {}
    }

    $proc = $null
    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        if ($null -eq $proc) {
            throw ("Failed to start claude.exe: " + $ClaudeExe)
        }
        $childPid = $proc.Id
        $childStartUtc = $null
        try { $childStartUtc = $proc.StartTime.ToUniversalTime() } catch {}
        $pendingExitInjection = $false
        $cleanThresholdTriggered = $false
        $proactiveHandoffTriggered = $false
        $proactiveExitFallback = $false
        $rateLimitTriggered = $false
        $liveDetectedRateLimit = $false
        $printedLiveHint = $false
        $sawAutoContinueNotice = $false
        $hasBackgroundWork = $false
        $waitingExternalLogged = $false
        $externalWaitStartUtc = [DateTime]::MinValue
        $turnEndExternalDeferred = $false
        $turnEndBgObserved = $false
        $turnEndBgSawMeta = $false
        $extWaitTimedOutFinal = $false
        $forcedStopTriggered = $false
        $extWaitTimeoutSec = Get-ExternalWorkerTimeoutSec
        $discoveredSessionId = ''
        $lastKnownJsonl = ''
        $injectAttempts = 0
        $sentBgChoice = $false
        $bgChoiceSentCount = 0
        $bgChoiceGraceUntilUtc = [DateTime]::MinValue
        $cookedWaitLogged = $false
        $sentExitCommand = $false
        $lastInjectUtc = [DateTime]::MinValue
        $timedOutLogged = $false
        $lastTimeoutPollUtc = [DateTime]::MinValue
        $tickCount = 0
        $retryDelaysMs = @(2500, 3500, 4500, 5500, 6500, 8000)
        $workDir = (Get-Location).Path

        while (-not $proc.WaitForExit(250)) {
            $sameChild = $false
            try {
                $liveProc = [System.Diagnostics.Process]::GetProcessById($childPid)
                if (-not $liveProc.HasExited) {
                    if ($null -eq $childStartUtc -or [Math]::Abs(($liveProc.StartTime.ToUniversalTime() - $childStartUtc).TotalSeconds) -lt 1.0) {
                        $sameChild = $true
                    }
                }
                $liveProc.Dispose()
            } catch {}
            if (-not $sameChild) { continue }

            $tickCount++
            if ((($tickCount % 8) -eq 0) -and (-not $rateLimitTriggered)) {
                $pollSess = Find-ActiveSession -ClaudeDir $ClaudeDir -RunStartUtc $RunStartUtc -WorkingDir $workDir -FallbackSessionId $KnownSessionId -ChildPid $childPid
                if ($pollSess.SessionId -and (-not $discoveredSessionId)) {
                    $discoveredSessionId = $pollSess.SessionId
                }
                if ($pollSess.JsonlPath) {
                    $lastKnownJsonl = $pollSess.JsonlPath
                    $pollOffset = if ($PreRunOffsets -and $PreRunOffsets.ContainsKey($pollSess.JsonlPath)) {
                        [int64]$PreRunOffsets[$pollSess.JsonlPath]
                    } else {
                        [int64]0
                    }
                    if (Test-TranscriptRateLimited -JsonlPath $pollSess.JsonlPath -StartOffset $pollOffset -RunStartUtc $RunStartUtc -PreRunOffsets $PreRunOffsets) {
                        $liveDetectedRateLimit = $true
                        if (Test-TranscriptAutoContinueNotice -JsonlPath $pollSess.JsonlPath -StartOffset $pollOffset -RunStartUtc $RunStartUtc) {
                            $sawAutoContinueNotice = $true
                        }
                        if (-not $MonitorAutoExit) {
                            if (-not $printedLiveHint) {
                                $printedLiveHint = $true
                                Write-Host '[Claude-Local Relay] Rate limit detected in live session; press Esc and type /exit (or Ctrl+C) to relay.'
                            }
                        } else {
                            $rateLimitTriggered = $true
                            if ($cleanThresholdTriggered) {
                                $cleanThresholdTriggered = $false
                                $proactiveHandoffTriggered = $false
                                $pendingExitInjection = $false
                                $injectAttempts = 0
                                $sentBgChoice = $false
                                $bgChoiceSentCount = 0
                                $bgChoiceGraceUntilUtc = [DateTime]::MinValue
                                $cookedWaitLogged = $false
                                $sentExitCommand = $false
                                $lastInjectUtc = [DateTime]::MinValue
                            }
                        }
                    }
                }
            }

            if (-not $MonitorAutoExit) { continue }

            if (((-not $rateLimitTriggered) -or $cleanThresholdTriggered) -and $TriggerPath -and (Test-Path -LiteralPath $TriggerPath -PathType Leaf)) {
                $trig = Read-RelayTrigger $TriggerPath
                if ($trig.Reason -eq 'rate_limit') {
                    if ($TurnEndPath -and (Test-Path -LiteralPath $TurnEndPath -PathType Leaf)) {
                        Remove-Item -LiteralPath $TurnEndPath -Force -ErrorAction SilentlyContinue
                    }
                    if ($trig.SessionId) { $discoveredSessionId = $trig.SessionId }
                    if ($trig.HasBg) { $hasBackgroundWork = $true }
                    $tPath = if ($trig.TranscriptPath -and (Test-Path -LiteralPath $trig.TranscriptPath -PathType Leaf)) {
                        $trig.TranscriptPath
                    } else {
                        (Find-ActiveSession -ClaudeDir $ClaudeDir -RunStartUtc $RunStartUtc -WorkingDir $workDir -FallbackSessionId $KnownSessionId -ChildPid $childPid).JsonlPath
                    }
                    if ($tPath) {
                        $lastKnownJsonl = $tPath
                        $tOffset = if ($PreRunOffsets -and $PreRunOffsets.ContainsKey($tPath)) { [int64]$PreRunOffsets[$tPath] } else { [int64]0 }
                        if (Test-TranscriptAutoContinueNotice -JsonlPath $tPath -StartOffset $tOffset -RunStartUtc $RunStartUtc) {
                            $sawAutoContinueNotice = $true
                        }
                    }
                    $rateLimitTriggered = $true
                    $liveDetectedRateLimit = $true
                    if ($cleanThresholdTriggered) {
                        $cleanThresholdTriggered = $false
                        $proactiveHandoffTriggered = $false
                        $pendingExitInjection = $false
                        $injectAttempts = 0
                        $sentBgChoice = $false
                        $bgChoiceSentCount = 0
                        $bgChoiceGraceUntilUtc = [DateTime]::MinValue
                        $cookedWaitLogged = $false
                        $sentExitCommand = $false
                        $lastInjectUtc = [DateTime]::MinValue
                    }
                }
            }

            if ((($tickCount % 2) -eq 0) -and (-not $rateLimitTriggered) -and (-not $pendingExitInjection) -and ($EffectiveThreshold -lt 100) -and $ledgerPath -and (Test-Path -LiteralPath $ledgerPath -PathType Leaf)) {
                $curLedgerStamp = ''
                try {
                    $li = Get-Item -LiteralPath $ledgerPath -Force -ErrorAction Stop
                    if (($li.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
                        $curLedgerStamp = ('{0}:{1}' -f $li.LastWriteTimeUtc.Ticks, $li.Length)
                    }
                } catch {
                    $curLedgerStamp = ''
                }
                if ($curLedgerStamp -and ($curLedgerStamp -ne $lastLedgerStamp)) {
                    $stArmed = $null
                    try {
                        $stArmed = Invoke-Orchestrate $ClaudeLocalExe (Build-StatusRequest $EffectiveStrategy $EffectiveThreshold)
                    } catch {
                        $stArmed = $null
                    }
                    if ($null -ne $stArmed -and [bool](Get-SafeProp $stArmed @('ok') $false)) {
                        $lastLedgerStamp = $curLedgerStamp
                        if (Test-StatusProactiveEligible -StatusResp $stArmed -RequireExplicitTargets) {
                            $armKind = [string](Get-SafeProp $stArmed @('relay_trigger_kind', 'relayTriggerKind') '')
                            $curUsed5h = $null
                            $curUsed7d = $null
                            $curAcctId = [string](Get-SafeProp $stArmed @('active') '')
                            $acctsArr = Get-SafeProp $stArmed @('accounts') $null
                            if ($null -ne $acctsArr) {
                                foreach ($ac in @($acctsArr)) {
                                    if ([bool](Get-SafeProp $ac @('is_current', 'isCurrent') $false)) {
                                        $u5Raw = Get-SafeProp $ac @('used_5h', 'used5h') $null
                                        $u7Raw = Get-SafeProp $ac @('used_7d', 'used7d') $null
                                        if ($null -ne $u5Raw) {
                                            $curUsed5h = [int]$u5Raw
                                        } elseif (-not [bool](Get-SafeProp $ac @('no_5h_limit', 'quota_no_5h_limit') $false)) {
                                            $r5Raw = Get-SafeProp $ac @('rem_5h', 'rem5h') $null
                                            if ($null -ne $r5Raw) { $curUsed5h = [Math]::Max(0, 100 - [int]$r5Raw) }
                                        }
                                        if ($null -ne $u7Raw) {
                                            $curUsed7d = [int]$u7Raw
                                        } else {
                                            $r7Raw = Get-SafeProp $ac @('rem_7d', 'rem7d') $null
                                            if ($null -ne $r7Raw) { $curUsed7d = [Math]::Max(0, 100 - [int]$r7Raw) }
                                        }
                                        if (-not $curAcctId) {
                                            $curAcctId = [string](Get-SafeProp $ac @('id', 'record_id') '')
                                        }
                                        break
                                    }
                                }
                            }
                            $hardCapPct = if ($EffectiveThreshold -ge 98) { [Math]::Min($EffectiveThreshold + 1, 99) } else { [Math]::Min($EffectiveThreshold + 5, 97) }
                            $standbyName = Get-BestStandbyLabel -StatusResp $stArmed -ExcludeRecordId $curAcctId
                            if (-not $standbyName -or $standbyName -eq '(none)') {
                                $standbyName = if ($StandbyLabel -and $StandbyLabel -ne '(none)') { $StandbyLabel } else { 'next' }
                            }
                            if ($ThresholdArmedPath) {
                                Write-RelayAtomicJsonFile -Path $ThresholdArmedPath -Obj ([ordered]@{
                                    armed         = $true
                                    threshold_pct = [int]$EffectiveThreshold
                                    hard_cap_pct  = [int]$hardCapPct
                                    used_5h       = $curUsed5h
                                    used_7d       = $curUsed7d
                                    standby_name  = [string]$standbyName
                                    trigger_kind  = [string]$armKind
                                    ts_ms         = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                                })
                            }
                        } else {
                            Clear-ProactiveRelayStateFiles -ThresholdArmedPath $ThresholdArmedPath -ProactiveStatePath $ProactiveStatePath
                        }
                    }
                }
            }

            if ($rateLimitTriggered -and (-not $pendingExitInjection)) {
                if (-not $lastKnownJsonl) {
                    $resolvedSess = Find-ActiveSession -ClaudeDir $ClaudeDir -RunStartUtc $RunStartUtc -WorkingDir $workDir -FallbackSessionId $KnownSessionId -ChildPid $childPid
                    if ($resolvedSess.JsonlPath) { $lastKnownJsonl = $resolvedSess.JsonlPath }
                    if ($resolvedSess.SessionId -and (-not $discoveredSessionId)) { $discoveredSessionId = $resolvedSess.SessionId }
                }
                if (Test-HasActiveExternalWorker -ChildPid $childPid -JsonlPath $lastKnownJsonl -RunStartUtc $RunStartUtc) {
                    if ($externalWaitStartUtc -eq [DateTime]::MinValue) {
                        $externalWaitStartUtc = [DateTime]::UtcNow
                    }
                    if (-not $waitingExternalLogged) {
                        $waitingExternalLogged = $true
                        Write-Host '[Claude-Local Relay] External non-Claude worker agent is still running; deferring /exit up to 300s until completion...'
                    }
                    if (([DateTime]::UtcNow - $externalWaitStartUtc).TotalSeconds -ge $extWaitTimeoutSec) {
                        $extWaitTimedOutFinal = $true
                        $pendingExitInjection = $true
                    }
                } else {
                    $externalWaitStartUtc = [DateTime]::MinValue
                    $waitingExternalLogged = $false
                    $pendingExitInjection = $true
                }
            } elseif ((-not $pendingExitInjection) -and (-not $rateLimitTriggered) -and $TurnEndPath -and (Test-Path -LiteralPath $TurnEndPath -PathType Leaf)) {
                $turnEnd = Read-TurnEndMarker $TurnEndPath
                $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                if (-not $turnEnd.Present) {
                    try {
                        $teItem = Get-Item -LiteralPath $TurnEndPath -Force -ErrorAction SilentlyContinue
                        if ($null -ne $teItem -and (([DateTime]::UtcNow - $teItem.LastWriteTimeUtc).TotalSeconds -ge 10.0)) {
                            Remove-Item -LiteralPath $TurnEndPath -Force -ErrorAction SilentlyContinue
                        }
                    } catch {}
                } else {
                    $ageMs = if ($turnEnd.TsMs -gt 0) { $nowMs - $turnEnd.TsMs } else { 1200 }
                    if ((-not $turnEndExternalDeferred) -and ($ageMs -ge 10000)) {
                        Remove-Item -LiteralPath $TurnEndPath -Force -ErrorAction SilentlyContinue
                    } elseif ($ageMs -ge 1200) {
                        $tPath = if ($turnEnd.TranscriptPath -and (Test-Path -LiteralPath $turnEnd.TranscriptPath -PathType Leaf)) {
                            $turnEnd.TranscriptPath
                        } else {
                            (Find-ActiveSession -ClaudeDir $ClaudeDir -RunStartUtc $RunStartUtc -WorkingDir $workDir -FallbackSessionId $KnownSessionId -ChildPid $childPid).JsonlPath
                        }
                        if ($tPath) { $lastKnownJsonl = $tPath }
                        $tOffset = if ($tPath -and $PreRunOffsets -and $PreRunOffsets.ContainsKey($tPath)) { [int64]$PreRunOffsets[$tPath] } else { [int64]0 }
                        if (-not (Test-TranscriptHasPendingToolUse -JsonlPath $tPath -StartOffset $tOffset -MaxTail 120)) {
                            $hasExtWorker = Test-HasActiveExternalWorker -ChildPid $childPid -JsonlPath $tPath -RunStartUtc $RunStartUtc
                            $extWaitTimedOut = $false
                            if ($hasExtWorker) {
                                if ($externalWaitStartUtc -eq [DateTime]::MinValue) {
                                    $externalWaitStartUtc = [DateTime]::UtcNow
                                }
                                $turnEndExternalDeferred = $true
                                if (-not $waitingExternalLogged) {
                                    $waitingExternalLogged = $true
                                    Write-Host '[Claude-Local Relay] External non-Claude worker agent is still running; deferring /exit up to 300s until completion...'
                                }
                                if (([DateTime]::UtcNow - $externalWaitStartUtc).TotalSeconds -ge $extWaitTimeoutSec) {
                                    $hasExtWorker = $false
                                    $extWaitTimedOut = $true
                                    $extWaitTimedOutFinal = $true
                                }
                            }
                            if (-not $hasExtWorker) {
                                $externalWaitStartUtc = [DateTime]::MinValue
                                $waitingExternalLogged = $false
                                $turnEndExternalDeferred = $false
                                Remove-Item -LiteralPath $TurnEndPath -Force -ErrorAction SilentlyContinue
                                $unfinishedSubMeta = if ($extWaitTimedOut) {
                                    $false
                                } else {
                                    Test-HasUnfinishedSubagentMeta -JsonlPath $tPath -RunStartUtc $RunStartUtc -ExternalOnly $false
                                }
                                if ($unfinishedSubMeta) {
                                    $turnEndBgSawMeta = $true
                                }
                                if ($turnEnd.HasBg -and (-not $extWaitTimedOut)) {
                                    $turnEndBgObserved = $true
                                } elseif (-not $unfinishedSubMeta) {
                                    $turnEndBgObserved = $false
                                    $turnEndBgSawMeta = $false
                                }
                                $skipCleanBg = $turnEnd.HasBg -or $unfinishedSubMeta -or $hasExtWorker
                                if (-not $skipCleanBg) {
                                    $stTurn = $null
                                    try {
                                        $stTurn = Invoke-Orchestrate $ClaudeLocalExe (Build-StatusRequest $EffectiveStrategy $EffectiveThreshold)
                                    } catch {
                                        $stTurn = $null
                                    }
                                    if (Test-StatusProactiveEligible -StatusResp $stTurn) {
                                        if ($turnEnd.SessionId) { $discoveredSessionId = $turnEnd.SessionId }
                                        $cleanThresholdTriggered = $true
                                        $pendingExitInjection = $true
                                        if ($turnEnd.ProactiveWrapup -or ($ProactiveStatePath -and (Test-Path -LiteralPath $ProactiveStatePath -PathType Leaf))) {
                                            $proactiveHandoffTriggered = $true
                                        }
                                    } elseif ($null -ne $stTurn -and [bool](Get-SafeProp $stTurn @('ok') $false)) {
                                        Clear-ProactiveRelayStateFiles -ThresholdArmedPath $ThresholdArmedPath -ProactiveStatePath $ProactiveStatePath
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if ((-not $pendingExitInjection) -and (-not $rateLimitTriggered) -and $ProactiveStatePath -and (Test-Path -LiteralPath $ProactiveStatePath -PathType Leaf)) {
                $proState = Read-ProactiveHandoffState $ProactiveStatePath
                if ($proState.Present -and ($proState.Stage -eq 'forced_stop')) {
                    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    $settleMs = if ($env:CLAUDE_RELAY_TEST_FAST -eq '1') { 500 } else { 1000 }
                    $ageMs = if ($proState.TsMs -gt 0) { $nowMs - $proState.TsMs } else { $settleMs }
                    if ($ageMs -ge $settleMs) {
                        $tPath = if ($proState.TranscriptPath -and (Test-Path -LiteralPath $proState.TranscriptPath -PathType Leaf)) {
                            $proState.TranscriptPath
                        } else {
                            (Find-ActiveSession -ClaudeDir $ClaudeDir -RunStartUtc $RunStartUtc -WorkingDir $workDir -FallbackSessionId $KnownSessionId -ChildPid $childPid).JsonlPath
                        }
                        if ($tPath) { $lastKnownJsonl = $tPath }
                        $tOffset = if ($tPath -and $PreRunOffsets -and $PreRunOffsets.ContainsKey($tPath)) { [int64]$PreRunOffsets[$tPath] } else { [int64]0 }
                        if (-not (Test-TranscriptHasPendingToolUse -JsonlPath $tPath -StartOffset $tOffset -MaxTail 120)) {
                            $hasForcedExtWorker = Test-HasActiveExternalWorker -ChildPid $childPid -JsonlPath $tPath -RunStartUtc $RunStartUtc
                            $hasForcedSubMeta = Test-HasUnfinishedSubagentMeta -JsonlPath $tPath -RunStartUtc $RunStartUtc -ExternalOnly $false
                            if ($hasForcedSubMeta) {
                                $turnEndBgSawMeta = $true
                            } elseif ($turnEndBgSawMeta) {
                                $turnEndBgObserved = $false
                                $turnEndBgSawMeta = $false
                            }
                            $teForced = Read-TurnEndMarker $TurnEndPath
                            if ($teForced.Present -and $teForced.HasBg) {
                                $turnEndBgObserved = $true
                            }
                            $hasForcedInternalBg = $hasForcedSubMeta -or $turnEndBgObserved -or ($teForced.Present -and $teForced.HasBg)

                            $armedObj = $null
                            if ($ThresholdArmedPath -and (Test-Path -LiteralPath $ThresholdArmedPath -PathType Leaf)) {
                                try {
                                    $armedObj = (Get-Content -LiteralPath $ThresholdArmedPath -Raw -Encoding UTF8) | ConvertFrom-Json
                                } catch {
                                    $armedObj = $null
                                }
                            }
                            $forcedThresh = $EffectiveThreshold
                            $armedThresh = if ($null -ne $armedObj) { Get-SafeProp $armedObj @('threshold_pct', 'thresholdPct') $null } else { $null }
                            if ($null -ne $armedThresh -and [int]$armedThresh -gt 0) {
                                $forcedThresh = [int]$armedThresh
                            } elseif ($proState.ThresholdPct -gt 0) {
                                $forcedThresh = [int]$proState.ThresholdPct
                            }
                            $defaultForcedHardCap = if ($forcedThresh -ge 98) { [Math]::Min($forcedThresh + 1, 99) } else { [Math]::Min($forcedThresh + 5, 97) }
                            $armedHardCap = if ($null -ne $armedObj) { Get-SafeProp $armedObj @('hard_cap_pct', 'hardCapPct') $null } else { $null }
                            $hardCapPct = if ($null -ne $armedHardCap -and [int]$armedHardCap -gt 0) { [int]$armedHardCap } else { [int]$defaultForcedHardCap }
                            $spentPct = 0
                            foreach ($pctCand in @($proState.Used5h, $proState.Used7d, $(if ($null -ne $armedObj) { Get-SafeProp $armedObj @('used_5h', 'used5h') $null } else { $null }), $(if ($null -ne $armedObj) { Get-SafeProp $armedObj @('used_7d', 'used7d') $null } else { $null }))) {
                                if ($null -ne $pctCand) {
                                    $pctInt = [int]$pctCand
                                    if ($pctInt -gt $spentPct) { $spentPct = $pctInt }
                                }
                            }
                            $hitHardCap = ($hardCapPct -gt 0) -and ($spentPct -ge $hardCapPct)

                            $deferForcedExit = ($hasForcedExtWorker -or $hasForcedInternalBg) -and (-not $hitHardCap)
                            if ($deferForcedExit) {
                                if ($externalWaitStartUtc -eq [DateTime]::MinValue) {
                                    $externalWaitStartUtc = [DateTime]::UtcNow
                                }
                                if (-not $waitingExternalLogged) {
                                    $waitingExternalLogged = $true
                                    if ($hasForcedExtWorker) {
                                        Write-Host '[Claude-Local Relay] External non-Claude worker agent is still running; deferring /exit up to 300s until completion...'
                                    } else {
                                        Write-Host '[Claude-Local Relay] Internal background subagent(s) are still running; deferring /exit up to 300s until completion...'
                                    }
                                }
                                if (([DateTime]::UtcNow - $externalWaitStartUtc).TotalSeconds -ge $extWaitTimeoutSec) {
                                    $deferForcedExit = $false
                                    $extWaitTimedOutFinal = $true
                                    $turnEndBgObserved = $false
                                    $turnEndBgSawMeta = $false
                                }
                            }
                            if (-not $deferForcedExit) {
                                $externalWaitStartUtc = [DateTime]::MinValue
                                $waitingExternalLogged = $false
                                $stForced = $null
                                try {
                                    $stForced = Invoke-Orchestrate $ClaudeLocalExe (Build-StatusRequest $EffectiveStrategy $EffectiveThreshold)
                                } catch {
                                    $stForced = $null
                                }
                                if (Test-StatusProactiveEligible -StatusResp $stForced) {
                                    if ($proState.SessionId) { $discoveredSessionId = $proState.SessionId }
                                    $proactiveHandoffTriggered = $true
                                    $cleanThresholdTriggered = $true
                                    $forcedStopTriggered = $true
                                    $pendingExitInjection = $true
                                } elseif ($null -ne $stForced -and [bool](Get-SafeProp $stForced @('ok') $false)) {
                                    Clear-ProactiveRelayStateFiles -ThresholdArmedPath $ThresholdArmedPath -ProactiveStatePath $ProactiveStatePath
                                }
                            }
                        }
                    }
                }
            }

            if ($pendingExitInjection) {
                if ($proc.HasExited) { break }
                if ((-not [Console]::IsInputRedirected) -and ($env:CLAUDE_LOCAL_DISABLE_CONSOLE_INJECT -ne '1') -and (-not (Test-ConsoleRawMode))) {
                    if ($sentExitCommand -and (-not $cookedWaitLogged)) {
                        $cookedWaitLogged = $true
                        Write-Host '[Claude-Local Relay] Console returned to cooked mode; waiting for claude.exe to exit...'
                    }
                    continue
                }
                if ($bgChoiceGraceUntilUtc -gt [DateTime]::UtcNow) {
                    continue
                }
                $elapsedMs = if ($lastInjectUtc -eq [DateTime]::MinValue) { 999999.0 } else { ([DateTime]::UtcNow - $lastInjectUtc).TotalMilliseconds }
                if (-not $hasBackgroundWork) {
                    if (Test-HasLiveChildShellOrWork -ChildPid $childPid -JsonlPath $lastKnownJsonl -RunStartUtc $RunStartUtc) {
                        $hasBackgroundWork = $true
                    }
                }
                if (($injectAttempts -ge 1) -and (-not $sentBgChoice) -and ($elapsedMs -ge 800.0)) {
                    $sentBgChoice = $true
                    if ($hasBackgroundWork) {
                        $bgOkFirst = Send-ConsoleBackgroundChoice
                        if ($bgOkFirst) {
                            $bgChoiceSentCount++
                            $lastInjectUtc = [DateTime]::UtcNow
                            $bgChoiceGraceUntilUtc = [DateTime]::UtcNow.AddMilliseconds(4000)
                        }
                    }
                } elseif ($injectAttempts -lt 6) {
                    $needWaitMs = if ($injectAttempts -eq 0) { 0.0 } else { [double]$retryDelaysMs[$injectAttempts - 1] }
                    if ($elapsedMs -ge $needWaitMs) {
                        if (($injectAttempts -ge 1) -and $hasBackgroundWork -and $sentExitCommand -and ($bgChoiceSentCount -lt 2)) {
                            $bgTryOk = Send-ConsoleBackgroundChoice
                            $bgChoiceSentCount++
                            if ($bgTryOk -and $proc.WaitForExit(600)) {
                                break
                            }
                            if ($bgTryOk) {
                                $lastInjectUtc = [DateTime]::UtcNow
                                $bgChoiceGraceUntilUtc = [DateTime]::UtcNow.AddMilliseconds(4000)
                                continue
                            }
                        }
                        $injectAttempts++
                        $sentBgChoice = $false
                        $lastInjectUtc = [DateTime]::UtcNow
                        $exitOk = Send-ConsolePhasedExitCommand -SendSecondEscape $sawAutoContinueNotice -ChildProcess $proc
                        if ($exitOk) {
                            $sentExitCommand = $true
                        }
                    }
                } else {
                    if ((-not $timedOutLogged) -and ($elapsedMs -ge 8000.0)) {
                        $timedOutLogged = $true
                        $lastTimeoutPollUtc = [DateTime]::UtcNow
                        $nextName = if ($StandbyLabel -and $StandbyLabel -ne '(none)') { $StandbyLabel } else { 'next' }
                        Write-Host ("[Claude-Local Relay] Auto-exit timed out; press Esc and type /exit to switch to [{0}]." -f $nextName)
                    } elseif ($timedOutLogged -and (([DateTime]::UtcNow - $lastTimeoutPollUtc).TotalSeconds -ge 15.0)) {
                        $lastTimeoutPollUtc = [DateTime]::UtcNow
                        if ((-not [Console]::IsInputRedirected) -and ($env:CLAUDE_LOCAL_DISABLE_CONSOLE_INJECT -ne '1')) {
                            if ($hasBackgroundWork -and $sentExitCommand) {
                                if (Send-ConsoleBackgroundChoice) {
                                    $bgChoiceSentCount++
                                    $lastInjectUtc = [DateTime]::UtcNow
                                    $bgChoiceGraceUntilUtc = [DateTime]::UtcNow.AddMilliseconds(4000)
                                }
                            } else {
                                $retryOk = Send-ConsolePhasedExitCommand -SendSecondEscape $sawAutoContinueNotice -ChildProcess $proc
                                if ($retryOk) { $sentExitCommand = $true }
                            }
                        }
                    }
                }
            }
        }
        $proc.WaitForExit()
        $finalExitCode = [int]$proc.ExitCode
        if ($MonitorAutoExit -and (-not $rateLimitTriggered) -and (-not $proactiveHandoffTriggered) -and ($finalExitCode -eq 0) -and $ProactiveStatePath -and (Test-Path -LiteralPath $ProactiveStatePath -PathType Leaf)) {
            $trigFinal = Read-RelayTrigger $TriggerPath
            if ($trigFinal.Reason -ne 'rate_limit') {
                $proFinal = Read-ProactiveHandoffState $ProactiveStatePath
                $teFinal = Read-TurnEndMarker $TurnEndPath
                if ($proFinal.Present -and (($proFinal.Stage -eq 'forced_stop') -or (($proFinal.Stage -eq 'wrapping_up') -and $teFinal.Present -and $teFinal.ProactiveWrapup))) {
                    $fallbackSid = if ($proFinal.SessionId) { $proFinal.SessionId } else { $teFinal.SessionId }
                    if ($fallbackSid -and (-not $discoveredSessionId)) {
                        $discoveredSessionId = $fallbackSid
                    }
                    if ($proFinal.Stage -eq 'forced_stop') { $forcedStopTriggered = $true }
                    $proactiveHandoffTriggered = $true
                    $cleanThresholdTriggered = $true
                    $proactiveExitFallback = $true
                }
            }
        }
        return @{
            ExitCode              = $finalExitCode
            CleanThresholdRelay   = [bool]$cleanThresholdTriggered
            ProactiveHandoffRelay = [bool]$proactiveHandoffTriggered
            ProactiveExitFallback = [bool]$proactiveExitFallback
            ForcedStopRelay       = [bool]$forcedStopTriggered
            ExtWorkerTimedOut     = [bool]$extWaitTimedOutFinal
            LiveDetectedRateLimit = [bool]$liveDetectedRateLimit
            HasBackgroundWork     = [bool]$hasBackgroundWork
            DiscoveredSessionId   = [string]$discoveredSessionId
            ChildPid              = [int]$childPid
        }
    } finally {
        if ($cancelRegistered) {
            try { [Console]::remove_CancelKeyPress($cancelHandler) } catch {}
        }
        if ($null -ne $proc) {
            $proc.Dispose()
        }
    }
}

function Build-StatusRequest {
    param([string]$StrategyName, [int]$ThresholdVal)
    $req = @{ schema = 1; op = 'status' }
    if ($StrategyName) { $req['strategy'] = $StrategyName }
    if ($ThresholdVal -gt 0) { $req['threshold_pct'] = $ThresholdVal }
    return $req
}

function Build-RelayExtraArgs {
    param(
        [string]$SettingsPath,
        [string]$AgentsInlineJson,
        [bool]$HasExplicitModel,
        [bool]$HasExplicitEffort,
        [string]$DefaultModel,
        [string]$DefaultEffort
    )
    $extra = New-Object System.Collections.Generic.List[string]
    if ((-not $HasExplicitModel) -and $DefaultModel) {
        [void]$extra.Add('--model')
        [void]$extra.Add($DefaultModel)
    }
    if ((-not $HasExplicitEffort) -and $DefaultEffort) {
        [void]$extra.Add('--effort')
        [void]$extra.Add($DefaultEffort)
    }
    if ($SettingsPath) {
        [void]$extra.Add('--settings')
        [void]$extra.Add($SettingsPath)
    }
    if ($AgentsInlineJson) {
        [void]$extra.Add('--agents')
        [void]$extra.Add($AgentsInlineJson)
    }
    return ,([string[]]$extra.ToArray())
}

function Get-ScriptFileFingerprint {
    param([string]$ScriptPath)
    if (-not $ScriptPath -or -not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        return ''
    }
    try {
        $item = Get-Item -LiteralPath $ScriptPath -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            return ''
        }
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $fs = New-Object System.IO.FileStream($ScriptPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
                $hashBytes = $sha.ComputeHash($fs)
                return ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
            } finally {
                $fs.Dispose()
            }
        } finally {
            $sha.Dispose()
        }
    } catch {
        try {
            $item = Get-Item -LiteralPath $ScriptPath -Force -ErrorAction Stop
            return ('{0}:{1}' -f $item.Length, $item.LastWriteTimeUtc.Ticks)
        } catch {
            return ''
        }
    }
}

function Show-ScriptDriftWarningIfUpdated {
    if ($script:ScriptDriftWarned) { return }
    if (-not $script:ScriptLaunchPath -or -not $script:ScriptLaunchFingerprint) { return }
    $liveFp = Get-ScriptFileFingerprint $script:ScriptLaunchPath
    if ($liveFp -and ($liveFp -ne $script:ScriptLaunchFingerprint)) {
        $script:ScriptDriftWarned = $true
        Write-Host '[Claude-Local Relay] NOTICE: claude-relay.ps1 on disk was updated after this terminal started. Reopen your relay terminal (cr) at a convenient pause to load the latest script.'
    }
}

function Resolve-CrossAccountTranscriptPath {
    param(
        [string]$ClaudeDir,
        [string]$ParentSessionId = '',
        [string]$ParentJsonlPath = '',
        [string]$ContinuedSessionId = ''
    )
    if ($ParentJsonlPath -and (Test-Path -LiteralPath $ParentJsonlPath -PathType Leaf)) {
        try {
            $item = Get-Item -LiteralPath $ParentJsonlPath -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
                return $ParentJsonlPath
            }
        } catch {}
    }
    if ($ParentSessionId) {
        $byParent = Find-TranscriptBySessionId -ClaudeDir $ClaudeDir -SessionId $ParentSessionId -PreferredPath $ParentJsonlPath
        if ($byParent) { return $byParent }
    }
    if ($ContinuedSessionId) {
        $byCont = Find-TranscriptBySessionId -ClaudeDir $ClaudeDir -SessionId $ContinuedSessionId
        if ($byCont) { return $byCont }
    }
    return ''
}

function Build-SameAccountResumeArgs {
    param(
        [string]$TargetSessionId,
        $CliSplit,
        [string[]]$BasePersistentArgs,
        [string[]]$EphemeralExtraArgs,
        [bool]$IncludePrintFlag,
        [bool]$IncludePrompt,
        [string]$CustomContinuationPrompt,
        [string]$FallbackContinuationPrompt,
        [string]$SubagentManifest = ''
    )
    $list = New-Object System.Collections.Generic.List[string]
    if ($TargetSessionId) {
        [void]$list.Add('--resume')
        [void]$list.Add($TargetSessionId)
    } else {
        [void]$list.Add('--continue')
    }
    if ($IncludePrintFlag) {
        $pFlag = if ($CliSplit.PrintFlag) { [string]$CliSplit.PrintFlag } else { '--print' }
        [void]$list.Add($pFlag)
    }
    foreach ($pArg in @($BasePersistentArgs)) {
        [void]$list.Add([string]$pArg)
    }
    foreach ($eArg in @($EphemeralExtraArgs)) {
        [void]$list.Add([string]$eArg)
    }
    if ($IncludePrompt) {
        $contText = if ($CustomContinuationPrompt) { $CustomContinuationPrompt } else { $FallbackContinuationPrompt }
        if ($SubagentManifest) {
            $flatManifest = ($SubagentManifest -replace '\r?\n', ' ').Trim()
            $contText = $contText + ' ' + $flatManifest
        }
        if ('--' -notin $list) {
            [void]$list.Add('--')
        }
        [void]$list.Add($contText)
    }
    return ,([string[]]$list.ToArray())
}

function Build-CleanHandoffArgs {
    param(
        $SwitchResp,
        [string]$AppDataDir,
        [string]$SourceJsonl = '',
        [string]$WorkingDir = '',
        [object[]]$SubagentItems = @(),
        [string[]]$Literals = @(),
        $CliSplit,
        [string[]]$BasePersistentArgs,
        [string[]]$EphemeralExtraArgs,
        [bool]$WantPrompt,
        [string]$CustomContinuationPrompt = ''
    )
    $handoffFiles = Resolve-RelayHandoffFiles `
        -SwitchResp $SwitchResp `
        -AppDataDir $AppDataDir `
        -JsonlPath $SourceJsonl `
        -WorkingDir $WorkingDir `
        -SubagentItems $SubagentItems `
        -Literals $Literals
    $handoffMdForNote = if ($null -ne $handoffFiles) { [string]$handoffFiles.MdPath } else { '' }
    $list = New-Object System.Collections.Generic.List[string]
    if ([bool]$CliSplit.HasPrint) {
        $pFlag = if ($CliSplit.PrintFlag) { [string]$CliSplit.PrintFlag } else { '--print' }
        [void]$list.Add($pFlag)
    }
    foreach ($pArg in @($BasePersistentArgs)) { [void]$list.Add([string]$pArg) }
    foreach ($eArg in @($EphemeralExtraArgs)) { [void]$list.Add([string]$eArg) }
    $withNote = Add-AppendSystemPromptNote -ArgList $list.ToArray() -Note (Build-RelayHandoffNote -MdPath $handoffMdForNote)
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($wnArg in @($withNote)) { [void]$out.Add([string]$wnArg) }
    if ($WantPrompt) {
        $contText = if ($CustomContinuationPrompt) { $CustomContinuationPrompt } else { $script:CleanContinuationPrompt }
        if ('--' -notin $out) { [void]$out.Add('--') }
        [void]$out.Add($contText)
    }
    return @{
        Args   = [string[]]$out.ToArray()
        MdPath = $handoffMdForNote
    }
}

$claudeLocalExe = Resolve-ClaudeLocalExe
if ($Status) {
    $statusResp = Invoke-Orchestrate $claudeLocalExe (Build-StatusRequest $Strategy $ThresholdPct)
    Show-RelayStatus $statusResp
    exit 0
}

$script:ScriptLaunchPath = [string]$PSCommandPath
$script:ScriptLaunchFingerprint = Get-ScriptFileFingerprint $script:ScriptLaunchPath
$script:ScriptDriftWarned = $false

$claudeExe = Resolve-ClaudeExe
$userHome = Get-UserHomeDir
$claudeDir = Join-Path $userHome '.claude'
$rawInitialArgs = if ($ClaudeArgs) { [string[]]$ClaudeArgs } else { [string[]]@() }
$cliSplit = Split-RelayClaudeArgs $rawInitialArgs
$basePersistentArgs = [string[]]$cliSplit.BasePersistentArgs
$isInteractiveSession = (-not [bool]$cliSplit.HasPrint)
$knownSessionId = Get-InitialSessionArg $rawInitialArgs
$fastTurnStreak = 0
$lastRelayMeta = $null

$preStatus = Invoke-Orchestrate $claudeLocalExe (Build-StatusRequest $Strategy $ThresholdPct)
$preCfg = Get-SafeProp $preStatus @('config') $null
$cfgAutoContinue = [bool](Get-SafeProp $preCfg @('autoContinueOnRelay') $false)
$effectiveAutoContinue = if ($AutoContinueSpecified) { $AutoContinue } else { $cfgAutoContinue }
$cfgDefaultModel = ([string](Get-SafeProp $preCfg @('defaultCliModel', 'default_cli_model') '')).Trim()
$cfgDefaultEffort = ([string](Get-SafeProp $preCfg @('defaultCliEffort', 'default_cli_effort') '')).Trim()
$effThreshold = if ($ThresholdPct -gt 0) {
    $ThresholdPct
} else {
    $cfgThreshVal = [int](Get-SafeProp $preCfg @('spentThresholdPct') 98)
    if ($cfgThreshVal -gt 0) { $cfgThreshVal } else { 98 }
}
$effStrategy = if ($Strategy) {
    $Strategy
} else {
    $cfgStratVal = [string](Get-SafeProp $preCfg @('strategy') 'smart')
    if ($cfgStratVal) { $cfgStratVal } else { 'smart' }
}

$appDataDir = if ($env:APPDATA) { Join-Path $env:APPDATA 'ai.local.claude-local' } else { '' }
if ($PSScriptRoot -and ($env:PATH -notlike "*$PSScriptRoot*")) {
    $env:PATH = $PSScriptRoot + [IO.Path]::PathSeparator + $env:PATH
}
Clear-StaleRelayTempDirs

$relayTempDir = ''
$ephemeral = @{ TriggerPath = ''; TurnEndPath = ''; ProactiveStatePath = ''; ThresholdArmedPath = ''; SettingsPath = ''; HookCommand = ''; StopHookEnabled = $false; AgentsInlineJson = '' }
if ($isInteractiveSession) {
    $relayTempDir = Join-Path ([IO.Path]::GetTempPath()) ('cl-relay-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $relayTempDir -Force | Out-Null
}

$activeRecordId = [string](Get-SafeProp $preStatus @('active') '')
$bannerStandby = '(none)'
$forkCopies = New-Object System.Collections.Generic.List[string]

try {
    if ($isInteractiveSession) {
        $ephemeral = Initialize-EphemeralRelayArtifacts `
            -TempDir $relayTempDir `
            -ClaudeDir $claudeDir `
            -UserHome $userHome `
            -InjectSettings (-not [bool]$cliSplit.HasSettings) `
            -InjectAgents (-not [bool]$cliSplit.HasAgents) `
            -RegisterStopHook $effectiveAutoContinue
    }

    $ephemeralExtraArgs = Build-RelayExtraArgs `
        -SettingsPath $ephemeral.SettingsPath `
        -AgentsInlineJson $ephemeral.AgentsInlineJson `
        -HasExplicitModel ([bool]$cliSplit.HasModel) `
        -HasExplicitEffort ([bool]$cliSplit.HasEffort) `
        -DefaultModel $cfgDefaultModel `
        -DefaultEffort $cfgDefaultEffort

    $effectiveArgs = Merge-RelayArgsBeforeDoubleDash -PrimaryArgs $rawInitialArgs -ExtraFlags $ephemeralExtraArgs

    for ($relayCount = 0; $relayCount -le $MaxRelays; $relayCount++) {
        if ($relayCount -eq 0) {
            $activeObj = Get-SafeProp $preStatus @('active', 'active_account') $null
            $bannerActive = [string](Get-SafeProp $preStatus @('active_name') '')
            if (-not $bannerActive) {
                if ($activeObj -is [string] -and $activeObj.Trim() -and $activeObj.Trim() -ne 'empty') {
                    $bannerActive = $activeObj.Trim()
                } else {
                    $bannerActive = [string](Get-SafeProp $activeObj @('name', 'display_name') '(current)')
                }
            }

            $preShouldRelay = [bool](Get-SafeProp $preStatus @('should_relay_now') $false)
            $preCliRunning = [bool](Get-SafeProp $preStatus @('cli_running') $false)
            if ($preShouldRelay -and (-not $preCliRunning)) {
                $preSwitchPayload = @{ schema = 1; op = 'relay_switch' }
                if ($Strategy) { $preSwitchPayload['strategy'] = $Strategy }
                if ($ThresholdPct -gt 0) { $preSwitchPayload['threshold_pct'] = $ThresholdPct }
                $preSwitch = Invoke-RelaySwitchWithRetry -ClaudeLocalExe $claudeLocalExe -Payload $preSwitchPayload
                if ([bool](Get-SafeProp $preSwitch @('switched') $false)) {
                    $targetName = [string](Get-SafeProp $preSwitch @('target_name', 'target', 'name') 'next')
                    $preTargetId = [string](Get-SafeProp $preSwitch @('target_id') '')
                    if ($preTargetId) { $activeRecordId = $preTargetId }
                    $reason = Get-SafeProp $preSwitch @('reason') 'prelaunch_relay'
                    Write-Host ("[Claude-Local Relay] Pre-launch switched to [{0}] ({1})." -f $targetName, $reason)
                    Show-AwaitingResetReminders $preSwitch
                    $bannerActive = $targetName
                } else {
                    Show-RelayExhaustion $preSwitch $preStatus
                    Show-ScriptDriftWarningIfUpdated
                    exit 1
                }
            }

            $bannerStandby = Get-BestStandbyLabel -StatusResp $preStatus -ExcludeRecordId $activeRecordId
            $autoModeTag = if ($effectiveAutoContinue) { ', auto-continue' } else { '' }
            $modelBannerTag = if ($cfgDefaultModel -or $cfgDefaultEffort) {
                $mDisp = if ($cfgDefaultModel) { $cfgDefaultModel } else { 'auto' }
                $eDisp = if ($cfgDefaultEffort) { " ($cfgDefaultEffort)" } else { '' }
                " | Model: $mDisp$eDisp"
            } else {
                ''
            }
            Write-Host ("[Claude-Local Relay] Active: {0} | Standby: {1} | Mode: {2} ({3}%{4}){5} | /exit to relay" -f $bannerActive, $bannerStandby, $effStrategy, $effThreshold, $autoModeTag, $modelBannerTag)
        }

        $resolvedRelayProxy = Resolve-RelayProxyEndpoint -ClaudeDir $claudeDir -AppDataDir $appDataDir -ActiveRecordId $activeRecordId
        Assert-LocalProxyReachable $resolvedRelayProxy

        foreach ($epFile in @($ephemeral.TriggerPath, $ephemeral.TurnEndPath, $ephemeral.ProactiveStatePath, $ephemeral.ThresholdArmedPath)) {
            if ($epFile -and (Test-Path -LiteralPath $epFile -PathType Leaf)) {
                Remove-Item -LiteralPath $epFile -Force -ErrorAction SilentlyContinue
            }
        }

        $monitorAutoExit = $isInteractiveSession -and $effectiveAutoContinue
        if ($ephemeral.SettingsPath -and $ephemeral.HookCommand -and ([bool]$ephemeral.StopHookEnabled -ne $monitorAutoExit)) {
            Write-EphemeralHookSettings -SettingsPath $ephemeral.SettingsPath -HookCommand $ephemeral.HookCommand -RegisterStopHook $monitorAutoExit
            $ephemeral.StopHookEnabled = $monitorAutoExit
        }

        $preRunOffsets = Get-JsonlByteOffsets $claudeDir
        $runStartUtc = [DateTime]::UtcNow
        $childOutcome = Invoke-ClaudeRelayChild `
            -ClaudeExe $claudeExe `
            -ClaudeLocalExe $claudeLocalExe `
            -ArgList $effectiveArgs `
            -EffectiveThreshold $effThreshold `
            -EffectiveStrategy $effStrategy `
            -MonitorAutoExit $monitorAutoExit `
            -TriggerPath $ephemeral.TriggerPath `
            -TurnEndPath $ephemeral.TurnEndPath `
            -ProactiveStatePath $ephemeral.ProactiveStatePath `
            -ThresholdArmedPath $ephemeral.ThresholdArmedPath `
            -ClaudeDir $claudeDir `
            -AppDataDir $appDataDir `
            -RunStartUtc $runStartUtc `
            -KnownSessionId $knownSessionId `
            -ResolvedProxy $resolvedRelayProxy `
            -PreRunOffsets $preRunOffsets `
            -StandbyLabel $bannerStandby
        $exitCode = [int]$childOutcome.ExitCode
        $cleanThresholdRelay = [bool]$childOutcome.CleanThresholdRelay
        $proactiveHandoffRelay = [bool]$childOutcome.ProactiveHandoffRelay
        $proactiveExitFallback = [bool]$childOutcome.ProactiveExitFallback
        $forcedStopRelay = [bool](Get-SafeProp $childOutcome @('ForcedStopRelay') $false)
        $extWorkerTimedOut = [bool](Get-SafeProp $childOutcome @('ExtWorkerTimedOut') $false)
        $liveRateLimited = [bool]$childOutcome.LiveDetectedRateLimit
        $childHasBg = [bool]$childOutcome.HasBackgroundWork
        $lastChildPid = [int]$childOutcome.ChildPid
        if ($childOutcome.DiscoveredSessionId -and (-not $knownSessionId)) {
            $knownSessionId = $childOutcome.DiscoveredSessionId
        }
        $runSec = ([DateTime]::UtcNow - $runStartUtc).TotalSeconds

        $trigAfter = Read-RelayTrigger $ephemeral.TriggerPath
        $triggerRateLimited = ($trigAfter.Reason -eq 'rate_limit')
        if ($trigAfter.SessionId -and (-not $knownSessionId)) {
            $knownSessionId = $trigAfter.SessionId
        }

        $sessInfo = Find-ActiveSession -ClaudeDir $claudeDir -RunStartUtc $runStartUtc -WorkingDir (Get-Location).Path -FallbackSessionId $knownSessionId -ChildPid $lastChildPid
        if ($sessInfo.SessionId) {
            $knownSessionId = $sessInfo.SessionId
        }

        $startOffset = [int64]0
        if ($sessInfo.JsonlPath -and $preRunOffsets.ContainsKey($sessInfo.JsonlPath)) {
            $startOffset = [int64]$preRunOffsets[$sessInfo.JsonlPath]
        }
        $transcriptRateLimited = Test-TranscriptRateLimited -JsonlPath $sessInfo.JsonlPath -StartOffset $startOffset -RunStartUtc $runStartUtc -PreRunOffsets $preRunOffsets
        $rateLimited = ($triggerRateLimited -or $transcriptRateLimited -or $liveRateLimited)
        $hasBgWork = ($childHasBg -or [bool]$trigAfter.HasBg)

        $parentSessionId = $knownSessionId
        $parentJsonlPath = [string]$sessInfo.JsonlPath
        $continuedSessionId = Get-ContinuedInSessionId -JsonlPath $parentJsonlPath -StartOffset $startOffset

        Show-ScriptDriftWarningIfUpdated

        if ($exitCode -eq 130 -or $exitCode -eq -1073741510) {
            if (-not $rateLimited) {
                exit $exitCode
            }
            Write-Host '[Claude-Local Relay] Rate-limited session exited via Ctrl+C; rescuing session via SmartRelay...'
        }

        if ($rateLimited -or $hasBgWork) {
            Stop-ClaudeDaemonIfAlive -ClaudeExe $claudeExe -ResolvedProxy $resolvedRelayProxy
        }

        $postStatus = Invoke-Orchestrate $claudeLocalExe (Build-StatusRequest $Strategy $ThresholdPct)
        $postShouldRelay = [bool](Get-SafeProp $postStatus @('should_relay_now') $false)
        $postTriggerKind = [string](Get-SafeProp $postStatus @('relay_trigger_kind', 'relayTriggerKind') '')
        $postSpentTrigger = $postShouldRelay -and ($postTriggerKind -in @('threshold_reached', 'awaiting_manual_reset', 'current_spent'))
        $cfgObj = Get-SafeProp $postStatus @('config') $null
        $cfgAutoContinue = [bool](Get-SafeProp $cfgObj @('autoContinueOnRelay') $false)
        $effectiveAutoContinue = if ($AutoContinueSpecified) { $AutoContinue } else { $cfgAutoContinue }
        if ($null -ne $cfgObj) {
            $cfgDefaultModel = ([string](Get-SafeProp $cfgObj @('defaultCliModel', 'default_cli_model') '')).Trim()
            $cfgDefaultEffort = ([string](Get-SafeProp $cfgObj @('defaultCliEffort', 'default_cli_effort') '')).Trim()
        }
        $ephemeralExtraArgs = Build-RelayExtraArgs `
            -SettingsPath $ephemeral.SettingsPath `
            -AgentsInlineJson $ephemeral.AgentsInlineJson `
            -HasExplicitModel ([bool]$cliSplit.HasModel) `
            -HasExplicitEffort ([bool]$cliSplit.HasEffort) `
            -DefaultModel $cfgDefaultModel `
            -DefaultEffort $cfgDefaultEffort
        $postCfgThresh = [int](Get-SafeProp $cfgObj @('spentThresholdPct') 98)
        if ($ThresholdPct -le 0 -and $postCfgThresh -gt 0) {
            $effThreshold = $postCfgThresh
        }
        $postCfgStrat = [string](Get-SafeProp $cfgObj @('strategy') '')
        if (-not $Strategy -and $postCfgStrat) {
            $effStrategy = $postCfgStrat
        }
        if ($proactiveExitFallback -and (-not $rateLimited) -and ($null -ne $postStatus) -and [bool](Get-SafeProp $postStatus @('ok') $false) -and (-not (Test-StatusProactiveEligible -StatusResp $postStatus))) {
            $cleanThresholdRelay = $false
            $proactiveHandoffRelay = $false
        }
        $shouldAutoContinue = $effectiveAutoContinue -and ($rateLimited -or $proactiveHandoffRelay)

        if ((-not $rateLimited) -and (-not $cleanThresholdRelay) -and (-not $proactiveHandoffRelay) -and (-not $postSpentTrigger)) {
            if (($relayCount -gt 0) -and ($exitCode -ne 0) -and ($runSec -lt 10.0)) {
                if (($null -ne $lastRelayMeta) -and ($lastRelayMeta.Kind -eq 'same_continued') -and (-not [bool]$lastRelayMeta.FallbackUsed) -and $lastRelayMeta.ParentSessionId -and ($lastRelayMeta.ParentSessionId -ne $lastRelayMeta.ContinuedSessionId)) {
                    Write-Host ("[Claude-Local Relay] Same-account continued-in resume ({0}) exited rapidly (exit={1}, {2:N1}s); falling back once to parent session ({3})..." -f $lastRelayMeta.ContinuedSessionId, $exitCode, $runSec, $lastRelayMeta.ParentSessionId)
                    $lastRelayMeta.FallbackUsed = $true
                    $lastRelayMeta.Kind = 'same_parent'
                    $knownSessionId = [string]$lastRelayMeta.ParentSessionId
                    $lastWasAutoRelay = [bool]$lastRelayMeta.RateLimited -or [bool]$lastRelayMeta.ProactiveHandoff
                    $includeFallbackPrint = $effectiveAutoContinue -and $lastWasAutoRelay -and [bool]$cliSplit.HasPrint
                    $includeFallbackPrompt = $effectiveAutoContinue -and $lastWasAutoRelay
                    $effectiveArgs = Build-SameAccountResumeArgs `
                        -TargetSessionId $knownSessionId `
                        -CliSplit $cliSplit `
                        -BasePersistentArgs $basePersistentArgs `
                        -EphemeralExtraArgs $ephemeralExtraArgs `
                        -IncludePrintFlag $includeFallbackPrint `
                        -IncludePrompt $includeFallbackPrompt `
                        -CustomContinuationPrompt $ContinuationPrompt `
                        -FallbackContinuationPrompt $DefaultContinuationPrompt `
                        -SubagentManifest ([string]$lastRelayMeta.SubagentManifest)
                    $relayCount--
                    continue
                }
                if (($null -ne $lastRelayMeta) -and ($lastRelayMeta.Kind -eq 'fork_resume') -and (-not [bool]$lastRelayMeta.FallbackUsed)) {
                    Write-Host ("[Claude-Local Relay] Cross-account fork_resume exited rapidly (exit={0}, {1:N1}s); falling back once to clean_handoff..." -f $exitCode, $runSec)
                    $lastRelayMeta.FallbackUsed = $true
                    $lastRelayMeta.Kind = 'clean_handoff'
                    $knownSessionId = ''
                    $cleanFallback = Build-CleanHandoffArgs `
                        -SwitchResp $lastRelayMeta.SwitchResp `
                        -AppDataDir $appDataDir `
                        -SourceJsonl ([string]$lastRelayMeta.SourceJsonl) `
                        -WorkingDir (Get-Location).Path `
                        -SubagentItems $lastRelayMeta.SubItems `
                        -Literals ([string[]]$lastRelayMeta.HandoffLiterals) `
                        -CliSplit $cliSplit `
                        -BasePersistentArgs $basePersistentArgs `
                        -EphemeralExtraArgs $ephemeralExtraArgs `
                        -WantPrompt ([bool]$lastRelayMeta.WantPrompt) `
                        -CustomContinuationPrompt $ContinuationPrompt
                    $lastRelayMeta.HandoffMdPath = [string]$cleanFallback.MdPath
                    $effectiveArgs = [string[]]$cleanFallback.Args
                    $relayCount--
                    continue
                }
                $diagMode = if ($null -ne $lastRelayMeta -and $lastRelayMeta.Kind) { [string]$lastRelayMeta.Kind } else { 'post_relay' }
                Write-Host ("[Claude-Local Relay] Post-relay session exited rapidly (mode={0}, exit={1}, elapsed={2:N1}s)." -f $diagMode, $exitCode, $runSec)
                if (($null -ne $lastRelayMeta) -and $lastRelayMeta.ParentSessionId -and ($diagMode -in @('same_continued', 'same_parent', 'same_continue'))) {
                    Write-Host ("[Claude-Local Relay] Recovery hint: verify session status with cr -Status or retry manual resume with cr --resume {0}." -f $lastRelayMeta.ParentSessionId)
                } elseif (($null -ne $lastRelayMeta) -and $lastRelayMeta.HandoffMdPath) {
                    Write-Host ("[Claude-Local Relay] Recovery hint: run cr -Status to inspect pool state, then start fresh with cr and read {0}." -f $lastRelayMeta.HandoffMdPath)
                } else {
                    Write-Host '[Claude-Local Relay] Recovery hint: run cr -Status to check active account/proxy state and retry with cr.'
                }
            }
            exit $exitCode
        }

        if ($relayCount -ge $MaxRelays) {
            Write-Host ("[Claude-Local Relay] MaxRelays ({0}) reached; exiting." -f $MaxRelays)
            exit $exitCode
        }

        if ($runSec -lt 15.0) {
            $fastTurnStreak++
        } else {
            $fastTurnStreak = 0
        }
        if ($fastTurnStreak -ge 3) {
            Write-Host '[Claude-Local Relay] Anti-spin guard: stopped after repeated rapid exits (<15s).'
            exit $(if ($exitCode -ne 0) { $exitCode } else { 1 })
        }
        if ($fastTurnStreak -eq 2) {
            Write-Host '[Claude-Local Relay] Anti-spin guard: two consecutive rapid exits (<15s), backing off 2s...'
            Start-Sleep -Seconds 2
        }

        Start-Sleep -Milliseconds (Get-HumanizedRelayDelayMs $rateLimited)

        $effHandoffMode = Resolve-RelayHandoffMode -Explicit $HandoffMode -Cfg $cfgObj
        if ($rateLimited -or $proactiveHandoffRelay -or $cleanThresholdRelay) {
            $breatherMs = Get-AntiBanBreatherMs
            if ($breatherMs -gt 0) {
                Write-Host ("[Claude-Local Relay] Anti-ban breather: waiting {0:N1}s before switching accounts..." -f ($breatherMs / 1000.0))
                Start-Sleep -Milliseconds $breatherMs
            } else {
                Write-Host '[Claude-Local Relay] Anti-ban breather skipped (CLAUDE_RELAY_TEST_FAST=1).'
            }
        }
        $switchPayload = @{ schema = 1; op = 'relay_switch' }
        if ($Strategy) { $switchPayload['strategy'] = $Strategy }
        if ($ThresholdPct -gt 0) { $switchPayload['threshold_pct'] = $ThresholdPct }
        if ($rateLimited) { $switchPayload['rate_limited'] = $true }
        if ($extWorkerTimedOut) {
            $switchPayload['handoff_reason'] = 'external_worker_timeout'
        } elseif ($forcedStopRelay) {
            $switchPayload['handoff_reason'] = 'forced_stop'
        }
        $postActive = Get-SafeProp $postStatus @('active', 'active_account') $null
        $postActiveId = $null
        if ($postActive -is [string]) {
            $trimmedActive = $postActive.Trim()
            if ($trimmedActive -and $trimmedActive -ne 'empty') {
                $postActiveId = $trimmedActive
            }
        } elseif ($null -ne $postActive) {
            $postActiveId = Get-SafeProp $postActive @('record_id', 'id') $null
        }
        if (-not $postActiveId) {
            $fallbackActiveId = [string](Get-SafeProp $postStatus @('active_id') '')
            if ($fallbackActiveId.Trim() -and $fallbackActiveId.Trim() -ne 'empty') {
                $postActiveId = $fallbackActiveId.Trim()
            }
        }
        if ($postActiveId) { $switchPayload['from_record_id'] = [string]$postActiveId }
        $switchResp = Invoke-RelaySwitchWithRetry -ClaudeLocalExe $claudeLocalExe -Payload $switchPayload

        if (-not [bool](Get-SafeProp $switchResp @('switched') $false)) {
            Show-RelayExhaustion $switchResp $postStatus
            exit $(if ($exitCode -ne 0) { $exitCode } else { 1 })
        }

        $switchedTargetId = [string](Get-SafeProp $switchResp @('target_id') '')
        if ($switchedTargetId) { $activeRecordId = $switchedTargetId }
        $bannerStandby = Get-BestStandbyLabel -StatusResp $postStatus -ExcludeRecordId $activeRecordId

        $fromName = Get-SafeProp $switchResp @('from_name', 'from') 'previous'
        $toName = Get-SafeProp $switchResp @('target_name', 'target', 'name') 'next'
        $toRem = Get-SafeProp $switchResp @('target_effective_rem', 'rem_7d') $null
        $reasonStr = Get-SafeProp $switchResp @('reason') 'relay'
        $remLabel = if ($null -ne $toRem) { (", {0}% avail" -f $toRem) } else { '' }
        Write-Host ("[Claude-Local Relay] Switched {0} -> {1} ({2}{3})." -f $fromName, $toName, $reasonStr, $remLabel)
        Show-AwaitingResetReminders $switchResp

        $switchFromId = [string](Get-SafeProp $switchResp @('from_record_id', 'fromRecordId') '')
        if (-not $switchFromId -and $postActiveId) { $switchFromId = [string]$postActiveId }
        $sameAccountRelay = [bool]($switchedTargetId -and $switchFromId -and ($switchedTargetId -eq $switchFromId))

        $subagentManifest = ''
        if ($sameAccountRelay) {
            $subagentManifest = Get-InterruptedSubagentsSummary `
                -ClaudeDir $claudeDir `
                -WorkingDir (Get-Location).Path `
                -SessionId $parentSessionId `
                -ContinuedSessionId $continuedSessionId `
                -RunStartUtc $runStartUtc
            if ((-not $effectiveAutoContinue) -and $isInteractiveSession -and $subagentManifest) {
                Write-Host '[Claude-Local Relay] Interrupted subagents detected before --resume:'
                Write-Host $subagentManifest
            }
        }

        if (($relayCount -eq 0) -and (-not $parentSessionId) -and (-not $continuedSessionId) -and (-not [bool]$cliSplit.HadResumeOrContinue) -and ($rawInitialArgs.Count -gt 0)) {
            $effectiveArgs = Merge-RelayArgsBeforeDoubleDash -PrimaryArgs $rawInitialArgs -ExtraFlags $ephemeralExtraArgs
            $lastRelayMeta = @{
                Kind               = 'initial_retry'
                ParentSessionId    = $parentSessionId
                ContinuedSessionId = $continuedSessionId
                HandoffMdPath      = ''
                FallbackUsed       = $false
            }
        } elseif ($sameAccountRelay) {
            # Same account: prefer validated continued-in session if available, falling back to parent on rapid crash.
            $sameTargetId = if ($continuedSessionId) { $continuedSessionId } else { $parentSessionId }
            $knownSessionId = $sameTargetId
            $includeSamePrint = $shouldAutoContinue -and [bool]$cliSplit.HasPrint
            $includeSamePrompt = $shouldAutoContinue
            $effectiveArgs = Build-SameAccountResumeArgs `
                -TargetSessionId $sameTargetId `
                -CliSplit $cliSplit `
                -BasePersistentArgs $basePersistentArgs `
                -EphemeralExtraArgs $ephemeralExtraArgs `
                -IncludePrintFlag $includeSamePrint `
                -IncludePrompt $includeSamePrompt `
                -CustomContinuationPrompt $ContinuationPrompt `
                -FallbackContinuationPrompt $DefaultContinuationPrompt `
                -SubagentManifest $subagentManifest
            $sameKind = if ($continuedSessionId -and $parentSessionId -and ($continuedSessionId -ne $parentSessionId)) {
                'same_continued'
            } elseif ($sameTargetId) {
                'same_parent'
            } else {
                'same_continue'
            }
            $lastRelayMeta = @{
                Kind               = $sameKind
                ParentSessionId    = $parentSessionId
                ContinuedSessionId = $continuedSessionId
                SubagentManifest   = $subagentManifest
                RateLimited        = [bool]$rateLimited
                ProactiveHandoff   = [bool]$proactiveHandoffRelay
                HandoffMdPath      = ''
                FallbackUsed       = $false
            }
        } else {
            # Cross-account relay: always prefer the parent session transcript for summary/fork synthesis; never carry session identity via --resume.
            $crossSrcJsonl = Resolve-CrossAccountTranscriptPath `
                -ClaudeDir $claudeDir `
                -ParentSessionId $parentSessionId `
                -ParentJsonlPath $parentJsonlPath `
                -ContinuedSessionId $continuedSessionId
            $subItemsRaw = Get-InterruptedSubagentsSummary `
                -ClaudeDir $claudeDir `
                -WorkingDir (Get-Location).Path `
                -SessionId $parentSessionId `
                -ContinuedSessionId $continuedSessionId `
                -RunStartUtc $runStartUtc `
                -AsItems
            $subItems = @(@($subItemsRaw) | Where-Object { $_ -is [hashtable] })
            $handoffLiteralsList = New-Object System.Collections.Generic.List[string]
            foreach ($lit in @($parentSessionId, $continuedSessionId, $knownSessionId, $postActiveId, $switchedTargetId, $switchFromId)) {
                if ($lit) { [void]$handoffLiteralsList.Add([string]$lit) }
            }
            foreach ($si in $subItems) {
                $siId = [string](Get-SafeProp $si @('AgentId') '')
                if ($siId) { [void]$handoffLiteralsList.Add($siId) }
            }
            $handoffLiteralsArr = [string[]]$handoffLiteralsList.ToArray()
            $wantPrompt = $shouldAutoContinue -or [bool]$cliSplit.HasPrint

            $forkInfo = $null
            if ($effHandoffMode -eq 'fork_resume') {
                [Console]::Error.WriteLine('[Claude-Local Relay] WARNING: fork_resume carries a sanitized copy of the previous account transcript onto the new account. This raises anti-ban risk (cross-account session linkage). clean_handoff is the recommended default.')
                if ($crossSrcJsonl) { $forkInfo = New-ScrubbedForkTranscript -SourceJsonl $crossSrcJsonl }
                if ($null -eq $forkInfo) {
                    [Console]::Error.WriteLine('[Claude-Local Relay] fork_resume could not sanitize a transcript copy; falling back to clean_handoff.')
                }
            }
            if ($null -ne $forkInfo) {
                $nextArgs = New-Object System.Collections.Generic.List[string]
                [void]$forkCopies.Add([string]$forkInfo.Path)
                [void]$nextArgs.Add('--resume')
                [void]$nextArgs.Add([string]$forkInfo.SessionId)
                [void]$nextArgs.Add('--fork-session')
                if ($shouldAutoContinue -and [bool]$cliSplit.HasPrint) {
                    $pFlag = if ($cliSplit.PrintFlag) { [string]$cliSplit.PrintFlag } else { '--print' }
                    [void]$nextArgs.Add($pFlag)
                }
                foreach ($pArg in $basePersistentArgs) { [void]$nextArgs.Add($pArg) }
                foreach ($eArg in $ephemeralExtraArgs) { [void]$nextArgs.Add($eArg) }
                if ($shouldAutoContinue) {
                    $contText = if ($ContinuationPrompt) { $ContinuationPrompt } else { $DefaultContinuationPrompt }
                    if ('--' -notin $nextArgs) { [void]$nextArgs.Add('--') }
                    [void]$nextArgs.Add($contText)
                }
                Write-Host '[Claude-Local Relay] fork_resume: continuing from a sanitized forked copy of the previous session.'
                $effectiveArgs = $nextArgs.ToArray()
                $lastRelayMeta = @{
                    Kind               = 'fork_resume'
                    ParentSessionId    = $parentSessionId
                    ContinuedSessionId = $continuedSessionId
                    SourceJsonl        = $crossSrcJsonl
                    SwitchResp         = $switchResp
                    SubItems           = $subItems
                    HandoffLiterals    = $handoffLiteralsArr
                    WantPrompt         = [bool]$wantPrompt
                    HandoffMdPath      = ''
                    FallbackUsed       = $false
                }
            } else {
                $cleanRes = Build-CleanHandoffArgs `
                    -SwitchResp $switchResp `
                    -AppDataDir $appDataDir `
                    -SourceJsonl $crossSrcJsonl `
                    -WorkingDir (Get-Location).Path `
                    -SubagentItems $subItems `
                    -Literals $handoffLiteralsArr `
                    -CliSplit $cliSplit `
                    -BasePersistentArgs $basePersistentArgs `
                    -EphemeralExtraArgs $ephemeralExtraArgs `
                    -WantPrompt ([bool]$wantPrompt) `
                    -CustomContinuationPrompt $ContinuationPrompt
                Write-Host '[Claude-Local Relay] clean_handoff: starting a fresh session on the new account with a scrubbed handoff note.'
                $effectiveArgs = [string[]]$cleanRes.Args
                $lastRelayMeta = @{
                    Kind               = 'clean_handoff'
                    ParentSessionId    = $parentSessionId
                    ContinuedSessionId = $continuedSessionId
                    SourceJsonl        = $crossSrcJsonl
                    HandoffMdPath      = [string]$cleanRes.MdPath
                    FallbackUsed       = $false
                }
            }
            $knownSessionId = ''
        }
    }
} finally {
    Show-ScriptDriftWarningIfUpdated
    foreach ($forkCopy in $forkCopies) {
        if ($forkCopy -and (Test-Path -LiteralPath $forkCopy -PathType Leaf)) {
            Remove-Item -LiteralPath $forkCopy -Force -ErrorAction SilentlyContinue
        }
    }
    if ($relayTempDir -and (Test-Path -LiteralPath $relayTempDir -PathType Container)) {
        Remove-Item -LiteralPath $relayTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit 0
