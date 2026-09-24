/**
 * Avalaunch Cosmetic Injector
 * MutationObserver-based dynamic DOM element hiding and CSS rule injection script.
 * Injected into remote web pages via Tauri initialization_script mechanism.
 */

import type { CosmeticResources } from "./types";

export const STYLE_ELEMENT_ID = "avalaunch-shield-cosmetic";

/**
 * Invokes a Tauri IPC command using the global Tauri v2 bridge.
 */
export async function invokeIPC<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window !== "undefined") {
    if (window.__TAURI_INTERNALS__?.invoke) {
      return window.__TAURI_INTERNALS__.invoke<T>(cmd, args);
    }
    if (window.__TAURI__?.core?.invoke) {
      return window.__TAURI__.core.invoke<T>(cmd, args);
    }
    if (window.__TAURI__?.invoke) {
      return window.__TAURI__.invoke<T>(cmd, args);
    }
  }
  throw new Error(`[Avalaunch] Tauri IPC bridge not available for command: ${cmd}`);
}

/**
 * CosmeticInjector handles CSS rule injection, scriptlet execution,
 * and MutationObserver-based dynamic DOM cosmetic filtering.
 */
export class CosmeticInjector {
  private styleElement: HTMLStyleElement | null = null;
  private observer: MutationObserver | null = null;
  private pendingClasses: Set<string> = new Set();
  private pendingIds: Set<string> = new Set();
  private seenClasses: Set<string> = new Set();
  private seenIds: Set<string> = new Set();
  private injectedSelectors: Set<string> = new Set();
  private rafId: number | null = null;
  private initialized: boolean = false;
  private genericsEnabled: boolean = false;
  private isFlushing: boolean = false;
  private lastLoadedUrl: string = "";
  private readonly maxCacheSize: number = 10000;

  /**
   * Initializes cosmetic filtering for the current page:
   * 1. Prepares cosmetic <style> tag in document
   * 2. Fetches cosmetic resources from Tauri backend via IPC
   * 3. Injects initial CSS hiding rules into <head> style tag
   * 4. Executes anti-circumvention / ad-blocking scriptlets
   * 5. If generic rules are enabled, starts MutationObserver for dynamic hiding
   * 6. Sets up SPA navigation listeners
   */
  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    // Ensure style element is prepared in the document
    this.ensureStyleElement();

    // Hook SPA navigation events
    this.setupSpaNavigationHooks();

