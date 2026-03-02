/**
 * ComponentGallery tests -- Phase 3 update.
 *
 * Phase 2 tests updated to render inside ResponderChainProvider + DeckCanvas
 * so the gallery's useResponder/useRequiredResponderChain hooks have the required
 * context. Phase 3 tests added for responder registration and focus management.
 *
 * Tests cover:
 * - ComponentGallery renders without errors
 * - Close button calls onClose callback
 * - Gallery registers as responder "component-gallery" on mount
 * - Gallery calls makeFirstResponder on mount
 * - Gallery unregisters on unmount, first responder auto-promotes to "deck-canvas"
 * - With gallery focused: canHandle("cyclePanel") returns true (walks up to DeckCanvas)
 * - Key pipeline dispatches work correctly when gallery is the first responder
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, afterEach } from "bun:test";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

import { ResponderChainProvider, useResponderChain } from "@/components/tugways/responder-chain-provider";
import { useResponder } from "@/components/tugways/use-responder";
import { ResponderChainManager } from "@/components/tugways/responder-chain";
import { ComponentGallery } from "@/components/tugways/component-gallery";

// Clean up mounted React trees after each test.
afterEach(() => {
  cleanup();
});

// ---- Helpers ----

/**
 * A lightweight stand-in for DeckCanvas that registers the "deck-canvas" responder
 * and wraps children in its ResponderScope. Used instead of real DeckCanvas to
 * avoid importing action-dispatch side effects and the full DeckCanvas component.
 */
function FakeDeckCanvas({ children }: { children?: React.ReactNode }) {
  const { ResponderScope } = useResponder({
    id: "deck-canvas",
    actions: {
      cyclePanel: () => {},
      resetLayout: () => {},
      showSettings: () => {},
      showComponentGallery: () => {},
    },
  });
  return <ResponderScope>{children}</ResponderScope>;
}

/**
 * Captures the ResponderChainManager from context into a ref for inspection.
 */
function ManagerCapture({
  managerRef,
}: {
  managerRef: React.MutableRefObject<ResponderChainManager | null>;
}) {
  const manager = useResponderChain();
  if (manager) managerRef.current = manager;
  return null;
}

/**
 * Full test wrapper: provider > manager capture > fake deck-canvas > gallery.
 */
function GalleryWrapper({
  onClose,
  managerRef,
}: {
  onClose: () => void;
  managerRef?: React.MutableRefObject<ResponderChainManager | null>;
}) {
  const ref = managerRef ?? { current: null };
  return (
    <ResponderChainProvider>
      <ManagerCapture managerRef={ref} />
      <FakeDeckCanvas>
        <ComponentGallery onClose={onClose} />
      </FakeDeckCanvas>
    </ResponderChainProvider>
  );
}

// ============================================================================
// Basic render (Phase 2 tests -- updated to use provider)
// ============================================================================

describe("ComponentGallery – basic render", () => {
  it("renders without errors", () => {
    const onClose = mock(() => {});
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryWrapper onClose={onClose} />));
    });
    const panel = container.querySelector(".cg-panel");
    expect(panel).not.toBeNull();
  });

  it("renders the title 'Component Gallery'", () => {
    const onClose = mock(() => {});
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryWrapper onClose={onClose} />));
    });
    const title = container.querySelector(".cg-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("Component Gallery");
  });
});

describe("ComponentGallery – close button", () => {
  it("calls onClose when close button is clicked", () => {
    const onClose = mock(() => {});
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryWrapper onClose={onClose} />));
    });
    const closeBtn = container.querySelector("button[aria-label='Close Component Gallery']");
    expect(closeBtn).not.toBeNull();
    act(() => { fireEvent.click(closeBtn!); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Phase 3: Responder registration
// ============================================================================

describe("ComponentGallery – responder registration", () => {
  it("registers as responder 'component-gallery' on mount", () => {
    const managerRef = { current: null as ResponderChainManager | null };
    const onClose = mock(() => {});

    act(() => {
      render(<GalleryWrapper onClose={onClose} managerRef={managerRef} />);
    });

    expect(managerRef.current).not.toBeNull();
    // Gallery is registered -- its parent (deck-canvas) handles cyclePanel,
    // so canHandle from gallery's position returns true.
    expect(managerRef.current!.getFirstResponder()).toBe("component-gallery");
  });

  it("calls makeFirstResponder on mount -- gallery becomes first responder", () => {
    const managerRef = { current: null as ResponderChainManager | null };
    const onClose = mock(() => {});

    act(() => {
      render(<GalleryWrapper onClose={onClose} managerRef={managerRef} />);
    });

    expect(managerRef.current!.getFirstResponder()).toBe("component-gallery");
  });

  it("unregisters on unmount, first responder auto-promotes to 'deck-canvas' (not null)", () => {
    const managerRef = { current: null as ResponderChainManager | null };
    const onClose = mock(() => {});

    // Use a toggling wrapper so we can unmount just the gallery
    function ToggleWrapper({ show }: { show: boolean }) {
      return (
        <ResponderChainProvider>
          <ManagerCapture managerRef={managerRef} />
          <FakeDeckCanvas>
            {show && <ComponentGallery onClose={onClose} />}
          </FakeDeckCanvas>
        </ResponderChainProvider>
      );
    }

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<ToggleWrapper show={true} />));
    });

    expect(managerRef.current!.getFirstResponder()).toBe("component-gallery");

    act(() => {
      rerender(<ToggleWrapper show={false} />);
    });

    // Auto-promotion: parentId = "deck-canvas" becomes first responder
    expect(managerRef.current!.getFirstResponder()).toBe("deck-canvas");
  });
});

// ============================================================================
// Phase 3: Chain walk with gallery focused
// ============================================================================

describe("ComponentGallery – chain walk when focused", () => {
  it("canHandle('cyclePanel') returns true when gallery is first responder (walks up to DeckCanvas)", () => {
    const managerRef = { current: null as ResponderChainManager | null };
    const onClose = mock(() => {});

    act(() => {
      render(<GalleryWrapper onClose={onClose} managerRef={managerRef} />);
    });

    // Gallery is first responder; cyclePanel is in deck-canvas (parent) actions map.
    expect(managerRef.current!.getFirstResponder()).toBe("component-gallery");
    expect(managerRef.current!.canHandle("cyclePanel")).toBe(true);
  });
});

// ============================================================================
// Phase 3: Key pipeline with gallery as first responder
// ============================================================================

describe("ComponentGallery – key pipeline with gallery focused", () => {
  it("Ctrl+` dispatches cyclePanel through chain when gallery is first responder", () => {
    let cyclePanelCalled = false;

    function TestWrapper() {
      const { ResponderScope } = useResponder({
        id: "deck-canvas",
        actions: {
          cyclePanel: () => { cyclePanelCalled = true; },
          resetLayout: () => {},
          showSettings: () => {},
          showComponentGallery: () => {},
        },
      });
      return (
        <ResponderScope>
          <ComponentGallery onClose={() => {}} />
        </ResponderScope>
      );
    }

    act(() => {
      render(
        <ResponderChainProvider>
          <TestWrapper />
        </ResponderChainProvider>
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        code: "Backquote",
        key: "Backquote",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(cyclePanelCalled).toBe(true);
  });
});
