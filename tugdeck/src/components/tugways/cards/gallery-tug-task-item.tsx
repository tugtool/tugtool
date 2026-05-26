/**
 * gallery-tug-task-item.tsx — TugTaskItem showcase.
 *
 * Five sections:
 *
 *  1. **Status palette** — one row per status (`pending`,
 *     `in_progress`, `completed`) so the three visual treatments
 *     read side-by-side.
 *  2. **In-progress: idle gate** — the same `in_progress` row in
 *     both the default (animating spinner) and `idle` (stopped /
 *     closed outlined circle) states, so the idle visual is
 *     unambiguous.
 *  3. **Description tooltip** — three rows with longer
 *     descriptions; hover surfaces the `TugTooltip`.
 *  4. **List composition** — a realistic task list as the
 *     consumer would compose it: a flex column of `TugTaskItem`s
 *     under one container.
 *  5. **Idle cycle** — a switch that toggles the `idle` prop on a
 *     full list every 2 s, so the `in_progress` row's ring
 *     transition (animating ↔ stopped) reads against the static
 *     pending / completed rows beside it.
 *
 * @module components/tugways/cards/gallery-tug-task-item
 */

import React, { useEffect, useId, useState } from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugSwitch } from "@/components/tugways/tug-switch";
import { TugTaskItem } from "@/components/tugways/tug-task-item";
import type { TugTaskItemStatus } from "@/components/tugways/tug-task-item";
import { useResponderForm } from "@/components/tugways/use-responder-form";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONO = "var(--tug-font-mono, monospace)";
const TEXT_MUTED = "var(--tug7-element-global-text-normal-muted-rest)";

const IDLE_CYCLE_INTERVAL_MS = 2000;

const STATUS_PALETTE: ReadonlyArray<{
  status: TugTaskItemStatus;
  label: string;
}> = [
  { status: "pending", label: "Write calc.c source" },
  { status: "in_progress", label: "Write Makefile" },
  { status: "completed", label: "Write README" },
];

const REALISTIC_LIST: ReadonlyArray<{
  status: TugTaskItemStatus;
  label: string;
  description?: string;
}> = [
  {
    status: "completed",
    label: "Write calc.c source",
    description:
      "Implement command-line calculator in C supporting +, −, ×, ÷ on two operands",
  },
  {
    status: "completed",
    label: "Write Makefile",
    description: "Create Makefile with build, clean, and install targets",
  },
  {
    status: "in_progress",
    label: "Write README",
    description: "Create README.md documenting usage, build, and examples",
  },
  {
    status: "pending",
    label: "Build and smoke-test calculator",
    description: "Run make and exercise the binary with several inputs",
  },
];

const DESCRIPTION_ROWS: ReadonlyArray<{
  status: TugTaskItemStatus;
  label: string;
  description: string;
}> = [
  {
    status: "pending",
    label: "Hover me for description",
    description: "This is the long form of the task — it surfaces in a TugTooltip on hover.",
  },
  {
    status: "in_progress",
    label: "Or me",
    description:
      "Descriptions are optional. When present, the TugTooltip is right-aligned to the row's start edge.",
  },
  {
    status: "completed",
    label: "Or this completed one",
    description: "Completed rows still surface their tooltip; the strikethrough is for the row text only.",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GalleryTugTaskItem: React.FC = () => {
  const [idleCycling, setIdleCycling] = useState(false);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!idleCycling) return;
    const id = setInterval(() => {
      setIdle((v) => !v);
    }, IDLE_CYCLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [idleCycling]);

  const cyclingSwitchId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    toggle: { [cyclingSwitchId]: setIdleCycling },
  });

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-tug-task-item"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* ---- Section 1 — Status palette ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugTaskItem — Status Palette</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            Three statuses, three role-driven treatments. `in_progress` uses TugProgressIndicator
            `role="action"` (standard active accent) and a matching background band.
          </TugLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0" }}>
            {STATUS_PALETTE.map((row) => (
              <TugTaskItem
                key={row.status}
                status={row.status}
                label={row.label}
              />
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 2 — In-progress: idle gate ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">In-progress — Idle Gate</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            The `idle` prop swaps the animating indeterminate ring for the
            `stopped` (closed outlined circle, no animation) state. Same row,
            same color — just no motion. Use when the surrounding session is
            idle so the ring doesn't imply ongoing work.
          </TugLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ minWidth: 64, fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                idle=false
              </span>
              <div style={{ flex: 1 }}>
                <TugTaskItem status="in_progress" label="Animating ring (default)" />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ minWidth: 64, fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                idle=true
              </span>
              <div style={{ flex: 1 }}>
                <TugTaskItem status="in_progress" label="Stopped ring (closed circle)" idle />
              </div>
            </div>
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 3 — Description tooltip ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Description Tooltip</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            When `description` is set, the row is wrapped in a TugTooltip;
            hover any row below to surface it.
          </TugLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0" }}>
            {DESCRIPTION_ROWS.map((row, i) => (
              <TugTaskItem
                key={i}
                status={row.status}
                label={row.label}
                description={row.description}
              />
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 4 — Realistic list composition ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">List Composition</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            How a consumer composes a task list — a flex column of
            TugTaskItems with a small inter-item gap. The Tide TASKS popover
            uses this exact shape.
          </TugLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "8px 0",
            }}
          >
            {REALISTIC_LIST.map((row, i) => (
              <TugTaskItem
                key={i}
                status={row.status}
                label={row.label}
                description={row.description}
              />
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 5 — Idle cycle ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Idle Cycle</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            Toggles the `idle` prop on a realistic list every 2 s. The
            in_progress row's ring switches between animating and stopped;
            pending / completed rows are unaffected.
          </TugLabel>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "8px 0",
            }}
          >
            <TugSwitch
              checked={idleCycling}
              senderId={cyclingSwitchId}
              label="cycle idle every 2s"
              size="sm"
            />
            <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
              cycling: {String(idleCycling)} · idle: {String(idle)}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 0" }}>
            {REALISTIC_LIST.map((row, i) => (
              <TugTaskItem
                key={i}
                status={row.status}
                label={row.label}
                idle={idle}
              />
            ))}
          </div>
        </div>
      </div>
    </ResponderScope>
  );
};
