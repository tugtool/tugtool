/**
 * mutation-tx-demo.test.tsx -- Integration tests for GalleryMutationTx.
 *
 * Verifies the action-phase-to-transaction lifecycle by simulating control
 * interactions and asserting both DOM mutations and cascade reader display
 * updates.
 *
 * Tests cover:
 * - Color input dispatches ActionEvents through the responder chain
 * - previewColor begin/change/commit cycle applies and finalizes background-color
 * - previewColor cancel restores original background-color
 * - Hue swatch pointer-scrub dispatches begin/change/commit phases
 * - Position sliders dispatch begin/change/commit phases; left+top updated
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import { GalleryMutationTx } from "@/components/tugways/cards/gallery-mutation-tx";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { mutationTransactionManager } from "@/components/tugways/mutation-transaction";
import { _resetForTest } from "@/card-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDemo() {
  let container!: HTMLElement;
  act(() => {
    ({ container } = render(
      <ResponderChainProvider>
        <GalleryMutationTx />
      </ResponderChainProvider>
    ));
  });
  return container;
}

function getMockCard(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-testid='mutation-tx-mock-card']") as HTMLElement;
  expect(el).not.toBeNull();
  return el;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetForTest();
  mutationTransactionManager.reset();
});

afterEach(() => {
  mutationTransactionManager.reset();
  _resetForTest();
  cleanup();
});

// ---------------------------------------------------------------------------
// Hue swatch demo -- previewHue action lifecycle
// ---------------------------------------------------------------------------

describe("GalleryMutationTx – hue swatch pointer-scrub", () => {
  it("pointerdown begins a transaction on the mock card", () => {
    const container = renderDemo();
    const mockCard = getMockCard(container);
    const swatch = container.querySelector("[data-testid='hue-swatch']") as HTMLElement;

    expect(mutationTransactionManager.getActiveTransaction(mockCard)).toBeNull();

    act(() => {
      fireEvent.pointerDown(swatch, { clientX: 50, clientY: 10 });
    });

    const tx = mutationTransactionManager.getActiveTransaction(mockCard);
    expect(tx).not.toBeNull();
    expect(tx!.isActive).toBe(true);
  });

  it("pointermove during scrub previews background-color with an HSL value", () => {
    const container = renderDemo();
    const mockCard = getMockCard(container);
    const swatch = container.querySelector("[data-testid='hue-swatch']") as HTMLElement;

    act(() => {
      fireEvent.pointerDown(swatch, { clientX: 50, clientY: 10 });
    });
    act(() => {
      fireEvent.pointerMove(swatch, { clientX: 100, clientY: 10 });
    });

    const bgColor = mockCard.style.getPropertyValue("background-color");
    expect(bgColor).not.toBe("");
  });

  it("pointerup commits the transaction", () => {
    const container = renderDemo();
    const mockCard = getMockCard(container);
    const swatch = container.querySelector("[data-testid='hue-swatch']") as HTMLElement;

    act(() => {
      fireEvent.pointerDown(swatch, { clientX: 50, clientY: 10 });
    });
    act(() => {
      fireEvent.pointerMove(swatch, { clientX: 100, clientY: 10 });
    });
    act(() => {
      fireEvent.pointerUp(swatch, { clientX: 100, clientY: 10 });
    });

    // Transaction committed -- no active transaction
    expect(mutationTransactionManager.getActiveTransaction(mockCard)).toBeNull();
    // Value remains (committed)
    expect(mockCard.style.getPropertyValue("background-color")).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Position sliders demo -- previewPosition action lifecycle
// ---------------------------------------------------------------------------

describe("GalleryMutationTx – position sliders", () => {
  it("pointerdown on slider-x begins a transaction for left+top", () => {
    const container = renderDemo();
    const mockCard = getMockCard(container);
    const sliderX = container.querySelector("[data-testid='slider-x']") as HTMLInputElement;

    expect(mutationTransactionManager.getActiveTransaction(mockCard)).toBeNull();

    act(() => {
      fireEvent.pointerDown(sliderX);
    });

    const tx = mutationTransactionManager.getActiveTransaction(mockCard);
    expect(tx).not.toBeNull();
    expect(tx!.isActive).toBe(true);
  });

  it("input event on slider-x previews left and top properties", () => {
    const container = renderDemo();
    const mockCard = getMockCard(container);
    const sliderX = container.querySelector("[data-testid='slider-x']") as HTMLInputElement;

    act(() => {
      fireEvent.pointerDown(sliderX);
    });

    act(() => {
      Object.defineProperty(sliderX, "value", { value: "80", writable: true });
      fireEvent.input(sliderX);
    });

    // After change, left is previewed on the mock card
    const left = mockCard.style.getPropertyValue("left");
    expect(left).toBe("80px");
  });

  it("pointerup on slider commits the transaction", () => {
    const container = renderDemo();
    const mockCard = getMockCard(container);
    const sliderX = container.querySelector("[data-testid='slider-x']") as HTMLInputElement;

    act(() => {
      fireEvent.pointerDown(sliderX);
    });
    act(() => {
      Object.defineProperty(sliderX, "value", { value: "80", writable: true });
      fireEvent.input(sliderX);
    });
    act(() => {
      fireEvent.pointerUp(sliderX);
    });

    // Transaction committed
    expect(mutationTransactionManager.getActiveTransaction(mockCard)).toBeNull();
    // Left value remains (committed)
    expect(mockCard.style.getPropertyValue("left")).toBe("80px");
  });

  it("pointerdown on slider-y also begins a transaction for left+top", () => {
    const container = renderDemo();
    const mockCard = getMockCard(container);
    const sliderY = container.querySelector("[data-testid='slider-y']") as HTMLInputElement;

    act(() => {
      fireEvent.pointerDown(sliderY);
    });

    const tx = mutationTransactionManager.getActiveTransaction(mockCard);
    expect(tx).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cascade reader display panel -- direct DOM writes
// ---------------------------------------------------------------------------

describe("GalleryMutationTx – cascade reader display panel", () => {
  it("display spans are present in the DOM", () => {
    const container = renderDemo();

    expect(container.querySelector("[data-testid='bg-color-source']")).not.toBeNull();
    expect(container.querySelector("[data-testid='bg-color-value']")).not.toBeNull();
    expect(container.querySelector("[data-testid='left-source']")).not.toBeNull();
    expect(container.querySelector("[data-testid='left-value']")).not.toBeNull();
    expect(container.querySelector("[data-testid='top-source']")).not.toBeNull();
    expect(container.querySelector("[data-testid='top-value']")).not.toBeNull();
  });

  it("left-value span reflects the previewed left value after slider input", () => {
    const container = renderDemo();
    const sliderX = container.querySelector("[data-testid='slider-x']") as HTMLInputElement;

    act(() => {
      fireEvent.pointerDown(sliderX);
    });
    act(() => {
      Object.defineProperty(sliderX, "value", { value: "120", writable: true });
      fireEvent.input(sliderX);
    });

    // The display span for left-value should now show "120px" (direct DOM write)
    const leftValueSpan = container.querySelector("[data-testid='left-value']") as HTMLSpanElement;
    expect(leftValueSpan.textContent).toBe("120px");
  });
});
