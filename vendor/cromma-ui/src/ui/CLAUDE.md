# vendor/cromma-ui/src/ui/
> L2 | 父级: ../CLAUDE.md

成员清单
button.tsx: 按钮原语，Tag 与 ink 皮肤及尺寸档由共享令牌决定。
checkbox.tsx: Radix 勾选行为与黑白状态，支持不定态和受控多选。
collapsible.tsx / collapsible.css: Disclosure 折叠区，Radix Collapsible 行为、行尾 ChevronGlyph 与按 --radix-collapsible-content-height 的 base 档展开动效；应用内所有展开详情共用。
control.ts: 按钮、输入框与分段控件共用的尺寸档、圆角、缺省值和分段轨道/滑块皮。
glyphs.tsx: 原语内部图形，不依赖业务图标集合。
input.tsx: 单行输入原语，DOM 事件与按钮共用高度档。
loader.css: 加载指示原版样式，消费共享动画参数。
loader.tsx: 同款加载指示，动画与其 CSS 同位。
menu-row.tsx: Select 与弹出菜单共用的选择行皮肤。
modal.tsx: 原版模态外壳与 store；应用使用 ModalShell，受控行为交给 Radix；关闭按钮的无障碍名与提示可由 closeLabel 本地化。
nav-button.tsx: 侧栏导航行，选中态和悬停图标编舞归原语。
panel.tsx: 面板背景、圆角与标题栏的唯一实现。
popover.tsx: Radix 弹出层及 Menu 表面，为 Select 提供定位。
portal-owner.ts: 模态和提示的单一 portal 所有权。
pressable.tsx: 可点击原语，统一按压与无障碍行为。
segmented.tsx: SegmentedControl 分段单选，Radix ToggleGroup 的 radio 语义与方向键，和 Tabs segmented 同皮；已选项不可被点空。
select.tsx: 原版 Select 与可搜索选项；增加 id、aria-label 透传，保持原版外观。
sidebar-button.tsx: 侧栏选中皮肤，NavButton 依赖其 raised 样式。
surface.tsx: 浮层表面令牌，供菜单与提示复用。
switch.tsx: Radix Switch 开关，与 Checkbox 同一套前景实底选中、发丝底槽和焦点环。
tabs.tsx: 原版 Radix 分段/下划线页签，键盘方向键与选中状态由原语维护；分段皮来自 control.ts，可透传 aria-label 与 itemClassName。
textarea.tsx: 多行输入原语，尺寸由内容区布局决定。
tooltip.tsx: Radix 提示与单一 portal，供面板动作和 Select 使用。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
