/**
 * StyleInspectorContent card tests -- Step 3.
 *
 * Tests cover:
 * - registerStyleInspectorCard registers with componentId "style-inspector"
 * - StyleInspectorContent renders empty state when no element is selected
 * - StyleInspectorContent has a reticle button in its rendered output
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { StyleInspectorContent, registerStyleInspectorCard } from "@/components/tugways/cards/style-inspector-card";
import { getRegistration, _resetForTest } from "@/card-registry";

// Clean up mounted React trees after each test.
afterEach(() => {
  cleanup();
});

// ============================================================================
// T-SI-01: registerStyleInspectorCard registers with componentId "style-inspector"
// ============================================================================

describe("registerStyleInspectorCard -- T-SI-01: registers 'style-inspector' in card registry", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); });

  it("getRegistration('style-inspector') returns undefined before registration", () => {
    expect(getRegistration("style-inspector")).toBeUndefined();
  });

  it("getRegistration('style-inspector') returns a registration after registerStyleInspectorCard()", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg).not.toBeUndefined();
    expect(reg!.componentId).toBe("style-inspector");
  });

  it("registration has the correct defaultMeta title", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg!.defaultMeta.title).toBe("Style Inspector");
  });

  it("registration has closable: true", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg!.defaultMeta.closable).toBe(true);
  });

  it("registration has family 'developer'", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg!.family).toBe("developer");
  });

  it("registration accepts family 'developer'", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg!.acceptsFamilies).toContain("developer");
  });

  it("contentFactory returns StyleInspectorContent", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg).not.toBeUndefined();

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <>{reg!.contentFactory("card-si-test")}</>
      ));
    });

    const content = container.querySelector("[data-testid='style-inspector-content']");
    expect(content).not.toBeNull();
  });
});

// ============================================================================
// T-SI-02: StyleInspectorContent renders empty state when no element is selected
// ============================================================================

describe("StyleInspectorContent -- T-SI-02: renders empty state when no element selected", () => {
  it("renders the empty state element when no element has been inspected", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-1" />));
    });

    const emptyState = container.querySelector("[data-testid='style-inspector-empty-state']");
    expect(emptyState).not.toBeNull();
  });

  it("empty state contains instructional text", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-2" />));
    });

    const emptyState = container.querySelector("[data-testid='style-inspector-empty-state']");
    expect(emptyState).not.toBeNull();
    expect(emptyState!.textContent).toContain("Scan Element");
  });

  it("does not render token chain sections in empty state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-3" />));
    });

    // When no element is selected there should be no chain sections
    const chainSections = container.querySelectorAll(".tug-inspector-chain");
    expect(chainSections.length).toBe(0);
  });
});

// ============================================================================
// T-SI-03: Reticle button is present in rendered output
// ============================================================================

describe("StyleInspectorContent -- T-SI-03: reticle button is present", () => {
  it("renders a reticle button", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-4" />));
    });

    const reticleBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(reticleBtn).not.toBeNull();
  });

  it("reticle button is initially not in active state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-5" />));
    });

    const reticleBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(reticleBtn).not.toBeNull();
    expect(reticleBtn!.classList.contains("si-card-reticle-button--active")).toBe(false);
  });

  it("reticle button has aria-label attribute", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-6" />));
    });

    const reticleBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(reticleBtn).not.toBeNull();
    const ariaLabel = reticleBtn!.getAttribute("aria-label");
    expect(ariaLabel).not.toBeNull();
    expect(ariaLabel!.length).toBeGreaterThan(0);
  });

  it("renders the content wrapper", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-7" />));
    });

    const wrapper = container.querySelector("[data-testid='style-inspector-content']");
    expect(wrapper).not.toBeNull();
  });
});
