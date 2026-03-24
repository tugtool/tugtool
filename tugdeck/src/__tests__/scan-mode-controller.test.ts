/**
 * ScanModeController unit tests -- Step 2.
 *
 * Tests cover:
 * - activate() appends overlay and highlight to body; deactivate() removes them
 * - isActive reflects current state
 * - calling deactivate() when not active is a no-op
 * - Alt keydown toggles tug-scan-hover-suppressed class on #deck-container
 * - deactivate({ keepHighlight: true }) leaves highlightEl in DOM
 *
 * Note: Tests use happy-dom (preloaded via bunfig.toml). DOM globals are
 * available at module scope via setup-rtl.ts.
 *
 * happy-dom does not implement elementFromPoint (returns null). Tests that
 * exercise pointermove/click event paths are constrained to verifying
 * DOM-visible side effects (overlay presence, suppression class) and skip
 * assertions that depend on elementFromPoint returning a non-null element.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ScanModeController } from "@/components/tugways/scan-mode-controller";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a #deck-container div and append it to document.body for tests. */
function createDeckContainer(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "deck-container";
  document.body.appendChild(el);
  return el;
}

/** Remove a #deck-container previously created by createDeckContainer(). */
function removeDeckContainer(): void {
  const el = document.getElementById("deck-container");
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

// ---------------------------------------------------------------------------
// ScanModeController -- activate / deactivate lifecycle
// ---------------------------------------------------------------------------

describe("ScanModeController -- activate / deactivate lifecycle", () => {
  let ctrl: ScanModeController;

  beforeEach(() => {
    ctrl = new ScanModeController();
  });

  afterEach(() => {
    // Ensure any leftover DOM is cleaned up even if a test fails mid-way
    if (ctrl.isActive) {
      ctrl.deactivate();
    }
    if (ctrl.overlayEl.parentNode) {
      ctrl.overlayEl.parentNode.removeChild(ctrl.overlayEl);
    }
    if (ctrl.highlightEl.parentNode) {
      ctrl.highlightEl.parentNode.removeChild(ctrl.highlightEl);
    }
  });

  it("is inactive before activate() is called", () => {
    expect(ctrl.isActive).toBe(false);
  });

  it("activate() appends overlayEl to document.body", () => {
    expect(document.body.contains(ctrl.overlayEl)).toBe(false);
    ctrl.activate(() => {});
    expect(document.body.contains(ctrl.overlayEl)).toBe(true);
  });

  it("activate() appends highlightEl to document.body", () => {
    expect(document.body.contains(ctrl.highlightEl)).toBe(false);
    ctrl.activate(() => {});
    expect(document.body.contains(ctrl.highlightEl)).toBe(true);
  });

  it("isActive is true after activate()", () => {
    ctrl.activate(() => {});
    expect(ctrl.isActive).toBe(true);
  });

  it("deactivate() removes overlayEl from document.body", () => {
    ctrl.activate(() => {});
    expect(document.body.contains(ctrl.overlayEl)).toBe(true);
    ctrl.deactivate();
    expect(document.body.contains(ctrl.overlayEl)).toBe(false);
  });

  it("deactivate() removes highlightEl from document.body", () => {
    ctrl.activate(() => {});
    expect(document.body.contains(ctrl.highlightEl)).toBe(true);
    ctrl.deactivate();
    expect(document.body.contains(ctrl.highlightEl)).toBe(false);
  });

  it("isActive is false after deactivate()", () => {
    ctrl.activate(() => {});
    ctrl.deactivate();
    expect(ctrl.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ScanModeController -- isActive reflects current state
// ---------------------------------------------------------------------------

describe("ScanModeController -- isActive reflects state transitions", () => {
  let ctrl: ScanModeController;

  beforeEach(() => {
    ctrl = new ScanModeController();
  });

  afterEach(() => {
    if (ctrl.isActive) {
      ctrl.deactivate();
    }
  });

  it("isActive starts false", () => {
    expect(ctrl.isActive).toBe(false);
  });

  it("isActive is true after activate, false after deactivate", () => {
    ctrl.activate(() => {});
    expect(ctrl.isActive).toBe(true);
    ctrl.deactivate();
    expect(ctrl.isActive).toBe(false);
  });

  it("second activate() while active is a no-op (overlay only added once)", () => {
    ctrl.activate(() => {});
    const firstOverlay = ctrl.overlayEl;
    ctrl.activate(() => {}); // should be ignored
    expect(ctrl.isActive).toBe(true);
    // Overlay element is the same object -- not re-appended
    const countInBody = Array.from(document.body.children).filter(
      (el) => el === firstOverlay
    ).length;
    expect(countInBody).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ScanModeController -- deactivate when not active is a no-op
// ---------------------------------------------------------------------------

describe("ScanModeController -- deactivate when not active", () => {
  it("deactivate() when not active does not throw and leaves isActive false", () => {
    const ctrl = new ScanModeController();
    expect(ctrl.isActive).toBe(false);
    // Must not throw
    ctrl.deactivate();
    expect(ctrl.isActive).toBe(false);
  });

  it("deactivate() does not append anything to body when called without activate", () => {
    const ctrl = new ScanModeController();
    const bodyChildrenBefore = document.body.childElementCount;
    ctrl.deactivate();
    // Body should not have gained any elements
    expect(document.body.childElementCount).toBe(bodyChildrenBefore);
  });
});

// ---------------------------------------------------------------------------
// ScanModeController -- Alt key toggles suppression class
// ---------------------------------------------------------------------------

describe("ScanModeController -- Alt key toggles hover suppression", () => {
  let ctrl: ScanModeController;
  let deckContainer: HTMLDivElement;

  beforeEach(() => {
    ctrl = new ScanModeController();
    deckContainer = createDeckContainer();
    ctrl.activate(() => {});
  });

  afterEach(() => {
    if (ctrl.isActive) {
      ctrl.deactivate();
    }
    removeDeckContainer();
  });

  it("Alt keydown adds tug-scan-hover-suppressed to #deck-container", () => {
    expect(deckContainer.classList.contains("tug-scan-hover-suppressed")).toBe(false);

    const altDown = new KeyboardEvent("keydown", { key: "Alt", bubbles: true });
    document.dispatchEvent(altDown);

    expect(deckContainer.classList.contains("tug-scan-hover-suppressed")).toBe(true);
  });

  it("Alt keyup removes tug-scan-hover-suppressed from #deck-container", () => {
    // Add the class first via keydown
    const altDown = new KeyboardEvent("keydown", { key: "Alt", bubbles: true });
    document.dispatchEvent(altDown);
    expect(deckContainer.classList.contains("tug-scan-hover-suppressed")).toBe(true);

    // Now keyup should remove it
    const altUp = new KeyboardEvent("keyup", { key: "Alt", bubbles: true });
    document.dispatchEvent(altUp);
    expect(deckContainer.classList.contains("tug-scan-hover-suppressed")).toBe(false);
  });

  it("deactivate() removes tug-scan-hover-suppressed if it was active", () => {
    const altDown = new KeyboardEvent("keydown", { key: "Alt", bubbles: true });
    document.dispatchEvent(altDown);
    expect(deckContainer.classList.contains("tug-scan-hover-suppressed")).toBe(true);

    ctrl.deactivate();
    expect(deckContainer.classList.contains("tug-scan-hover-suppressed")).toBe(false);
  });

  it("non-Alt keydown does not toggle suppression class", () => {
    const otherKey = new KeyboardEvent("keydown", { key: "Shift", bubbles: true });
    document.dispatchEvent(otherKey);
    expect(deckContainer.classList.contains("tug-scan-hover-suppressed")).toBe(false);
  });

  it("Escape keydown deactivates scan mode", () => {
    expect(ctrl.isActive).toBe(true);
    const escKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(escKey);
    expect(ctrl.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ScanModeController -- suppression class absent when #deck-container missing
// ---------------------------------------------------------------------------

describe("ScanModeController -- suppression graceful without deck-container", () => {
  it("Alt keydown does not throw when #deck-container is not in the DOM", () => {
    const ctrl = new ScanModeController();
    ctrl.activate(() => {});

    // No #deck-container in the DOM -- should not throw
    const altDown = new KeyboardEvent("keydown", { key: "Alt", bubbles: true });
    expect(() => document.dispatchEvent(altDown)).not.toThrow();

    ctrl.deactivate();
  });
});

// ---------------------------------------------------------------------------
// ScanModeController -- Cmd+Click passthrough
// ---------------------------------------------------------------------------

describe("ScanModeController -- Cmd+Click passthrough", () => {
  let ctrl: ScanModeController;

  beforeEach(() => {
    ctrl = new ScanModeController();
  });

  afterEach(() => {
    if (ctrl.isActive) {
      ctrl.deactivate();
    }
    if (ctrl.overlayEl.parentNode) {
      ctrl.overlayEl.parentNode.removeChild(ctrl.overlayEl);
    }
    if (ctrl.highlightEl.parentNode) {
      ctrl.highlightEl.parentNode.removeChild(ctrl.highlightEl);
    }
  });

  it("Cmd+Click (metaKey) sets overlay pointer-events to none and does not deactivate", () => {
    const onSelect = (_el: HTMLElement) => {};
    ctrl.activate(onSelect);

    // Verify overlay is active with pointer-events: auto initially
    expect(ctrl.isActive).toBe(true);

    // Dispatch a click with metaKey = true on the overlay
    const clickEvent = new MouseEvent("click", { bubbles: true, metaKey: true, clientX: 100, clientY: 100 });
    ctrl.overlayEl.dispatchEvent(clickEvent);

    // Cmd+Click should NOT deactivate scan mode
    expect(ctrl.isActive).toBe(true);

    // Overlay pointer-events should be none immediately after the metaKey click
    expect(ctrl.overlayEl.style.pointerEvents).toBe("none");
  });

  it("normal click (no metaKey) on overlay does not prevent deactivation path", () => {
    // This tests that the normal click path still runs (though elementFromPoint
    // returns null in happy-dom, so the callback won't be invoked). The important
    // thing is the metaKey guard doesn't interfere.
    let selected = false;
    ctrl.activate((_el: HTMLElement) => { selected = true; });

    const clickEvent = new MouseEvent("click", { bubbles: true, metaKey: false, clientX: 50, clientY: 50 });
    ctrl.overlayEl.dispatchEvent(clickEvent);

    // In happy-dom, elementFromPoint returns null, so deactivate is NOT called
    // and the callback is NOT invoked. The scan remains active.
    // This verifies the normal path is reachable without errors.
    expect(selected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ScanModeController -- keepHighlight option
// ---------------------------------------------------------------------------

describe("ScanModeController -- deactivate({ keepHighlight: true })", () => {
  let ctrl: ScanModeController;

  beforeEach(() => {
    ctrl = new ScanModeController();
  });

  afterEach(() => {
    if (ctrl.isActive) {
      ctrl.deactivate();
    }
    // Clean up highlight if it's still in the DOM (for keepHighlight tests)
    if (ctrl.highlightEl.parentNode) {
      ctrl.highlightEl.parentNode.removeChild(ctrl.highlightEl);
    }
  });

  it("deactivate({ keepHighlight: true }) removes overlayEl from DOM", () => {
    ctrl.activate(() => {});
    expect(document.body.contains(ctrl.overlayEl)).toBe(true);
    ctrl.deactivate({ keepHighlight: true });
    expect(document.body.contains(ctrl.overlayEl)).toBe(false);
  });

  it("deactivate({ keepHighlight: true }) leaves highlightEl in DOM", () => {
    ctrl.activate(() => {});
    expect(document.body.contains(ctrl.highlightEl)).toBe(true);
    ctrl.deactivate({ keepHighlight: true });
    // highlightEl should remain in the DOM
    expect(document.body.contains(ctrl.highlightEl)).toBe(true);
  });

  it("deactivate({ keepHighlight: true }) sets isActive to false", () => {
    ctrl.activate(() => {});
    ctrl.deactivate({ keepHighlight: true });
    expect(ctrl.isActive).toBe(false);
  });

  it("default deactivate() removes highlightEl (no options = keepHighlight false)", () => {
    ctrl.activate(() => {});
    ctrl.deactivate();
    expect(document.body.contains(ctrl.highlightEl)).toBe(false);
  });

  it("deactivate({ keepHighlight: false }) removes highlightEl", () => {
    ctrl.activate(() => {});
    ctrl.deactivate({ keepHighlight: false });
    expect(document.body.contains(ctrl.highlightEl)).toBe(false);
  });
});
