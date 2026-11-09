<!--
[INPUT]: Independent Windows x64 product, retained CCBaga/MIT attribution, 0.3.1 Smart Relay/Auto-Wakeup GPU/React/IPC optimizations, Usage Analytics 2.1 with 2x Retina Auto-Screenshot Engine, Cleanroom s13 device fingerprint continuity, and 0.3.0 cleanroom/Smart Relay 2.0/HUD 2.0 foundation.
[OUTPUT]: Full English flagship project presentation foregrounding anti-ban & multi-identity isolation engineering, architectural lineage, feature matrix, visual tour, installation workflow and runtime boundaries.
[POS]: English repository introduction linked bidirectionally with README.md.
[PROTOCOL]: Keep private data, format compatibility and distribution boundaries in linked project documents.
-->

<div align="center">

<img src="assets/claude-local-mark.svg" width="84" height="84" alt="Claude-Local Logo" />

# Claude-Local

**A Windows 10 / 11 x64 Multi-Identity Anti-Ban & Isolation Workbench for Claude — Featuring Fingerprint-Isolated Chromium, 4D Residue Sanitization, Full-Chain WebRTC/IPv6/DNS Anti-Leak & KYC Defense, Free Warming Lifecycle Protection, and Smart Relay Rotation**

Derived from [CCBaga](https://github.com/liseami/CCBaga) ([@liseami](https://github.com/liseami)) and independently maintained, retaining the original contributors' copyright and [MIT license](LICENSE) · 100% Local-First · Zero Cloud Credential Hosting · Never Force-Kills Running `claude.exe` Sessions

[![Latest Release](https://img.shields.io/badge/Release-v0.3.1-d97757?style=flat-square)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.1)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11%20x64-0078D4?style=flat-square)](https://github.com/yq04/Claude-Local/releases)
[![Tech Stack](https://img.shields.io/badge/Stack-Tauri%202%20%C2%B7%20Rust%20%C2%B7%20React%2019%20%C2%B7%20Python-2b3137?style=flat-square)](docs/DEVELOPMENT.md)
[![License](https://img.shields.io/badge/License-MIT-2ea44f?style=flat-square)](LICENSE)
[![Lineage](https://img.shields.io/badge/Derived%20from-CCBaga-6f42c1?style=flat-square)](docs/PROJECT_ORIGIN.md)

<p>
  <strong>🌐 Language / 语言：</strong>
  <a href="README.md"><strong>🇨🇳 简体中文</strong></a> · <strong>🇺🇸 English (Current)</strong>
</p>

<p>
  <a href="https://github.com/yq04/Claude-Local/releases/download/v0.3.1/Claude-Local_0.3.1_x64-setup.exe"><strong>⬇️ Download v0.3.1 Installer (Windows x64)</strong></a>
  ·
  <a href="https://github.com/yq04/Claude-Local/releases/tag/v0.3.1"><strong>✨ v0.3.1 Release Notes</strong></a>
  ·
  <a href="#-why-claude-local-solving-the-4-multi-account-anti-ban-pain-points"><strong>🔥 Anti-Ban Core Architecture</strong></a>
  ·
  <a href="#-visual-tour--core-capabilities"><strong>🖼️ Visual Tour</strong></a>
  ·
  <a href="#-origin--evolution-from-ccbaga"><strong>🧬 Origin & Lineage</strong></a>
</p>

</div>

---

## 📖 Table of Contents

- [🔥 Why Claude-Local? (Solving the 4 Multi-Account Anti-Ban Pain Points)](#-why-claude-local-solving-the-4-multi-account-anti-ban-pain-points)
- [✨ Eight Core Capability Pillars](#-eight-core-capability-pillars)
- [🖼️ Visual Tour & Core Capabilities](#️-visual-tour--core-capabilities)
  - [1. Per-Identity Fingerprint Chromium, Kill-Switch & 20-Item Anti-Correlation Verification](#1-per-identity-fingerprint-chromium-kill-switch--20-item-anti-correlation-verification)
  - [2. Risk / KYC Verification, One-Click Clash Override & Mobile Residential Bridge](#2-risk--kyc-verification-one-click-clash-override--mobile-residential-bridge)
  - [3. Encrypted Identity Vault, 4D Sanitization, Free Warming Cards & Smart Relay](#3-encrypted-identity-vault-4d-sanitization-free-warming-cards--smart-relay)
  - [4. Quick Setup, Computer Environment Alignment & Network Diagnostics](#4-quick-setup-computer-environment-alignment--network-diagnostics)
  - [5. Auxiliary Capabilities: Quota HUD, Usage USD Analytics & 5h Auto-Wake](#5-auxiliary-capabilities-quota-hud-usage-usd-analytics--5h-auto-wake)
- [🧬 Origin & Evolution from CCBaga](#-origin--evolution-from-ccbaga)
- [📦 Download, Installation & Release History](#-download-installation--release-history)
- [⚙️ Prerequisites & Building from Source](#️-prerequisites--building-from-source)
- [🛡️ Architecture & Data Safety Boundaries](#️-architecture--data-safety-boundaries)
- [🔧 Known Limitations & Troubleshooting](#-known-limitations--troubleshooting)
- [🤝 Contributing, License & Acknowledgements](#-contributing-license--acknowledgements)

---

## 🔥 Why Claude-Local? (Solving the 4 Multi-Account Anti-Ban Pain Points)

For developers running **Claude Code CLI** heavily on Windows and managing multiple **Claude Pro / Max / Free Warming** accounts, **the primary threat is never "missing a token chart" — it is chain-reaction account bans caused by fingerprint correlation, proxy/IPv6/WebRTC leaks, cross-account CLI telemetry residue, and split exits during mobile KYC**:

1. **🛡️ Barrier 1 — Per-Account Physical Browser Isolation & Deterministic Fingerprint Seeds (Eliminates Browser Cross-Contamination)**
   - Every CLI identity and every Free warming card is bound to an **exclusive Chromium `user-data-dir` slot and an immutable 64-bit deterministic `--fingerprint=<seed>`**.
   - Built-in **20-item real-time anti-correlation verification** (`v0.2.5` adds **real 32-bit FNV-1a Canvas pixel hash calculation**, `OfflineAudioContext`, `WebGL UNMASKED_RENDERER`, `Intl` vs. `Date.getTimezoneOffset()` dual-path timezone audit, sanitized `--accept-lang=en-US,en` header chains, and word-boundary ASN purity checks), with **persistent in-memory verification retention across browser close and menu navigation**.
2. **🔒 Barrier 2 — Full-Chain WebRTC / IPv6 / DNS / QUIC Anti-Leak & On-Demand Kill-Switch (Eliminates Physical IP & Split-Exit Exposure)**
   - **Browser Layer**: Enforces all 3 Google `WebRTC Network Limiter` `Default/Preferences` keys (`disable_non_proxied_udp`, `multiple_routes_enabled: false`, `nonproxied_udp_enabled: false`) + `--enforce-webrtc-ip-permission-check` + `dns_prefetching.enabled: false`.
   - **System & Proxy Layer (`v0.2.5` Hardened)**: One-click **Clash Verge Rev / Mihomo Global Anti-Leak Override YAML** enforcing **`ipv6: false` + `dns.ipv6: false`** (cutting off OS IPv6 dual-stack direct bypass), blocking `UDP 443` QUIC and `UDP 3478/19302/5349` STUN/TURN, rejecting `198.18.0.0/15` Fake-IP leaks, and binding **Anthropic (`claude.ai` / `claude.com` / `anthropic.com`) + Persona KYC (`withpersona.com` / ` inquiry.withpersona.com`) + Stripe (`stripe.com` / `stripe.network` / `hcaptcha.com`) + Sentry (`sentry.io`) + WorkOS (`authkit.app`)** to the exact same static residential exit.
   - **Emergency Protection**: **On-Demand Non-Blocking Browser Kill-Switch** (automatically closes managed browser slots on 5s TUN drop or 60s exit-country drift — **never interrupting running `claude.exe` sessions**) + **CSPRNG-Authenticated Mobile Shadowrocket Same-Residential LAN Bridge** (routing iPhone SMS/Persona KYC through your PC's static residential proxy).
3. **🧹 Barrier 3 — 4D Cross-Account Residue Sanitization & Encrypted `.baga` Vaults (Eliminates CLI Device-ID Correlation)**
   - Switching accounts is never just swapping an OAuth token: Claude-Local verifies that no `claude.exe` process is running, archives the current identity into an **AES-256-GCM + Zstandard encrypted `.baga` vault**, and executes **4-dimensional cross-account residue cleanup** (purging `~/.claude.json` device/telemetry fingerprints, session caches, Keychain/Credential residuals, and temporary logs) before restoring the target identity's isolated environment.
   - Supports **full-chain `.clbackup` password-encrypted vault backups** (covering identity vaults, browser seeds, Free warming cards, and manual subscription dates) with isolated recovery copies.
4. **🌱 Barrier 4 — Free Warming Lifecycle Protection & Multi-Account Smart Relay (Eliminates Cold-Start Bans & Rate-Limit Downtime)**
   - **Dedicated Free Warming Cards**: 4-stage lifecycle tracking (`Pending signup → KYC passed → Free warming → Ready for Pro`), **automatic country + IANA timezone lock on first verified check** (`v0.2.5` clearly distinguishes `US (America/Los_Angeles)` vs. `US (America/New_York)` same-country timezone drift), pre-open cross-country drift confirmation, collapsible stage SOP guides, and **zero-rebind promotion to Pro/Max** (retaining original browser slot, seed, and cookies).
   - **Multi-Account Smart Relay & Passive Quota/Wakeup**: Opt-in Magpie-inspired 5-strategy Smart Relay (`Smart / In Order / Round-Robin / Least Used / Use Before Reset`) + in-process Rust 5h auto-wake scheduler + passive CLI quota observation (**zero background OAuth polling, zero writes to `.claude.json`**), complemented by the **Quota HUD (`额度小窗`)** and **Official API USD Cost (`$`) Analytics**.

---

## ✨ Eight Core Capability Pillars

**New in v0.2.7**: Same-exit Mihomo co-routing for Claude Code direct telemetry (`datadoghq.com`) and OpenAI Codex CLI (`openai.com` / `chatgpt.com` / `oaistatic.com` / `oaiusercontent.com` / `auth0.com`), same-port dual-protocol proxy alignment (`socks5://` Browser vs. `http://` CLI), one-click CLI anti-leak `settings.json` snippet with safe merge hint, and native `GRPC_PROXY` vault archiving. [Full release notes](docs/RELEASE_NOTES_0.2.7.md).

Full-vault `.clbackup` backup and Copy Handoff Spec remain available. Single-identity encrypted import/export and `.bagapack` portable identity packages are cancelled; handoff specs copy environment guidance only. Environment checks do not guarantee freedom from account enforcement.

| Core Pillar | Key Capabilities & Engineering Highlights |
| :--- | :--- |
| **🌐 1. Per-Identity Fingerprint Chromium & 20-Item Verification** | Binds each identity and warming card to an isolated Chromium `user-data-dir` and deterministic 64-bit seed; **`v0.2.5` enforces `--accept-lang=en-US,en` header chains, disables `dns_prefetching`, computes real 32-bit FNV-1a Canvas pixel hashes, fixes word-boundary ASN matching, and retains verified checkmarks across browser close & tab switches**. |
| **🛡️ 2. On-Demand Browser Kill-Switch & WebRTC 3-Key Lockdown** | Persists all 3 official Google `WebRTC Network Limiter` keys + `--enforce-webrtc-ip-permission-check`; monitors managed browsers on demand and gracefully closes them on **two consecutive 5s TUN drops or 60s exit-country drift** with **zero interference to running `claude.exe` sessions**. |
| **⚡ 3. Risk / KYC Workbench, Clash Override & Mobile LAN Bridge** | 2-step static & live cross-domain exit audit (`claude.ai` vs. `withpersona.com`); **`v0.2.5` one-click Clash Verge / Mihomo Override YAML enforces `ipv6: false` + `dns.ipv6: false`, blocks QUIC/STUN, recognizes `prepend-rules`, and routes Anthropic + Persona + Stripe + Sentry + WorkOS to the same static residential exit**, plus 4-client mobile LAN QR bridging (Shadowrocket / Clash Mi / Stash / sing-box). |
| **🔐 4. Encrypted `.baga` Vault & 4D Cross-Account Sanitization** | Preserves `BAGAID01` / `.baga` (Zstandard + AES-256-GCM) archives and SQLite `user_version = 3`; enforces live `claude.exe` process locks before switching, executes 4D residue sanitization, and provides full-chain `.clbackup` password-encrypted backups. |
| **🌱 5. Free Warming Cards & Zero-Rebind Pro Promotion** | Dedicated Free warming workbench with 4-stage progress, **country + IANA timezone lock (`US (America/New_York)` vs. `US (America/Los_Angeles)`)**, pre-open drift confirmation, stage anti-ban SOP disclosure, and zero-rebind promotion to Pro/Max. |
| **🔀 6. Multi-Account Smart Relay & Passive Recovery Queue** | Opt-in Magpie-inspired Smart Relay (`Smart` 3-tier headroom pool, `In Order`, `Round-Robin`, `Least Used`, `Use Before Reset`), session stickiness, preferred-account hysteresis recovery, and zero-write passive CLI quota sync. |
| **⏱️ 7. In-Process Native 5h Auto-Wake Scheduler** | Single Rust in-process scheduler with configurable active windows (e.g. `08:00–23:00`), primary-account threshold pre-warming, and staggered per-account backoff; strictly requires a fresh `new_5h_confirmed` server reset anchor and registers zero Windows background services. |
| **📊 8. Auxiliary Quota HUD (`额度小窗`) & Usage USD Analytics** | Unified `[• Quota HUD]` toggle (`v0.2.5` compact single-row identity header, **real 5h four-counter cache hit rate**, and **5h exhaustion ETA**) + redesigned **Usage Analytics** workbench (2×2 KPI grid, official API USD cost `$`, cache savings `$`, and full model/Effort breakdown). |

---

## 🖼️ Visual Tour & Core Capabilities

> **Screenshot Notice & Privacy Protection**: All screenshots were captured in an isolated environment using **synthetic demonstration data**. Account names, organizations, token counts, and CLI versions are fictional; emails use the reserved `@example.invalid` domain with privacy masking enabled. See the [v0.3.1 Release Notes](docs/RELEASE_NOTES_0.3.1.md) for the latest enhancements; Identity Management and Usage Analytics previews below use the `v0.3.1` interface.

### 1. Per-Identity Fingerprint Chromium, Kill-Switch & 20-Item Anti-Correlation Verification

![Claude-Local Browser Environment (English)](docs/screenshots/0.2.0/browser-environment-en.png)

- **Exclusive Slot & Deterministic Fingerprint Seed per Account**: Clearly separates the active CLI identity from the selected browser profile (CLI identity or Free warming card); never auto-launches at ordinary app startup.
- **20-Item Anti-Correlation Verification & Persistent Results (`v0.2.5` Upgraded)**:
  - **Real 32-Bit FNV-1a Canvas Hash & Hardware Probes**: Draws a multi-primitive Canvas 2D test pattern and reads `getImageData()` RGBA bytes to display a deterministic hash (`Canvas #a1b2c3d4 · OfflineAudioContext 44100Hz OK`), verifying that `--fingerprint=<seed>` noise injection is active without breaking `WebGL UNMASKED_RENDERER` or `Intl` / `Date.getTimezoneOffset()` consistency.
  - **Sanitized `Accept-Language` & Word-Boundary ASN Matching**: Normalizes `--accept-lang=en-US,en` to eliminate regional subtag anomalies (`en-US,en-US;q=0.9`), disables `dns_prefetching` to prevent split-DNS prefetch leaks, and uses strict word-boundary matching so residential ISPs like `RCN` (`AS6079`) are never false-flagged by substring rules (`cn`).
  - **Persistent Verification Across Browser Close & Tab Switches**: Retains the 10 verified checkmarks and machine exit IP in memory for each `(slot, config)` (`Browser closed · retaining HH:MM:SS verified result`), resetting only when the profile is switched, edited, or cleared.
- **On-Demand, Non-Blocking Companion Browser Kill-Switch (`v0.2.3+`)**:
  - Sleeps with zero overhead when no managed browser is running; gracefully closes managed browser slots on **two consecutive 5s TUN drops or 60s exit-country drift**, protecting against physical NIC IP exposure while **never interrupting running `claude.exe` sessions**.

---

### 2. Risk / KYC Verification, One-Click Clash Override & Mobile Residential Bridge

- **Two-Step Desktop Static & Live Cross-Domain Exit Audit**:
  - Automatically audits 3 desktop static anti-leak rules on entry (`tun.strict-route`, Fake-IP bypass, and UDP/QUIC/STUN rejection, including Clash Verge Rev `prepend-rules` / `append-rules` scripts) and probes `claude.ai` vs. `withpersona.com` live exit IP consistency on demand.
- **One-Click Desktop Clash Verge / Mihomo Global Anti-Leak Override YAML (`v0.2.5` Hardened)**:
  - Generates and copies a complete Global Merge `.yaml` that enforces **`ipv6: false` + `dns.ipv6: false`**, blocks `UDP 443` QUIC and `UDP 3478/19302/5349` WebRTC STUN/TURN, rejects `198.18.0.0/15` Fake-IP leaks, configures the `:7899` TCP-only listener, and binds **`claude.ai`, `claude.com`, `anthropic.com`, `withpersona.com`, `stripe.com`, `stripe.network`, `hcaptcha.com`, `sentry.io`, `authkit.app`, `ipquery.io`, and `ippure.com`** to the same static residential exit.
- **Mobile Same-Residential KYC LAN Bridge (`v0.2.5` IPv6-Hardened)**:
  - Balanced 2-column generator with smart proxy paste splitting (`socks5://user:pass@host:port` or `host:port:user:pass`), building CSPRNG-authenticated LAN proxy profiles for **Shadowrocket (`ipv6 = false` + full KYC/Stripe/Sentry domain rules), Clash Mi, Stash, and sing-box** with in-memory offline SVG QR codes so your phone completes SMS/Persona verification through your PC's exact residential IP.

---

### 3. Encrypted Identity Vault, 4D Sanitization, Free Warming Cards & Smart Relay

![Claude-Local Identity Management (English)](docs/screenshots/0.3.1/identity-management-en.png)

- **Unified `30px` Segmented Header Toolbar (`v0.2.5` Refined)**: Combines `[• Auto-wake | 08:00–23:00]`, `[• Smart Relay | Strategy]` (opt-in, default OFF), **`[• Quota HUD]`** (unified label with green/gray status dot), `[↻ Sync local quota]`, and `[⋯]` overflow actions.
- **Encrypted `.baga` Switching & 4D Cross-Account Sanitization**: Checks for running `claude.exe` processes before switching, verifies `.baga` archive integrity, sanitizes 4 dimensions of local CLI residue, and optionally auto-launches the target identity's linked browser.
- **Dedicated Free Warming Cards Workbench (`v0.2.3` – `v0.2.5`)**:
  - 4-stage lifecycle tracking (`Pending signup → KYC passed → Free warming → Ready for Pro`) with `Day N` progress and inline warming logs;
  - **Country + IANA Timezone Lock (`v0.2.5`)**: Locks both country and timezone on first verified check, clearly distinguishing cross-country drift from same-country timezone drift (`US (America/Los_Angeles)` vs. `US (America/New_York)`);
  - **Zero-Rebind Promotion to Pro/Max**: Promotes upgraded Free accounts to formal CLI identities while preserving their original browser slot, fingerprint seed, cookies, and subscription dates.
- **Multi-Account Smart Relay & Rotation (`v0.2.4+`, Default OFF)**:
  - Supports 5 routing strategies (`Smart`, `In Order`, `Round-Robin`, `Least Used`, `Use Before Reset`), rate-limit handling, session stickiness, and `90%–100%` switch thresholds with hysteresis preferred-account recovery.

---

### 4. Quick Setup, Computer Environment Alignment & Network Diagnostics

| Quick Setup (4 Independent Status Cards & Guided Shortcuts) | Network Environment (4-Domain Read-Only Concurrent Probes) |
| :---: | :---: |
| ![Claude-Local Quick Setup (English)](docs/screenshots/0.2.0/quick-setup-en.png) | ![Claude-Local Network Environment (English)](docs/screenshots/0.2.0/network-environment-en.png) |

- **Quick Setup & Computer Environment Alignment**: Independently inspects the active identity, companion browser, Windows timezone/locale/geolocation state, and Claude Code CLI readiness, offering one-click US system environment alignment with automatic snapshot rollback.
- **Network Environment**: Runs read-only concurrent connectivity probes across `claude.ai`, `api.anthropic.com`, `console.anthropic.com`, and official installer endpoints on manual trigger.

---

### 5. Auxiliary Capabilities: Quota HUD, Usage USD Analytics & 5h Auto-Wake

![Claude-Local Usage Analytics (English)](docs/screenshots/0.3.1/usage-analytics-en.png)

- **Redesigned Quota HUD (`额度小窗`, `v0.2.5`)**:
  - Compact single-row identity header (`Identity Name + Verified Check + Plan Badge + Subscribed Model Pill`) eliminating wasted horizontal whitespace;
  - **Real 5h Four-Counter Cache Hit Rate**: Computed directly from the active account's 5h SQLite window (`cache_read / (uncached_input + cache_creation + cache_read)`), matching Usage Analytics;
  - **5h Exhaustion ETA**: Displays estimated time to exhaustion alongside the 5h reset countdown when actively consuming quota, plus Expanded / Compact / Edge-Collapsed Capsule modes, Pin, Lock, 18px Magnetic Snap, Auto-Hide, and 50%–100% Opacity.
- **Redesigned Usage Analytics & Official API USD Cost (`$`, `v0.2.5`)**:
  - Clean 2-column top hero layout (`Total Tokens & 2×2 Four-Part Grid` on the left + `2×2 KPI Cards` for **API Equivalent Cost `$`, Cache Savings `$`, Cache Hit Rate `%`, and Daily/Hourly Avg Cost `$`** on the right), with full model/Effort breakdown, IANA/DST timezones, and TSV export.
- **In-Process 5h Auto-Wake Scheduler**: Configurable active windows, primary-account threshold pre-warming, and fresh `new_5h_confirmed` reset anchor verification with zero Windows background services.

---

## 🧬 Origin & Evolution from CCBaga

Claude-Local is **derived from the open-source project [CCBaga](https://github.com/liseami/CCBaga) (created by [@liseami](https://github.com/liseami) and contributors)**. We gratefully acknowledge the original authors for their foundational work on multi-identity archive encoding and browser profile isolation.

While preserving 100% compatibility with existing `.baga` vaults and browser seeds, Claude-Local is independently engineered for **Windows 10 / 11 x64 anti-ban isolation, full-chain WebRTC/IPv6/DNS/KYC defense, persistent 20-item browser verification, Free warming lifecycle management, Smart Relay rotation, passive quota/wake scheduling, and desktop HUD/USD analytics**:

| Dimension | Inherited CCBaga Baseline | Claude-Local (`v0.2.5`) Independent Engineering & Enhancements |
| :--- | :--- | :--- |
| **Browser Isolation & Anti-Ban Verification** | Basic Chromium launch & deterministic seed | **20-item anti-correlation verification (`v0.2.5` real 32-bit FNV-1a Canvas hash, sanitized `--accept-lang=en-US,en`, disabled `dns_prefetching`, word-boundary ASN check, and persistent in-memory results across browser close & tab switches)** + **Google WebRTC Network Limiter 3-key lockdown** + **On-Demand Non-Blocking Browser Kill-Switch (5s TUN drop / 60s country drift stop, zero CLI disruption)**. |
| **Risk / KYC & Full-Chain Network Defense** | Basic connectivity check | **Risk & KYC Workbench** + **One-Click Clash Verge / Mihomo Global Anti-Leak Override YAML (`v0.2.5` `ipv6: false` + `dns.ipv6: false`, QUIC/STUN block, Fake-IP reject, `prepend-rules` recognition, and full Anthropic/Persona/Stripe/Sentry/WorkOS residential routing)** + **4-client Mobile Same-Residential LAN QR Bridge**. |
| **Vault, 4D Sanitization & Full-Chain Backup** | `BAGAID01` magic header, `.baga` archives, SQLite `user_version = 3`, account HMACs | **Full backward compatibility**; added Zstandard streaming compression, bounded tar extraction, `ScratchGuard` cleanup, 4D cross-account CLI residue sanitization, and **full-chain `.clbackup` password-encrypted backups (vaults + `warming_cards.json` + `manual_subscriptions.json`)**. |
| **Free Warming Cards & Smart Relay** | Single identity list | Added **Free Warming Cards** (4-stage progress, **country + IANA timezone lock**, pre-open drift check, stage SOP guide, zero-rebind Pro promotion) and **Magpie-inspired Multi-Account Smart Relay & Rotation** (5 routing strategies + hysteresis preferred-account recovery). |
| **Passive Quota, Auto-Wake & HUD / USD Analytics** | Basic identity state | **Zero-write passive CLI quota observation + Python single-writer ledger** + **in-process Rust 5h auto-wake scheduler** + **redesigned `v0.2.5` Quota HUD (real 5h cache hit rate + exhaustion ETA)** + **Usage USD Cost (`$`) & Cache Savings Analytics**. |

---

## 📦 Download, Installation & Release History

### 1. Latest Windows x64 Installer (`v0.3.1`)

| Asset | Platform | File Size | SHA-256 Checksum |
| :--- | :--- | :--- | :--- |
| **[Claude-Local_0.3.1_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.1/Claude-Local_0.3.1_x64-setup.exe)** | Windows 10 / 11 (64-bit x64) | See Release assets | [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.1/SHA256SUMS.txt) |

Compute the installer SHA-256 in PowerShell and compare it with the checksum published in the [v0.3.1 Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.1):

```powershell
Get-FileHash .\Claude-Local_0.3.1_x64-setup.exe -Algorithm SHA256
```

### 2. Installation & Non-Disruptive Upgrade Notes

1. **Install Location & Identifiers**: Per-user NSIS installer defaulting to `%LOCALAPPDATA%\Programs\Claude-Local`; main executable `claude-local.exe`, bundle identifier `ai.local.claude-local`, companion browser registration `Claude-Local-Browser`.
2. **User Data Root**: All encrypted vaults, master keys, quota/usage ledgers, appearance settings, and browser profiles live under `%APPDATA%\ai.local.claude-local`.
3. **Seamless Upgrades**: Upgrading from `0.1.x`, `0.2.x`, or `0.3.0` to `0.3.1` preserves existing vaults, keys, and browser profiles without re-creating identities or interrupting running `claude.exe` sessions. Export a password-encrypted backup from `App settings → Data management` before upgrading.

### 3. Public Release Series (`0.1.0` – `0.3.1`)

| Version | Date | Highlights | Documentation |
| :--- | :--- | :--- | :--- |
| **`v0.3.1`** *(Latest)* | 2026-11-09 | **Smart Relay & Auto-Wakeup dialog GPU/React/IPC frame-rate optimizations (removal of full-screen `feTurbulence` SVG noise filter & double backdrop blur, 40-card `useMemo` & on-demand dialog subtree mounting, single-pass `quota_ledger.json`/`quota_web_metadata.json` reads, and cached Python runtime probe)**, **2× Retina Usage Overview poster export & equal-height model layout**, and **cleanroom `s13` device fingerprint continuity** | [Release Notes](docs/RELEASE_NOTES_0.3.1.md) |
| **`v0.3.0`** | 2026-11-07 | **Claude Code v2.1.309~2.1.318 cleanroom isolation & 3-lock protocol (7 credential keys + 25 account cache keys + `1p_failed_events`/`statsig` cleanroom + 8-lock cleanup)**, **zero-leak OAuth URL clipboard direct launch**, **CLI telemetry shield & MCP supply-chain security audit**, **Smart Relay 2.0 (dynamic anti-ping-pong margin, 429 cooldown jail, one-way no-return lock, Magpie `WeekLow` promotion, truthful decimal percentages)**, **Floating HUD 2.0 (next-relay standby pill, burn-pace badge, 24h weekly lead-in silence)**, and **3-stage cleanroom pipeline & 5h wakeup anchor verification** | [Release Notes](docs/RELEASE_NOTES_0.3.0.md) · [Verification](docs/RELEASE_VERIFICATION_0.3.0.md) |
| **`v0.2.7`** | 2026-11-03 | CLI telemetry (`datadoghq.com`) & OpenAI Codex co-routing rules, same-port dual-protocol (`socks5://` Browser vs. `http://` CLI) alignment, one-click CLI anti-leak `settings.json` snippet, and native `GRPC_PROXY` vault archiving | [Release Notes](docs/RELEASE_NOTES_0.2.7.md) |
| **`v0.2.6`** | 2026-11-02 | Compact drag/keyboard-reorderable cards, silent 5-second local sync, blank-card promotion fixes, HUD click-through and unobstructed metrics, relay pool capacity, targeted quota queries, per-request analytics and Markdown/TSV exports | [Release Notes](docs/RELEASE_NOTES_0.2.6.md) |
| **`v0.2.5`** | 2026-11-01 | **End-to-end anti-ban & KYC/WebRTC/IPv6/DNS hardening (`ipv6: false` + Persona/Stripe/Sentry/WorkOS residential routing + `--accept-lang` & `dns_prefetching` lockdown)**, **persistent 20-item browser verification across close/tab switches + real 32-bit FNV-1a Canvas pixel hash**, **warming card IANA timezone drift clarity**, and **redesigned Quota HUD (real 5h cache hit rate + exhaustion ETA) & Usage Analytics** | [Release Notes](docs/RELEASE_NOTES_0.2.5.md) |
| **`v0.2.4`** | 2026-10-31 | Magpie-inspired Multi-Account Smart Relay & Rotation (default OFF, 5 routing strategies + preferred hysteresis recovery), Companion Browser WebRTC Network Limiter lockdown + One-Click Desktop Clash Anti-Leak Override YAML, Official API USD Cost (`$`) & Cache Savings Analytics, 2-column Shadowrocket QR bridge, and one-click CLI browser return | [Release Notes](docs/RELEASE_NOTES_0.2.4_SMART_RELAY.md) |
| **`v0.2.3`** | 2026-10-30 | On-demand non-blocking Companion Browser Kill-Switch, layered `strict-route` remediation guide, warming card country/timezone lock & pre-open drift check, stage SOP reference, pace hints, and full-chain encrypted backup extension | [Release Notes](docs/RELEASE_NOTES_0.2.3_SECURITY.md) · [Verification](docs/RELEASE_VERIFICATION_0.2.3_SECURITY.md) |
| **`v0.2.2`** | 2026-10-29 | Identity card `MM/DD` subscription expiry badges & manual recharge entry, Risk & KYC exit-consistency & mobile residential bridge, independent statistics identities, four-part token analytics, and shared account-ledger HUD | [Release Notes](docs/RELEASE_NOTES_0.2.2_USAGE.md) |
| **`v0.2.0`** | 2026-10-26 | Token Monitor-style multi-mode Floating HUD (Pin/Lock/Snap/Auto-Hide/Opacity/Theme Sync), official API USD cost & cache savings analytics, auto-launch linked browser on account switch, and global UI/sidebar polish | [UI & HUD Note](docs/UI_MONITOR_0.2.0.md) · [Release Notes](docs/RELEASE_NOTES_0.2.0.md) · [Verification](docs/RELEASE_VERIFICATION_0.2.0.md) |
| **`v0.1.5`** | 2026-10-26 | Five-page copy & toolbar refinement, synthetic preview refresh, and 20-check isolated production browser verification | [UI Polish Note](docs/UI_POLISH_0.1.5.md) · [Verification](docs/RELEASE_VERIFICATION_0.1.5_UI.md) |
| **`v0.1.4`** | 2026-10-26 | Production CSP (`api.ipquery.io`) completion for same-IP hosting classification in the companion browser | [Browser CSP Note](docs/BROWSER_CSP_0.1.4.md) · [Verification](docs/RELEASE_VERIFICATION_0.1.4_BROWSER.md) |
| **`v0.1.3`** | 2026-10-26 | Phased no-STUN WebRTC candidate timing fix and same-IP hosting/ISP supplementary classification | [Browser Verification](docs/BROWSER_VERIFICATION_0.1.3.md) |
| **`v0.1.2`** | 2026-10-26 | Encrypted storage & backup hardening (`ScratchGuard` cleanup, tar extraction bounds, strict 32-byte key check) | [Crypto Hardening](docs/CRYPTO_HARDENING_0.1.2.md) · [Verification](docs/RELEASE_VERIFICATION_0.1.2_CRYPTO.md) |
| **`v0.1.1`** | 2026-10-26 | Separation of web quota recovery vs. CLI authorization state, local wakeup readiness sync, and recovery queue | [Auth Sync Note](docs/AUTH_SYNC_0.1.1.md) · [Verification](docs/RELEASE_VERIFICATION_0.1.1_SYNC.md) |
| **`v0.1.0`** | 2026-10-26 | Initial public baseline release: multi-identity vault, passive quota tracking, Effort usage analytics, native wakeup & companion browser | [Release Notes](docs/RELEASE_NOTES_0.1.0.md) · [Verification](docs/RELEASE_VERIFICATION_0.1.0.md) |

---

## ⚙️ Prerequisites & Building from Source

### Runtime Prerequisites

1. **OS**: Windows 10 / 11 64-bit (x64).
2. **Microsoft Edge WebView2 Runtime**: Pre-installed on modern Windows 10 and Windows 11.
3. **Python 3.10+ with `cryptography`** (required for external quota collection, online queries, and password backup encryption; verified with Python 3.13 in CI):
   ```powershell
   python -m pip install cryptography
   ```

### Build & Test from Source

See [Development Guide](docs/DEVELOPMENT.md) for details. With Bun, Rust (MSVC), Python 3, and VS C++ Build Tools installed:

```powershell
# 1. Install dependencies
bun install --frozen-lockfile
python -m pip install -r scripts/requirements-ci.txt

# 2. Run synthetic test suites (never touches live accounts or running CLI sessions)
bun test
cargo test --locked --manifest-path src-tauri/Cargo.toml --bin claude-local
python scripts/test-windows.py

# 3. Build local release binary or deploy to local installation
bun run build:local
bun run deploy:local

# 4. Build audited Windows NSIS installer in a neutral staging directory
python scripts/fetch-browser.py
bun run build:windows
```

---

## 🛡️ Architecture & Data Safety Boundaries

- **100% Local-First Storage**: All identity vaults, warming cards, manual subscription records, master keys, SQLite databases, and browser profiles stay under `%APPDATA%\ai.local.claude-local`. No credentials are ever uploaded to external cloud servers.
- **Passive Observation & Single-Writer Ledger**: Default quota sync passively reads local CLI files and never writes to `.claude.json`. Python is the sole writer for `quota_ledger.json` (protected by a cross-process file lock and atomic replace), while Rust merges newer same-account anchors in memory.
- **Account Isolation Over Freshness**: Every online query or wakeup freezes the target account's `quota_identity` fingerprint and verifies its OAuth profile and organization UUID before committing.
- **On-Demand Kill-Switch & Active CLI Session Protection**: The companion browser Kill-Switch triggers a one-shot stop + alert only while a managed browser is running and a TUN drop or country drift is confirmed, clearing automatically when the user relaunches the browser; whether triggered by the Kill-Switch, warming card actions, identity switching, residue cleanup, or CLI updates, **Claude-Local never stops, interrupts, or force-kills running `claude.exe` sessions**.

---

## 🔧 Known Limitations & Troubleshooting

- **Platform Scope**: Currently built and verified exclusively for **Windows 10 / 11 x64**.
- **Single-Identity Portable Pack (`bagapack`)**: Not yet implemented; use **Full-Chain `.clbackup` Password-Encrypted Backup (covering identity vaults, browser seeds, warming cards, and manual subscription records) & Isolated Recovery** under `App settings → Data management`.
- **Unsigned Installer Notice**: The NSIS installer is independently built without a commercial code-signing certificate; verify the SHA-256 checksum above if Windows SmartScreen prompts on first run.
- **Troubleshooting Guides**:
  - 🌱 [Free Warming Cards & Lifecycle Guide](docs/FEATURE_NOTES_WARMING_CARDS.md)
  - 🔗 [Web Quota vs. CLI Authorization Recovery](docs/CONNECTION_RECOVERY.md)
  - 📊 [Usage Statistics & Timezone Methodology](docs/USAGE_STATISTICS.md)
  - 🧭 [Comparison & Trade-offs vs. CCBaga](docs/CCBAGA_COMPARISON.md)
  - 📜 [Distribution & Third-Party License Boundaries](docs/DISTRIBUTION.md)

---

## 🤝 Contributing, License & Acknowledgements

Issues and Pull Requests are welcome via [GitHub Issues](https://github.com/yq04/Claude-Local/issues/new/choose). Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

### Acknowledgements

- **[CCBaga](https://github.com/liseami/CCBaga)**: Created by [@liseami](https://github.com/liseami) and contributors; Claude-Local inherits its MIT-licensed core vault architecture and `.baga` archive specification.
- **[magpie](https://github.com/yetone/magpie) & [agent-route](https://github.com/ryuu-restart/agent-route)**: Design inspiration for multi-account Smart Relay & rotation strategies, preferred-account hysteresis recovery, and desktop Clash/Mihomo anti-WebRTC/DNS leak override rules.
- **[ccusage](https://github.com/ccusage/ccusage), [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor), [CPA-Manager-Plus](https://github.com/seakee/CPA-Manager-Plus) & Token Monitor**: Design inspiration for local token ledger aggregation, official API USD cost estimation, usage analytics layout, and the desktop Floating HUD monitor.
- **[Fingerprint Chromium](https://github.com/adryfish/fingerprint-chromium)**, **vendor/cromma-ui**, **[LobeHub lobe-icons](https://github.com/lobehub/lobe-icons)** & **[Unicode CLDR 48](https://github.com/unicode-org/cldr)**: Governed by their respective licenses; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

> **Disclaimer**: Claude-Local is an independent open-source utility and is not affiliated with, endorsed by, or sponsored by Anthropic or the upstream CCBaga project.
