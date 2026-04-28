/**
 * gallery-text-edit.tsx — TugEdit gallery card.
 *
 * Demo surface for the CodeMirror 6-backed `TugEdit` substrate.
 * Mounts an editor and exposes the host's focus-style and borderless
 * variants so reviewers can exercise each. Theme switching is
 * application-level and not surfaced here. Card-level controls for
 * atoms, completion, history, and the rest of the prop surface are
 * layered on as the substrate grows.
 *
 * Laws: [L01] one root.render() at mount, [L06] appearance via
 *        CSS and DOM, never React state, [L11] toggle controls
 *        emit selectValue actions consumed by this scope's responder
 *        form, [L19] component authoring guide.
 */

import "./gallery-text-edit.css";

import React, { useRef } from "react";
import { TugEdit } from "@/components/tugways/tug-edit";
import type { TugEditDelegate, TugEditFocusStyle } from "@/components/tugways/tug-edit";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FOCUS_STYLE_CHOICES: TugChoiceItem[] = [
  { value: "background", label: "Background" },
  { value: "ring", label: "Ring" },
];

const BORDERLESS_CHOICES: TugChoiceItem[] = [
  { value: "false", label: "Bordered" },
  { value: "true", label: "Borderless" },
];

// ---------------------------------------------------------------------------
// GalleryTextEdit
// ---------------------------------------------------------------------------

export function GalleryTextEdit() {
  const editRef = useRef<TugEditDelegate>(null);
  const [focusStyle, setFocusStyle] = React.useState<TugEditFocusStyle>("background");
  const [borderless, setBorderlessFlag] = React.useState<boolean>(false);

  // Sender ids for the selectValue actions below.
  const focusId = React.useId();
  const borderlessId = React.useId();

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [focusId]: (v: string) => setFocusStyle(v as TugEditFocusStyle),
      [borderlessId]: (v: string) => setBorderlessFlag(v === "true"),
    },
  });

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-text-edit"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >

        {/* ---- Editor ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugEdit</TugLabel>
          <div className="gallery-text-edit-host">
            <TugEdit
              ref={editRef}
              focusStyle={focusStyle}
              borderless={borderless}
            />
          </div>
        </div>

        <TugSeparator />

        {/* ---- Focus style ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Focus style</TugLabel>
          <TugChoiceGroup
            items={FOCUS_STYLE_CHOICES}
            value={focusStyle}
            senderId={focusId}
            size="sm"
          />
        </div>

        <TugSeparator />

        {/* ---- Borderless ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Border</TugLabel>
          <TugChoiceGroup
            items={BORDERLESS_CHOICES}
            value={borderless ? "true" : "false"}
            senderId={borderlessId}
            size="sm"
          />
        </div>

      </div>
    </ResponderScope>
  );
}
