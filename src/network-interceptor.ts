/**
 * Avalaunch Network Interceptor
 * Intercepts and blocks ad & tracker network requests in the webview context:
 * - window.fetch
 * - window.XMLHttpRequest
 * - navigator.sendBeacon
 * - DOM element creation (script, iframe, img src properties)
 * - YouTube player ad-placement stripping & video ad skipping
 * - window.open popups
 */

import type { BlockResult } from "./types";
import { invokeIPC } from "./cosmetic-injector.ts";

/**
 * Common ad and tracking URL patterns for instantaneous synchronous matching.
 */
const KNOWN_BLOCKED_HOST_PATTERNS = [
  "doubleclick.net",
  "googleads.g.doubleclick.net",
  "adservice.google.com",
  "google-analytics.com",
  "googlesyndication.com",
  "pagead2.googlesyndication.com",
  "ad.doubleclick.net",
  "static.doubleclick.net",
  "adnxs.com",
  "criteo.com",
  "amazon-adsystem.com",
  "taboola.com",
  "outbrain.com",
  "scorecardresearch.com",
  "/api/stats/ads",
  "/pagead/",
];

/**
 * Known legitimate media & API host patterns that must NEVER be blocked or delayed.
 */
const KNOWN_ALLOWED_HOST_PATTERNS = [
  "googlevideo.com",
  "music.youtube.com/youtubei/v1/",
  "www.youtube.com/youtubei/v1/",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "ytimg.com",
  "googleusercontent.com",
  "play.google.com/music",
];

const BLOCKED_IMAGE_1X1 = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const BLOCKED_SCRIPT_EMPTY = "data:text/javascript;charset=utf-8,/* blocked by avalaunch */";
const BLOCKED_FRAME_EMPTY = "about:blank";

/**
 * Strips ad placements, video ads, and ad slots from YouTube player JSON responses.
 */
export function cleanYouTubePlayerResponse(data: any): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  let modified = false;

  if ("adPlacements" in data) {
    delete data.adPlacements;
    modified = true;
  }
  if ("playerAds" in data) {
    delete data.playerAds;
    modified = true;
  }
  if ("adSlots" in data) {
    delete data.adSlots;
    modified = true;
  }
  if ("adBreakHeartbeatParams" in data) {
    delete data.adBreakHeartbeatParams;
    modified = true;
  }

  if (data.playbackTracking && typeof data.playbackTracking === "object") {
    const pt = data.playbackTracking;
    if (pt.videostatsPlaybackUrl && pt.videostatsPlaybackUrl.baseUrl && pt.videostatsPlaybackUrl.baseUrl.includes("adformat=")) {
      delete pt.videostatsPlaybackUrl;
      modified = true;
    }
    if (pt.ptrackingUrl) {
      delete pt.ptrackingUrl;
      modified = true;
    }
  }

  return modified;
}

