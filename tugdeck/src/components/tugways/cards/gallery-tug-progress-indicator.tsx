/**
 * gallery-tug-progress-indicator.tsx — TugProgressIndicator showcase.
 *
 * Replaces three earlier galleries (gallery-progress, gallery-tug-
 * state-indicator, gallery-tug-thinking-indicator) — the unified
 * indicator subsumes all three predecessors.
 *
 * Layout:
 *  - Variants  — six glyphs in a wrapping card grid
 *  - Roles     — eight role tones in a wrapping card grid (ring variant)
 *  - States    — a 3 × 5 matrix (variant rows × state columns)
 *  - Determinate — a 3 × 5 matrix (variant rows × value columns)
 *  - Phase     — phase picker + live indicator using phaseLabels/phaseVisual
 *  - Layout    — glyphPosition picker + labelAlign="center" demo with
 *                width-stabilize so phase changes don't shift layout
 *
 * @module components/tugways/cards/gallery-tug-progress-indicator
 */

import "./gallery-tug-progress-indicator.css";

import React, { useId, useState } from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
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

const STATE_DEMO_VARIANTS: ReadonlyArray<TugProgressIndicatorVariant> = [
  "ring",
  "pulsing-dot",
  "wave",
];

const STATES: ReadonlyArray<TugProgressIndicatorState> = [
  "running",
  "paused",
  "stopped",
  "completed",
  "aborted",
];

const DETERMINATE_VARIANTS: ReadonlyArray<TugProgressIndicatorVariant> = [
  "ring",
  "bar",
  "pie",
];

const DETERMINATE_VALUES = [0, 0.25, 0.5, 0.75, 1] as const;

const DEMO_PHASES: Record<string, string> = {
  idle: "Idle",
  streaming: "Streaming",
  awaiting_approval: "Awaiting",
  offline: "Disconnected",
};
const DEMO_PHASE_KEYS = Object.keys(DEMO_PHASES);

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

// ---------------------------------------------------------------------------
// Cell — one labeled glyph card. The bar variant fills the cell's width.
// ---------------------------------------------------------------------------

interface GalleryCellProps {
  caption: string;
  children: React.ReactNode;
  /** Wide cell — used for the bar variant. */
  wide?: boolean;
}

