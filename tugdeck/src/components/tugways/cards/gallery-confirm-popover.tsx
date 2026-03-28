/**
 * gallery-confirm-popover.tsx -- TugConfirmPopover demo tab for the Component Gallery.
 *
 * Shows TugConfirmPopover in all modes: danger confirmation, action confirmation,
 * custom labels, positioning (top vs bottom), and the imperative Promise API.
 *
 * @module components/tugways/cards/gallery-confirm-popover
 */

import React from "react";
import {
  TugConfirmPopover,
  type TugConfirmPopoverHandle,
} from "@/components/tugways/tug-confirm-popover";
import { TugPushButton } from "@/components/tugways/tug-push-button";

// ---------------------------------------------------------------------------
// GalleryConfirmPopover
// ---------------------------------------------------------------------------

export function GalleryConfirmPopover() {
  const confirmRef = React.useRef<TugConfirmPopoverHandle>(null);
  const [promiseResult, setPromiseResult] = React.useState<string | null>(null);

  async function handleDeleteWithPromise() {
    const confirmed = await confirmRef.current?.confirm();
    setPromiseResult(confirmed ? "confirmed" : "cancelled");
  }

  const labelStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: "var(--tug7-element-field-text-normal-label-rest)",
    marginBottom: "4px",
  };

  const resultStyle: React.CSSProperties = {
    fontSize: "0.875rem",
    color: "var(--tug7-element-field-text-normal-label-rest)",
    marginTop: "8px",
  };

  return (
    <div className="cg-content" data-testid="gallery-confirm-popover">

      {/* ---- 1. Danger Confirmation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Danger Confirmation</div>
        <div style={labelStyle}>Default role="danger" — delete action guard</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <TugConfirmPopover
            message="Delete this item? This action cannot be undone."
            confirmLabel="Delete"
            confirmRole="danger"
          >
            <TugPushButton role="danger" emphasis="filled" size="sm">
              Delete Item
            </TugPushButton>
          </TugConfirmPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Action Confirmation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Action Confirmation</div>
        <div style={labelStyle}>confirmRole="action" — non-destructive confirmation</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <TugConfirmPopover
            message="Publish this draft? It will become visible to all users."
            confirmLabel="Publish"
            confirmRole="action"
          >
            <TugPushButton role="action" emphasis="filled" size="sm">
              Publish
            </TugPushButton>
          </TugConfirmPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Custom Labels ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Custom Labels</div>
        <div style={labelStyle}>Custom confirmLabel and cancelLabel</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <TugConfirmPopover
            message="Discard all unsaved changes?"
            confirmLabel="Discard"
            cancelLabel="Keep Editing"
          >
            <TugPushButton emphasis="outlined" size="sm">
              Discard Changes
            </TugPushButton>
          </TugConfirmPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. Positioning ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Positioning</div>
        <div style={labelStyle}>side="top" (default) vs side="bottom"</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <TugConfirmPopover
            message="Confirm this action?"
            confirmLabel="Confirm"
            side="top"
          >
            <TugPushButton emphasis="outlined" size="sm">
              Top (default)
            </TugPushButton>
          </TugConfirmPopover>

          <TugConfirmPopover
            message="Confirm this action?"
            confirmLabel="Confirm"
            side="bottom"
          >
            <TugPushButton emphasis="outlined" size="sm">
              Bottom
            </TugPushButton>
          </TugConfirmPopover>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 5. Promise API ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Promise API</div>
        <div style={labelStyle}>Imperative confirm() via useRef — resolves true/false</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <TugConfirmPopover
            ref={confirmRef}
            message="Delete this item? This action cannot be undone."
            confirmLabel="Delete"
            confirmRole="danger"
          >
            <TugPushButton
              role="danger"
              emphasis="filled"
              size="sm"
              onClick={handleDeleteWithPromise}
            >
              Delete (Promise)
            </TugPushButton>
          </TugConfirmPopover>
        </div>
        {promiseResult !== null && (
          <div style={resultStyle}>
            Last result: <strong>{promiseResult}</strong>
          </div>
        )}
      </div>

    </div>
  );
}
