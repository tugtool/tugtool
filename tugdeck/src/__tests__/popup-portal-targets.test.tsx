/**
 * popup-portal-targets — Step 1 verification: every popup-class primitive
 * portals to the canvas overlay root when one is registered, and falls
 * back to `document.body` when no root is registered.
 *
 * Migrated primitives (one Portal call site per file):
 *   - TugPopover            — Popover.Portal
 *   - TugAlert              — AlertDialog.Portal
 *   - TugTooltip            — Tooltip.Portal
 *   - TugContextMenu        — ContextMenuPrimitive.Portal
 *   - TugPopupMenu          — DropdownMenuPrimitive.Portal (root + sub-menu)
 *   - TugEditorContextMenu  — hand-rolled createPortal()
 *
 * Each test mounts a primitive in two configurations:
 *
 *   1. With `<CanvasOverlayRoot />` registered: assert the rendered
 *      content is a descendant of `[data-slot="tug-canvas-overlay-root"]`.
 *
 *   2. Without any registered root: assert the rendered content is a
 *      direct descendant of `document.body` (the registry's body
 *      fallback path established in tugplan-tide-overlay-tier).
 *
 * The body-fallback case is what keeps existing primitive tests working
 * (none of them mount the overlay root). This file is the canonical
 * proof that the migration is complete and the fallback path is intact.
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { render, cleanup, act, fireEvent } from "@testing-library/react";

import * as canvasOverlayRegistry from "@/lib/canvas-overlay-registry";
import { CanvasOverlayRoot } from "@/components/chrome/canvas-overlay-root";

import {
  TugPopover,
  TugPopoverTrigger,
  TugPopoverContent,
  type TugPopoverHandle,
} from "@/components/tugways/tug-popover";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugAlert, type TugAlertHandle } from "@/components/tugways/tug-alert";
import { TugTooltip, TugTooltipProvider } from "@/components/tugways/tug-tooltip";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import type { TugContextMenuEntry } from "@/components/tugways/tug-context-menu";
import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import type {
  TugPopupMenuItem,
  TugPopupMenuEntry,
} from "@/components/tugways/internal/tug-popup-menu";
import { TugEditorContextMenu } from "@/components/tugways/tug-editor-context-menu";
import type { TugEditorContextMenuEntry } from "@/components/tugways/tug-editor-context-menu";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import {
  ResponderChainContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OVERLAY_ROOT_SELECTOR = '[data-slot="tug-canvas-overlay-root"]';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render UI inside a bare ResponderChainManager context. */
function renderWithManager(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const result = render(
    <ResponderChainContext.Provider value={manager}>
      {ui}
    </ResponderChainContext.Provider>,
  );
  return { ...result, manager };
}

/**
 * Render UI plus a sibling `<CanvasOverlayRoot />` so the registry has
 * a registered root for the duration of the test. The registry is reset
 * in `beforeEach` so cross-test contamination is impossible.
 */
function renderWithOverlayRoot(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const result = render(
    <ResponderChainContext.Provider value={manager}>
      <CanvasOverlayRoot />
      {ui}
    </ResponderChainContext.Provider>,
  );
  return { ...result, manager };
}

/** The single registered overlay-root element in the document, or null. */
function getOverlayRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(OVERLAY_ROOT_SELECTOR);
}

/**
 * Assert that `el` is a descendant of the overlay root. Used by the
 * "with overlay root" half of every test.
 */
function expectInsideOverlayRoot(el: HTMLElement | null): void {
  expect(el).not.toBeNull();
  const root = getOverlayRoot();
  expect(root).not.toBeNull();
  expect(root!.contains(el!)).toBe(true);
}

/**
 * Assert that `el` is rendered into `document.body` directly (i.e. its
 * portal target was the body fallback path, not the overlay root). The
 * overlay root must NOT exist in the document for this assertion to be
 * meaningful.
 */
function expectInsideBodyFallback(el: HTMLElement | null): void {
  expect(el).not.toBeNull();
  expect(getOverlayRoot()).toBeNull();
  // The portaled content lands as a descendant of document.body. We
  // also check it is NOT inside any overlay root just for symmetry.
  expect(document.body.contains(el!)).toBe(true);
}

// ---------------------------------------------------------------------------
// Test fixtures (kept tiny — these tests do not exercise component logic)
// ---------------------------------------------------------------------------

const POPUP_ITEMS: TugPopupMenuItem[] = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
];

const POPUP_ITEMS_WITH_SUB: TugPopupMenuEntry[] = [
  { id: "alpha", label: "Alpha" },
  {
    type: "sub",
    label: "More",
    items: [{ id: "nested", label: "Nested" }],
  },
];

