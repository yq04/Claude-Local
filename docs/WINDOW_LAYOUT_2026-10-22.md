<!--
[INPUT]: Owner request for a narrower sidebar and last-window-size restoration, existing shell/native lifecycle, and pinned Cockpit/Antigravity source observations.
[OUTPUT]: Implementation choices and scoped verification for responsive navigation and native window-size memory.
[POS]: Development record for the current source change; it does not claim an installed or released update.
[PROTOCOL]: Keep actual implementation and executed validation distinct from reference-project behavior; no user-specific display data or paths.
-->
# 侧栏与主窗口尺寸适配

## 更紧凑的侧栏与窄窗内容

经典侧栏从 232px 缩为 192px，释放 40px 给主内容区，紧凑模式保留 72px。品牌区、导航内边距和底部命令按钮同步收紧，使中英文品牌全称、菜单、语言与版本控件完整可达。移除了旧的窄窗 196px 覆盖，避免窗口缩小时侧栏反而变宽。窗口调整不会改写用户选择的经典/紧凑模式。

身份库可用宽度不足 600px 时，“添加新号三步法”根据该容器宽度换行，三个步骤与浏览器按钮完整显示；宽窗保持紧凑横条。账号卡保持 180×286，卡片列表与统计表保留各自有意设计的局部滚动，页面本身不出现横向溢出。

## 原生窗口记忆

主窗口原来每次使用配置中的 1040×820 启动。现在默认记忆正常窗口的逻辑宽高与最大化状态，保存于独立的私有 `window-state.json`。最小化和托盘隐藏不作为下次启动状态；最大化时保留之前的正常尺寸，避免取消最大化后仍占满屏幕。

窗口变化先同步更新内存，连续拖动通过 350ms 尾沿防抖保存；关闭到托盘和真正退出时立即保存。后台写入与前台状态更新使用同一把锁，避免延迟写入覆盖退出前的新尺寸。文件有 512 字节读取上限，非法格式、缺字段和越界尺寸回退默认值；写入沿用本项目的私有原子文件机制。

启动按当前主屏实际可用区域、DPI 比例和窗口外框限制尺寸，并在屏幕可用区居中；完成恢复后才显示。小屏可用区不足原有 760×640 最小尺寸时，原生最小尺寸也相应下调，以保证窗口可见。界面内容仍通过自身滚动和响应式布局适配，不能仅依赖缩小原生窗口。

设计取舍是仅记忆尺寸与最大化，不记忆显示器绝对坐标。用户要求的是恢复窗口大小；启动居中避免拔除外接显示器、负坐标布局和不同 DPI 导致旧坐标不可达。没有添加新的插件或依赖。

## 参考项目与独立实现

Cockpit Tools 固定提交 `76fbea02ba8ab5a071205a0bfa59ef4db5cc64b4` 使用独立窗口状态文件、逻辑像素和关闭时强制保存；其窗口记忆配置默认关闭。我们借鉴了状态分离、最小化保护和保存节流的方向，并单独保留正常尺寸。[状态实现](https://github.com/jlcodes99/cockpit-tools/blob/76fbea02ba8ab5a071205a0bfa59ef4db5cc64b4/src-tauri/src/modules/main_window_state.rs#L171)；[默认配置测试](https://github.com/jlcodes99/cockpit-tools/blob/76fbea02ba8ab5a071205a0bfa59ef4db5cc64b4/src-tauri/src/modules/main_window_state.rs#L333)

Antigravity Tools 固定提交 `9f8e4f24d61b33fa80b8078d104c942752a5fa0b` 直接启用 Tauri 的 Rust window-state 插件，并排除 VISIBLE 状态。我们采用恢复后显示的方式，但只处理本产品主窗口所需的尺寸状态。[插件配置](https://github.com/lbjlaq/Antigravity-Manager/blob/9f8e4f24d61b33fa80b8078d104c942752a5fa0b/src-tauri/src/lib.rs#L491)

两者本身已有 Rust/Tauri 原生层，因此不需要将其前端脚本机械转写为 Rust。参考仓库使用 CC BY-NC-SA 许可，本次只借鉴行为设计，代码按本产品数据边界独立实现。

## 已执行的原生验证

纯 Rust 模型 4 项测试通过，覆盖非法/无界尺寸、最大化/最小化保留正常尺寸、负坐标工作区及 DPI 换算、小屏约束。测试只使用合成输入，不创建真实窗口。

`cargo check --locked --offline --tests --manifest-path src-tauri/Cargo.toml -j 1` 已通过，包括新 JSON 边界测试的编译。该命令只做集成编译检查，不执行 GUI 或系统测试；JSON 边界测试尚未单独执行。编译仅保留既有 `windows.rs` 未使用函数警告。

本轮没有构建安装包或修改本机已安装程序。真实 Windows 窗口重启、DPI 切换与任务栏位置的运行验收仍需在新构建的隔离环境中执行。

## 已执行的界面验证

`node scripts/test-usage-statistics.mjs .local/preview/window-layout --layout-only` 已通过 96 组场景：8 个页面 × 中英两种语言 × 经典/紧凑侧栏 × 760×640、1040×820、1440×900 三种视口。检查品牌与菜单文字、页面横向边界、短窗底部控件、身份卡尺寸及窄窗引导步骤完整性；使用假 IPC、虚构身份和阻止外网的独立浏览器上下文。

`bun run build` 的 TypeScript 检查及 Vite 生产构建通过。合成截图已人工查看，生成在忽略的预览目录，不包含真实身份。未修改依赖、额度采集、账号切换或安装包版本。
