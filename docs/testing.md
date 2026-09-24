# Testing Strategy & Reference

Comprehensive test architecture, verification commands, assertions, environment setup, and troubleshooting guide for Avalaunch.

## Table of Contents

- [Overview & Test Architecture](#overview--test-architecture)
- [Test Environment Prerequisites](#test-environment-prerequisites)
- [Rust Backend Tests](#rust-backend-tests)
- [TypeScript / Frontend Unit Tests](#typescript--frontend-unit-tests)
- [Headless Chromium CDP End-to-End Tests](#headless-chromium-cdp-end-to-end-tests)
- [Quick Verification Matrix](#quick-verification-matrix)
- [Troubleshooting & CI/CD Guide](#troubleshooting--cicd-guide)

---

## Overview & Test Architecture

Avalaunch employs a 3-tier test pyramid covering the complete ad-blocking pipeline across both Rust backend engines and injected JavaScript environments:

```
                  ┌────────────────────────────────────────┐
                  │   CDP End-to-End Test (Chromium)       │  <- Real DOM & network interception
                  │   tests/cdp-adblock-test.mjs           │     (13 core assertions)
                  └────────────────────────────────────────┘
                  ┌────────────────────────────────────────┐
                  │   TypeScript Frontend Unit Tests       │  <- Isolated JS component mocks
                  │   tests/*.test.ts                      │     (Injector, interceptor, observer)
                  └────────────────────────────────────────┘
                  ┌────────────────────────────────────────┐
                  │   Rust Engine & Integration Tests      │  <- ShieldEngine, filter matching,
                  │   cargo test --workspace               │     cosmetic rules, multithreading
                  └────────────────────────────────────────┘
```

### Coverage Boundaries

| Layer | Target Components | Execution Tool | Scope |
|-------|-------------------|----------------|-------|
| **Backend** | `ShieldEngine`, filter parsing, cosmetic rule extraction, `hidden_class_id_selectors`, thread safety (`Arc<ShieldEngine>`) | `cargo test --workspace` | Native Rust unit & integration testing |
| **Frontend Unit** | MutationObserver batching, requestAnimationFrame debouncing, selector deduplication, monkey-patched `fetch`/`XHR`/`sendBeacon`, DOM element blocking | `node --experimental-strip-types --test` | Node.js native test runner (zero external test runner dependencies) |
| **End-to-End CDP** | Full lifecycle integration: Tauri IPC bridge mock, CSS injection, dynamic DOM hiding, dynamic `<script>`/`<iframe>` blocking, XHR/Fetch/Beacon blocking | `node tests/cdp-adblock-test.mjs` | Real headless Chromium instance controlled via Chrome DevTools Protocol |

---

## Test Environment Prerequisites

Before running tests, ensure the local environment meets the following requirements:

### Required Toolchains

- **Rust**: `stable` (1.75.0+ recommended) with `cargo` and `clippy`.
- **Node.js**: `v22.6.0+` (supports `--experimental-strip-types` for running `.ts` test files directly without transpilation).
- **Chromium**: Binary installed at `/usr/bin/chromium` (or available in `$PATH`).
- **Dependencies & Bundles**:
  ```bash
  npm install
  npm run build:injector   # Bundles src/*.ts into dist/injector.js (required before CDP tests)
  ```

---

## Rust Backend Tests

Rust tests validate core ad-blocking logic, filter list deserialization, memory efficiency, and thread-safe concurrent matching.

### Verification Commands

```bash
# Run all workspace unit and integration tests
cargo test --workspace

# Run specific YouTube Music integration tests
cargo test --test youtube_music_integration

# Run tests with output logging enabled
cargo test -- --nocapture

# Run clippy lints (must pass without warnings)
cargo clippy --workspace --all-targets -- -D warnings
```

### Key Test Suites & Assertions

#### 1. Engine Core & Filter Parsing (`src-tauri/src/shield/engine.rs`)
- **Initialization**: Parses EasyList & EasyPrivacy rules into memory without panic.
- **Network Matching**: Accurately classifies URLs as blocked/allowed based on origin and resource type (`script`, `image`, `xmlhttprequest`, `subdocument`, `media`).
- **Concurrency**: Safe parallel evaluation across multiple threads when wrapped in `Arc<ShieldEngine>`.
- **Cosmetic Rules**: Extracts domain-specific cosmetic CSS hide selectors and procedural actions.
- **Class/ID Lookup**: Fast heuristic matching using `hidden_class_id_selectors` for dynamic elements.

#### 2. YouTube Music Integration Suite (`src-tauri/tests/youtube_music_integration.rs`)
- **Manifest Loading**: Verifies `avalaunch.json` parsing (correct URL, window dimensions, shield flags enabled).
- **Ad & Tracker Blocking**:
  - `https://googleads.g.doubleclick.net/...` (`script`) $\rightarrow$ `matched: true`
  - `https://www.youtube.com/api/stats/ads?...` (`xhr`) $\rightarrow$ `matched: true`
  - `https://www.google-analytics.com/analytics.js` (`script`) $\rightarrow$ `matched: true`
- **Legitimate Stream Pass-Through**:
  - `https://music.youtube.com/youtubei/v1/browse` (`xhr`) $\rightarrow$ `matched: false`
  - `https://*.googlevideo.com/videoplayback?...` (`media`) $\rightarrow$ `matched: false` (Critical: ensures audio playback is never blocked)
- **Counter Invariants**: `engine.stats().blocked_count == 3`, `engine.stats().allowed_count == 2`.
- **Cosmetic Rules Generation**: Generates valid CSS hiding rules for `#player-ads`, `.ytmusic-mealbar-promo-renderer`, and `.ytmusic-ad-slot`.

---

## TypeScript / Frontend Unit Tests

Frontend tests run using Node.js native test runner (`node:test`) and native TypeScript stripping (`--experimental-strip-types`).

### Verification Commands

```bash
# Run all frontend unit tests
node --experimental-strip-types --test tests/cosmetic-injector.test.ts tests/network-interceptor.test.ts

# Run with npm test alias
npm test
```

### Key Test Suites & Assertions

#### 1. Cosmetic Injector (`tests/cosmetic-injector.test.ts`)
- **Style Tag Injection**: Injects `<style id="avalaunch-shield-cosmetic">` into document head or documentElement.
- **Selector Deduplication**: Prevents duplicate CSS rules from being re-appended to the style tag.
- **MutationObserver Batching**: Batches DOM mutations and schedules style updates via `requestAnimationFrame`.
- **Class & ID Filtering**: Scans added DOM nodes for ad/sponsor/promo classes and IDs, querying IPC `get_hidden_selectors`.
- **Scriptlet Execution**: Safely evaluates injected scriptlets (e.g., setting defuser flags on window).
- **Cleanup / Idempotency**: Calling destroy cleans up observers, style elements, and event listeners.

#### 2. Network Interceptor (`tests/network-interceptor.test.ts`)
- **Synchronous Regex Check**: `isUrlBlockedSync()` immediately intercepts well-known ad domains without IPC latency.
- **Async IPC Check & Caching**: `checkUrl()` calls `__TAURI__.core.invoke('check_url')` and caches decisions locally for synchronous fallback.
- **Monkey-Patched `fetch`**:
  - Blocked URL $\rightarrow$ returns empty synthetic `Response("", { status: 204, statusText: "No Content" })`.
  - Allowed URL $\rightarrow$ calls through to native `fetch`.
- **Monkey-Patched `XMLHttpRequest`**:
  - Blocked URL $\rightarrow$ cancels network call, sets `xhr.status = 204`, sets `xhr.__avalaunch_blocked = true`.
- **Monkey-Patched `navigator.sendBeacon`**:
  - Blocked tracking beacon $\rightarrow$ silences transmission, returns `true` to avoid caller errors.
- **Dynamic Pattern Registration**: `addBlockedPattern()` extends the synchronous blocklist at runtime.

---

## Headless Chromium CDP End-to-End Tests

The end-to-end suite (`tests/cdp-adblock-test.mjs`) automates a real headless Chromium browser via the Chrome DevTools Protocol to verify that the built `dist/injector.js` functions properly in a real browser runtime.

### Verification Commands

```bash
# 1. Build the frontend injector bundle first
npm run build:injector

# 2. Run the headless Chromium CDP test
node tests/cdp-adblock-test.mjs
```

### The 13 Core Assertions

| # | Assertion Metric | Target Behavior | Expected Result |
|---|------------------|-----------------|-----------------|
| 1 | `injectorLoaded` | `window.__AVALAUNCH_INJECTOR__` is registered | `true` |
| 2 | `scriptletExecuted` | Scriptlet sets `window.__SHIELD_SCRIPTLET_INITIALIZED__` | `true` |
| 3 | `cosmeticAdSlotHidden` | `.ytmusic-ad-slot` CSS computed style | `display: none` |
| 4 | `cosmeticPromoHidden` | `.ytmusic-mealbar-promo-renderer` CSS computed style | `display: none` |
| 5 | `legitimatePlayerVisible` | `#main-player.ytmusic-player` CSS computed style | `display: block` (not `none`) |
| 6 | `fetchAdBlocked` | `fetch("https://googleads.g.doubleclick.net/...")` | HTTP Status `204` / Empty body |
| 7 | `fetchStatsBlocked` | `fetch("https://www.youtube.com/api/stats/ads?...")` | HTTP Status `204` / Empty body |
| 8 | `fetchValidAllowed` | `fetch("data:text/plain,ok")` | HTTP Status `200` |
| 9 | `xhrAdBlocked` | `xhr.open("GET", "https://googleads...")` | `xhr.__avalaunch_blocked === true` or Status `204` |
| 10 | `beaconHandled` | `navigator.sendBeacon("https://google-analytics.com/...")` | Returns `true` without network dispatch |
| 11 | `dynamicAdHidden` | `document.createElement("div")` with `.dynamic-sponsor-banner` | MutationObserver collapses to `display: none` |
| 12 | `dynamicScriptBlocked` | `<script src="https://adservice.google.com/ads.js">` appended | Prevented from network execution / marked blocked |
| 13 | `dynamicIFrameBlocked` | `<iframe src="https://googleads.g.doubleclick.net/...">` appended | Blocked / redirected to `about:blank` / hidden |

---

## Quick Verification Matrix

Execute this sequence for a full, definitive health check of the codebase:

```bash
# Step 1: Rust linting and tests
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Step 2: TypeScript unit tests
node --experimental-strip-types --test tests/cosmetic-injector.test.ts tests/network-interceptor.test.ts

# Step 3: Injector build & CDP browser test
npm run build:injector
node tests/cdp-adblock-test.mjs
```

**Pass Criterion**: All commands exit with exit code `0` and CDP test logs `>>> ALL CDP AD-BLOCKING TESTS PASSED! <<<`.

---

## Troubleshooting & CI/CD Guide

### 1. Chromium Fails to Launch in CDP Tests
- **Symptom**: `Error: Failed to connect to Chromium CDP endpoint`.
- **Remedy**:
  - Verify Chromium installation: `which chromium || which google-chrome`.
  - In containerized/CI environments, ensure `--no-sandbox` and `--disable-gpu` flags are present in test spawn arguments.
  - Check if port `9225` is bound by another process: `lsof -i :9225`.

### 2. Missing `dist/injector.js`
- **Symptom**: `ENOENT: no such file or directory, open '.../dist/injector.js'`.
- **Remedy**: Run `npm run build:injector` before starting CDP tests.

### 3. Node.js TypeScript Stripping Errors
- **Symptom**: `SyntaxError: Unexpected token ':'` when executing `.ts` files directly.
- **Remedy**: Ensure Node.js is $\ge$ `v22.6.0` and invoke with `--experimental-strip-types`.

### 4. False Positives / Audio Playback Stoppage
- **Symptom**: Media streams from `googlevideo.com` or backend browse APIs get blocked.
- **Remedy**:
  - Run `cargo test --test youtube_music_integration -- --nocapture`.
  - Check filter rule specificity in `resources/easylist.txt`.
  - Ensure media request types are mapped properly in the engine's `check_request` caller.
