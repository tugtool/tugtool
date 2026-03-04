/**
 * Gallery card tests -- Step 5.
 *
 * Tests cover:
 * - registerGalleryCards() registers all five gallery componentIds
 * - Each of the five content components renders without errors
 * - GALLERY_DEFAULT_TABS has five entries with correct componentIds and titles
 * - addCard("gallery-buttons") creates a five-tab card with title "Component Gallery"
 *   and acceptsFamilies: ["developer"]
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import {
  registerGalleryCards,
  GALLERY_DEFAULT_TABS,
  GalleryButtonsContent,
  GalleryChainActionsContent,
  GalleryMutationContent,
  GalleryTabBarContent,
  GalleryDropdownContent,
} from "@/components/tugways/cards/gallery-card";
import { getRegistration, _resetForTest } from "@/card-registry";
import { DeckManager } from "@/deck-manager";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockConnection() {
  return {
    onDisconnectState: () => () => {},
    onOpen: () => () => {},
    onFrame: () => () => {},
    sendControlFrame: () => {},
  };
}

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe("registerGalleryCards – registry entries", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("registers all five gallery componentIds", () => {
    registerGalleryCards();

    expect(getRegistration("gallery-buttons")).toBeDefined();
    expect(getRegistration("gallery-chain-actions")).toBeDefined();
    expect(getRegistration("gallery-mutation")).toBeDefined();
    expect(getRegistration("gallery-tabbar")).toBeDefined();
    expect(getRegistration("gallery-dropdown")).toBeDefined();
  });

  it("each registration has family: 'developer'", () => {
    registerGalleryCards();

    const ids = [
      "gallery-buttons",
      "gallery-chain-actions",
      "gallery-mutation",
      "gallery-tabbar",
      "gallery-dropdown",
    ];
    for (const id of ids) {
      const reg = getRegistration(id);
      expect(reg).toBeDefined();
      expect(reg!.family).toBe("developer");
    }
  });

  it("each registration has acceptsFamilies: ['developer']", () => {
    registerGalleryCards();

    const ids = [
      "gallery-buttons",
      "gallery-chain-actions",
      "gallery-mutation",
      "gallery-tabbar",
      "gallery-dropdown",
    ];
    for (const id of ids) {
      const reg = getRegistration(id);
      expect(reg!.acceptsFamilies).toEqual(["developer"]);
    }
  });

  it("gallery-buttons has defaultTabs with five entries", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg!.defaultTabs).toBeDefined();
    expect(reg!.defaultTabs!.length).toBe(5);
  });

  it("gallery-buttons has defaultTitle: 'Component Gallery'", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg!.defaultTitle).toBe("Component Gallery");
  });

  it("other four gallery registrations do NOT have defaultTabs or defaultTitle", () => {
    registerGalleryCards();
    const others = [
      "gallery-chain-actions",
      "gallery-mutation",
      "gallery-tabbar",
      "gallery-dropdown",
    ];
    for (const id of others) {
      const reg = getRegistration(id);
      expect(reg!.defaultTabs).toBeUndefined();
      expect(reg!.defaultTitle).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// GALLERY_DEFAULT_TABS
// ---------------------------------------------------------------------------

describe("GALLERY_DEFAULT_TABS", () => {
  it("has five entries", () => {
    expect(GALLERY_DEFAULT_TABS.length).toBe(5);
  });

  it("entries have the correct componentIds", () => {
    const componentIds = GALLERY_DEFAULT_TABS.map((t) => t.componentId);
    expect(componentIds).toContain("gallery-buttons");
    expect(componentIds).toContain("gallery-chain-actions");
    expect(componentIds).toContain("gallery-mutation");
    expect(componentIds).toContain("gallery-tabbar");
    expect(componentIds).toContain("gallery-dropdown");
  });

  it("entries have the correct titles", () => {
    const titles = GALLERY_DEFAULT_TABS.map((t) => t.title);
    expect(titles).toContain("TugButton");
    expect(titles).toContain("Chain Actions");
    expect(titles).toContain("Mutation Model");
    expect(titles).toContain("TugTabBar");
    expect(titles).toContain("TugDropdown");
  });

  it("all entries are closable", () => {
    for (const tab of GALLERY_DEFAULT_TABS) {
      expect(tab.closable).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// addCard("gallery-buttons") integration
// ---------------------------------------------------------------------------

describe("DeckManager.addCard('gallery-buttons') creates five-tab gallery card", () => {
  let manager: DeckManager;

  beforeEach(() => {
    _resetForTest();
    registerGalleryCards();
    const container = document.createElement("div");
    manager = new DeckManager(container, makeMockConnection() as never);
  });

  afterEach(() => {
    _resetForTest();
    cleanup();
  });

  it("creates a card with five tabs, each with a distinct componentId", () => {
    const cardId = manager.addCard("gallery-buttons");
    expect(cardId).not.toBeNull();

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card).toBeDefined();
    expect(card.tabs.length).toBe(5);

    const componentIds = card.tabs.map((t) => t.componentId);
    expect(componentIds).toContain("gallery-buttons");
    expect(componentIds).toContain("gallery-chain-actions");
    expect(componentIds).toContain("gallery-mutation");
    expect(componentIds).toContain("gallery-tabbar");
    expect(componentIds).toContain("gallery-dropdown");
  });

  it("card.title is 'Component Gallery'", () => {
    const cardId = manager.addCard("gallery-buttons")!;
    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.title).toBe("Component Gallery");
  });

  it("card.acceptsFamilies is ['developer']", () => {
    const cardId = manager.addCard("gallery-buttons")!;
    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.acceptsFamilies).toEqual(["developer"]);
  });

  it("tab IDs are fresh UUIDs (not the template placeholder)", () => {
    const cardId = manager.addCard("gallery-buttons")!;
    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    for (const tab of card.tabs) {
      expect(tab.id).not.toBe("template");
      expect(tab.id.length).toBeGreaterThan(0);
    }
    // All tab IDs must be unique
    const ids = card.tabs.map((t) => t.id);
    expect(new Set(ids).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Content component render tests
// ---------------------------------------------------------------------------

describe("GalleryButtonsContent – renders without errors", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(
          <ResponderChainProvider>
            <GalleryButtonsContent />
          </ResponderChainProvider>
        ));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-buttons-content']")).not.toBeNull();
  });
});

describe("GalleryChainActionsContent – renders without errors", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(
          <ResponderChainProvider>
            <GalleryChainActionsContent />
          </ResponderChainProvider>
        ));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-chain-actions-content']")).not.toBeNull();
  });
});

describe("GalleryMutationContent – renders without errors", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<GalleryMutationContent />));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-mutation-content']")).not.toBeNull();
  });
});

describe("GalleryTabBarContent – renders without errors", () => {
  beforeEach(() => {
    _resetForTest();
    // TugTabBar calls getAllRegistrations for the type picker -- register a card
    // so the demo tab bar has a known componentId available.
    registerGalleryCards();
  });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<GalleryTabBarContent />));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-tabbar-content']")).not.toBeNull();
  });
});

describe("GalleryDropdownContent – renders without errors", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<GalleryDropdownContent />));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-dropdown-content']")).not.toBeNull();
  });
});
