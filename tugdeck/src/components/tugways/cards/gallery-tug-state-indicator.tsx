/**
 * gallery-tug-state-indicator.tsx -- TugStateIndicator showcase.
 *
 * Four sections:
 *
 *  1. **Tone palette** — the four tones side-by-side so palette
 *     consistency is easy to eyeball.
 *  2. **All session states** — every `phase × transportState ×
 *     interruptInFlight` combination with the dispatched tone +
 *     animated flag visible per row.
 *  3. **Size variants** — the same active state at 10 / 12 / 16 /
 *     20 / 24 / 32 px so scaling behavior is visible.
 *  4. **Handoff cycle** — a switch that cycles the state every 2 s.
 *     The dot updates immediately; the in-flight ring pulse runs to
 *     completion in its starting color; the next pulse runs in the
 *     new tone (or the ring vanishes when the new tone is static).
 *
 * @module components/tugways/cards/gallery-tug-state-indicator
 */

import React, { useEffect, useId, useState } from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugSwitch } from "@/components/tugways/tug-switch";
import { TugStateIndicator } from "@/components/tugways/tug-state-indicator";
import type { TugStateIndicatorState } from "@/components/tugways/tug-state-indicator";
import { useResponderForm } from "@/components/tugways/use-responder-form";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONO = "var(--tug-font-mono, monospace)";
const TEXT_MUTED = "var(--tug7-element-global-text-normal-muted-rest)";

// Static one-of-each-tone palette for the "tone palette" row.
const TONE_PALETTE: ReadonlyArray<{
  id: string;
  label: string;
  state: TugStateIndicatorState;
}> = [
  { id: "default", label: "default", state: { phase: "idle", transportState: "online", interruptInFlight: false } },
  { id: "success", label: "success", state: { phase: "streaming", transportState: "online", interruptInFlight: false } },
  { id: "caution", label: "caution", state: { phase: "awaiting_approval", transportState: "online", interruptInFlight: false } },
  { id: "danger", label: "danger", state: { phase: "errored", transportState: "online", interruptInFlight: false } },
];

const ALL_STATES: ReadonlyArray<{
  id: string;
  label: string;
  state: TugStateIndicatorState;
}> = [
  { id: "idle", label: "idle · online", state: { phase: "idle", transportState: "online", interruptInFlight: false } },
  { id: "submitting", label: "submitting · online", state: { phase: "submitting", transportState: "online", interruptInFlight: false } },
  { id: "awaiting_first", label: "awaiting_first_token · online", state: { phase: "awaiting_first_token", transportState: "online", interruptInFlight: false } },
  { id: "streaming", label: "streaming · online", state: { phase: "streaming", transportState: "online", interruptInFlight: false } },
  { id: "tool_work", label: "tool_work · online", state: { phase: "tool_work", transportState: "online", interruptInFlight: false } },
  { id: "awaiting_approval", label: "awaiting_approval · online", state: { phase: "awaiting_approval", transportState: "online", interruptInFlight: false } },
  { id: "interrupt", label: "streaming · INTERRUPT in flight", state: { phase: "streaming", transportState: "online", interruptInFlight: true } },
  { id: "offline", label: "idle · OFFLINE", state: { phase: "idle", transportState: "offline", interruptInFlight: false } },
  { id: "restoring", label: "submitting · RESTORING", state: { phase: "submitting", transportState: "restoring", interruptInFlight: false } },
  { id: "errored", label: "errored · online", state: { phase: "errored", transportState: "online", interruptInFlight: false } },
  { id: "replaying", label: "replaying · online", state: { phase: "replaying", transportState: "online", interruptInFlight: false } },
];

const SIZE_VARIANTS: ReadonlyArray<number> = [10, 12, 16, 20, 24, 32];

