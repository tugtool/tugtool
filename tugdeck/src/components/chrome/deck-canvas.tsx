/**
 * DeckCanvas -- canvas shell with Component Gallery and responder chain support.
 *
 * Phase 2: Renders DisconnectBanner and optionally the ComponentGallery panel.
 *          Gallery visibility driven by show-component-gallery action via
 *          action-dispatch -- registerGallerySetter connects React state to
 *          the module-level gallerySetterRef.
 *
 * Phase 3: Registers as root responder "deck-canvas" via useResponder.
 *          Handles canvas-level actions: cyclePanel, resetLayout, showSettings,
 *          showComponentGallery. DeckCanvas auto-becomes the first responder when
 *          it registers as a root node (parentId null, per Spec S01 auto-first-
 *          responder behavior), so Ctrl+` works immediately after mount with no
 *          explicit makeFirstResponder call.
 *
 *          The existing show-component-gallery action-dispatch handler (for Mac
 *          menu control frames) remains operational alongside the new responder
 *          chain action -- both converge on the same setGalleryVisible state setter.
 *
 * Hook order (Phase 3, rules-of-hooks compliant):
 *   useState(galleryVisible) -> useResponder -> useImperativeHandle -> useEffect
 *
 * The canvas div with grid background is provided by #deck-container in
 * index.html and styled by globals.css. DeckCanvas renders inside it.
 *
 * Spec S03 (#s03-deckcanvas-shape), [D03] Keep disconnect banner
 * Spec S04 (#s04-gallery-panel), Spec S05 (#s05-gallery-action)
 * [D07] ResponderChainProvider wraps DeckCanvas only
 * Table T01: cyclePanel, resetLayout, showSettings, showComponentGallery
 */

import React, { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import type { TugConnection } from "@/connection";
import { registerGallerySetter } from "@/action-dispatch";
import { useResponder } from "@/components/tugways/use-responder";
import { DisconnectBanner } from "./disconnect-banner";
import { ComponentGallery } from "@/components/tugways/component-gallery";

// ---- DeckCanvasHandle ----

export interface DeckCanvasHandle {
  // Minimal empty handle -- imperative methods added in Phase 5
}

// ---- DeckCanvasProps ----

/**
 * DeckCanvasProps for Phase 5 (Spec S06).
 *
 * New props are optional with sensible defaults so existing test call sites
 * that pass only `connection={null}` continue to work unchanged.
 */
export interface DeckCanvasProps {
  connection: TugConnection | null;
  /** Cards to render. Default: empty cards array. Wired by DeckManager in Phase 5. */
  deckState?: import("@/layout-tree").DeckState;
  /** Called on card drag-end / resize-end. Default: no-op. */
  onCardMoved?: (
    id: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;
  /** Called when a card's close action fires. Default: no-op. */
  onCardClosed?: (id: string) => void;
  /** Called on pointer-down in a card frame to bring it to front. Default: no-op. */
  onCardFocused?: (id: string) => void;
}

// ---- DeckCanvas ----

export const DeckCanvas = forwardRef<DeckCanvasHandle, DeckCanvasProps>(
  function DeckCanvas({ connection }, ref) {
    // Hook order (Phase 3): useState -> useResponder -> useImperativeHandle -> useEffect

    // Gallery visibility state -- toggled by show-component-gallery action via
    // action-dispatch (Mac menu) and by the showComponentGallery responder action.
    const [galleryVisible, setGalleryVisible] = useState<boolean>(false);

    // Register DeckCanvas as the root responder node.
    // Action handlers close over setGalleryVisible (stable React setter identity).
    // DeckCanvas auto-becomes first responder on mount because parentId is null
    // and no first responder is set yet (Spec S01 auto-first-responder rule).
    const { ResponderScope } = useResponder({
      id: "deck-canvas",
      actions: {
        cyclePanel: () => {
          // Phase 3 stub: no real panels to cycle yet. Log for observability.
          // Phase 5 will replace this with focusNextCard/focusPreviousCard.
          console.log("cyclePanel: stub -- no panels in Phase 3");
        },
        resetLayout: () => {
          // Phase 5 will reset card positions.
          console.log("resetLayout: stub -- not implemented until Phase 5");
        },
        showSettings: () => {
          // Phase 8 will open the settings panel.
          console.log("showSettings: stub -- not implemented until Phase 8");
        },
        showComponentGallery: () => {
          setGalleryVisible((prev) => !prev);
        },
      },
    });

    useImperativeHandle(ref, () => ({}), []);

    // Register the gallery setter with action-dispatch on mount so the
    // show-component-gallery Mac menu control frame handler can toggle this state.
    // This path remains operational alongside the responder chain action.
    useEffect(() => {
      registerGallerySetter(setGalleryVisible);
    }, []);

    return (
      <ResponderScope>
        <DisconnectBanner connection={connection} />
        {galleryVisible && (
          <ComponentGallery onClose={() => setGalleryVisible(false)} />
        )}
      </ResponderScope>
    );
  }
);
