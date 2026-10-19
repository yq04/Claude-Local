; [INPUT]: Tauri NSIS 的当前用户安装目录、本地 claude-local.exe 与独立 Claude-Local-Browser 名称空间。
; [OUTPUT]: 本地浏览器独立启动项及卸载时仅本地版注册项清理。
; [POS]: 安装器窄钩子；不执行 SSH，不删除资料，不改其他浏览器关联。
; [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SMPROGRAMS\Claude-Local-Browser.lnk" "$INSTDIR\claude-local.exe" "--browser" "$INSTDIR\browser-runtime\icons\browser.ico" 0
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\Claude-Local-Browser.lnk"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Claude-Local-Browser"
  DeleteRegKey HKCU "Software\Classes\Claude-Local-Browser.URL"
  DeleteRegKey HKCU "Software\Classes\Claude-Local-Browser.HTML"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Claude-Local-Browser"
!macroend
