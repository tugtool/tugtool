/**
 * gallery-sheet.tsx -- TugSheet demo tab for the Component Gallery.
 *
 * Shows TugSheet in its compound API (form), optional-description, imperative
 * ref-based, and rich-scrollable modes, plus the three presentation styles
 * (top / bottom / scale-fade). TugSheet portals into the gallery card via
 * TugPanePortalContext — the sheet animates in over the card exactly as it
 * does in production.
 *
 * @module components/tugways/cards/gallery-sheet
 */

import React, { useMemo, useRef } from "react";
import {
  TugSheet,
  TugSheetTrigger,
  TugSheetContent,
  useTugSheet,
  useTugSheetClose,
} from "@/components/tugways/tug-sheet";
import type { TugSheetHandle } from "@/components/tugways/tug-sheet";
import type { TugPushButtonProps } from "@/components/tugways/tug-push-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugInput } from "@/components/tugways/tug-input";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { rowGridOrder, type SpatialOrder } from "@/components/tugways/spatial-order";
import { useSpatialOrder } from "@/components/tugways/use-spatial-order";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

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
 * Six sections:
 * 1. useTugSheet() hook — imperative Promise-based API (primary).
 * 2. Presentation styles — top / bottom / scale-fade via the `presentation` prop.
 * 3. Basic compound API (TugSheet / TugSheetTrigger / TugSheetContent) with a form.
 * 4. Sheet with optional `description` prop (aria-describedby).
 * 5. Imperative ref API (useRef<TugSheetHandle> + open() / close()).
 * 6. Rich scrollable content (checklist).
 */
/**
 * SheetCloseButton -- TugPushButton that closes the enclosing TugSheet
 * via the chain-native path. Reads the sheet responder id from
 * TugSheetContext internally (via useTugSheetClose), so each button is
 * self-sufficient and does not need per-sheet senderId plumbing.
 */
function SheetCloseButton(props: TugPushButtonProps) {
  const close = useTugSheetClose();
  const { onClick, ...rest } = props;
  return (
    <TugPushButton
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        close();
      }}
    />
  );
}

/**
 * PresentationSheetBody -- shared body for the Presentation Styles demo.
 * Rendered inside a `useTugSheet()` sheet; the `close` callback comes
 * from the hook's content render function.
 */
function PresentationSheetBody({ close }: { close: (result?: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ fontSize: "0.8125rem", lineHeight: 1.5 }}>
        Reopen with a different style to compare — every style lands in the same
        position and size. Only the entrance and exit animation differ.
      </div>
      <div className="tug-sheet-actions">
        <TugPushButton emphasis="filled" onClick={() => close()}>Done</TugPushButton>
      </div>
    </div>
  );
}

// Spatial-order stops for the SpatialSheetBody demo: the radio group on top, the
// Cancel / Save button row below.
const SPATIAL_VISIBILITY_ORDER = 0;
const SPATIAL_CANCEL_ORDER = 1;
const SPATIAL_SAVE_ORDER = 2;

/**
 * SpatialSheetBody — a control-rich sheet body that declares a spatial arrow
 * order via the CONTEXT-derived `useSpatialOrder(order)` form ([P22] / [P23]).
 *
 * Unlike the dialogs, a sheet's trap lives in `TugSheet`; this body is rendered
 * inside that trap (a descendant of the sheet's `FocusModeScope`), so it has no
 * local `scopeId` and reads the enclosing `FocusModeContext` instead — the
 * mechanism that generalizes the spatial plane past dialogs to any composed trap.
 *
 * Two rows of non-list controls: a vertical radio group (a delegated item-group)
 * over a button row (Cancel ↔ Save). `rowGridOrder` makes the button row a closed
 * horizontal ring and a vertical seam cycle between the rows — Down off the radio
 * group's bottom edge crosses into the buttons, Up returns, Left / Right swap the
 * buttons. The navigator's liveliness fallback backstops any unnamed edge.
 */
function SpatialSheetBody() {
  const close = useTugSheetClose();
  const focusGroup = React.useId();
  const senderId = React.useId();
  const [visibility, setVisibility] = React.useState("team");

  const spatialOrder = React.useMemo<SpatialOrder>(
    () =>
      rowGridOrder([
        [`${focusGroup}:${SPATIAL_VISIBILITY_ORDER}`],
        [`${focusGroup}:${SPATIAL_CANCEL_ORDER}`, `${focusGroup}:${SPATIAL_SAVE_ORDER}`],
      ]),
    [focusGroup],
  );
  useSpatialOrder(spatialOrder);

  // Selection rides the responder chain ([L11]) — the same wiring the dialogs use.
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: { [senderId]: (next: string) => setVisibility(next) },
  });

  return (
    <ResponderScope>
      <div
        ref={responderRef}
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <TugRadioGroup
          orientation="vertical"
          size="md"
          label="Card visibility"
          senderId={senderId}
          value={visibility}
          focusGroup={focusGroup}
          focusOrder={SPATIAL_VISIBILITY_ORDER}
        >
          <TugRadioItem value="private">Private</TugRadioItem>
          <TugRadioItem value="team">Team</TugRadioItem>
          <TugRadioItem value="public">Public</TugRadioItem>
        </TugRadioGroup>
        <div className="tug-sheet-actions">
          <TugPushButton
            emphasis="outlined"
            focusGroup={focusGroup}
            focusOrder={SPATIAL_CANCEL_ORDER}
            onClick={() => close()}
          >
            Cancel
          </TugPushButton>
          <TugPushButton
            emphasis="primary"
            persistentDefaultRing
            focusGroup={focusGroup}
            focusOrder={SPATIAL_SAVE_ORDER}
            onClick={() => close()}
          >
            Save
          </TugPushButton>
        </div>
      </div>
    </ResponderScope>
  );
}

