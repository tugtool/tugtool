/**
 * gallery-switch.tsx -- TugSwitch demo tab for the Component Gallery.
 *
 * Shows TugSwitch in all sizes, states, with labels, and disabled.
 *
 * Rules of Tugways compliance:
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-switch
 */

import React, { useId, useState } from "react";
import { TugSwitch } from "@/components/tugways/tug-switch";
import type { TugSwitchRole, TugSwitchSize } from "@/components/tugways/tug-switch";
import { useResponderForm } from "@/components/tugways/use-responder-form";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugSwitchSize[] = ["sm", "md", "lg"];

const ALL_ROLES: TugSwitchRole[] = [
  "option",
  "action",
  "agent",
  "data",
  "success",
  "caution",
  "danger",
];

// ---------------------------------------------------------------------------
// GallerySwitch
// ---------------------------------------------------------------------------

export function GallerySwitch() {
  // Controlled state for the interactive demo.
  const [enabled1, setEnabled1] = useState(false);
  const [enabled2, setEnabled2] = useState(true);

  // L11 migration pattern via useResponderForm — see gallery-checkbox.tsx
  // for the annotated reference. Gensym'd sender ids, declarative bindings.
  const sw1Id = useId();
  const sw2Id = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    toggle: {
      [sw1Id]: setEnabled1,
      [sw2Id]: setEnabled2,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-switch"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Size Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Size Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {ALL_SIZES.map((size) => (
            <TugSwitch key={size} size={size} label={`Size: ${size}`} defaultChecked />
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- States (Controlled) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">States (Controlled)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TugSwitch
            checked={enabled1}
            senderId={sw1Id}
            label={`Off → ${String(enabled1)}`}
          />
          <TugSwitch
            checked={enabled2}
            senderId={sw2Id}
            label={`On → ${String(enabled2)}`}
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Without Labels ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Without Labels</div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <TugSwitch aria-label="Feature A" />
          <TugSwitch aria-label="Feature B" defaultChecked />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Disabled ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Disabled</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TugSwitch disabled label="Disabled off" />
          <TugSwitch disabled defaultChecked label="Disabled on" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Settings Example ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Settings Example</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <TugSwitch label="Dark mode" defaultChecked />
          <TugSwitch label="Auto-save" defaultChecked />
          <TugSwitch label="Sound effects" />
          <TugSwitch label="Notifications" defaultChecked />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Role Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Role Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TugSwitch defaultChecked label="accent (default)" />
          {ALL_ROLES.map((role) => (
            <TugSwitch
              key={role}
              role={role}
              defaultChecked
              label={role}
            />
          ))}
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
