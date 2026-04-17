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

import React, { useId, useState } from "react";
import { Star, ArrowRight } from "lucide-react";
import type { TugButtonEmphasis, TugButtonRole, TugButtonSize, TugButtonSubtype } from "@/components/tugways/internal/tug-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugBox } from "@/components/tugways/tug-box";

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
export const ALL_SIZES: TugButtonSize[] = ["xs", "sm", "md", "lg"];
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

  // L11 migration pattern via useResponderForm — see gallery-checkbox.tsx
  // for the annotated reference. Checkbox toggles bind to the toggle slot;
  // the three popup-button pickers dispatch setValue with a string payload
  // (emphasis / role / size are all string enums) and bind to the
  // setValueString slot via gensym'd sender ids.
  const previewDisabledId = useId();
  const previewLoadingId = useId();
  const emphasisPopupId = useId();
  const rolePopupId = useId();
  const sizePopupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    toggle: {
      [previewDisabledId]: setPreviewDisabled,
      [previewLoadingId]: setPreviewLoading,
    },
    setValueString: {
      [emphasisPopupId]: (v) => setPreviewEmphasis(v as TugButtonEmphasis),
      [rolePopupId]: (v) => {
        if (v === "__default__") setPreviewRole(undefined);
        else setPreviewRole(v as TugButtonRole);
      },
      [sizePopupId]: (v) => setPreviewSize(v as TugButtonSize),
    },
  });

  // Label for the role dropdown: undefined → "accent (default)"
  const roleDropdownLabel = previewRole === undefined ? "accent (default)" : previewRole;

  // Role dropdown items: first item is "accent (default)" which maps to undefined.
  // Each item carries `action: TUG_ACTIONS.SET_VALUE` with `value` = the role string;
  // the role popup's binding above branches on "__default__".
  const roleItems = [
    { action: TUG_ACTIONS.SET_VALUE, value: "__default__", label: "accent (default)" },
    ...ALL_ROLES.filter((r) => r !== "accent").map((r) => ({
      action: TUG_ACTIONS.SET_VALUE,
      value: r,
      label: r,
    })),
  ];

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-buttons"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >
      {/* ---- Preview Controls ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Preview Controls</TugLabel>
        <TugBox variant="bordered" rounded="sm" style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <div className="cg-control-group">
            <TugLabel size="2xs" color="muted">Emphasis</TugLabel>
            <TugPopupButton
              label={previewEmphasis}
              size="sm"
              senderId={emphasisPopupId}
              items={(["filled", "outlined", "ghost"] as TugButtonEmphasis[]).map((v) => ({
                action: TUG_ACTIONS.SET_VALUE,
                value: v,
                label: v,
              }))}
            />
          </div>
          <div className="cg-control-group">
            <TugLabel size="2xs" color="muted">Role</TugLabel>
            <TugPopupButton
              label={roleDropdownLabel}
              size="sm"
              senderId={rolePopupId}
              items={roleItems}
            />
          </div>

          <div className="cg-control-group">
            <TugLabel size="2xs" color="muted">Size</TugLabel>
            <TugPopupButton
              label={previewSize}
              size="sm"
              senderId={sizePopupId}
              items={ALL_SIZES.map((s) => ({
                action: TUG_ACTIONS.SET_VALUE,
                value: s,
                label: s,
              }))}
            />
          </div>

          <div className="cg-control-group">
            <TugCheckbox
              checked={previewDisabled}
              senderId={previewDisabledId}
              label="Disabled"
              size="sm"
            />
          </div>

          <div className="cg-control-group">
            <TugCheckbox
              checked={previewLoading}
              senderId={previewLoadingId}
              label="Loading"
              size="sm"
            />
          </div>
        </TugBox>
      </div>

      <TugSeparator />

      {/* ---- Interactive Preview ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugPushButton — Interactive Preview</TugLabel>
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

      <TugSeparator />

      {/* ---- Trailing Icon ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugPushButton — Trailing Icon</TugLabel>
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

      <TugSeparator />

      {/* ---- Rounded ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugPushButton — Border Radius (rounded prop)</TugLabel>
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

      <TugSeparator />

      {/* ---- Disabled (static) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugPushButton — Disabled States</TugLabel>
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

      <TugSeparator />

      {/* ---- Loading (static) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugPushButton — Loading States</TugLabel>
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

      <TugSeparator />

      {/* ---- Full Matrix ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugPushButton — Full Matrix (all subtypes × emphasis x role × sizes)</TugLabel>
        <div className="cg-matrix">
          {ALL_SUBTYPES.map((subtype) => (
            <div key={subtype} className="cg-subtype-block">
              <TugLabel size="2xs" color="muted">{`subtype: ${subtype}`}</TugLabel>
              {ALL_COMBOS.map(({ emphasis, role }) => (
                <div key={`${emphasis}-${role}`} className="cg-variant-row">
                  <TugLabel size="2xs" color="muted">{`${emphasis}-${role}`}</TugLabel>
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
    </ResponderScope>
  );
}
