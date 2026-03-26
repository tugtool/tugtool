/**
 * GalleryPushButton -- TugButton interactive preview + full matrix.
 *
 * Extracted from `gallery-card.tsx` for use as a standalone gallery card tab.
 * Contains the preview controls (variant, size, disabled, loading) and renders
 * both the interactive preview row and the full subtype × variant × size matrix.
 *
 * **Authoritative reference:** [D01] gallery-buttons componentId.
 *
 * @module components/tugways/cards/gallery-push-button
 */

import React, { useState } from "react";
import { Star, ArrowRight } from "lucide-react";
import type { TugButtonEmphasis, TugButtonRole, TugButtonSize, TugButtonSubtype } from "@/components/tugways/internal/tug-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All Table T01 emphasis x role combinations for the full matrix [D02, Table T01] */
export const ALL_COMBOS: Array<{ emphasis: TugButtonEmphasis; role: TugButtonRole }> = [
  // filled × all roles
  { emphasis: "filled",   role: "accent"  },
  { emphasis: "filled",   role: "action"  },
  { emphasis: "filled",   role: "danger"  },
  { emphasis: "filled",   role: "data"    },
  { emphasis: "filled",   role: "option"  },
  // outlined × representative roles
  { emphasis: "outlined", role: "accent"  },
  { emphasis: "outlined", role: "action"  },
  { emphasis: "outlined", role: "danger"  },
  // ghost × representative roles
  { emphasis: "ghost",    role: "accent"  },
  { emphasis: "ghost",    role: "action"  },
  { emphasis: "ghost",    role: "danger"  },
];
export const ALL_SIZES: TugButtonSize[] = ["sm", "md", "lg"];
export const ALL_SUBTYPES: TugButtonSubtype[] = ["text", "icon", "icon-text"];
export const ALL_ROLES: TugButtonRole[] = ["accent", "action", "data", "danger", "option"];
export const ALL_ROUNDED = ["none", "sm", "md", "lg", "full"] as const;

// ---------------------------------------------------------------------------
// SubtypeButton helper
// ---------------------------------------------------------------------------

/**
 * Renders the appropriate TugPushButton for a given subtype/variant/size combination
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
        <TugPushButton
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
// GalleryPushButton
// ---------------------------------------------------------------------------

/**
 * GalleryPushButton -- TugButton interactive preview + full matrix.
 *
 * Extracted from `ComponentGallery` for use as a standalone gallery card tab.
 * Contains the preview controls (variant, size, disabled, loading) and renders
 * both the interactive preview row and the full subtype × variant × size matrix.
 *
 * **Authoritative reference:** [D01] gallery-buttons componentId.
 */
export function GalleryPushButton() {
  const [previewEmphasis, setPreviewEmphasis] = useState<TugButtonEmphasis>("outlined");
  // undefined means "accent (default)" — no role prop passed to the button
  const [previewRole, setPreviewRole] = useState<TugButtonRole | undefined>(undefined);
  const [previewSize, setPreviewSize] = useState<TugButtonSize>("md");
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Label for the role dropdown: undefined → "accent (default)"
  const roleDropdownLabel = previewRole === undefined ? "accent (default)" : previewRole;

  // Role dropdown items: first item is "accent (default)" which maps to undefined
  const roleItems = [
    { id: "__default__", label: "accent (default)" },
    ...ALL_ROLES.filter((r) => r !== "accent").map((r) => ({ id: r, label: r })),
  ];

  const handleRoleSelect = (id: string) => {
    if (id === "__default__") {
      setPreviewRole(undefined);
    } else {
      setPreviewRole(id as TugButtonRole);
    }
  };

  return (
    <div className="cg-content" data-testid="gallery-buttons">
      {/* ---- Preview Controls ---- */}
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
              label={roleDropdownLabel}
              size="sm"
              items={roleItems}
              onSelect={handleRoleSelect}
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
          <TugPushButton
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

      {/* ---- Trailing Icon ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPushButton — Trailing Icon</div>
        <div className="cg-variant-row">
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="md"
            trailingIcon={<ArrowRight size={14} />}
          >
            Options
          </TugPushButton>
          <TugPushButton
            emphasis="filled"
            role="accent"
            size="md"
            trailingIcon={<ArrowRight size={14} />}
          >
            Select
          </TugPushButton>
          <TugPushButton
            subtype="icon-text"
            emphasis="outlined"
            role="action"
            size="md"
            icon={<Star size={14} />}
            trailingIcon={<ArrowRight size={14} />}
          >
            More
          </TugPushButton>
          <TugPushButton
            emphasis="ghost"
            role="action"
            size="sm"
            trailingIcon={<ArrowRight size={12} />}
          >
            Dropdown
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Rounded ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPushButton — Border Radius (rounded prop)</div>
        <div className="cg-variant-row">
          {ALL_ROUNDED.map((r) => (
            <TugPushButton
              key={r}
              emphasis="filled"
              role="action"
              size="md"
              rounded={r}
            >
              {r}
            </TugPushButton>
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Disabled (static) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPushButton — Disabled States</div>
        <div className="cg-variant-row">
          <TugPushButton emphasis="filled" role="action" size="md" disabled>
            Filled
          </TugPushButton>
          <TugPushButton emphasis="outlined" role="action" size="md" disabled>
            Outlined
          </TugPushButton>
          <TugPushButton emphasis="ghost" role="action" size="md" disabled>
            Ghost
          </TugPushButton>
          <TugPushButton
            subtype="icon"
            emphasis="filled"
            role="action"
            size="md"
            icon={<Star size={14} />}
            aria-label="Disabled icon"
            disabled
          />
          <TugPushButton
            subtype="icon-text"
            emphasis="outlined"
            role="action"
            size="md"
            icon={<Star size={14} />}
            disabled
          >
            Icon+Text
          </TugPushButton>
          <TugPushButton emphasis="filled" role="danger" size="md" disabled>
            Danger
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Loading (static) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPushButton — Loading States</div>
        <div className="cg-variant-row">
          <TugPushButton emphasis="filled" role="action" size="md" loading>
            Filled
          </TugPushButton>
          <TugPushButton emphasis="outlined" role="action" size="md" loading>
            Outlined
          </TugPushButton>
          <TugPushButton emphasis="ghost" role="action" size="md" loading>
            Ghost
          </TugPushButton>
          <TugPushButton
            subtype="icon"
            emphasis="filled"
            role="action"
            size="md"
            icon={<Star size={14} />}
            aria-label="Loading icon"
            loading
          />
          <TugPushButton
            subtype="icon-text"
            emphasis="outlined"
            role="action"
            size="md"
            icon={<Star size={14} />}
            loading
          >
            Icon+Text
          </TugPushButton>
          <TugPushButton emphasis="filled" role="accent" size="md" loading>
            Accent
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
