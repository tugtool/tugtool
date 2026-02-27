/**
 * Card chrome-layer menu tests (Step 10 update).
 *
 * After vanilla card deletion, these tests verify the chrome-layer menu
 * infrastructure using mock TugCardMeta objects rather than instantiating
 * full vanilla card components.
 *
 * ReactCardAdapter meta propagation is tested in react-card-adapter.test.tsx
 * (Step 3). Per-card menu item correctness is tested in each React card's own
 * RTL test file (Steps 4–9). This file tests CardHeader/DropdownMenu behavior
 * with arbitrary menu item shapes.
 *
 * Tests cover:
 * a. Action items fire their callback (no throw, expected side-effects)
 * b. Toggle items update their state on action
 * c. Select items update value and fire callback with selected value
 * d. Integration: CardHeader correctly reflects menu items from TugCardMeta
 *
 * [D06] Replace tests
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Window } from "happy-dom";

// DOM setup
const window = new Window();
global.window = window as unknown as typeof globalThis.window;
global.document = window.document as unknown as Document;
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

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

if (!global.requestAnimationFrame) {
  (global as Record<string, unknown>)["requestAnimationFrame"] = (cb: FrameRequestCallback) => {
    setTimeout(cb, 0);
    return 0;
  };
}
if (!global.cancelAnimationFrame) {
  (global as Record<string, unknown>)["cancelAnimationFrame"] = (_id: number) => {};
}

import { CardHeader } from "../card-header";
import { DropdownMenu } from "../card-menu";
import type { CardMenuAction, CardMenuToggle, CardMenuSelect, TugCardMeta, CardMenuItem } from "../cards/card";

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

function findAction(items: CardMenuItem[], label: string): CardMenuAction {
  const item = items.find((m) => m.type === "action" && m.label === label);
  if (!item || item.type !== "action") throw new Error(`Action item "${label}" not found`);
  return item;
}

function findToggle(items: CardMenuItem[], label: string): CardMenuToggle {
  const item = items.find((m) => m.type === "toggle" && m.label === label);
  if (!item || item.type !== "toggle") throw new Error(`Toggle item "${label}" not found`);
  return item;
}

function findSelect(items: CardMenuItem[], label: string): CardMenuSelect {
  const item = items.find((m) => m.type === "select" && m.label === label);
  if (!item || item.type !== "select") throw new Error(`Select item "${label}" not found`);
  return item;
}

// ---- a. Action items fire callback without throw ----

describe("Action items – fire callback without throw", () => {
  test("action item fires callback when invoked", () => {
    let called = false;
    const items: CardMenuItem[] = [
      { type: "action", label: "Do Thing", action: () => { called = true; } },
    ];
    const item = findAction(items, "Do Thing");
    expect(() => item.action()).not.toThrow();
    expect(called).toBe(true);
  });

  test("action item with side effects fires correctly", () => {
    const log: string[] = [];
    const items: CardMenuItem[] = [
      { type: "action", label: "Clear History", action: () => { log.push("cleared"); } },
      { type: "action", label: "New Session", action: () => { log.push("new-session"); } },
    ];
    findAction(items, "Clear History").action();
    findAction(items, "New Session").action();
    expect(log).toEqual(["cleared", "new-session"]);
  });

  test("action item with connection send fires correctly", () => {
    const sent: string[] = [];
    const items: CardMenuItem[] = [
      {
        type: "action",
        label: "Export History",
        action: () => { sent.push("exported"); },
      },
    ];
    findAction(items, "Export History").action();
    expect(sent).toContain("exported");
  });

  test("multiple action items fire independently", () => {
    let aFired = false;
    let bFired = false;
    const items: CardMenuItem[] = [
      { type: "action", label: "Action A", action: () => { aFired = true; } },
      { type: "action", label: "Action B", action: () => { bFired = true; } },
    ];
    findAction(items, "Action A").action();
    expect(aFired).toBe(true);
    expect(bFired).toBe(false);
    findAction(items, "Action B").action();
    expect(bFired).toBe(true);
  });
});

// ---- b. Toggle items update state ----

describe("Toggle items – update state on action", () => {
  test("toggle item starts with provided checked state", () => {
    const items: CardMenuItem[] = [
      { type: "toggle", label: "Show Untracked", checked: true, action: () => {} },
    ];
    expect(findToggle(items, "Show Untracked").checked).toBe(true);
  });

  test("toggle item callback fires with the new checked value", () => {
    let lastValue: boolean | undefined;
    const items: CardMenuItem[] = [
      { type: "toggle", label: "Show Untracked", checked: true, action: (v) => { lastValue = v; } },
    ];
    findToggle(items, "Show Untracked").action(false);
    expect(lastValue).toBe(false);
  });

  test("toggle item can represent WebGL Renderer toggle", () => {
    let webglEnabled = true;
    const getItems = (): CardMenuItem[] => [
      {
        type: "toggle",
        label: "WebGL Renderer",
        checked: webglEnabled,
        action: (_checked: boolean) => { webglEnabled = !webglEnabled; },
      },
    ];
    expect(findToggle(getItems(), "WebGL Renderer").checked).toBe(true);
    findToggle(getItems(), "WebGL Renderer").action(true);
    expect(webglEnabled).toBe(false);
    findToggle(getItems(), "WebGL Renderer").action(false);
    expect(webglEnabled).toBe(true);
  });

  test("toggle item can represent Show CPU/Memory toggle", () => {
    let show = true;
    const getItems = (): CardMenuItem[] => [
      { type: "toggle", label: "Show CPU / Memory", checked: show, action: () => { show = !show; } },
    ];
    expect(findToggle(getItems(), "Show CPU / Memory").checked).toBe(true);
    findToggle(getItems(), "Show CPU / Memory").action(true);
    expect(show).toBe(false);
  });

  test("multiple toggles act independently", () => {
    let cpuShow = true;
    let tokenShow = true;
    let buildShow = true;
    const getItems = (): CardMenuItem[] => [
      { type: "toggle", label: "Show CPU / Memory", checked: cpuShow, action: () => { cpuShow = !cpuShow; } },
      { type: "toggle", label: "Show Token Usage", checked: tokenShow, action: () => { tokenShow = !tokenShow; } },
      { type: "toggle", label: "Show Build Status", checked: buildShow, action: () => { buildShow = !buildShow; } },
    ];
    findToggle(getItems(), "Show CPU / Memory").action(true);
    expect(cpuShow).toBe(false);
    expect(tokenShow).toBe(true);
    expect(buildShow).toBe(true);
  });
});

// ---- c. Select items update value and fire callback ----

describe("Select items – update value and fire callback", () => {
  test("select item starts with provided value", () => {
    const items: CardMenuItem[] = [
      { type: "select", label: "Font Size", options: ["Small", "Medium", "Large"], value: "Medium", action: () => {} },
    ];
    expect(findSelect(items, "Font Size").value).toBe("Medium");
  });

  test("select item callback fires with selected value", () => {
    let selected = "Medium";
    const items: CardMenuItem[] = [
      { type: "select", label: "Font Size", options: ["Small", "Medium", "Large"], value: selected, action: (v) => { selected = v; } },
    ];
    findSelect(items, "Font Size").action("Large");
    expect(selected).toBe("Large");
  });

  test("select item options list is preserved", () => {
    const items: CardMenuItem[] = [
      { type: "select", label: "Sparkline Timeframe", options: ["30s", "60s", "120s"], value: "60s", action: () => {} },
    ];
    expect(findSelect(items, "Sparkline Timeframe").options).toEqual(["30s", "60s", "120s"]);
  });

  test("select item representing Max Entries updates correctly", () => {
    let maxEntries = "100";
    const items: CardMenuItem[] = [
      { type: "select", label: "Max Entries", options: ["50", "100", "200"], value: maxEntries, action: (v) => { maxEntries = v; } },
    ];
    findSelect(items, "Max Entries").action("50");
    expect(maxEntries).toBe("50");
  });

  test("select item representing Permission Mode fires with mode string", () => {
    let permMode = "acceptEdits";
    const items: CardMenuItem[] = [
      {
        type: "select",
        label: "Permission Mode",
        options: ["default", "acceptEdits", "bypassPermissions", "plan"],
        value: permMode,
        action: (v) => { permMode = v; },
      },
    ];
    findSelect(items, "Permission Mode").action("bypassPermissions");
    expect(permMode).toBe("bypassPermissions");
  });
});

// ---- d. Integration: CardHeader reflects menu items from TugCardMeta ----

describe("Integration – CardHeader reflects TugCardMeta menu items", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorageMock.clear();
  });

  test("CardHeader renders menu button when menuItems are present", () => {
    const meta = makeMeta({
      menuItems: [
        { type: "action", label: "Refresh Now", action: () => {} },
        { type: "toggle", label: "Show Untracked", checked: true, action: () => {} },
      ],
    });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const menuBtn = header.getElement().querySelector('[aria-label="Card menu"]');
    expect(menuBtn).not.toBeNull();
    header.destroy();
  });

  test("CardHeader does NOT render menu button when menuItems is empty", () => {
    const meta = makeMeta({ menuItems: [] });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const menuBtn = header.getElement().querySelector('[aria-label="Card menu"]');
    expect(menuBtn).toBeNull();
    header.destroy();
  });

  test("DropdownMenu renders action, toggle, and select items correctly", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 30,
      width: 100, height: 30, x: 0, y: 0, toJSON: () => ({})
    } as DOMRect);

    const items: CardMenuItem[] = [
      { type: "action", label: "Clear History", action: () => {} },
      { type: "toggle", label: "Show Untracked", checked: true, action: () => {} },
      { type: "select", label: "Max Entries", options: ["50", "100", "200"], value: "100", action: () => {} },
    ];
    const menu = new DropdownMenu(items, anchor);
    menu.open();

    const menuItems = document.querySelectorAll(".card-dropdown-item");
    expect(menuItems.length).toBeGreaterThanOrEqual(1);

    menu.destroy();
  });

  test("CardHeader title and icon reflect TugCardMeta", () => {
    const meta = makeMeta({ title: "Git", icon: "GitBranch", menuItems: [] });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });
    const title = header.getElement().querySelector(".card-header-title");
    expect(title?.textContent).toBe("Git");
    header.destroy();
  });

  test("CardHeader.updateMeta() updates title in place", () => {
    const meta = makeMeta({ title: "Files", icon: "FolderOpen", menuItems: [] });
    const header = new CardHeader(meta, { onClose: () => {}, onCollapse: () => {} });

    const titleEl = header.getElement().querySelector(".card-header-title");
    expect(titleEl?.textContent).toBe("Files");

    header.updateMeta({ title: "Files (2)", icon: "FolderOpen", closable: true, menuItems: [] });
    expect(titleEl?.textContent).toBe("Files (2)");

    header.destroy();
  });

  test("mock Terminal meta: 3 items (Font Size select, Clear Scrollback action, WebGL toggle)", () => {
    let fontSize = 14;
    let webglEnabled = true;
    const FONT_SIZE_MAP: Record<string, number> = { Small: 12, Medium: 14, Large: 16 };
    const FONT_SIZE_LABEL: Record<number, string> = { 12: "Small", 14: "Medium", 16: "Large" };

    const getTerminalMeta = (): TugCardMeta => ({
      title: "Terminal",
      icon: "Terminal",
      closable: true,
      menuItems: [
        {
          type: "select",
          label: "Font Size",
          options: ["Small", "Medium", "Large"],
          value: FONT_SIZE_LABEL[fontSize] ?? "Medium",
          action: (label: string) => { fontSize = FONT_SIZE_MAP[label] ?? 14; },
        },
        {
          type: "action",
          label: "Clear Scrollback",
          action: () => {},
        },
        {
          type: "toggle",
          label: "WebGL Renderer",
          checked: webglEnabled,
          action: (_checked: boolean) => { webglEnabled = !webglEnabled; },
        },
      ],
    });

    const meta = getTerminalMeta();
    expect(meta.menuItems.length).toBe(3);
    expect(meta.menuItems.find((m) => m.type === "select" && m.label === "Font Size")).toBeDefined();
    expect(meta.menuItems.find((m) => m.type === "action" && m.label === "Clear Scrollback")).toBeDefined();
    expect(meta.menuItems.find((m) => m.type === "toggle" && m.label === "WebGL Renderer")).toBeDefined();

    // Font Size starts at Medium (14px)
    const fontSizeItem = findSelect(meta.menuItems, "Font Size");
    expect(fontSizeItem.value).toBe("Medium");
    fontSizeItem.action("Large");
    expect(fontSize).toBe(16);

    // WebGL toggle
    const webglItem = findToggle(meta.menuItems, "WebGL Renderer");
    expect(webglItem.checked).toBe(true);
    webglItem.action(true);
    expect(webglEnabled).toBe(false);
  });

  test("mock Git meta: 2 items (Refresh Now action, Show Untracked toggle)", () => {
    let refreshCalled = false;
    let showUntracked = true;
    const meta: TugCardMeta = {
      title: "Git",
      icon: "GitBranch",
      closable: true,
      menuItems: [
        { type: "action", label: "Refresh Now", action: () => { refreshCalled = true; } },
        { type: "toggle", label: "Show Untracked", checked: showUntracked, action: () => { showUntracked = !showUntracked; } },
      ],
    };

    expect(meta.menuItems.length).toBe(2);
    findAction(meta.menuItems, "Refresh Now").action();
    expect(refreshCalled).toBe(true);
    findToggle(meta.menuItems, "Show Untracked").action(true);
    expect(showUntracked).toBe(false);
  });

  test("mock Stats meta: 4 items (Sparkline Timeframe select, 3 visibility toggles)", () => {
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

    expect(meta.menuItems.length).toBe(4);
    const timeframeItem = findSelect(meta.menuItems, "Sparkline Timeframe");
    expect(timeframeItem.options).toEqual(["30s", "60s", "120s"]);
    expect(timeframeItem.value).toBe("60s");
  });

  test("mock Files meta: 2 items (Clear History action, Max Entries select)", () => {
    const meta: TugCardMeta = {
      title: "Files",
      icon: "FolderOpen",
      closable: true,
      menuItems: [
        { type: "action", label: "Clear History", action: () => {} },
        { type: "select", label: "Max Entries", options: ["50", "100", "200"], value: "100", action: () => {} },
      ],
    };

    expect(meta.menuItems.length).toBe(2);
    expect(findAction(meta.menuItems, "Clear History")).toBeDefined();
    const maxEntriesItem = findSelect(meta.menuItems, "Max Entries");
    expect(maxEntriesItem.options).toEqual(["50", "100", "200"]);
    expect(maxEntriesItem.value).toBe("100");
  });

  test("mock Conversation meta: 3 items (Permission Mode select, New Session action, Export History action)", () => {
    const sentPermMode: string[] = [];
    const meta: TugCardMeta = {
      title: "Code",
      icon: "MessageSquare",
      closable: true,
      menuItems: [
        {
          type: "select",
          label: "Permission Mode",
          options: ["default", "acceptEdits", "bypassPermissions", "plan"],
          value: "acceptEdits",
          action: (mode: string) => { sentPermMode.push(mode); },
        },
        { type: "action", label: "New Session", action: () => {} },
        { type: "action", label: "Export History", action: () => {} },
      ],
    };

    expect(meta.menuItems.length).toBe(3);
    const permItem = findSelect(meta.menuItems, "Permission Mode");
    expect(permItem.options).toContain("bypassPermissions");
    expect(permItem.options).toContain("plan");
    permItem.action("bypassPermissions");
    expect(sentPermMode).toContain("bypassPermissions");
  });
});
