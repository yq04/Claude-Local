# [INPUT]: Existing NSIS compiler, current upgrade hook and an optional generated Tauri installer script.
# [OUTPUT]: A compile-only three-language fixture and optional real-template MUI/data-retention compatibility report.
# [POS]: Synthetic installer integration check; never executes an installer/uninstaller or changes the registry/processes.
# [PROTOCOL]: Keep generated fixtures ignored; update scripts/CLAUDE.md with changes.
#Requires -Version 7.0
[CmdletBinding()]
param([string]$MakensisPath, [string]$TauriScript)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $MakensisPath) {
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($command) { $MakensisPath = $command.Source }
    else { $MakensisPath = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe' }
}
if (-not (Test-Path -LiteralPath $MakensisPath -PathType Leaf)) {
    throw 'An existing NSIS compiler is required; this check does not download tools.'
}
$MakensisPath = [IO.Path]::GetFullPath($MakensisPath)
if ([IO.Path]::GetFileName($MakensisPath) -ine 'makensis.exe') {
    throw 'Select makensis.exe, not an application installer or uninstaller.'
}
$hook = Join-Path $repoRoot 'src-tauri/windows/installer-hooks.nsh'
$output = Join-Path $repoRoot ('.local/installer-tests/' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $output) { throw 'Refusing to reuse a test-output directory.' }
[IO.Directory]::CreateDirectory($output) | Out-Null
$fixture = Join-Path $output 'fixture.nsi'
$fixtureExe = Join-Path $output 'compile-only.exe'
function ConvertTo-NsisPath([string]$Value) { return $Value.Replace('$', '$$').Replace('"', '$\"') }
$body = @'
Unicode true
Name "Claude-Local compile-only upgrade fixture"
OutFile "@OUTPUT@"
RequestExecutionLevel user
!include MUI2.nsh
!include FileFunc.nsh
!include Win\RestartManager.nsh
!include "@HOOK@"
; Match the real Tauri include order: its shared variables are declared afterwards.
Var UpdateMode
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "TradChinese"
; Entry guards also make accidental execution of this synthetic artifact harmless.
Function .onInit
  StrCpy $UpdateMode 0
  Quit
FunctionEnd
Function un.onInit
  StrCpy $UpdateMode 0
  Quit
FunctionEnd
Section "Compile-only payload"
  !insertmacro NSIS_HOOK_POSTINSTALL
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd
Section Uninstall
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd
'@
$body = $body.Replace('@OUTPUT@', (ConvertTo-NsisPath $fixtureExe)).Replace('@HOOK@', (ConvertTo-NsisPath $hook))
[IO.File]::WriteAllText($fixture, $body, [Text.UTF8Encoding]::new($false))
$compilerOutput = @(& $MakensisPath '/WX' '/INPUTCHARSET' 'UTF8' '/V2' $fixture 2>&1)
$compileExit = $LASTEXITCODE
$compilerOutput | Set-Content -LiteralPath (Join-Path $output 'compile.log') -Encoding utf8
if ($compileExit -ne 0 -or -not (Test-Path -LiteralPath $fixtureExe -PathType Leaf)) {
    throw ('NSIS fixture compilation failed: ' + ($compilerOutput -join "`n"))
}
$templateChecked = $false
if ($TauriScript) {
    $TauriScript = [IO.Path]::GetFullPath($TauriScript)
    $template = [IO.File]::ReadAllText($TauriScript)
    # /UPDATE on the OLD uninstaller must suppress its app-data removal branch.
    if ($template -notmatch '(?s)\$\{If\}\s+\$DeleteAppDataCheckboxState\s*=\s*1\s+\$\{AndIf\}\s+\$UpdateMode\s*<>\s*1') {
        throw 'The selected Tauri template no longer provides the reviewed update/data-retention guard.'
    }
    # Compile the real template with synthetic bytes instead of copying application payloads.
    # Unconditional entry guards make both generated programs safe if accidentally opened.
    $payload = Join-Path $output 'synthetic.bin'
    [IO.File]::WriteAllText($payload, 'Synthetic compile payload only.', [Text.UTF8Encoding]::new($false))
    $tauriFixture = Join-Path $output 'tauri-fixture.nsi'
    $tauriExe = Join-Path $output 'tauri-compile-only.exe'
    $templateDir = Split-Path -Parent $TauriScript
    foreach ($include in @('utils.nsh', 'FileAssociation.nsh')) {
        $includePath = ConvertTo-NsisPath (Join-Path $templateDir $include)
        $template = $template.Replace(('!include "' + $include + '"'), ('!include "' + $includePath + '"'))
    }
    $outLine = '!define OUTFILE "' + (ConvertTo-NsisPath $tauriExe) + '"'
    $fileLine = 'File /oname=synthetic.bin "' + (ConvertTo-NsisPath $payload) + '"'
    $template = [regex]::Replace($template, '(?m)^!define OUTFILE[^\r\n]*', { param($match) $outLine })
    $template = [regex]::Replace($template, '(?m)^\s*File\s+[^\r\n]*', { param($match) $fileLine })
    $template = [regex]::Replace($template, '(?m)^Function (?:\.onInit|un\.onInit)\r?$', { param($match) $match.Value + "`n  Quit" })
    [IO.File]::WriteAllText($tauriFixture, $template, [Text.UTF8Encoding]::new($false))
    $tauriOutput = @(& $MakensisPath '/WX' '/INPUTCHARSET' 'UTF8' '/V2' $tauriFixture 2>&1)
    $tauriExit = $LASTEXITCODE
    $tauriOutput | Set-Content -LiteralPath (Join-Path $output 'tauri-compile.log') -Encoding utf8
    if ($tauriExit -ne 0 -or -not (Test-Path -LiteralPath $tauriExe -PathType Leaf)) {
        throw ('Actual Tauri template fixture compilation failed: ' + ($tauriOutput -join "`n"))
    }
    $templateChecked = $true
}
$result = [ordered]@{result='pass'; languages=@('English','SimpChinese','TradChinese'); warningsAsErrors=$true
    templateChecked=$templateChecked; installerExecuted=$false; registryChanges=$false; processStops=$false; output=$output}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'result.json') -Encoding utf8
$result | ConvertTo-Json
