# Platform-Specific Request Interception

## Overview

Avalaunch employs a tiered request interception strategy to block unwanted network traffic across macOS, Windows, and Linux webview environments.

---

## Interception Architecture

```
Layer 1: Native Platform Hooks
├── Windows: ICoreWebView2::WebResourceRequested (webview2-com)
├── Linux: WebKitGTK resource-load-started signals (webkit2gtk)
└── macOS: WKContentRuleListStore compilation (objc2-web-kit)

Layer 2: Tauri Application Hooks
└── on_navigation: Top-level URL evaluation & redirection prevention

Layer 3: Frontend Script Injection (Universal Fallback)
├── Initialization Script: Injected before DOM creation
├── Cosmetic CSS Rules: Injected into <style id="avalaunch-shield-cosmetic">
├── Dynamic MutationObserver: Watches DOM additions and hides ad containers
└── Scriptlets: Injected into page context to neuter tracking scripts
```

---

## Platform Details

### 1. Windows (WebView2)
- Intercepts requests at the Chromium level via `ICoreWebView2::AddWebResourceRequestedFilter`.
- Checks URLs and resource types directly against `ShieldEngine::check_request()`.
- Aborts connections or returns empty responses (`HTTP 204 No Content` or `HTTP 200 OK` with empty body) for blocked items.

### 2. Linux (WebKitGTK 4.1)
- Hooks `resource-load-started` signal on the underlying `WebKitWebView`.
- Blocks tracking scripts, banner ads, and tracking pixels prior to network dispatch.

### 3. macOS (WKWebView)
- Compiles rule lists into WebKit's native JSON format (`WKContentRuleListStore`).
- Injects CSS cosmetic hiding rules and anti-tracking scriptlets at document start.

### 4. Cross-Platform Universal Layer
- **`on_navigation`**: Every top-level page navigation is inspected in Rust before loading.
- **`initialization_script`**: Injected into every frame prior to document rendering, ensuring cosmetic filters and scriptlets are active before page scripts execute.
