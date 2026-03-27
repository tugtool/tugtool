/**
 * Gallery card tests -- Step 6 rewrite (updated for eight gallery sections in Phase 5d4).
 * Phase 8: twenty gallery tabs.
 *
 * Phase 5b3: The ComponentGallery floating panel is replaced by registered
 * card types in the "developer" family. This file tests the new gallery card
 * system defined in gallery-card.tsx.
 *
 * Tests cover:
 * - registerGalleryCards() registers all gallery componentIds in the card registry
 * - Each of the content components renders without errors
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
import { registerGalleryCards, GalleryDropdown } from "@/components/tugways/cards/gallery-registrations";
import { GalleryPushButton } from "@/components/tugways/cards/gallery-push-button";
import { GalleryChainActions } from "@/components/tugways/cards/gallery-chain-actions";
import { GalleryMutation } from "@/components/tugways/cards/gallery-mutation";
import { GalleryTabBar } from "@/components/tugways/cards/gallery-tab-bar";
import { GalleryDefaultButton } from "@/components/tugways/cards/gallery-default-button";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";

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
      cycleCard: (_event: ActionEvent) => {},
      showComponentGallery: (_event: ActionEvent) => {},
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

  it("registers all gallery componentIds", () => {
    registerGalleryCards();

    expect(getRegistration("gallery-buttons")).not.toBeNull();
    expect(getRegistration("gallery-chain-actions")).not.toBeNull();
    expect(getRegistration("gallery-mutation")).not.toBeNull();
    expect(getRegistration("gallery-tabbar")).not.toBeNull();
    expect(getRegistration("gallery-dropdown")).not.toBeNull();
    expect(getRegistration("gallery-default-button")).not.toBeNull();
    expect(getRegistration("gallery-mutation-tx")).not.toBeNull();
    expect(getRegistration("gallery-observable-props")).not.toBeNull();
    expect(getRegistration("gallery-palette")).not.toBeNull();
    expect(getRegistration("gallery-scale-timing")).not.toBeNull();
    expect(getRegistration("gallery-cascade-inspector")).not.toBeNull();
    expect(getRegistration("gallery-title-bar")).not.toBeNull();
  });

  it("gallery-buttons has family 'developer'", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg?.family).toBe("developer");
  });

  it("gallery-buttons has defaultTabs with twenty-three tabs", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg?.defaultTabs).toBeDefined();
    expect(reg?.defaultTabs?.length).toBe(23);
  });

  it("gallery-buttons has defaultTitle 'Component Gallery'", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg?.defaultTitle).toBe("Component Gallery");
  });

  it("all twenty gallery registrations have family 'developer'", () => {
    registerGalleryCards();
    const ids = ["gallery-buttons", "gallery-chain-actions", "gallery-mutation", "gallery-tabbar", "gallery-dropdown", "gallery-default-button", "gallery-mutation-tx", "gallery-observable-props", "gallery-palette", "gallery-scale-timing", "gallery-cascade-inspector", "gallery-animator", "gallery-skeleton", "gallery-title-bar", "gallery-theme-generator"];
    for (const id of ids) {
      expect(getRegistration(id)?.family).toBe("developer");
    }
  });

  it("all twenty gallery registrations have acceptsFamilies ['developer']", () => {
    registerGalleryCards();
    const ids = ["gallery-buttons", "gallery-chain-actions", "gallery-mutation", "gallery-tabbar", "gallery-dropdown", "gallery-default-button", "gallery-mutation-tx", "gallery-observable-props", "gallery-palette", "gallery-scale-timing", "gallery-cascade-inspector", "gallery-animator", "gallery-skeleton", "gallery-title-bar", "gallery-theme-generator"];
    for (const id of ids) {
      expect(getRegistration(id)?.acceptsFamilies).toEqual(["developer"]);
    }
  });
});

// ============================================================================
// Content components -- render without errors
// ============================================================================

describe("GalleryPushButton – renders without errors", () => {
  it("renders the gallery-buttons content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <GalleryPushButton />
        </ResponderChainProvider>
      ));
    });
    expect(container.querySelector("[data-testid='gallery-buttons']")).not.toBeNull();
  });
});

describe("GalleryChainActions – renders without errors", () => {
  it("renders the gallery-chain-actions content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <FakeDeckCanvas>
            <GalleryChainActions />
          </FakeDeckCanvas>
        </ResponderChainProvider>
      ));
    });
    expect(container.querySelector("[data-testid='gallery-chain-actions']")).not.toBeNull();
  });
});

describe("GalleryMutation – renders without errors", () => {
  it("renders the gallery-mutation content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryMutation />));
    });
    expect(container.querySelector("[data-testid='gallery-mutation']")).not.toBeNull();
  });
});

describe("GalleryTabBar – renders without errors", () => {
  it("renders the gallery-tabbar content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryTabBar />));
    });
    expect(container.querySelector("[data-testid='gallery-tabbar']")).not.toBeNull();
  });
});

describe("GalleryDropdown – renders without errors", () => {
  it("renders the gallery-dropdown content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryDropdown />));
    });
    expect(container.querySelector("[data-testid='gallery-popup-button']")).not.toBeNull();
  });
});

describe("GalleryDefaultButton – renders without errors", () => {
  it("renders the gallery-default-button content", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <GalleryDefaultButton />
        </ResponderChainProvider>
      ));
    });
    expect(container.querySelector("[data-testid='gallery-default-button']")).not.toBeNull();
  });
});

// ============================================================================
// Responder chain walk: chain-action buttons dispatch through DeckCanvas
// ============================================================================

describe("GalleryChainActions – chain-action button dispatches to DeckCanvas", () => {
  it("'Cycle Card' button is visible and enabled when DeckCanvas responder is in the chain", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <ResponderChainProvider>
          <FakeDeckCanvas>
            <GalleryChainActions />
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

  it("clicking 'Cycle Card' dispatches cycleCard through the responder chain", () => {
    let cycleCardCalled = false;

    function TestWrapper() {
      const { ResponderScope } = useResponder({
        id: "deck-canvas",
        actions: {
          cycleCard: (_event: ActionEvent) => { cycleCardCalled = true; },
          showComponentGallery: (_event: ActionEvent) => {},
        },
      });
      return (
        <ResponderScope>
          <GalleryChainActions />
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
            <GalleryChainActions />
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
