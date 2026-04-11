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

import React, { useCallback, useId, useMemo, useRef } from "react";
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
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

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
  // Section 4: imperative ref
  const sheetRef = useRef<TugSheetHandle>(null);

  // Section 1: useTugSheet() hook
  const { showSheet, renderSheet } = useTugSheet();
  const [hookResult, setHookResult] = React.useState<string | undefined>(undefined);

  // Chain manager — the compound-API sections close their sheets by
  // dispatching cancelDialog, matching the L11 pattern established by
  // TugConfirmPopover and TugAlert. Per-sheet sender ids disambiguate
  // so each sheet's own handler closes its own instance.
  const manager = useResponderChain();
  const basicSenderId = useId();
  const descSenderId = useId();
  const richSenderId = useId();

  const dispatchCancel = useCallback(
    (sender: string) => {
      manager?.sendToFirstResponder({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender,
        phase: "discrete",
      });
    },
    [manager],
  );

  return (
    <div className="cg-content" data-testid="gallery-sheet">

      {/* ---- 1. useTugSheet() Hook ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">useTugSheet() Hook</TugLabel>
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

      <TugSeparator />

      {/* ---- 2. Basic Sheet ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Basic Sheet</TugLabel>
        <div style={labelStyle}>
          Compound API — TugSheet / TugSheetTrigger / TugSheetContent with a settings form
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet>
            <TugSheetTrigger asChild>
              <TugPushButton emphasis="outlined" size="sm">Open Settings</TugPushButton>
            </TugSheetTrigger>
            <TugSheetContent title="Card Settings" senderId={basicSenderId}>
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
                <TugPushButton emphasis="outlined" onClick={() => dispatchCancel(basicSenderId)}>Cancel</TugPushButton>
                <TugPushButton emphasis="filled" onClick={() => dispatchCancel(basicSenderId)}>Save</TugPushButton>
              </div>
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 3. Sheet with Description ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Sheet with Description</TugLabel>
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
              senderId={descSenderId}
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
                <TugPushButton emphasis="outlined" onClick={() => dispatchCancel(descSenderId)}>Cancel</TugPushButton>
                <TugPushButton emphasis="filled" onClick={() => dispatchCancel(descSenderId)}>Invite</TugPushButton>
              </div>
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 4. Imperative API ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Imperative API</TugLabel>
        <div style={labelStyle}>
          useRef&lt;TugSheetHandle&gt; + sheetRef.current.open() / .close() — programmatic control
        </div>
        <TugSheet ref={sheetRef}>
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
            onClick={() => sheetRef.current?.close()}
          >
            Close
          </TugPushButton>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 5. Rich Content ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Rich Content</TugLabel>
        <div style={labelStyle}>
          Scrollable content within the sheet&apos;s max-height constraint — checklist with multiple items
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet>
            <TugSheetTrigger asChild>
              <TugPushButton emphasis="outlined" size="sm">Review Checklist</TugPushButton>
            </TugSheetTrigger>
            <TugSheetContent title="Pre-launch Checklist" senderId={richSenderId}>
              <RichChecklistContent onClose={() => dispatchCancel(richSenderId)} />
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

  // L11 migration via useResponderForm — dynamic sender variant.
  // Unlike other cards where each control gets a `useId()` gensym,
  // this card's senderIds come from data (the checklist item ids).
  // useResponderForm's bindings map just maps each item id to a
  // single-key setter that writes into the record. Rebuilt per render
  // since CHECKLIST_ITEMS is constant — useMemo keeps identity stable
  // for the handler cache.
  const toggleBindings = useMemo(() => {
    const map: Record<string, (v: boolean) => void> = {};
    for (const item of CHECKLIST_ITEMS) {
      map[item.id] = (v: boolean) => {
        setChecked((prev) => ({ ...prev, [item.id]: v }));
      };
    }
    return map;
  }, []);

  const { ResponderScope, responderRef } = useResponderForm({
    toggle: toggleBindings,
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
