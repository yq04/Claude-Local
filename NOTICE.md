<!--
[INPUT]: CCBaga 二次开发来源及 MIT 许可、Chromium 许可、本地 UI 与 AI SVG 来源、Token 统计参考及本版时区计算依赖许可。
[OUTPUT]: 英文第三方归属、上游二次开发溯源和分发边界；未发现的许可不推断为 MIT。
[POS]: LICENSE 的第三方补充说明，供 README、PROJECT_ORIGIN 和发布包引用。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# Third-party notices

Claude-Local is an independent open-source desktop application originating as a fork and secondary development based on [CCBaga](https://github.com/liseami/CCBaga). The original MIT license and copyright of the CCBaga contributors are retained ([CCBaga License](https://github.com/liseami/CCBaga/blob/main/LICENSE), [CCBaga Contributors](https://github.com/liseami/CCBaga/graphs/contributors)). The top-level MIT license of Claude-Local covers inherited CCBaga work as well as Claude-Local contributions. It does not replace third-party copyright notices or license terms.

Claude-Local is maintained independently and is not affiliated with, endorsed by, or sponsored by the upstream CCBaga project or its authors. Claude-Local does not connect to upstream CCBaga update endpoints, release feeds, or verification keys. For details on provenance, architectural inheritance, format compatibility, and independent enhancements, see [PROJECT_ORIGIN.md](docs/PROJECT_ORIGIN.md).

## Fingerprint Chromium and Chromium

The companion browser uses [Fingerprint Chromium](https://github.com/adryfish/fingerprint-chromium), based on Ungoogled Chromium. The existing BSD-3-Clause notice is retained in [browser-runtime/LICENSE.fingerprint-chromium](browser-runtime/LICENSE.fingerprint-chromium) and included in the application resources.

The browser bundle contains Chromium and additional dependencies with their own licenses. Preserve the engine's complete attribution/credits resources when preparing a binary distribution. Do not treat the single Fingerprint Chromium notice as a complete license inventory for the browser.

## Vendored interface

`vendor/cromma-ui` is a local copy of Cromma UI, including its Pika icon subset. The copied tree does not currently contain an independent upstream license notice. Confirm its redistribution terms and restore any required notices before publishing these components. The top-level MIT declaration is not evidence of permission from other copyright holders. `ui/segmented.tsx`, `ui/switch.tsx` and `ui/collapsible.tsx`/`collapsible.css` inside that tree were added in this repository; they only compose the separately licensed Radix primitives with the copied tokens and do not change the unresolved terms of the copied files.

## AI tool icons

The five SVG icons in `assets/ai-icons` are unchanged graphics from [LobeHub lobe-icons](https://github.com/lobehub/lobe-icons), pinned to commit `c385b2b8d1f9e19aa86e628d4e23c91ee1111a47`. They identify General (LobeHub mark), Codex, Cursor, OpenCode and GitHub Copilot. The upstream MIT notice is retained in [LICENSE.lobehub.txt](assets/ai-icons/LICENSE.lobehub.txt) and bundled in the app's license resources. Brand marks remain the property of their owners and do not imply endorsement.

## Application dependencies

Browser environment checks use ipwho.is and ipapi.co for exit metadata. When those responses omit a datacenter flag, an explicit environment check may query the same IP through IPQuery (https://ipquery.io/) for supplementary classification. These are external data services, not bundled software or application update sources; no provider API key is distributed. Classification reflects the provider's data and does not attest residential access or account safety.

Tauri, React, Radix UI, Motion, Tailwind CSS, Vite, YAML and the Rust dependencies retain their respective licenses. `bun.lock` and `src-tauri/Cargo.lock` identify the versions used. Source distributions should retain upstream notices; binary releases should include the applicable notices for what they ship.

## Workflow references and branding

Claude cleanup discovery was informed by the [claude-cleanup skill](https://github.com/suyuan2022/suyuan-skill/tree/main/claude-cleanup). Its upstream license and attribution must be reviewed for any redistributed material.

The CL monogram and current desktop/browser application marks were created for Claude-Local and replace the inherited application artwork. Anthropic, Claude, Apple, Chromium and other third-party names remain the property of their respective owners. Their mention does not imply sponsorship or endorsement.

## Usage accounting references

The local usage accounting design was informed by [ccusage](https://github.com/ccusage/ccusage), Copyright (c) 2025 ryoppippi, and [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor), both published under MIT licenses at the versions documented in [USAGE_STATISTICS.md](docs/USAGE_STATISTICS.md). Claude-Local implements the native integration independently; these tools are not bundled or invoked as application dependencies. Preserve the applicable upstream MIT notices if code from either project is incorporated in a future change.

The Usage analytics visual hierarchy was also informed by the MIT-licensed [CPA-Manager-Plus (CPAMP)](https://github.com/seakee/CPA-Manager-Plus), at the reference revision documented above. Claude-Local uses independently implemented theme-aware components and SVG charts; CPAMP assets and runtime code are not bundled.

## Windows timezone data

Windows/IANA mappings derive from [Unicode CLDR 48](https://github.com/unicode-org/cldr/blob/release-48/common/supplemental/windowsZones.xml) under the [Unicode License](src-tauri/windows/LICENSE.unicode.txt). The license is included with Windows packages.

## Timezone analytics and compile-time lookup dependencies

Version 0.1.7 incorporates native timezone calculations and static lookup tables using the following Rust crates from crates.io:

- `chrono` 0.4.45 (dual-licensed under MIT OR Apache-2.0; MIT selected): Copyright (c) 2014--2026, Kang Seonghoon and contributors.
- `chrono-tz` 0.10.4 (dual-licensed under MIT OR Apache-2.0; MIT selected): Copyright (c) 2016-2024 Benjamin Sago & the chronotope maintainers. (Upstream tzdb data is in the public domain; parse-zoneinfo was forked from zoneinfo-parse created by Benjamin Sago under MIT).
- `phf` 0.12.1 and `phf_shared` 0.12.1 (licensed under MIT): Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi.

The MIT License (MIT) text applying to these components:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
