# Technology Stack

This document defines the complete technology stack, specific pinned dependency versions, runtime environments, platform-specific requirements, and build workflows for **Avalaunch**.

---

## Core Stack

### Rust
- **Version**: `1.85+` (Edition 2024)
- **Role**: Application core, ad-blocking engine, webview management, IPC routing, configuration deserialization
- **Rationale**: Rust 1.85+ is required to support the 2024 edition dependencies utilized by the `adblock` crate.

### Tauri
- **Version**: `2.10.2` (latest stable)
- **Build dependency**: `tauri-build` `2.5.5`
- **Role**: Native desktop application framework providing OS window management, webview abstraction, IPC bridge, and packaging.
- **Key Official Plugins**:
  - `tauri-plugin-window-state` `2.4.1` — Persistent window geometry, maximize state, and multi-monitor positioning across app restarts.
  - `tauri-plugin-shell` `2.3.5` — Safe spawned processes and external browser URL opening.
  - `tauri-plugin-opener` `2.5.3` — System file and default URI scheme opener.
  - `tauri-plugin-single-instance` `2.4.0` — Enforces a single running application instance with deep-link forwarding.
  - `tauri-plugin-notification` `2.3.3` — Native desktop system toast and banner notifications.
  - `tauri-plugin-global-shortcut` `2.3.1` — Global OS-level keyboard accelerators.

### adblock (Brave Adblock Rust)
- **Crate**: `adblock` `0.13.3`
- **License**: MPL-2.0
- **Role**: High-performance network request filtering and cosmetic resource extraction (CSS selector generation and scriptlet injection).
- **Features Configured**:
  - `embedded-domain-resolver` (default): Bundled Public Suffix List (PSL) for domain matching.
  - `full-regex-handling` (default): Complete regular expression support for complex adblock rule syntax.
  - `default-features = false` / omit `single-thread`: Enables thread-safe `Send + Sync` usage across async Tauri command handlers.
- **Supported Filter Formats**: Adblock Plus (ABP) standard rules, uBlock Origin static filters and scriptlets, Hosts files.
- **Performance Characteristics**: Zero-copy FlatBuffer-backed rule evaluation; ~15–25 MB memory footprint with EasyList + EasyPrivacy; fast cold startup via serialized engine caching.

### Frontend
- **Language**: TypeScript `5.7+`
- **Build Tool**: Vite `6.2+`
- **Role**: Cosmetic DOM filtering, dynamic `MutationObserver` injection, anti-circumvention scriptlet execution, and fallback service worker request interception.
- **Architecture**: Frameworkless (Pure TypeScript) — zero UI bloat, prioritizing minimal memory footprint and fast injection into wrapped remote web pages.

---

## Platform Dependencies (OS-Specific)

### macOS
- **Runtime Engine**: WKWebView
- **Rust Crates**:
  - `objc2` `0.5.2` + `objc2-web-kit` `0.2.2`: Native WebKit API access and WKContentRuleListStore compilation.
  - `block2` `0.5.1`, `dispatch` `0.2.0`: Objective-C runtime block bindings and Grand Central Dispatch synchronization.
- **Minimum OS Version**: macOS 12 (Monterey) on Apple Silicon (`aarch64`) and Intel (`x86_64`).

### Linux
- **Runtime Engine**: WebKitGTK 4.1
- **Rust Crates**:
  - `webkit2gtk` `2.0.2` (compiled with `v2_38` feature flags): WebKitGTK request interception and signal handling.
- **System Packages**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.
- **Minimum OS Version**: Ubuntu 22.04 LTS / Debian 12 / Fedora 38 (`x86_64`).

### Windows
- **Runtime Engine**: WebView2 (Chromium)
- **Rust Crates**:
  - `windows-sys` `0.61.2`: Win32 API system calls.
  - `webview2-com` `0.38.0`: Low-level COM interface for `ICoreWebView2`.
- **Interception Mechanism**: `WebResourceRequested` event filter provides full network-level request inspection and response interception.
- **Minimum OS Version**: Windows 10 (Version 1809+) or Windows 11 with Evergreen WebView2 Runtime (`x86_64`).

