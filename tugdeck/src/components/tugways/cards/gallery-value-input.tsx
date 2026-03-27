/**
 * GalleryValueInput — TugValueInput demos for the Component Gallery.
 */

import React, { useState } from "react";
import { TugValueInput } from "@/components/tugways/tug-value-input";
import { createNumberFormatter } from "@/lib/tug-format";

// ---- Formatters (module scope to avoid recreation on each render) ----

const percentFormatter = createNumberFormatter({ style: "percent" });
const decimalFormatter = createNumberFormatter({ style: "decimal", decimals: 1 });

// ---- GalleryValueInput ----

export function GalleryValueInput() {
  // Section 1: Sizes
  const [smValue, setSmValue] = useState(25);
  const [mdValue, setMdValue] = useState(50);
  const [lgValue, setLgValue] = useState(75);

  // Section 2: Formatters
  const [percentValue, setPercentValue] = useState(0.75);
  const [decimalValue, setDecimalValue] = useState(5.0);
  const [integerValue, setIntegerValue] = useState(42);

  // Section 3: Disabled
  const [disabledValue] = useState(30);

  return (
    <div className="cg-content" data-testid="gallery-value-input">

      {/* ---- Section 1: Sizes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugValueInput — Sizes</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "3rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>sm</span>
            <TugValueInput size="sm" value={smValue} onValueCommit={setSmValue} min={0} max={100} />
            <span className="cg-demo-status">Value: <code>{smValue}</code></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "3rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>md</span>
            <TugValueInput size="md" value={mdValue} onValueCommit={setMdValue} min={0} max={100} />
            <span className="cg-demo-status">Value: <code>{mdValue}</code></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "3rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>lg</span>
            <TugValueInput size="lg" value={lgValue} onValueCommit={setLgValue} min={0} max={100} />
            <span className="cg-demo-status">Value: <code>{lgValue}</code></span>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 2: Formatters ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugValueInput — Formatters</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "5rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>percent</span>
            <TugValueInput
              value={percentValue}
              onValueCommit={setPercentValue}
              formatter={percentFormatter}
              min={0}
              max={1}
              step={0.01}
            />
            <span className="cg-demo-status">Value: <code>{percentValue}</code></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "5rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>decimal</span>
            <TugValueInput
              value={decimalValue}
              onValueCommit={setDecimalValue}
              formatter={decimalFormatter}
              min={0}
              max={10}
              step={0.1}
            />
            <span className="cg-demo-status">Value: <code>{decimalValue}</code></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "5rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>integer</span>
            <TugValueInput
              value={integerValue}
              onValueCommit={setIntegerValue}
              min={0}
              max={100}
              step={1}
            />
            <span className="cg-demo-status">Value: <code>{integerValue}</code></span>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 3: Disabled ---- */}
      <div className="cg-section">
        <div className="cg-section-title">TugValueInput — Disabled</div>
        <TugValueInput value={disabledValue} onValueCommit={() => {}} disabled />
      </div>

    </div>
  );
}
