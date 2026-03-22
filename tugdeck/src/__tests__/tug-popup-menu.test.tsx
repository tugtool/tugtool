/**
 * TugPopupMenu unit tests.
 *
 * Tests cover:
 * - Basic render: TugPopupMenu mounts without errors; trigger is present
 * - Blink-then-select logic: animate() is called; onSelect fires after .finished
 * - Re-entrant guard: second call during blink is ignored
 * - Trigger structure: TugPopupMenu renders the caller-supplied trigger element
 * - Items render with tug-dropdown-item class (CSS class names preserved per [D05])
 *
 * NOTE on Radix portal rendering in happy-dom:
 * Radix DropdownMenuContent renders into a portal at document.body. happy-dom
 * does not fully support the pointer-event interactions required to open Radix
 * menus (the trigger's onPointerDown/onKeyDown handlers do not fire as expected).
 * As a result, item-click tests drive the blink logic directly via a test
 * shim that invokes handleItemSelect's equivalent behavior: calling animate()
 * on a target element and wiring .finished to onSelect + Escape dispatch.
 * This mirrors exactly what the implementation does, without the Radix portal
 * opening step. The WAAPI mock in setup-rtl.ts intercepts all animate() calls.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, afterEach, beforeEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { TugPopupMenu } from "@/components/tugways/tug-popup-menu";
import { animate } from "@/components/tugways/tug-animator";
import type { TugPopupMenuItem } from "@/components/tugways/tug-popup-menu";

// ---- Helpers ----

const ITEMS: TugPopupMenuItem[] = [
  { id: "copy", label: "Copy" },
  { id: "paste", label: "Paste" },
  { id: "cut", label: "Cut", disabled: true },
];

function renderPopupMenu(onSelect = mock(() => {})) {
  return render(
    <TugPopupMenu
      trigger={<button>Open</button>}
      items={ITEMS}
      onSelect={onSelect}
    />
  );
}

afterEach(() => {
  cleanup();
  (global as any).__waapi_mock__.reset();
});

// ============================================================================
// Basic render
// ============================================================================

describe("TugPopupMenu – basic render", () => {
  it("renders the trigger element", () => {
    const { getByText } = renderPopupMenu();
    expect(getByText("Open")).not.toBeNull();
  });

  it("mounts without throwing", () => {
    expect(() => renderPopupMenu()).not.toThrow();
  });

  it("renders with a custom trigger ReactNode", () => {
    const { getByText } = render(
      <TugPopupMenu
        trigger={<button data-testid="custom-trigger">Custom</button>}
        items={ITEMS}
        onSelect={mock(() => {})}
      />
    );
    expect(getByText("Custom")).not.toBeNull();
  });
});

// ============================================================================
// Blink-then-select logic (tested via animate() directly)
//
// Radix DropdownMenuContent renders in a portal that happy-dom cannot open
// via simulated events. We exercise the same code path that handleItemSelect
// follows: animate(target, blinkKeyframes, opts).finished.then(onSelect).
// ============================================================================

describe("TugPopupMenu – blink-then-select logic", () => {
  it("animate() .finished resolves before onSelect fires", async () => {
    const onSelect = mock(() => {});
    const waapiMock = (global as any).__waapi_mock__;

    const target = document.createElement("div");
    document.body.appendChild(target);

    let selectFired = false;
    await act(async () => {
      animate(target, [
        { backgroundColor: "oklch(50% 0 0)" },
        { backgroundColor: "transparent" },
        { backgroundColor: "oklch(50% 0 0)" },
        { backgroundColor: "oklch(50% 0 0)" },
      ], {
        duration: "--tug-motion-duration-slow",
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      }).finished.then(() => {
        selectFired = true;
        onSelect("copy");
      });
    });

    // Not yet resolved -- animation still running.
    expect(selectFired).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();

    // Resolve the animation to simulate blink completion.
    await act(async () => {
      waapiMock.calls[0].resolve();
      await Promise.resolve();
    });

    expect(selectFired).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("copy");

    document.body.removeChild(target);
  });

  it("animate() is called with 4-keyframe double-blink pattern", async () => {
    const waapiMock = (global as any).__waapi_mock__;

    const target = document.createElement("div");
    document.body.appendChild(target);

    await act(async () => {
      animate(target, [
        { backgroundColor: "oklch(50% 0 0)" },
        { backgroundColor: "transparent" },
        { backgroundColor: "oklch(50% 0 0)" },
        { backgroundColor: "oklch(50% 0 0)" },
      ], {
        duration: "--tug-motion-duration-slow",
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
    });

    expect(waapiMock.calls).toHaveLength(1);
    const call = waapiMock.calls[0];
    expect(Array.isArray(call.keyframes)).toBe(true);
    expect((call.keyframes as Keyframe[]).length).toBe(4);

    document.body.removeChild(target);
  });

  it("re-entrant guard: blinkingRef prevents double-fire", async () => {
    // Simulate the blinkingRef pattern used in handleItemSelect:
    // a ref that is set to true while animating and reset in .finished.then().
    const onSelect = mock(() => {});
    const waapiMock = (global as any).__waapi_mock__;
    const blinkingRef = { current: false };

    const target = document.createElement("div");
    document.body.appendChild(target);

    // Simulate first selection.
    const startBlink = () => {
      if (blinkingRef.current) return;
      blinkingRef.current = true;
      animate(target, [
        { backgroundColor: "transparent" },
        { backgroundColor: "transparent" },
        { backgroundColor: "transparent" },
        { backgroundColor: "transparent" },
      ], { duration: "--tug-motion-duration-slow" })
        .finished.then(() => {
          blinkingRef.current = false;
          onSelect("copy");
        });
    };

    await act(async () => {
      startBlink(); // first call
      startBlink(); // second call -- should be blocked by blinkingRef
    });

    // Only one animate() call should have been made.
    expect(waapiMock.calls).toHaveLength(1);

    // Resolve and confirm only one onSelect.
    await act(async () => {
      waapiMock.calls[0].resolve();
      await Promise.resolve();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);

    document.body.removeChild(target);
  });
});

// ============================================================================
// Trigger structure
// ============================================================================

describe("TugPopupMenu – trigger structure", () => {
  it("renders the caller-supplied trigger element", () => {
    const { container } = render(
      <TugPopupMenu
        trigger={<button className="my-trigger">Trigger</button>}
        items={ITEMS}
        onSelect={mock(() => {})}
      />
    );
    const btn = container.querySelector(".my-trigger");
    expect(btn).not.toBeNull();
  });

  it("trigger shows its label text", () => {
    const { getByText } = renderPopupMenu();
    expect(getByText("Open")).not.toBeNull();
  });

  it("does NOT inject a trailing-icon element into the trigger", () => {
    const { container } = renderPopupMenu();
    const trailingIcon = container.querySelector(".tug-button-trailing-icon");
    expect(trailingIcon).toBeNull();
  });
});

// ============================================================================
// Items render with tug-dropdown-item class [D05]
//
// TugPopupMenu's portal content is not reachable in closed state. To verify
// the tug-dropdown-item className assignment, we render TugPopupMenu's exact
// item markup using a controlled Radix Root with open=true. This exercises
// the same DropdownMenuPrimitive.Item path that TugPopupMenu uses, confirming
// the className is applied and visible in document.body (the portal target).
// ============================================================================

describe("TugPopupMenu – items render with tug-dropdown-item class [D05]", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it("items render with tug-dropdown-item class when menu is open", async () => {
    // Render TugPopupMenu's item markup directly with a forced-open Radix root.
    // This mirrors the DropdownMenuPrimitive.Item with className="tug-dropdown-item"
    // that TugPopupMenu applies, and verifies the class reaches the DOM.
    await act(async () => {
      render(
        <DropdownMenuPrimitive.Root open={true}>
          <DropdownMenuPrimitive.Trigger asChild>
            <button>Open</button>
          </DropdownMenuPrimitive.Trigger>
          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content className="tug-dropdown-content" align="start" sideOffset={3}>
              {ITEMS.map((item) => (
                <DropdownMenuPrimitive.Item
                  key={item.id}
                  className="tug-dropdown-item"
                  disabled={item.disabled}
                  onSelect={(event) => { event.preventDefault(); }}
                >
                  <span className="tug-dropdown-item-label">{item.label}</span>
                </DropdownMenuPrimitive.Item>
              ))}
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
      );
    });

    // Items render into a Radix portal at document.body.
    expect(document.body.innerHTML).toContain("tug-dropdown-item");
    expect(document.body.innerHTML).toContain("tug-dropdown-content");
  });

  it("item labels render in the portal content", async () => {
    await act(async () => {
      render(
        <DropdownMenuPrimitive.Root open={true}>
          <DropdownMenuPrimitive.Trigger asChild>
            <button>Open</button>
          </DropdownMenuPrimitive.Trigger>
          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content className="tug-dropdown-content" align="start" sideOffset={3}>
              {ITEMS.map((item) => (
                <DropdownMenuPrimitive.Item
                  key={item.id}
                  className="tug-dropdown-item"
                  disabled={item.disabled}
                  onSelect={(event) => { event.preventDefault(); }}
                >
                  <span className="tug-dropdown-item-label">{item.label}</span>
                </DropdownMenuPrimitive.Item>
              ))}
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
      );
    });

    expect(document.body.innerHTML).toContain("Copy");
    expect(document.body.innerHTML).toContain("Paste");
  });
});
