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

import React, { useCallback, useId, useRef } from "react";
import {
  TugSheet,
  TugSheetTrigger,
  TugSheetContent,
  useTugSheet,
} from "@/components/tugways/tug-sheet";
import type { TugSheetHandle } from "@/components/tugways/tug-sheet";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugInput } from "@/components/tugways/tug-input";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { narrowValue } from "@/components/tugways/action-vocabulary";

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
 * Five sections:
 * 1. useTugSheet() hook — imperative Promise-based API (primary).
 * 2. Basic compound API (TugSheet / TugSheetTrigger / TugSheetContent) with a form.
 * 3. Sheet with optional `description` prop (aria-describedby).
 * 4. Imperative ref API (useRef<TugSheetHandle> + open() / close()).
 * 5. Rich scrollable content (checklist).
 */
export function GallerySheet() {
  // Controlled state for compound API sections
  const [basicOpen, setBasicOpen] = React.useState(false);
  const [descOpen, setDescOpen] = React.useState(false);
  const [richOpen, setRichOpen] = React.useState(false);

  // Section 4: imperative ref
  const sheetRef = useRef<TugSheetHandle>(null);
  const [imperativeOpen, setImperativeOpen] = React.useState(false);

  // Section 1: useTugSheet() hook
  const { showSheet, renderSheet } = useTugSheet();
  const [hookResult, setHookResult] = React.useState<string | undefined>(undefined);

  return (
    <div className="cg-content" data-testid="gallery-sheet">

      {/* ---- 1. useTugSheet() Hook ---- */}
      <div className="cg-section">
        <div className="cg-section-title">useTugSheet() Hook</div>
        <div style={labelStyle}>
          Imperative Promise API — call showSheet() anywhere, await the result. No compound JSX required.
        </div>
        {hookResult !== undefined && (
          <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)", marginBottom: "8px" }}>
            Last result: <code>{hookResult === "" || hookResult === undefined ? "(cancelled)" : JSON.stringify(hookResult)}</code>
          </div>
        )}
        <div style={{ display: "flex", gap: "8px" }}>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={async () => {
              const result = await showSheet({
                title: "Rename Card",
                description: "Enter a new name for this card.",
                content: (close) => (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={fieldRowStyle}>
                      <label style={fieldLabelStyle} htmlFor="hook-sheet-name">Card name</label>
                      <TugInput
                        id="hook-sheet-name"
                        size="sm"
                        placeholder="Untitled card"
                        defaultValue="My Project Notes"
                        autoFocus
                      />
                    </div>
                    <div className="tug-sheet-actions">
                      <TugPushButton emphasis="outlined" onClick={() => close()}>Cancel</TugPushButton>
                      <TugPushButton emphasis="filled" onClick={() => close("save")}>Save</TugPushButton>
                    </div>
                  </div>
                ),
              });
              setHookResult(result ?? "");
            }}
          >
            Rename Card
          </TugPushButton>
        </div>
        {renderSheet()}
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Basic Sheet ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Basic Sheet</div>
        <div style={labelStyle}>
          Compound API — TugSheet / TugSheetTrigger / TugSheetContent with a settings form
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet open={basicOpen} onOpenChange={setBasicOpen}>
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
              </div>
              <div className="tug-sheet-actions">
                <TugPushButton emphasis="outlined" onClick={() => setBasicOpen(false)}>Cancel</TugPushButton>
                <TugPushButton emphasis="filled" onClick={() => setBasicOpen(false)}>Save</TugPushButton>
              </div>
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Sheet with Description ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Sheet with Description</div>
        <div style={labelStyle}>
          Optional <code>description</code> prop — renders beneath the title, wired to aria-describedby
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet open={descOpen} onOpenChange={setDescOpen}>
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
              </div>
              <div className="tug-sheet-actions">
                <TugPushButton emphasis="outlined" onClick={() => setDescOpen(false)}>Cancel</TugPushButton>
                <TugPushButton emphasis="filled" onClick={() => setDescOpen(false)}>Invite</TugPushButton>
              </div>
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. Imperative API ---- */}
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
            </div>
            <div className="tug-sheet-actions">
              <TugPushButton emphasis="outlined" size="sm" onClick={() => sheetRef.current?.close()}>
                Cancel
              </TugPushButton>
              <TugPushButton emphasis="filled" onClick={() => sheetRef.current?.close()}>
                Apply
              </TugPushButton>
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

      {/* ---- 5. Rich Content ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Rich Content</div>
        <div style={labelStyle}>
          Scrollable content within the sheet&apos;s max-height constraint — checklist with multiple items
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet open={richOpen} onOpenChange={setRichOpen}>
            <TugSheetTrigger asChild>
              <TugPushButton emphasis="outlined" size="sm">Review Checklist</TugPushButton>
            </TugSheetTrigger>
            <TugSheetContent title="Pre-launch Checklist">
              <RichChecklistContent onClose={() => setRichOpen(false)} />
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

function RichChecklistContent({ onClose }: { onClose: () => void }) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.id, item.defaultChecked])),
  );

  const completedCount = Object.values(checked).filter(Boolean).length;

  // L11 migration pattern — dynamic sender case: each checkbox in the
  // list passes its item id as `senderId`, and the `toggle` handler
  // uses that id directly as the key into the `checked` record. Unlike
  // gallery-checkbox (static setter map), this card has an unbounded
  // list, so the handler pattern is a record-update keyed on sender.
  // The payload's boolean carries the new state, so no need to flip
  // the previous value — the user can't manufacture a stale-read
  // race because each dispatch carries the fresh value.
  const handleToggle = useCallback((event: ActionEvent) => {
    const sender = typeof event.sender === "string" ? event.sender : null;
    if (!sender) return;
    const v = narrowValue(event, (val): val is boolean => typeof val === "boolean");
    if (v === null) return;
    setChecked((prev) => ({ ...prev, [sender]: v }));
  }, []);

  const responderId = useId();
  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: { toggle: handleToggle },
  });

  return (
    <ResponderScope>
    <div
      style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >
      <div style={{ fontSize: "0.75rem", color: "var(--tug7-element-field-text-normal-label-rest)" }}>
        {completedCount} of {CHECKLIST_ITEMS.length} complete
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {CHECKLIST_ITEMS.map((item) => (
          <TugCheckbox
            key={item.id}
            checked={checked[item.id]}
            senderId={item.id}
            label={item.label}
            size="sm"
          />
        ))}
      </div>
      <div className="tug-sheet-actions">
        <TugPushButton emphasis="outlined" onClick={onClose}>Cancel</TugPushButton>
        <TugPushButton emphasis="filled" onClick={onClose}>Save</TugPushButton>
      </div>
    </div>
    </ResponderScope>
  );
}
