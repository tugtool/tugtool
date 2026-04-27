/**
 * gallery-input.tsx -- TugInput demo tab for the Component Gallery.
 *
 * Shows TugInput in all sizes, validation states, disabled, and read-only.
 *
 * Rules of Tugways compliance:
 *   - No React state drives appearance changes [D08, D09]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-input
 */

import React from "react";
import { TugInput } from "@/components/tugways/tug-input";
import type { TugInputSize, TugInputValidation } from "@/components/tugways/tug-input";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugInputSize[] = ["sm", "md", "lg"];
const ALL_VALIDATIONS: TugInputValidation[] = ["default", "invalid", "valid", "warning"];

// ---------------------------------------------------------------------------
// GalleryInput
// ---------------------------------------------------------------------------

export function GalleryInput() {
  return (
    <div className="cg-content" data-testid="gallery-input">

      {/*
        `componentStatePreservationKey` opts each input into DOM-authority state preservation
        (CardHost captures `.value` / selection / scroll at save time and
        reapplies on restore). Keys must be unique within this card's
        content tree; by convention we use a `gallery-input/<section>/<variant>`
        namespace so adjacent sections (e.g. validation and disabled) can
        each carry their own uncontrolled value without collision.
      */}

      {/* ---- Size Variants ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Size Variants</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          {ALL_SIZES.map((size) => (
            <TugInput
              key={size}
              size={size}
              placeholder={`Size: ${size}`}
              componentStatePreservationKey={`gallery-input/size/${size}`}
            />
          ))}
        </div>
      </div>

      <TugSeparator />

      {/* ---- Validation States ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Validation States</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          {ALL_VALIDATIONS.map((v) => (
            <TugInput
              key={v}
              validation={v}
              defaultValue={v === "default" ? "" : `Validation: ${v}`}
              placeholder={v === "default" ? "Default (no validation)" : undefined}
              componentStatePreservationKey={`gallery-input/validation/${v}`}
            />
          ))}
        </div>
      </div>

      <TugSeparator />

      {/* ---- Disabled ---- */}
      {/* Disabled inputs cannot be edited, but still carry componentStatePreservationKey
          so their defaultValue is preserved across restore for symmetry. */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Disabled</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          <TugInput disabled defaultValue="Disabled with value" componentStatePreservationKey="gallery-input/disabled/with-value" />
          <TugInput disabled placeholder="Disabled with placeholder" componentStatePreservationKey="gallery-input/disabled/placeholder" />
        </div>
      </div>

      <TugSeparator />

      {/* ---- Read-only ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Read-only</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          <TugInput readOnly defaultValue="Read-only with value" componentStatePreservationKey="gallery-input/readonly/with-value" />
          <TugInput readOnly placeholder="Read-only with placeholder" componentStatePreservationKey="gallery-input/readonly/placeholder" />
        </div>
      </div>

      <TugSeparator />

      {/* ---- Input Types ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Input Types</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          <TugInput type="text" placeholder="type=text" componentStatePreservationKey="gallery-input/type/text" />
          <TugInput type="password" placeholder="type=password" componentStatePreservationKey="gallery-input/type/password" />
          <TugInput type="number" placeholder="type=number" componentStatePreservationKey="gallery-input/type/number" />
          <TugInput type="email" placeholder="type=email" componentStatePreservationKey="gallery-input/type/email" />
          <TugInput type="search" placeholder="type=search" componentStatePreservationKey="gallery-input/type/search" />
          <TugInput type="url" placeholder="type=url" componentStatePreservationKey="gallery-input/type/url" />
        </div>
      </div>

    </div>
  );
}
