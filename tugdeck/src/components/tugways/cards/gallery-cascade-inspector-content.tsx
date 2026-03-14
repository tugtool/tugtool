/**
 * gallery-cascade-inspector-content.tsx -- Cascade Inspector gallery tab content.
 *
 * Interactive demo tab for the StyleInspectorOverlay cascade inspector.
 * Provides a set of sample elements that exercise all token chain depths:
 *
 *   (a) TugPopupButton -- full three-layer chain: --tug-dropdown-* -> --tug-base-* -> palette
 *   (b) TugButton -- two-layer chain: --tug-base-* -> palette (no comp token)
 *   (c) Colored div using --tug-base-accent-default -- base -> palette chain
 *   (d) Div using --tug-base-surface-raised -- non-chromatic base token, terminal hex
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
 * @module components/tugways/cards/gallery-cascade-inspector-content
 */

import React, { useState } from "react";
import { Star } from "lucide-react";
import { TugPushButton } from "@/components/tugways/tug-button";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupMenuItem } from "@/components/tugways/tug-popup-button";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sample items for the TugPopupButton demo within the Cascade Inspector tab. */
const INSPECTOR_DEMO_ITEMS: TugPopupMenuItem[] = [
  { id: "item-alpha", label: "Alpha", icon: <Star size={12} /> },
  { id: "item-beta", label: "Beta", icon: <Star size={12} /> },
  { id: "item-gamma", label: "Gamma (disabled)", disabled: true },
];

// ---------------------------------------------------------------------------
// GalleryCascadeInspectorContent
// ---------------------------------------------------------------------------

/**
 * GalleryCascadeInspectorContent -- gallery tab content with inspectable demo elements.
 *
 * Renders a set of sample elements that exercise all token chain depths so that
 * the Shift+Option cascade inspector can be verified against real token resolution
 * paths in the running app.
 *
 * Activation instructions are shown at the top of the tab.
 *
 * **Authoritative reference:** [D06] Gallery tab (#d06-gallery-tab)
 */
export function GalleryCascadeInspectorContent() {
  const [dropdownSelected, setDropdownSelected] = useState<string | null>(null);

  return (
    <div className="cg-content" data-testid="gallery-cascade-inspector-content">

      {/* ---- Activation instructions ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Cascade Inspector Demo</div>
        <p className="cg-description" data-testid="inspector-instructions">
          Hold <kbd>Shift+Option</kbd> and hover the elements below to see the cascade
          inspector in action. Each sample exercises a different token chain depth.
          Click to pin the overlay; press <kbd>Escape</kbd> to close.
        </p>
      </div>

      <div className="cg-divider" />

      {/* ---- (a) TugPopupButton: three-layer chain --tug-dropdown-* -> --tug-base-* -> palette ---- */}
      <div className="cg-section">
        <div className="cg-section-title">
          (a) TugPopupButton — three-layer chain
        </div>
        <p className="cg-description">
          <code>--tug-dropdown-*</code> →{" "}
          <code>--tug-base-*</code> → palette variable
        </p>
        <div className="cg-variant-row" data-testid="inspector-sample-dropdown">
          <TugPopupButton
            label="Open Menu"
            size="sm"
            items={INSPECTOR_DEMO_ITEMS}
            onSelect={(id) => setDropdownSelected(id)}
          />
          {dropdownSelected !== null && (
            <span className="cg-demo-status">
              Selected: <code>{dropdownSelected}</code>
            </span>
          )}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- (b) TugButton: two-layer chain --tug-base-* -> palette (no comp token) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">
          (b) TugButton — two-layer chain (no comp token)
        </div>
        <p className="cg-description">
          <code>--tug-base-control-filled-accent-bg-rest</code> → palette variable.
          TugButton CSS references <code>--tug-base-*</code> directly — no{" "}
          <code>--tug-button-*</code> tokens are wired yet.
        </p>
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

      {/* ---- (c) Colored div: --tug-base-accent-default -> palette ---- */}
      <div className="cg-section">
        <div className="cg-section-title">
          (c) Base accent token — <code>--tug-base-accent-default</code>
        </div>
        <p className="cg-description">
          Background uses <code>var(--tug-base-accent-default)</code> → palette variable.
          Two-layer chain: base token → palette variable → TugColor provenance.
        </p>
        <div
          data-testid="inspector-sample-accent"
          style={{
            background: "var(--tug-base-accent-default)",
            padding: "16px 20px",
            borderRadius: "6px",
            color: "var(--tug-base-fg-default)",
            fontFamily: "ui-monospace, monospace",
            fontSize: "12px",
          }}
        >
          background: var(--tug-base-accent-default)
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- (d) Surface-raised div: non-chromatic base token, terminal hex ---- */}
      <div className="cg-section">
        <div className="cg-section-title">
          (d) Surface raised token — <code>--tug-base-surface-raised</code>
        </div>
        <p className="cg-description">
          Background uses <code>var(--tug-base-surface-raised)</code>.
          Non-chromatic base token: chain terminates at a literal hex value (not a
          palette variable), so no TugColor provenance is shown.
        </p>
        <div
          data-testid="inspector-sample-surface"
          style={{
            background: "var(--tug-base-surface-raised)",
            padding: "16px 20px",
            borderRadius: "6px",
            color: "var(--tug-base-fg-default)",
            border: "1px solid var(--tug-base-border-default)",
            fontFamily: "ui-monospace, monospace",
            fontSize: "12px",
          }}
        >
          background: var(--tug-base-surface-raised)
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- (e) Direct palette reference: var(--tug-orange-light) -> TugColor provenance ---- */}
      <div className="cg-section">
        <div className="cg-section-title">
          (e) Direct palette reference — <code>--tug-orange-light</code>
        </div>
        <p className="cg-description">
          Background uses <code>var(--tug-orange-light)</code> directly.
          Single-hop chain that terminates immediately at a palette variable —
          inspector shows TugColor provenance (hue: orange, preset: light) directly.
        </p>
        <div
          data-testid="inspector-sample-palette"
          style={{
            background: "var(--tug-orange-light)",
            padding: "16px 20px",
            borderRadius: "6px",
            color: "var(--tug-base-fg-default)",
            fontFamily: "ui-monospace, monospace",
            fontSize: "12px",
          }}
        >
          background: var(--tug-orange-light)
        </div>
      </div>

    </div>
  );
}