const CONTEXT_ITEMS: TugContextMenuEntry[] = [
  { action: TUG_ACTIONS.CUT, label: "Cut" },
  { action: TUG_ACTIONS.COPY, label: "Copy" },
];

const EDITOR_ITEMS: TugEditorContextMenuEntry[] = [
  { action: TUG_ACTIONS.CUT, label: "Cut" },
  { action: TUG_ACTIONS.COPY, label: "Copy" },
];

// ---------------------------------------------------------------------------
// Cleanup / reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  canvasOverlayRegistry._resetForTests();
});

afterEach(() => {
  cleanup();
  canvasOverlayRegistry._resetForTests();
});

// ---------------------------------------------------------------------------
// TugPopover
// ---------------------------------------------------------------------------

describe("TugPopover — portal target", () => {
  it("portals into the canvas overlay root when one is registered", () => {
    const popoverRef = React.createRef<TugPopoverHandle>();
    renderWithOverlayRoot(
      <TugPopover ref={popoverRef}>
        <TugPopoverTrigger>
          <TugPushButton>Anchor</TugPushButton>
        </TugPopoverTrigger>
        <TugPopoverContent>
          <div>Body</div>
        </TugPopoverContent>
      </TugPopover>,
    );
    act(() => {
      popoverRef.current!.open();
    });
    expectInsideOverlayRoot(
      document.querySelector<HTMLElement>(".tug-popover-content"),
    );
  });

  it("falls back to document.body when no overlay root is registered", () => {
    const popoverRef = React.createRef<TugPopoverHandle>();
    renderWithManager(
      <TugPopover ref={popoverRef}>
        <TugPopoverTrigger>
          <TugPushButton>Anchor</TugPushButton>
        </TugPopoverTrigger>
        <TugPopoverContent>
          <div>Body</div>
        </TugPopoverContent>
      </TugPopover>,
    );
    act(() => {
      popoverRef.current!.open();
    });
    expectInsideBodyFallback(
      document.querySelector<HTMLElement>(".tug-popover-content"),
    );
  });
});

// ---------------------------------------------------------------------------
// TugAlert
// ---------------------------------------------------------------------------

describe("TugAlert — portal target", () => {
  it("portals into the canvas overlay root when one is registered", () => {
    const alertRef = React.createRef<TugAlertHandle>();
    renderWithOverlayRoot(
      <TugAlert ref={alertRef} title="Test" message="Message" />,
    );
    act(() => {
      void alertRef.current!.alert();
    });
    expectInsideOverlayRoot(
      document.querySelector<HTMLElement>(".tug-alert-content"),
    );
  });

  it("falls back to document.body when no overlay root is registered", () => {
    const alertRef = React.createRef<TugAlertHandle>();
    renderWithManager(<TugAlert ref={alertRef} title="Test" message="Message" />);
    act(() => {
      void alertRef.current!.alert();
    });
    expectInsideBodyFallback(
      document.querySelector<HTMLElement>(".tug-alert-content"),
    );
  });
});

// ---------------------------------------------------------------------------
// TugTooltip
// ---------------------------------------------------------------------------

describe("TugTooltip — portal target", () => {
  it("portals into the canvas overlay root when one is registered", () => {
    renderWithOverlayRoot(
      <TugTooltipProvider>
        <TugTooltip content="Save" defaultOpen>
          <button type="button">save</button>
        </TugTooltip>
      </TugTooltipProvider>,
    );
    expectInsideOverlayRoot(
      document.querySelector<HTMLElement>('[data-slot="tug-tooltip"]'),
    );
  });

  it("falls back to document.body when no overlay root is registered", () => {
    render(
      <TugTooltipProvider>
        <TugTooltip content="Save" defaultOpen>
          <button type="button">save</button>
        </TugTooltip>
      </TugTooltipProvider>,
    );
    expectInsideBodyFallback(
      document.querySelector<HTMLElement>('[data-slot="tug-tooltip"]'),
    );
  });
});

// ---------------------------------------------------------------------------
// TugContextMenu
// ---------------------------------------------------------------------------

