/**
 * gallery-text-edit.tsx — TugEdit gallery card.
 *
 * Demo surface for the new CodeMirror 6-backed `TugEdit` substrate.
 * Step 1 of the text-editing-base spike scope: a single mounted
 * editor that accepts typing, arrow keys, and undo/redo.
 *
 * Subsequent spike steps grow this card to demonstrate atoms,
 * theme switching, completion, history navigation, drag-and-drop,
 * and full prop parity with `tug-prompt-input` (see
 * `roadmap/text-editing-base.md`).
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
