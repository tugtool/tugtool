/**
 * ComponentGallery -- Development panel showing all tugways components.
 *
 * Phase 2: TugButton section only. Renders all subtype/variant/size combinations
 * in a grid, with interactive controls for variant, size, disabled, and loading.
 *
 * Rendered as an absolute-positioned div in DeckCanvas. Not a card, not managed
 * by DeckManager. Toggled via show-component-gallery action from Mac Developer menu.
 *
 * [D03] Gallery as absolute-positioned div
 * [D05] All four subtypes
 * Spec S04 (#s04-gallery-panel)
 */

import React, { useState } from "react";
import { X, Star } from "lucide-react";
import { TugButton } from "./tug-button";
import type { TugButtonVariant, TugButtonSize, TugButtonSubtype } from "./tug-button";
import "./component-gallery.css";

// ---- Types ----

export interface ComponentGalleryProps {
  /** Called when the user clicks the close button in the title bar. */
  onClose: () => void;
}

// ---- Constants ----

const ALL_VARIANTS: TugButtonVariant[] = ["primary", "secondary", "ghost", "destructive"];
const ALL_SIZES: TugButtonSize[] = ["sm", "md", "lg"];
const ALL_SUBTYPES: TugButtonSubtype[] = ["push", "icon", "icon-text", "three-state"];

// ---- ComponentGallery ----

/**
 * ComponentGallery panel.
 *
 * Floating development panel that showcases all tugways components.
 * Phase 2: TugButton in all subtype / variant / size combinations.
 */
export function ComponentGallery({ onClose }: ComponentGalleryProps) {
  // Interactive controls -- applied to the full-matrix preview rows
  const [previewVariant, setPreviewVariant] = useState<TugButtonVariant>("secondary");
  const [previewSize, setPreviewSize] = useState<TugButtonSize>("md");
  const [previewDisabled, setPreviewDisabled] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  return (
    <div className="cg-panel" role="complementary" aria-label="Component Gallery">
      {/* ---- Title Bar ---- */}
      <div className="cg-titlebar">
        <span className="cg-title">Component Gallery</span>
        <TugButton
          subtype="icon"
          variant="ghost"
          size="sm"
          icon={<X size={14} />}
          aria-label="Close Component Gallery"
          onClick={onClose}
        />
      </div>

      {/* ---- Scrollable Content ---- */}
      <div className="cg-content">

        {/* ---- Interactive Controls ---- */}
        <div className="cg-section">
          <div className="cg-section-title">Preview Controls</div>
          <div className="cg-controls">
            <div className="cg-control-group">
              <label className="cg-control-label" htmlFor="cg-variant-select">
                Variant
              </label>
              <select
                id="cg-variant-select"
                className="cg-control-select"
                value={previewVariant}
                onChange={(e) => setPreviewVariant(e.target.value as TugButtonVariant)}
              >
                {ALL_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="cg-control-group">
              <label className="cg-control-label" htmlFor="cg-size-select">
                Size
              </label>
              <select
                id="cg-size-select"
                className="cg-control-select"
                value={previewSize}
                onChange={(e) => setPreviewSize(e.target.value as TugButtonSize)}
              >
                {ALL_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="cg-control-group">
              <input
                id="cg-disabled-check"
                type="checkbox"
                className="cg-control-checkbox"
                checked={previewDisabled}
                onChange={(e) => setPreviewDisabled(e.target.checked)}
              />
              <label className="cg-control-label" htmlFor="cg-disabled-check">
                Disabled
              </label>
            </div>

            <div className="cg-control-group">
              <input
                id="cg-loading-check"
                type="checkbox"
                className="cg-control-checkbox"
                checked={previewLoading}
                onChange={(e) => setPreviewLoading(e.target.checked)}
              />
              <label className="cg-control-label" htmlFor="cg-loading-check">
                Loading
              </label>
            </div>
          </div>
        </div>

        <div className="cg-divider" />

        {/* ---- TugButton Section: Interactive Preview ---- */}
        <div className="cg-section">
          <div className="cg-section-title">TugButton — Interactive Preview</div>
          <div className="cg-variant-row">
            <TugButton
              subtype="push"
              variant={previewVariant}
              size={previewSize}
              disabled={previewDisabled}
              loading={previewLoading}
            >
              Push
            </TugButton>
            <TugButton
              subtype="icon"
              variant={previewVariant}
              size={previewSize}
              disabled={previewDisabled}
              loading={previewLoading}
              icon={<Star size={14} />}
              aria-label="Icon button"
            />
            <TugButton
              subtype="icon-text"
              variant={previewVariant}
              size={previewSize}
              disabled={previewDisabled}
              loading={previewLoading}
              icon={<Star size={14} />}
            >
              Icon + Text
            </TugButton>
            <TugButton
              subtype="three-state"
              variant={previewVariant}
              size={previewSize}
              disabled={previewDisabled}
              loading={previewLoading}
            >
              Toggle
            </TugButton>
          </div>
        </div>

        <div className="cg-divider" />

        {/* ---- TugButton Section: Full Matrix ---- */}
        <div className="cg-section">
          <div className="cg-section-title">TugButton — Full Matrix (all subtypes × variants × sizes)</div>
          <div className="cg-matrix">
            {ALL_SUBTYPES.map((subtype) => (
              <div key={subtype} className="cg-subtype-block">
                <div className="cg-subtype-label">subtype: {subtype}</div>
                {ALL_VARIANTS.map((variant) => (
                  <div key={variant} className="cg-variant-row">
                    <div className="cg-variant-label">{variant}</div>
                    <div className="cg-size-group">
                      {ALL_SIZES.map((size) => (
                        <SubtypeButton
                          key={size}
                          subtype={subtype}
                          variant={variant}
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
    </div>
  );
}

// ---- SubtypeButton helper ----

/**
 * Renders the appropriate TugButton for a given subtype/variant/size combination
 * in the full matrix display.
 */
function SubtypeButton({
  subtype,
  variant,
  size,
}: {
  subtype: TugButtonSubtype;
  variant: TugButtonVariant;
  size: TugButtonSize;
}) {
  const sizeLabel = size;

  switch (subtype) {
    case "push":
      return (
        <TugButton subtype="push" variant={variant} size={size}>
          {sizeLabel}
        </TugButton>
      );

    case "icon":
      return (
        <TugButton
          subtype="icon"
          variant={variant}
          size={size}
          icon={<Star size={12} />}
          aria-label={`Icon ${variant} ${size}`}
        />
      );

    case "icon-text":
      return (
        <TugButton
          subtype="icon-text"
          variant={variant}
          size={size}
          icon={<Star size={12} />}
        >
          {sizeLabel}
        </TugButton>
      );

    case "three-state":
      return (
        <TugButton subtype="three-state" variant={variant} size={size}>
          {sizeLabel}
        </TugButton>
      );

    default:
      return null;
  }
}
