/**
 * GalleryPopupButton — TugPopupButton and TugPopupMenu demos for the Component Gallery.
 *
 * Shows TugPopupButton (the convenience wrapper with fixed outlined-option style)
 * and TugPopupMenu (the headless menu composed with custom triggers).
 *
 * After A2.5, TugPopupButton items carry a typed `action` field and an
 * optional `value` payload; activation dispatches through the responder
 * chain. The gallery card uses a single `useResponderForm` with a
 * `setValueString` binding to observe the dispatches and write the demo
 * status state. The `TugPopupMenu` direct-usage section stays on the
 * callback-based API because `TugPopupMenu` is the headless building
 * block for composition cases (tab bar, completion menu, custom
 * triggers).
 */

import React, { useId, useState } from "react";
import { Star, Settings, Palette, ChevronDown } from "lucide-react";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import type { TugButtonSize } from "@/components/tugways/internal/tug-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import "./gallery-popup-button.css";
import { TUG_ACTIONS } from "../action-vocabulary";
import { TugLabel } from "@/components/tugways/tug-label";

// ---- Sample data ----
//
// Every TugPopupButton item dispatches `setValue` with the `value` field
// as the payload. The parent card's `setValueString` binding writes the
// value into local demo state so the status line can display it.

const SAMPLE_ITEMS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "alpha", label: "Alpha", icon: <Star size={12} /> },
  { action: TUG_ACTIONS.SET_VALUE, value: "beta", label: "Beta", icon: <Star size={12} /> },
  { action: TUG_ACTIONS.SET_VALUE, value: "gamma", label: "Gamma" },
  { action: TUG_ACTIONS.SET_VALUE, value: "delta", label: "Delta (disabled)", disabled: true },
];

const SIZE_ITEMS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "sm", label: "Small" },
  { action: TUG_ACTIONS.SET_VALUE, value: "md", label: "Medium" },
  { action: TUG_ACTIONS.SET_VALUE, value: "lg", label: "Large" },
];

const EMPHASIS_ITEMS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "filled", label: "filled" },
  { action: TUG_ACTIONS.SET_VALUE, value: "outlined", label: "outlined" },
  { action: TUG_ACTIONS.SET_VALUE, value: "ghost", label: "ghost" },
];

const ROLE_ITEMS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "accent", label: "accent" },
  { action: TUG_ACTIONS.SET_VALUE, value: "action", label: "action" },
  { action: TUG_ACTIONS.SET_VALUE, value: "danger", label: "danger" },
];

const ALL_SIZES: TugButtonSize[] = ["sm", "md", "lg"];

// ---- Content ----

