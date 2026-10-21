# [INPUT]: 原生白名单传入的语言/区域环境变量与 Windows International 模块。
# [OUTPUT]: 当前用户首选语言和区域格式的真实写入核验；显示语言需要登录会话重新载入。
# [POS]: 电脑环境的内嵌执行层；保留其他语言和输入法，不修改系统账户、定位或系统策略。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+';'+$env:PSModulePath
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
$tag=$env:CC_REGION_LANGUAGE
$format=$env:CC_REGION_LOCALE
$before=Get-WinUserLanguageList
$target=New-WinUserLanguageList $tag
foreach($language in $before) {
    if($language.LanguageTag -ieq $tag) { $target.RemoveAt(0); $target.Insert(0,$language) }
    else { $target.Add($language) }
}
Set-WinUserLanguageList $target -Force
Set-WinUILanguageOverride -Language $tag
if($format) { Set-Culture -CultureInfo $format }
$actual=Get-WinUserLanguageList
if($actual[0].LanguageTag -ine $tag) { throw 'Windows 首选语言修改未通过核验。' }
if((Get-WinUILanguageOverride).Name -ine $tag) { throw 'Windows 显示语言偏好修改未通过核验。' }
# 新 PowerShell 会话才能观察 Set-Culture 的持久化结果；原生调用方另行复核。
Write-Output 'CC_REGION_DONE=1'
