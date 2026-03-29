/**
 * gallery-alert.tsx -- TugAlert demo tab for the Component Gallery.
 *
 * Shows TugAlert in all modes: basic alert, danger confirmation, caution warning,
 * OK-only (no cancel), and the ref-based imperative API.
 * All demos show a persistent result indicator.
 *
 * @module components/tugways/cards/gallery-alert
 */

import React from "react";
import { TugAlert, useTugAlert } from "@/components/tugways/tug-alert";
import type { TugAlertHandle } from "@/components/tugways/tug-alert";
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
// GalleryAlertInner — uses useTugAlert hook (must be inside TugAlertProvider)
// ---------------------------------------------------------------------------

function GalleryAlertInner() {
  const showAlert = useTugAlert();

  const [basicResult, setBasicResult] = React.useState("none");
  const [dangerResult, setDangerResult] = React.useState("none");
  const [cautionResult, setCautionResult] = React.useState("none");
  const [okOnlyResult, setOkOnlyResult] = React.useState("none");

  // Ref-based section
  const alertRef = React.useRef<TugAlertHandle>(null);
  const [refResult, setRefResult] = React.useState("none");

  async function handleBasicAlert() {
    const confirmed = await showAlert({
      title: "Alert Title",
      message: "This is an alert message.",
    });
    setBasicResult(confirmed ? "confirmed" : "cancelled");
  }

  async function handleDangerAlert() {
    const confirmed = await showAlert({
      title: "Delete Card",
      message: "This action cannot be undone.",
      confirmLabel: "Delete",
      confirmRole: "danger",
    });
    setDangerResult(confirmed ? "confirmed" : "cancelled");
  }

  async function handleCautionAlert() {
    const confirmed = await showAlert({
      title: "Unsaved Changes",
      message: "You have unsaved changes. Discard them?",
      confirmLabel: "Discard",
      confirmRole: "caution",
    });
    setCautionResult(confirmed ? "confirmed" : "cancelled");
  }

  async function handleOkOnlyAlert() {
    const confirmed = await showAlert({
      title: "Export Complete",
      message: "Your data has been exported successfully.",
      confirmLabel: "OK",
      cancelLabel: null,
    });
    setOkOnlyResult(confirmed ? "confirmed" : "cancelled");
  }

  async function handleRefAlert() {
    if (!alertRef.current) return;
    const confirmed = await alertRef.current.alert({
      title: "Ref-Based Alert",
      message: "This alert was opened via the imperative ref API.",
    });
    setRefResult(confirmed ? "confirmed" : "cancelled");
  }

  return (
    <div className="cg-content" data-testid="gallery-alert">

      {/* ---- 1. Basic Alert (useTugAlert hook) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Basic Alert</div>
        <div style={labelStyle}>useTugAlert() hook — default action role</div>
        <TugPushButton emphasis="outlined" size="sm" onClick={handleBasicAlert}>
          Show Alert
        </TugPushButton>
        <div style={resultStyle}>
          Result: <strong>{basicResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Danger Confirmation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Danger Confirmation</div>
        <div style={labelStyle}>confirmRole="danger" — destructive action guard</div>
        <TugPushButton emphasis="filled" role="danger" size="sm" onClick={handleDangerAlert}>
          Delete Card
        </TugPushButton>
        <div style={resultStyle}>
          Result: <strong>{dangerResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Caution Warning ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Caution Warning</div>
        <div style={labelStyle}>confirmRole="caution" — potentially lossy action</div>
        <TugPushButton emphasis="outlined" size="sm" onClick={handleCautionAlert}>
          Discard Changes
        </TugPushButton>
        <div style={resultStyle}>
          Result: <strong>{cautionResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. OK-Only (no cancel) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">OK-Only (No Cancel)</div>
        <div style={labelStyle}>cancelLabel=null — single-button acknowledgement variant</div>
        <TugPushButton emphasis="outlined" size="sm" onClick={handleOkOnlyAlert}>
          Export Data
        </TugPushButton>
        <div style={resultStyle}>
          Result: <strong>{okOnlyResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 5. Ref-Based Imperative API ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Ref-Based Imperative API</div>
        <div style={labelStyle}>useRef&lt;TugAlertHandle&gt; + alertRef.current.alert() — alternative to provider pattern</div>
        {/* Standalone TugAlert instance for this section */}
        <TugAlert ref={alertRef} title="Ref-Based Alert" />
        <TugPushButton emphasis="outlined" size="sm" onClick={handleRefAlert}>
          Show Ref Alert
        </TugPushButton>
        <div style={resultStyle}>
          Result: <strong>{refResult}</strong>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryAlert — public export
// ---------------------------------------------------------------------------

/**
 * GalleryAlert — TugAlert demo tab.
 *
 * Delegates to GalleryAlertInner which uses useTugAlert(). The TugAlertProvider
 * is already in the root render tree (added in Dash 2), so the hook works here.
 */
export function GalleryAlert() {
  return <GalleryAlertInner />;
}
