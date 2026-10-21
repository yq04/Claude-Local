<!--
[INPUT]: 原创项目 MIT 授权、现有 Chromium 许可、本地 UI 与 AI SVG 来源记录及 Token 统计开源设计参考。
[OUTPUT]: 英文第三方归属和分发边界；未发现的许可不推断为 MIT。
[POS]: LICENSE 的第三方补充说明，供 README 和发布包引用。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# Third-party notices

Claude-Local independently maintains local application code and includes MIT-licensed code originating in CCBaga (liseami/CCBaga). The original copyright is retained. The top-level MIT license covers that project work and Claude-Local contributions. It does not replace third-party copyright notices or license terms.

## Fingerprint Chromium and Chromium

The companion browser uses [Fingerprint Chromium](https://github.com/adryfish/fingerprint-chromium), based on Ungoogled Chromium. The existing BSD-3-Clause notice is retained in [browser-runtime/LICENSE.fingerprint-chromium](browser-runtime/LICENSE.fingerprint-chromium) and included in the application resources.

The browser bundle contains Chromium and additional dependencies with their own licenses. Preserve the engine's complete attribution/credits resources when preparing a binary distribution. Do not treat the single Fingerprint Chromium notice as a complete license inventory for the browser.

## Vendored interface

`vendor/cromma-ui` is a local copy of Cromma UI, including its Pika icon subset. The copied tree does not currently contain an independent upstream license notice. Confirm its redistribution terms and restore any required notices before publishing these components. The top-level MIT declaration is not evidence of permission from other copyright holders.

## AI tool icons

The five SVG icons in `assets/ai-icons` are unchanged graphics from [LobeHub lobe-icons](https://github.com/lobehub/lobe-icons), pinned to commit `c385b2b8d1f9e19aa86e628d4e23c91ee1111a47`. They identify General (LobeHub mark), Codex, Cursor, OpenCode and GitHub Copilot. The upstream MIT notice is retained in [LICENSE.lobehub.txt](assets/ai-icons/LICENSE.lobehub.txt) and bundled in the app's license resources. Brand marks remain the property of their owners and do not imply endorsement.

## Application dependencies

Tauri, React, Radix UI, Motion, Tailwind CSS, Vite, YAML and the Rust dependencies retain their respective licenses. `bun.lock` and `src-tauri/Cargo.lock` identify the versions used. Source distributions should retain upstream notices; binary releases should include the applicable notices for what they ship.

## Workflow references and branding

Claude cleanup discovery was informed by the [claude-cleanup skill](https://github.com/suyuan2022/suyuan-skill/tree/main/claude-cleanup). Its upstream license and attribution must be reviewed for any redistributed material.

The CL monogram and current desktop/browser application marks were created for Claude-Local and replace the inherited application artwork. Anthropic, Claude, Apple, Chromium and other third-party names remain the property of their respective owners. Their mention does not imply sponsorship or endorsement.

## Usage accounting references

The local usage accounting design was informed by [ccusage](https://github.com/ccusage/ccusage), Copyright (c) 2025 ryoppippi, and [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor), both published under MIT licenses at the versions documented in [USAGE_STATISTICS.md](docs/USAGE_STATISTICS.md). Claude-Local implements the native integration independently; these tools are not bundled or invoked as application dependencies. Preserve the applicable upstream MIT notices if code from either project is incorporated in a future change.

The Usage analytics visual hierarchy was also informed by the MIT-licensed [CPA-Manager-Plus (CPAMP)](https://github.com/seakee/CPA-Manager-Plus), at the reference revision documented above. Claude-Local uses independently implemented theme-aware components and SVG charts; CPAMP assets and runtime code are not bundled.

## Windows timezone data

Windows/IANA mappings derive from [Unicode CLDR 48](https://github.com/unicode-org/cldr/blob/release-48/common/supplemental/windowsZones.xml) under the [Unicode License](src-tauri/windows/LICENSE.unicode.txt). The license is included with Windows packages.
