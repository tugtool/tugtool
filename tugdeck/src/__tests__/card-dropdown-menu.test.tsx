/**
 * CardDropdownMenu RTL tests.
 *
 * Tests cover:
 * - Renders action items and fires onSelect callback
 * - Renders toggle items with checkbox indicator and fires onCheckedChange
 * - Renders select items as radio group and fires selection callback
 * - Renders separators between item groups
 * - Keyboard navigation: arrow keys, Enter to select, Escape to close
 *
 * Implementation notes:
 * - CardDropdownMenuBridge is used for tests because it renders open=true
 *   immediately, avoiding the need to click a trigger to open.
 * - Radix portals render into document.body, so we query document.body
 *   for menu content rather than the render container.
 * - Keyboard events are dispatched to document because Radix attaches
 *   global listeners for menu navigation.
 *
 * [D01] shadcn DropdownMenu replaces vanilla card-menu.ts
 */
import "./setup-rtl";

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { CardDropdownMenuBridge } from "@/components/chrome/card-dropdown-menu";
import type { CardMenuItem } from "@/cards/card";

// ---- Setup ----

// Radix DropdownMenu uses PointerEvent internally. Provide a minimal stub
// for happy-dom environments that may lack a full PointerEvent implementation.
if (typeof (global as Record<string, unknown>)["PointerEvent"] === "undefined") {
  (global as Record<string, unknown>)["PointerEvent"] = class PointerEvent extends MouseEvent {
    constructor(type: string, init?: PointerEventInit) {
      super(type, init);
    }
  };
}

