# Avalaunch

Turn any webpage into a high-performance native desktop application with integrated ad blocking, tracker protection, and cosmetic DOM cleaning.

Built from scratch with [Tauri v2](https://v2.tauri.app/) and [Brave's adblock-rust](https://github.com/brave/adblock-rust).

---

## Key Features

- 🛡️ **Hybrid Ad-Blocking Engine**: Native FlatBuffer-backed request evaluation using Brave's `adblock` engine (0.13.3) paired with deep frontend client-side interception (`fetch`, `XHR`, `sendBeacon`, dynamic `<script>` / `<iframe>` / `<img>`).
- 🎨 **Dynamic Cosmetic Filtering**: Automated CSS selector injection (`display: none !important;`) and batched `MutationObserver` DOM scanning with `requestAnimationFrame` debouncing.
- ⚡ **Instant Cold-Start**: Pre-compiled bytecode rule serialization (`adblock_cache.dat`) reduces startup rule initialization from ~800ms to under 25ms.
- 🔒 **Zero-Telemetry Security Model**: No telemetry egress, isolated webview storage profiles, and hardened Tauri v2 capability lockdowns.
- 📦 **Cross-Platform Packaging**: Native desktop packages for Linux (`.AppImage`, `.deb`), macOS (`.dmg`, `.app`), and Windows (`.msi`, `.exe`).
- 🎵 **Pre-Configured YouTube Music Target**: Fully verified packaged application for `https://music.youtube.com` with ad blocking and audio stream pass-through.

---

## Quickstart

### Prerequisites

- **Rust**: 1.85+ (Edition 2024)
- **Node.js**: v22+ / v24+
- **System Webview**:
  - Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`
  - macOS: macOS 12+ (WebKit built-in)
  - Windows: Microsoft Edge WebView2 Evergreen Runtime

### Installation & Development

```bash
# Clone the repository
git clone https://github.com/your-org/avalaunch.git
cd avalaunch

# Install frontend dependencies
npm install

# Run the development environment (launches Vite + Tauri webview)
cargo tauri dev
```

### Building for Production

```bash
# 1. Compile frontend injector bundle
npm run build

# 2. Compile native release application binary
cargo tauri build
```

The resulting optimized desktop application binary is produced in `target/release/avalaunch`.

---

## Verification & Testing

Avalaunch includes an automated 3-tier test harness:

```bash
# 1. Run Rust engine unit & integration tests
cargo test --workspace

# 2. Run TypeScript frontend injector unit tests
npm test

# 3. Run Headless Chromium CDP End-to-End Adblock Test
node tests/cdp-adblock-test.mjs
```

---

## Architecture & Documentation

Comprehensive, agent-ready technical documentation is available in the [`docs/`](./docs/) directory:

- 📖 **[Documentation Index](docs/index.md)**: Master navigation hub for all project documentation.
- 🏗️ **[System Architecture](docs/architecture.md)**: Subsystem boundaries, data flows, and hybrid interception model.
- ⚙️ **[Technology Stack](docs/techstack.md)**: Pinned versions, crate features, and platform runtime matrix.
- 🛡️ **[Shield Engine Internals](docs/shield-engine.md)**: Concurrency model, FlatBuffer serialization, and rule evaluation.
- 🌐 **[Network Interception](docs/network-interception.md)**: Client API monkey-patching, request categorization, and decision caching.
- 🎨 **[Frontend Injector](docs/frontend-injector.md)**: Dynamic CSS hiding, MutationObserver batching, and scriptlets.
- 📋 **[Filter List Management](docs/filter-lists.md)**: Rule lifecycle, synchronization intervals, and disk caching.
- ⚙️ **[Application Configuration](docs/configuration.md)**: JSON manifest options, window geometry, and Shield settings.
- 📦 **[Packaging & Distribution](docs/packaging-and-distribution.md)**: Build pipelines, platform targets, and binary optimization.
- 🔒 **[Security & Privacy](docs/security-and-privacy.md)**: Threat models, capability sandboxing, and data isolation.
- 🧪 **[Testing Strategy](docs/testing.md)**: Test suites, assertion criteria, and CI verification workflows.

### Architectural Decision Records (ADRs)
- [ADR 001: Build from Scratch vs. Forking Pake](docs/decisions/001-build-from-scratch.md)
- [ADR 002: Hybrid Network and Cosmetic Interception Architecture](docs/decisions/002-hybrid-network-cosmetic-interception.md)

---

## License

Permissively dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
