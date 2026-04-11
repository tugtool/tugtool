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
import { TugLabel } from "@/components/tugways/tug-label";

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
      title: "Replace existing file?",
      message: 'A file named \u201cQ4 Report.pdf\u201d already exists in Downloads. Replacing it will overwrite the current version.',
    });
    setBasicResult(confirmed ? "confirmed" : "cancelled");
  }

  async function handleDangerAlert() {
    const confirmed = await showAlert({
      title: 'Delete \u201cDesign System v3\u201d?',
      message: "This card and all its contents will be permanently removed. You can't undo this action.",
      confirmLabel: "Delete",
      confirmRole: "danger",
      icon: "Trash2",
    });
    setDangerResult(confirmed ? "confirmed" : "cancelled");
  }

  async function handleCautionAlert() {
    const confirmed = await showAlert({
      title: "Discard unsaved changes?",
      message: 'You\'ve made changes to \u201cHomepage Copy\u201d that haven\'t been saved. Leaving now will discard them.',
      confirmLabel: "Discard",
      confirmRole: "danger",
      icon: "TriangleAlert",
    });
    setCautionResult(confirmed ? "confirmed" : "cancelled");
  }

  async function handleOkOnlyAlert() {
    const confirmed = await showAlert({
      title: "Export complete",
      message: 'Your workspace has been exported to \u201ctugtool-export-2026-03-28.zip\u201d and saved to your Downloads folder.',
      confirmLabel: "OK",
      cancelLabel: null,
    });
    setOkOnlyResult(confirmed ? "confirmed" : "cancelled");
  }

  async function handleRefAlert() {
    if (!alertRef.current) return;
    const confirmed = await alertRef.current.alert({
      title: "Send feedback?",
      message: "This will share your last session log with the Tugtool team to help diagnose the issue you reported.",
      confirmLabel: "Send",
    });
    setRefResult(confirmed ? "confirmed" : "cancelled");
  }

  return (
    <div className="cg-content" data-testid="gallery-alert">

      {/* ---- 1. Basic Alert (useTugAlert hook) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Basic Alert</TugLabel>
        <div style={labelStyle}>useTugAlert() hook — default action role, default info icon</div>
        <div style={{ display: "flex" }}>
          <TugPushButton emphasis="outlined" size="sm" onClick={handleBasicAlert}>
            Replace File
          </TugPushButton>
        </div>
        <div style={resultStyle}>
          Result: <strong>{basicResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Danger Confirmation ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Danger Confirmation</TugLabel>
        <div style={labelStyle}>confirmRole="danger", icon="Trash2" — destructive action guard</div>
        <div style={{ display: "flex" }}>
          <TugPushButton emphasis="filled" role="danger" size="sm" onClick={handleDangerAlert}>
            Delete Card
          </TugPushButton>
        </div>
        <div style={resultStyle}>
          Result: <strong>{dangerResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Caution Warning ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Caution Warning</TugLabel>
        <div style={labelStyle}>confirmRole="caution", icon="TriangleAlert" — potentially lossy action</div>
        <div style={{ display: "flex" }}>
          <TugPushButton emphasis="outlined" size="sm" onClick={handleCautionAlert}>
            Discard Changes
          </TugPushButton>
        </div>
        <div style={resultStyle}>
          Result: <strong>{cautionResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. OK-Only (no cancel) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">OK-Only (No Cancel)</TugLabel>
        <div style={labelStyle}>cancelLabel=null — single-button acknowledgement variant</div>
        <div style={{ display: "flex" }}>
          <TugPushButton emphasis="outlined" size="sm" onClick={handleOkOnlyAlert}>
            Export Workspace
          </TugPushButton>
        </div>
        <div style={resultStyle}>
          Result: <strong>{okOnlyResult}</strong>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 5. Ref-Based Imperative API ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Ref-Based Imperative API</TugLabel>
        <div style={labelStyle}>useRef&lt;TugAlertHandle&gt; + alertRef.current.alert() — alternative to provider pattern</div>
        {/* Standalone TugAlert instance for this section */}
        <TugAlert ref={alertRef} title="Send feedback?" />
        <div style={{ display: "flex" }}>
          <TugPushButton emphasis="outlined" size="sm" onClick={handleRefAlert}>
            Send Feedback
          </TugPushButton>
        </div>
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
