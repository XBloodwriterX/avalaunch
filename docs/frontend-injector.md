# Frontend Injector Reference (`cosmetic-injector.ts`)

Authoritative specification for Avalaunch frontend DOM element hiding, CSS injection, MutationObserver lifecycle, SPA navigation tracking, and scriptlet execution.

## Overview & System Boundaries

`src/cosmetic-injector.ts` implements frontend cosmetic filtering for remote web pages loaded in Avalaunch Tauri webviews. Injected at `document_start` via the Tauri initialization script interface (`initialization_script`), it works in tandem with the backend Rust Shield engine to eliminate ad markup, collapse blank ad spaces, execute anti-adblock circumvention scriptlets, and track dynamic SPA DOM mutations.

```
+-------------------------------------------------------------------------------+
| Webview Page Context                                                          |
|                                                                               |
|  +--------------------+   (1) get_cosmetic_resources    +------------------+  |
|  |  CosmeticInjector  | -----------------------------> |  Tauri Backend   |  |
|  |                    | <----------------------------- |  (Shield Engine) |  |
|  |  - <style> tag     |  (hide_selectors, scriptlets)  +------------------+  |
|  |  - Scriptlet Exec  |                                         ^             |
|  |  - SPA Hooks       |   (2) get_hidden_selectors              |             |
|  |  - MutationObserver| ----------------------------------------+             |
|  |  - rAF Batch Queue | <---------------------------------------+             |
|  +--------------------+     (matched dynamic selectors)                       |
+-------------------------------------------------------------------------------+
```

---

## Technical Constants & Identifiers

| Identifier | Value / Type | Purpose |
|------------|--------------|---------|
| `STYLE_ELEMENT_ID` | `"avalaunch-shield-cosmetic"` | Global DOM element ID for the cosmetic `<style>` node. |
| Global Bridge Reference | `window.__AVALAUNCH_INJECTOR__` | Window-level instance reference created during `initFrontend()`. |
| Max Cache Limit | `10000` | Maximum entries per class/id tracker set before pruning. |
| Cache Eviction Ratio | `25%` (`Math.floor(maxCacheSize / 4)`) | Eviction batch size when cache capacity is exceeded. |
| Batch Scheduler | `requestAnimationFrame` (fallback: `setTimeout(16ms)`) | Debounced frame synchronization for DOM query flushes. |

---

## TypeScript Types & IPC Protocol Contracts

### TypeScript Interfaces (`src/types.d.ts`)

```typescript
export interface CosmeticResources {
  hide_selectors: string[];
  injected_script: string;
  generics: boolean;
}

export interface TauriCore {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

export interface TauriGlobal {
  core: TauriCore;
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
    __TAURI_INTERNALS__?: {
      invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    __AVALAUNCH_INJECTOR__?: unknown;
    __AVALAUNCH_NETWORK__?: unknown;
  }
}
```

### IPC Commands

#### 1. `get_cosmetic_resources`
- **Trigger**: Page initialization or SPA route transition.
- **Request Parameters**:
  ```json
  {
    "pageUrl": "https://example.com/feed",
    "page_url": "https://example.com/feed"
  }
  ```
- **Response Payload**: `CosmeticResources`
  ```json
  {
    "hide_selectors": [".ad-banner", "#sponsored-post", "div[data-ad]"],
    "injected_script": "(function() { window.adblockDetected = false; })();",
    "generics": true
  }
  ```

#### 2. `get_hidden_selectors`
- **Trigger**: Flushed dynamic class and ID batch from DOM mutations.
- **Request Parameters**:
  ```json
  {
    "classes": ["advertisement", "sponsored-item", "nav-bar"],
    "ids": ["top-ad-slot", "main-content"],
    "exceptions": []
  }
  ```
- **Response Payload**: `string[]` (matching CSS selectors to hide)
  ```json
  [".advertisement", "#top-ad-slot"]
  ```

---

## Lifecycle State Machine

```
   +--------------------------------------------------------------+
   |                        Uninitialized                         |
   +--------------------------------------------------------------+
                                   |
                                   | init()
                                   v
   +--------------------------------------------------------------+
   |            Style Tag & SPA Hook Registration                 |
   |  - ensureStyleElement()                                      |
   |  - setupSpaNavigationHooks() (popstate, pushState, etc.)     |
   +--------------------------------------------------------------+
                                   |
                                   | refreshCosmeticResources()
                                   v
   +--------------------------------------------------------------+
   |             Fetch & Apply Cosmetic Resources                 |
   |  - IPC: get_cosmetic_resources(pageUrl)                      |
   |  - injectSelectors(hide_selectors)                           |
   |  - evaluateScriptlet(injected_script)                        |
   +--------------------------------------------------------------+
                                   |
                     +-------------+-------------+
                     |                           |
         [generics === true]             [generics === false]
                     |                           |
                     v                           v
   +----------------------------------+  +------------------------+
   |   Active Dynamic Observation     |  | Static Injection Only  |
   |  - setupObserver(childList, attr)|  | (Idle on DOM updates)  |
   |  - scanExistingDom()             |  +------------------------+
   |  - requestAnimationFrame batching|              |
   +----------------------------------+              |
                     |                               |
                     +-------------+-----------------+
                                   |
                                   | destroy()
                                   v
   +--------------------------------------------------------------+
   |                          Destroyed                           |
   |  - MutationObserver disconnected                             |
   |  - rAF cancelled, <style> removed, caches cleared            |
   +--------------------------------------------------------------+
```

