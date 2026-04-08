/**
 * gallery-checkbox.tsx -- TugCheckbox demo tab for the Component Gallery.
 *
 * Shows TugCheckbox in all sizes, states, with labels, and disabled.
 *
 * L11 migration pattern template. This card is the reference
 * implementation for every other A2 substep: register as a
 * responder via `useResponder`, handle the `toggle` action,
 * disambiguate senders with explicit `senderId` props.
 *
 * Rules of Tugways compliance:
 *   - No root.render() after initial mount [D40, D42]
 *   - [L11] controls emit actions; responders handle actions.
 *
 * @module components/tugways/cards/gallery-checkbox
 */

import React, { useCallback, useId, useState } from "react";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import type { TugCheckboxRole, TugCheckboxSize, TugCheckedState } from "@/components/tugways/tug-checkbox";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { narrowValue } from "@/components/tugways/action-vocabulary";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugCheckboxSize[] = ["sm", "md", "lg"];

const ALL_ROLES: TugCheckboxRole[] = [
  "option",
  "action",
  "agent",
  "data",
  "success",
  "caution",
  "danger",
];

// ---------------------------------------------------------------------------
// GalleryCheckbox
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// L11 migration pattern — the reference shape for every other A2 substep
// ---------------------------------------------------------------------------
//
// This card owns three pieces of state (checked1/2/3) and renders three
// TugCheckbox controls bound to them. Under the old callback-prop model,
// each checkbox had its own `onCheckedChange` prop wired to a state
// setter. After A2.1 there is no `onCheckedChange` — instead:
//
// 1. The card becomes a responder via `useResponder`, registering a
//    `toggle` action handler.
// 2. Each checkbox gets an explicit `senderId` prop that identifies it
//    within this card. When the user toggles a checkbox, it dispatches
//    `{ action: "toggle", value: <boolean>, sender: <senderId>, phase: "discrete" }`
//    through the chain.
// 3. The chain walks from the innermost responder (the clicked
//    checkbox's nearest ancestor responder — this card, because
//    useResponder wrote `data-responder-id` on our wrapper div via
//    `responderRef`) upward, finds our `toggle` handler, and calls it.
// 4. The handler uses `event.sender` to look up the right state setter
//    and `narrowValue` to defensively extract the boolean payload,
//    then calls the setter.
// 5. React re-renders; the checkbox's `checked` prop flows through;
//    Radix updates the DOM state.
//
// Every subsequent A2 substep follows this exact shape: identify
// controlled state, register as a responder, map senderIds to
// setters, narrowValue the payload, call the setter.
//
// Note on senderIds: choose short, stable, semantic strings ("cb-1",
// "notifications", etc.). They never leave this file — no external
// code consumes them — so they only need to be unique within the
// card's actions handler.

export function GalleryCheckbox() {
  // Controlled state for the interactive demo.
  const [checked1, setChecked1] = useState<TugCheckedState>(false);
  const [checked2, setChecked2] = useState<TugCheckedState>(true);
  const [checked3, setChecked3] = useState<TugCheckedState>("indeterminate");

  // Map senderId → setter. Kept as a single source of truth so the
  // toggle handler below is a simple lookup.
  const setters: Record<string, (v: TugCheckedState) => void> = {
    "cb-1": setChecked1,
    "cb-2": setChecked2,
    "cb-3": setChecked3,
  };

  // Handle `toggle` actions dispatched by any TugCheckbox whose
  // senderId matches one of our keys. Defensive narrowing on the
  // payload per the narrowValue convention [audit Part 7 Hole 2].
  const handleToggle = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : null;
    if (!sender) return;
    const setter = setters[sender];
    if (!setter) return;
    const v = narrowValue(event, (val): val is boolean => typeof val === "boolean");
    if (v === null) return;
    setter(v);
  // Setters are stable (useState), so the handler's identity doesn't
  // need to change between renders; useResponder's live Proxy reads
  // from optionsRef on every dispatch anyway (audit R5).
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
      data-testid="gallery-checkbox"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

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
            senderId="cb-1"
            label={`Unchecked → ${String(checked1)}`}
          />
          <TugCheckbox
            checked={checked2}
            senderId="cb-2"
            label={`Checked → ${String(checked2)}`}
          />
          <TugCheckbox
            checked={checked3}
            senderId="cb-3"
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
          <TugCheckbox aria-label="Option C" defaultChecked />
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
            color: "var(--tug7-element-field-text-normal-label-rest)",
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
          <TugCheckbox defaultChecked label="accent (default)" />
          {ALL_ROLES.map((role) => (
            <TugCheckbox
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
