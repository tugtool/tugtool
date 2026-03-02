/**
 * DeckCanvas — empty canvas shell for Phase 0.
 *
 * Renders only the DisconnectBanner. No panels, no dock, no overlays.
 * The canvas div with grid background is provided by #deck-container in
 * index.html and styled by globals.css. DeckCanvas renders inside it.
 *
 * Spec S03 (#s03-deckcanvas-shape), [D03] Keep disconnect banner
 */

import React, { forwardRef, useImperativeHandle } from "react";
import type { TugConnection } from "@/connection";
import { DisconnectBanner } from "./disconnect-banner";

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
    return (
      <>
        <DisconnectBanner connection={connection} />
      </>
    );
  }
);
