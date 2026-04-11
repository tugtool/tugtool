/**
 * gallery-separator.tsx -- TugSeparator demo tab for the Component Gallery.
 *
 * Shows TugSeparator in all variants: plain horizontal, labeled, ornamental
 * (single glyphs and dinkus patterns), capped (plain and console-style),
 * length/alignment, vertical, and SVG ornament.
 *
 * @module components/tugways/cards/gallery-separator
 */

import React from "react";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugLabel } from "@/components/tugways/tug-label";

// Shared inline text style for demo content
const textStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  margin: 0,
};

const descStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

// ---------------------------------------------------------------------------
// GallerySeparator
// ---------------------------------------------------------------------------

export function GallerySeparator() {
  return (
    <div className="cg-content" data-testid="gallery-separator">

      {/* ---- Plain Horizontal ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Plain Horizontal</TugLabel>
        <div style={{ maxWidth: "480px" }}>
          <p style={textStyle}>Content above the separator.</p>
          <TugSeparator />
          <p style={textStyle}>Content below the separator.</p>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Labeled ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Labeled</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "480px" }}>
          <div>
            <p style={textStyle}>Sign in with email</p>
            <TugSeparator label="OR" />
            <p style={textStyle}>Sign in with SSO</p>
          </div>
          <div>
            <p style={textStyle}>General preferences</p>
            <TugSeparator label="Settings" />
            <p style={textStyle}>Advanced configuration</p>
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Ornamental — Single Glyphs ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Ornamental — Single Glyphs</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "480px" }}>
          <TugSeparator ornament="◆" />
          <TugSeparator ornament="✦" />
          <TugSeparator ornament="❦" />
          <TugSeparator ornament="⁂" />
          <TugSeparator ornament="§" />
        </div>
      </div>

      <TugSeparator />

      {/* ---- Ornamental — Dinkus Patterns ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Ornamental — Dinkus Patterns</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "480px" }}>
          <TugSeparator ornament="* * *" />
          <TugSeparator ornament="· · ·" />
          <TugSeparator ornament="✦ ✦ ✦" />
        </div>
      </div>

      <TugSeparator />

      {/* ---- Capped ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Capped</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
          <div>
            <div style={descStyle}>plain capped line</div>
            <TugSeparator capped />
          </div>
          <div>
            <div style={descStyle}>console style — capped + label</div>
            <TugSeparator capped label="INSTRUCTION" />
            <p style={{ ...textStyle, margin: "4px 0", fontFamily: "monospace" }}>MOV AX, 0x4C00</p>
            <TugSeparator capped label="MEMORY ADDRESS" />
            <p style={{ ...textStyle, margin: "4px 0", fontFamily: "monospace" }}>0xFFFF:0x0000</p>
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Length & Alignment ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Length & Alignment</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
          <div>
            <div style={descStyle}>length="50%" align="center" (default)</div>
            <TugSeparator length="50%" />
          </div>
          <div>
            <div style={descStyle}>length="50%" align="start"</div>
            <TugSeparator length="50%" align="start" />
          </div>
          <div>
            <div style={descStyle}>length="50%" align="end"</div>
            <TugSeparator length="50%" align="end" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={descStyle}>length="200px" — size and offset tuned per glyph</div>
            <TugSeparator length="200px" ornament="✦" />
            <TugSeparator length="200px" ornament="◆" ornamentSize="0.75em" ornamentOffset="0.05em" />
            <TugSeparator length="200px" ornament="❦" ornamentSize="1.1em" />
            <TugSeparator length="200px" ornament="●" ornamentSize="0.5em" />
            <TugSeparator length="200px" ornament="✳" />
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Vertical ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Vertical</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          <div>
            <div style={descStyle}>between inline items</div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={textStyle}>File</span>
              <TugSeparator orientation="vertical" />
              <span style={textStyle}>Edit</span>
              <TugSeparator orientation="vertical" />
              <span style={textStyle}>View</span>
              <TugSeparator orientation="vertical" />
              <span style={textStyle}>Help</span>
            </div>
          </div>

          <div>
            <div style={descStyle}>taller context — between card-like blocks</div>
            <div style={{ display: "flex", alignItems: "stretch", height: "80px" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={textStyle}>Panel A</span>
              </div>
              <TugSeparator orientation="vertical" />
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={textStyle}>Panel B</span>
              </div>
              <TugSeparator orientation="vertical" />
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={textStyle}>Panel C</span>
              </div>
            </div>
          </div>

          <div>
            <div style={descStyle}>with constrained height via length prop</div>
            <div style={{ display: "flex", alignItems: "center", height: "40px" }}>
              <span style={textStyle}>Left</span>
              <TugSeparator orientation="vertical" length="20px" />
              <span style={textStyle}>Right</span>
            </div>
          </div>

        </div>
      </div>

      <TugSeparator />

      {/* ---- SVG Ornament ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">SVG Ornament</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "480px" }}>
          <div>
            <div style={descStyle}>SVG at default size</div>
            <TugSeparator ornament={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8Z" />
              </svg>
            } />
          </div>
          <div>
            <div style={descStyle}>SVG scaled up with ornamentSize="2rem"</div>
            <TugSeparator ornamentSize="2rem" ornament={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8Z" />
              </svg>
            } />
          </div>
          <div>
            <div style={descStyle}>glyph scaled up with ornamentSize="2rem"</div>
            <TugSeparator ornament="❦" ornamentSize="2rem" />
          </div>
        </div>
      </div>

    </div>
  );
}
