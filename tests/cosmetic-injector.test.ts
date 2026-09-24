/**
 * Unit Tests for Avalaunch Cosmetic Injector & Main Entry
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CosmeticInjector, STYLE_ELEMENT_ID, initCosmeticInjector } from "../src/cosmetic-injector.ts";
import { initFrontend } from "../src/main.ts";
import type { CosmeticResources } from "../src/types";

// Mock DOM elements and environment
class MockElement {
  public tagName: string;
  public id: string = "";
  public className: string = "";
  public classList: {
    item: (i: number) => string | null;
    length: number;
    add: (...tokens: string[]) => void;
  };
  public textContent: string = "";
  public children: MockElement[] = [];
  public parentNode: MockElement | null = null;
  public nodeType: number = 1;
  public isConnected: boolean = true;
  private classes: string[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    const self = this;
    this.classList = {
      item(i: number) {
        return self.classes[i] ?? null;
      },
      get length() {
        return self.classes.length;
      },
      add(...tokens: string[]) {
        for (const t of tokens) {
          if (!self.classes.includes(t)) {
            self.classes.push(t);
          }
        }
        self.className = self.classes.join(" ");
      },
    };
  }

  public appendChild(child: MockElement | MockTextNode): MockElement | MockTextNode {
    if ("text" in child) {
      this.textContent += child.text;
    } else {
      this.children.push(child);
      child.parentNode = this;
      child.isConnected = true;
    }
    return child;
  }

  public removeChild(child: MockElement): MockElement {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
      child.isConnected = false;
    }
    return child;
  }

  public querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const search = (el: MockElement) => {
      for (const child of el.children) {
        if (selector.includes("[class]") && child.className) {
          results.push(child);
        } else if (selector.includes("[id]") && child.id) {
          results.push(child);
        }
        search(child);
      }
    };
    search(this);
    return results;
  }
}

class MockTextNode {
  public text: string;
  constructor(text: string) {
    this.text = text;
  }
}

class MockMutationObserver {
  public callback: (mutations: any[]) => void;
  public target: any = null;
  public options: any = null;
  public static instances: MockMutationObserver[] = [];

  constructor(callback: (mutations: any[]) => void) {
    this.callback = callback;
    MockMutationObserver.instances.push(this);
  }

  public observe(target: any, options: any): void {
    this.target = target;
    this.options = options;
  }

  public disconnect(): void {
    const idx = MockMutationObserver.instances.indexOf(this);
    if (idx !== -1) {
      MockMutationObserver.instances.splice(idx, 1);
    }
  }

  public trigger(mutations: any[]): void {
    this.callback(mutations);
  }
}

describe("CosmeticInjector", () => {
  let head: MockElement;
  let body: MockElement;
  let documentElement: MockElement;
  let ipcCalls: Array<{ cmd: string; args?: Record<string, unknown> }>;
  let rafCallbacks: Array<() => void>;
  let eventListeners: Record<string, Array<() => void>>;

  beforeEach(() => {
    ipcCalls = [];
    rafCallbacks = [];
    eventListeners = {};
    MockMutationObserver.instances = [];

    head = new MockElement("head");
    body = new MockElement("body");
    documentElement = new MockElement("html");
    documentElement.appendChild(head);
    documentElement.appendChild(body);

    const mockDocument = {
      head,
      body,
      documentElement,
      readyState: "complete",
      getElementById(id: string) {
        if (id === STYLE_ELEMENT_ID) {
          const findStyle = (el: MockElement): MockElement | null => {
            if (el.id === id) return el;
            for (const child of el.children) {
              const res = findStyle(child);
              if (res) return res;
            }
            return null;
          };
          return findStyle(documentElement);
        }
        return null;
      },
      createElement(tag: string) {
        return new MockElement(tag);
      },
      createTextNode(text: string) {
        return new MockTextNode(text);
      },
      addEventListener(event: string, handler: () => void) {
        if (!eventListeners[event]) {
          eventListeners[event] = [];
        }
        eventListeners[event].push(handler);
      },
      removeEventListener(event: string, handler: () => void) {
        if (eventListeners[event]) {
          eventListeners[event] = eventListeners[event].filter((h) => h !== handler);
        }
      },
    };

    (globalThis as any).document = mockDocument;
    (globalThis as any).MutationObserver = MockMutationObserver;
    (globalThis as any).requestAnimationFrame = (cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    (globalThis as any).cancelAnimationFrame = (id: number) => {
      if (rafCallbacks[id - 1]) {
        delete rafCallbacks[id - 1];
      }
    };
    (globalThis as any).window = {
      location: { href: "https://music.youtube.com/" },
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            ipcCalls.push({ cmd, args });
            if (cmd === "get_cosmetic_resources") {
              return {
                hide_selectors: [".ad-banner", "#promo-player"],
                injected_script: "window.__TEST_SCRIPTLET_RAN__ = true;",
                generics: true,
              } satisfies CosmeticResources;
            }
            if (cmd === "get_hidden_selectors") {
              const classes = (args?.classes as string[]) || [];
              const ids = (args?.ids as string[]) || [];
              const matched: string[] = [];
              if (classes.includes("sponsor-box")) matched.push(".sponsor-box");
              if (ids.includes("ad-frame")) matched.push("#ad-frame");
              if (classes.includes("badge-promo")) matched.push(".badge-promo");
              return matched;
            }
            return null;
          },
        },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).window?.__TEST_SCRIPTLET_RAN__;
    delete (globalThis as any).__TEST_SCRIPTLET_RAN__;
  });

  test("initializes, calls IPC get_cosmetic_resources and injects static selectors", async () => {
    const injector = new CosmeticInjector();
    await injector.init();

    assert.strictEqual(ipcCalls.length, 1);
    assert.strictEqual(ipcCalls[0].cmd, "get_cosmetic_resources");
    assert.strictEqual((ipcCalls[0].args as any)?.pageUrl, "https://music.youtube.com/");

    // Check style element
    const styleEl = (globalThis as any).document.getElementById(STYLE_ELEMENT_ID);
    assert.ok(styleEl, "Style element should be created");
    assert.ok(styleEl.textContent.includes(".ad-banner { display: none !important; }"));
    assert.ok(styleEl.textContent.includes("#promo-player { display: none !important; }"));

    // Check scriptlet execution
    assert.strictEqual((globalThis as any).window.__TEST_SCRIPTLET_RAN__, true);

    // Check generic observer setup
    assert.strictEqual(MockMutationObserver.instances.length, 1);
    assert.strictEqual(injector.isGenericsEnabled(), true);
    assert.strictEqual(injector.isInitialized(), true);
  });

  test("MutationObserver dynamic element hiding batches classes and IDs via requestAnimationFrame", async () => {
    const injector = new CosmeticInjector();
    await injector.init();

    assert.strictEqual(MockMutationObserver.instances.length, 1);
    const observer = MockMutationObserver.instances[0];

    // Create dynamic nodes
    const adNode = new MockElement("div");
    adNode.classList.add("sponsor-box");
    adNode.id = "ad-frame";

    const childNode = new MockElement("span");
    childNode.classList.add("inner-sponsor");
    adNode.appendChild(childNode);

    // Trigger mutation
    observer.trigger([
      {
        type: "childList",
        addedNodes: [adNode],
      },
    ]);

    // Should schedule a rAF callback without immediately calling IPC
    assert.strictEqual(ipcCalls.length, 1, "IPC should not be called synchronously before rAF");
    assert.strictEqual(rafCallbacks.length, 1);

    // Flush the rAF batch
    const cb = rafCallbacks[0];
    cb();
    // Allow promises to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now IPC should have been called for get_hidden_selectors
    assert.strictEqual(ipcCalls.length, 2);
    assert.strictEqual(ipcCalls[1].cmd, "get_hidden_selectors");
    const sentClasses = (ipcCalls[1].args as any).classes;
    const sentIds = (ipcCalls[1].args as any).ids;
    assert.ok(sentClasses.includes("sponsor-box"));
    assert.ok(sentClasses.includes("inner-sponsor"));
    assert.ok(sentIds.includes("ad-frame"));

    // Check that matching selectors were injected
    const styleEl = (globalThis as any).document.getElementById(STYLE_ELEMENT_ID);
    assert.ok(styleEl.textContent.includes(".sponsor-box { display: none !important; }"));
    assert.ok(styleEl.textContent.includes("#ad-frame { display: none !important; }"));
  });

  test("attribute mutations extract updated class and ID attributes", async () => {
    const injector = new CosmeticInjector();
    await injector.init();

    const observer = MockMutationObserver.instances[0];

    const mutatingElement = new MockElement("div");
    mutatingElement.classList.add("badge-promo");

    // Trigger attribute mutation
    observer.trigger([
      {
        type: "attributes",
        target: mutatingElement,
        attributeName: "class",
      },
    ]);

    assert.strictEqual(rafCallbacks.length, 1);
    rafCallbacks[0]();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(ipcCalls.length, 2);
    assert.strictEqual(ipcCalls[1].cmd, "get_hidden_selectors");
    const sentClasses = (ipcCalls[1].args as any).classes;
    assert.ok(sentClasses.includes("badge-promo"));

    const styleEl = (globalThis as any).document.getElementById(STYLE_ELEMENT_ID);
    assert.ok(styleEl.textContent.includes(".badge-promo { display: none !important; }"));
  });

  test("caching prevents duplicate IPC calls for already seen classes and IDs", async () => {
    const injector = new CosmeticInjector();
    await injector.init();

    const observer = MockMutationObserver.instances[0];

    // Trigger first mutation
    const el1 = new MockElement("div");
    el1.classList.add("sponsor-box");
    observer.trigger([{ type: "childList", addedNodes: [el1] }]);

    // Flush batch
    rafCallbacks[rafCallbacks.length - 1]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(ipcCalls.length, 2);

    // Trigger second mutation with the SAME class
    const el2 = new MockElement("div");
    el2.classList.add("sponsor-box");
    observer.trigger([{ type: "childList", addedNodes: [el2] }]);

    // No new pending classes, so no new rAF scheduled
    assert.strictEqual(ipcCalls.length, 2, "Duplicate classes should not trigger IPC");
  });

  test("helper initCosmeticInjector creates and initializes instance", async () => {
    const injector = initCosmeticInjector();
    assert.ok(injector instanceof CosmeticInjector);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.strictEqual(injector.isInitialized(), true);
  });

  test("initFrontend initializes cosmetic filtering and registers on window", async () => {
    const frontendInjector = initFrontend();
    assert.ok(frontendInjector instanceof CosmeticInjector);
    assert.strictEqual((globalThis as any).window.__AVALAUNCH_INJECTOR__, frontendInjector);
  });

  test("destroy cleanly disconnects observer and cleans up", async () => {
    const injector = new CosmeticInjector();
    await injector.init();

    assert.strictEqual(MockMutationObserver.instances.length, 1);
    injector.destroy();

    assert.strictEqual(MockMutationObserver.instances.length, 0);
    assert.strictEqual(injector.isInitialized(), false);
    const styleEl = (globalThis as any).document.getElementById(STYLE_ELEMENT_ID);
    assert.strictEqual(styleEl, null);
  });
});