export function GalleryPopupButton() {
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  // L11 migration via useResponderForm — every TugPopupButton in this
  // card shares a single `setValueString` binding that writes to
  // `lastSelected`. Each popup-button gets its own gensym'd senderId
  // bound to the same setter closure so every one updates the same
  // status line. ALL_SIZES is a known-length array (sm, md, lg) so we
  // call useId() three times at the top level to satisfy the Rules of
  // Hooks — no useId-in-loop.
  const sampleSmPopupId = useId();
  const sampleMdPopupId = useId();
  const sampleLgPopupId = useId();
  const sampleSizePopupIds: Record<TugButtonSize, string> = {
    sm: sampleSmPopupId,
    md: sampleMdPopupId,
    lg: sampleLgPopupId,
  };
  const contextEmphasisPopupId = useId();
  const contextRolePopupId = useId();
  const contextSizePopupId = useId();
  // TugPopupMenu direct-usage section stays callback-based (it's the
  // internal headless building block). Those callbacks still write to
  // `setLastSelected` directly.

  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [sampleSmPopupId]: setLastSelected,
      [sampleMdPopupId]: setLastSelected,
      [sampleLgPopupId]: setLastSelected,
      [contextEmphasisPopupId]: setLastSelected,
      [contextRolePopupId]: setLastSelected,
      [contextSizePopupId]: setLastSelected,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-popup-button"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Standard TugPopupButton (outlined-option) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugPopupButton — Convenience Wrapper</TugLabel>
        <div className="gpb-demo-row">
          {ALL_SIZES.map((size) => (
            <div key={size} className="gpb-demo-item">
              <span className="gpb-demo-label">{size}</span>
              <div className="gpb-button-wrapper">
                <TugPopupButton
                  label="Select..."
                  size={size}
                  senderId={sampleSizePopupIds[size]}
                  items={SAMPLE_ITEMS}
                />
              </div>
            </div>
          ))}
        </div>
        {lastSelected !== null && (
          <div className="gpb-status">Selected: <code>{lastSelected}</code></div>
        )}
      </div>

      <div className="cg-divider" />

      {/* ---- Custom triggers via TugPopupMenu ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugPopupMenu — Direct Usage (Custom Triggers)</TugLabel>
        <div className="gpb-demo-row">
          <div className="gpb-demo-item">
            <span className="gpb-demo-label">filled-accent</span>
            <div className="gpb-button-wrapper">
              <TugPopupMenu
                trigger={
                  <TugButton emphasis="filled" role="accent" size="sm" trailingIcon={<ChevronDown size={12} />}>
                    Theme
                  </TugButton>
                }
                items={[
                  { id: "theme-alpha", label: "Alpha", icon: <Palette size={12} /> },
                  { id: "theme-beta", label: "Beta", icon: <Palette size={12} /> },
                  { id: "theme-gamma", label: "Gamma", icon: <Palette size={12} /> },
                ]}
                onSelect={(id) => setLastSelected(id)}
              />
            </div>
          </div>
          <div className="gpb-demo-item">
            <span className="gpb-demo-label">outlined-action</span>
            <div className="gpb-button-wrapper">
              <TugPopupMenu
                trigger={
                  <TugButton emphasis="outlined" role="action" size="sm" trailingIcon={<ChevronDown size={12} />}>
                    Size
                  </TugButton>
                }
                items={[
                  { id: "sm", label: "Small" },
                  { id: "md", label: "Medium" },
                  { id: "lg", label: "Large" },
                ]}
                onSelect={(id) => setLastSelected(id)}
              />
            </div>
          </div>
          <div className="gpb-demo-item">
            <span className="gpb-demo-label">ghost-action</span>
            <div className="gpb-button-wrapper">
              <TugPopupMenu
                trigger={
                  <TugButton emphasis="ghost" role="action" size="sm" trailingIcon={<ChevronDown size={12} />}>
                    Options
                  </TugButton>
                }
                items={[
                  { id: "alpha", label: "Alpha", icon: <Star size={12} /> },
                  { id: "beta", label: "Beta", icon: <Star size={12} /> },
                  { id: "gamma", label: "Gamma" },
                  { id: "delta", label: "Delta (disabled)", disabled: true },
                ]}
                onSelect={(id) => setLastSelected(id)}
              />
            </div>
          </div>
          <div className="gpb-demo-item">
            <span className="gpb-demo-label">icon+text</span>
            <div className="gpb-button-wrapper">
              <TugPopupMenu
                trigger={
                  <TugButton emphasis="filled" role="action" size="sm" subtype="icon-text" icon={<Settings size={14} />} trailingIcon={<ChevronDown size={12} />}>
                    Settings
                  </TugButton>
                }
                items={[
                  { id: "alpha", label: "Alpha", icon: <Star size={12} /> },
                  { id: "beta", label: "Beta", icon: <Star size={12} /> },
                  { id: "gamma", label: "Gamma" },
                  { id: "delta", label: "Delta (disabled)", disabled: true },
                ]}
                onSelect={(id) => setLastSelected(id)}
              />
            </div>
          </div>
          <div className="gpb-demo-item">
            <span className="gpb-demo-label">icon+text outlined</span>
            <div className="gpb-button-wrapper">
              <TugPopupMenu
                trigger={
                  <TugButton emphasis="outlined" role="action" size="sm" subtype="icon-text" icon={<Palette size={14} />} trailingIcon={<ChevronDown size={12} />}>
                    Theme
                  </TugButton>
                }
                items={[
                  { id: "theme-alpha", label: "Alpha", icon: <Palette size={12} /> },
                  { id: "theme-beta", label: "Beta", icon: <Palette size={12} /> },
                  { id: "theme-gamma", label: "Gamma", icon: <Palette size={12} /> },
                ]}
                onSelect={(id) => setLastSelected(id)}
              />
            </div>
          </div>
          <div className="gpb-demo-item">
            <span className="gpb-demo-label">icon-only</span>
            <div className="gpb-button-wrapper">
              <TugPopupMenu
                trigger={
                  <TugButton emphasis="outlined" role="action" size="sm" subtype="icon" icon={<Settings size={14} />} aria-label="Settings" />
                }
                items={[
                  { id: "alpha", label: "Alpha", icon: <Star size={12} /> },
                  { id: "beta", label: "Beta", icon: <Star size={12} /> },
                  { id: "gamma", label: "Gamma" },
                  { id: "delta", label: "Delta (disabled)", disabled: true },
                ]}
                onSelect={(id) => setLastSelected(id)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- In-context: control bar mockup ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">In Context — Control Bar</TugLabel>
        <div className="gpb-context-bar">
          <span className="gpb-context-label">Emphasis</span>
          <div className="gpb-button-wrapper">
            <TugPopupButton
              label="outlined"
              size="sm"
              senderId={contextEmphasisPopupId}
              items={EMPHASIS_ITEMS}
            />
          </div>
          <span className="gpb-context-label">Role</span>
          <div className="gpb-button-wrapper">
            <TugPopupButton
              label="action"
              size="sm"
              senderId={contextRolePopupId}
              items={ROLE_ITEMS}
            />
          </div>
          <span className="gpb-context-label">Size</span>
          <div className="gpb-button-wrapper">
            <TugPopupButton
              label="md"
              size="sm"
              senderId={contextSizePopupId}
              items={SIZE_ITEMS}
            />
          </div>
        </div>
      </div>

    </div>
    </ResponderScope>
  );
}
