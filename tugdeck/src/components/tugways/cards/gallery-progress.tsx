/**
 * gallery-progress.tsx -- TugProgress demo tab for the Component Gallery.
 *
 * Shows TugProgress in all variants: spinner (indeterminate + labeled),
 * bar (indeterminate + determinate), ring (indeterminate + determinate),
 * an interactive transition demo, role colors, disabled states, and
 * TugBox disabled cascade.
 *
 * @module components/tugways/cards/gallery-progress
 */

import React, { useState } from "react";
import { TugProgress } from "@/components/tugways/tug-progress";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugBox } from "@/components/tugways/tug-box";
import { TugLabel } from "@/components/tugways/tug-label";

// ---------------------------------------------------------------------------
// GalleryProgress
// ---------------------------------------------------------------------------

export function GalleryProgress() {
  const [barTransValue, setBarTransValue] = useState<number | undefined>(undefined);
  const [barTransRunning, setBarTransRunning] = useState(false);
  const [ringTransValue, setRingTransValue] = useState<number | undefined>(undefined);
  const [ringTransRunning, setRingTransRunning] = useState(false);
  const [pieTransValue, setPieTransValue] = useState<number | undefined>(undefined);
  const [pieTransRunning, setPieTransRunning] = useState(false);

  function startTransition(
    setVal: (v: number | undefined) => void,
    setRunning: (r: boolean) => void,
  ) {
    setRunning(true);
    setVal(undefined);
    setTimeout(() => {
      let current = 0;
      setVal(0);
      const interval = setInterval(() => {
        current += 0.05;
        if (current >= 1) {
          current = 1;
          setVal(1);
          clearInterval(interval);
          setRunning(false);
        } else {
          setVal(current);
        }
      }, 200);
    }, 2000);
  }

  return (
    <div className="cg-content" data-testid="gallery-progress">

      {/* ---- 1. Spinner — Indeterminate ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Spinner — Indeterminate</TugLabel>
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <TugProgress variant="spinner" size="sm" aria-label="Loading" />
          <TugProgress variant="spinner" size="md" aria-label="Loading" />
          <TugProgress variant="spinner" size="lg" aria-label="Loading" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 2. Spinner — With Label ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Spinner — With Label</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <TugProgress variant="spinner" label="Loading..." />
          <TugProgress variant="spinner" value={0.47} label="47% complete" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 3. Bar — Indeterminate ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Bar — Indeterminate</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "480px" }}>
          <TugProgress variant="bar" size="sm" aria-label="Processing" />
          <TugProgress variant="bar" size="md" aria-label="Processing" />
          <TugProgress variant="bar" size="lg" aria-label="Processing" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 4. Bar — Determinate ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Bar — Determinate</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "480px" }}>
          <TugProgress variant="bar" value={0} label="0% — Not started" />
          <TugProgress variant="bar" value={0.25} label="25% — Quarter done" />
          <TugProgress variant="bar" value={0.5} label="50% — Halfway" />
          <TugProgress variant="bar" value={0.75} label="75% — Almost there" />
          <TugProgress variant="bar" value={1} label="100% — Complete" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 5. Ring — Indeterminate ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Ring — Indeterminate</TugLabel>
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <TugProgress variant="ring" size="sm" aria-label="Loading" />
          <TugProgress variant="ring" size="md" aria-label="Loading" />
          <TugProgress variant="ring" size="lg" aria-label="Loading" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 6. Ring — Determinate ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Ring — Determinate</TugLabel>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <TugProgress variant="ring" value={0} size="lg" aria-label="0%" />
          <TugProgress variant="ring" value={0.25} size="lg" aria-label="25%" />
          <TugProgress variant="ring" value={0.5} size="lg" aria-label="50%" />
          <TugProgress variant="ring" value={0.75} size="lg" aria-label="75%" />
          <TugProgress variant="ring" value={1} size="lg" aria-label="100%" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 7. Pie — Indeterminate ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Pie — Indeterminate</TugLabel>
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <TugProgress variant="pie" size="sm" aria-label="Loading" />
          <TugProgress variant="pie" size="md" aria-label="Loading" />
          <TugProgress variant="pie" size="lg" aria-label="Loading" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 8. Pie — Determinate ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Pie — Determinate</TugLabel>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <TugProgress variant="pie" value={0} size="lg" aria-label="0%" />
          <TugProgress variant="pie" value={0.25} size="lg" aria-label="25%" />
          <TugProgress variant="pie" value={0.5} size="lg" aria-label="50%" />
          <TugProgress variant="pie" value={0.75} size="lg" aria-label="75%" />
          <TugProgress variant="pie" value={1} size="lg" aria-label="100%" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 9. Transition Demo (was 7) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Transition Demo</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "32px", maxWidth: "480px" }}>
          <p style={{ fontSize: "0.875rem", color: "var(--tug7-element-field-text-normal-label-rest)", margin: 0 }}>
            Starts indeterminate for 2 seconds, then transitions to determinate progress.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
            <TugPushButton
              size="sm"
              disabled={barTransRunning}
              onClick={() => startTransition(setBarTransValue, setBarTransRunning)}
            >{barTransRunning ? "Running..." : "Start Bar Upload"}</TugPushButton>
            <TugProgress
              variant="bar"
              value={barTransValue}
              label={barTransValue !== undefined ? `${Math.round(barTransValue * 100)}%` : "Preparing..."}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
            <TugPushButton
              size="sm"
              disabled={ringTransRunning}
              onClick={() => startTransition(setRingTransValue, setRingTransRunning)}
            >{ringTransRunning ? "Running..." : "Start Ring Upload"}</TugPushButton>
            <TugProgress
              variant="ring"
              size="lg"
              value={ringTransValue}
              label={ringTransValue !== undefined ? `${Math.round(ringTransValue * 100)}%` : "Preparing..."}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
            <TugPushButton
              size="sm"
              disabled={pieTransRunning}
              onClick={() => startTransition(setPieTransValue, setPieTransRunning)}
            >{pieTransRunning ? "Running..." : "Start Pie Upload"}</TugPushButton>
            <TugProgress
              variant="pie"
              size="lg"
              value={pieTransValue}
              label={pieTransValue !== undefined ? `${Math.round(pieTransValue * 100)}%` : "Preparing..."}
            />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 8. Roles ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Roles</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "480px" }}>
          <TugProgress variant="bar" value={0.6} label="Accent (default)" />
          <TugProgress variant="bar" value={0.6} role="action" label="Action" />
          <TugProgress variant="bar" value={0.6} role="success" label="Success" />
          <TugProgress variant="bar" value={0.6} role="danger" label="Danger" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 9. Disabled ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Disabled</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "480px" }}>
          <TugProgress variant="spinner" disabled label="Spinner disabled" />
          <TugProgress variant="bar" value={0.5} disabled label="Bar disabled at 50%" />
          <TugProgress variant="ring" disabled aria-label="Ring disabled" />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- 10. TugBox Cascade ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugBox Cascade</TugLabel>
        <div style={{ maxWidth: "480px" }}>
          <TugBox variant="bordered" label="Disabled via TugBox" disabled>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <TugProgress variant="spinner" label="Spinner in disabled box" />
              <TugProgress variant="bar" label="Bar in disabled box" />
            </div>
          </TugBox>
        </div>
      </div>

    </div>
  );
}
