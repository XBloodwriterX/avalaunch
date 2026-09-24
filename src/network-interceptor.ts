/**
 * Avalaunch Network Interceptor
 * Intercepts and blocks ad & tracker network requests in the webview context:
 * - window.fetch
 * - window.XMLHttpRequest
 * - navigator.sendBeacon
 * - DOM element creation (script, iframe, img src properties)
 * - window.open popups
 */

import type { BlockResult } from "./types";
import { invokeIPC } from "./cosmetic-injector.ts";

/**
 * Common ad and tracking URL patterns for instantaneous synchronous matching.
 * Populated dynamically with results from the Shield Engine.
 */
const KNOWN_BLOCKED_HOST_PATTERNS = [
  "doubleclick.net",
  "googleads.g.doubleclick.net",
  "adservice.google.com",
  "google-analytics.com",
  "googlesyndication.com",
  "/api/stats/ads",
  "/pagead/",
  "pagead2.googlesyndication.com",
  "ad.doubleclick.net",
  "static.doubleclick.net",
  "adnxs.com",
  "criteo.com",
  "amazon-adsystem.com",
  "taboola.com",
  "outbrain.com",
  "scorecardresearch.com",
];

const BLOCKED_IMAGE_1X1 = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const BLOCKED_SCRIPT_EMPTY = "data:text/javascript;charset=utf-8,/* blocked by avalaunch */";
const BLOCKED_FRAME_EMPTY = "about:blank";

export class NetworkInterceptor {
  private originalFetch: typeof window.fetch | null = null;
  private originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  private originalSendBeacon: typeof navigator.sendBeacon | null = null;
  private originalCreateElement: typeof document.createElement | null = null;
  private originalWindowOpen: typeof window.open | null = null;

  private cache: Map<string, BlockResult> = new Map();
  private maxCacheSize: number = 2000;
  private initialized: boolean = false;

  /**
   * Fast synchronous check using in-memory cache and pattern rules.
   */
  public isUrlBlockedSync(url: string): boolean {
    if (!url || typeof url !== "string") {
      return false;
    }

    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) {
      return false;
    }

    const cached = this.cache.get(url);
    if (cached !== undefined) {
      return cached.matched;
    }

    for (const pattern of KNOWN_BLOCKED_HOST_PATTERNS) {
      if (url.includes(pattern)) {
        this.cache.set(url, { matched: true, filter: pattern, redirect_url: null });
        return true;
      }
    }

