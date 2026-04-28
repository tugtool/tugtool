/**
 * gallery-text-edit.tsx — TugEdit gallery card.
 *
 * Demo surface for the CodeMirror 6-backed `TugEdit` substrate.
 * Mounts a single editor inside a sized host so reviewers can
 * exercise typing, motion, and undo/redo by hand. Card-level
 * controls for atoms, theme, completion, history, and the rest
 * of the prop surface are layered on as the substrate grows.
 *
 * Laws: [L01] one root.render() at mount, [L06] appearance via
 *        CSS and DOM, never React state, [L19] component authoring guide.
 */

import "./gallery-text-edit.css";

import React, { useRef } from "react";
import { TugEdit } from "@/components/tugways/tug-edit";
import type { TugEditDelegate } from "@/components/tugways/tug-edit";
import { TugLabel } from "@/components/tugways/tug-label";

export function GalleryTextEdit() {
  const editRef = useRef<TugEditDelegate>(null);

  return (
    <div className="cg-content" data-testid="gallery-text-edit">

      <div className="cg-section">
        <TugLabel className="cg-section-title">TugEdit</TugLabel>
        <div className="gallery-text-edit-host">
          <TugEdit ref={editRef} />
        </div>
      </div>

    </div>
  );
}
