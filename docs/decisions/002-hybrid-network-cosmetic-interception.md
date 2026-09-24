# ADR 002: Hybrid Network and Cosmetic Interception Architecture

## Status

**Accepted** (Immutable)

## Context

Avalaunch's core differentiator is wrapping arbitrary remote web applications into native desktop shells with integrated ad-blocking, tracker protection, and cosmetic cleaning.

In Tauri v2, the standard native protocol interception handler (`on_web_resource_request`) only intercepts custom registered schemes (e.g., `tauri://`, `app://`). It cannot natively intercept outbound external `https://` network requests initiated by remote web pages without employing platform-specific low-level webview APIs or frontend execution hooks. Relying solely on platform-specific native hooks creates uneven platform capabilities, while relying solely on frontend JavaScript monkey-patching leaves gaps in navigation, web worker traffic, and early page lifecycle loads.

Additionally, network request blocking alone cannot remove placeholder ad containers, collapse empty DOM elements, or defeat complex inline ad scripts. A comprehensive blocking solution requires both network-level request interception and DOM cosmetic filtering.

## Decision

Avalaunch adopts a multi-tiered **hybrid interception architecture** combining:

1. **Native OS / Webview Hooks**:
   - **Windows**: WebView2 `WebResourceRequested` event handlers for low-level HTTP/HTTPS request interception.
   - **Linux**: WebKitGTK `WebKitURISchemeRequest` and web extension hooks.
   - **macOS**: `WKContentRuleListStore` compile/match rules alongside native `WKWebView` navigation delegates.
2. **Tauri Window Navigation Guards**:
   - URL filtering and cancellation on top-level and frame navigations before request dispatch.
3. **Injected Frontend JavaScript Interception**:
   - Deep monkey-patching of client-side networking APIs: `window.fetch`, `XMLHttpRequest.prototype.open` / `send`, and `navigator.sendBeacon`.
   - Prototype wrapping on DOM setters creating dynamic external elements (`<script src="...">`, `<iframe src="...">`, `<img src="...">`, `<link rel="...">`).
   - Synchronous/asynchronous blocking verification via synchronous IPC or pre-compiled in-memory domain sets.
4. **Cosmetic Injection and DOM Cleaning**:
   - Early CSS injection of cosmetic hiding rules derived from `adblock-rust` rule sets.
   - `MutationObserver` runtime monitoring to continuously hide dynamically inserted ad containers and apply scriptlets.

## Rationale

1. **Defense-in-Depth**: No single layer in a cross-platform webview environment can capture 100% of network traffic across macOS, Linux, and Windows. Combining native webview hooks with frontend JS monkey-patching guarantees that requests slipping past higher-level webview boundaries are caught at the execution boundary.
2. **Platform Parity**: macOS (`WKWebView`), Linux (`WebKitGTK`), and Windows (`WebView2`) expose vastly different low-level extension models. The hybrid model provides a consistent baseline across all supported platforms.
3. **Elimination of Visual Artifacts**: Network blocking prevents ad resources from loading but leaves broken image icons and blank spaces. Injected CSS cosmetic rules and DOM observers collapse layout containers cleanly.
4. **Protection Against Modern Tracking**: Web beacons (`navigator.sendBeacon`) and asynchronous `fetch` calls used in telemetry pipelines often bypass simple navigation delegates; frontend monkey-patching guarantees visibility into all async egress traffic.

## Alternatives Considered

- **Custom Local Proxy Server (e.g., localhost HTTP/SOCKS proxy)**:
  - *Rejected*: Requires managing local system proxy settings, installing custom root SSL certificates for HTTPS MITM inspection, introduces security/privilege issues, and significantly increases startup latency and resource overhead.
- **Pure Frontend JavaScript Interception**:
  - *Rejected*: Injected scripts run after initial HTML parsing begins and cannot intercept initial document navigation requests, service workers, or raw webview resource loads before injection completes.
- **Pure Native OS Hooks**:
  - *Rejected*: macOS `WKContentRuleListStore` has strict rule count limitations and lacks support for dynamic procedural cosmetic scriptlets, making purely native interception insufficient for advanced filter rules.

## Consequences

- **Complete Ad and Tracker Coverage**: Comprehensive protection across all platforms for remote `https://` URLs without requiring proxy configuration or certificate installation.
- **Zero Unintercepted Async Network Traffic**: All async APIs (`fetch`, `xhr`, `sendBeacon`, dynamic script tags) are intercepted before dispatch.
- **High Performance**: In-memory rule matching via `adblock-rust` and serialized engine caches ensure sub-millisecond evaluation latency per request.
- **Increased Maintenance Surface**: The codebase must maintain platform-specific native hooks alongside frontend injection scripts and synchronization protocols between the Rust core and webview DOM contexts.
