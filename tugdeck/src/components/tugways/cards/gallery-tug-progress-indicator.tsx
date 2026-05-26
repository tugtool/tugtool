/**
 * gallery-tug-progress-indicator.tsx — TugProgressIndicator showcase.
 *
 * Replaces three earlier galleries (gallery-progress, gallery-tug-
 * state-indicator, gallery-tug-thinking-indicator) — the unified
 * indicator subsumes all three predecessors. Sections:
 *
 *  - Variants  — every glyph at 16px, default role/state
 *  - Roles     — every role × ring at running state
 *  - States    — every state × ring (showing what each pose looks like)
 *  - Determinate — value-driven ring/bar/pie at 0/25/50/75/100
 *  - Phase     — pulsing-dot driven by phaseLabels + phaseVisual
 *  - Layout    — glyphPosition + labelAlign center stabilizer
 *
 * @module components/tugways/cards/gallery-tug-progress-indicator
 */

import React, { useState } from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import {
  TugProgressIndicator,
  type TugProgressIndicatorRole,
  type TugProgressIndicatorState,
  type TugProgressIndicatorVariant,
  type TugProgressIndicatorPhaseVisual,
} from "@/components/tugways/tug-progress-indicator";

const VARIANTS: ReadonlyArray<TugProgressIndicatorVariant> = [
  "ring",
  "bar",
  "spinner",
  "pulsing-dot",
  "wave",
  "pie",
];

const ROLES: ReadonlyArray<TugProgressIndicatorRole> = [
  "inherit",
  "action",
  "agent",
  "data",
  "option",
  "success",
  "caution",
  "danger",
];

const STATES: ReadonlyArray<TugProgressIndicatorState> = [
  "running",
  "paused",
  "stopped",
  "completed",
  "aborted",
];

const DEMO_PHASES: Record<string, string> = {
  idle: "Idle",
  streaming: "Streaming",
  awaiting_approval: "Awaiting",
  offline: "Disconnected",
};

function demoPhaseVisual(phase: string): TugProgressIndicatorPhaseVisual {
  switch (phase) {
    case "offline":
      return { role: "danger", state: "aborted" };
    case "awaiting_approval":
      return { role: "caution", state: "running" };
    case "streaming":
      return { role: "success", state: "running" };
    case "idle":
    default:
      return { role: "inherit", state: "stopped" };
  }
}

export function GalleryTugProgressIndicator(): React.ReactElement {
  const [phase, setPhase] = useState<string>("streaming");
  const [glyphPosition, setGlyphPosition] = useState<"left" | "right" | "both">(
    "both",
  );

  return (
    <div className="cg-content">
      {/* Variants ---------------------------------------------------- */}
      <section>
        <TugLabel className="cg-section-title">
          TugProgressIndicator — Variants
        </TugLabel>
        <div className="cg-row" style={{ gap: 24, alignItems: "center" }}>
          {VARIANTS.map((v) => (
            <div
              key={v}
              style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", minWidth: 64 }}
            >
              <TugProgressIndicator variant={v} size={20} />
              <span style={{ fontSize: 11 }}>{v}</span>
            </div>
          ))}
        </div>
      </section>

      <TugSeparator />

      {/* Roles ------------------------------------------------------- */}
      <section>
        <TugLabel className="cg-section-title">
          TugProgressIndicator — Roles (ring)
        </TugLabel>
        <div className="cg-row" style={{ gap: 16, alignItems: "center" }}>
          {ROLES.map((r) => (
            <div
              key={r}
              style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", minWidth: 64 }}
            >
              <TugProgressIndicator variant="ring" size={20} role={r} />
              <span style={{ fontSize: 11 }}>{r}</span>
            </div>
          ))}
        </div>
      </section>

      <TugSeparator />

      {/* States ------------------------------------------------------ */}
      <section>
        <TugLabel className="cg-section-title">
          TugProgressIndicator — States (ring, pulsing-dot, wave)
        </TugLabel>
        {(["ring", "pulsing-dot", "wave"] as const).map((variant) => (
          <div
            key={variant}
            className="cg-row"
            style={{ gap: 16, alignItems: "center", marginTop: 8 }}
          >
            <span style={{ minWidth: 96, fontSize: 12 }}>{variant}</span>
            {STATES.map((s) => (
              <div
                key={s}
                style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", minWidth: 64 }}
              >
                <TugProgressIndicator variant={variant} size={20} role="action" state={s} />
                <span style={{ fontSize: 11 }}>{s}</span>
              </div>
            ))}
          </div>
        ))}
      </section>

      <TugSeparator />

      {/* Determinate ------------------------------------------------- */}
      <section>
        <TugLabel className="cg-section-title">
          TugProgressIndicator — Determinate (ring / bar / pie)
        </TugLabel>
        {([0, 0.25, 0.5, 0.75, 1] as const).map((v) => (
          <div
            key={v}
            className="cg-row"
            style={{ gap: 16, alignItems: "center", marginTop: 8 }}
          >
            <span style={{ minWidth: 64, fontSize: 12 }}>{Math.round(v * 100)}%</span>
            <TugProgressIndicator variant="ring" size={24} role="action" value={v} />
            <div style={{ width: 200 }}>
              <TugProgressIndicator variant="bar" size={8} role="action" value={v} />
            </div>
            <TugProgressIndicator variant="pie" size={24} role="action" value={v} />
          </div>
        ))}
      </section>

      <TugSeparator />

      {/* Phase ------------------------------------------------------- */}
      <section>
        <TugLabel className="cg-section-title">
          TugProgressIndicator — Phase + phaseVisual
        </TugLabel>
        <div className="cg-row" style={{ gap: 12, alignItems: "center", marginTop: 8 }}>
          {Object.keys(DEMO_PHASES).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPhase(p)}
              style={{
                padding: "4px 8px",
                background: p === phase ? "var(--tug7-surface-control-primary-filled-action-rest)" : "transparent",
                color: p === phase ? "white" : "inherit",
                border: "1px solid currentColor",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="cg-row" style={{ gap: 16, alignItems: "center", marginTop: 12 }}>
          <TugProgressIndicator
            variant="pulsing-dot"
            size={16}
            phase={phase}
            phaseLabels={DEMO_PHASES}
            phaseVisual={demoPhaseVisual}
          />
        </div>
      </section>

      <TugSeparator />

      {/* Layout ------------------------------------------------------ */}
      <section>
        <TugLabel className="cg-section-title">
          TugProgressIndicator — Layout (glyphPosition + labelAlign center)
        </TugLabel>
        <div className="cg-row" style={{ gap: 12, alignItems: "center", marginTop: 8 }}>
          {(["left", "right", "both"] as const).map((gp) => (
            <button
              key={gp}
              type="button"
              onClick={() => setGlyphPosition(gp)}
              style={{
                padding: "4px 8px",
                background: gp === glyphPosition ? "var(--tug7-surface-control-primary-filled-action-rest)" : "transparent",
                color: gp === glyphPosition ? "white" : "inherit",
                border: "1px solid currentColor",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {gp}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <TugProgressIndicator
            variant="pulsing-dot"
            size={12}
            phase={phase}
            phaseLabels={DEMO_PHASES}
            phaseVisual={demoPhaseVisual}
            glyphPosition={glyphPosition}
            labelAlign="center"
          />
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            Label cell sizes to the widest phaseLabels entry ("Disconnected"); the
            active label centers within that width — no layout jitter when the
            phase flips.
          </span>
        </div>
      </section>
    </div>
  );
}
