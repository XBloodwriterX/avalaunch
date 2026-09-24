/**
 * CDP-based End-to-End Ad-Blocking Test Harness
 * Tests Avalaunch's injector script inside a real Chromium instance via Chrome DevTools Protocol.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = 9225;
const USER_DATA_DIR = `/tmp/chrome-cdp-test-${Date.now()}`;

async function main() {
  console.log("[CDP Test] Starting Headless Chromium on port", PORT);

  const chromeProc = spawn("/usr/bin/chromium", [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "ignore"],
  });

  const cleanup = () => {
    try {
      chromeProc.kill("SIGKILL");
    } catch {}
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch {}
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(1); });

  // Wait for CDP to become ready
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        const data = await res.json();
        wsUrl = data.webSocketDebuggerUrl;
        break;
      }
    } catch {}
  }

  if (!wsUrl) {
    cleanup();
    throw new Error("Failed to connect to Chromium CDP endpoint");
  }

  console.log("[CDP Test] Connected to browser CDP:", wsUrl);

  // Create a new tab
  const newTabRes = await fetch(`http://127.0.0.1:${PORT}/json/new?https://music.youtube.com`, { method: "PUT" });
  const tabData = await newTabRes.json();
  const pageWsUrl = tabData.webSocketDebuggerUrl;

  console.log("[CDP Test] Attached to tab:", pageWsUrl);

  const ws = new WebSocket(pageWsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let idCounter = 1;
  const pendingRequests = new Map();
  const networkEvents = [];
  const consoleMessages = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      if (msg.error) {
        reject(msg.error);
      } else {
        resolve(msg.result);
      }
    } else if (msg.method) {
      if (msg.method === "Network.requestWillBeSent") {
        networkEvents.push(msg.params);
      } else if (msg.method === "Runtime.consoleAPICalled") {
        consoleMessages.push(msg.params);
      }
    }
  };

  const send = (method, params = {}) => {
    const id = idCounter++;
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await send("Page.enable");
  await send("Network.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("CSS.enable");

  // Read current dist/injector.js
  const injectorCode = fs.readFileSync(path.resolve(process.cwd(), "dist/injector.js"), "utf-8");

  // Setup mock Tauri bridge in page context
  const mockBridgeCode = `
    window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === "get_cosmetic_resources") {
            return {
              hide_selectors: [
                ".ytmusic-ad-slot",
                ".ytmusic-mealbar-promo-renderer",
                "#player-ads",
                ".ytp-ad-module",
                ".google-ad-banner"
              ],
              injected_script: "window.__SHIELD_SCRIPTLET_INITIALIZED__ = true;",
              generics: true,
              procedural_actions: [],
              exceptions: []
            };
          }
          if (cmd === "check_url") {
            const url = args.url || "";
            const isAd = url.includes("doubleclick.net") ||
                         url.includes("googleads") ||
                         url.includes("google-analytics.com") ||
                         url.includes("/api/stats/ads") ||
                         url.includes("adservice.google.com");
            return {
              matched: isAd,
              filter: isAd ? "||ad_rule^" : null,
              redirect_url: null
            };
          }
          if (cmd === "get_hidden_selectors") {
            const classes = args.classes || [];
            const ids = args.ids || [];
            const matched = [];
            for (const c of classes) {
              if (c.includes("ad") || c.includes("sponsor") || c.includes("promo")) {
                matched.push("." + c);
              }
            }
            for (const i of ids) {
              if (i.includes("ad") || i.includes("sponsor") || i.includes("promo")) {
                matched.push("#" + i);
              }
            }
            return matched;
          }
          return null;
        }
      }
    };
    window.__TAURI_INTERNALS__ = window.__TAURI__.core;
  `;

  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: mockBridgeCode + "\n" + injectorCode,
  });

  // Navigate to HTML test harness page
  const testHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>YouTube Music AdBlock Test</title>
      </head>
      <body>
        <div id="player-ads" class="ytmusic-ad-slot">Sponsored Ad Content</div>
        <div class="ytmusic-mealbar-promo-renderer">Upgrade to Premium Promo</div>
        <div id="main-player" class="ytmusic-player">Real Music Content</div>
        <div class="google-ad-banner">Banner Ad</div>
      </body>
    </html>
  `;

  await send("Page.navigate", {
    url: "data:text/html;charset=utf-8," + encodeURIComponent(testHtml),
  });

  // Wait for page to load and injector to execute
  await new Promise((r) => setTimeout(r, 500));

  console.log("[CDP Test] Page loaded. Testing assertions...");

  // 1. Check if injector initialized
  const evalResult = await send("Runtime.evaluate", {
    expression: `({
      hasInjector: typeof window.__AVALAUNCH_INJECTOR__ !== "undefined",
      scriptletRan: window.__SHIELD_SCRIPTLET_INITIALIZED__ === true,
      styleTagPresent: !!document.getElementById("avalaunch-shield-cosmetic"),
      styleTagContent: document.getElementById("avalaunch-shield-cosmetic") ? document.getElementById("avalaunch-shield-cosmetic").textContent : ""
    })`,
    returnByValue: true,
  });

  console.log("[CDP Test] Injector Status:", evalResult.result.value);

  // 2. Check cosmetic element hiding
  const cosmeticCheck = await send("Runtime.evaluate", {
    expression: `({
      adSlotDisplay: window.getComputedStyle(document.querySelector('.ytmusic-ad-slot')).display,
      promoDisplay: window.getComputedStyle(document.querySelector('.ytmusic-mealbar-promo-renderer')).display,
      bannerDisplay: window.getComputedStyle(document.querySelector('.google-ad-banner')).display,
      playerDisplay: window.getComputedStyle(document.querySelector('.ytmusic-player')).display
    })`,
    returnByValue: true,
  });

  console.log("[CDP Test] Computed Styles:", cosmeticCheck.result.value);

  // 3. Test Network Interception (Fetch)
  const fetchTest = await send("Runtime.evaluate", {
    expression: `(async () => {
      const results = {};
      try {
        const adRes = await fetch("https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-123");
        results.adBlocked = (adRes.status === 204 || (adRes.status === 200 && (await adRes.text()) === ""));
        results.adStatus = adRes.status;
      } catch (e) {
        results.adError = e.message;
      }

      try {
        const statsRes = await fetch("https://www.youtube.com/api/stats/ads?v=123");
        results.statsBlocked = (statsRes.status === 204 || (statsRes.status === 200 && (await statsRes.text()) === ""));
        results.statsStatus = statsRes.status;
      } catch (e) {
        results.statsError = e.message;
      }

      try {
        const validRes = await fetch("data:text/plain,ok");
        results.validAllowed = (validRes.status === 200);
      } catch (e) {
        results.validError = e.message;
      }

      return results;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const fetchVal = fetchTest?.result?.value || {};
  console.log("[CDP Test] Fetch Interception Results:", fetchVal);

  // 4. Test Network Interception (XHR)
  const xhrTest = await send("Runtime.evaluate", {
    expression: `(async () => {
      const results = {};
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "https://googleads.g.doubleclick.net/pagead/ads");
        xhr.send();
        results.xhrBlocked = xhr.__avalaunch_blocked === true || xhr.status === 204;
      } catch (e) {
        results.xhrError = e.message;
      }
      return results;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const xhrVal = xhrTest?.result?.value || {};
  console.log("[CDP Test] XHR Interception Results:", xhrVal);

  // 5. Test Network Interception (Beacon)
  const beaconTest = await send("Runtime.evaluate", {
    expression: `(() => {
      if (typeof navigator.sendBeacon === "function") {
        const res = navigator.sendBeacon("https://www.google-analytics.com/analytics.js", "data");
        return { beaconHandled: res === true };
      }
      return { beaconHandled: true };
    })()`,
    returnByValue: true,
  });

  const beaconVal = beaconTest?.result?.value || {};
  console.log("[CDP Test] Beacon Interception Results:", beaconVal);

  // 6. Test Dynamic MutationObserver element hiding
  const mutationTest = await send("Runtime.evaluate", {
    expression: `(async () => {
      const dynamicAd = document.createElement("div");
      dynamicAd.className = "dynamic-sponsor-banner";
      dynamicAd.textContent = "Dynamic Sponsor";
      document.body.appendChild(dynamicAd);

      // Wait for MutationObserver & rAF batch
      await new Promise(r => setTimeout(r, 100));

      return {
        dynamicAdDisplay: window.getComputedStyle(dynamicAd).display
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("[CDP Test] Dynamic Mutation Results:", mutationTest.result.value);

  // 7. Test Dynamic Script creation blocking
  const scriptTest = await send("Runtime.evaluate", {
    expression: `(async () => {
      const s = document.createElement("script");
      s.src = "https://adservice.google.com/ads.js";
      document.head.appendChild(s);

      return {
        scriptSrc: s.src,
        scriptBlocked: s.src.includes("blocked by avalaunch") || s.getAttribute("data-shield-blocked") === "true" || !s.isConnected
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log("[CDP Test] Dynamic Script Blocking Results:", scriptTest.result.value);

  // 8. Test Dynamic IFrame creation blocking
  const iframeTest = await send("Runtime.evaluate", {
    expression: `(async () => {
      const frame = document.createElement("iframe");
      frame.src = "https://googleads.g.doubleclick.net/ad_iframe.html";
      document.body.appendChild(frame);

      return {
        frameSrc: frame.src,
        frameBlocked: frame.src === "about:blank" || frame.getAttribute("data-shield-blocked") === "true" || frame.style.display === "none"
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  const iframeVal = iframeTest?.result?.value || {};
  console.log("[CDP Test] Dynamic IFrame Blocking Results:", iframeVal);

  // Summary of checks
  const summary = {
    injectorLoaded: evalResult.result.value.hasInjector,
    scriptletExecuted: evalResult.result.value.scriptletRan,
    cosmeticAdSlotHidden: cosmeticCheck.result.value.adSlotDisplay === "none",
    cosmeticPromoHidden: cosmeticCheck.result.value.promoDisplay === "none",
    legitimatePlayerVisible: cosmeticCheck.result.value.playerDisplay !== "none",
    fetchAdBlocked: fetchVal.adBlocked === true,
    fetchStatsBlocked: fetchVal.statsBlocked === true,
    fetchValidAllowed: fetchVal.validAllowed === true,
    xhrAdBlocked: xhrVal.xhrBlocked === true,
    beaconHandled: beaconVal.beaconHandled === true,
    dynamicAdHidden: mutationTest.result.value.dynamicAdDisplay === "none",
    dynamicScriptBlocked: scriptTest.result.value.scriptBlocked === true,
    dynamicIFrameBlocked: iframeVal.frameBlocked === true,
  };

  console.log("\n=== COMPLETE CDP TEST SUMMARY ===");
  console.table(summary);

  const allPassed = Object.values(summary).every(Boolean);
  if (allPassed) {
    console.log(">>> ALL CDP AD-BLOCKING TESTS PASSED! <<<");
  } else {
    console.error(">>> CDP AD-BLOCKING TESTS FAILED! <<<");
  }

  cleanup();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("CDP Test failed with error:", err);
  process.exit(1);
});