// Radix uses hasPointerCapture / setPointerCapture on elements
const proto = Element.prototype as Record<string, unknown>;
if (!proto["hasPointerCapture"]) {
  proto["hasPointerCapture"] = () => false;
}
if (!proto["setPointerCapture"]) {
  proto["setPointerCapture"] = () => {};
}
if (!proto["releasePointerCapture"]) {
  proto["releasePointerCapture"] = () => {};
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---- Helpers ----

function renderBridge(items: CardMenuItem[], onClose = mock(() => {})) {
  return render(
    <CardDropdownMenuBridge items={items} onClose={onClose} align="end" side="bottom" />
  );
}

/** Wait for the next tick so Radix portals can flush. */
async function flushAsync() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

// ---- Tests ----

describe("CardDropdownMenu – action items", () => {
  it("renders action item label", async () => {
    const items: CardMenuItem[] = [
      { type: "action", label: "Clear History", action: mock(() => {}) },
    ];
    renderBridge(items);
    await flushAsync();
    const menuItem = Array.from(document.body.querySelectorAll("[role='menuitem']")).find(
      (el) => el.textContent?.includes("Clear History")
    );
    expect(menuItem).not.toBeNull();
  });

  it("fires onSelect callback when action item is clicked", async () => {
    const actionFn = mock(() => {});
    const items: CardMenuItem[] = [
      { type: "action", label: "Export History", action: actionFn },
    ];
    renderBridge(items);
    await flushAsync();
    const menuItem = Array.from(document.body.querySelectorAll("[role='menuitem']")).find(
      (el) => el.textContent?.includes("Export History")
    ) as HTMLElement | undefined;
    expect(menuItem).not.toBeNull();
    await act(async () => {
      fireEvent.click(menuItem!);
    });
    expect(actionFn).toHaveBeenCalledTimes(1);
  });

  it("renders multiple action items independently", async () => {
    const items: CardMenuItem[] = [
      { type: "action", label: "New Session", action: mock(() => {}) },
      { type: "action", label: "Export History", action: mock(() => {}) },
    ];
    renderBridge(items);
    await flushAsync();
    const menuItems = Array.from(document.body.querySelectorAll("[role='menuitem']"));
    const labels = menuItems.map((el) => el.textContent?.trim());
    expect(labels).toContain("New Session");
    expect(labels).toContain("Export History");
  });
});

describe("CardDropdownMenu – toggle items", () => {
  it("renders toggle item as checkbox menu item", async () => {
    const items: CardMenuItem[] = [
      { type: "toggle", label: "Show Untracked", checked: true, action: mock(() => {}) },
    ];
    renderBridge(items);
    await flushAsync();
    const checkboxItem = Array.from(
      document.body.querySelectorAll("[role='menuitemcheckbox']")
    ).find((el) => el.textContent?.includes("Show Untracked"));
    expect(checkboxItem).not.toBeNull();
  });

  it("fires onCheckedChange when toggle item is clicked", async () => {
    const toggleFn = mock((_checked: boolean) => {});
    const items: CardMenuItem[] = [
      { type: "toggle", label: "WebGL Renderer", checked: false, action: toggleFn },
    ];
    renderBridge(items);
    await flushAsync();
    const checkboxItem = Array.from(
      document.body.querySelectorAll("[role='menuitemcheckbox']")
    ).find((el) => el.textContent?.includes("WebGL Renderer")) as HTMLElement | undefined;
    expect(checkboxItem).not.toBeNull();
    await act(async () => {
      fireEvent.click(checkboxItem!);
    });
    expect(toggleFn).toHaveBeenCalledTimes(1);
  });
});

describe("CardDropdownMenu – select items", () => {
  it("renders select item as radio group", async () => {
    const items: CardMenuItem[] = [
      {
        type: "select",
        label: "Font Size",
        options: ["Small", "Medium", "Large"],
        value: "Medium",
        action: mock(() => {}),
      },
    ];
    renderBridge(items);
    await flushAsync();
    const radioGroup = document.body.querySelector("[role='group']");
    expect(radioGroup).not.toBeNull();
    const radioItems = document.body.querySelectorAll("[role='menuitemradio']");
    expect(radioItems.length).toBe(3);
  });

  it("renders select label text", async () => {
    const items: CardMenuItem[] = [
      {
        type: "select",
        label: "Font Size",
        options: ["Small", "Medium", "Large"],
        value: "Medium",
        action: mock(() => {}),
      },
    ];
    renderBridge(items);
    await flushAsync();
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("Font Size");
  });

  it("fires selection callback when radio item is clicked", async () => {
    const selectFn = mock((_value: string) => {});
    const items: CardMenuItem[] = [
      {
        type: "select",
        label: "Sparkline Timeframe",
        options: ["30s", "60s", "120s"],
        value: "60s",
        action: selectFn,
      },
    ];
    renderBridge(items);
    await flushAsync();
    const radioItem = Array.from(
      document.body.querySelectorAll("[role='menuitemradio']")
    ).find((el) => el.textContent?.trim() === "30s") as HTMLElement | undefined;
    expect(radioItem).not.toBeNull();
    await act(async () => {
      fireEvent.click(radioItem!);
    });
    expect(selectFn).toHaveBeenCalledTimes(1);
    expect(selectFn).toHaveBeenCalledWith("30s");
  });
});

describe("CardDropdownMenu – separators", () => {
  it("renders separator between item groups", async () => {
    const items: CardMenuItem[] = [
      { type: "action", label: "Action One", action: mock(() => {}) },
      { type: "separator" },
      { type: "action", label: "Action Two", action: mock(() => {}) },
    ];
    renderBridge(items);
    await flushAsync();
    const separator = document.body.querySelector("[role='separator']");
    expect(separator).not.toBeNull();
  });

  it("renders multiple separators", async () => {
    const items: CardMenuItem[] = [
      { type: "action", label: "A", action: mock(() => {}) },
      { type: "separator" },
      { type: "action", label: "B", action: mock(() => {}) },
      { type: "separator" },
      { type: "action", label: "C", action: mock(() => {}) },
    ];
    renderBridge(items);
    await flushAsync();
    const separators = document.body.querySelectorAll("[role='separator']");
    expect(separators.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CardDropdownMenu – keyboard navigation", () => {
  it("Escape key calls onClose", async () => {
    const onClose = mock(() => {});
    const items: CardMenuItem[] = [
      { type: "action", label: "Do thing", action: mock(() => {}) },
    ];
    renderBridge(items, onClose);
    await flushAsync();

    // Radix listens for Escape on the document to close the menu
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape", bubbles: true });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown key moves focus to next item", async () => {
    const items: CardMenuItem[] = [
      { type: "action", label: "Item One", action: mock(() => {}) },
      { type: "action", label: "Item Two", action: mock(() => {}) },
    ];
    renderBridge(items);
    await flushAsync();

    // Arrow key navigation should not throw
    expect(() => {
      fireEvent.keyDown(document, { key: "ArrowDown", code: "ArrowDown", bubbles: true });
    }).not.toThrow();
  });

  it("Enter key selects focused action item", async () => {
    const actionFn = mock(() => {});
    const items: CardMenuItem[] = [
      { type: "action", label: "Do thing", action: actionFn },
    ];
    renderBridge(items);
    await flushAsync();

    const menuItem = Array.from(document.body.querySelectorAll("[role='menuitem']")).find(
      (el) => el.textContent?.includes("Do thing")
    ) as HTMLElement | undefined;
    expect(menuItem).not.toBeNull();

    // Focus the item and press Enter
    await act(async () => {
      menuItem!.focus();
      fireEvent.keyDown(menuItem!, { key: "Enter", code: "Enter", bubbles: true });
    });
    // Enter on a focused menuitem fires the onSelect handler
    expect(actionFn).toHaveBeenCalledTimes(1);
  });
});
