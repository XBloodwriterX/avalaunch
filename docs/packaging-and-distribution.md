# Packaging and Distribution Reference

Operational reference for compiling, packaging, optimizing, and distributing Avalaunch desktop application binaries across Linux, macOS, and Windows.

---

## 1. Target Artifacts

Avalaunch produces platform-native bundles and standalone executables via Tauri v2 bundler (`cargo tauri build`).

| Platform | Architecture | Target Artifact | Output Directory | Primary Use Case |
|---|---|---|---|---|
| **Linux** | `x86_64` | AppImage (`.AppImage`) | `src-tauri/target/release/bundle/appimage/` | Universal Linux distribution (portable) |
| **Linux** | `x86_64` | Debian package (`.deb`) | `src-tauri/target/release/bundle/deb/` | Debian, Ubuntu, Linux Mint system package |
| **Linux** | `x86_64` | Standalone binary (`avalaunch`) | `src-tauri/target/release/avalaunch` | Portable CLI / systemd / manual deployment |
| **macOS** | `x86_64` (Intel) | Disk Image (`.dmg`) & `.app` | `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/` | Intel Mac distribution |
| **macOS** | `aarch64` (Apple Silicon) | Disk Image (`.dmg`) & `.app` | `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/` | Apple Silicon (M1/M2/M3/M4) distribution |
| **macOS** | Universal (`universal2`) | Disk Image (`.dmg`) & `.app` | `src-tauri/target/universal-apple-darwin/release/bundle/dmg/` | Unified single macOS installer |
| **Windows**| `x86_64` | WiX MSI (`.msi`) | `src-tauri/target/release/bundle/msi/` | Enterprise Windows installation |
| **Windows**| `x86_64` | NSIS Setup (`.exe`) | `src-tauri/target/release/bundle/nsis/` | Consumer Windows installer with auto-update support |

---

## 2. Configuration & Asset Pipeline

Avalaunch's packaging pipeline enforces determinism across configuration files, asset generators, bundled resources, and frontend compilation.

### 2.1 Tauri Configuration (`src-tauri/tauri.conf.json`)

Key packaging fields defined in `src-tauri/tauri.conf.json`:

```json
{
  "productName": "avalaunch",
  "version": "0.1.0",
  "identifier": "com.avalaunch.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "withGlobalTauri": true,
    "security": {
      "csp": null,
      "capabilities": ["default"]
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": [
      "resources/*"
    ]
  }
}
```

- **`identifier`**: Set to `com.avalaunch.app`. Used for OS sandbox identifiers, notification routing, and application data paths.
- **`bundle.resources`**: Globs `resources/*` to include baseline assets within the platform bundle.
- **`bundle.icon`**: Includes platform-specific icon assets generated for macOS (`icon.icns`), Windows (`icon.ico`), and Linux (`32x32.png`, `128x128.png`, `128x128@2x.png`).

### 2.2 Bundled Resources & FlatBuffer Cache (`src-tauri/resources/`)

The application bundles raw filter lists and pre-compiled bytecode caches inside `src-tauri/resources/`:

1. `easylist.txt`: Baseline EasyList network and cosmetic rules.
2. `easyprivacy.txt`: Baseline EasyPrivacy tracker rules.
3. `adblock_cache.dat`: Serialized FlatBuffer cache for instant sub-millisecond cold boot without raw text parsing.

At compile time:
- Baseline rules are baked into the binary via `include_str!("../resources/easylist.txt")` and `include_str!("../resources/easyprivacy.txt")`.
- Bundled resources in `resources/*` are placed into the operating system application directory at install time for filesystem access by `FilterListManager`.

### 2.3 Frontend Bundling Pipeline

The cosmetic injection script is compiled and embedded into the Rust binary:

```
src/injector.ts (TypeScript)
       │
       ▼ (npm run build / vite build)
dist/injector.js (IIFE Bundle)
       │
       ▼ (include_str! in src-tauri/src/lib.rs)
avalaunch binary (Embedded static string)
```

1. Vite executes `npm run build`, targeting `src/injector.ts` and emitting `dist/injector.js` in IIFE format with inline source maps omitted.
2. Rust compiles `src-tauri/src/lib.rs`, loading `dist/injector.js` into `pub const INJECTOR_JS: &str = include_str!("../../dist/injector.js");`.
3. `tauri::WebviewWindowBuilder::initialization_script` injects `INJECTOR_JS` before any page DOM or scripts execute.

---

## 3. CLI & Automated Build Commands

Always run builds through standard CLI commands to ensure all pre-build hooks and asset pipelines run in order.

### 3.1 Local Production Build

```bash
# 1. Build frontend artifacts (generates dist/injector.js)
npm run build

# 2. Build release binary and active OS bundles
cargo tauri build
```

`cargo tauri build` automatically executes `beforeBuildCommand` (`npm run build`) before compiling the Rust binary and packaging platform bundles.

