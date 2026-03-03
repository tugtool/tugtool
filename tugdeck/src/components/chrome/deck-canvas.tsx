/**
 * DeckCanvas -- canvas shell with Component Gallery, responder chain support,
 * and CardFrame rendering from DeckState (Phase 5).
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
 * Phase 5 (Spec S06, Spec S07): Receives DeckState + stable callbacks from
 *          DeckManager via props. Maps deckState.cards to CardFrame components.
 *          For each card, looks up the registry to obtain the Tugcard factory.
 *          Cards with unregistered componentIds are skipped (warning logged).
 *          Z-index by array position: first card = lowest, last card = highest.
 *          Gallery renders above all cards (highest z-index).
 *          forwardRef / DeckCanvasHandle removed -- DeckManager drives via props.
 *
 * Hook order (Phase 3, rules-of-hooks compliant):
 *   useState(galleryVisible) -> useResponder -> useEffect
 *
 * The canvas div with grid background is provided by #deck-container in
 * index.html and styled by globals.css. DeckCanvas renders inside it.
 *
 * Spec S03 (#s03-deckcanvas-shape), [D03] Keep disconnect banner
 * Spec S04 (#s04-gallery-panel), Spec S05 (#s05-gallery-action)
 * Spec S06 (#deckcanvas-props), Spec S07 (#tugcard-visual-stack)
 * [D07] ResponderChainProvider wraps DeckCanvas only
 * Table T01: cyclePanel, resetLayout, showSettings, showComponentGallery
 */

import React, { useState, useEffect } from "react";
import type { TugConnection } from "@/connection";
import { registerGallerySetter } from "@/action-dispatch";
import { useResponder } from "@/components/tugways/use-responder";
import { DisconnectBanner } from "./disconnect-banner";
import { ComponentGallery } from "@/components/tugways/component-gallery";
import { CardFrame } from "./card-frame";
import { getRegistration } from "@/card-registry";
import type { DeckState } from "@/layout-tree";

// ---- DeckCanvasProps (Spec S06) ----

/**
 * DeckCanvasProps for Phase 5 (Spec S06).
 *
 * New props are optional with sensible defaults so existing test call sites
 * that pass only `connection={null}` continue to work unchanged.
 */
export interface DeckCanvasProps {
  connection: TugConnection | null;
  /** Cards to render. Default: empty cards array. Wired by DeckManager in Phase 5. */
  deckState?: DeckState;
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

// ---- Gallery z-index base ----

/**
 * Z-index base for cards. Card at index i in deckState.cards gets
 * z-index CARD_ZINDEX_BASE + i. The gallery renders at GALLERY_ZINDEX
 * so it always floats above all cards.
 */
const CARD_ZINDEX_BASE = 1;
const GALLERY_ZINDEX = 1000;

// ---- DeckCanvas ----

/**
 * DeckCanvas -- plain function component (Phase 5 removes forwardRef).
 *
 * Renders the responder-chain root, the disconnect banner, the optional
 * component gallery, and one CardFrame per card in deckState.
 */
export function DeckCanvas({
  connection,
  deckState,
  onCardMoved,
  onCardClosed,
  onCardFocused,
}: DeckCanvasProps) {
  // Resolved defaults -- callers that omit new Phase 5 props get no-op behavior.
  const cards = deckState?.cards ?? [];
  const handleCardMoved = onCardMoved ?? (() => {});
  const handleCardClosed = onCardClosed ?? (() => {});
  const handleCardFocused = onCardFocused ?? (() => {});

  // Hook order (Phase 3): useState -> useResponder -> useEffect

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

  // Register the gallery setter with action-dispatch on mount so the
  // show-component-gallery Mac menu control frame handler can toggle this state.
  // This path remains operational alongside the responder chain action.
  useEffect(() => {
    registerGallerySetter(setGalleryVisible);
  }, []);

  return (
    <ResponderScope>
      <DisconnectBanner connection={connection} />

      {/* CardFrames (Spec S06, S07): one per card in deckState.cards.
          Z-index by array position (first = lowest). Cards with unregistered
          componentIds are skipped with a warning. */}
      {cards.map((cardState, index) => {
        const componentId = cardState.tabs[0]?.componentId;
        if (!componentId) {
          console.warn(
            `[DeckCanvas] card "${cardState.id}" has no tabs -- skipping render.`,
          );
          return null;
        }

        const registration = getRegistration(componentId);
        if (!registration) {
          console.warn(
            `[DeckCanvas] card "${cardState.id}" references unregistered componentId "${componentId}" -- skipping render.`,
          );
          return null;
        }

        return (
          <CardFrame
            key={cardState.id}
            cardState={cardState}
            zIndex={CARD_ZINDEX_BASE + index}
            onCardMoved={handleCardMoved}
            onCardClosed={handleCardClosed}
            onCardFocused={handleCardFocused}
            renderContent={(injected) => {
              // DeckCanvas is the only layer that knows onCardClosed(id), so it
              // injects onClose into the Tugcard element produced by the factory.
              // The factory's injected parameter (CardFrameInjectedProps) carries
              // only onDragStart and onMinSizeChange -- onClose is not part of it.
              const element = registration.factory(cardState.id, injected);
              return React.cloneElement(element, {
                onClose: () => handleCardClosed(cardState.id),
              });
            }}
          />
        );
      })}

      {/* Gallery renders above all cards (Spec S07 higher z-index) */}
      {galleryVisible && (
        <div style={{ position: "relative", zIndex: GALLERY_ZINDEX }}>
          <ComponentGallery onClose={() => setGalleryVisible(false)} />
        </div>
      )}
    </ResponderScope>
  );
}