    // Load cosmetic resources for current URL
    await this.refreshCosmeticResources();
  }

  /**
   * Refreshes cosmetic resources when navigating to a new URL.
   */
  public async refreshCosmeticResources(): Promise<void> {
    const pageUrl = typeof window !== "undefined" && window.location ? window.location.href : "";
    if (pageUrl === this.lastLoadedUrl && this.injectedSelectors.size > 0) {
      return;
    }
    this.lastLoadedUrl = pageUrl;

    try {
      // Fetch domain-specific cosmetic rules and scriptlets
      const resources = await invokeIPC<CosmeticResources>("get_cosmetic_resources", {
        pageUrl,
        page_url: pageUrl,
      });

      if (resources) {
        // 1. Inject static domain hide selectors
        if (Array.isArray(resources.hide_selectors) && resources.hide_selectors.length > 0) {
          this.injectSelectors(resources.hide_selectors);
        }

        // 2. Evaluate injected scriptlet if present
        if (resources.injected_script && resources.injected_script.trim().length > 0) {
          this.evaluateScriptlet(resources.injected_script);
        }

        // 3. Set up MutationObserver if generic rules are active
        if (resources.generics) {
          this.genericsEnabled = true;
          this.setupObserver();
          this.scanExistingDom();
        }
      }
    } catch (err) {
      console.warn("[Avalaunch] Failed to fetch cosmetic resources:", err);
    }
  }

  /**
   * Injects CSS selectors into the dedicated cosmetic style element.
   * Generates `display: none !important;` rules for each selector.
   */
  public injectSelectors(selectors: string[]): void {
    const newSelectors: string[] = [];

    for (const selector of selectors) {
      const trimmed = selector.trim();
      if (trimmed && !this.injectedSelectors.has(trimmed)) {
        this.injectedSelectors.add(trimmed);
        newSelectors.push(trimmed);
      }
    }

    if (newSelectors.length === 0) {
      return;
    }

    const styleEl = this.ensureStyleElement();
    if (!styleEl) {
      return;
    }

    // Build CSS rules chunk
    const cssRules = newSelectors
      .map((sel) => `${sel} { display: none !important; }`)
      .join("\n");

    try {
      styleEl.appendChild(document.createTextNode(cssRules + "\n"));
    } catch {
      styleEl.textContent = (styleEl.textContent || "") + "\n" + cssRules;
    }
  }

  /**
   * Safely evaluates an injected scriptlet in the global context.
   */
  public evaluateScriptlet(script: string): void {
    if (!script || !script.trim()) {
      return;
    }

    try {
      // Execute in global scope via indirect eval
      (0, eval)(script);
    } catch (err) {
      console.error("[Avalaunch] Failed to execute cosmetic scriptlet:", err);
    }
  }

  /**
   * Locates or creates the dedicated <style id="avalaunch-shield-cosmetic"> element.
   */
  public ensureStyleElement(): HTMLStyleElement | null {
    if (typeof document === "undefined") {
      return null;
    }

    if (this.styleElement && this.styleElement.isConnected) {
      return this.styleElement;
    }

    const existing = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    if (existing) {
      this.styleElement = existing;
      return existing;
    }

    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.type = "text/css";

    const target = document.head || document.documentElement || document.body;
    if (target) {
      target.appendChild(style);
    } else {
      // If neither head nor documentElement exists yet (document_start), wait for DOM ready
      const attachWhenReady = () => {
        const root = document.head || document.documentElement || document.body;
        if (root && !style.isConnected) {
          root.appendChild(style);
        }
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", attachWhenReady, { once: true });
      }
    }

    this.styleElement = style;
    return style;
  }

  /**
   * Hooks Single Page Application navigation events (History API, hashchange, custom yt events).
   */
  private setupSpaNavigationHooks(): void {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;

    const onNav = () => {
      this.refreshCosmeticResources().catch(() => {});
    };

    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    window.addEventListener("yt-navigate-finish", onNav);

    // Monkey-patch history.pushState and history.replaceState
    if (window.history) {
      const origPush = window.history.pushState;
      const origReplace = window.history.replaceState;

      window.history.pushState = function (...args) {
        const res = origPush.apply(this, args);
        onNav();
        return res;
      };

      window.history.replaceState = function (...args) {
        const res = origReplace.apply(this, args);
        onNav();
        return res;
      };
    }
  }

  /**
   * Sets up the MutationObserver on the root DOM node to watch for newly added elements.
   */
  private setupObserver(): void {
    if (this.observer || typeof MutationObserver === "undefined" || typeof document === "undefined") {
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    const root = document.documentElement || document.body || document;
    if (root) {
      this.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "id"],
      });
    }
  }

  /**
   * Scans currently existing DOM nodes in document.
   */
  private scanExistingDom(): void {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.body || document.documentElement;
    if (root) {
      this.scanElement(root);
      if (this.pendingClasses.size > 0 || this.pendingIds.size > 0) {
        this.scheduleBatch();
      }
    }
  }

  /**
   * Processes MutationRecord entries and extracts new classes and IDs.
   */
  private handleMutations(mutations: MutationRecord[]): void {
    for (let i = 0; i < mutations.length; i++) {
      const mutation = mutations[i];

      if (mutation.type === "childList") {
        const addedNodes = mutation.addedNodes;
        for (let j = 0; j < addedNodes.length; j++) {
          const node = addedNodes[j];
          if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
            this.scanElement(node as Element);
          }
        }
      } else if (mutation.type === "attributes") {
        const target = mutation.target;
        if (target.nodeType === 1 /* Node.ELEMENT_NODE */) {
          this.extractClassAndId(target as Element, this.pendingClasses, this.pendingIds);
        }
      }
    }

    if (this.pendingClasses.size > 0 || this.pendingIds.size > 0) {
      this.scheduleBatch();
    }
  }

  /**
   * Scans an element and all its descendants for classes and IDs.
   */
  private scanElement(el: Element): void {
    this.extractClassAndId(el, this.pendingClasses, this.pendingIds);

    const children = el.querySelectorAll("[class], [id]");
    for (let i = 0; i < children.length; i++) {
      this.extractClassAndId(children[i], this.pendingClasses, this.pendingIds);
    }
  }

  /**
   * Extracts class and ID values from an element and queues them if not seen before.
   */
  private extractClassAndId(el: Element, targetClasses: Set<string>, targetIds: Set<string>): void {
    // Check ID
    const id = el.id;
    if (id && typeof id === "string" && !this.seenIds.has(id)) {
      this.seenIds.add(id);
      targetIds.add(id);
    }

    // Check class names
    if (el.classList && el.classList.length > 0) {
      for (let i = 0; i < el.classList.length; i++) {
        const cls = el.classList.item(i);
        if (cls && !this.seenClasses.has(cls)) {
          this.seenClasses.add(cls);
          targetClasses.add(cls);
        }
      }
    } else if (typeof el.className === "string" && el.className.trim()) {
      const parts = el.className.trim().split(/\s+/);
      for (let i = 0; i < parts.length; i++) {
        const cls = parts[i];
        if (cls && !this.seenClasses.has(cls)) {
          this.seenClasses.add(cls);
          targetClasses.add(cls);
        }
      }
    }

    this.pruneCacheIfNeeded();
  }

  /**
   * Schedules a debounced batch flush via requestAnimationFrame.
   */
  private scheduleBatch(): void {
    if (this.rafId !== null) {
      return;
    }

    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(() => {
        this.flushBatch();
      });
    } else {
      this.rafId = setTimeout(() => {
        this.flushBatch();
      }, 16) as unknown as number;
    }
  }

  /**
   * Flushes batched classes and IDs, queries Tauri IPC, and applies matching hiding selectors.
   */
  private async flushBatch(): Promise<void> {
    this.rafId = null;

    if (this.isFlushing) {
      // Re-schedule for next frame if currently in flight
      this.scheduleBatch();
      return;
    }

    if (this.pendingClasses.size === 0 && this.pendingIds.size === 0) {
      return;
    }

    const classes = Array.from(this.pendingClasses);
    const ids = Array.from(this.pendingIds);
    this.pendingClasses.clear();
    this.pendingIds.clear();

    this.isFlushing = true;

    try {
      const hiddenSelectors = await invokeIPC<string[]>("get_hidden_selectors", {
        classes,
        ids,
        exceptions: [],
      });

      if (Array.isArray(hiddenSelectors) && hiddenSelectors.length > 0) {
        this.injectSelectors(hiddenSelectors);
      }
    } catch (err) {
      console.warn("[Avalaunch] Failed to fetch hidden selectors for batch:", err);
    } finally {
      this.isFlushing = false;

      // If more classes/ids accumulated while IPC was in flight, schedule next batch
      if (this.pendingClasses.size > 0 || this.pendingIds.size > 0) {
        this.scheduleBatch();
      }
    }
  }

  /**
   * Prunes seen cache when exceeding max size to keep memory minimal.
   */
  private pruneCacheIfNeeded(): void {
    if (this.seenClasses.size > this.maxCacheSize) {
      const toDelete = Math.floor(this.maxCacheSize / 4);
      let count = 0;
      for (const cls of this.seenClasses) {
        this.seenClasses.delete(cls);
        count++;
        if (count >= toDelete) break;
      }
    }

    if (this.seenIds.size > this.maxCacheSize) {
      const toDelete = Math.floor(this.maxCacheSize / 4);
      let count = 0;
      for (const id of this.seenIds) {
        this.seenIds.delete(id);
        count++;
        if (count >= toDelete) break;
      }
    }
  }

  /**
   * Gets the count of injected CSS selectors.
   */
  public getInjectedSelectorsCount(): number {
    return this.injectedSelectors.size;
  }

  /**
   * Checks whether the injector is currently initialized.
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Checks whether generic selector filtering is active.
   */
  public isGenericsEnabled(): boolean {
    return this.genericsEnabled;
  }

  /**
   * Disconnects MutationObserver, cancels pending batches, and cleans up resources.
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.rafId);
      } else {
        clearTimeout(this.rafId);
      }
      this.rafId = null;
    }

    if (this.styleElement && this.styleElement.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
      this.styleElement = null;
    }

    this.pendingClasses.clear();
    this.pendingIds.clear();
    this.seenClasses.clear();
    this.seenIds.clear();
    this.injectedSelectors.clear();
    this.initialized = false;
    this.genericsEnabled = false;
    this.isFlushing = false;
    this.lastLoadedUrl = "";
  }
}

/**
 * Helper function to create and initialize a CosmeticInjector instance.
 */
export function initCosmeticInjector(): CosmeticInjector {
  const injector = new CosmeticInjector();
  injector.init().catch((err) => {
    console.warn("[Avalaunch] Cosmetic injector init error:", err);
  });
  return injector;
}
