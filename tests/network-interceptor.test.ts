/**
 * Unit Tests for Avalaunch Network Interceptor
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NetworkInterceptor } from "../src/network-interceptor.ts";

describe("NetworkInterceptor", () => {
  let interceptor: NetworkInterceptor;
  let originalFetch: typeof globalThis.fetch;
  let originalWindow: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWindow = (globalThis as any).window;

    (globalThis as any).window = {
      location: { href: "https://music.youtube.com/" },
      fetch: async (url: string) => {
        return new Response("legitimate response", { status: 200 });
      },
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === "check_url") {
            const url = (args?.url as string) || "";
            const isBlocked = url.includes("tracker.custom.com") || url.includes("doubleclick.net");
            return {
              matched: isBlocked,
              filter: isBlocked ? "||blocked^" : null,
              redirect_url: null,
            };
          }
          return null;
        },
      },
    };

    interceptor = new NetworkInterceptor();
  });

  afterEach(() => {
    interceptor.destroy();
    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;
  });

  test("isUrlBlockedSync identifies standard ad domains", () => {
    assert.strictEqual(
      interceptor.isUrlBlockedSync("https://googleads.g.doubleclick.net/pagead/ads"),
      true
    );
    assert.strictEqual(
      interceptor.isUrlBlockedSync("https://adservice.google.com/ads.js"),
      true
    );
    assert.strictEqual(
      interceptor.isUrlBlockedSync("https://www.google-analytics.com/analytics.js"),
      true
    );
    assert.strictEqual(
      interceptor.isUrlBlockedSync("https://music.youtube.com/youtubei/v1/browse"),
      false
    );
  });

  test("checkUrl queries IPC and caches decision", async () => {
    const res = await interceptor.checkUrl("https://tracker.custom.com/track");
    assert.strictEqual(res.matched, true);

    // Subsequent sync check should now return true from cache
    assert.strictEqual(interceptor.isUrlBlockedSync("https://tracker.custom.com/track"), true);

    // Legitimate URL
    const resAllowed = await interceptor.checkUrl("https://music.youtube.com/api/player");
    assert.strictEqual(resAllowed.matched, false);
    assert.strictEqual(interceptor.isUrlBlockedSync("https://music.youtube.com/api/player"), false);
  });

  test("fetch monkey-patch blocks ad requests with 204 No Content", async () => {
    interceptor.init();

    // Blocked fetch request
    const blockedRes = await (globalThis as any).window.fetch("https://googleads.g.doubleclick.net/pagead/ads");
    assert.strictEqual(blockedRes.status, 204);
    assert.strictEqual(blockedRes.statusText, "No Content");

    // Allowed fetch request
    const allowedRes = await (globalThis as any).window.fetch("https://music.youtube.com/youtubei/v1/browse");
    assert.strictEqual(allowedRes.status, 200);
    const body = await allowedRes.text();
    assert.strictEqual(body, "legitimate response");
  });

  test("addBlockedPattern registers new synchronous blocking rules", () => {
    assert.strictEqual(interceptor.isUrlBlockedSync("https://custom-telemetry.io/v1/ping"), false);
    interceptor.addBlockedPattern("custom-telemetry.io");
    assert.strictEqual(interceptor.isUrlBlockedSync("https://custom-telemetry.io/v1/ping"), true);
  });
});