---

## Build & Development

### Tauri CLI
```bash
# Install Tauri CLI
cargo install tauri-cli --version ^2.10.0
# Or via npm
npm install -g @tauri-apps/cli@^2.10.0

# Development mode (launches Vite dev server and Tauri shell)
cargo tauri dev

# Production build
cargo tauri build
```

### Frontend Workspace
```bash
# Install frontend dependencies
npm install

# Run Vite dev server
npm run dev

# Build frontend bundle
npm run build
```

### Rust Workspace Commands
```bash
# Type check Rust crates
cargo check --workspace

# Run all automated test suites
cargo test --workspace

# Run Clippy linter with strict settings
cargo clippy --workspace -- -D warnings
```

---

## Compatibility Notes

### adblock Crate
1. **Rust Edition 2024**: The `adblock` crate requires Rust `1.85+` to compile its dependencies.
2. **Multi-Threading (`Send + Sync`)**: Disabling the default `single-thread` feature flag enables thread-safe sharing inside Tauri `tauri::State<Arc<ShieldEngine>>`.
3. **Serialized Cache**: Pre-serializing compiled filter lists onto disk significantly reduces cold-start latency from ~800ms to <25ms.
4. **List Expiration**: Standard filter lists like EasyList and EasyPrivacy require periodic synchronization (recommended every 4–7 days).

### Tauri v2 Request Interception Limitations
1. **Protocol Boundaries**: Tauri v2's built-in `on_web_resource_request` handler is scoped to custom protocols (e.g. `tauri://`, `app://`) and does not intercept standard external `http://` or `https://` requests.
2. **Native Platform Workarounds**:
   - **Windows**: Uses `webview2-com` to register `AddWebResourceRequestedFilter` directly on `ICoreWebView2`.
   - **Linux**: Intercepts `resource-load-started` signals via `webkit2gtk`.
   - **macOS**: Compiles filter rules into native JSON format using `WKContentRuleListStore`.
3. **Fallback Interceptor**: For environments without native wry hooks, an injected service worker and monkey-patched `fetch`/`XMLHttpRequest` provide auxiliary blocking.

### Cross-Platform Matrix
| Platform | Target Architecture | Webview Backend | Minimum OS | Primary Interception Method |
|---|---|---|---|---|
| **Windows** | `x86_64-pc-windows-msvc` | WebView2 (Chromium) | Windows 10 | `ICoreWebView2::WebResourceRequested` |
| **macOS** | `aarch64-apple-darwin`, `x86_64-apple-darwin` | WKWebView | macOS 12+ | `WKContentRuleListStore` + JS |
| **Linux** | `x86_64-unknown-linux-gnu` | WebKitGTK 4.1 | Ubuntu 22.04+ | `webkit2gtk` signal hooks |

---

## Version Pinning

To maintain deterministic builds and prevent regressions, all critical dependencies are pinned:

### Rust Crates (`Cargo.toml`)
```toml
[dependencies]
tauri = { version = "2.10.2", default-features = false, features = ["wry"] }
tauri-plugin-window-state = "2.4.1"
tauri-plugin-shell = "2.3.5"
tauri-plugin-opener = "2.5.3"
tauri-plugin-single-instance = "2.4.0"
tauri-plugin-notification = "2.3.3"
tauri-plugin-global-shortcut = "2.3.1"
adblock = { version = "0.13.3", default-features = false, features = ["embedded-domain-resolver", "full-regex-handling"] }
serde = { version = "1.0.219", features = ["derive"] }
serde_json = "1.0.140"
tokio = { version = "1.49.0", features = ["full"] }

[build-dependencies]
tauri-build = { version = "2.5.5", features = [] }
```

### Node / Frontend (`package.json`)
```json
{
  "devDependencies": {
    "@tauri-apps/cli": "2.10.2",
    "typescript": "5.7.3",
    "vite": "6.2.1"
  }
}
```

*Note: Any modifications to core version pins must be documented via an Architecture Decision Record in `docs/decisions/`.*
