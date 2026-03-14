/**
 * gallery-checkbox-content.tsx -- TugCheckbox demo tab for the Component Gallery.
 *
 * Shows TugCheckbox in all sizes, states, with labels, and disabled.
 *
 * Rules of Tugways compliance:
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-checkbox-content
 */

import React, { useState } from "react";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import type { TugCheckboxRole, TugCheckboxSize, TugCheckedState } from "@/components/tugways/tug-checkbox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugCheckboxSize[] = ["sm", "md", "lg"];

const ALL_ROLES: TugCheckboxRole[] = [
  "accent",
  "action",
  "agent",
  "data",
  "success",
  "caution",
  "danger",
];

// ---------------------------------------------------------------------------
// GalleryCheckboxContent
// ---------------------------------------------------------------------------

export function GalleryCheckboxContent() {
  // Controlled state for the interactive demo
  const [checked1, setChecked1] = useState<TugCheckedState>(false);
  const [checked2, setChecked2] = useState<TugCheckedState>(true);
  const [checked3, setChecked3] = useState<TugCheckedState>("indeterminate");

  return (
    <div className="cg-content" data-testid="gallery-checkbox-content">

      {/* ---- Size Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Size Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {ALL_SIZES.map((size) => (
            <TugCheckbox key={size} size={size} label={`Size: ${size}`} defaultChecked />
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- States ---- */}
      <div className="cg-section">
        <div className="cg-section-title">States (Controlled)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TugCheckbox
            checked={checked1}
            onCheckedChange={setChecked1}
            label={`Unchecked → ${String(checked1)}`}
          />
          <TugCheckbox
            checked={checked2}
            onCheckedChange={setChecked2}
            label={`Checked → ${String(checked2)}`}
          />
          <TugCheckbox
            checked={checked3}
            onCheckedChange={setChecked3}
            label={`Indeterminate → ${String(checked3)}`}
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Without Labels ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Without Labels</div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <TugCheckbox aria-label="Option A" />
          <TugCheckbox aria-label="Option B" defaultChecked />
          <TugCheckbox aria-label="Option C" checked="indeterminate" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Disabled ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Disabled</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TugCheckbox disabled label="Disabled unchecked" />
          <TugCheckbox disabled defaultChecked label="Disabled checked" />
          <TugCheckbox disabled checked="indeterminate" label="Disabled indeterminate" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Group Example ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Group Example</div>
        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{
            fontSize: "0.8125rem",
            fontWeight: 500,
            color: "var(--tug-base-field-label)",
            marginBottom: "8px",
          }}>
            Notification preferences
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <TugCheckbox label="Email notifications" defaultChecked />
            <TugCheckbox label="Push notifications" defaultChecked />
            <TugCheckbox label="SMS notifications" />
            <TugCheckbox label="Slack notifications" defaultChecked />
          </div>
        </fieldset>
      </div>

      <div className="cg-divider" />

      {/* ---- Role Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Role Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {ALL_ROLES.map((role) => (
            <TugCheckbox
              key={role}
              role={role}
              checked
              label={role}
            />
          ))}
        </div>
      </div>

    </div>
  );
}