export class NetworkInterceptor {
  private originalFetch: typeof window.fetch | null = null;
  private originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  private originalSendBeacon: typeof navigator.sendBeacon | null = null;
  private originalWindowOpen: typeof window.open | null = null;
  private adSkipperInterval: number | null = null;

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

    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:") || url.startsWith("mediasource:")) {
      return false;
    }

    for (const allowed of KNOWN_ALLOWED_HOST_PATTERNS) {
      if (url.includes(allowed)) {
        return false;
      }
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
   * Check whether a URL is explicitly allowed for playback / media.
   */
  public isUrlAllowedSync(url: string): boolean {
    if (!url || typeof url !== "string") {
      return true;
    }

    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:") || url.startsWith("mediasource:")) {
      return true;
    }

    for (const allowed of KNOWN_ALLOWED_HOST_PATTERNS) {
      if (url.includes(allowed)) {
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

    if (this.isUrlAllowedSync(url)) {
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
    this.hookDOMPrototypes();
    this.hookWindowOpen();
    this.startAdSkipper();
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

    if (this.originalWindowOpen) {
      window.open = this.originalWindowOpen;
      this.originalWindowOpen = null;
    }

    if (this.adSkipperInterval !== null) {
      clearInterval(this.adSkipperInterval);
      this.adSkipperInterval = null;
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

      // Fast check: Blocked ad URL
      if (self.isUrlBlockedSync(urlStr)) {
        return new Response(null, { status: 204, statusText: "No Content" });
      }

      // Fast check: Allowed media / stream / API URL
      if (self.isUrlAllowedSync(urlStr)) {
        const res = init ? await orig(input, init) : await orig(input);

        // Intercept YouTube player responses to strip ads
        if (urlStr.includes("/youtubei/v1/player")) {
          try {
            const clone = res.clone();
            const data = await clone.json();
            if (cleanYouTubePlayerResponse(data)) {
              return new Response(JSON.stringify(data), {
                status: res.status,
                statusText: res.statusText,
                headers: res.headers,
              });
            }
          } catch {}
        }

        return res;
      }

      // Asynchronous Shield Engine check for other domains
      const blockResult = await self.checkUrl(urlStr, window.location.href, "xmlhttprequest");
      if (blockResult.matched) {
        if (blockResult.redirect_url) {
          return init ? orig(blockResult.redirect_url, init) : orig(blockResult.redirect_url);
        }
        return new Response(null, { status: 204, statusText: "No Content" });
      }

      const finalRes = init ? await orig(input, init) : await orig(input);

      if (urlStr.includes("/youtubei/v1/player")) {
        try {
          const clone = finalRes.clone();
          const data = await clone.json();
          if (cleanYouTubePlayerResponse(data)) {
            return new Response(JSON.stringify(data), {
              status: finalRes.status,
              statusText: finalRes.statusText,
              headers: finalRes.headers,
            });
          }
        } catch {}
      }

      return finalRes;
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
      this: XMLHttpRequest & {
        __avalaunch_url?: string;
        __avalaunch_blocked?: boolean;
        __avalaunch_clean_player?: boolean;
      },
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

      if (urlStr.includes("/youtubei/v1/player")) {
        this.__avalaunch_clean_player = true;
      }

      return (origOpen as any).apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & {
        __avalaunch_url?: string;
        __avalaunch_blocked?: boolean;
        __avalaunch_clean_player?: boolean;
        __avalaunch_cleaned_text?: string;
      },
      body?: any
    ) {
      if (this.__avalaunch_blocked || (this.__avalaunch_url && self.isUrlBlockedSync(this.__avalaunch_url))) {
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

      if (this.__avalaunch_clean_player) {
        this.addEventListener("load", function () {
          try {
            if (this.responseText) {
              const data = JSON.parse(this.responseText);
              if (cleanYouTubePlayerResponse(data)) {
                const cleaned = JSON.stringify(data);
                Object.defineProperty(this, "responseText", { value: cleaned, configurable: true });
                Object.defineProperty(this, "response", { value: cleaned, configurable: true });
              }
            }
          } catch {}
        });
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

      return orig(url, data);
    };
  }

  /**
   * Hooks prototype setters on HTMLScriptElement, HTMLIFrameElement, and HTMLImageElement
   * without polluting element instances or breaking standard DOM reflection.
   */
  private hookDOMPrototypes(): void {
    if (typeof window === "undefined") return;
    const self = this;

    const hookPrototypeSrc = (proto: any, tag: string) => {
      if (!proto) return;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "src");
      if (!descriptor || !descriptor.set || !descriptor.get) return;

      const origSet = descriptor.set;
      const origGet = descriptor.get;

      Object.defineProperty(proto, "src", {
        configurable: true,
        enumerable: true,
        get() {
          return origGet.call(this);
        },
        set(val: string) {
          const resolved = self.resolveUrl(val);
          if (self.isUrlBlockedSync(resolved)) {
            this.setAttribute("data-shield-blocked", "true");
            if (tag === "script") {
              return origSet.call(this, BLOCKED_SCRIPT_EMPTY);
            }
            if (tag === "iframe") {
              this.style.display = "none";
              return origSet.call(this, BLOCKED_FRAME_EMPTY);
            }
            if (tag === "img") {
              this.style.display = "none";
              return origSet.call(this, BLOCKED_IMAGE_1X1);
            }
          }
          return origSet.call(this, val);
        },
      });
    };

    if (typeof HTMLScriptElement !== "undefined") {
      hookPrototypeSrc(HTMLScriptElement.prototype, "script");
    }
    if (typeof HTMLIFrameElement !== "undefined") {
      hookPrototypeSrc(HTMLIFrameElement.prototype, "iframe");
    }
    if (typeof HTMLImageElement !== "undefined") {
      hookPrototypeSrc(HTMLImageElement.prototype, "img");
    }
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
          return null;
        }
      }
      return orig(url, target, features);
    };
  }

  /**
   * Background monitor that fast-forwards and auto-skips any video ads
   * and auto-dismisses promo dialogs on YouTube Music.
   */
  private startAdSkipper(): void {
    if (typeof window === "undefined") return;

    const skipAds = () => {
      // 1. Check for ad-showing player state
      const player = document.querySelector(".html5-video-player, #movie_player");
      const video = document.querySelector("video") as HTMLVideoElement | null;

      if (player && video) {
        const isAdShowing = player.classList.contains("ad-showing") ||
                            player.classList.contains("ad-interrupting") ||
                            document.querySelector(".ytp-ad-player-overlay, .ytp-ad-module") !== null;

        if (isAdShowing) {
          // Fast-forward video ad to end
          if (!isNaN(video.duration) && video.duration > 0 && isFinite(video.duration)) {
            video.currentTime = video.duration;
          }

          // Try clicking skip button
          const skipBtn = document.querySelector<HTMLElement>(
            ".ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button, .ytp-ad-overlay-close-button"
          );
          if (skipBtn) {
            skipBtn.click();
          }
        }
      }

      // 2. Auto-dismiss "Still listening?" prompt and upsell dialogs
      const dismissBtn = document.querySelector<HTMLElement>(
        "ytmusic-you-there-renderer #button, ytmusic-mealbar-promo-renderer #dismiss-button, ytmusic-upsell-dialog-renderer #dismiss-button"
      );
      if (dismissBtn) {
        dismissBtn.click();
      }
    };

    const timer = setInterval(skipAds, 250);
    if (typeof (timer as any)?.unref === "function") {
      (timer as any).unref();
    }
    this.adSkipperInterval = timer as unknown as number;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }
}
