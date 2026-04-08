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

import React, { useCallback, useId, useState } from "react";
import { TugSwitch } from "@/components/tugways/tug-switch";
import type { TugSwitchRole, TugSwitchSize } from "@/components/tugways/tug-switch";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { narrowValue } from "@/components/tugways/action-vocabulary";

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

  // L11 migration pattern: this card is a responder that handles the
  // `toggle` action dispatched by its TugSwitch children. See
  // gallery-checkbox.tsx for the annotated reference implementation.
  const setters: Record<string, (v: boolean) => void> = {
    "sw-1": setEnabled1,
    "sw-2": setEnabled2,
  };
  const handleToggle = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : null;
    if (!sender) return;
    const setter = setters[sender];
    if (!setter) return;
    const v = narrowValue(event, (val): val is boolean => typeof val === "boolean");
    if (v === null) return;
    setter(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const responderId = useId();
  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: { toggle: handleToggle },
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
            senderId="sw-1"
            label={`Off → ${String(enabled1)}`}
          />
          <TugSwitch
            checked={enabled2}
            senderId="sw-2"
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
