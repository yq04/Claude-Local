<!--
[INPUT]: Owner's request to resume an interrupted CLI task on another saved identity after a 5h limit hit; existing identity switch, shared session sanitizer and Policy semantics at 0.1.3 / 17779ea.
[OUTPUT]: Why the cross-account resume pipeline is out of scope, what it would cost to keep, and a compliant task-handoff design that carries work forward without touching account-bound session data.
[POS]: Design proposal only; nothing here is implemented, tested or approved.
[PROTOCOL]: Update if the plan owner accepts it; keep the policy boundary section in sync with REVIEW_AND_ADDENDUM.md Appendix A.
-->
# 任务交接（而非会话接力）设计

日期：2026-10-21。基线 0.1.3 / `17779ea`。

## 一、需求原话

> 一个账号的 5h 额度到底后，可以退出 CLI 会话然后通过软件切换身份，重新进入 CLI 后 resume 继续执行？

## 二、判定：跨账号 resume 流水线不做

这个流程的实质是把两个账号的 5h 限额拼成一个连续产能，属于绕过产品内限制。依据见 `REVIEW_AND_ADDENDUM.md` 附录 A：**AUP:126**（禁止 bypass restrictions/guardrails established within our products）与 **AUP:122**（禁止 create multiple accounts to circumvent product guardrails）。

手动触发不改变性质——政策约束的是行为，不是自动化程度。产品如果专门为这条路径做优化（提示切换时机、保证 resume 无缝），就等于把规避能力做成可分发的东西；仓库一旦公开，每个使用者都能用它合并额度。

## 三、技术现实：这个能力现有代码已实现一半

- 跨账号 `claude --resume` 的真实障碍是 `thinking` / `redacted_thinking` 签名绑定原组织密钥，重放会返回 HTTP 400（`cleaner_identity.rs:624` 的注释、`:896` 的处理说明）。
- 现有 `sanitize_project_sessions` 正是靠**剥离签名块 + 改写 `credential_org`** 来消除这个障碍，`optimization_tests.rs:772` 的测试名就叫 `cross_account_session_resume_merges_legacy_history_and_sanitizes_risk_vectors`。

也就是说，"能 resume"和"停止会话改写"互斥：

- 保留改写 → 跨账号 resume 可用 → 维持规避能力。
- 停止改写（推荐 A）→ 历史原样保留 → 跨账号 resume 会撞签名校验。

**推荐 A 与本需求不能兼得。** 这是有意的取舍，不是实现难度问题。

同时也说明另一件事：一旦按 S02/S13 落地，用户撞到 400 时需要一个**诚实的提示**——"此会话属于其他账号，请新建会话"，而不是静默失败或悄悄改写。这一条应作为阶段 1 的验收项。

## 四、真正的需求是任务延续

会话是账号绑定的载体，任务状态不是。把"做到哪了"写成磁盘上的事实，比 resume 出来的对话更准确——长会话本身经过压缩和截断，恢复出来的上下文往往缺关键细节。

所以设计目标改成：**换账号/换机器后，新会话能接上这项工作。**

## 五、方案：交接摘要（handoff brief）

### 5.1 定位

纯本地、只读、用户显式触发。不写 `.claude/projects`、不碰凭据、不参与切换事务、不调用模型。

### 5.2 输入（全部只读）

| 来源 | 取什么 | 边界 |
|---|---|---|
| 当前项目对应的会话 `jsonl` | 最后 N 轮 `user` / `assistant` 的文本片段 | 跳过 `thinking`、`tool_use` 参数、`api-request*`、`bridge-session` 整行 |
| `git status` / `git diff --stat` | 已修改文件清单与行数 | 只读命令；不 stage、不 commit |
| 当前身份摘要 | 别名（非邮箱） | 邮箱一律不出现 |

项目目录 → `${HOME}/.claude/projects/<encoded>` 的映射沿用现有 `cleaner_identity.rs` 的做法（第一层目录名不透明，按会话文件的 `cwd` 字段匹配，不自行解码）。

### 5.3 输出

一个 Markdown 文件，默认落在用户选定的目录（建议项目根下的 `.handoff/`，由用户决定是否加入 `.gitignore`），文件名 `<YYYYMMDD-HHMM>-handoff.md`。

固定骨架：

```markdown
# 任务交接 <项目名> <时间>

## 目标
（用户填 / 或从会话首条 user 消息截取）

## 已完成
- git diff --stat 列出的文件与行数

## 最近进展
（最后 N 条 user/assistant 文本，逐条截断到 200 字符，标注来源轮次）

## 下一步
（待填）

## 约束与已定决策
（待填）

## 本摘要不含
- 凭据、邮箱、组织标识、thinking 签名、工具调用参数
```

生成后先预览再落盘；用户可直接编辑"下一步"和"约束"两节，或在下一个会话里让 Claude 补。

### 5.4 明确不做

- 不自动检测额度阈值、不弹"该换号了"、不自动切换。
- 不生成"可 resume 的会话副本"。
- 不修改被读取的 jsonl。
- 不在摘要里写入任何账号标识（邮箱、org、accountUuid）。

## 六、分阶段建议

| 阶段 | 内容 | 验证 |
|---|---|---|
| A | 只读枚举当前项目会话 + 采集 git 事实，生成骨架文件 | 合成 jsonl + 合成 repo：断言输出含预期段落、不含 `@`、不含 `sk-`/`token` 字样 |
| B | 加入最后 N 条消息片段（跳过 thinking/api-request/bridge-session） | 合成含 thinking 块的会话，断言输出中不出现签名串 |
| C | UI 入口（身份页"导出交接摘要"）+ 双语键 | GUI 夹具：点击 → 预览 → 写入用户选定目录 |

A 阶段即可独立使用，不依赖 B/C。

## 七、与现有计划的关系

- 不并进阶段 1（那阶段改的是历史保留行为，混在一起会让回归范围失控）。
- 与 S14（额度接入自检）互补：S14 解决"数据从哪来"，本方案解决"换号后工作怎么接"。
- 依赖 S02/S13 先落地——否则"停止改写"与"导出摘要"同时进行，测试夹具会互相干扰。

## 八、未验证

- 会话 jsonl 中 `user` / `assistant` 文本字段的确切结构（本轮未读真实会话文件，也依项目规则不应读）。
- `${HOME}/.claude/projects/<encoded>` 与 cwd 的映射在 Windows 上的实际形态（现有代码按不透明目录名处理，本轮沿用该假设）。
- 摘要对长任务的实用程度——需要一次真实使用后才谈得上评估。
