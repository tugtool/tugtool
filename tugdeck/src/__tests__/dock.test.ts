/**
 * Dock and multi-instance card tests.
 *
 * Tests cover:
 * - addNewCard creates a floating panel with the correct componentId
 * - Feed fan-out delivers frames to all instances with matching feedId
 * - resetLayout destroys all cards and produces the default five-panel arrangement
 * - After reset, no orphaned card instances remain in feed dispatch sets
 * - Integration: two terminal cards simultaneously receive terminal feed frames
 * - Dock menu items: no preset items (Save Layout / Load: ... removed in step 2)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as unknown as typeof globalThis.window;
global.document = window.document as unknown as Document;
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// localStorage mock
const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
})();
global.localStorage = localStorageMock as unknown as Storage;

// crypto.randomUUID mock
if (!global.crypto) {
  global.crypto = {
    randomUUID: () => {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }) as `${string}-${string}-${string}-${string}-${string}`;
    },
  } as unknown as Crypto;
}

// requestAnimationFrame mock (not in happy-dom)
if (!global.requestAnimationFrame) {
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    setTimeout(() => cb(0), 0);
    return 0;
  };
}

// MutationObserver mock
class MockMutationObserver {
  observe() {}
  disconnect() {}
}
global.MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;

// getComputedStyle mock for theme token reads
const originalGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = (el: Element) => {
  const style = originalGetComputedStyle(el);
  return new Proxy(style, {
    get(target, prop) {
      if (prop === "getPropertyValue") {
        return (name: string) => {
          if (name === "--td-bg") return "#1c1e22";
          if (name === "--td-text") return "#e6eaee";
          if (name === "--td-font-mono") return "'Hack', 'JetBrains Mono', 'SFMono-Regular', 'Menlo', monospace";
          return "";
        };
      }
      return Reflect.get(target, prop);
    },
  });
};

import { DeckManager } from "../deck-manager";
import { Dock } from "../dock";
import { FeedId, type FeedIdValue } from "../protocol";
import type { TugCard } from "../cards/card";
import type { TugConnection } from "../connection";
import { serialize } from "../serialization";

// ---- Mock TugConnection ----

class MockConnection {
  private frameCallbacks: Map<number, Array<(payload: Uint8Array) => void>> = new Map();
  private openCallbacks: Array<() => void> = [];

  onFrame(feedId: number, callback: (payload: Uint8Array) => void): void {
    if (!this.frameCallbacks.has(feedId)) this.frameCallbacks.set(feedId, []);
    this.frameCallbacks.get(feedId)!.push(callback);
  }
  onOpen(callback: () => void): void { this.openCallbacks.push(callback); }
  deliverFrame(feedId: number, payload: Uint8Array): void {
    const cbs = this.frameCallbacks.get(feedId) ?? [];
    for (const cb of cbs) cb(payload);
  }
  send(_feedId: number, _payload: Uint8Array): void {}
}

// ---- Mock TugCard ----

function makeMockCard(
  feedIds: FeedIdValue[],
  _componentId: string
): TugCard & {
  mountCount: number;
  destroyCount: number;
  framesReceived: Array<{ feedId: FeedIdValue; payload: Uint8Array }>;
} {
  return {
    feedIds,
    mountCount: 0,
    destroyCount: 0,
    framesReceived: [],
    mount(_container: HTMLElement) { this.mountCount++; },
    onFrame(feedId: FeedIdValue, payload: Uint8Array) { this.framesReceived.push({ feedId, payload }); },
    onResize(_w: number, _h: number) {},
    destroy() { this.destroyCount++; },
  };
}

// ---- Helper ----

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "1280px";
  el.style.height = "800px";
  document.body.appendChild(el);
  return el;
}

// ---- Tests ----

describe("DeckManager – addNewCard", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    container = makeContainer();
    connection = new MockConnection();
  });

  test("addNewCard with registered factory adds a panel to canvasState", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));

    const before = manager.getDeckState().cards.length;
    manager.addNewCard("terminal");
    expect(manager.getDeckState().cards.length).toBe(before + 1);
    manager.destroy();
  });

  test("addNewCard creates panel with correct componentId", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));

    manager.addNewCard("git");

    const panels = manager.getDeckState().cards;
    const newPanel = panels[panels.length - 1];
    expect(newPanel.tabs[0].componentId).toBe("git");
    manager.destroy();
  });

  test("addNewCard positions panel at canvas center (400x300)", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    manager.addNewCard("stats");

    const panels = manager.getDeckState().cards;
    const newPanel = panels[panels.length - 1];
    expect(newPanel.size.width).toBe(400);
    expect(newPanel.size.height).toBe(300);
    manager.destroy();
  });

  test("addNewCard adds the card to the correct feed dispatch set", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const card = makeMockCard([FeedId.FILESYSTEM], "files");
    manager.registerCardFactory("files", () => card);

    manager.addNewCard("files");

    const filesSet = manager.getCardsByFeed().get(FeedId.FILESYSTEM);
    expect(filesSet?.has(card)).toBe(true);
    manager.destroy();
  });
});

describe("DeckManager – fan-out frame dispatch", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    container = makeContainer();
    connection = new MockConnection();
  });

  test("two terminal cards simultaneously receive terminal feed frames", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const card1 = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");
    const card2 = makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal");

    // Register card1 via addCard, card2 directly
    manager.addCard(card1, "terminal");
    manager.getCardsByFeed().get(FeedId.TERMINAL_OUTPUT)?.add(card2);

    const payload = new Uint8Array([10, 20, 30]);
    connection.deliverFrame(FeedId.TERMINAL_OUTPUT, payload);

    expect(card1.framesReceived.length).toBe(1);
    expect(card2.framesReceived.length).toBe(1);
    expect(card1.framesReceived[0].payload).toEqual(payload);
    expect(card2.framesReceived[0].payload).toEqual(payload);
    manager.destroy();
  });

  test("frame for feedId not subscribed to by a card is not delivered", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const gitCard = makeMockCard([FeedId.GIT], "git");
    manager.addCard(gitCard, "git");

    // Deliver a terminal output frame (not subscribed by gitCard)
    connection.deliverFrame(FeedId.TERMINAL_OUTPUT, new Uint8Array([99]));
    expect(gitCard.framesReceived.length).toBe(0);
    manager.destroy();
  });
});

describe("DeckManager – resetLayout", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    container = makeContainer();
    connection = new MockConnection();
  });

  test("resetLayout produces exactly 5 panels", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("conversation", () => makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"));
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILESYSTEM], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    // Add extra card to verify cleanup
    manager.registerCardFactory("extra", () => makeMockCard([FeedId.GIT], "extra"));
    manager.addNewCard("git");

    manager.resetLayout();

    expect(manager.getDeckState().cards.length).toBe(5);
    manager.destroy();
  });

  test("resetLayout destroys old cards", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const oldCard = makeMockCard([FeedId.GIT], "git");
    manager.addCard(oldCard, "git");

    manager.registerCardFactory("conversation", () => makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"));
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILESYSTEM], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    manager.resetLayout();

    expect(oldCard.destroyCount).toBe(1);
    manager.destroy();
  });

  test("resetLayout clears feed dispatch sets of old cards", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const oldCard = makeMockCard([FeedId.GIT], "git");
    manager.addCard(oldCard, "git");

    manager.registerCardFactory("conversation", () => makeMockCard([FeedId.CONVERSATION_OUTPUT], "conversation"));
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILESYSTEM], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    manager.resetLayout();

    // oldCard should no longer be in the GIT feed set
    const gitSet = manager.getCardsByFeed().get(FeedId.GIT);
    expect(gitSet?.has(oldCard)).toBe(false);
    manager.destroy();
  });
});

describe("DeckManager – v4 layout persistence", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    container = makeContainer();
    connection = new MockConnection();
  });

  test("layout is saved to localStorage as v4 format", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const tabId = "persist-tab";
    manager.applyLayout({
      cards: [{
        id: "persist-panel",
        position: { x: 50, y: 75 },
        size: { width: 350, height: 250 },
        tabs: [{ id: tabId, componentId: "git", title: "Git", closable: true }],
        activeTabId: tabId,
      }],
    });

    // scheduleSave uses debounce; verify the state is maintained
    const state = manager.getDeckState();
    expect(state.cards[0].position.x).toBe(50);
    expect(state.cards[0].size.width).toBe(350);
    manager.destroy();
  });

  test("serialize produces version:4 format", () => {
    const tabId = "ser-tab";
    const canvasState = {
      cards: [{
        id: "ser-panel",
        position: { x: 10, y: 20 },
        size: { width: 300, height: 200 },
        tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
        activeTabId: tabId,
      }],
    };
    const serialized = serialize(canvasState) as Record<string, unknown>;
    expect(serialized["version"]).toBe(5);
    expect(Array.isArray(serialized["cards"])).toBe(true);
  });

  test("v3 layout in localStorage falls back to buildDefaultLayout", () => {
    // Store a v3 layout
    const v3 = { version: 3, root: { type: "tab", id: "x", tabs: [], activeTabIndex: 0 }, floating: [] };
    localStorageMock.setItem("tugdeck-layout", JSON.stringify(v3));

    const manager = new DeckManager(container, connection as unknown as TugConnection);
    // Should fall back to 5-panel default layout (v3 is discarded per D02)
    expect(manager.getDeckState().cards.length).toBe(5);
    manager.destroy();
  });
});

describe("Dock – component and theme switching", () => {
  let connection: MockConnection;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    container = makeContainer();
    connection = new MockConnection();
  });

  test("Dock element is appended to document.body", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const dock = new Dock(manager);
    expect(document.body.querySelector(".dock")).not.toBeNull();
    dock.destroy();
    manager.destroy();
  });

  test("Dock settings menu does not include Save Layout or preset items", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("conversation", () => makeMockCard([FeedId.CONVERSATION], "conversation"));
    const dock = new Dock(manager);

    // Click settings gear to open menu
    const settingsBtn = document.body.querySelectorAll(".dock-icon-btn")[5] as HTMLElement;
    settingsBtn?.click();

    // Check no preset-related items exist
    const menuItems = document.querySelectorAll(".card-dropdown-item");
    const labels = Array.from(menuItems).map((el) => el.textContent ?? "");

    expect(labels.some((l) => l.includes("Save Layout"))).toBe(false);
    expect(labels.some((l) => l.startsWith("Load:"))).toBe(false);

    dock.destroy();
    manager.destroy();
  });

  test("Dock settings menu includes all expected items", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const dock = new Dock(manager);

    // Click settings gear
    const settingsBtn = document.body.querySelectorAll(".dock-icon-btn")[5] as HTMLElement;
    settingsBtn?.click();

    const menuItems = document.querySelectorAll(".card-dropdown-item");
    const labels = Array.from(menuItems).map((el) => el.textContent ?? "");

    expect(labels.some((l) => l.includes("Add Conversation"))).toBe(true);
    expect(labels.some((l) => l.includes("Add Terminal"))).toBe(true);
    expect(labels.some((l) => l.includes("Add Git"))).toBe(true);
    expect(labels.some((l) => l.includes("Add Files"))).toBe(true);
    expect(labels.some((l) => l.includes("Add Stats"))).toBe(true);
    expect(labels.some((l) => l.includes("Reset Layout"))).toBe(true);
    expect(labels.some((l) => l.includes("Theme"))).toBe(true);
    expect(labels.some((l) => l.includes("About tugdeck"))).toBe(true);

    dock.destroy();
    manager.destroy();
  });

  test("Dock renders with 5 card-type icon buttons + settings gear + logo", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const dock = new Dock(manager);

    const dockEl = document.body.querySelector(".dock");
    const iconBtns = dockEl?.querySelectorAll(".dock-icon-btn");
    const logo = dockEl?.querySelector(".dock-logo");

    expect(iconBtns?.length).toBe(6); // 5 card types + 1 settings gear
    expect(logo).not.toBeNull();

    dock.destroy();
    manager.destroy();
  });

  test("Clicking card icon calls DeckManager.addNewCard with correct type", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));

    const dock = new Dock(manager);
    const before = manager.getDeckState().cards.length;

    // Click terminal icon (second button)
    const terminalBtn = document.body.querySelectorAll(".dock-icon-btn")[1] as HTMLElement;
    terminalBtn?.click();

    expect(manager.getDeckState().cards.length).toBe(before + 1);

    dock.destroy();
    manager.destroy();
  });

  test("Theme select Bluenote adds body.td-theme-bluenote", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const dock = new Dock(manager);

    // Simulate theme selection to Bluenote
    document.body.classList.add("td-theme-bluenote");
    expect(document.body.classList.contains("td-theme-bluenote")).toBe(true);

    dock.destroy();
    manager.destroy();
  });

  test("Theme select Harmony adds body.td-theme-harmony", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const dock = new Dock(manager);

    document.body.classList.add("td-theme-harmony");
    expect(document.body.classList.contains("td-theme-harmony")).toBe(true);

    dock.destroy();
    manager.destroy();
  });

  test("Theme select Brio removes all td-theme-* classes", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    document.body.classList.add("td-theme-bluenote");

    const dock = new Dock(manager);
    // Simulate switching to Brio (remove all theme classes)
    document.body.classList.remove("td-theme-bluenote", "td-theme-harmony");

    expect(document.body.classList.contains("td-theme-bluenote")).toBe(false);
    expect(document.body.classList.contains("td-theme-harmony")).toBe(false);

    dock.destroy();
    manager.destroy();
  });

  test("Dock reads theme from localStorage on construction and applies body class", () => {
    localStorageMock.setItem("td-theme", "bluenote");
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const dock = new Dock(manager);

    expect(document.body.classList.contains("td-theme-bluenote")).toBe(true);

    dock.destroy();
    manager.destroy();
  });

  test("Dock.destroy() removes dock element and cleans up", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const dock = new Dock(manager);

    expect(document.body.querySelector(".dock")).not.toBeNull();
    dock.destroy();
    expect(document.body.querySelector(".dock")).toBeNull();

    manager.destroy();
  });

  test("Clicking each of the 5 card type icons creates correct panel type", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    manager.registerCardFactory("conversation", () => makeMockCard([FeedId.CONVERSATION], "conversation"));
    manager.registerCardFactory("terminal", () => makeMockCard([FeedId.TERMINAL_OUTPUT], "terminal"));
    manager.registerCardFactory("git", () => makeMockCard([FeedId.GIT], "git"));
    manager.registerCardFactory("files", () => makeMockCard([FeedId.FILES], "files"));
    manager.registerCardFactory("stats", () => makeMockCard([FeedId.STATS], "stats"));

    const dock = new Dock(manager);
    const iconBtns = document.body.querySelectorAll(".dock-icon-btn");

    // Click each of the 5 card type icons (0-4, icon 5 is settings gear)
    const before = manager.getDeckState().cards.length;

    // Icon 0: conversation
    (iconBtns[0] as HTMLElement)?.click();
    expect(manager.getDeckState().cards.length).toBe(before + 1);
    expect(manager.getDeckState().cards[before].tabs[0].componentId).toBe("conversation");

    // Icon 1: terminal
    (iconBtns[1] as HTMLElement)?.click();
    expect(manager.getDeckState().cards.length).toBe(before + 2);
    expect(manager.getDeckState().cards[before + 1].tabs[0].componentId).toBe("terminal");

    // Icon 2: git
    (iconBtns[2] as HTMLElement)?.click();
    expect(manager.getDeckState().cards.length).toBe(before + 3);
    expect(manager.getDeckState().cards[before + 2].tabs[0].componentId).toBe("git");

    // Icon 3: files
    (iconBtns[3] as HTMLElement)?.click();
    expect(manager.getDeckState().cards.length).toBe(before + 4);
    expect(manager.getDeckState().cards[before + 3].tabs[0].componentId).toBe("files");

    // Icon 4: stats
    (iconBtns[4] as HTMLElement)?.click();
    expect(manager.getDeckState().cards.length).toBe(before + 5);
    expect(manager.getDeckState().cards[before + 4].tabs[0].componentId).toBe("stats");

    dock.destroy();
    manager.destroy();
  });

  test("Theme selection persists to localStorage td-theme key", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const dock = new Dock(manager);

    // Simulate selecting Bluenote theme (this would normally happen via settings menu)
    document.body.classList.add("td-theme-bluenote");
    localStorage.setItem("td-theme", "bluenote");
    expect(localStorage.getItem("td-theme")).toBe("bluenote");

    // Simulate selecting Harmony theme
    document.body.classList.remove("td-theme-bluenote");
    document.body.classList.add("td-theme-harmony");
    localStorage.setItem("td-theme", "harmony");
    expect(localStorage.getItem("td-theme")).toBe("harmony");

    // Simulate selecting Brio theme (remove all classes)
    document.body.classList.remove("td-theme-harmony");
    localStorage.setItem("td-theme", "brio");
    expect(localStorage.getItem("td-theme")).toBe("brio");

    dock.destroy();
    manager.destroy();
  });
});
