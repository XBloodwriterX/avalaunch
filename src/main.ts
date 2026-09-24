/**
 * Avalaunch Frontend Runtime Initialization
 * Coordinates network request interception and cosmetic filtering injection.
 * Injected as initialization_script or bundled as webview shell entry.
 */

import { CosmeticInjector } from "./cosmetic-injector.ts";
import { NetworkInterceptor } from "./network-interceptor.ts";

export { CosmeticInjector, initCosmeticInjector, STYLE_ELEMENT_ID, invokeIPC } from "./cosmetic-injector.ts";
export { NetworkInterceptor } from "./network-interceptor.ts";
export { initServiceWorker } from "./service-worker.ts";
export type * from "./types";

let defaultInjector: CosmeticInjector | null = null;
let defaultNetworkInterceptor: NetworkInterceptor | null = null;

/**
 * Initializes frontend ad-blocking and cosmetic filtering runtime.
 */
export function initFrontend(): CosmeticInjector {
  if (defaultInjector) {
    return defaultInjector;
  }

  // 1. Initialize Network Interceptor immediately before any scripts run
  if (!defaultNetworkInterceptor) {
    defaultNetworkInterceptor = new NetworkInterceptor();
    defaultNetworkInterceptor.init();
  }

  // 2. Initialize Cosmetic Injector
  const injector = new CosmeticInjector();
  defaultInjector = injector;

  if (typeof window !== "undefined") {
    window.__AVALAUNCH_INJECTOR__ = injector;
    (window as any).__AVALAUNCH_NETWORK__ = defaultNetworkInterceptor;
  }

  const startInjector = () => {
    injector.init().catch((err) => {
      console.warn("[Avalaunch] Cosmetic injector initialization error:", err);
    });
  };

  if (typeof document !== "undefined") {
    // Attempt immediate initialization so styles are ready before first paint
    startInjector();

    // Ensure style attachment and fallback when DOM becomes ready
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          injector.ensureStyleElement();
        },
        { once: true }
      );
    }
  }

  return injector;
}

// Auto-run when executed in browser / webview context
if (typeof window !== "undefined") {
  initFrontend();
}
