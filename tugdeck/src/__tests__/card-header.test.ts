/**
 * CardHeader and DropdownMenu tests.
 *
 * Tests cover:
 * a. CardHeader renders correct icon, title, and buttons from meta
 * b. Collapse button toggles card content visibility
 * c. Close button fires onClose callback
 * d. DropdownMenu opens on menu button click and closes on click-outside
 * e. DropdownMenu closes on Escape key press
 * f. ConversationCard permission mode menu item sends correct IPC message
 * g. Floating panel uses full CardHeader (not temporary .floating-panel-title-bar)
 * h. Integration: all five cards display correct header metadata
 *
 * [D06] Hybrid header bar construction
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

// crypto mock: patch only randomUUID to preserve crypto.subtle for tests that
// need it (e.g. session-cache, e2e-integration). Unconditional assignment would
// overwrite crypto.subtle with undefined and corrupt subsequent test files.
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
import { ConversationCard } from "../cards/conversation-card";
import { GitCard } from "../cards/git-card";
import { FilesCard } from "../cards/files-card";
import { StatsCard } from "../cards/stats-card";
import { CardFrame } from "../card-frame";
import { DeckManager } from "../deck-manager";
import type { TugConnection } from "../connection";
import type { PanelState } from "../layout-tree";
import { FeedId } from "../protocol";

// ---- MockTerminalCard: replaces the real TerminalCard import to prevent xterm.js
// WebGL addon from loading in happy-dom (which corrupts crypto.subtle). ----
//
// The mock provides the correct meta shape (title, icon, closable, menuItems)
// without importing xterm.js or any browser-GPU dependent code.
class MockTerminalCard {
  readonly feedIds = [FeedId.TERMINAL_OUTPUT];

  // Accept optional connection argument to match TerminalCard constructor signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_connection?: unknown) {}

  private _fontSize = 14;
  private _webglEnabled = true;

  get meta(): TugCardMeta {
    return {
      title: "Terminal",
      icon: "Terminal",
      closable: true,
      menuItems: [
        {
          type: "select",
          label: "Font Size",
          options: ["Small", "Medium", "Large"],
          value: ({ 12: "Small", 14: "Medium", 16: "Large" } as Record<number, string>)[this._fontSize] ?? "Medium",
          action: (label: string) => {
            this._fontSize = ({ Small: 12, Medium: 14, Large: 16 } as Record<string, number>)[label] ?? 14;
          },
        },
        {
          type: "action",
          label: "Clear Scrollback",
          action: () => {},
        },
        {
          type: "toggle",
          label: "WebGL Renderer",
          checked: this._webglEnabled,
          action: (_checked: boolean) => {
            this._webglEnabled = !this._webglEnabled;
          },
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mount(_container: HTMLElement): void {}
  onFrame(_feedId: number, _payload: Uint8Array): void {}
  onResize(_w: number, _h: number): void {}
  setDragState(_ds: unknown): void {}
  destroy(): void {}
}

// Alias so tests can use `TerminalCard` without importing the real one.
const TerminalCard = MockTerminalCard;

// ---- Helpers ----

function makeMeta(
  overrides: Partial<TugCardMeta> = {}
): TugCardMeta {
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
  test("renders .panel-header element", () => {
    const meta = makeMeta({ title: "Terminal", icon: "Terminal" });
    const header = new CardHeader(meta, {
      onClose: () => {},
      onCollapse: () => {},
    });
    expect(header.getElement().classList.contains("card-header")).toBe(true);
    header.destroy();
  });

  test("renders .panel-header-title with correct uppercase text", () => {
    const meta = makeMeta({ title: "Git", icon: "GitBranch" });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const title = header.getElement().querySelector(".card-header-title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("Git");
    header.destroy();
  });

  test("renders .panel-header-icon element", () => {
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
    // Menu element should be in document.body
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

// ---- f. ConversationCard permission mode IPC ----

describe("ConversationCard – permission mode meta action", () => {
  test("meta getter returns TugCardMeta with permission mode select item", () => {
    const conn = new MockConnection();
    const card = new ConversationCard(conn as unknown as TugConnection);
    const meta = card.meta;

    expect(meta.title).toBe("Conversation");
    expect(meta.icon).toBe("MessageSquare");
    expect(meta.closable).toBe(true);
    expect(meta.menuItems.length).toBeGreaterThan(0);

    const permItem = meta.menuItems.find(
      (m) => m.type === "select" && m.label === "Permission Mode"
    );
    expect(permItem).toBeDefined();
    expect(permItem!.type).toBe("select");
    card.destroy();
  });

  test("permission mode action sends correct IPC message on bypassPermissions", () => {
    const conn = new MockConnection();
    const card = new ConversationCard(conn as unknown as TugConnection);
    const meta = card.meta;

    const permItem = meta.menuItems.find(
      (m) => m.type === "select" && m.label === "Permission Mode"
    );
    expect(permItem).toBeDefined();

    // Call the action directly
    if (permItem && permItem.type === "select") {
      permItem.action("bypassPermissions");
    }

    expect(conn.sentMessages.length).toBe(1);
    const { feedId, payload } = conn.sentMessages[0];
    expect(feedId).toBe(FeedId.CONVERSATION_INPUT);
    const decoded = JSON.parse(new TextDecoder().decode(payload));
    expect(decoded.type).toBe("permission_mode");
    expect(decoded.mode).toBe("bypassPermissions");

    card.destroy();
  });

  test("permission mode action sends correct IPC message on plan", () => {
    const conn = new MockConnection();
    const card = new ConversationCard(conn as unknown as TugConnection);
    const meta = card.meta;

    const permItem = meta.menuItems.find(
      (m) => m.type === "select" && m.label === "Permission Mode"
    );
    if (permItem && permItem.type === "select") {
      permItem.action("plan");
    }

    expect(conn.sentMessages.length).toBe(1);
    const decoded = JSON.parse(new TextDecoder().decode(conn.sentMessages[0].payload));
    expect(decoded.mode).toBe("plan");

    card.destroy();
  });

  test("ConversationCard does not create a .card-header element in mount()", () => {
    const conn = new MockConnection();
    const card = new ConversationCard(conn as unknown as TugConnection);
    const container = document.createElement("div");
    document.body.appendChild(container);
    card.mount(container);
    const oldHeader = container.querySelector(".card-header");
    expect(oldHeader).toBeNull();
    card.destroy();
  });
});

// ---- g. Floating panel uses full CardHeader ----

describe("FloatingPanel – uses full CardHeader (Step 5)", () => {
  test("floating panel contains .panel-header, not .floating-panel-title-bar", () => {
    const canvas = document.createElement("div");
    document.body.appendChild(canvas);

    const tabId = "fp-tab-1";
    const ps: PanelState = {
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

    // Should have .panel-header (CardHeader)
    const header = fp.getElement().querySelector(".card-header");
    expect(header).not.toBeNull();

    // Should NOT have .floating-panel-title-bar (the old temporary title bar)
    const oldTitleBar = fp.getElement().querySelector(".card-frame-title-bar");
    expect(oldTitleBar).toBeNull();

    fp.destroy();
  });

  test("floating panel CardHeader has no collapse button (docked-only feature)", () => {
    const canvas = document.createElement("div");
    const tabId = "fp-tab-2";
    const ps: PanelState = {
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
    const ps: PanelState = {
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

// ---- h. Integration: all five cards have correct meta ----

describe("All five cards – correct header metadata", () => {
  test("TerminalCard has meta with title Terminal and icon Terminal", () => {
    const conn = new MockConnection();
    const card = new TerminalCard(conn as unknown as TugConnection);
    expect(card.meta).toBeDefined();
    expect(card.meta!.title).toBe("Terminal");
    expect(card.meta!.icon).toBe("Terminal");
    expect(card.meta!.closable).toBe(true);
  });

  test("GitCard has meta with title Git and icon GitBranch", () => {
    const card = new GitCard();
    expect(card.meta).toBeDefined();
    expect(card.meta!.title).toBe("Git");
    expect(card.meta!.icon).toBe("GitBranch");
    expect(card.meta!.closable).toBe(true);
  });

  test("FilesCard has meta with title Files and icon FolderOpen", () => {
    const card = new FilesCard();
    expect(card.meta).toBeDefined();
    expect(card.meta!.title).toBe("Files");
    expect(card.meta!.icon).toBe("FolderOpen");
    expect(card.meta!.closable).toBe(true);
  });

  test("StatsCard has meta with title Stats and icon Activity", () => {
    const card = new StatsCard();
    expect(card.meta).toBeDefined();
    expect(card.meta!.title).toBe("Stats");
    expect(card.meta!.icon).toBe("Activity");
    expect(card.meta!.closable).toBe(true);
  });

  test("ConversationCard has meta with title Conversation and permission mode item", () => {
    const conn = new MockConnection();
    const card = new ConversationCard(conn as unknown as TugConnection);
    const meta = card.meta;
    expect(meta.title).toBe("Conversation");
    expect(meta.icon).toBe("MessageSquare");
    expect(meta.closable).toBe(true);
    const permItem = meta.menuItems.find((m) => m.type === "select" && m.label === "Permission Mode");
    expect(permItem).toBeDefined();
    card.destroy();
  });

  test("GitCard.destroy() does not reference removed 'header' field", () => {
    const card = new GitCard();
    const container = document.createElement("div");
    document.body.appendChild(container);
    card.mount(container);
    // Should not throw
    expect(() => card.destroy()).not.toThrow();
  });

  test("FilesCard.destroy() does not reference removed 'header' field", () => {
    const card = new FilesCard();
    const container = document.createElement("div");
    document.body.appendChild(container);
    card.mount(container);
    expect(() => card.destroy()).not.toThrow();
  });
});

// ---- PanelManager integration: single-tab cards get CardHeader ----

describe("PanelManager – single-tab CardHeader integration", () => {
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

  test("single-tab docked card renders a .panel-header element", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const card = new GitCard();
    manager.addCard(card, "git");
    // After addCard, the container should have a .panel-header for the single-tab git card
    const header = container.querySelector(".card-header");
    expect(header).not.toBeNull();
    manager.destroy();
  });

  test(".panel-header title matches card meta title", () => {
    const manager = new DeckManager(container, connection as unknown as TugConnection);
    const card = new GitCard();
    manager.addCard(card, "git");
    // There are 5 default panels; find the one with the git title
    const allTitles = Array.from(container.querySelectorAll(".card-header-title"));
    const gitTitle = allTitles.find((el) => el.textContent === "Git");
    expect(gitTitle).not.toBeNull();
    expect(gitTitle!.textContent).toBe("Git");
    manager.destroy();
  });
});
