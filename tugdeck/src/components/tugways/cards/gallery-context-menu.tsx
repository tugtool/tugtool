/**
 * gallery-context-menu.tsx -- TugContextMenu demo tab for the Component Gallery.
 *
 * Shows TugContextMenu in all configurations: basic usage, items with icons,
 * items with keyboard shortcuts, separators and labels, disabled items, and
 * wrapping a card-like UI element.
 *
 * @module components/tugways/cards/gallery-context-menu
 */

import React from "react";
import { Scissors, Copy, Clipboard } from "lucide-react";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugBadge } from "@/components/tugways/tug-badge";

// Shared label style for section annotations
const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

// Shared right-click region style
const regionStyle: React.CSSProperties = {
  padding: "2rem",
  borderRadius: "0.5rem",
  backgroundColor: "var(--tug7-surface-field-primary-normal-plain-rest)",
  border: "1px dashed var(--tug7-element-global-border-normal-default-rest)",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--tug7-element-field-text-normal-placeholder-rest)",
  userSelect: "none",
};

// ---------------------------------------------------------------------------
// GalleryContextMenu
// ---------------------------------------------------------------------------

export function GalleryContextMenu() {
  return (
    <div className="cg-content" data-testid="gallery-context-menu">

      {/* ---- 1. Basic ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Basic</div>
        <div style={{ maxWidth: "480px" }}>
          <TugContextMenu
            items={[
              { action: TUG_ACTIONS.CUT,   label: "Cut" },
              { action: TUG_ACTIONS.COPY,  label: "Copy" },
              { action: TUG_ACTIONS.PASTE, label: "Paste" },
            ]}
          >
            <div style={regionStyle}>Right-click here</div>
          </TugContextMenu>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. With Icons ---- */}
      <div className="cg-section">
        <div className="cg-section-title">With Icons</div>
        <div style={labelStyle}>icon prop — lucide-react icons rendered before the label</div>
        <div style={{ maxWidth: "480px" }}>
          <TugContextMenu
            items={[
              { action: TUG_ACTIONS.CUT,   label: "Cut",   icon: <Scissors size={14} aria-hidden="true" /> },
              { action: TUG_ACTIONS.COPY,  label: "Copy",  icon: <Copy     size={14} aria-hidden="true" /> },
              { action: TUG_ACTIONS.PASTE, label: "Paste", icon: <Clipboard size={14} aria-hidden="true" /> },
            ]}
          >
            <div style={regionStyle}>Right-click here</div>
          </TugContextMenu>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. With Shortcuts ---- */}
      <div className="cg-section">
        <div className="cg-section-title">With Shortcuts</div>
        <div style={labelStyle}>shortcut prop — keyboard hint rendered after the label</div>
        <div style={{ maxWidth: "480px" }}>
          <TugContextMenu
            items={[
              { action: TUG_ACTIONS.CUT,   label: "Cut",   shortcut: "⌘X" },
              { action: TUG_ACTIONS.COPY,  label: "Copy",  shortcut: "⌘C" },
              { action: TUG_ACTIONS.PASTE, label: "Paste", shortcut: "⌘V" },
            ]}
          >
            <div style={regionStyle}>Right-click here</div>
          </TugContextMenu>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. Separators and Labels ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Separators and Labels</div>
        <div style={labelStyle}>type="label" for section headers, type="separator" for dividers</div>
        <div style={{ maxWidth: "480px" }}>
          <TugContextMenu
            items={[
              { type: "label",                    label: "Edit" },
              { action: TUG_ACTIONS.UNDO,         label: "Undo" },
              { action: TUG_ACTIONS.REDO,         label: "Redo" },
              { type: "separator" },
              { type: "label",                    label: "Clipboard" },
              { action: TUG_ACTIONS.CUT,          label: "Cut" },
              { action: TUG_ACTIONS.COPY,         label: "Copy" },
              { action: TUG_ACTIONS.PASTE,        label: "Paste" },
              { type: "separator" },
              { action: TUG_ACTIONS.SELECT_ALL,   label: "Select All" },
            ]}
          >
            <div style={regionStyle}>Right-click here</div>
          </TugContextMenu>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 5. Disabled Items ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Disabled Items</div>
        <div style={labelStyle}>disabled={"{true}"} — non-interactive items rendered with reduced opacity</div>
        <div style={{ maxWidth: "480px" }}>
          <TugContextMenu
            items={[
              { action: TUG_ACTIONS.CUT,   label: "Cut",   disabled: true },
              { action: TUG_ACTIONS.COPY,  label: "Copy" },
              { action: TUG_ACTIONS.PASTE, label: "Paste", disabled: true },
            ]}
          >
            <div style={regionStyle}>Right-click here</div>
          </TugContextMenu>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 6. On a Card ---- */}
      <div className="cg-section">
        <div className="cg-section-title">On a Card</div>
        <div style={labelStyle}>primary use case — right-clicking a card-like UI element</div>
        <div style={{ maxWidth: "480px" }}>
          <TugContextMenu
            items={[
              { action: TUG_ACTIONS.CUT,       label: "Cut" },
              { action: TUG_ACTIONS.COPY,      label: "Copy" },
              { action: TUG_ACTIONS.PASTE,     label: "Paste" },
              { type: "separator" },
              { action: TUG_ACTIONS.DUPLICATE, label: "Duplicate" },
              { action: TUG_ACTIONS.DELETE,    label: "Delete" },
            ]}
          >
            <div
              style={{
                border: "1px solid var(--tug7-element-global-border-normal-default-rest)",
                borderRadius: "0.5rem",
                padding: "1rem 1.25rem",
                backgroundColor: "var(--tug7-surface-field-primary-normal-plain-rest)",
                cursor: "default",
                userSelect: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "0.375rem",
                }}
              >
                <span
                  style={{
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    color: "var(--tug7-element-field-text-normal-value-rest)",
                  }}
                >
                  Project Alpha
                </span>
                <TugBadge role="success" emphasis="tinted" size="sm">Active</TugBadge>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.8125rem",
                  color: "var(--tug7-element-field-text-normal-label-rest)",
                  lineHeight: "1.5",
                }}
              >
                Right-click this card to open the context menu with card-level actions.
              </p>
            </div>
          </TugContextMenu>
        </div>
      </div>

    </div>
  );
}