// Handoff cycle: four states, one switch every 2 s — just longer
// than the 1.6 s pulse iteration so each state gets a full pulse on
// the ring before the next state arrives.
const HANDOFF_CYCLE: ReadonlyArray<TugStateIndicatorState> = [
  { phase: "streaming", transportState: "online", interruptInFlight: false },
  { phase: "awaiting_approval", transportState: "online", interruptInFlight: false },
  { phase: "errored", transportState: "online", interruptInFlight: false },
  { phase: "idle", transportState: "online", interruptInFlight: false },
];

const HANDOFF_CYCLE_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// GalleryTugStateIndicator
// ---------------------------------------------------------------------------

export function GalleryTugStateIndicator(): React.ReactElement {
  const [cycling, setCycling] = useState(false);
  const [cycleIdx, setCycleIdx] = useState(0);

  useEffect(() => {
    if (!cycling) return;
    const id = setInterval(() => {
      setCycleIdx((i) => (i + 1) % HANDOFF_CYCLE.length);
    }, HANDOFF_CYCLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [cycling]);

  const cyclingSwitchId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    toggle: { [cyclingSwitchId]: setCycling },
  });

  const cycledState = HANDOFF_CYCLE[cycleIdx];

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-tug-state-indicator"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* ---- Section 1 — Tone palette ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugStateIndicator — Tone Palette</TugLabel>
          <TugLabel size="2xs" color="muted">
            The four tones in the indicator's palette. Default and danger are static (no ring);
            success and caution animate (pulsing ring).
          </TugLabel>
          <div style={{ display: "flex", gap: 32, alignItems: "center", padding: "8px 0" }}>
            {TONE_PALETTE.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 56,
                }}
              >
                <TugStateIndicator state={t.state} size={16} />
                <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 2 — All session states ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugStateIndicator — All Session States</TugLabel>
          <TugLabel size="2xs" color="muted">
            Every `phase × transportState × interruptInFlight` triple. Transport health dominates
            phase: offline → danger/static, restoring → caution/animated. Interrupt-in-flight
            promotes to caution/animated unless the wire is already offline/restoring.
          </TugLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
            {ALL_STATES.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ display: "inline-flex", width: 20, justifyContent: "center" }}>
                  <TugStateIndicator state={s.state} size={16} />
                </span>
                <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 3 — Size variants ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugStateIndicator — Size Variants</TugLabel>
          <TugLabel size="2xs" color="muted">
            The same active state at 10 / 12 / 16 / 20 / 24 / 32 px. The `size` prop drives
            `--tugx-state-indicator-size`; the dot is half the host diameter.
          </TugLabel>
          <div style={{ display: "flex", gap: 28, alignItems: "center", padding: "8px 0" }}>
            {SIZE_VARIANTS.map((s) => (
              <div
                key={s}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 48,
                }}
              >
                <TugStateIndicator
                  state={{ phase: "streaming", transportState: "online", interruptInFlight: false }}
                  size={s}
                />
                <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>{s}px</span>
              </div>
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 4 — Handoff cycle ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugStateIndicator — Handoff Cycle</TugLabel>
          <TugLabel size="2xs" color="muted">
            Toggle the switch to cycle the state every 2 s. The dot updates immediately; the
            in-flight ring pulse runs to completion in the prior tone; the next pulse runs in
            the new tone (or the ring vanishes when the new tone is static). The cycle is
            slightly longer than the 1.6 s pulse so each state gets a full pulse on the ring
            before the next state arrives.
          </TugLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "12px 0" }}>
            <TugStateIndicator
              state={cycling ? cycledState : ALL_STATES[3].state}
              size={20}
            />
            <TugSwitch
              checked={cycling}
              senderId={cyclingSwitchId}
              label="cycle states every 2s"
              size="sm"
            />
            <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
              {cycling
                ? `${cycledState.phase} · ${cycledState.transportState}`
                : "streaming · online (static)"}
            </span>
          </div>
        </div>
      </div>
    </ResponderScope>
  );
}
