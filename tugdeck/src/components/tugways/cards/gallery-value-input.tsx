/**
 * GalleryValueInput — TugValueInput demos for the Component Gallery.
 */

import React, { useId, useState } from "react";
import { TugValueInput } from "@/components/tugways/tug-value-input";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { createNumberFormatter } from "@/lib/tug-format";
import { TugLabel } from "@/components/tugways/tug-label";

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

  // Section 3: Disabled (unchanged but present for visual completeness).
  const [disabledValue] = useState(30);

  // Gensym'd sender ids — each control gets a unique, stable id so
  // parent handler bindings can disambiguate without string literals.
  const smId = useId();
  const mdId = useId();
  const lgId = useId();
  const percentId = useId();
  const decimalId = useId();
  const integerId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    setValueNumber: {
      [smId]: setSmValue,
      [mdId]: setMdValue,
      [lgId]: setLgValue,
      [percentId]: setPercentValue,
      [decimalId]: setDecimalValue,
      [integerId]: setIntegerValue,
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      data-testid="gallery-value-input"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >

      {/* ---- Section 1: Sizes ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugValueInput — Sizes</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "3rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>sm</span>
            <TugValueInput size="sm" value={smValue} senderId={smId} min={0} max={100} />
            <TugLabel size="2xs" color="muted">{`Value: ${smValue}`}</TugLabel>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "3rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>md</span>
            <TugValueInput size="md" value={mdValue} senderId={mdId} min={0} max={100} />
            <TugLabel size="2xs" color="muted">{`Value: ${mdValue}`}</TugLabel>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "3rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>lg</span>
            <TugValueInput size="lg" value={lgValue} senderId={lgId} min={0} max={100} />
            <TugLabel size="2xs" color="muted">{`Value: ${lgValue}`}</TugLabel>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 2: Formatters ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugValueInput — Formatters</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "5rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>percent</span>
            <TugValueInput
              value={percentValue}
              senderId={percentId}
              formatter={percentFormatter}
              min={0}
              max={1}
              step={0.01}
            />
            <TugLabel size="2xs" color="muted">{`Value: ${percentValue}`}</TugLabel>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "5rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>decimal</span>
            <TugValueInput
              value={decimalValue}
              senderId={decimalId}
              formatter={decimalFormatter}
              min={0}
              max={10}
              step={0.1}
            />
            <TugLabel size="2xs" color="muted">{`Value: ${decimalValue}`}</TugLabel>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ width: "5rem", fontSize: "0.625rem", color: "var(--tug7-element-global-text-normal-subtle-rest)" }}>integer</span>
            <TugValueInput
              value={integerValue}
              senderId={integerId}
              min={0}
              max={100}
              step={1}
            />
            <TugLabel size="2xs" color="muted">{`Value: ${integerValue}`}</TugLabel>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Section 3: Disabled ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugValueInput — Disabled</TugLabel>
        <TugValueInput value={disabledValue} disabled />
      </div>

    </div>
    </ResponderScope>
  );
}