    return false;
  }

  /**
   * Asynchronously evaluates a URL with the Tauri Shield Engine backend
   * and updates the local decision cache.
   */
  public async checkUrl(
    url: string,
    sourceUrl?: string,
    requestType: string = "other"
  ): Promise<BlockResult> {
    if (!url || typeof url !== "string") {
      return { matched: false };
    }

    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) {
      return { matched: false };
    }

    const cached = this.cache.get(url);
    if (cached !== undefined) {
      return cached;
    }

    // Check fast synchronous patterns
    for (const pattern of KNOWN_BLOCKED_HOST_PATTERNS) {
      if (url.includes(pattern)) {
        const result: BlockResult = { matched: true, filter: pattern, redirect_url: null };
        this.cacheResult(url, result);
        return result;
      }
    }

    const currentSource = sourceUrl || (typeof window !== "undefined" && window.location ? window.location.href : "");

    try {
      const result = await invokeIPC<BlockResult>("check_url", {
        url,
        sourceUrl: currentSource,
        source_url: currentSource,
        requestType,
        request_type: requestType,
      });

      if (result) {
        this.cacheResult(url, result);
        return result;
      }
    } catch {
      // If IPC fails, fallback to synchronous heuristics
    }

    const fallback: BlockResult = { matched: false };
    this.cacheResult(url, fallback);
    return fallback;
  }

  /**
   * Adds an ad pattern to the fast synchronous match list.
   */
  public addBlockedPattern(pattern: string): void {
    if (pattern && !KNOWN_BLOCKED_HOST_PATTERNS.includes(pattern)) {
      KNOWN_BLOCKED_HOST_PATTERNS.push(pattern);
    }
  }

  /**
   * Installs network monkey-patch hooks into window, document, and prototypes.
   */
  public init(): void {
    if (this.initialized || typeof window === "undefined") {
      return;
    }
    this.initialized = true;

    this.hookFetch();
    this.hookXHR();
    this.hookSendBeacon();
    this.hookDOMCreation();
    this.hookWindowOpen();
  }

  /**
   * Restores all original browser functions and cleans up state.
   */
  public destroy(): void {
    if (!this.initialized || typeof window === "undefined") {
      return;
    }

    if (this.originalFetch) {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
    }

    if (this.originalXhrOpen && this.originalXhrSend) {
      XMLHttpRequest.prototype.open = this.originalXhrOpen;
      XMLHttpRequest.prototype.send = this.originalXhrSend;
      this.originalXhrOpen = null;
      this.originalXhrSend = null;
    }

    if (this.originalSendBeacon && typeof navigator !== "undefined") {
      navigator.sendBeacon = this.originalSendBeacon;
      this.originalSendBeacon = null;
    }

    if (this.originalCreateElement && typeof document !== "undefined") {
      document.createElement = this.originalCreateElement;
      this.originalCreateElement = null;
    }

    if (this.originalWindowOpen) {
      window.open = this.originalWindowOpen;
      this.originalWindowOpen = null;
    }

    this.cache.clear();
    this.initialized = false;
  }

  private cacheResult(url: string, result: BlockResult): void {
    if (this.cache.size >= this.maxCacheSize) {
      const iter = this.cache.keys();
      for (let i = 0; i < 200; i++) {
        const k = iter.next().value;
        if (k) this.cache.delete(k);
        else break;
      }
    }
    this.cache.set(url, result);
  }

  private resolveUrl(input: RequestInfo | URL | string): string {
    let raw = "";
    if (typeof input === "string") {
      raw = input;
    } else if (input instanceof URL) {
      raw = input.href;
    } else if (input && typeof (input as Request).url === "string") {
      raw = (input as Request).url;
    } else {
      raw = String(input);
    }

    try {
      return new URL(raw, window.location.href).href;
    } catch {
      return raw;
    }
  }

  private hookFetch(): void {
    if (typeof window.fetch !== "function") return;
    this.originalFetch = window.fetch.bind(window);
    const self = this;
    const orig = this.originalFetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const urlStr = self.resolveUrl(input);

      // Fast synchronous check
      if (self.isUrlBlockedSync(urlStr)) {
        return new Response(null, { status: 204, statusText: "No Content" });
      }

      // Asynchronous Shield Engine check
      const blockResult = await self.checkUrl(urlStr, window.location.href, "xmlhttprequest");
      if (blockResult.matched) {
        if (blockResult.redirect_url) {
          return orig(blockResult.redirect_url, init);
        }
        return new Response(null, { status: 204, statusText: "No Content" });
      }

      return orig(input, init);
    };
  }

  private hookXHR(): void {
    if (typeof XMLHttpRequest === "undefined") return;

    this.originalXhrOpen = XMLHttpRequest.prototype.open;
    this.originalXhrSend = XMLHttpRequest.prototype.send;

    const self = this;
    const origOpen = this.originalXhrOpen;
    const origSend = this.originalXhrSend;

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { __avalaunch_url?: string; __avalaunch_blocked?: boolean },
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      const urlStr = self.resolveUrl(url);
      this.__avalaunch_url = urlStr;

      if (self.isUrlBlockedSync(urlStr)) {
        this.__avalaunch_blocked = true;
        return (origOpen as any).apply(this, [method, "data:text/plain;charset=utf-8,", ...rest]);
      }

      // Check asynchronously in background to prime cache
      self.checkUrl(urlStr, window.location.href, "xmlhttprequest").catch(() => {});

      return (origOpen as any).apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & { __avalaunch_url?: string; __avalaunch_blocked?: boolean },
      body?: any
    ) {
      if (this.__avalaunch_blocked || (this.__avalaunch_url && self.isUrlBlockedSync(this.__avalaunch_url))) {
        // Fast abort / simulate immediate empty response
        try {
          Object.defineProperty(this, "status", { value: 204, writable: true });
          Object.defineProperty(this, "statusText", { value: "No Content", writable: true });
          Object.defineProperty(this, "responseText", { value: "", writable: true });
          Object.defineProperty(this, "response", { value: "", writable: true });
          Object.defineProperty(this, "readyState", { value: 4, writable: true });
        } catch {}

        setTimeout(() => {
          this.dispatchEvent(new Event("readystatechange"));
          this.dispatchEvent(new Event("load"));
          this.dispatchEvent(new Event("loadend"));
        }, 0);
        return;
      }

      return origSend.call(this, body);
    };
  }

  private hookSendBeacon(): void {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;

    this.originalSendBeacon = navigator.sendBeacon.bind(navigator);
    const self = this;
    const orig = this.originalSendBeacon;

    navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null): boolean {
      const urlStr = self.resolveUrl(url);
      if (self.isUrlBlockedSync(urlStr)) {
        return true; // Pretend it succeeded
      }

      self.checkUrl(urlStr, window.location.href, "ping").catch(() => {});
      return orig(url, data);
    };
  }

  private hookDOMCreation(): void {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return;

    this.originalCreateElement = document.createElement.bind(document);
    const self = this;
    const orig = this.originalCreateElement;

    document.createElement = function <K extends keyof HTMLElementTagNameMap>(
      tagName: K,
      options?: ElementCreationOptions
    ): HTMLElementTagNameMap[K] {
      const el = orig(tagName, options);
      const tagLower = String(tagName).toLowerCase();

      if (tagLower === "script" || tagLower === "iframe" || tagLower === "img") {
        self.interceptSrcProperty(el, tagLower);
      }

      return el;
    };
  }

  public interceptSrcProperty(el: HTMLElement, tagLower: string): void {
    let currentSrc = "";
    const self = this;

    const descriptor = Object.getOwnPropertyDescriptor(
      tagLower === "script"
        ? HTMLScriptElement.prototype
        : tagLower === "iframe"
        ? HTMLIFrameElement.prototype
        : HTMLImageElement.prototype,
      "src"
    );

    Object.defineProperty(el, "src", {
      configurable: true,
      enumerable: true,
      get() {
        if (descriptor && descriptor.get) {
          return descriptor.get.call(this);
        }
        return currentSrc;
      },
      set(val: string) {
        const resolved = self.resolveUrl(val);

        if (self.isUrlBlockedSync(resolved)) {
          el.setAttribute("data-shield-blocked", "true");
          if (tagLower === "script") {
            currentSrc = BLOCKED_SCRIPT_EMPTY;
            if (descriptor && descriptor.set) {
              descriptor.set.call(this, BLOCKED_SCRIPT_EMPTY);
            }
            return;
          }
          if (tagLower === "iframe") {
            currentSrc = BLOCKED_FRAME_EMPTY;
            el.style.display = "none";
            if (descriptor && descriptor.set) {
              descriptor.set.call(this, BLOCKED_FRAME_EMPTY);
            }
            return;
          }
          if (tagLower === "img") {
            currentSrc = BLOCKED_IMAGE_1X1;
            el.style.display = "none";
            if (descriptor && descriptor.set) {
              descriptor.set.call(this, BLOCKED_IMAGE_1X1);
            }
            return;
          }
        }

        currentSrc = val;
        if (descriptor && descriptor.set) {
          descriptor.set.call(this, val);
        } else {
          el.setAttribute("src", val);
        }

        // Asynchronously check against Shield Engine to learn new rules
        self.checkUrl(resolved, window.location.href, tagLower).then((res) => {
          if (res.matched) {
            el.setAttribute("data-shield-blocked", "true");
            el.style.display = "none";
            if (tagLower === "script" && el.parentNode) {
              el.parentNode.removeChild(el);
            }
          }
        });
      },
    });
  }

  private hookWindowOpen(): void {
    if (typeof window.open !== "function") return;

    this.originalWindowOpen = window.open.bind(window);
    const self = this;
    const orig = this.originalWindowOpen;

    window.open = function (url?: string | URL, target?: string, features?: string): WindowProxy | null {
      if (url) {
        const urlStr = self.resolveUrl(url);
        if (self.isUrlBlockedSync(urlStr)) {
          console.debug(`[Shield] Blocked popup window.open: ${urlStr}`);
          return null;
        }
      }
      return orig(url, target, features);
    };
  }

  public isInitialized(): boolean {
    return this.initialized;
  }
}
