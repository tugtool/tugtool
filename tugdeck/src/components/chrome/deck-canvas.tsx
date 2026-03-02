/**
 * DeckCanvas — canvas shell with Component Gallery support (Phase 2).
 *
 * Renders DisconnectBanner and optionally the ComponentGallery panel.
 * Gallery visibility is driven by the show-component-gallery action via
 * action-dispatch -- registerGallerySetter connects React state to the
 * module-level gallerySetterRef.
 *
 * The canvas div with grid background is provided by #deck-container in
 * index.html and styled by globals.css. DeckCanvas renders inside it.
 *
 * Spec S03 (#s03-deckcanvas-shape), [D03] Keep disconnect banner
 * Spec S04 (#s04-gallery-panel), Spec S05 (#s05-gallery-action)
 */

import React, { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import type { TugConnection } from "@/connection";
import { registerGallerySetter } from "@/action-dispatch";
import { DisconnectBanner } from "./disconnect-banner";
import { ComponentGallery } from "@/components/tugways/component-gallery";

// ---- DeckCanvasHandle ----

export interface DeckCanvasHandle {
  // Minimal empty handle -- imperative methods added in Phase 5
}

// ---- DeckCanvasProps ----

export interface DeckCanvasProps {
  connection: TugConnection | null;
}

// ---- DeckCanvas ----

export const DeckCanvas = forwardRef<DeckCanvasHandle, DeckCanvasProps>(
  function DeckCanvas({ connection }, ref) {
    useImperativeHandle(ref, () => ({}), []);

    // Gallery visibility state -- toggled by show-component-gallery action
    const [galleryVisible, setGalleryVisible] = useState<boolean>(false);

    // Register the gallery setter with action-dispatch on mount so the
    // show-component-gallery action handler can toggle this state.
    useEffect(() => {
      registerGallerySetter(setGalleryVisible);
    }, []);

    return (
      <>
        <DisconnectBanner connection={connection} />
        {galleryVisible && (
          <ComponentGallery onClose={() => setGalleryVisible(false)} />
        )}
      </>
    );
  }
);
