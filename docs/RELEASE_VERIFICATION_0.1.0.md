<!--
[INPUT]: Source ff6bc81, passing Windows CI, neutral custom-protocol NSIS build, extracted payload audit, local alignment and GitHub asset metadata.
[OUTPUT]: Exact 0.1.0 private prerelease delivery receipt and explicit acceptance limits.
[POS]: Release verification; private probes, machine paths and backup plans remain in ignored .local/.
-->
# Claude-Local 0.1.0 交付核验

日期：2026-10-26。本版已完成本机更新、安装器打包和当前私有仓库的预发布上传；没有更改仓库可见性，也没有删除旧标签、历史发行或待确认的内部文档。

## 发布与校验

- [0.1.0 预发布页面](https://github.com/yq04/Claude-Local/releases/tag/v0.1.0)
- [Windows x64 安装器](https://github.com/yq04/Claude-Local/releases/download/v0.1.0/Claude-Local_0.1.0_x64-setup.exe)，需要现有仓库访问权限。
- 附件仅 `Claude-Local_0.1.0_x64-setup.exe`，140,504,677 字节，保持未签名。
- 安装器 SHA-256：`37bfd3cbe1653dfaff9412fb4e2324304db44841c606d5fae480268d11bba1ec`。
- 远端资产状态为 uploaded，大小及 GitHub 返回的 SHA-256 digest 均与本地一致；Release 已取消草稿状态，保留 prerelease 标记。
- `v0.1.0` 固定指向源码 `ff6bc8128de0732ca893afbdb76b1d7156f76a8a`；既有 `v0.3.0` / `v0.3.1` 不变。交付文档的后续提交不移动产品标签。

## 源码与构建

[Windows source checks](https://github.com/yq04/Claude-Local/actions/runs/40270529041) 对上述源码全部成功：前端 122 项通过；Rust 主测试 243 项及一项子进程检查通过；浏览器准备、运行资源、Python 能力、归档、包审计、本地/在线额度、迁移和 Windows CLI 离线套件通过。

CI 发现并修复了新版 Windows bsdtar 3.8.9 的兼容问题：空 uname/gname 警告的目标文字由 UTF-8 变为 current locale。只精确接受这两种空属主警告；真实属主、其他警告、非零退出、认证尾帧、路径和大小限制仍按原规则拒绝。新增模拟分支先失败、修复后通过，最终安装器已重新封入修正后的 `quota_archive.py`。

构建使用工作区和用户目录之外的中性 Cargo Home/Target，仅准备公共 registry 缓存，并启用路径重映射及 `custom-protocol`。最终包重新只读解包后，109 个文件的路径和哈希、13 项外部私密探针均通过，发现数为 0。真实生成的 NSIS 模板经过英/简/繁三语编译及保留资料守卫检查；没有运行安装程序。

## 本机与安装包一致性

本机按审计清单核对 102 项应用文件，只有宿主和归档脚本需要替换。两项先备份并校验，再将宿主最后替换并重新打开。NSIS 自用插件和卸载器不属于文件式应用更新，未复制或执行；用户身份、账本、浏览器登录资料和设置均不作为构建或替换输入。

本机版本为 0.1.0，宿主与安装器内的 NSS 宿主字节一致：`d509366aa0080b38da28fcad78774dc1cc55c56cdc0f19cb8436d8bb434aac4e`。中性构建的原始 UNK 宿主哈希为 `b0e04d5fdba5f9f685256b644fc18a582eab1c85a4dabb1ea15799500d59daa8`；已审计确认仅有 Tauri 安装格式标记的三字节转换。

更新前后的 Claude Code 进程及创建时间保持，`missingClaudeCount=0`；浏览器进程未终止。最终包内宿主的纯 JSON 额度核心离线冒烟通过；没有借验收发起真实额度或唤醒请求。

## 遗留与边界

未执行真实 NSIS 安装、卸载、0.3.x→0.1.0 降级或全机型验收；三语编译与解包审计不替代这些运行验收。网页会话与 CLI 授权仍独立，真实账号权限需要持有人按 [恢复说明](CONNECTION_RECOVERY.md) 处理。

本版为当前私有仓库的审阅预发布。公开源码/二进制所需的第三方许可与历史公开面工作仍按 [NOTICE](../NOTICE.md)、[分发说明](DISTRIBUTION.md) 和 [公开准备](PUBLIC_PREPARATION.md) 处理；本次没有宣称已完成这些独立事项。
