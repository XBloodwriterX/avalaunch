# Network Request Interception

## Overview

The **Network Interceptor** (`src/network-interceptor.ts`) provides deep client-side request interception and cancellation across web APIs and dynamic DOM elements. In Avalaunch's hybrid ad-blocking architecture, the frontend interceptor works in concert with Rust host guards to guarantee that telemetry beacons, analytics scripts, ad banners, and tracker requests are neutralized before execution.

---

## Architecture & Request Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Webview Frame (DOM Context)                  │
│                                                                         │
│  ┌───────────────────────┐   ┌───────────────────┐   ┌───────────────┐  │
│  │ window.fetch          │   │ XMLHttpRequest    │   │ sendBeacon    │  │
│  │ (Monkey-Patched)      │   │ (Open / Send Hook)│   │ (Monkey-Patch)│  │
│  └───────────┬───────────┘   └─────────┬─────────┘   └───────┬───────┘  │
│              │                         │                     │          │
│              └────────────────┐        │       ┌─────────────┘          │
│                               ▼        ▼       ▼                        │
│                     ┌────────────────────────────────────┐              │
│                     │       NetworkInterceptor           │              │
│                     │                                    │              │
│                     │  ┌──────────────────────────────┐  │              │
│                     │  │ Fast In-Memory LRU Cache     │  │              │
│                     │  │ (5,000 entries max)          │  │              │
│                     │  └──────────────┬───────────────┘  │              │
│                     └─────────────────┼──────────────────┘              │
│                                       │ (Cache Miss)                    │
│                                       ▼                                 │
│                     ┌────────────────────────────────────┐              │
│                     │ Tauri IPC Bridge (invokeIPC)       │              │
│                     │ Command: "check_url"               │              │
│                     └─────────────────┬──────────────────┘              │
└───────────────────────────────────────┼─────────────────────────────────┘
                                        │ IPC
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Rust Host Application                         │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ commands::check_url(state: State<Arc<ShieldEngine>>, url, ...)    │  │
│  │ └─ adblock::Engine::check_network_request()                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Interception Vectors

### 1. `window.fetch`
- Intercepts all global `fetch(input, init)` calls.
- Normalizes URL strings, `Request` objects, and relative endpoints against `window.location.origin`.
- On rule match:
  - Aborts request dispatch.
  - Returns simulated `Response` with status `204 No Content` (or `200 OK`) and empty body to avoid throwing uncaught promise rejections in target web applications.

### 2. `XMLHttpRequest`
- Monkey-patches `XMLHttpRequest.prototype.open` to capture target URL and HTTP method.
- Monkey-patches `XMLHttpRequest.prototype.send` to evaluate blocking rules before network transmission.
- On rule match:
  - Aborts underlying XHR instance.
  - Sets `readyState = 4`, `status = 204`, and triggers `readystatechange` / `load` events to gracefully complete client handlers without error states.

### 3. `navigator.sendBeacon`
- Intercepts asynchronous telemetry transmission via `navigator.sendBeacon(url, data)`.
- On rule match:
  - Cancels beacon payload transmission.
  - Returns `true` (simulating successful queueing) so telemetry wrappers do not trigger fallback retry loops.

### 4. Dynamic DOM Element Creation
- Hooks `document.createElement` for `'script'`, `'iframe'`, and `'img'`.
- Proxies the `.src` property descriptor and `setAttribute('src', value)`.
- Categorizes request types for `adblock-rust`:
  - `<script>` → `request_type = "script"`
  - `<iframe>` → `request_type = "subdocument"`
  - `<img>` → `request_type = "image"`
- On rule match:
  - Replaces blocked destination with a transparent 1x1 data URI (`data:image/gif;base64,...`) or empty script body (`data:text/javascript;charset=utf-8,`).

---

## High-Performance Decision Cache

To prevent IPC bottlenecks and maintain sub-millisecond evaluation latency during rapid DOM insertions and network bursts:

```typescript
class NetworkInterceptor {
  private decisionCache: Map<string, boolean> = new Map();
  private readonly maxCacheEntries: number = 5000;
}
```

- **Cache Key**: `${request_type}:${normalized_url}`
- **Lookup Cost**: `<0.05ms` (synchronous Map lookup)
- **Eviction Strategy**: When reaching 5,000 entries, the oldest 25% of entries (1,250 items) are pruned via FIFO/LRU iteration.
- **Cache Invalidation**: Cache is flushed when filter lists are reloaded or updated at runtime via `update_filter_lists`.

---

## Type Signatures & Interfaces

### Block Result Data Contract
```typescript
export interface BlockResult {
  matched: boolean;
  filter?: string;
  redirect_url?: string;
}
```

### Tauri IPC Bridge Call
```typescript
const result = await invokeIPC<BlockResult>("check_url", {
  url: targetUrl,
  sourceUrl: window.location.href,
  requestType: "xhr", // "script" | "image" | "subdocument" | "xhr"
});
```

---

## Integration with Rust Host

The frontend network interceptor operates in concert with:

1. **`src-tauri/src/lib.rs`**: Window builder `on_navigation` callback intercepting top-level and iframe document navigations.
2. **`src-tauri/src/commands.rs`**: `check_url` IPC handler evaluating rules via `ShieldEngine::check_request()`.
3. **`src-tauri/src/shield/engine.rs`**: Thread-safe `Arc<ShieldEngine>` querying `adblock::Engine`.

---

## Related Documents

- [System Architecture](architecture.md)
- [Platform-Specific Interception](platform-interception.md)
- [Frontend Injector Internals](frontend-injector.md)
- [Testing Strategy & Assertions](testing.md)
- [ADR 002: Hybrid Interception](decisions/002-hybrid-network-cosmetic-interception.md)
