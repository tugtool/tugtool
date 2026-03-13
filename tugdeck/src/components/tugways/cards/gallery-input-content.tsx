/**
 * gallery-input-content.tsx -- TugInput demo tab for the Component Gallery.
 *
 * Shows TugInput in all sizes, validation states, disabled, and read-only.
 *
 * Rules of Tugways compliance:
 *   - No React state drives appearance changes [D08, D09]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-input-content
 */

import React from "react";
import { TugInput } from "@/components/tugways/tug-input";
import type { TugInputSize, TugInputValidation } from "@/components/tugways/tug-input";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugInputSize[] = ["sm", "md", "lg"];
const ALL_VALIDATIONS: TugInputValidation[] = ["default", "invalid", "valid", "warning"];

// ---------------------------------------------------------------------------
// GalleryInputContent
// ---------------------------------------------------------------------------

export function GalleryInputContent() {
  return (
    <div className="cg-content" data-testid="gallery-input-content">

      {/* ---- Size Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Size Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          {ALL_SIZES.map((size) => (
            <TugInput
              key={size}
              size={size}
              placeholder={`Size: ${size}`}
            />
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Validation States ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Validation States</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          {ALL_VALIDATIONS.map((v) => (
            <TugInput
              key={v}
              validation={v}
              defaultValue={v === "default" ? "" : `Validation: ${v}`}
              placeholder={v === "default" ? "Default (no validation)" : undefined}
            />
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Disabled ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Disabled</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          <TugInput disabled placeholder="Disabled (empty)" />
          <TugInput disabled defaultValue="Disabled with value" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Read-only ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Read-only</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          <TugInput readOnly defaultValue="Read-only with value" />
          <TugInput readOnly placeholder="Read-only (empty)" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Input Types ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Input Types</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          <TugInput type="text" placeholder="type=text" />
          <TugInput type="password" placeholder="type=password" />
          <TugInput type="number" placeholder="type=number" />
          <TugInput type="email" placeholder="type=email" />
          <TugInput type="search" placeholder="type=search" />
          <TugInput type="url" placeholder="type=url" />
        </div>
      </div>

    </div>
  );
}
