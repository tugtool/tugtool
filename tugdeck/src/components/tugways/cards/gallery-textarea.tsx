/**
 * gallery-textarea.tsx -- TugTextarea demo tab for the Component Gallery.
 *
 * Shows TugTextarea in all sizes, validation states, resize variants,
 * auto-resize, character counter, disabled/read-only states, and TugBox cascade.
 *
 * Rules of Tugways compliance:
 *   - No React state drives appearance changes [D08, D09]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-textarea
 */

import React, { useState } from "react";
import { TugTextarea } from "@/components/tugways/tug-textarea";
import type { TugTextareaSize, TugTextareaValidation } from "@/components/tugways/tug-textarea";
import { TugBox } from "@/components/tugways/tug-box";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugTextareaSize[] = ["sm", "md", "lg"];
const ALL_VALIDATIONS: TugTextareaValidation[] = ["default", "invalid", "valid", "warning"];

// ---------------------------------------------------------------------------
// GalleryTextarea
// ---------------------------------------------------------------------------

export function GalleryTextarea() {
  // Controlled state for the character counter demos
  const [counter100Value, setCounter100Value] = useState("");
  const [counter50Value, setCounter50Value] = useState(
    "This text is getting close to the fifty character limit!",
  );

  return (
    <div className="cg-content" data-testid="gallery-textarea">

      {/*
        `componentStatePreservationKey` opts each textarea into DOM-authority persistence
        (CardHost captures `.value` / selection / scroll at save time and
        reapplies on restore). Keys must be unique within this card's
        content tree; by convention we use a
        `gallery-textarea/<section>/<variant>` namespace.

        Only *uncontrolled* textareas carry componentStatePreservationKey — the
        character-counter demos are controlled (React `value` /
        `onChange`), so their state is owned by React and a DOM-level
        restore would be immediately overwritten on the next render.
      */}

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Sizes</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
          {ALL_SIZES.map((size) => (
            <TugTextarea
              key={size}
              size={size}
              rows={3}
              placeholder={`Size: ${size}`}
              componentStatePreservationKey={`gallery-textarea/size/${size}`}
            />
          ))}
        </div>
      </div>

      <TugSeparator />

      {/* ---- Validation States ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Validation States</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
          {ALL_VALIDATIONS.map((v) => (
            <TugTextarea
              key={v}
              validation={v}
              rows={3}
              defaultValue={v === "default" ? "" : `Validation: ${v}`}
              placeholder={v === "default" ? "Default (no validation)" : undefined}
              componentStatePreservationKey={`gallery-textarea/validation/${v}`}
            />
          ))}
        </div>
      </div>

      <TugSeparator />

      {/* ---- Resize Variants ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Resize Variants</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "480px" }}>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              resize="vertical"
            </div>
            <TugTextarea
              resize="vertical"
              rows={3}
              placeholder="Drag bottom edge to resize vertically"
              componentStatePreservationKey="gallery-textarea/resize/vertical"
            />
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              resize="horizontal"
            </div>
            <TugTextarea
              resize="horizontal"
              rows={3}
              placeholder="Drag right edge to resize horizontally"
              componentStatePreservationKey="gallery-textarea/resize/horizontal"
            />
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              resize="both"
            </div>
            <TugTextarea
              resize="both"
              rows={3}
              placeholder="Drag any corner to resize freely"
              componentStatePreservationKey="gallery-textarea/resize/both"
            />
          </div>

        </div>
      </div>

      <TugSeparator />

      {/* ---- Auto-Resize ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Auto-Resize</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "480px" }}>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              autoResize — grows without limit
            </div>
            <TugTextarea
              autoResize
              rows={2}
              placeholder="Type here — the textarea grows to fit your content"
              componentStatePreservationKey="gallery-textarea/auto-resize/unbounded"
            />
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              autoResize + maxRows={5} — caps at 5 rows then scrolls
            </div>
            <TugTextarea
              autoResize
              maxRows={5}
              rows={2}
              placeholder="Grows up to 5 rows, then scrolls"
              componentStatePreservationKey="gallery-textarea/auto-resize/max-rows-5"
            />
          </div>

        </div>
      </div>

      <TugSeparator />

      {/* ---- Character Counter ---- */}
      {/* Controlled textareas (React owns `value` via state). No
          componentStatePreservationKey — DOM-level restore would be overwritten on the next
          render. Preserving these values across reload would require
          opting the host card into `useCardStatePreservation`. */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Character Counter</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "480px" }}>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              maxLength={100} — counter visible below
            </div>
            <TugTextarea
              maxLength={100}
              rows={3}
              value={counter100Value}
              onChange={(e) => setCounter100Value(e.target.value)}
              placeholder="Type to see the character counter..."
            />
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              maxLength={50} — pre-filled near limit (warning and danger states)
            </div>
            <TugTextarea
              maxLength={50}
              rows={3}
              value={counter50Value}
              onChange={(e) => setCounter50Value(e.target.value)}
            />
          </div>

        </div>
      </div>

      <TugSeparator />

      {/* ---- States ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">States</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
          <TugTextarea disabled rows={3} defaultValue="Disabled with value" componentStatePreservationKey="gallery-textarea/states/disabled-with-value" />
          <TugTextarea disabled rows={3} placeholder="Disabled with placeholder" componentStatePreservationKey="gallery-textarea/states/disabled-placeholder" />
          <TugTextarea readOnly rows={3} defaultValue="Read-only with value" componentStatePreservationKey="gallery-textarea/states/readonly-with-value" />
          <TugTextarea readOnly rows={3} placeholder="Read-only with placeholder" componentStatePreservationKey="gallery-textarea/states/readonly-placeholder" />
        </div>
      </div>

      <TugSeparator />

      {/* ---- TugBox Cascade ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugBox Cascade</TugLabel>
        <div style={{ maxWidth: "480px" }}>
          <TugBox variant="bordered" label="Feedback Form" disabled>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <TugTextarea
                rows={3}
                placeholder="Subject"
                componentStatePreservationKey="gallery-textarea/tugbox-cascade/subject"
              />
              <TugTextarea
                rows={5}
                placeholder="Message body — disabled via TugBox cascade"
                componentStatePreservationKey="gallery-textarea/tugbox-cascade/body"
              />
            </div>
          </TugBox>
        </div>
      </div>

    </div>
  );
}