---

## Core Subsystems

### 1. Dedicated Style Tag Management
- Target element: `<style id="avalaunch-shield-cosmetic" type="text/css">`.
- Insertion strategy:
  1. Inspects existing document for element matching `STYLE_ELEMENT_ID`.
  2. Inserts into `document.head`, `document.documentElement`, or `document.body` if available.
  3. If running before DOM elements exist (`readyState === "loading"`), registers a one-time `DOMContentLoaded` listener as fallback.
- Rule formulation: Injected selectors format as:
  ```css
  ${selector} { display: none !important; }
  ```
- Text appending: Appends text nodes or concatenates `textContent` to prevent full DOM restyles.

### 2. Scriptlet Execution Sandbox
- Evaluates anti-circumvention and defusing snippets supplied by filter lists (e.g. `set-constant`, `abort-current-inline-script`).
- Context: Global window context via indirect eval:
  ```typescript
  (0, eval)(script);
  ```
- Error isolation: Guarded in `try / catch` blocks to isolate syntax or runtime errors from main page execution.

### 3. Dynamic DOM Scanning & MutationObserver
- Configuration:
  ```typescript
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "id"],
  });
  ```
- Extraction:
  - Traverses added element subtrees via `el.querySelectorAll("[class], [id]")`.
  - Parses `classList` and `id` attributes.
  - Dedupes through `seenClasses` and `seenIds` sets.
  - Queues novel candidates into `pendingClasses` and `pendingIds`.

### 4. Debounced Batch Pipeline (`requestAnimationFrame`)
- Accumulates class and ID mutations during high-frequency DOM writes.
- Coalesces changes into one single IPC request per frame using `requestAnimationFrame` (falls back to 16ms timer in headless/worker environments).
- Concurrency lock: `isFlushing` flag prevents overlapping IPC calls; mutations occurring while in-flight automatically schedule the next frame.

### 5. Memory Bounding & Cache Pruning
- Limit: Caps `seenClasses` and `seenIds` sets at `10,000` entries.
- Eviction policy: Prunes the oldest 25% (2,500 entries) upon exceeding capacity using FIFO set iterator deletion.
- Prevents unbounded memory growth in long-running Single Page Applications (e.g., social infinite-scroll feeds).

### 6. Single Page Application (SPA) Navigation Hooks
- Hooks standard and custom navigation events:
  - `popstate`
  - `hashchange`
  - `yt-navigate-finish` (YouTube SPA navigation)
- Monkey-patches `window.history.pushState` and `window.history.replaceState` to trigger `refreshCosmeticResources()` on URL mutations without full page reloads.

---

## Method Contract Summary

| Class Method | Signature | Visibility | Functional Description |
|--------------|-----------|------------|------------------------|
| `init` | `(): Promise<void>` | `public` | Initializes style element, attaches SPA listeners, loads initial resources. |
| `refreshCosmeticResources` | `(): Promise<void>` | `public` | Checks URL change, invokes `get_cosmetic_resources`, applies rules and scriptlets. |
| `injectSelectors` | `(selectors: string[]): void` | `public` | Generates CSS `display: none !important;` text and appends to cosmetic style tag. |
| `evaluateScriptlet` | `(script: string): void` | `public` | Runs scriptlet in global scope via `(0, eval)(script)`. |
| `ensureStyleElement` | `(): HTMLStyleElement \| null` | `public` | Returns or creates the `<style id="avalaunch-shield-cosmetic">` node. |
| `getInjectedSelectorsCount` | `(): number` | `public` | Returns total unique CSS selectors currently active in the style tag. |
| `isInitialized` | `(): boolean` | `public` | Returns boolean initialization status. |
| `isGenericsEnabled` | `(): boolean` | `public` | Returns whether dynamic MutationObserver scanning is active. |
| `destroy` | `(): void` | `public` | Disconnects observer, clears timeouts/rAF, removes style tag, resets sets. |

---

## Performance & Guardrail Bounds

| Metric / Parameter | Value / Upper Bound | Architectural Justification |
|--------------------|---------------------|-----------------------------|
| Initial Execution Timing | `document_start` | Pre-injects rules before DOM paint to eliminate ad flicker / layout shifts. |
| Batch Debounce Interval | 1 frame (~16.6ms) | Synchronizes IPC calls with browser refresh cadence without blocking main thread. |
| Max Cache Footprint | ~10,000 entries | Restricts memory consumption to under ~1-2 MB even on complex infinite-scroll sites. |
| Cache Eviction Overhead | O(K) where K=2500 | Minimal set iteration overhead executed infrequently. |
| Redundant Query Filter | Immediate set lookup | `seenClasses` and `seenIds` block duplicate IPC requests for common classes. |
