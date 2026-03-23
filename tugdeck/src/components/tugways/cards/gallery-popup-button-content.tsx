/**
 * GalleryPopupButtonContent — TugPopupButton gallery tab with design sliders.
 *
 * Provides interactive controls for tuning button and menu border-radius,
 * plus demos of TugPopupButton in various contexts.
 *
 * Because Radix renders the menu content into a portal at the document root,
 * CSS custom property scoping does not work. Instead, a <style> element is
 * injected into <head> with the slider-driven overrides.
 */

import React, { useState } from "react";
import { Star, Settings, Palette, ChevronDown } from "lucide-react";
import { TugButton } from "@/components/tugways/tug-button";
import { TugPopupMenu } from "@/components/tugways/tug-popup-menu";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupMenuItem } from "@/components/tugways/tug-popup-button";
import type { TugButtonSize } from "@/components/tugways/tug-button";
import "./gallery-popup-button.css";

// ---- Sample data ----

const SAMPLE_ITEMS: TugPopupMenuItem[] = [
  { id: "alpha", label: "Alpha", icon: <Star size={12} /> },
  { id: "beta", label: "Beta", icon: <Star size={12} /> },
  { id: "gamma", label: "Gamma" },
  { id: "delta", label: "Delta (disabled)", disabled: true },
];

const THEME_ITEMS: TugPopupMenuItem[] = [
  { id: "theme-alpha", label: "Alpha", icon: <Palette size={12} /> },
  { id: "theme-beta", label: "Beta", icon: <Palette size={12} /> },
  { id: "theme-gamma", label: "Gamma", icon: <Palette size={12} /> },
];

const SIZE_ITEMS: TugPopupMenuItem[] = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Medium" },
  { id: "lg", label: "Large" },
];

const ALL_SIZES: TugButtonSize[] = ["sm", "md", "lg"];

// ---- Content ----

export function GalleryPopupButtonContent() {
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  return (
    <div className="cg-content" data-testid="gallery-popup-button-content">

      {/* ---- Standard TugPopupButton (outlined-option) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugPopupButton — Standard (outlined-option)</div>
        <div className="gpb-demo-row">
          {ALL_SIZES.map((size) => (
            <div key={size} className="gpb-demo-item">
              <span className="gpb-demo-label">{size}</span>
              <div className="gpb-button-wrapper">
                <TugPopupButton
                  label="Select..."
                  size={size}
                  items={SAMPLE_ITEMS}
                  onSelect={(id) => setLastSelected(id)}
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
        <div className="cg-section-title">TugPopupMenu — Custom Triggers</div>
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
                items={THEME_ITEMS}
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
                items={SIZE_ITEMS}
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
                items={SAMPLE_ITEMS}
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
                items={SAMPLE_ITEMS}
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
                items={THEME_ITEMS}
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
                items={SAMPLE_ITEMS}
                onSelect={(id) => setLastSelected(id)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- In-context: control bar mockup ---- */}
      <div className="cg-section">
        <div className="cg-section-title">In Context — Control Bar</div>
        <div className="gpb-context-bar">
          <span className="gpb-context-label">Emphasis</span>
          <div className="gpb-button-wrapper">
            <TugPopupButton label="outlined" size="sm" items={[
              { id: "filled", label: "filled" },
              { id: "outlined", label: "outlined" },
              { id: "ghost", label: "ghost" },
            ]} onSelect={() => {}} />
          </div>
          <span className="gpb-context-label">Role</span>
          <div className="gpb-button-wrapper">
            <TugPopupButton label="action" size="sm" items={[
              { id: "accent", label: "accent" },
              { id: "action", label: "action" },
              { id: "danger", label: "danger" },
            ]} onSelect={() => {}} />
          </div>
          <span className="gpb-context-label">Size</span>
          <div className="gpb-button-wrapper">
            <TugPopupButton label="md" size="sm" items={SIZE_ITEMS} onSelect={() => {}} />
          </div>
        </div>
      </div>

    </div>
  );
}
