import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NetworkInterceptor } from "../src/network-interceptor.ts";

describe("YouTube Music Ad-Defusing and Playback Interceptor", () => {
  let interceptor: NetworkInterceptor;
  let originalFetch: typeof globalThis.fetch;
  let originalWindow: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWindow = (globalThis as any).window;

    (globalThis as any).window = {
      location: { href: "https://music.youtube.com/" },
      fetch: async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.includes("/youtubei/v1/player")) {
          // Simulate YouTube player response containing ad placements
          return new Response(JSON.stringify({
            playabilityStatus: { status: "OK" },
            streamingData: {
              adaptiveFormats: [{ itag: 140, url: "https://rr1.googlevideo.com/videoplayback?itag=140" }]
            },
            adPlacements: [{ adPlacementRenderer: { config: {} } }],
            playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
            adSlots: [{ slotId: "ad-slot-1" }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("googlevideo.com")) {
          return new Response("audio-stream-chunk-data", { status: 200 });
        }
        if (url.includes("googleads.g.doubleclick.net")) {
          return new Response("ad-code", { status: 200 });
        }
        return new Response("ok", { status: 200 });
      },
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === "check_url") {
            const url = (args?.url as string) || "";
            const isBlocked = url.includes("doubleclick.net") || url.includes("googleads");
            return { matched: isBlocked, filter: isBlocked ? "blocked" : null, redirect_url: null };
          }
          return null;
        }
      }
    };

    interceptor = new NetworkInterceptor();
  });

  afterEach(() => {
    interceptor.destroy();
    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;
  });

  test("intercepts /youtubei/v1/player and strips adPlacements and playerAds", async () => {
    interceptor.init();

    const res = await (globalThis as any).window.fetch("https://music.youtube.com/youtubei/v1/player");
    const data = await res.json();

    assert.strictEqual(data.playabilityStatus.status, "OK");
    assert.ok(data.streamingData.adaptiveFormats.length > 0);
    // Crucial: Ads MUST be stripped from player response
    assert.strictEqual(data.adPlacements, undefined);
    assert.strictEqual(data.playerAds, undefined);
    assert.strictEqual(data.adSlots, undefined);
  });

  test("allows googlevideo.com audio stream requests instantly without blocking", async () => {
    interceptor.init();

    const streamUrl = "https://rr1---sn-4g5edn6e.googlevideo.com/videoplayback?expire=123&itag=140";
    const res = await (globalThis as any).window.fetch(streamUrl);

    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.strictEqual(body, "audio-stream-chunk-data");
  });

  test("blocks doubleclick ad requests with 204", async () => {
    interceptor.init();

    const adUrl = "https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-123";
    const res = await (globalThis as any).window.fetch(adUrl);

    assert.strictEqual(res.status, 204);
  });
});