export function GallerySheet() {
  // Section 4: imperative ref
  const sheetRef = useRef<TugSheetHandle>(null);

  // Section 1: useTugSheet() hook
  const { showSheet, renderSheet } = useTugSheet();
  const [hookResult, setHookResult] = React.useState<string | undefined>(undefined);

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

      {/* ---- 2. Presentation Styles ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Presentation Styles</TugLabel>
        <div style={labelStyle}>
          Same fully-presented geometry, three entrance/exit animations via the{" "}
          <code>presentation</code> prop. Scale-fade — the default — fades in while
          scaling up; top is the window-shade drop; bottom mirrors it from below.
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() =>
              void showSheet({
                title: "Top",
                description: "Window-shade drop from the title bar.",
                presentation: "top",
                content: (close) => <PresentationSheetBody close={close} />,
              })
            }
          >
            Top
          </TugPushButton>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() =>
              void showSheet({
                title: "Bottom",
                description: "Slides up into place from below.",
                presentation: "bottom",
                content: (close) => <PresentationSheetBody close={close} />,
              })
            }
          >
            Bottom
          </TugPushButton>
          <TugPushButton
            emphasis="outlined"
            size="sm"
            onClick={() =>
              void showSheet({
                title: "Scale / Fade (default)",
                description: "Fades in while scaling up — no directional slide. The default.",
                presentation: "scale-fade",
                content: (close) => <PresentationSheetBody close={close} />,
              })
            }
          >
            Scale / Fade
          </TugPushButton>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 3. Basic Sheet ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Basic Sheet</TugLabel>
        <div style={labelStyle}>
          Compound API — TugSheet / TugSheetTrigger / TugSheetContent with a settings form
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet componentStatePreservationKey="sheet-basic">
            <TugSheetTrigger asChild>
              <TugPushButton
                emphasis="outlined"
                size="sm"
                data-testid="gallery-sheet-trigger"
              >
                Open Settings
              </TugPushButton>
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
                {/*
                 * SheetPopupContent — TugPopupButton inside this
                 * sheet exercises [D09] popup-in-sheet z-tier
                 * elevation. The menu portals to the canvas overlay
                 * root just like the sheet itself, but consumes
                 * TugSheetStackingContext (provided by TugSheetContent)
                 * to apply `tug-menu-in-dialog` and swap to the
                 * elevated --tug-z-overlay-menu-in-dialog token.
                 *
                 * Also serves as the deterministic fixture for the
                 * at0057 / at0058 app-tests.
                 */}
                <SheetPopupContent />
              </div>
              <div className="tug-sheet-actions">
                <SheetCloseButton emphasis="outlined">Cancel</SheetCloseButton>
                <SheetCloseButton emphasis="filled">Save</SheetCloseButton>
              </div>
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 4. Sheet with Description ---- */}
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
                <SheetCloseButton emphasis="outlined">Cancel</SheetCloseButton>
                <SheetCloseButton emphasis="filled">Invite</SheetCloseButton>
              </div>
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 5. Imperative API ---- */}
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

      {/* ---- 6. Rich Content ---- */}
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
            <TugSheetContent title="Pre-launch Checklist">
              <RichChecklistContent />
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <TugSeparator />

      {/* ---- 7. Spatial Arrow Order ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Spatial Arrow Order</TugLabel>
        <div style={labelStyle}>
          A non-dialog trap declaring its spatial order via the context-derived{" "}
          <code>useSpatialOrder(order)</code> — arrows rove the radio group and seam
          to the Cancel / Save row; Left/Right swap the buttons. Tab still cycles.
        </div>
        <div style={{ display: "flex" }}>
          <TugSheet componentStatePreservationKey="sheet-spatial">
            <TugSheetTrigger asChild>
              <TugPushButton
                emphasis="outlined"
                size="sm"
                data-testid="gallery-spatial-sheet-trigger"
              >
                Open Spatial Sheet
              </TugPushButton>
            </TugSheetTrigger>
            <TugSheetContent title="Card Visibility">
              <SpatialSheetBody />
            </TugSheetContent>
          </TugSheet>
        </div>
      </div>

      <TugSeparator />

    </div>
  );
}

// ---------------------------------------------------------------------------
// SheetPopupContent — TugPopupButton inside a sheet for [D09] demo.
// ---------------------------------------------------------------------------

const COLOR_OPTIONS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "red", label: "Red" },
  { action: TUG_ACTIONS.SET_VALUE, value: "green", label: "Green" },
  { action: TUG_ACTIONS.SET_VALUE, value: "blue", label: "Blue" },
];

function SheetPopupContent() {
  const colorSenderId = React.useId();
  const [color, setColor] = React.useState<string>("red");

  const setValueStringBindings = useMemo(
    () => ({
      [colorSenderId]: (value: string) => setColor(value),
    }),
    [colorSenderId],
  );

  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: setValueStringBindings,
  });

  return (
    <ResponderScope>
      <div
        style={fieldRowStyle}
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <label style={fieldLabelStyle}>
          Color (selected: <code data-testid="sheet-popup-color-readout">{color}</code>)
        </label>
        <TugPopupButton
          label={color.charAt(0).toUpperCase() + color.slice(1)}
          items={COLOR_OPTIONS}
          senderId={colorSenderId}
          size="sm"
        />
      </div>
    </ResponderScope>
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
        <SheetCloseButton emphasis="outlined">Cancel</SheetCloseButton>
        <SheetCloseButton emphasis="filled">Save</SheetCloseButton>
      </div>
    </div>
    </ResponderScope>
  );
}
