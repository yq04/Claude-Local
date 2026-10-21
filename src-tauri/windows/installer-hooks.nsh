; [INPUT]: 当前用户 Claude-Local 卸载注册项、其专用安装目录与本地浏览器运行文件。
; [OUTPUT]: 新安装前显式卸载旧版（/UPDATE 保留资料），并维护本地浏览器快捷方式/注册项。
; [POS]: MUI GUI 初始化时的窄升级钩子；只读检查进程占用，不结束进程、不执行注册表提供的任意命令。
; [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

!define /ifndef CLAUDELOCAL_ERROR_MORE_DATA 234
Var CLUpgradeOldDir
Var CLUpgradeUninstallString
Var CLUpgradeExitCode
Var CLUpgradeRMHandle
Var CLUpgradeCheckResult
Var CLUpgradeQuote

LangString CLUpgradeConfirm 1033 "An existing Claude-Local installation was found. Uninstall it now before installing this version? Your accounts, vault, quota and usage history, browser profiles, and settings will be kept."
LangString CLUpgradeConfirm 2052 "检测到已有 Claude-Local。是否先卸载旧版再安装此版本？账号、保险库、额度与用量记录、浏览器资料和设置均会保留。"
LangString CLUpgradeConfirm 1028 "偵測到現有的 Claude-Local。是否先解除安裝舊版再安裝此版本？帳號、保險庫、額度與用量紀錄、瀏覽器設定檔和設定均會保留。"
LangString CLUpgradeBusy 1033 "Claude-Local or its bundled browser is still using an installation file. Close Claude-Local and its bundled browser, then choose Retry. The installer will not close them for you."
LangString CLUpgradeBusy 2052 "Claude-Local 或内置浏览器仍在使用安装文件。请关闭 Claude-Local 和内置浏览器后选择“重试”。安装程序不会替你结束进程。"
LangString CLUpgradeBusy 1028 "Claude-Local 或內建瀏覽器仍在使用安裝檔案。請關閉 Claude-Local 和內建瀏覽器後選擇「重試」。安裝程式不會替你結束處理程序。"
LangString CLUpgradeInvalid 1033 "The existing Claude-Local installation record is incomplete or unsafe to verify. Setup will stop without changing it."
LangString CLUpgradeInvalid 2052 "已有 Claude-Local 安装记录不完整或无法安全验证。安装程序将停止且不会更改该安装。"
LangString CLUpgradeInvalid 1028 "現有的 Claude-Local 安裝記錄不完整或無法安全驗證。安裝程式將停止且不會變更該安裝。"
LangString CLUpgradeFailed 1033 "The old version was not fully removed. Setup will stop before installing the new version."
LangString CLUpgradeFailed 2052 "旧版未能完整卸载。安装程序将在安装新版前停止。"
LangString CLUpgradeFailed 1028 "舊版未能完整解除安裝。安裝程式將在安裝新版前停止。"

!define MUI_CUSTOMFUNCTION_GUIINIT ClaudeLocalUpgradeBeforeWelcome

; Restart Manager is only queried. Never call RmShutdown here.
!macro CLAUDELOCAL_CHECK_UPGRADE_FILE filePath
  !define CLAUDELOCAL_CHECK_ID ${__LINE__}
  IfFileExists "${filePath}" 0 cl_upgrade_file_done_${CLAUDELOCAL_CHECK_ID}
  System::Call 'RSTRTMGR::RmRegisterResources(i $CLUpgradeRMHandle, i 1, *w "${filePath}", i 0, p 0, i 0, p 0) i.r0'
  ${If} $0 != 0
    StrCpy $CLUpgradeCheckResult 2
    Goto cl_upgrade_rm_done
  ${EndIf}
  System::Call 'RSTRTMGR::RmGetList(i $CLUpgradeRMHandle, *i .r1, *i .r2, p 0, *i .r3) i.r0'
  ${If} $0 == ${CLAUDELOCAL_ERROR_MORE_DATA}
    StrCpy $CLUpgradeCheckResult 1
    Goto cl_upgrade_rm_done
  ${ElseIf} $0 != 0
    StrCpy $CLUpgradeCheckResult 2
    Goto cl_upgrade_rm_done
  ${EndIf}
  cl_upgrade_file_done_${CLAUDELOCAL_CHECK_ID}:
  !undef CLAUDELOCAL_CHECK_ID
!macroend

Function ClaudeLocalUpgradeCheckFiles
  StrCpy $CLUpgradeCheckResult 0
  !insertmacro RestartManager_StartSession $CLUpgradeRMHandle
  ${If} $CLUpgradeRMHandle == ""
    StrCpy $CLUpgradeCheckResult 2
    Return
  ${EndIf}
  !insertmacro CLAUDELOCAL_CHECK_UPGRADE_FILE "$CLUpgradeOldDir\claude-local.exe"
  !insertmacro CLAUDELOCAL_CHECK_UPGRADE_FILE "$CLUpgradeOldDir\browser-runtime\WindowsBrowser\chrome.exe"
  !insertmacro CLAUDELOCAL_CHECK_UPGRADE_FILE "$CLUpgradeOldDir\browser-runtime\WindowsBrowser\chrome.dll"
  cl_upgrade_rm_done:
  !insertmacro RestartManager_EndSession $CLUpgradeRMHandle
FunctionEnd

Function ClaudeLocalUpgradeBeforeWelcome
  ; The hook is included before Tauri's PRODUCTNAME/Var declarations, so use fixed
  ; product registry names and private variables here.
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Claude-Local" "DisplayName"
  ReadRegStr $CLUpgradeOldDir HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Claude-Local" "InstallLocation"
  ReadRegStr $CLUpgradeUninstallString HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Claude-Local" "UninstallString"
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Claude-Local" "MainBinaryName"

  ${If} $R0 == ""
  ${AndIf} $CLUpgradeOldDir == ""
  ${AndIf} $CLUpgradeUninstallString == ""
  ${AndIf} $R1 == ""
    Return
  ${EndIf}

  ; Tauri writes InstallLocation and UninstallString quoted. Accept only that exact
  ; pair, the expected product identity, and the expected executable in the folder.
  IntFmt $CLUpgradeQuote "%c" 34
  StrCpy $R2 $CLUpgradeOldDir 1
  StrCpy $R3 $CLUpgradeOldDir 1 -1
  StrCmp $R2 $CLUpgradeQuote 0 cl_upgrade_invalid
  StrCmp $R3 $CLUpgradeQuote 0 cl_upgrade_invalid
  StrCpy $CLUpgradeOldDir $CLUpgradeOldDir -1 1
  StrCpy $R2 $CLUpgradeOldDir 1
  StrCpy $R3 $CLUpgradeOldDir 1 1
  StrCmp $R2 "" cl_upgrade_invalid
  StrCmp $R3 ":" 0 cl_upgrade_invalid
  StrCpy $R3 $CLUpgradeOldDir 1 2
  StrCmp $R3 "\" 0 cl_upgrade_invalid
  StrCpy $R3 $CLUpgradeOldDir 1
  StrCpy $R4 "$R3:\"
  StrCmp $CLUpgradeOldDir $R4 cl_upgrade_invalid
  GetFullPathName $R4 "$CLUpgradeOldDir"
  StrCmp $CLUpgradeOldDir $R4 0 cl_upgrade_invalid
  StrCpy $R2 "$CLUpgradeQuote$CLUpgradeOldDir\uninstall.exe$CLUpgradeQuote"
  StrCmp $R0 "Claude-Local" 0 cl_upgrade_invalid
  StrCmp $R1 "claude-local.exe" 0 cl_upgrade_invalid
  StrCmp $CLUpgradeUninstallString $R2 0 cl_upgrade_invalid
  IfFileExists "$CLUpgradeOldDir\uninstall.exe" 0 cl_upgrade_invalid
  IfFileExists "$CLUpgradeOldDir\claude-local.exe" 0 cl_upgrade_invalid

  MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION "$(CLUpgradeConfirm)" IDYES cl_upgrade_confirmed
  Quit

  cl_upgrade_confirmed:
  cl_upgrade_check_retry:
  Call ClaudeLocalUpgradeCheckFiles
  ${If} $CLUpgradeCheckResult = 1
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CLUpgradeBusy)" IDRETRY cl_upgrade_check_retry
    Quit
  ${ElseIf} $CLUpgradeCheckResult != 0
    MessageBox MB_OK|MB_ICONSTOP "$(CLUpgradeInvalid)"
    Quit
  ${EndIf}

  StrCpy $R2 "$CLUpgradeQuote$CLUpgradeOldDir\uninstall.exe$CLUpgradeQuote /UPDATE _?=$CLUpgradeOldDir"
  ClearErrors
  ExecWait "$R2" $CLUpgradeExitCode
  IfErrors cl_upgrade_failed
  ${If} $CLUpgradeExitCode != 0
    Goto cl_upgrade_failed
  ${EndIf}
  IfFileExists "$CLUpgradeOldDir\claude-local.exe" cl_upgrade_failed 0
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Claude-Local" "DisplayName"
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Claude-Local" "UninstallString"
  ReadRegStr $R2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Claude-Local" "InstallLocation"
  ReadRegStr $R3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Claude-Local" "MainBinaryName"
  ${If} $R0 != ""
  ${OrIf} $R1 != ""
  ${OrIf} $R2 != ""
  ${OrIf} $R3 != ""
    Goto cl_upgrade_failed
  ${EndIf}
  Return

  cl_upgrade_invalid:
  MessageBox MB_OK|MB_ICONSTOP "$(CLUpgradeInvalid)"
  Quit
  cl_upgrade_failed:
  MessageBox MB_OK|MB_ICONSTOP "$(CLUpgradeFailed)"
  Quit
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SMPROGRAMS\Claude-Local-Browser.lnk" "$INSTDIR\claude-local.exe" "--browser" "$INSTDIR\browser-runtime\icons\browser.ico" 0
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\Claude-Local-Browser.lnk"
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Claude-Local-Browser"
    DeleteRegKey HKCU "Software\Classes\Claude-Local-Browser.URL"
    DeleteRegKey HKCU "Software\Classes\Claude-Local-Browser.HTML"
    DeleteRegValue HKCU "Software\RegisteredApplications" "Claude-Local-Browser"
  ${EndIf}
!macroend
