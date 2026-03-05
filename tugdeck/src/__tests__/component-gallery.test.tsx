/**
 * Gallery card tests -- Step 6 rewrite (updated for six gallery sections in Phase 5d1).
 *
 * Phase 5b3: The ComponentGallery floating panel is replaced by six registered
 * card types in the "developer" family. This file tests the new gallery card
 * system defined in gallery-card.tsx.
 *
 * Tests cover:
 * - registerGalleryCards() registers all six gallery componentIds in the
 *   card registry
 * - Each of the six content components renders without errors
 * - Responder chain walk: gallery card rendered as Tugcard, chain-action
 *   buttons dispatch through the responder chain to DeckCanvas
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { _resetForTest, getRegistration } from "@/card-registry";
import {
  registerGalleryCards,
  GalleryButtonsContent,
  GalleryChainActionsContent,
  GalleryMutationContent,
  GalleryTabBarContent,
  GalleryDropdownContent,
  GalleryDefaultButtonContent,
} from "@/components/tugways/cards/gallery-card";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { useResponder } from "@/components/tugways/use-responder";

// Clean up mounted React trees after each test.
afterEach(() => {
  cleanup();
});

// ---- Helpers ----

/**
 * A lightweight stand-in for DeckCanvas that registers the "deck-canvas"
 * responder and wraps children in its ResponderScope.
 */
function FakeDeckCanvas({ children }: { children?: React.ReactNode }) {
  const { ResponderScope } = useResponder({
    id: "deck-canvas",
    actions: {
      cycleCard: () => {},
      showComponentGallery: () => {},
    },
  });
  return <ResponderScope>{children}</ResponderScope>;
}

// ============================================================================
// registerGalleryCards() -- registry integration
// ============================================================================

describe("registerGalleryCards – card registry integration", () => {
  beforeEach(() => {
    _resetForTest();
  });
  afterEach(() => {
    _resetForTest();
  });

  it("registers all six gallery componentIds", () => {
    registerGalleryCards();

    expect(getRegistration("gallery-buttons")).not.toBeNull();
    expect(getRegistration("gallery-chain-actions")).not.toBeNull();
    expect(getRegistration("gallery-mutation")).not.toBeNull();
    expect(getRegistration("gallery-tabbar")).not.toBeNull();
    expect(getRegistration("gallery-dropdown")).not.toBeNull();
    expect(getRegistration("gallery-default-button")).not.toBeNull();
  });

  it("gallery-buttons has family 'developer'", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg?.family).toBe("developer");
  });

  it("gallery-buttons has defaultTabs with six tabs", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg?.defaultTabs).toBeDefined();
    expect(reg?.defaultTabs?.length).toBe(6);
  });

  it("gallery-buttons has defaultTitle 'Component Gallery'", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg?.defaultTitle).toBe("Component Gallery");
  });

  it("all six gallery registrations have family 'developer'", () => {
    registerGalleryCards();
    const ids = ["gallery-buttons", "gallery-chain-actions", "gallery-mutation", "gallery-tabbar", "gallery-dropdown", "gallery-default-button"];
    for (const id of ids) {
      expect(getRegistration(id)?.family).toBe("developer");
    }
  });

  it("all six gallery registrations have acceptsFamilies ['developer']", () => {
    registerGalleryCards();
    const ids = ["gallery-buttons", "gallery-chain-actions", "gallery-mutation", "gallery-tabbar", "gallery-dropdown", "gallery-default-button"];
    for (const id of ids) {
      expect(getRegistration(id)?.acceptsFamilies).toEqual(["developer"]);
    }
  });
});

// ============================================================================
// Content components -- render without errors
// ============================================================================

describe("GalleryButtonsContent – renders without errors", () => {
  it("renders the gallery-buttons content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <GalleryButtonsContent />
        </ResponderChainProvider>
      ));
    });
    expect(container.querySelector("[data-testid='gallery-buttons-content']")).not.toBeNull();
  });
});

