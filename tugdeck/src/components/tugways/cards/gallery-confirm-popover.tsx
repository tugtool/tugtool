/**
 * gallery-confirm-popover.tsx -- TugConfirmPopover demo tab for the Component Gallery.
 *
 * Shows TugConfirmPopover in all modes: danger confirmation, action confirmation,
 * custom labels, positioning (bottom vs top), and the imperative Promise API.
 * All demos show a persistent result indicator.
 *
 * @module components/tugways/cards/gallery-confirm-popover
 */

import React from "react";
import {
  TugConfirmPopover,
  type TugConfirmPopoverHandle,
} from "@/components/tugways/tug-confirm-popover";
import { TugPushButton } from "@/components/tugways/tug-push-button";

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

// ---------------------------------------------------------------------------
// GalleryConfirmPopover
// ---------------------------------------------------------------------------

export function GalleryConfirmPopover() {
  const [dangerResult, setDangerResult] = React.useState("none");
  const [actionResult, setActionResult] = React.useState("none");
  const [customResult, setCustomResult] = React.useState("none");
  const [bottomResult, setBottomResult] = React.useState("none");
  const [topResult, setTopResult] = React.useState("none");
  const confirmRef = React.useRef<TugConfirmPopoverHandle>(null);
  const [promiseResult, setPromiseResult] = React.useState("none");

  async function handleDeleteWithPromise() {
    const confirmed = await confirmRef.current?.confirm();
    setPromiseResult(confirmed ? "confirmed" : "cancelled");
  }

  return (
    <div className="cg-content" data-testid="gallery-confirm-popover">

      {/* ---- 1. Danger Confirmation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Danger Confirmation</div>
        <div style={labelStyle}>Default role="danger" — delete action guard</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <TugConfirmPopover
            message="Are you sure?"
            confirmLabel="Delete"
            confirmRole="danger"
            onConfirm={() => setDangerResult("confirmed")}
            onCancel={() => setDangerResult("cancelled")}
          >
            <TugPushButton role="danger" emphasis="filled" size="sm">
              Delete Item
            </TugPushButton>
          </TugConfirmPopover>
        </div>
        <div style={resultStyle}>
          Result: <strong>{dangerResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Action Confirmation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Action Confirmation</div>
        <div style={labelStyle}>confirmRole="action" — non-destructive confirmation</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <TugConfirmPopover
            message="Are you sure?"
            confirmLabel="Publish"
            confirmRole="action"
            onConfirm={() => setActionResult("confirmed")}
            onCancel={() => setActionResult("cancelled")}
          >
            <TugPushButton role="action" emphasis="filled" size="sm">
              Publish
            </TugPushButton>
          </TugConfirmPopover>
        </div>
        <div style={resultStyle}>
          Result: <strong>{actionResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Custom Labels ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Custom Labels</div>
        <div style={labelStyle}>Custom confirmLabel and cancelLabel</div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <TugConfirmPopover
            message="Are you sure?"
            confirmLabel="Discard"
            cancelLabel="Keep Editing"
            onConfirm={() => setCustomResult("discarded")}
            onCancel={() => setCustomResult("kept editing")}
          >
            <TugPushButton emphasis="outlined" size="sm">
              Discard Changes
            </TugPushButton>
          </TugConfirmPopover>
        </div>
        <div style={resultStyle}>
          Result: <strong>{customResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. Positioning ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Positioning</div>
        <div style={labelStyle}>side="bottom" (default) vs side="top" — buttons always nearest to trigger</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <TugConfirmPopover
            message="Are you sure?"
            confirmLabel="Confirm"
            confirmRole="action"
            onConfirm={() => setBottomResult("confirmed")}
            onCancel={() => setBottomResult("cancelled")}
          >
            <TugPushButton emphasis="outlined" size="sm">
              Bottom (default)
            </TugPushButton>
          </TugConfirmPopover>

          <TugConfirmPopover
            message="Are you sure?"
            confirmLabel="Confirm"
            confirmRole="action"
            side="top"
            onConfirm={() => setTopResult("confirmed")}
            onCancel={() => setTopResult("cancelled")}
          >
            <TugPushButton emphasis="outlined" size="sm">
              Top
            </TugPushButton>
          </TugConfirmPopover>
        </div>
        <div style={resultStyle}>
          Bottom: <strong>{bottomResult}</strong> | Top: <strong>{topResult}</strong>
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
            message="Are you sure?"
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
        <div style={resultStyle}>
          Result: <strong>{promiseResult}</strong>
        </div>
      </div>

    </div>
  );
}
