/**
 * gallery-separator.tsx -- TugSeparator demo tab for the Component Gallery.
 *
 * Shows TugSeparator in all variants: plain horizontal, labeled, ornamental
 * (single glyphs and dinkus patterns), capped (plain and console-style),
 * vertical (between inline items), and SVG ornament.
 *
 * @module components/tugways/cards/gallery-separator
 */

import React from "react";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// GallerySeparator
// ---------------------------------------------------------------------------

export function GallerySeparator() {
  return (
    <div className="cg-content" data-testid="gallery-separator">

      {/* ---- Plain Horizontal ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Plain Horizontal</div>
        <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "0 0 8px" }}>
          Content above the separator.
        </p>
        <TugSeparator />
        <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "8px 0 0" }}>
          Content below the separator.
        </p>
      </div>

      <div className="cg-divider" />

      {/* ---- Labeled ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Labeled</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

          <div>
            <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "0 0 0" }}>
              Sign in with email
            </p>
            <TugSeparator label="OR" />
            <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "0" }}>
              Sign in with SSO
            </p>
          </div>

          <div>
            <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "0 0 0" }}>
              General preferences
            </p>
            <TugSeparator label="Settings" />
            <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "0" }}>
              Advanced configuration
            </p>
          </div>

        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Ornamental — Single Glyphs ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Ornamental — Single Glyphs</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <TugSeparator ornament="◆" />
          <TugSeparator ornament="✦" />
          <TugSeparator ornament="❦" />
          <TugSeparator ornament="⁂" />
          <TugSeparator ornament="§" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Ornamental — Dinkus Patterns ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Ornamental — Dinkus Patterns</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <TugSeparator ornament="* * *" />
          <TugSeparator ornament="· · ·" />
          <TugSeparator ornament="✦ ✦ ✦" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Capped ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Capped</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "4px" }}>
              plain capped line
            </div>
            <TugSeparator capped />
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "4px" }}>
              console style — capped + label
            </div>
            <TugSeparator capped label="INSTRUCTION" />
            <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "4px 0" }}>
              MOV AX, 0x4C00
            </p>
            <TugSeparator capped label="MEMORY ADDRESS" />
            <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "4px 0" }}>
              0xFFFF:0x0000
            </p>
          </div>

        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Vertical ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Vertical</div>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <span style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>Item A</span>
          <TugSeparator orientation="vertical" />
          <span style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>Item B</span>
          <TugSeparator orientation="vertical" />
          <span style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>Item C</span>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- SVG Ornament ---- */}
      <div className="cg-section">
        <div className="cg-section-title">SVG Ornament</div>
        <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "0 0 0" }}>
          Inline SVG as a ReactNode ornament — proves the ReactNode path works.
        </p>
        <TugSeparator ornament={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8Z" />
          </svg>
        } />
        <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: "0" }}>
          Content after the SVG ornament separator.
        </p>
      </div>

    </div>
  );
}
