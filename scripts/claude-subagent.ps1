# [INPUT]: Prompt, PromptFile, or piped stdin; optional AccountId/SessionTag/Resume/Model/Effort/OutputFile/MaxWaitSeconds/MaxFailovers/ReadOnly/Status; and claude-local.exe --orchestrate.
# [OUTPUT]: Slot-isolated headless claude.exe execution with expanded credential/telemetry/proxy env scrubbing, fail-closed HTTP proxy preflight, 20s cross-process jitter support, humanized 429/auth failover breather, 429/auth cooldown reporting on slot_release, single same-slot jittered retry without cooldown for -ReadOnly transient mid-response stream drops, -Resume owning-slot discovery, anti-ban cross-slot failover (fresh session on the new slot with a distilled scrubbed handoff prompt: no transcript copy, no session id reuse, no --resume on a non-owning slot; --resume strictly on the owning slot), read-only tool aware mutating guard, and [CL-SLOT-TRACE] footer with account_id.
# [POS]: Independent multi-account subagent runner installed to ~/.local/bin/claude-subagent.ps1; never touches ~/.claude or stops running claude.exe.
# [PROTOCOL]: Update this header and scripts/CLAUDE.md when changing subagent parameters or orchestrator schema.
param(
    [string]$Prompt = '',
    [string]$PromptFile = '',
    [string]$AccountId = '',
    [string]$SessionTag = '',
    [string]$Resume = '',
    [string]$Model = '',
    [string]$Effort = '',
    [string]$OutputFile = '',
    [int]$MaxWaitSeconds = 1800,
    [int]$MaxFailovers = 2,
    [switch]$ReadOnly,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
try {
    $utf8NoBomConsole = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8NoBomConsole
    [Console]::InputEncoding = $utf8NoBomConsole
    $OutputEncoding = $utf8NoBomConsole
} catch {
}

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

function Read-SettingsProxyRaw {
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

    try {
        $sobj = $rawText | ConvertFrom-Json -ErrorAction Stop
        $eobj = Get-SafeProp $sobj @('env') $null
        if ($null -ne $eobj) {
            $cand = [string](Get-SafeProp $eobj $proxyKeys '')
            if ($cand -and $cand.Trim()) { return $cand.Trim() }
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

function Normalize-HttpProxyUri {
    param([string]$ProxyRaw)
    if (-not $ProxyRaw -or -not $ProxyRaw.Trim()) { return '' }
    $candidate = $ProxyRaw.Trim()
    if ($candidate -notmatch '^[a-zA-Z][a-zA-Z0-9+\-.]*://') {
        $candidate = 'http://' + $candidate
    }
    return $candidate
}

function Resolve-EffectiveSlotProxy {
    param(
        [string]$SlotProxy,
        [string]$SlotDir
    )
    if ($SlotProxy -and $SlotProxy.Trim()) { return $SlotProxy.Trim() }
    if ($SlotDir) {
        foreach ($fn in @('settings.local.json', 'settings.json')) {
            $cand = Read-SettingsProxyRaw (Join-Path $SlotDir $fn)
            if ($cand) { return $cand }
        }
    }
    $hostClaudeDir = Join-Path (Get-UserHomeDir) '.claude'
    foreach ($fn in @('settings.local.json', 'settings.json')) {
        $cand = Read-SettingsProxyRaw (Join-Path $hostClaudeDir $fn)
        if ($cand) { return $cand }
    }
    foreach ($ev in @($env:HTTPS_PROXY, $env:HTTP_PROXY, $env:ALL_PROXY, $env:https_proxy, $env:http_proxy, $env:all_proxy)) {
        if ($ev -and $ev.Trim()) { return $ev.Trim() }
    }
    return ''
}

function Assert-LocalProxyReachable {
    param(
        [string]$SlotProxy,
        [string]$SlotDir
    )
    if ($env:CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT -eq '1') { return }
    $proxyRaw = Resolve-EffectiveSlotProxy -SlotProxy $SlotProxy -SlotDir $SlotDir
    if (-not $proxyRaw) {
        if ($env:CLAUDE_LOCAL_ALLOW_DIRECT -eq '1') { return }
        throw '[Claude-Local Subagent] Explicit slot HTTP proxy required (e.g. http://127.0.0.1:7899) to prevent direct IP leak. Set CLAUDE_LOCAL_ALLOW_DIRECT=1 to allow direct/TUN mode or CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT=1 in offline tests.'
    }
    $candidate = Normalize-HttpProxyUri $proxyRaw
    $uri = $null
    if (-not [System.Uri]::TryCreate($candidate, [System.UriKind]::Absolute, [ref]$uri)) {
        throw ("[Claude-Local Subagent] Invalid slot proxy URI '{0}' (expected http://host:port)." -f $proxyRaw)
    }
    $scheme = $uri.Scheme.ToLowerInvariant()
    if ($scheme -notin @('http', 'https')) {
        throw ("[Claude-Local Subagent] Unsupported slot proxy scheme '{0}://' in '{1}' (expected http://host:port)." -f $scheme, $proxyRaw)
    }
    $hostName = $uri.DnsSafeHost.ToLowerInvariant()
    $port = $uri.Port
    if (-not $hostName -or $port -le 0 -or $port -gt 65535) {
        throw ("[Claude-Local Subagent] Invalid slot proxy host or port in '{0}' (expected http://host:port)." -f $proxyRaw)
    }
    $waitMs = if ($hostName -in @('127.0.0.1', 'localhost', '::1')) { 220 } else { 300 }

    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $tcp.BeginConnect($hostName, $port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($waitMs, $false)) {
            throw ("timeout")
        }
        $tcp.EndConnect($iar)
    } catch {
        throw ("[Claude-Local Subagent] Local slot proxy unreachable at {0}:{1} (fail-closed <250ms preflight). Start your local proxy listener or set CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT=1." -f $hostName, $port)
    } finally {
        try { $tcp.Close() } catch {}
    }
}

function Show-SubagentStatus {
    param($StatusResp)
    $cfg = Get-SafeProp $StatusResp @('config') $null
    $maxConc = Get-SafeProp $cfg @('maxSameExitConcurrency') 1
    $pool = Get-SafeProp $StatusResp @('pool', 'pool_summary') $null
    $slotMap = Get-SafeProp $StatusResp @('slot_sessions', 'slotSessions') $null

    Write-Host '=========================================================================='
    Write-Host ' Claude-Local Subagent Slot & Pool Headroom'
    Write-Host '=========================================================================='
    Write-Host (" Max Same-Exit Concurrency : {0}" -f $maxConc)
    if ($null -ne $pool) {
        $ready = Get-SafeProp $pool @('readyCount', 'ready_count') 0
        $low = Get-SafeProp $pool @('lowCount', 'low_count') 0
        $avg5 = Get-SafeProp $pool @('avg5hRemainingPct', 'avg_5h_remaining_pct') 0
        $avg7 = Get-SafeProp $pool @('avgRem7dPct', 'avg_rem_7d_pct') 0
        $cards = Get-SafeProp $pool @('totalManualResetsRemaining', 'total_manual_resets_remaining') 0
        Write-Host (" Pool Headroom             : ready={0}, low={1}, avg5h={2}%, avg7d={3}%, resetCards={4}" -f $ready, $low, $avg5, $avg7, $cards)
    }

    $accts = Get-SafeProp $StatusResp @('accounts') $null
    if ($null -ne $accts -and @($accts).Count -gt 0) {
        Write-Host '--------------------------------------------------------------------------'
        Write-Host (" {0,-18} {1,-8} {2,-8} {3,-7} {4,-22} {5}" -f 'Account', '5h Rem', '7d Rem', 'Slots', 'Proxy', 'Id8')
        foreach ($a in @($accts)) {
            $aid = [string](Get-SafeProp $a @('id', 'record_id') '')
            $aid8 = if ($aid.Length -ge 8) { $aid.Substring(0, 8) } else { $aid }
            $name = [string](Get-SafeProp $a @('name', 'display_name') $aid8)
            if ($name.Length -gt 18) { $name = $name.Substring(0, 17) + '~' }
            $no5h = [bool](Get-SafeProp $a @('no_5h_limit', 'quota_no_5h_limit') $false)
            $rem5 = Get-SafeProp $a @('rem_5h', 'rem5h') $null
            $rem7 = Get-SafeProp $a @('rem_7d', 'rem7d') $null
            $rem5Str = if ($no5h) { 'unlim' } elseif ($null -ne $rem5) { ("{0}%" -f $rem5) } else { '--' }
            $rem7Str = if ($null -ne $rem7) { ("{0}%" -f $rem7) } else { '--' }
            $proxy = [string](Get-SafeProp $a @('proxy') '-')
            if ($proxy.Length -gt 22) { $proxy = $proxy.Substring(0, 21) + '~' }
            $slotEntries = Get-SafeProp $slotMap @($aid) $null
            $slotCnt = if ($null -ne $slotEntries) { @($slotEntries).Count } else {
                $sp = Get-SafeProp $a @('slot_pids', 'active_slots') $null
                if ($null -ne $sp) { @($sp).Count } else { 0 }
            }
            Write-Host (" {0,-18} {1,-8} {2,-8} {3,-7} {4,-22} {5}" -f $name, $rem5Str, $rem7Str, $slotCnt, $proxy, $aid8)
        }
    }
    Write-Host '=========================================================================='
}

function Parse-ClaudeJsonOutput {
    param([string]$RawStdout, [string]$FallbackSession)
    $textOut = ''
    $sessId = $FallbackSession
    $isErr = $false
    $numTurns = 0
    $errFieldText = ''
    $parsedJson = $false
    $trimmed = if ($RawStdout) { $RawStdout.Trim() } else { '' }
    if (-not $trimmed) {
        return @{
            Text       = ''
            SessionId  = $sessId
            IsError    = $false
            NumTurns   = 0
            ErrorText  = ''
            ParsedJson = $false
        }
    }
    try {
        $parsed = $trimmed | ConvertFrom-Json
        $parsedJson = $true
        $items = if ($parsed -is [System.Array]) { @($parsed) } else { @($parsed) }
        $lastResult = $null
        foreach ($item in $items) {
            $sid = [string](Get-SafeProp $item @('session_id', 'sessionId') '')
            if ($sid) { $sessId = $sid }
            $nt = Get-SafeProp $item @('num_turns', 'numTurns') $null
            if ($null -ne $nt) {
                try { $numTurns = [Math]::Max($numTurns, [int]$nt) } catch {}
            }
            $res = Get-SafeProp $item @('result', 'text', 'message') $null
            if ($null -ne $res) {
                if ($res -is [string]) {
                    $lastResult = $res
                } else {
                    $lastResult = ($res | ConvertTo-Json -Depth 10 -Compress)
                }
            }
            $errObj = Get-SafeProp $item @('error') $null
            if ($null -ne $errObj) {
                $errFieldText = if ($errObj -is [string]) { $errObj } else { ($errObj | ConvertTo-Json -Depth 6 -Compress) }
            }
            if ([bool](Get-SafeProp $item @('is_error', 'isError') $false) -or ([string](Get-SafeProp $item @('type') '') -eq 'error')) {
                $isErr = $true
            }
        }
        $textOut = if ($null -ne $lastResult) { $lastResult } else { $trimmed }
    } catch {
        $textOut = $trimmed
    }
    return @{
        Text       = $textOut
        SessionId  = $sessId
        IsError    = $isErr
        NumTurns   = $numTurns
        ErrorText  = $errFieldText
        ParsedJson = $parsedJson
    }
}

function Get-MaxResetDelaySec {
    param([string]$CombinedText)
    if (-not $CombinedText) { return 0 }
    $maxSec = 0

    $resetMatches = [regex]::Matches(
        $CombinedText,
        '(?i)resets?\s+in\s+(?:(\d+)\s*d(?:ays?)?\s*)?(?:(\d+)\s*h(?:ours?|rs?|r)?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?\s*)?(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?'
    )
    foreach ($m in $resetMatches) {
        $d = if ($m.Groups[1].Success) { [int]$m.Groups[1].Value } else { 0 }
        $h = if ($m.Groups[2].Success) { [int]$m.Groups[2].Value } else { 0 }
        $min = if ($m.Groups[3].Success) { [int]$m.Groups[3].Value } else { 0 }
        $s = if ($m.Groups[4].Success) { [int]$m.Groups[4].Value } else { 0 }
        $tot = ($d * 86400) + ($h * 3600) + ($min * 60) + $s
        if ($tot -gt $maxSec) { $maxSec = $tot }
    }

    $retryMatches = [regex]::Matches(
        $CombinedText,
        '(?i)retry[\s_-]*after["'':\s=]+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?|h|hr|hrs|hours?)?'
    )
    foreach ($rm in $retryMatches) {
        $num = [double]$rm.Groups[1].Value
        $unit = if ($rm.Groups[2].Success) { $rm.Groups[2].Value.ToLowerInvariant() } else { 's' }
        $secVal = 0
        if ($unit -like 'ms*' -or $unit -like 'millisecond*') {
            $secVal = [int][Math]::Ceiling($num / 1000.0)
        } elseif ($unit -like 'h*') {
            $secVal = [int][Math]::Ceiling($num * 3600.0)
        } elseif ($unit -like 'm*') {
            $secVal = [int][Math]::Ceiling($num * 60.0)
        } else {
            $secVal = [int][Math]::Ceiling($num)
        }
        if ($secVal -gt $maxSec) { $maxSec = $secVal }
    }

    $jsonMsMatches = [regex]::Matches($CombinedText, '(?i)"retry_after_ms"\s*:\s*(\d+)')
    foreach ($jm in $jsonMsMatches) {
        $secVal = [int][Math]::Ceiling(([double]$jm.Groups[1].Value) / 1000.0)
        if ($secVal -gt $maxSec) { $maxSec = $secVal }
    }

    $jsonSecMatches = [regex]::Matches($CombinedText, '(?i)"retry_after(?:_sec)?"\s*:\s*(\d+)')
    foreach ($js in $jsonSecMatches) {
        $secVal = [int]$js.Groups[1].Value
        if ($secVal -gt $maxSec) { $maxSec = $secVal }
    }

    return $maxSec
}

function Inspect-SubagentFailure {
    param(
        [int]$ChildExit,
        [hashtable]$ParsedOut,
        [string]$RawStdout,
        [string]$RawStderr
    )
    $transientStreamPattern = '(?i)(?:api\s+error\s*:\s*(?:connection\s+lost\s+mid-response|connection\s+error|terminated|premature\s+close|socket\s+hang\s+up|econnreset|etimedout|other\s+side\s+closed)|connection\s+lost\s+mid-response\.\s*the\s+response\s+above\s+may\s+be\s+incomplete|stream\s+(?:closed|ended|aborted|reset)\s+(?:unexpectedly|prematurely|mid-response))'
    $failed = ($ChildExit -ne 0) -or [bool]$ParsedOut.IsError -or ([bool]$ParsedOut.ErrorText)
    if (-not $failed -and (-not [bool]$ParsedOut.ParsedJson) -and $ParsedOut.Text) {
        $trimmedOut = $ParsedOut.Text.Trim()
        $bulletPrefix = '^\s*(?:[\u25CF\u2022\u23FA\uFFFD?]{1,4}\s*)?'
        if ($trimmedOut.Length -le 400 -and ($trimmedOut -match ('(?i)' + $bulletPrefix + '(?:API Error:\s*(?:429|529|401|Connection lost mid-response|Connection error|Terminated|Premature close|Socket hang up|ECONNRESET|ETIMEDOUT|Other side closed)|You''ve hit your limit|You have hit your limit)'))) {
            $failed = $true
        } else {
            $tailLines = @($trimmedOut -split "\r?\n" | Where-Object { $_.Trim() })
            if ($tailLines.Count -gt 0) {
                $lastLine = $tailLines[$tailLines.Count - 1].Trim()
                if ($lastLine.Length -le 300 -and ($lastLine -match ('(?i)' + $bulletPrefix + '(?:API Error:\s*Connection lost mid-response\b.*The response above may be incomplete\.?|API Error:\s*(?:429|529|401)\b|You(?:''ve| have) hit your (?:5-hour |weekly )?limit\b)'))) {
                    $failed = $true
                }
            }
        }
    }
    if (-not $failed) {
        return @{
            RateLimited          = $false
            AuthError            = $false
            TransientStreamError = $false
            RetryAfterSec        = 0
        }
    }

    $combined = (@($ParsedOut.Text, $ParsedOut.ErrorText, $RawStdout, $RawStderr) | Where-Object { $_ }) -join "`n"
    $isRateLimit = [bool]($combined -match '(?i)((?<!\d)429(?!\d)|api\s+error\s*:\s*529\b|"apiErrorStatus"\s*:\s*529\b|rate_limit_error|rate[\s_-]?limit|billing_error|you''ve hit your limit|you have hit your limit|5-hour limit|5h limit|weekly limit|session limit reached|usage limit reached|spend limit|usage credits required|exceeded your current quota|out of extra usage|overloaded_error|\boverloaded\b)')
    $isAuthError = [bool]($combined -match '(?i)(\b401\b|authentication_error|authentication_failed|invalid_grant|oauth token has expired|invalid api key|not logged in|please run /login)')
    $isTransientStream = (-not $isRateLimit) -and (-not $isAuthError) -and [bool]($combined -match $transientStreamPattern)
    $retrySec = if ($isRateLimit -or $isAuthError) { Get-MaxResetDelaySec $combined } else { 0 }

    return @{
        RateLimited          = $isRateLimit
        AuthError            = $isAuthError
        TransientStreamError = $isTransientStream
        RetryAfterSec        = $retrySec
    }
}

$claudeLocalExe = Resolve-ClaudeLocalExe
if ($Status.IsPresent) {
    $statusResp = Invoke-Orchestrate $claudeLocalExe @{ schema = 1; op = 'status' }
    Show-SubagentStatus $statusResp
    exit 0
}

$promptText = ''
if ($PromptFile) {
    if (-not (Test-Path -LiteralPath $PromptFile -PathType Leaf)) {
        throw ("PromptFile not found: " + $PromptFile)
    }
    $resolvedPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path
    $promptText = [System.IO.File]::ReadAllText($resolvedPromptFile, (New-Object System.Text.UTF8Encoding($false)))
} elseif ($Prompt) {
    $promptText = $Prompt
} elseif ([Console]::IsInputRedirected) {
    try {
        $promptText = [Console]::In.ReadToEnd()
    } catch {
        $promptText = ''
    }
}
if ([string]::IsNullOrWhiteSpace($promptText)) {
    throw 'Either -Prompt or -PromptFile must be provided.'
}

function Test-NotReparsePoint {
    param([string]$Path)
    if (-not $Path) { return $false }
    try {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        return (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)
    } catch {
        return $false
    }
}

function Find-ResumeSlotRecordId {
    param([string]$ResumeSessionId)
    if (-not $ResumeSessionId -or ($ResumeSessionId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{3,127}$')) {
        return @{ RecordId = ''; SlotDir = '' }
    }
    $appData = if ($env:APPDATA) { Join-Path $env:APPDATA 'ai.local.claude-local' } else { '' }
    if (-not $appData -or (-not (Test-Path -LiteralPath $appData -PathType Container)) -or (-not (Test-NotReparsePoint $appData))) {
        return @{ RecordId = ''; SlotDir = '' }
    }
    $slotsRoot = Join-Path $appData 'cli-slots'
    if (-not (Test-Path -LiteralPath $slotsRoot -PathType Container) -or (-not (Test-NotReparsePoint $slotsRoot))) {
        return @{ RecordId = ''; SlotDir = '' }
    }
    $bestId = ''
    $bestSlotDir = ''
    $bestUtc = [DateTime]::MinValue
    $targetFileName = $ResumeSessionId + '.jsonl'
    try {
        foreach ($slotEntry in @(Get-ChildItem -LiteralPath $slotsRoot -Directory -ErrorAction SilentlyContinue)) {
            if ($slotEntry.Name -notmatch '^[0-9a-f]{32}$') { continue }
            if (-not (Test-NotReparsePoint $slotEntry.FullName)) { continue }
            $projRoot = Join-Path $slotEntry.FullName 'projects'
            if (-not (Test-Path -LiteralPath $projRoot -PathType Container) -or (-not (Test-NotReparsePoint $projRoot))) { continue }
            foreach ($projDir in @(Get-ChildItem -LiteralPath $projRoot -Directory -ErrorAction SilentlyContinue)) {
                if (-not (Test-NotReparsePoint $projDir.FullName)) { continue }
                $candPath = Join-Path $projDir.FullName $targetFileName
                if ((Test-Path -LiteralPath $candPath -PathType Leaf) -and (Test-NotReparsePoint $candPath)) {
                    $fi = Get-Item -LiteralPath $candPath -Force -ErrorAction SilentlyContinue
                    if ($null -ne $fi -and $fi.Length -gt 0 -and $fi.LastWriteTimeUtc -ge $bestUtc) {
                        $bestUtc = $fi.LastWriteTimeUtc
                        $bestId = $slotEntry.Name
                        $bestSlotDir = $slotEntry.FullName
                    }
                }
            }
        }
    } catch {}
    return @{ RecordId = $bestId; SlotDir = $bestSlotDir }
}

function Find-SlotSessionTranscriptFile {
    param(
        [string]$SlotDir,
        [string]$SessionId
    )
    if (-not $SlotDir -or (-not $SessionId) -or ($SessionId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{3,127}$')) {
        return $null
    }
    if (-not (Test-NotReparsePoint $SlotDir)) { return $null }
    $projRoot = Join-Path $SlotDir 'projects'
    if (-not (Test-Path -LiteralPath $projRoot -PathType Container) -or (-not (Test-NotReparsePoint $projRoot))) {
        return $null
    }
    $targetFileName = $SessionId + '.jsonl'
    try {
        foreach ($projDir in @(Get-ChildItem -LiteralPath $projRoot -Directory -ErrorAction SilentlyContinue)) {
            if (-not (Test-NotReparsePoint $projDir.FullName)) { continue }
            $cand = Join-Path $projDir.FullName $targetFileName
            if ((Test-Path -LiteralPath $cand -PathType Leaf) -and (Test-NotReparsePoint $cand)) {
                $fi = Get-Item -LiteralPath $cand -Force -ErrorAction SilentlyContinue
                if ($null -ne $fi -and $fi.Length -gt 0) {
                    return @{
                        JsonlPath = $fi.FullName
                        SlugName  = $projDir.Name
                        ProjDir   = $projDir.FullName
                    }
                }
            }
        }
    } catch {}
    return $null
}

function Test-SlotSessionHasMutatingToolUse {
    param(
        [string]$SlotDir,
        [string]$SessionId,
        [datetime]$AttemptStartUtc = [DateTime]::MinValue
    )
    if (-not $SlotDir -or (-not (Test-NotReparsePoint $SlotDir))) { return $false }
    $projDir = Join-Path $SlotDir 'projects'
    if (-not (Test-Path -LiteralPath $projDir -PathType Container) -or (-not (Test-NotReparsePoint $projDir))) { return $false }
    $readOnlyTools = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($ro in @('Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool')) {
        [void]$readOnlyTools.Add($ro)
    }
    try {
        $files = @()
        if ($SessionId) {
            $found = Find-SlotSessionTranscriptFile -SlotDir $SlotDir -SessionId $SessionId
            if ($null -ne $found) {
                $files = @(Get-Item -LiteralPath $found.JsonlPath -Force -ErrorAction SilentlyContinue)
            }
        } else {
            $cutoff = if ($AttemptStartUtc -gt [DateTime]::MinValue) { $AttemptStartUtc.AddSeconds(-2) } else { [DateTime]::UtcNow.AddMinutes(-5) }
            foreach ($pd in @(Get-ChildItem -LiteralPath $projDir -Directory -ErrorAction SilentlyContinue)) {
                if (-not (Test-NotReparsePoint $pd.FullName)) { continue }
                $recent = @(Get-ChildItem -LiteralPath $pd.FullName -Filter '*.jsonl' -File -ErrorAction SilentlyContinue |
                    Where-Object { (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) -and $_.LastWriteTimeUtc -ge $cutoff })
                foreach ($rf in $recent) { $files += $rf }
            }
        }
        foreach ($f in $files) {
            if ($null -eq $f) { continue }
            try {
                $lines = @(Get-Content -LiteralPath $f.FullName -Encoding UTF8 -ErrorAction SilentlyContinue)
                foreach ($ln in $lines) {
                    if (-not $ln -or -not $ln.Trim()) { continue }
                    try {
                        $entry = $ln | ConvertFrom-Json
                        $msg = Get-SafeProp $entry @('message') $entry
                        $content = Get-SafeProp $msg @('content') $null
                        if ($null -ne $content -and ($content -isnot [string])) {
                            foreach ($blk in @($content)) {
                                $bType = [string](Get-SafeProp $blk @('type') '')
                                if ($bType -eq 'tool_use') {
                                    $tName = ([string](Get-SafeProp $blk @('name') '')).Trim()
                                    if ((-not $tName) -or (-not $readOnlyTools.Contains($tName))) {
                                        return $true
                                    }
                                }
                            }
                        }
                    } catch {
                        if ($ln -match '"type"\s*:\s*"tool_use"') {
                            $mName = [regex]::Match($ln, '"name"\s*:\s*"([^"]+)"')
                            if ((-not $mName.Success) -or (-not $readOnlyTools.Contains($mName.Groups[1].Value))) {
                                return $true
                            }
                        }
                    }
                }
            } catch {}
        }
    } catch {}
    return $false
}

function Sanitize-TranscriptLines {
    param([string[]]$RawLines)
    $filtered = New-Object System.Collections.ArrayList
    foreach ($ln in $RawLines) {
        if ($null -eq $ln -or -not $ln.Trim()) { continue }
        $parsed = $null
        try { $parsed = $ln | ConvertFrom-Json } catch { $parsed = $null }
        if ($null -ne $parsed) {
            $recType = [string](Get-SafeProp $parsed @('type') '')
            if ($recType -eq 'session-owner' -or $recType -eq 'bridge-session' -or $recType -like 'api-request*') {
                continue
            }
        }
        [void]$filtered.Add(@{ Raw = $ln; Obj = $parsed })
    }

    # Drop trailing synthetic/isApiErrorMessage == true entries (rate_limit / auth / stream-drop errors)
    while ($filtered.Count -gt 0) {
        $last = $filtered[$filtered.Count - 1]
        if ($null -ne $last.Obj) {
            $lastMsg = Get-SafeProp $last.Obj @('message') $last.Obj
            $lastModel = ([string](Get-SafeProp $lastMsg @('model') (Get-SafeProp $last.Obj @('model') ''))).Trim()
            if ([bool](Get-SafeProp $last.Obj @('isApiErrorMessage', 'is_api_error_message') $false) -or ($lastModel -eq '<synthetic>')) {
                $filtered.RemoveAt($filtered.Count - 1)
                continue
            }
        }
        break
    }

    # Collect completed tool_result IDs across all remaining records
    $completedToolIds = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($rec in $filtered) {
        if ($null -eq $rec.Obj) { continue }
        $msg = Get-SafeProp $rec.Obj @('message') $rec.Obj
        $content = Get-SafeProp $msg @('content') $null
        if ($null -ne $content -and ($content -isnot [string])) {
            foreach ($blk in @($content)) {
                $bType = [string](Get-SafeProp $blk @('type') '')
                if ($bType -eq 'tool_result') {
                    $tuid = [string](Get-SafeProp $blk @('tool_use_id', 'toolUseId') '')
                    if ($tuid) { [void]$completedToolIds.Add($tuid) }
                }
            }
        }
    }

    # Drop trailing unpaired tool_use blocks lacking a tool_result
    for ($idx = $filtered.Count - 1; $idx -ge 0; $idx--) {
        $rec = $filtered[$idx]
        if ($null -eq $rec.Obj) { continue }
        $recType = [string](Get-SafeProp $rec.Obj @('type') '')
        if ($recType -eq 'user') { break }
        if ($recType -ne 'assistant') { continue }

        $msg = Get-SafeProp $rec.Obj @('message') $null
        $hasMsgWrapper = ($null -ne $msg)
        $targetObj = if ($hasMsgWrapper) { $msg } else { $rec.Obj }
        $content = Get-SafeProp $targetObj @('content') $null
        if ($null -ne $content -and ($content -isnot [string])) {
            $keptBlocks = New-Object System.Collections.ArrayList
            $removedAny = $false
            foreach ($blk in @($content)) {
                $bType = [string](Get-SafeProp $blk @('type') '')
                if ($bType -eq 'tool_use') {
                    $tid = [string](Get-SafeProp $blk @('id') '')
                    if ((-not $tid) -or (-not $completedToolIds.Contains($tid))) {
                        $removedAny = $true
                        continue
                    }
                }
                [void]$keptBlocks.Add($blk)
            }
            if ($removedAny) {
                if ($keptBlocks.Count -eq 0) {
                    $filtered.RemoveAt($idx)
                } else {
                    $targetObj.content = @($keptBlocks.ToArray())
                    $rec.Raw = ($rec.Obj | ConvertTo-Json -Depth 20 -Compress)
                }
            }
        }
    }

    $hasConversation = $false
    $outLines = New-Object System.Collections.Generic.List[string]
    foreach ($rec in $filtered) {
        [void]$outLines.Add([string]$rec.Raw)
        if ($null -ne $rec.Obj) {
            $rt = [string](Get-SafeProp $rec.Obj @('type') '')
            $rMsg = Get-SafeProp $rec.Obj @('message') $rec.Obj
            $rModel = ([string](Get-SafeProp $rMsg @('model') (Get-SafeProp $rec.Obj @('model') ''))).Trim()
            if (($rt -eq 'user' -or $rt -eq 'assistant') -and (-not [bool](Get-SafeProp $rec.Obj @('isApiErrorMessage', 'is_api_error_message') $false)) -and ($rModel -ne '<synthetic>')) {
                $hasConversation = $true
            }
        }
    }
    return @{
        Lines           = [string[]]$outLines.ToArray()
        HasConversation = $hasConversation
    }
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
    $t = [regex]::Replace($t, '(?i)\b[0-9a-f]{32}\b', '[id]')
    $t = [regex]::Replace($t, '(?i)[^\s"'']*[\\/]\.claude[\\/]projects[\\/][^\s"'']*', '[transcript]')
    $t = [regex]::Replace($t, '(?i)[^\s"'']*[\\/]cli-slots[\\/][^\s"'']*', '[slot]')
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

function Get-DistilledTranscriptDigest {
    param([string]$JsonlPath, [string]$WorkingDir = '', [string[]]$Literals = @())
    $digest = @{ FirstPrompt = ''; Progress = @(); Files = @() }
    if ((-not $JsonlPath) -or (-not (Test-NotReparsePoint $JsonlPath))) { return $digest }

    $editTools = @('Edit', 'Write', 'MultiEdit', 'NotebookEdit')
    $wd = ''
    if ($WorkingDir) { $wd = ($WorkingDir -replace '\\', '/').TrimEnd('/') }
    $firstPrompt = ''
    $progress = New-Object System.Collections.Generic.List[string]
    $files = New-Object System.Collections.Generic.List[string]

    $scanSets = @(
        @{ Lines = @(Read-HandoffTextWindow -Path $JsonlPath -MaxBytes 16384 -Head); HeadOnly = $true },
        @{ Lines = @(Read-HandoffTextWindow -Path $JsonlPath -MaxBytes 262144); HeadOnly = $false }
    )
    foreach ($set in $scanSets) {
        foreach ($ln in $set.Lines) {
            $obj = $null
            try { $obj = $ln | ConvertFrom-Json } catch { $obj = $null }
            if ($null -eq $obj) { continue }
            if ([bool](Get-SafeProp $obj @('isApiErrorMessage', 'is_api_error_message') $false)) { continue }
            $recType = [string](Get-SafeProp $obj @('type') '')
            if ($recType -ne 'user' -and $recType -ne 'assistant') { continue }
            $msg = Get-SafeProp $obj @('message') $obj
            if (([string](Get-SafeProp $msg @('model') (Get-SafeProp $obj @('model') ''))).Trim() -eq '<synthetic>') { continue }
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
                    }
                }
            }
            if ($texts.Count -eq 0) { continue }
            $joined = ($texts -join ' ').Trim()
            if ($recType -eq 'user') {
                if ($joined -match '^(?i)\s*<(?:system-reminder|command-name|command-message|local-command|ide_)') { continue }
                if (-not $firstPrompt) { $firstPrompt = $joined }
            } elseif (-not $set.HeadOnly) {
                [void]$progress.Add($joined)
            }
        }
    }
    $digest.FirstPrompt = Remove-HandoffSensitiveText -Text $firstPrompt -Literals $Literals -MaxLen 1500
    $digest.Progress = @($progress.ToArray() | Select-Object -Last 3 | ForEach-Object { Remove-HandoffSensitiveText -Text $_ -Literals $Literals -MaxLen 600 })
    $digest.Files = @($files.ToArray() | Select-Object -Last 20)
    return $digest
}

function Build-DistilledSlotHandoffPrompt {
    param(
        [string]$SourceSlotDir,
        [string]$SessionId,
        [string]$OriginalPrompt
    )
    if ((-not $SourceSlotDir) -or (-not $SessionId)) { return '' }
    $found = Find-SlotSessionTranscriptFile -SlotDir $SourceSlotDir -SessionId $SessionId
    if ($null -eq $found) { return '' }
    $digest = Get-DistilledTranscriptDigest -JsonlPath $found.JsonlPath -WorkingDir (Get-Location).Path -Literals @($SessionId)
    $hasProgress = (@($digest.Progress).Count -gt 0) -or (@($digest.Files).Count -gt 0)
    if ((-not $hasProgress) -and (-not $digest.FirstPrompt)) { return '' }

    $nl = "`n"
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('[RELAY-HANDOFF] You are a fresh worker continuing a subtask that another worker started and could not finish. There is no earlier conversation to resume; rely only on this scrubbed summary and on the files in the working tree.' + $nl + $nl)
    if ($digest.FirstPrompt) {
        [void]$sb.Append('Earlier task:' + $nl + $digest.FirstPrompt + $nl + $nl)
    }
    [void]$sb.Append('Completed progress so far:' + $nl)
    if (@($digest.Progress).Count -gt 0) {
        foreach ($pg in @($digest.Progress)) { [void]$sb.Append('- ' + (($pg -replace '\s+', ' ').Trim()) + $nl) }
    } else {
        [void]$sb.Append('- (none recorded)' + $nl)
    }
    [void]$sb.Append($nl + 'Files touched so far (relative):' + $nl)
    if (@($digest.Files).Count -gt 0) {
        foreach ($f in @($digest.Files)) { [void]$sb.Append('- ' + $f + $nl) }
    } else {
        [void]$sb.Append('- (none recorded)' + $nl)
    }
    [void]$sb.Append($nl + 'Verify the working tree first, do not repeat completed edits or commands, then finish the remaining work of this task:' + $nl)
    [void]$sb.Append($OriginalPrompt)
    return $sb.ToString()
}

$claudeExe = Resolve-ClaudeExe
$canAutoFailover = (-not $AccountId) -and ($MaxFailovers -gt 0)
$effectiveMaxFailovers = if ($canAutoFailover) { $MaxFailovers } else { 0 }
$triedIds = New-Object System.Collections.Generic.List[string]
$failoverCount = 0
$effectiveResume = $Resume
$effectivePromptText = $promptText

# --resume is only ever passed to the slot that owns the session transcript. Any other slot starts a FRESH
# session with a distilled, scrubbed handoff prompt (no transcript copy, no session id reuse across accounts).
$resumeOwnerRecordId = ''
$resumeOwnerSlotDir = ''
$preferredResumeOwnerId = ''
$preferredResumeOwnerSlotDir = ''
if ($Resume) {
    $ownerInfo = Find-ResumeSlotRecordId -ResumeSessionId $Resume
    if ($ownerInfo.RecordId) {
        $resumeOwnerRecordId = [string]$ownerInfo.RecordId
        $resumeOwnerSlotDir = [string]$ownerInfo.SlotDir
        if (-not $AccountId) {
            $preferredResumeOwnerId = $resumeOwnerRecordId
            $preferredResumeOwnerSlotDir = $resumeOwnerSlotDir
        }
    }
}

$pendingMigrationFromSlotDir = ''
$pendingMigrationSessionId = ''

$finalExitCode = 0
$finalDoc = ''
$finalRawErr = ''
$finalChildExit = 0
$finalParsedIsError = $false
$hasRunResult = $false

$scrubEnvKeys = @(
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
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

for ($failoverIdx = 0; $failoverIdx -le $effectiveMaxFailovers; $failoverIdx++) {
    $acquired = $null
    $maxAcquireRetries = 3
    $acquireUnavailableOnFailover = $false

    $preferOwnerThisIter = ($failoverIdx -eq 0) -and (-not $AccountId) -and [bool]$preferredResumeOwnerId
    if ($preferOwnerThisIter) {
        for ($ownerTry = 0; $ownerTry -le 1; $ownerTry++) {
            $ownerPayload = @{
                schema     = 1
                op         = 'slot_acquire'
                account_id = $preferredResumeOwnerId
                record_id  = $preferredResumeOwnerId
            }
            if ($SessionTag) { $ownerPayload['session_tag'] = $SessionTag }
            $ownerResp = Invoke-Orchestrate $claudeLocalExe $ownerPayload
            $ownerStatus = [string](Get-SafeProp $ownerResp @('status') '')
            $ownerOk = [bool](Get-SafeProp $ownerResp @('ok') $false)
            if ($ownerStatus -eq 'acquired' -or ($ownerOk -and -not $ownerStatus)) {
                $acquired = $ownerResp
                break
            }
            if ($ownerStatus -eq 'concurrency_capped' -and $ownerTry -lt 1) {
                $retryMs = [int](Get-SafeProp $ownerResp @('retry_after_ms') 5000)
                $retryMs = [Math]::Max(50, [Math]::Min(15000, $retryMs))
                Start-Sleep -Milliseconds $retryMs
                continue
            }
            break
        }
        if ($null -eq $acquired) {
            [void]$triedIds.Add($preferredResumeOwnerId)
            $pendingMigrationFromSlotDir = $preferredResumeOwnerSlotDir
            $pendingMigrationSessionId = $effectiveResume
        }
    }

    if ($null -eq $acquired) {
        for ($attempt = 0; $attempt -le $maxAcquireRetries; $attempt++) {
            $acqPayload = @{ schema = 1; op = 'slot_acquire' }
            if ($AccountId) {
                $acqPayload['account_id'] = $AccountId
                $acqPayload['record_id'] = $AccountId
            }
            if ($SessionTag) {
                $acqPayload['session_tag'] = $SessionTag
            }
            if ($triedIds.Count -gt 0) {
                $acqPayload['exclude_record_ids'] = [string[]]$triedIds.ToArray()
            }
            $acqResp = Invoke-Orchestrate $claudeLocalExe $acqPayload
            $acqStatus = [string](Get-SafeProp $acqResp @('status') '')
            $acqOk = [bool](Get-SafeProp $acqResp @('ok') $false)
            if ($acqStatus -eq 'acquired' -or ($acqOk -and -not $acqStatus)) {
                $acquired = $acqResp
                break
            }
            if ($acqStatus -eq 'concurrency_capped') {
                if ($attempt -lt $maxAcquireRetries) {
                    $retryMs = [int](Get-SafeProp $acqResp @('retry_after_ms') 5000)
                    $retryMs = [Math]::Max(50, [Math]::Min(15000, $retryMs))
                    Start-Sleep -Milliseconds $retryMs
                    continue
                }
                if ($failoverIdx -gt 0 -and $hasRunResult) {
                    $acquireUnavailableOnFailover = $true
                    break
                }
                $capReason = [string](Get-SafeProp $acqResp @('reason', 'error') 'relay.error.slotConcurrencyCapped')
                throw ("slot_acquire concurrency_capped after retries: " + $capReason)
            }
            if ($failoverIdx -gt 0 -and $hasRunResult) {
                $acquireUnavailableOnFailover = $true
                break
            }
            $errReason = [string](Get-SafeProp $acqResp @('reason', 'error') 'slot_acquire_failed')
            throw ("slot_acquire failed ({0}): {1}" -f $acqStatus, $errReason)
        }
    }

    if ($acquireUnavailableOnFailover -or $null -eq $acquired) {
        break
    }

    $acquiredId = [string](Get-SafeProp $acquired @('record_id', 'account_id') $AccountId)
    $acquiredName = [string](Get-SafeProp $acquired @('name') $acquiredId)
    $rawSlotDir = [string](Get-SafeProp $acquired @('slot_dir') '')
    $slotProxy = [string](Get-SafeProp $acquired @('proxy') '')
    $jitterMs = [int](Get-SafeProp $acquired @('jitter_ms') 0)

    if (-not $acquiredId) {
        throw 'slot_acquire returned empty record_id.'
    }
    if (-not $rawSlotDir -or -not [IO.Path]::IsPathRooted($rawSlotDir)) {
        try {
            Invoke-Orchestrate $claudeLocalExe @{ schema = 1; op = 'slot_release'; record_id = $acquiredId } | Out-Null
        } catch {}
        throw ("slot_acquire returned non-absolute slot_dir: " + $rawSlotDir)
    }
    $slotDir = [IO.Path]::GetFullPath($rawSlotDir)

    $attemptRateLimited = $false
    $attemptAuthError = $false
    $attemptTransientStreamError = $false
    $attemptRetryAfterSec = 0
    $shouldFailoverNext = $false
    $nextMigFromSlotDir = ''
    $nextMigSessionId = ''

    try {
        $effectiveSlotProxy = Resolve-EffectiveSlotProxy -SlotProxy $slotProxy -SlotDir $slotDir
        Assert-LocalProxyReachable -SlotProxy $effectiveSlotProxy -SlotDir $slotDir

        # Decide per slot: --resume ONLY on the owning slot; every other slot gets a fresh session + distilled handoff.
        $effectivePromptText = $promptText
        $resumeThisAttempt = ''
        $handoffSrcSlotDir = ''
        $handoffSrcSessionId = ''
        if ($pendingMigrationFromSlotDir -and $pendingMigrationSessionId) {
            $handoffSrcSlotDir = $pendingMigrationFromSlotDir
            $handoffSrcSessionId = $pendingMigrationSessionId
        } elseif ($effectiveResume -and $resumeOwnerRecordId -and ($acquiredId -ne $resumeOwnerRecordId)) {
            $handoffSrcSlotDir = $resumeOwnerSlotDir
            $handoffSrcSessionId = $effectiveResume
        } elseif ($effectiveResume -and ((-not $resumeOwnerRecordId) -or ($acquiredId -eq $resumeOwnerRecordId))) {
            $resumeThisAttempt = $effectiveResume
        }
        $pendingMigrationFromSlotDir = ''
        $pendingMigrationSessionId = ''
        if ($handoffSrcSlotDir -and $handoffSrcSessionId -and ([IO.Path]::GetFullPath($handoffSrcSlotDir) -ine $slotDir)) {
            $distilledPrompt = Build-DistilledSlotHandoffPrompt -SourceSlotDir $handoffSrcSlotDir -SessionId $handoffSrcSessionId -OriginalPrompt $promptText
            if ($distilledPrompt) {
                $effectivePromptText = $distilledPrompt
            }
        }

        if ($jitterMs -gt 0) {
            Start-Sleep -Milliseconds ([Math]::Min(20000, $jitterMs))
        }

        $sendPromptOnStdin = $effectivePromptText.StartsWith('-') -or ($effectivePromptText.IndexOf("`n") -ge 0) -or ($effectivePromptText.IndexOf("`r") -ge 0) -or ($effectivePromptText.Length -gt 4000)
        $cliArgs = New-Object System.Collections.Generic.List[string]
        [void]$cliArgs.Add('-p')
        if (-not $sendPromptOnStdin) {
            [void]$cliArgs.Add($effectivePromptText)
        }
        [void]$cliArgs.Add('--output-format')
        [void]$cliArgs.Add('json')
        if ($ReadOnly.IsPresent) {
            [void]$cliArgs.Add('--tools')
            [void]$cliArgs.Add('Read,Grep,Glob')
        }
        if ($Model) {
            [void]$cliArgs.Add('--model')
            [void]$cliArgs.Add($Model)
        }
        if ($Effort) {
            [void]$cliArgs.Add('--effort')
            [void]$cliArgs.Add($Effort)
        }
        if ($resumeThisAttempt) {
            [void]$cliArgs.Add('--resume')
            [void]$cliArgs.Add($resumeThisAttempt)
        }

        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $argString = Format-WinCmdLine ($cliArgs.ToArray())
        if ($claudeExe -match '\.(cmd|bat)$') {
            $psi.FileName = if ($env:ComSpec) { $env:ComSpec } else { 'cmd.exe' }
            $inner = (Format-WinCmdArg $claudeExe) + $(if ($argString) { ' ' + $argString } else { '' })
            $psi.Arguments = '/d /s /c "' + $inner + '"'
        } elseif ($claudeExe -match '\.ps1$') {
            $psHost = (Get-Process -Id $PID).Path
            $psi.FileName = if ($psHost) { $psHost } else { 'powershell.exe' }
            $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File ' + (Format-WinCmdArg $claudeExe) + ' ' + $argString
        } else {
            $psi.FileName = $claudeExe
            $psi.Arguments = $argString
        }

        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.StandardOutputEncoding = $utf8NoBom
        $psi.StandardErrorEncoding = $utf8NoBom

        $proxyEnvKeys = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'GRPC_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'grpc_proxy')
        foreach ($scrubKey in $scrubEnvKeys) {
            $psi.Environment.Remove($scrubKey) | Out-Null
        }
        foreach ($pKey in $proxyEnvKeys) {
            $psi.Environment.Remove($pKey) | Out-Null
        }
        $psi.Environment['CLAUDE_CONFIG_DIR'] = $slotDir
        $normalizedSlotProxy = Normalize-HttpProxyUri $effectiveSlotProxy
        if ($normalizedSlotProxy) {
            foreach ($pKey in $proxyEnvKeys) {
                $psi.Environment[$pKey] = $normalizedSlotProxy
            }
        }
        foreach ($npKey in @('NO_PROXY', 'no_proxy')) {
            $psi.Environment[$npKey] = 'localhost,127.0.0.1,::1'
        }
        $psi.Environment['DISABLE_TELEMETRY'] = '1'
        $psi.Environment['DISABLE_ERROR_REPORTING'] = '1'
        $psi.Environment['DO_NOT_TRACK'] = '1'

        $softWaitSec = if ($MaxWaitSeconds -gt 30) { $MaxWaitSeconds - 30 } else { [Math]::Max(1, $MaxWaitSeconds) }
        $slotDeadlineUtc = [DateTime]::UtcNow.AddSeconds($softWaitSec)
        $maxStreamRetries = if ($ReadOnly.IsPresent) { 1 } else { 0 }
        $resumeTranscriptPathBefore = ''
        $resumeTranscriptExistedBefore = $false
        $resumeTranscriptLenBefore = [int64]-1
        $resumeTranscriptTicksBefore = [int64]0
        if ($resumeThisAttempt) {
            $beforeResumeInfo = Find-SlotSessionTranscriptFile -SlotDir $slotDir -SessionId $resumeThisAttempt
            if ($null -ne $beforeResumeInfo -and $beforeResumeInfo.JsonlPath) {
                $resumeTranscriptPathBefore = [string]$beforeResumeInfo.JsonlPath
                try {
                    $bfi = Get-Item -LiteralPath $resumeTranscriptPathBefore -Force -ErrorAction Stop
                    $resumeTranscriptExistedBefore = $true
                    $resumeTranscriptLenBefore = [int64]$bfi.Length
                    $resumeTranscriptTicksBefore = [int64]$bfi.LastWriteTimeUtc.Ticks
                } catch {}
            }
        }
        $attemptStartUtc = [DateTime]::UtcNow
        $childExit = 0
        $rawOut = ''
        $rawErr = ''
        $parsedOut = $null
        $failureInfo = $null

        for ($streamTry = 0; $streamTry -le $maxStreamRetries; $streamTry++) {
            $remWaitSec = [int][Math]::Ceiling(($slotDeadlineUtc - [DateTime]::UtcNow).TotalSeconds)
            if ($streamTry -gt 0 -and $remWaitSec -lt 1) {
                break
            }
            $waitBudgetSec = [Math]::Max(1, $remWaitSec)
            $attemptStartUtc = [DateTime]::UtcNow
            $proc = [System.Diagnostics.Process]::Start($psi)
            if ($null -eq $proc) {
                throw ("Failed to start claude.exe: " + $claudeExe)
            }
            try {
                if ($sendPromptOnStdin) {
                    $sw = New-Object System.IO.StreamWriter($proc.StandardInput.BaseStream, $utf8NoBom)
                    $sw.Write($effectivePromptText)
                    $sw.Flush()
                    $sw.Close()
                } else {
                    $proc.StandardInput.Close()
                }

                $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
                $stderrTask = $proc.StandardError.ReadToEndAsync()
                $completed = $proc.WaitForExit($waitBudgetSec * 1000)
                if (-not $completed) {
                    try { & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null } catch {}
                    try { if (-not $proc.HasExited) { $proc.Kill() } } catch {}
                    try { $null = $proc.WaitForExit(3000) } catch {}
                    throw ("Subagent execution exceeded soft watchdog (" + $softWaitSec + "s).")
                }
                $childExit = [int]$proc.ExitCode
                $rawOut = $stdoutTask.GetAwaiter().GetResult()
                $rawErr = $stderrTask.GetAwaiter().GetResult()
            } finally {
                try {
                    if (-not $proc.HasExited) {
                        try { & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null } catch {}
                        try { if (-not $proc.HasExited) { $proc.Kill() } } catch {}
                        try { $null = $proc.WaitForExit(3000) } catch {}
                    }
                } catch {}
                $proc.Dispose()
            }

            $parsedOut = Parse-ClaudeJsonOutput $rawOut $resumeThisAttempt
            $failureInfo = Inspect-SubagentFailure -ChildExit $childExit -ParsedOut $parsedOut -RawStdout $rawOut -RawStderr $rawErr
            $attemptRateLimited = [bool]$failureInfo.RateLimited
            $attemptAuthError = [bool]$failureInfo.AuthError
            $attemptTransientStreamError = [bool]$failureInfo.TransientStreamError
            $attemptRetryAfterSec = [int]$failureInfo.RetryAfterSec

            if ($ReadOnly.IsPresent -and $attemptTransientStreamError -and (-not $attemptRateLimited) -and (-not $attemptAuthError) -and ($streamTry -lt $maxStreamRetries)) {
                $resumeMutated = $false
                if ($resumeThisAttempt) {
                    $afterResumeInfo = Find-SlotSessionTranscriptFile -SlotDir $slotDir -SessionId $resumeThisAttempt
                    if ($resumeTranscriptExistedBefore) {
                        $checkResumePath = if ($null -ne $afterResumeInfo -and $afterResumeInfo.JsonlPath) { [string]$afterResumeInfo.JsonlPath } else { $resumeTranscriptPathBefore }
                        try {
                            $afi = Get-Item -LiteralPath $checkResumePath -Force -ErrorAction Stop
                            if ([int64]$afi.Length -ne $resumeTranscriptLenBefore -or [int64]$afi.LastWriteTimeUtc.Ticks -ne $resumeTranscriptTicksBefore) {
                                $resumeMutated = $true
                            }
                        } catch {
                            $resumeMutated = $true
                        }
                    } elseif ($null -ne $afterResumeInfo) {
                        $resumeMutated = $true
                    }
                }
                if ($resumeMutated) {
                    [Console]::Error.WriteLine(("[Claude-Local Subagent] Skipped same-slot -Resume retry on {0} because resumed transcript was mutated during the interrupted turn." -f $acquiredName))
                    break
                }
                $backoffMs = if ($env:CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT -eq '1') { 50 } else { Get-Random -Minimum 2500 -Maximum 5001 }
                $minRemainingMs = if ($env:CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT -eq '1') { $backoffMs } else { $backoffMs + 5000 }
                if (($slotDeadlineUtc - [DateTime]::UtcNow).TotalMilliseconds -gt $minRemainingMs) {
                    [Console]::Error.WriteLine(("[Claude-Local Subagent] Transient mid-response stream loss on read-only slot {0}; retrying once on the same slot in {1:N1}s without cooldown..." -f $acquiredName, ($backoffMs / 1000.0)))
                    Start-Sleep -Milliseconds $backoffMs
                    Assert-LocalProxyReachable -SlotProxy $effectiveSlotProxy -SlotDir $slotDir
                    continue
                }
            }
            break
        }

        $turnsInt = [int]$parsedOut.NumTurns
        $hasMutating = Test-SlotSessionHasMutatingToolUse -SlotDir $slotDir -SessionId $parsedOut.SessionId -AttemptStartUtc $attemptStartUtc
        $noMutatingTurn = ($turnsInt -eq 0) -or (($turnsInt -eq 1) -and (-not $hasMutating))
        $transcriptInfo = if ($parsedOut.SessionId) { Find-SlotSessionTranscriptFile -SlotDir $slotDir -SessionId $parsedOut.SessionId } else { $null }
        $canMigrateTranscript = $false
        if ($null -ne $transcriptInfo) {
            try {
                $candLines = @(Get-Content -LiteralPath $transcriptInfo.JsonlPath -Encoding UTF8 -ErrorAction SilentlyContinue)
                $candSan = Sanitize-TranscriptLines -RawLines $candLines
                $canMigrateTranscript = [bool]($candSan.HasConversation -and $candSan.Lines.Count -gt 0)
            } catch {
                $canMigrateTranscript = $false
            }
        }
        $safeToFailover = $ReadOnly.IsPresent -or $noMutatingTurn -or $canMigrateTranscript
        if ($canAutoFailover -and ($attemptRateLimited -or $attemptAuthError) -and $safeToFailover -and ($failoverIdx -lt $effectiveMaxFailovers)) {
            $shouldFailoverNext = $true
            [void]$triedIds.Add($acquiredId)
            if ($canMigrateTranscript) {
                $nextMigFromSlotDir = $slotDir
                $nextMigSessionId = $parsedOut.SessionId
            }
        }

        $slotId8 = if ($acquiredId.Length -ge 8) { $acquiredId.Substring(0, 8) } else { $acquiredId }
        $sessUuid = if ($parsedOut.SessionId) { $parsedOut.SessionId } else { 'unknown' }
        $footer = ("[CL-SLOT-TRACE] account={0} slot={1} session={2} failovers={3} account_id={4}" -f $acquiredName, $slotId8, $sessUuid, $failoverCount, $acquiredId)

        $bodyText = $parsedOut.Text
        if (-not $bodyText -and $rawErr) {
            $bodyText = $rawErr.Trim()
        }
        $lf = [string][char]10
        $normalizedBody = if ($bodyText) { ($bodyText -replace "`r`n", "`n").TrimEnd("`r", "`n") } else { '' }
        $finalDoc = if ($normalizedBody) { $normalizedBody + $lf + $lf + $footer } else { $footer }
        $finalRawErr = $rawErr
        $finalChildExit = $childExit
        $finalParsedIsError = [bool]$parsedOut.IsError -or $attemptRateLimited -or $attemptAuthError -or $attemptTransientStreamError
        $hasRunResult = $true
    } finally {
        if ($acquiredId) {
            try {
                $relPayload = @{ schema = 1; op = 'slot_release'; record_id = $acquiredId }
                if ($attemptRateLimited) { $relPayload['rate_limited'] = $true }
                if ($attemptAuthError) { $relPayload['auth_error'] = $true }
                if ($attemptRetryAfterSec -gt 0) { $relPayload['retry_after_sec'] = [int]$attemptRetryAfterSec }
                Invoke-Orchestrate $claudeLocalExe $relPayload | Out-Null
            } catch {
                Write-Warning ("[Claude-Local Subagent] slot_release failed for {0}: {1}" -f $acquiredId, $_.Exception.Message)
            }
        }
    }

    if ($shouldFailoverNext) {
        if ($nextMigFromSlotDir -and $nextMigSessionId) {
            $pendingMigrationFromSlotDir = $nextMigFromSlotDir
            $pendingMigrationSessionId = $nextMigSessionId
        }
        $failoverCount++
        $failoverSleepMs = if ($env:CLAUDE_LOCAL_SKIP_PROXY_PREFLIGHT -eq '1') { 50 } else { Get-Random -Minimum 2500 -Maximum 4801 }
        Start-Sleep -Milliseconds $failoverSleepMs
        continue
    }
    break
}

if ($OutputFile) {
    $utf8Out = New-Object System.Text.UTF8Encoding($false)
    $lf = [string][char]10
    $outFull = [IO.Path]::GetFullPath($OutputFile)
    $outParent = Split-Path -Parent $outFull
    if ($outParent -and -not (Test-Path -LiteralPath $outParent)) {
        New-Item -ItemType Directory -Path $outParent -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($outFull, $finalDoc + $lf, $utf8Out)
}

Write-Output $finalDoc
if ($finalChildExit -ne 0) {
    if ($finalRawErr) { [Console]::Error.WriteLine($finalRawErr.TrimEnd()) }
    $finalExitCode = $finalChildExit
} elseif ($finalParsedIsError) {
    $finalExitCode = 1
}

exit $finalExitCode
