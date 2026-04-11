/**
 * gallery-cascade-inspector.tsx -- Cascade Inspector gallery tab content.
 *
 * Interactive demo tab for the StyleInspectorOverlay cascade inspector.
 * Provides a set of sample elements that exercise all token chain depths:
 *
 *   (a) TugPopupButton -- full three-layer chain: --tugx-menu-* -> --tug-* -> palette
 *   (b) TugButton -- two-layer chain: --tug-* -> palette (no comp token)
 *   (c) Colored div using --tug7-element-global-fill-normal-accent-rest -- base -> palette chain
 *   (d) Div using --tug7-surface-global-primary-normal-raised-rest -- non-chromatic base token, terminal hex
 *   (e) Div with direct palette var -- var(--tug-orange-light), direct TugColor provenance
 *
 * Rules of Tugways compliance:
 *   - Local useState for UI state only [D40]
 *   - Appearance via inline style (CSS custom properties), not React state [D08, D09]
 *   - No root.render() after initial mount [D40, D42]
 *
 * **Authoritative references:**
 *   [D06] Gallery tab (#d06-gallery-tab)
 *   Spec S03 (#s03-inspected-properties)
 *   (#scope, #new-files, #symbols)
 *
 * @module components/tugways/cards/gallery-cascade-inspector
 */

import React, { useId, useState } from "react";
import { Star } from "lucide-react";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import { TugLabel } from "@/components/tugways/tug-label";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sample items for the TugPopupButton demo within the Cascade Inspector tab. */
const INSPECTOR_DEMO_ITEMS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "item-alpha", label: "Alpha", icon: <Star size={12} /> },
  { action: TUG_ACTIONS.SET_VALUE, value: "item-beta", label: "Beta", icon: <Star size={12} /> },
  { action: TUG_ACTIONS.SET_VALUE, value: "item-gamma", label: "Gamma (disabled)", disabled: true },
];

// ---------------------------------------------------------------------------
// GalleryCascadeInspector
// ---------------------------------------------------------------------------

/**
 * GalleryCascadeInspector -- gallery tab content with inspectable demo elements.
 *
 * Renders a set of sample elements that exercise all token chain depths so that
 * the Shift+Option cascade inspector can be verified against real token resolution
 * paths in the running app.
 *
 * Activation instructions are shown at the top of the tab.
 *
 * **Authoritative reference:** [D06] Gallery tab (#d06-gallery-tab)
 */
export function GalleryCascadeInspector() {
  const [dropdownSelected, setDropdownSelected] = useState<string | null>(null);

  // L11 migration via useResponderForm — the demo popup dispatches
  // setValue with a string payload; its binding writes to local state
  // so the status line updates.
  const dropdownPopupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [dropdownPopupId]: setDropdownSelected,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-cascade-inspector"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Activation instructions ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Cascade Inspector Demo</TugLabel>
        <TugLabel size="2xs" color="muted" data-testid="inspector-instructions">Hold Shift+Option and hover the elements below to see the cascade inspector in action. Each sample exercises a different token chain depth. Click to pin the overlay; press Escape to close.</TugLabel>
      </div>

      <div className="cg-divider" />

      {/* ---- (a) TugPopupButton: three-layer chain --tugx-menu-* -> --tug-* -> palette ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">(a) TugPopupButton — three-layer chain</TugLabel>
        <TugLabel size="2xs" color="muted">--tugx-menu-* → --tug-* → palette variable</TugLabel>
        <div className="cg-variant-row" data-testid="inspector-sample-dropdown">
          <TugPopupButton
            label="Open Menu"
            size="sm"
            senderId={dropdownPopupId}
            items={INSPECTOR_DEMO_ITEMS}
          />
          {dropdownSelected !== null && (
            <TugLabel size="2xs" color="muted">{`Selected: ${dropdownSelected}`}</TugLabel>
          )}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- (b) TugButton: two-layer chain --tug-* -> palette (no comp token) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">(b) TugButton — two-layer chain (no comp token)</TugLabel>
        <TugLabel size="2xs" color="muted">--tug7-surface-control-primary-filled-accent-rest → palette variable. TugButton CSS references --tug-* directly — no --tug-button-* tokens are wired yet.</TugLabel>
        <div className="cg-variant-row" data-testid="inspector-sample-button">
          <TugPushButton emphasis="filled" role="accent" size="md">
            Filled Accent
          </TugPushButton>
          <TugPushButton size="md">
            Outlined Active
          </TugPushButton>
          <TugPushButton emphasis="ghost" size="md">
            Ghost Active
          </TugPushButton>
          <TugPushButton emphasis="filled" role="danger" size="md">
            Filled Danger
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- (c) Colored div: --tug7-element-global-fill-normal-accent-rest -> palette ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">(c) Base accent token — --tug7-element-global-fill-normal-accent-rest</TugLabel>
        <TugLabel size="2xs" color="muted">Background uses var(--tug7-element-global-fill-normal-accent-rest) → palette variable. Two-layer chain: base token → palette variable → TugColor provenance.</TugLabel>
        <div
          data-testid="inspector-sample-accent"
          style={{
            background: "var(--tug7-element-global-fill-normal-accent-rest)",
            padding: "16px 20px",
            borderRadius: "6px",
            color: "var(--tug7-element-global-text-normal-default-rest)",
            fontFamily: "ui-monospace, monospace",
            fontSize: "12px",
          }}
        >
          background: var(--tug7-element-global-fill-normal-accent-rest)
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- (d) Surface-raised div: non-chromatic base token, terminal hex ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">(d) Surface raised token — --tug7-surface-global-primary-normal-raised-rest</TugLabel>
        <TugLabel size="2xs" color="muted">Background uses var(--tug7-surface-global-primary-normal-raised-rest). Non-chromatic base token: chain terminates at a literal hex value (not a palette variable), so no TugColor provenance is shown.</TugLabel>
        <div
          data-testid="inspector-sample-surface"
          style={{
            background: "var(--tug7-surface-global-primary-normal-raised-rest)",
            padding: "16px 20px",
            borderRadius: "6px",
            color: "var(--tug7-element-global-text-normal-default-rest)",
            border: "1px solid var(--tug7-element-global-border-normal-default-rest)",
            fontFamily: "ui-monospace, monospace",
            fontSize: "12px",
          }}
        >
          background: var(--tug7-surface-global-primary-normal-raised-rest)
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- (e) Direct palette reference: var(--tug-orange-light) -> TugColor provenance ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">(e) Direct palette reference — --tug-orange-light</TugLabel>
        <TugLabel size="2xs" color="muted">Background uses var(--tug-orange-light) directly. Single-hop chain that terminates immediately at a palette variable — inspector shows TugColor provenance (hue: orange, preset: light) directly.</TugLabel>
        <div
          data-testid="inspector-sample-palette"
          style={{
            background: "var(--tug-orange-light)",
            padding: "16px 20px",
            borderRadius: "6px",
            color: "var(--tug7-element-global-text-normal-default-rest)",
            fontFamily: "ui-monospace, monospace",
            fontSize: "12px",
          }}
        >
          background: var(--tug-orange-light)
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