describe("GalleryChainActionsContent – renders without errors", () => {
  it("renders the gallery-chain-actions content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <FakeDeckCanvas>
            <GalleryChainActionsContent />
          </FakeDeckCanvas>
        </ResponderChainProvider>
      ));
    });
    expect(container.querySelector("[data-testid='gallery-chain-actions-content']")).not.toBeNull();
  });
});

describe("GalleryMutationContent – renders without errors", () => {
  it("renders the gallery-mutation content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryMutationContent />));
    });
    expect(container.querySelector("[data-testid='gallery-mutation-content']")).not.toBeNull();
  });
});

describe("GalleryTabBarContent – renders without errors", () => {
  it("renders the gallery-tabbar content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryTabBarContent />));
    });
    expect(container.querySelector("[data-testid='gallery-tabbar-content']")).not.toBeNull();
  });
});

describe("GalleryDropdownContent – renders without errors", () => {
  it("renders the gallery-dropdown content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryDropdownContent />));
    });
    expect(container.querySelector("[data-testid='gallery-dropdown-content']")).not.toBeNull();
  });
});

describe("GalleryDefaultButtonContent – renders without errors", () => {
  it("renders the gallery-default-button content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <GalleryDefaultButtonContent />
        </ResponderChainProvider>
      ));
    });
    expect(container.querySelector("[data-testid='gallery-default-button-content']")).not.toBeNull();
  });
});

// ============================================================================
// Responder chain walk: chain-action buttons dispatch through DeckCanvas
// ============================================================================

describe("GalleryChainActionsContent – chain-action button dispatches to DeckCanvas", () => {
  it("'Cycle Card' button is visible and enabled when DeckCanvas responder is in the chain", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <FakeDeckCanvas>
            <GalleryChainActionsContent />
          </FakeDeckCanvas>
        </ResponderChainProvider>
      ));
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const cycleCardBtn = buttons.find((b) => b.textContent?.includes("Cycle Card"));
    expect(cycleCardBtn).not.toBeUndefined();
    expect(cycleCardBtn!.getAttribute("aria-disabled")).toBeNull();
    expect(cycleCardBtn!.disabled).toBe(false);
  });

  it("'nonexistentAction' button is hidden (TugButton returns null for unhandled action)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <FakeDeckCanvas>
            <GalleryChainActionsContent />
          </FakeDeckCanvas>
        </ResponderChainProvider>
      ));
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const hiddenBtn = buttons.find((b) =>
      b.textContent?.includes("Hidden") || b.textContent?.includes("nonexistentAction")
    );
    expect(hiddenBtn).toBeUndefined();
  });

  it("clicking 'Cycle Card' dispatches cycleCard through the responder chain", () => {
    let cycleCardCalled = false;

    function TestWrapper() {
      const { ResponderScope } = useResponder({
        id: "deck-canvas",
        actions: {
          cycleCard: () => { cycleCardCalled = true; },
          showComponentGallery: () => {},
        },
      });
      return (
        <ResponderScope>
          <GalleryChainActionsContent />
        </ResponderScope>
      );
    }

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <TestWrapper />
        </ResponderChainProvider>
      ));
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const cycleCardBtn = buttons.find((b) => b.textContent?.includes("Cycle Card"));
    expect(cycleCardBtn).not.toBeUndefined();

    act(() => {
      cycleCardBtn!.click();
    });

    expect(cycleCardCalled).toBe(true);
  });

  it("'Show Gallery' button label is 'Show Gallery' not 'Toggle Gallery' ([D07])", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <FakeDeckCanvas>
            <GalleryChainActionsContent />
          </FakeDeckCanvas>
        </ResponderChainProvider>
      ));
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const showGalleryBtn = buttons.find((b) => b.textContent?.includes("Show Gallery"));
    expect(showGalleryBtn).not.toBeUndefined();

    // Ensure "Toggle Gallery" label is NOT present
    const toggleGalleryBtn = buttons.find((b) => b.textContent?.trim() === "Toggle Gallery");
    expect(toggleGalleryBtn).toBeUndefined();
  });
});

// Suppress unused import warning
void mock;