### 3.2 Cross-Compilation & Architecture Targets

To build for specific target triples:

```bash
# Linux x86_64 release
cargo tauri build --target x86_64-unknown-linux-gnu

# macOS Apple Silicon (M1/M2/M3/M4)
cargo tauri build --target aarch64-apple-darwin

# macOS Intel
cargo tauri build --target x86_64-apple-darwin

# macOS Universal Binary
cargo tauri build --target universal-apple-darwin

# Windows 64-bit MSI / NSIS (from Windows host or MinGW/cross environment)
cargo tauri build --target x86_64-pc-windows-msvc
```

### 3.3 Selective Target Bundling

Limit bundle creation to specific package formats using the `--bundles` flag:

```bash
# Linux: build only AppImage
cargo tauri build --bundles appimage

# Linux: build only .deb package
cargo tauri build --bundles deb

# Windows: build only NSIS setup exe
cargo tauri build --bundles nsis

# macOS: build only DMG
cargo tauri build --bundles dmg
```

---

## 4. Runtime Dependencies & System Requirements

Ensure the host environment satisfies the minimum platform requirements.

### 4.1 Linux

Linux relies on WebKitGTK and GTK3 libraries.

- **Minimum OS**: Ubuntu 22.04 LTS / Debian 12 / Fedora 38 or equivalent
- **Runtime Packages**:
  - `libwebkit2gtk-4.1-0` (or `libwebkit2gtk-4.0-37`)
  - `libgtk-3-0`
  - `libayatana-appindicator3-1` (for system tray integration)
  - `librsvg2-2`
  - `openssl` / `ca-certificates`
- **Build / Development Dependencies**:
  ```bash
  sudo apt-get update && sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
  ```

### 4.2 Windows

Windows requires the Microsoft Edge WebView2 runtime.

- **Minimum OS**: Windows 10 (Build 1809+) or Windows 11 (64-bit)
- **Runtime Component**: Microsoft Edge WebView2 Evergreen Runtime (pre-installed on Windows 11 and updated Windows 10 machines).
- **Installer Integration**: The NSIS and WiX installers generated by Tauri automatically detect missing WebView2 runtimes and prompt/download the Evergreen bootstrapper if needed.

### 4.3 macOS

macOS leverages the native WKWebView framework.

- **Minimum OS**: macOS 12.0 (Monterey) or higher
- **Runtime Component**: Built-in system WebKit framework (no external webview runtime installation required).
- **Architectures**: Universal support for `x86_64` (Intel) and `aarch64` (Apple Silicon).

---

## 5. Security & Permission Capabilities

Avalaunch adheres to Tauri v2's strict capability security model.

### 5.1 Remote Domain Access Policy

Because Avalaunch operates as a browser shell for arbitrary web applications, IPC and window permissions are scoped in `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for Avalaunch main window",
  "windows": ["main"],
  "remote": {
    "urls": [
      "https://*/*",
      "https://*",
      "http://*/*",
      "http://*"
    ]
  },
  "permissions": [
    "core:default",
    "opener:default",
    "shell:default",
    "window-state:default",
    "notification:default",
    "global-shortcut:default"
  ]
}
```

- **`remote.urls`**: Explicitly permits remote web domains loaded in the `main` window to interact with core commands allowed by security capabilities.
- **`permissions`**: Whitelists exact plugin functionalities (`opener`, `window-state`, `notification`, `global-shortcut`).

---

## 6. Binary Optimization & Distribution Checklist

Complete all checklist items before tagging releases and uploading distribution artifacts.

### 6.1 Rust Binary Size Optimization

Verify release profile configuration in `src-tauri/Cargo.toml` or workspace configuration:

```toml
[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
strip = true
```

- **Target Size**: Release binary size should stay at ~24MB (including bundled rule sets, adblock engine, and embedded injector JS).
- **Stripping**: Verify debug symbols are stripped (`strip target/release/avalaunch`).

### 6.2 Pre-Distribution Verification Procedure

1. **Verify Frontend Clean Build**:
   ```bash
   npm run build
   # Assert dist/injector.js exists and is non-empty
   test -s dist/injector.js && echo "Frontend build valid"
   ```
2. **Execute Full Test Suite**:
   ```bash
   cargo test --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
   ```
3. **Verify Cold-Boot Adblock Cache Generation**:
   - Launch release binary on a clean profile.
   - Confirm adblock rules load within <10ms via FlatBuffer deserialization / bundled fallback.
4. **Verify Bundle Integrity**:
   - **Linux**: Test execution of generated `.AppImage` on Ubuntu 22.04 / 24.04 clean install.
   - **macOS**: Test DMG mounting, `.app` launch, and code signature / notarization verification (`codesign -vvv --deep --strict Avalaunch.app`).
   - **Windows**: Test NSIS `.exe` installer in a clean sandbox environment without pre-installed development tools.
