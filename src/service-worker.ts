/**
 * Avalaunch Service Worker Interceptor
 * Service worker fetch interception fallback for background request blocking.
 */

import { NetworkInterceptor } from "./network-interceptor.ts";

let swInterceptor: NetworkInterceptor | null = null;

export function initServiceWorker(): NetworkInterceptor {
  if (swInterceptor) {
    return swInterceptor;
  }

  swInterceptor = new NetworkInterceptor();
  swInterceptor.init();

  // If running inside Service Worker context
  if (typeof self !== "undefined" && "addEventListener" in self && !("window" in self)) {
    (self as any).addEventListener("fetch", (event: any) => {
      const url = event.request?.url;
      if (url && swInterceptor?.isUrlBlockedSync(url)) {
        event.respondWith(new Response(null, { status: 204, statusText: "No Content" }));
      }
    });
  }

  return swInterceptor;
}