function GalleryCell({ caption, children, wide }: GalleryCellProps): React.ReactElement {
  return (
    <div className={wide ? "gpi-cell gpi-cell-wide" : "gpi-cell"}>
      <div className="gpi-cell-glyph">{children}</div>
      <div className="gpi-cell-caption">{caption}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryTugProgressIndicator
// ---------------------------------------------------------------------------

const PHASE_ITEMS = DEMO_PHASE_KEYS.map((p) => ({ value: p, label: p }));
const GLYPH_POSITION_ITEMS = [
  { value: "left", label: "left" },
  { value: "right", label: "right" },
  { value: "both", label: "both" },
];

export function GalleryTugProgressIndicator(): React.ReactElement {
  const [phase, setPhase] = useState<string>("streaming");
  const [glyphPosition, setGlyphPosition] = useState<"left" | "right" | "both">(
    "both",
  );

  const phaseGroupId = useId();
  const layoutPhaseGroupId = useId();
  const glyphPositionGroupId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [phaseGroupId]: setPhase,
      [layoutPhaseGroupId]: setPhase,
      [glyphPositionGroupId]: (v: string) =>
        setGlyphPosition(v as "left" | "right" | "both"),
    },
  });

  return (
    <ResponderScope>
    <div
      className="cg-content"
      ref={responderRef as (el: HTMLDivElement | null) => void}
    >
      {/* Variants ---------------------------------------------------- */}
      <section className="cg-section">
        <TugLabel className="cg-section-title">
          Variants — six glyphs, default role/state
        </TugLabel>
        <div className="gpi-grid">
          {VARIANTS.map((v) => (
            <GalleryCell key={v} caption={v} wide={v === "bar"}>
              <TugProgressIndicator
                variant={v}
                size={v === "bar" ? 6 : 20}
              />
            </GalleryCell>
          ))}
        </div>
      </section>

      <TugSeparator />

      {/* Roles ------------------------------------------------------- */}
      <section className="cg-section">
        <TugLabel className="cg-section-title">
          Roles — eight role tones (ring variant)
        </TugLabel>
        <div className="gpi-grid">
          {ROLES.map((r) => (
            <GalleryCell key={r} caption={r}>
              <TugProgressIndicator variant="ring" size={20} role={r} />
            </GalleryCell>
          ))}
        </div>
      </section>

      <TugSeparator />

      {/* States matrix ---------------------------------------------- */}
      <section className="cg-section">
        <TugLabel className="cg-section-title">
          States — three variants × five states
        </TugLabel>
        <div
          className="gpi-matrix"
          style={{
            gridTemplateColumns: `auto repeat(${STATES.length}, minmax(80px, 1fr))`,
          }}
        >
          {/* header row */}
          <div className="gpi-matrix-corner" />
          {STATES.map((s) => (
            <div key={s} className="gpi-matrix-col-head">
              {s}
            </div>
          ))}
          {STATE_DEMO_VARIANTS.map((variant) => (
            <React.Fragment key={variant}>
              <div className="gpi-matrix-row-head">{variant}</div>
              {STATES.map((s) => (
                <div key={s} className="gpi-matrix-cell">
                  <TugProgressIndicator
                    variant={variant}
                    size={20}
                    role="action"
                    state={s}
                  />
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </section>

      <TugSeparator />

      {/* Determinate matrix ----------------------------------------- */}
      <section className="cg-section">
        <TugLabel className="cg-section-title">
          Determinate — three variants × five fill values
        </TugLabel>
        <div
          className="gpi-matrix"
          style={{
            gridTemplateColumns: `auto repeat(${DETERMINATE_VALUES.length}, minmax(80px, 1fr))`,
          }}
        >
          <div className="gpi-matrix-corner" />
          {DETERMINATE_VALUES.map((v) => (
            <div key={v} className="gpi-matrix-col-head">
              {Math.round(v * 100)}%
            </div>
          ))}
          {DETERMINATE_VARIANTS.map((variant) => (
            <React.Fragment key={variant}>
              <div className="gpi-matrix-row-head">{variant}</div>
              {DETERMINATE_VALUES.map((v) => (
                <div key={v} className="gpi-matrix-cell">
                  <TugProgressIndicator
                    variant={variant}
                    size={variant === "bar" ? 6 : 22}
                    role="action"
                    value={v}
                  />
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </section>

      <TugSeparator />

      {/* Phase ------------------------------------------------------- */}
      <section className="cg-section">
        <TugLabel className="cg-section-title">
          Phase — phaseLabels + phaseVisual
        </TugLabel>
        <TugLabel size="2xs" emphasis="calm">
          The caller passes a free-form `phase` plus a `phaseLabels` map and a
          `phaseVisual` mapper; explicit `role` / `state` props override the
          mapper's return.
        </TugLabel>
        <TugChoiceGroup
          size="sm"
          value={phase}
          senderId={phaseGroupId}
          items={PHASE_ITEMS}
          aria-label="Phase picker"
        />
        <div className="gpi-demo-frame">
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
      <section className="cg-section">
        <TugLabel className="cg-section-title">
          Layout — glyphPosition × labelAlign="center" width-stabilize
        </TugLabel>
        <TugLabel size="2xs" emphasis="calm">
          The label cell sizes to the widest `phaseLabels` entry
          ("Disconnected"); the active label centers within that width — no
          layout jitter when the phase flips.
        </TugLabel>
        <TugChoiceGroup
          size="sm"
          value={glyphPosition}
          senderId={glyphPositionGroupId}
          items={GLYPH_POSITION_ITEMS}
          aria-label="Glyph position"
        />
        <TugChoiceGroup
          size="sm"
          value={phase}
          senderId={layoutPhaseGroupId}
          items={PHASE_ITEMS}
          aria-label="Phase picker"
        />
        <div className="gpi-demo-frame">
          <TugProgressIndicator
            variant="pulsing-dot"
            size={12}
            phase={phase}
            phaseLabels={DEMO_PHASES}
            phaseVisual={demoPhaseVisual}
            glyphPosition={glyphPosition}
            labelAlign="center"
          />
        </div>
      </section>
    </div>
    </ResponderScope>
  );
}
