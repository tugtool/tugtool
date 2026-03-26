/**
 * GalleryButtonsContent -- TugButton interactive preview + full matrix.
 *
 * Extracted from `gallery-card.tsx` for use as a standalone gallery card tab.
 * Contains the preview controls (variant, size, disabled, loading) and renders
 * both the interactive preview row and the full subtype × variant × size matrix.
 *
 * **Authoritative reference:** [D01] gallery-buttons componentId.
 *
 * @module components/tugways/cards/gallery-push-button-content
 */

import React, { useState } from "react";
import { Star } from "lucide-react";
import { TugButton } from "@/components/tugways/internal/tug-button";
import type { TugButtonEmphasis, TugButtonRole, TugButtonSize, TugButtonSubtype } from "@/components/tugways/internal/tug-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All Table T01 emphasis x role combinations for the full matrix [D02, Table T01] */
export const ALL_COMBOS: Array<{ emphasis: TugButtonEmphasis; role: TugButtonRole }> = [
  { emphasis: "filled",   role: "accent"  },
  { emphasis: "filled",   role: "action"  },
  { emphasis: "filled",   role: "danger"  },
  { emphasis: "outlined", role: "action"  },
  { emphasis: "ghost",    role: "action"  },
  { emphasis: "ghost",    role: "danger"  },
];
export const ALL_SIZES: TugButtonSize[] = ["sm", "md", "lg"];
export const ALL_SUBTYPES: TugButtonSubtype[] = ["text", "icon", "icon-text"];

// ---------------------------------------------------------------------------
// SubtypeButton helper
// ---------------------------------------------------------------------------

/**
 * Renders the appropriate TugButton for a given subtype/variant/size combination
 * in the full matrix display.
 */
function SubtypeButton({
  subtype,
  emphasis,
  role,
  size,
}: {
  subtype: TugButtonSubtype;
  emphasis: TugButtonEmphasis;
  role: TugButtonRole;
  size: TugButtonSize;
}) {
  const sizeLabel = size;
  const comboLabel = `${emphasis}-${role}`;

  switch (subtype) {
    case "text":
      return (
        <TugPushButton emphasis={emphasis} role={role} size={size}>
          {sizeLabel}
        </TugPushButton>
      );

    case "icon":
      return (
        <TugButton
          subtype="icon"
          emphasis={emphasis}
          role={role}
          size={size}
          icon={<Star size={12} />}
          aria-label={`Icon ${comboLabel} ${size}`}
        />
      );

    case "icon-text":
      return (
        <TugPushButton
          subtype="icon-text"
          emphasis={emphasis}
          role={role}
          size={size}
          icon={<Star size={12} />}
        >
          {sizeLabel}
        </TugPushButton>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// GalleryButtonsContent
// ---------------------------------------------------------------------------

/**
 * GalleryButtonsContent -- TugButton interactive preview + full matrix.
 *
 * Extracted from `ComponentGallery` for use as a standalone gallery card tab.
 * Contains the preview controls (variant, size, disabled, loading) and renders
 * both the interactive preview row and the full subtype × variant × size matrix.
 *
 * **Authoritative reference:** [D01] gallery-buttons componentId.
 */
export function GalleryButtonsContent() {
  const [previewEmphasis, setPreviewEmphasis] = useState<TugButtonEmphasis>("outlined");
  const [previewRole, setPreviewRole] = useState<TugButtonRole>("action");
  const [previewSize, setPreviewSize] = useState<TugButtonSize>("md");
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  return (
    <div className="cg-content" data-testid="gallery-buttons-content">
      {/* ---- Interactive Controls ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Preview Controls</div>
        <div className="cg-controls">
          <div className="cg-control-group">
            <span className="cg-control-label">Emphasis</span>
            <TugPopupButton
              label={previewEmphasis}
              size="sm"
              items={(["filled", "outlined", "ghost"] as TugButtonEmphasis[]).map((v) => ({
                id: v,
                label: v,
              }))}
              onSelect={(id) => setPreviewEmphasis(id as TugButtonEmphasis)}
            />
          </div>
          <div className="cg-control-group">
            <span className="cg-control-label">Role</span>
            <TugPopupButton
              label={previewRole}
              size="sm"
              items={(["accent", "action", "agent", "data", "danger"] as TugButtonRole[]).map((v) => ({
                id: v,
                label: v,
              }))}
              onSelect={(id) => setPreviewRole(id as TugButtonRole)}
            />
          </div>

          <div className="cg-control-group">
            <span className="cg-control-label">Size</span>
            <TugPopupButton
              label={previewSize}
              size="sm"
              items={ALL_SIZES.map((s) => ({
                id: s,
                label: s,
              }))}
              onSelect={(id) => setPreviewSize(id as TugButtonSize)}
            />
          </div>

          <div className="cg-control-group">
            <TugCheckbox
              checked={previewDisabled}
              onCheckedChange={(checked) => setPreviewDisabled(checked === true)}
              label="Disabled"
              size="sm"
            />
          </div>

          <div className="cg-control-group">
            <TugCheckbox
              checked={previewLoading}
              onCheckedChange={(checked) => setPreviewLoading(checked === true)}
              label="Loading"
              size="sm"
            />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Interactive Preview ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPushButton — Interactive Preview</div>
        <div className="cg-variant-row">
          <TugPushButton
            emphasis={previewEmphasis}
            role={previewRole}
            size={previewSize}
            disabled={previewDisabled}
            loading={previewLoading}
          >
            Push
          </TugPushButton>
          <TugButton
            subtype="icon"
            emphasis={previewEmphasis}
            role={previewRole}
            size={previewSize}
            disabled={previewDisabled}
            loading={previewLoading}
            icon={<Star size={14} />}
            aria-label="Icon button"
          />
          <TugPushButton
            subtype="icon-text"
            emphasis={previewEmphasis}
            role={previewRole}
            size={previewSize}
            disabled={previewDisabled}
            loading={previewLoading}
            icon={<Star size={14} />}
          >
            Icon + Text
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Full Matrix ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPushButton — Full Matrix (all subtypes × emphasis x role × sizes)</div>
        <div className="cg-matrix">
          {ALL_SUBTYPES.map((subtype) => (
            <div key={subtype} className="cg-subtype-block">
              <div className="cg-subtype-label">subtype: {subtype}</div>
              {ALL_COMBOS.map(({ emphasis, role }) => (
                <div key={`${emphasis}-${role}`} className="cg-variant-row">
                  <div className="cg-variant-label">{emphasis}-{role}</div>
                  <div className="cg-size-group">
                    {ALL_SIZES.map((size) => (
                      <SubtypeButton
                        key={size}
                        subtype={subtype}
                        emphasis={emphasis}
                        role={role}
                        size={size}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
