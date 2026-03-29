/**
 * gallery-sheet.tsx -- TugSheet demo tab for the Component Gallery.
 *
 * Shows TugSheet in four modes: basic compound API with a form, sheet with
 * optional description, imperative ref-based API, and rich scrollable content.
 * TugSheet portals into the gallery card via TugcardPortalContext — the sheet
 * drops from the title bar as a window shade, exactly as it does in production.
 *
 * @module components/tugways/cards/gallery-sheet
 */

import React, { useRef } from "react";
import {
  TugSheet,
  TugSheetTrigger,
  TugSheetContent,
} from "@/components/tugways/tug-sheet";
import type { TugSheetHandle } from "@/components/tugways/tug-sheet";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugInput } from "@/components/tugways/tug-input";

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
  display: "block",
};

const fieldGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const fieldRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

// ---------------------------------------------------------------------------
// GallerySheet
// ---------------------------------------------------------------------------

/**
 * GallerySheet -- TugSheet demo tab.
 *
 * Four sections:
 * 1. Basic compound API (TugSheet / TugSheetTrigger / TugSheetContent) with a form.
 * 2. Sheet with optional `description` prop (aria-describedby).
 * 3. Imperative ref API (useRef<TugSheetHandle> + open() / close()).
 * 4. Rich scrollable content (checklist).
 */
export function GallerySheet() {
  // Section 3: imperative ref
  const sheetRef = useRef<TugSheetHandle>(null);
  const [imperativeOpen, setImperativeOpen] = React.useState(false);

  return (
    <div className="cg-content" data-testid="gallery-sheet">

      {/* ---- 1. Basic Sheet ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Basic Sheet</div>
        <div style={labelStyle}>
          Compound API — TugSheet / TugSheetTrigger / TugSheetContent with a settings form
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet>
            <TugSheetTrigger asChild>
              <TugPushButton emphasis="outlined" size="sm">Open Settings</TugPushButton>
            </TugSheetTrigger>
            <TugSheetContent title="Card Settings">
              <div style={fieldGroupStyle}>
                <div style={fieldRowStyle}>
                  <label style={fieldLabelStyle} htmlFor="sheet-basic-name">Card name</label>
                  <TugInput
                    id="sheet-basic-name"
                    size="sm"
                    placeholder="Untitled card"
                    defaultValue="My Project Notes"
                  />
                </div>
                <div style={fieldRowStyle}>
                  <label style={fieldLabelStyle} htmlFor="sheet-basic-desc">Description</label>
                  <TugInput
                    id="sheet-basic-desc"
                    size="sm"
                    placeholder="Optional description"
                  />
                </div>
                <div style={{ display: "flex", gap: "8px", paddingTop: "4px" }}>
                  <TugPushButton emphasis="filled" size="sm">Save</TugPushButton>
                </div>
              </div>
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Sheet with Description ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Sheet with Description</div>
        <div style={labelStyle}>
          Optional <code>description</code> prop — renders beneath the title, wired to aria-describedby
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet>
            <TugSheetTrigger asChild>
              <TugPushButton emphasis="outlined" size="sm">Share Settings</TugPushButton>
            </TugSheetTrigger>
            <TugSheetContent
              title="Share Card"
              description="Choose who can view or edit this card. Changes take effect immediately."
            >
              <div style={fieldGroupStyle}>
                <div style={fieldRowStyle}>
                  <label style={fieldLabelStyle} htmlFor="sheet-desc-email">Invite by email</label>
                  <TugInput
                    id="sheet-desc-email"
                    size="sm"
                    type="email"
                    placeholder="colleague@example.com"
                  />
                </div>
                <div style={{ display: "flex", gap: "8px", paddingTop: "4px" }}>
                  <TugPushButton emphasis="filled" size="sm">Send Invite</TugPushButton>
                </div>
              </div>
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Imperative API ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Imperative API</div>
        <div style={labelStyle}>
          useRef&lt;TugSheetHandle&gt; + sheetRef.current.open() / .close() — programmatic control
        </div>
        <TugSheet
          ref={sheetRef}
          open={imperativeOpen}
          onOpenChange={setImperativeOpen}
        >
          {/* No TugSheetTrigger — opened programmatically */}
          <TugSheetContent title="Notifications">
            <div style={fieldGroupStyle}>
              <div style={fieldRowStyle}>
                <label style={fieldLabelStyle} htmlFor="sheet-imp-channel">Notification channel</label>
                <TugInput
                  id="sheet-imp-channel"
                  size="sm"
                  placeholder="#general"
                  defaultValue="#alerts"
                />
              </div>
              <div style={{ display: "flex", gap: "8px", paddingTop: "4px" }}>
                <TugPushButton emphasis="filled" size="sm" onClick={() => sheetRef.current?.close()}>
                  Apply
                </TugPushButton>
              </div>
            </div>
          </TugSheetContent>
        </TugSheet>
        <div style={{ display: "flex", gap: "8px" }}>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() => sheetRef.current?.open()}
          >
            Open
          </TugPushButton>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            disabled={!imperativeOpen}
            onClick={() => sheetRef.current?.close()}
          >
            Close
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. Rich Content ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Rich Content</div>
        <div style={labelStyle}>
          Scrollable content within the sheet&apos;s max-height constraint — checklist with multiple items
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet>
            <TugSheetTrigger asChild>
              <TugPushButton emphasis="outlined" size="sm">Review Checklist</TugPushButton>
            </TugSheetTrigger>
            <TugSheetContent title="Pre-launch Checklist">
              <RichChecklistContent />
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// RichChecklistContent — scrollable checklist for Section 4
// ---------------------------------------------------------------------------

const CHECKLIST_ITEMS = [
  { id: "cl-1", label: "Write copy for hero section", defaultChecked: true },
  { id: "cl-2", label: "Finalize color palette", defaultChecked: true },
  { id: "cl-3", label: "Add Open Graph metadata", defaultChecked: false },
  { id: "cl-4", label: "Test on mobile viewports", defaultChecked: false },
  { id: "cl-5", label: "Set up analytics tracking", defaultChecked: false },
  { id: "cl-6", label: "Review accessibility audit", defaultChecked: false },
  { id: "cl-7", label: "Configure production environment", defaultChecked: false },
  { id: "cl-8", label: "Run final performance check", defaultChecked: false },
  { id: "cl-9", label: "Send stakeholder review link", defaultChecked: false },
  { id: "cl-10", label: "Schedule launch announcement", defaultChecked: false },
];

function RichChecklistContent() {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.id, item.defaultChecked])),
  );

  const completedCount = Object.values(checked).filter(Boolean).length;

  function toggle(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
        {completedCount} of {CHECKLIST_ITEMS.length} complete
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {CHECKLIST_ITEMS.map((item) => (
          <label
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "0.875rem",
              color: checked[item.id]
                ? "var(--tug7-element-field-text-normal-label-rest)"
                : "var(--tug7-element-field-text-normal-value-rest)",
              cursor: "pointer",
              textDecoration: checked[item.id] ? "line-through" : "none",
            }}
          >
            <input
              type="checkbox"
              checked={checked[item.id]}
              onChange={() => toggle(item.id)}
              style={{ flexShrink: 0 }}
            />
            {item.label}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: "8px", paddingTop: "4px" }}>
        <TugPushButton emphasis="filled" size="sm">Save Progress</TugPushButton>
      </div>
    </div>
  );
}
