/**
 * Avalaunch Frontend Runtime Initialization
 * Coordinates cosmetic filtering injection and frontend runtime setup.
 * Injected as initialization_script or bundled as webview shell entry.
 */

import { CosmeticInjector } from "./cosmetic-injector.ts";

export { CosmeticInjector, initCosmeticInjector, STYLE_ELEMENT_ID, invokeIPC } from "./cosmetic-injector.ts";
export type * from "./types";

let defaultInjector: CosmeticInjector | null = null;

/**
 * Initializes frontend ad-blocking and cosmetic filtering runtime.
 */
export function initFrontend(): CosmeticInjector {
  if (defaultInjector) {
    return defaultInjector;
  }

  const injector = new CosmeticInjector();
  defaultInjector = injector;

  if (typeof window !== "undefined") {
    window.__AVALAUNCH_INJECTOR__ = injector;
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
