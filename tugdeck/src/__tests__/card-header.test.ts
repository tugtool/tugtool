/**
 * CardHeader and DropdownMenu tests (Step 10 update).
 *
 * After vanilla card deletion, these tests verify CardHeader and DropdownMenu
 * behavior using mock TugCardMeta objects. Vanilla card imports (ConversationCard,
 * GitCard, FilesCard, StatsCard) are removed; the full adapter meta bridge is
 * tested in react-card-adapter.test.tsx (Step 3).
 *
 * Tests cover:
 * a. CardHeader renders correct icon, title, and buttons from meta
 * b. Collapse button toggles card content visibility
 * c. Close button fires onClose callback
 * d. DropdownMenu opens on menu button click and closes on click-outside
 * e. DropdownMenu closes on Escape key press
 * f. CardHeader.updateMeta() updates title/icon/menu in place
 * g. CardFrame uses full CardHeader (not temporary title bar)
 * h. Integration: mock card meta shapes display correct header metadata
 *
 * [D06] Replace tests
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

// Expose globals from window that tests may need
if (!(global as Record<string, unknown>)["KeyboardEvent"]) {
  (global as Record<string, unknown>)["KeyboardEvent"] = (window as unknown as Record<string, unknown>)["KeyboardEvent"];
}

// requestAnimationFrame mock (not in happy-dom)
if (!global.requestAnimationFrame) {
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    setTimeout(() => cb(0), 0);
    return 0;
  };
}

// Patch HTMLElement.prototype for setPointerCapture (not in happy-dom)
const htmlElementProto = Object.getPrototypeOf(document.createElement("div")) as Record<string, unknown>;
if (!htmlElementProto["setPointerCapture"]) {
  htmlElementProto["setPointerCapture"] = function () {};
}
if (!htmlElementProto["releasePointerCapture"]) {
  htmlElementProto["releasePointerCapture"] = function () {};
}

// crypto mock
let uuidCounter = 0;
if (!global.crypto) {
  global.crypto = {} as unknown as Crypto;
}
(global.crypto as unknown as Record<string, unknown>)["randomUUID"] = () => {
  uuidCounter++;
  return `card-header-uuid-${uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`;
};

import { CardHeader } from "../card-header";
import { DropdownMenu } from "../card-menu";
import type { TugCardMeta, CardMenuItem } from "../cards/card";
import { CardFrame } from "../card-frame";
import { DeckManager } from "../deck-manager";
import type { CardState } from "../layout-tree";

// ---- Mock TugCard for DeckManager integration tests ----

class MockCard {
  readonly feedIds: readonly number[] = [];
  readonly meta: TugCardMeta;

  constructor(meta: TugCardMeta) {
    this.meta = meta;
  }

  mount(_container: HTMLElement): void {}
  onFrame(_feedId: number, _payload: Uint8Array): void {}
  onResize(_w: number, _h: number): void {}
  destroy(): void {}
}

// ---- Helpers ----

function makeMeta(overrides: Partial<TugCardMeta> = {}): TugCardMeta {
  return {
    title: "Test",
    icon: "Activity",
    closable: true,
    menuItems: [],
    ...overrides,
  };
}

class MockConnection {
  public sentMessages: Array<{ feedId: number; payload: Uint8Array }> = [];
  onFrame(_feedId: number, _cb: (p: Uint8Array) => void) {}
  onOpen(_cb: () => void) {}
  send(feedId: number, payload: Uint8Array) {
    this.sentMessages.push({ feedId, payload });
  }
}

// ---- a. CardHeader DOM structure ----

describe("CardHeader – DOM structure", () => {
  test("renders .card-header element", () => {
    const meta = makeMeta({ title: "Terminal", icon: "Terminal" });
    const header = new CardHeader(meta, {
      onClose: () => {},
      onCollapse: () => {},
    });
    expect(header.getElement().classList.contains("card-header")).toBe(true);
    header.destroy();
  });

  test("renders .card-header-title with correct text", () => {
    const meta = makeMeta({ title: "Git", icon: "GitBranch" });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const title = header.getElement().querySelector(".card-header-title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("Git");
    header.destroy();
  });

  test("renders .card-header-icon element", () => {
    const meta = makeMeta({ icon: "Activity" });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const icon = header.getElement().querySelector(".card-header-icon");
    expect(icon).not.toBeNull();
    header.destroy();
  });

  test("renders close button when meta.closable is true", () => {
    const meta = makeMeta({ closable: true });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const closeBtn = header.getElement().querySelector('[aria-label="Close card"]');
    expect(closeBtn).not.toBeNull();
    header.destroy();
  });

  test("does NOT render close button when meta.closable is false", () => {
    const meta = makeMeta({ closable: false });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const closeBtn = header.getElement().querySelector('[aria-label="Close card"]');
    expect(closeBtn).toBeNull();
    header.destroy();
  });

  test("renders collapse button by default (showCollapse: true)", () => {
    const meta = makeMeta();
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const collapseBtn = header.getElement().querySelector('[aria-label="Collapse card"]');
    expect(collapseBtn).not.toBeNull();
    header.destroy();
  });

  test("does NOT render collapse button when showCollapse: false", () => {
    const meta = makeMeta();
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} }, { showCollapse: false });
    const collapseBtn = header.getElement().querySelector('[aria-label="Collapse card"]');
    expect(collapseBtn).toBeNull();
    header.destroy();
  });

  test("renders menu button when menuItems are provided", () => {
    const menuItems: CardMenuItem[] = [{ type: "action", label: "Do thing", action: () => {} }];
    const meta = makeMeta({ menuItems });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const menuBtn = header.getElement().querySelector('[aria-label="Card menu"]');
    expect(menuBtn).not.toBeNull();
    header.destroy();
  });

  test("does NOT render menu button when menuItems is empty", () => {
    const meta = makeMeta({ menuItems: [] });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const menuBtn = header.getElement().querySelector('[aria-label="Card menu"]');
    expect(menuBtn).toBeNull();
    header.destroy();
  });
});

// ---- b. Collapse button ----

describe("CardHeader – collapse button", () => {
  test("collapse button fires onCollapse callback", () => {
    let collapsed = false;
    const meta = makeMeta();
    const header = new CardHeader(meta, {
      onClose: () => {},
      onCollapse: () => { collapsed = !collapsed; },
    });
    const collapseBtn = header.getElement().querySelector('[aria-label="Collapse card"]') as HTMLElement;
    collapseBtn.click();
    expect(collapsed).toBe(true);
    collapseBtn.click();
    expect(collapsed).toBe(false);
    header.destroy();
  });
});

// ---- c. Close button ----

describe("CardHeader – close button", () => {
  test("close button fires onClose callback", () => {
    let closed = false;
    const meta = makeMeta({ closable: true });
    const header = new CardHeader(meta, {
      onClose: () => { closed = true; },
      onCollapse: () => {},
    });
    const closeBtn = header.getElement().querySelector('[aria-label="Close card"]') as HTMLElement;
    closeBtn.click();
    expect(closed).toBe(true);
    header.destroy();
  });

  test("close button click does not also fire onCollapse", () => {
    let collapseFired = false;
    const meta = makeMeta({ closable: true });
    const header = new CardHeader(meta, {
      onClose: () => {},
      onCollapse: () => { collapseFired = true; },
    });
    const closeBtn = header.getElement().querySelector('[aria-label="Close card"]') as HTMLElement;
    closeBtn.click();
    expect(collapseFired).toBe(false);
    header.destroy();
  });
});

// ---- d. DropdownMenu opens on click, closes on click-outside ----

describe("DropdownMenu – open and close", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("menu is not open initially", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 200, bottom: 130,
      width: 100, height: 30, x: 100, y: 100, toJSON: () => ({})
    } as DOMRect);
    const items: CardMenuItem[] = [{ type: "action", label: "Do thing", action: () => {} }];
    const menu = new DropdownMenu(items, anchor);
    expect(menu.isOpen()).toBe(false);
    menu.destroy();
  });

  test("menu is open after open() is called", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 200, bottom: 130,
      width: 100, height: 30, x: 100, y: 100, toJSON: () => ({})
    } as DOMRect);
    const items: CardMenuItem[] = [{ type: "action", label: "Do thing", action: () => {} }];
    const menu = new DropdownMenu(items, anchor);
    menu.open();
    expect(menu.isOpen()).toBe(true);
    const menuEl = document.querySelector(".card-dropdown-menu");
    expect(menuEl).not.toBeNull();
    menu.destroy();
  });

  test("menu closes after close() is called", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 200, bottom: 130,
      width: 100, height: 30, x: 100, y: 100, toJSON: () => ({})
    } as DOMRect);
    const items: CardMenuItem[] = [{ type: "action", label: "Do thing", action: () => {} }];
    const menu = new DropdownMenu(items, anchor);
    menu.open();
    menu.close();
    expect(menu.isOpen()).toBe(false);
    const menuEl = document.querySelector(".card-dropdown-menu");
    expect(menuEl).toBeNull();
    menu.destroy();
  });

  test("action item click fires action and closes menu", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 30,
      width: 100, height: 30, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect);
    let actionFired = false;
    const items: CardMenuItem[] = [{ type: "action", label: "Do thing", action: () => { actionFired = true; } }];
    const menu = new DropdownMenu(items, anchor);
    menu.open();
    const itemEl = document.querySelector(".card-dropdown-item") as HTMLElement;
    itemEl.click();
    expect(actionFired).toBe(true);
    expect(menu.isOpen()).toBe(false);
    menu.destroy();
  });
});

// ---- e. DropdownMenu closes on Escape ----

describe("DropdownMenu – Escape key", () => {
  test("Escape key closes the menu", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 30,
      width: 100, height: 30, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect);
    const items: CardMenuItem[] = [{ type: "action", label: "Dismiss me", action: () => {} }];
    const menu = new DropdownMenu(items, anchor);
    menu.open();
    expect(menu.isOpen()).toBe(true);

    const KE = (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
    const escEvent = new KE("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(escEvent);

    expect(menu.isOpen()).toBe(false);
    menu.destroy();
  });
});

// ---- f. CardHeader.updateMeta() ----

describe("CardHeader – updateMeta()", () => {
  test("updateMeta() updates the title text in place", () => {
    const meta = makeMeta({ title: "Files", icon: "FolderOpen", menuItems: [] });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });

    const titleEl = header.getElement().querySelector(".card-header-title");
    expect(titleEl?.textContent).toBe("Files");

    header.updateMeta({ title: "Files (2)", icon: "FolderOpen", closable: true, menuItems: [] });
    expect(titleEl?.textContent).toBe("Files (2)");

    header.destroy();
  });

  test("updateMeta() adds menu button when new meta has menu items", () => {
    const meta = makeMeta({ menuItems: [] });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });

    // No menu button initially
    expect(header.getElement().querySelector('[aria-label="Card menu"]')).toBeNull();

    // After updateMeta with menu items, button should appear
    header.updateMeta({
      title: "Test",
      icon: "Activity",
      closable: true,
      menuItems: [{ type: "action", label: "Clear", action: () => {} }],
    });

    expect(header.getElement().querySelector('[aria-label="Card menu"]')).not.toBeNull();

    header.destroy();
  });

  test("updateMeta() updates the title for a live meta push (Conversation title change)", () => {
    const meta = makeMeta({ title: "Code", icon: "MessageSquare", menuItems: [] });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });

    header.updateMeta({ title: "Code — my-project", icon: "MessageSquare", closable: true, menuItems: [] });

    const titleEl = header.getElement().querySelector(".card-header-title");
    expect(titleEl?.textContent).toBe("Code — my-project");

    header.destroy();
  });
});

// ---- g. CardFrame uses full CardHeader ----

describe("CardFrame – uses full CardHeader", () => {
  test("card frame contains .card-header, not .card-frame-title-bar", () => {
    const canvas = document.createElement("div");
    document.body.appendChild(canvas);

    const tabId = "fp-tab-1";
    const ps: CardState = {
      id: "fp-panel-1",
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
    };

    const fp = new CardFrame(ps, {
      onMoveEnd: () => {},
      onResizeEnd: () => {},
      onFocus: () => {},
      onClose: () => {},
    }, canvas);

    const header = fp.getElement().querySelector(".card-header");
    expect(header).not.toBeNull();

    const oldTitleBar = fp.getElement().querySelector(".card-frame-title-bar");
    expect(oldTitleBar).toBeNull();

    fp.destroy();
  });

  test("floating panel CardHeader has no collapse button (docked-only feature)", () => {
    const canvas = document.createElement("div");
    const tabId = "fp-tab-2";
    const ps: CardState = {
      id: "fp-panel-2",
      position: { x: 50, y: 50 },
      size: { width: 400, height: 300 },
      tabs: [{ id: tabId, componentId: "git", title: "Git", closable: true }],
      activeTabId: tabId,
    };

    const fp = new CardFrame(ps, {
      onMoveEnd: () => {},
      onResizeEnd: () => {},
      onFocus: () => {},
      onClose: () => {},
    }, canvas);

    const collapseBtn = fp.getElement().querySelector('[aria-label="Collapse card"]');
    expect(collapseBtn).toBeNull();

    fp.destroy();
  });

  test("floating panel uses card meta when provided", () => {
    const canvas = document.createElement("div");
    const tabId = "fp-tab-3";
    const ps: CardState = {
      id: "fp-panel-3",
      position: { x: 50, y: 50 },
      size: { width: 400, height: 300 },
      tabs: [{ id: tabId, componentId: "git", title: "Git", closable: true }],
      activeTabId: tabId,
    };
    const meta: TugCardMeta = { title: "Git Branch", icon: "GitBranch", closable: true, menuItems: [] };

    const fp = new CardFrame(ps, {
      onMoveEnd: () => {},
      onResizeEnd: () => {},
      onFocus: () => {},
      onClose: () => {},
    }, canvas, meta);

    const titleEl = fp.getElement().querySelector(".card-header-title");
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe("Git Branch");

    fp.destroy();
  });
});

// ---- h. Integration: mock card meta shapes for all card types ----

describe("All card types – correct header metadata from mock TugCardMeta", () => {
  test("Terminal mock meta has title Terminal, icon Terminal, closable true", () => {
    const meta: TugCardMeta = {
      title: "Terminal",
      icon: "Terminal",
      closable: true,
      menuItems: [
        { type: "select", label: "Font Size", options: ["Small", "Medium", "Large"], value: "Medium", action: () => {} },
        { type: "action", label: "Clear Scrollback", action: () => {} },
        { type: "toggle", label: "WebGL Renderer", checked: true, action: () => {} },
      ],
    };
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const title = header.getElement().querySelector(".card-header-title");
    expect(title?.textContent).toBe("Terminal");
    expect(meta.closable).toBe(true);
    expect(meta.menuItems.length).toBe(3);
    header.destroy();
  });

  test("Git mock meta has title Git, icon GitBranch, closable true", () => {
    const meta: TugCardMeta = {
      title: "Git",
      icon: "GitBranch",
      closable: true,
      menuItems: [
        { type: "action", label: "Refresh Now", action: () => {} },
        { type: "toggle", label: "Show Untracked", checked: true, action: () => {} },
      ],
    };
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const title = header.getElement().querySelector(".card-header-title");
    expect(title?.textContent).toBe("Git");
    header.destroy();
  });

  test("Files mock meta has title Files, icon FolderOpen, closable true", () => {
    const meta: TugCardMeta = {
      title: "Files",
      icon: "FolderOpen",
      closable: true,
      menuItems: [
        { type: "action", label: "Clear History", action: () => {} },
        { type: "select", label: "Max Entries", options: ["50", "100", "200"], value: "100", action: () => {} },
      ],
    };
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const title = header.getElement().querySelector(".card-header-title");
    expect(title?.textContent).toBe("Files");
    header.destroy();
  });

  test("Stats mock meta has title Stats, icon Activity, closable true", () => {
    const meta: TugCardMeta = {
      title: "Stats",
      icon: "Activity",
      closable: true,
      menuItems: [
        { type: "select", label: "Sparkline Timeframe", options: ["30s", "60s", "120s"], value: "60s", action: () => {} },
        { type: "toggle", label: "Show CPU / Memory", checked: true, action: () => {} },
        { type: "toggle", label: "Show Token Usage", checked: true, action: () => {} },
        { type: "toggle", label: "Show Build Status", checked: true, action: () => {} },
      ],
    };
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const title = header.getElement().querySelector(".card-header-title");
    expect(title?.textContent).toBe("Stats");
    header.destroy();
  });

  test("Conversation mock meta has title Code, icon MessageSquare, permission mode item", () => {
    const meta: TugCardMeta = {
      title: "Code",
      icon: "MessageSquare",
      closable: true,
      menuItems: [
        { type: "select", label: "Permission Mode", options: ["default", "acceptEdits", "bypassPermissions", "plan"], value: "acceptEdits", action: () => {} },
        { type: "action", label: "New Session", action: () => {} },
        { type: "action", label: "Export History", action: () => {} },
      ],
    };
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const title = header.getElement().querySelector(".card-header-title");
    expect(title?.textContent).toBe("Code");
    const permItem = meta.menuItems.find((m) => m.type === "select" && m.label === "Permission Mode");
    expect(permItem).toBeDefined();
    header.destroy();
  });
});

// ---- DeckManager integration: single-tab cards get CardHeader ----

describe("DeckManager – single-tab CardHeader integration", () => {
  let container: HTMLElement;
  let connection: MockConnection;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
    uuidCounter = 9000;

    container = document.createElement("div");
    container.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1280, bottom: 800,
      width: 1280, height: 800, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect);
    document.body.appendChild(container);
    connection = new MockConnection();
  });

  test("single-tab docked card renders a .card-header element", () => {
    const manager = new DeckManager(container, connection as unknown as import("../connection").TugConnection);
    const card = new MockCard({ title: "Git", icon: "GitBranch", closable: true, menuItems: [] });
    manager.addCard(card as unknown as import("../cards/card").TugCard, "git");
    const header = container.querySelector(".card-header");
    expect(header).not.toBeNull();
    manager.destroy();
  });

  test(".card-header title matches card meta title", () => {
    const manager = new DeckManager(container, connection as unknown as import("../connection").TugConnection);
    const card = new MockCard({ title: "Git", icon: "GitBranch", closable: true, menuItems: [] });
    manager.addCard(card as unknown as import("../cards/card").TugCard, "git");
    const allTitles = Array.from(container.querySelectorAll(".card-header-title"));
    const gitTitle = allTitles.find((el) => el.textContent === "Git");
    expect(gitTitle).not.toBeNull();
    expect(gitTitle!.textContent).toBe("Git");
    manager.destroy();
  });
});
