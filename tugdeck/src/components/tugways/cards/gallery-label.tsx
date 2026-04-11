/**
 * gallery-label.tsx -- TugLabel gallery card.
 *
 * Shows TugLabel in all sizes, ellipsis modes, with icons, and paired
 * with TugInput.
 */

import React from "react";
import { Tag, Info, AlertTriangle, Star, Folder } from "lucide-react";
import { TugLabel } from "@/components/tugways/tug-label";
import type { TugLabelSize } from "@/components/tugways/tug-label";
import { TugInput } from "@/components/tugways/tug-input";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugLabelSize[] = ["sm", "md", "lg"];

const LONG_TEXT =
  "This is a long label that demonstrates multiline text wrapping behavior when the content exceeds the available width of the container element";

const PATH_TEXT =
  "/Users/kocienda/Documents/Projects/tugways/src/components/tugways/cards/gallery-label.tsx";

// ---------------------------------------------------------------------------
// GalleryLabel
// ---------------------------------------------------------------------------

export function GalleryLabel() {
  return (
    <div className="cg-content" data-testid="gallery-label">

      {/* ---- Size Variants ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Size Variants</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          {ALL_SIZES.map((size) => (
            <TugLabel key={size} size={size}>
              {`Label size: ${size}`}
            </TugLabel>
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Required Indicator ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Required Indicator</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          <TugLabel>Optional field</TugLabel>
          <TugLabel required>Required field</TugLabel>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- With Icons ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — With Icons</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          <TugLabel icon={<Tag />}>Default icon color</TugLabel>
          <TugLabel icon={<Info />} iconColor="var(--tug7-element-global-fill-normal-accentCool-rest)">
            Accent-colored icon
          </TugLabel>
          <TugLabel icon={<AlertTriangle />} iconColor="var(--tug7-element-field-fill-normal-caution-rest)">
            Warning-colored icon
          </TugLabel>
          <TugLabel icon={<Star />} iconColor="var(--tug7-element-field-fill-normal-danger-rest)">
            Error-colored icon
          </TugLabel>
          <TugLabel icon={<Folder />} iconColor="var(--tug7-element-field-fill-normal-success-rest)">
            Success-colored icon
          </TugLabel>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Icons at All Sizes ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Icons at All Sizes</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "360px" }}>
          {ALL_SIZES.map((size) => (
            <TugLabel key={size} size={size} icon={<Tag />} required>
              {`Size ${size} with icon`}
            </TugLabel>
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Multiline Wrapping ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Multiline Wrapping</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "280px" }}>
          <div>
            <TugLabel size="xs" color="muted">No maxLines — wraps freely:</TugLabel>
            <TugLabel>{LONG_TEXT}</TugLabel>
          </div>
          <div>
            <TugLabel size="xs" color="muted">maxLines=2, no ellipsis:</TugLabel>
            <TugLabel maxLines={2} ellipsis="none">{LONG_TEXT}</TugLabel>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Ellipsis: End ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Ellipsis: End (CSS line-clamp)</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "280px" }}>
          <div>
            <TugLabel size="xs" color="muted">maxLines=1:</TugLabel>
            <TugLabel maxLines={1} ellipsis="end">{LONG_TEXT}</TugLabel>
          </div>
          <div>
            <TugLabel size="xs" color="muted">maxLines=2:</TugLabel>
            <TugLabel maxLines={2} ellipsis="end">{LONG_TEXT}</TugLabel>
          </div>
          <div>
            <TugLabel size="xs" color="muted">maxLines=3:</TugLabel>
            <TugLabel maxLines={3} ellipsis="end">{LONG_TEXT}</TugLabel>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Ellipsis: Start ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Ellipsis: Start</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "280px" }}>
          <div>
            <TugLabel size="xs" color="muted">File path, maxLines=1:</TugLabel>
            <TugLabel maxLines={1} ellipsis="start" icon={<Folder />}>{PATH_TEXT}</TugLabel>
          </div>
          <div>
            <TugLabel size="xs" color="muted">Long text, maxLines=2:</TugLabel>
            <TugLabel maxLines={2} ellipsis="start">{LONG_TEXT}</TugLabel>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Ellipsis: Middle ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Ellipsis: Middle</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "280px" }}>
          <div>
            <TugLabel size="xs" color="muted">File path, maxLines=1:</TugLabel>
            <TugLabel maxLines={1} ellipsis="middle" icon={<Folder />}>{PATH_TEXT}</TugLabel>
          </div>
          <div>
            <TugLabel size="xs" color="muted">Long text, maxLines=2:</TugLabel>
            <TugLabel maxLines={2} ellipsis="middle">{LONG_TEXT}</TugLabel>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Paired with TugInput ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Paired with TugInput</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "360px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <TugLabel htmlFor="demo-name" required>Name</TugLabel>
            <TugInput id="demo-name" placeholder="Enter your name" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <TugLabel htmlFor="demo-email" icon={<Info />} iconColor="var(--tug7-element-global-fill-normal-accentCool-rest)">
              Email address
            </TugLabel>
            <TugInput id="demo-email" type="email" placeholder="you@example.com" />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Disabled ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugLabel — Disabled</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "360px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <TugLabel htmlFor="demo-disabled" disabled>Disabled label</TugLabel>
            <TugInput id="demo-disabled" disabled placeholder="Disabled input" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <TugLabel htmlFor="demo-disabled-icon" disabled icon={<Info />} required>Disabled with icon + required</TugLabel>
            <TugInput id="demo-disabled-icon" disabled defaultValue="Can't edit this" />
          </div>
        </div>
      </div>

    </div>
  );
}