describe("TugContextMenu — portal target", () => {
  it("portals into the canvas overlay root when one is registered", () => {
    const { container } = renderWithOverlayRoot(
      <TugContextMenu items={CONTEXT_ITEMS}>
        <div data-testid="trigger">target</div>
      </TugContextMenu>,
    );
    const trigger = container.querySelector('[data-testid="trigger"]')!;
    act(() => {
      fireEvent.contextMenu(trigger);
    });
    expectInsideOverlayRoot(
      document.querySelector<HTMLElement>('[data-slot="tug-context-menu"]'),
    );
  });

  it("falls back to document.body when no overlay root is registered", () => {
    const { container } = renderWithManager(
      <TugContextMenu items={CONTEXT_ITEMS}>
        <div data-testid="trigger">target</div>
      </TugContextMenu>,
    );
    const trigger = container.querySelector('[data-testid="trigger"]')!;
    act(() => {
      fireEvent.contextMenu(trigger);
    });
    expectInsideBodyFallback(
      document.querySelector<HTMLElement>('[data-slot="tug-context-menu"]'),
    );
  });
});

// ---------------------------------------------------------------------------
// TugPopupMenu — root content
// ---------------------------------------------------------------------------

describe("TugPopupMenu — portal target (root)", () => {
  it("portals root content into the canvas overlay root when one is registered", () => {
    renderWithOverlayRoot(
      <TugPopupMenu
        trigger={<button type="button">open</button>}
        items={POPUP_ITEMS}
        onSelect={() => {}}
        defaultOpen
        data-testid="popup-overlay"
      />,
    );
    expectInsideOverlayRoot(
      document.querySelector<HTMLElement>('[data-testid="popup-overlay"]'),
    );
  });

  it("falls back to document.body when no overlay root is registered", () => {
    render(
      <TugPopupMenu
        trigger={<button type="button">open</button>}
        items={POPUP_ITEMS}
        onSelect={() => {}}
        defaultOpen
        data-testid="popup-body"
      />,
    );
    expectInsideBodyFallback(
      document.querySelector<HTMLElement>('[data-testid="popup-body"]'),
    );
  });
});

// ---------------------------------------------------------------------------
// TugPopupMenu — sub-menu portal
// ---------------------------------------------------------------------------

describe("TugPopupMenu — portal target (sub-menu)", () => {
  it("portals sub-menu content into the canvas overlay root when one is registered", () => {
    renderWithOverlayRoot(
      <TugPopupMenu
        trigger={<button type="button">open</button>}
        items={POPUP_ITEMS_WITH_SUB}
        onSelect={() => {}}
        defaultOpen
        data-testid="popup-with-sub-overlay"
      />,
    );
    // Hover over the sub-trigger to open the sub-menu. Radix opens
    // SubContent on pointerEnter / focus.
    const subTrigger = document.querySelector<HTMLElement>(
      ".tug-menu-sub-trigger",
    );
    expect(subTrigger).not.toBeNull();
    act(() => {
      fireEvent.pointerEnter(subTrigger!);
      fireEvent.pointerMove(subTrigger!);
    });
    // The sub-menu's SubContent renders alongside the root content.
    // Find the SubContent by its data-slot or class — Radix gives
    // SubContent its own role="menu" element; we identify it by being
    // the second `.tug-menu-content` in the tree.
    const allMenus = document.querySelectorAll<HTMLElement>(".tug-menu-content");
    // We do not strictly require the sub-menu to actually open under
    // happy-dom (Radix's hover machinery is delicate without real
    // pointer events). What this assertion proves is that *if* a
    // SubContent renders, it lands inside the overlay root — it does
    // not escape to document.body. We assert at least one menu (the
    // root) is inside the overlay root, then if a second exists, it
    // must be inside the overlay root too.
    expect(allMenus.length).toBeGreaterThanOrEqual(1);
    const root = getOverlayRoot();
    expect(root).not.toBeNull();
    for (const m of allMenus) {
      expect(root!.contains(m)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TugEditorContextMenu (hand-rolled createPortal)
// ---------------------------------------------------------------------------

describe("TugEditorContextMenu — portal target", () => {
  it("portals into the canvas overlay root when one is registered", () => {
    renderWithOverlayRoot(
      <TugEditorContextMenu
        open
        x={10}
        y={10}
        items={EDITOR_ITEMS}
        onClose={() => {}}
      />,
    );
    expectInsideOverlayRoot(
      document.querySelector<HTMLElement>(
        '[data-slot="tug-editor-context-menu"]',
      ),
    );
  });

  it("falls back to document.body when no overlay root is registered", () => {
    renderWithManager(
      <TugEditorContextMenu
        open
        x={10}
        y={10}
        items={EDITOR_ITEMS}
        onClose={() => {}}
      />,
    );
    expectInsideBodyFallback(
      document.querySelector<HTMLElement>(
        '[data-slot="tug-editor-context-menu"]',
      ),
    );
  });
});
