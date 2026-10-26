<!--
[INPUT]: Owner-defined0.1.0 release series, immutable versioned artifacts and explicit Git reference management.
[OUTPUT]: Public version/tag/topic/release conventions and safe maintenance boundaries.
[POS]: Maintainer guidance; no automatic publication, upstream sync or update feed.
-->
# 版本、Tags 与发布约定

Claude-Local 基于 CCBaga 二次开发并独立维护。项目发行序列从 **0.1.0** 开始；版本号、源码标签和安装包均属于本项目，不沿用其他项目的发布链。

## 三类名称分别管理

- **Git Tags** 使用 `v主版本.次版本.补丁版本`，标识发布所依据的固定源码提交。当前发行标签为 `v0.1.0` 至 `v0.1.5`。
- **GitHub Releases** 对应发行标签，包含变更说明、Windows x64安装包、SHA256与已知限制。Pre-release和Latest由维护者根据该版本状态设置，不因数字小于1.0自动判为测试版。
- **Repository Topics** 是项目发现关键词，例如`ccbaga`、`claude-code`、`windows-x64`、`identity-management`和`usage-analytics`；它们不指向源码版本，也不改变运行数据。

## 已发版本保持可追溯

发布前核对应用四处版本、源码检查、安装包资源边界和隐私审计，记录实际产物与SHA256。发布后不移动标签，不用不同文件覆盖同名安装包；发现实现或集成缺陷时递增补丁版本，并在旧版说明中标明限制及推荐版本。

维护发行入口时同步检查README下载链接、当前版本介绍和Issue表单的版本选项，避免反馈入口继续推荐过期版本。

README、来源声明和发布说明可以补充或纠错，但文案编辑不代表重新构建，也不能改变既有回执的源码提交、安装包字节数或校验值。文档提交可以位于发行标签之后；下载与源码核对以相应发行记录为准。

首次创建标签及推送时应只操作该版本的明确引用，避免将本地备份或实验标签一起推送：

```powershell
# 将N替换为实际补丁号；标签应指向已经验证的源码提交。
git push origin refs/tags/v0.1.N
```

删除不再使用的开发标签前，先保存目标对象及可恢复备份、说明影响并取得明确确认。删除标签仅移除引用，不会抹去仍可达的提交历史，也不等于完成历史隐私审查。不要自动推送全部本地标签。

## 独立维护与归属

不添加自动上游同步、CCBaga的更新服务或发布公钥。保留CCBaga贡献者版权及适用许可；新改动由Claude-Local维护者负责，不把问题反馈转嫁给上游作者。详见[项目来源](PROJECT_ORIGIN.md)、[NOTICE](../NOTICE.md)和[分发说明](DISTRIBUTION.md)。
