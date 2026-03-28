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

      {/* ---- Sizes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Sizes</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
          {ALL_SIZES.map((size) => (
            <TugTextarea
              key={size}
              size={size}
              rows={3}
              placeholder={`Size: ${size}`}
            />
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Validation States ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Validation States</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
          {ALL_VALIDATIONS.map((v) => (
            <TugTextarea
              key={v}
              validation={v}
              rows={3}
              defaultValue={v === "default" ? "" : `Validation: ${v}`}
              placeholder={v === "default" ? "Default (no validation)" : undefined}
            />
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Resize Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Resize Variants</div>
        <div style={{ display: "flex", flexDirection: "row", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>

          <div style={{ flex: "1 1 160px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              resize="vertical"
            </div>
            <TugTextarea
              resize="vertical"
              rows={3}
              placeholder="Drag bottom edge to resize vertically"
            />
          </div>

          <div style={{ flex: "1 1 160px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              resize="horizontal"
            </div>
            <TugTextarea
              resize="horizontal"
              rows={3}
              placeholder="Drag right edge to resize horizontally"
            />
          </div>

          <div style={{ flex: "1 1 160px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              resize="both"
            </div>
            <TugTextarea
              resize="both"
              rows={3}
              placeholder="Drag any corner to resize freely"
            />
          </div>

        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Auto-Resize ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Auto-Resize</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "480px" }}>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "6px" }}>
              autoResize — grows without limit
            </div>
            <TugTextarea
              autoResize
              rows={2}
              placeholder="Type here — the textarea grows to fit your content"
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
            />
          </div>

        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Character Counter ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Character Counter</div>
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

      <div className="cg-divider" />

      {/* ---- States ---- */}
      <div className="cg-section">
        <div className="cg-section-title">States</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
          <TugTextarea disabled rows={3} defaultValue="Disabled with value" />
          <TugTextarea disabled rows={3} placeholder="Disabled with placeholder" />
          <TugTextarea readOnly rows={3} defaultValue="Read-only with value" />
          <TugTextarea readOnly rows={3} placeholder="Read-only with placeholder" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- TugBox Cascade ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugBox Cascade</div>
        <div style={{ maxWidth: "480px" }}>
          <TugBox variant="bordered" label="Feedback Form" disabled>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <TugTextarea
                rows={3}
                placeholder="Subject"
              />
              <TugTextarea
                rows={5}
                placeholder="Message body — disabled via TugBox cascade"
              />
            </div>
          </TugBox>
        </div>
      </div>

    </div>
  );
}
