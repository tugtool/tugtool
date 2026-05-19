/**
 * gallery-tide-asst-half-stack.tsx -- Z1 asst-half two-line stack
 * (gallery-only).
 *
 * Workshop surface for the production Z1 asst-half chrome that will
 * replace the dangling-model-name look in
 * `tide-card-transcript.tsx`'s assistant row (per Step 20.5.D's
 * promotion).
 *
 * The chrome is a two-line stack:
 *
 *     [model name]                        ← persistent (model row, top)
 *     [status: indicator OR end-state]    ← in-flight OR terminal (status row, bottom)
 *
 * **Mount-identity discipline ([L26]).** The status row is a single
 * always-mounted `<div data-slot="tide-asst-half-status-slot">`
 * whose CHILD swaps between the in-flight indicator and the
 * end-state display. The slot div itself is never unmounted at the
 * turn boundary — so any focus / hover / scroll-position state the
 * assistant row carries survives the indicator → end-state
 * transition. The data attribute lets tests + tooling pin the
 * boundary by selector.
 *
 * **End-state slot.** Reserved by `EndStatePlaceholder` until Step
 * 20.4.13 designs the terminal-form content (badge + time + tokens).
 * The placeholder occupies the same vertical slot the real display
 * will, so the gallery's typographic rhythm is representative of the
 * shipped chrome.
 *
 * **Live phase signal.** The indicator's `animating` prop is driven
 * by `isLivePhase(synthSnapshot.phase)` — bars pulse for the
 * duration of the in-flight turn and freeze at `turn_complete`. The
 * earlier plan called for a delta-debounced "freeze while text is
 * actively streaming" derivation (Step 20.4.11); that step was
 * deferred, so the simpler phase-driven signal is what ships.
 *
 * Sections in the gallery card:
 *
 *  1. **Side-by-side states** — in-flight and terminal rendered
 *     together so the chrome's rhythm is directly comparable.
 *  2. **Live transition** — a switch that flips the synthetic phase
 *     between an in-flight value and `idle`; the same slot remains
 *     mounted across the swap.
 *  3. **Phase coverage** — each live `CodeSessionPhase` rendered in
 *     the stack so designers can confirm the indicator behaves the
 *     same across the live spectrum (submitting / streaming /
 *     tool_work / awaiting_approval / replaying).
 *
 * @module components/tugways/cards/gallery-tide-asst-half-stack
 */

import React, { useId, useState } from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugSwitch } from "@/components/tugways/tug-switch";
import { TugThinkingIndicator } from "@/components/tugways/tug-thinking-indicator";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import { isLivePhase } from "@/lib/code-session-store/hooks/use-lifecycle-tick";
import type { CodeSessionPhase } from "@/lib/code-session-store/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONO = "var(--tug-font-mono, monospace)";
const TEXT_MUTED = "var(--tug7-element-global-text-normal-muted-rest)";
const TEXT_NORMAL = "var(--tug7-element-global-text-normal-default-rest)";

/**
 * Sample model name displayed in the model row. Mirrors the literal
 * Anthropic identifier the SessionMetadataStore reports (the
 * `[1m]` suffix is present in production — kept so the gallery
 * design accounts for the worst-case width).
 */
const SAMPLE_MODEL_NAME = "claude-opus-4-7[1m]";

/**
 * Phases that count as "in-flight" for the gallery picker. Pulled
 * from `isLivePhase`'s positive set so the gallery and the
 * production helper stay in lockstep — adding a phase in one place
 * surfaces immediately in the other.
 */
const LIVE_PHASES: ReadonlyArray<CodeSessionPhase> = [
  "submitting",
  "awaiting_first_token",
  "streaming",
  "tool_work",
  "awaiting_approval",
  "replaying",
];

/** Terminal phases the picker offers so the gallery can show both ends. */
const TERMINAL_PHASES: ReadonlyArray<CodeSessionPhase> = ["idle", "errored"];

const PICKABLE_PHASES: ReadonlyArray<CodeSessionPhase> = [
  ...LIVE_PHASES,
  ...TERMINAL_PHASES,
];

// ---------------------------------------------------------------------------
// Two-line stack — the gallery's stand-in for the production chrome
// ---------------------------------------------------------------------------

/**
 * The Z1 asst-half two-line stack itself. Kept inline in the
 * gallery card rather than promoted into the tugways library
 * because Step 20.5.D will workshop the production shape against
 * the live `tide-card-transcript.tsx` integration; the stable
 * design surface is the gallery, not a one-callsite component.
 *
 * `phase` drives the status-row content via `isLivePhase`; the
 * status-row container is unconditionally mounted so the swap
 * preserves DOM identity ([L26]).
 */
function Z1AsstHalfStack({
  modelName,
  phase,
}: {
  modelName: string;
  phase: CodeSessionPhase;
}): React.ReactElement {
  const live = isLivePhase(phase);
  return (
    <div
      data-slot="tide-asst-half-stack"
      style={{
        display: "flex",
        flexDirection: "column",
        // Tight vertical rhythm — the two rows must read as one
        // coherent unit, not two stacked details. The
        // `--tug-space-2xs` (~2px) gap keeps them tight enough to
        // feel paired while leaving a discernible separation.
        gap: "var(--tug-space-2xs, 2px)",
        // Bound the stack at the model name's natural width so the
        // status row's right edge never extends past the model
        // name (visual anchor — the model name reads as the
        // header). The gallery's column container is wider; this
        // `inline-flex` collapses to content width.
        alignItems: "flex-start",
      }}
    >
      <div
        data-slot="tide-asst-half-model-row"
        style={{
          fontFamily: MONO,
          // Match the status row's `--tug-font-size-sm` (13px) so the
          // two rows read as a coherent label-pair, not a sized
          // hierarchy. The bold weight alone gives the model row
          // its prominence — sizing it up further (the earlier
          // `--tug-font-size-lg` matched the production transcript
          // identifier but read as oversized here because that
          // identifier sits next to an icon + timestamp + sequence
          // number in production, whereas the stack chrome is
          // standalone).
          fontSize: "var(--tug-font-size-sm)",
          fontWeight: 600,
          color: TEXT_NORMAL,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        {modelName}
      </div>
      {/*
        The status-row slot. Single always-mounted div per [L26];
        the child swaps but the container does not. Tooling can
        observe `data-slot="tide-asst-half-status-slot"` to verify
        the boundary survives the swap.
      */}
      <div
        data-slot="tide-asst-half-status-slot"
        style={{
          display: "flex",
          alignItems: "center",
          // Status row sits a hair indented from the model row's
          // baseline glyph so the visual hierarchy reads
          // top-anchored — "model" first, "status" second.
          minHeight: "var(--tug-space-xl, 20px)",
        }}
      >
        {live ? (
          <TugThinkingIndicator
            animating={true}
            size={12}
            labelPosition="right"
          />
        ) : (
          <EndStatePlaceholder phase={phase} />
        )}
      </div>
    </div>
  );
}

/**
 * Placeholder for the end-state display Step 20.4.13 will design.
 * Renders a muted line that occupies the same vertical slot the
 * real end-state will, so the gallery's spacing rhythm is
 * representative of the shipped chrome.
 */
function EndStatePlaceholder({
  phase,
}: {
  phase: CodeSessionPhase;
}): React.ReactElement {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: "var(--tug-font-size-sm)",
        color: TEXT_MUTED,
        lineHeight: 1,
        whiteSpace: "nowrap",
        fontStyle: "italic",
      }}
    >
      {phase === "errored"
        ? "end-state slot (errored — see 20.4.13)"
        : "end-state slot (20.4.13)"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// GalleryTideAsstHalfStack
// ---------------------------------------------------------------------------

export function GalleryTideAsstHalfStack(): React.ReactElement {
  const [phase, setPhase] = useState<CodeSessionPhase>("streaming");
  const [showTerminal, setShowTerminal] = useState<boolean>(false);

  const phasePopupId = useId();
  const transitionSwitchId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    toggle: { [transitionSwitchId]: setShowTerminal },
    setValueString: {
      [phasePopupId]: (v: string) => setPhase(v as CodeSessionPhase),
    },
  });

  const phaseItems: TugPopupButtonItem<string>[] = PICKABLE_PHASES.map(
    (p) => ({
      action: TUG_ACTIONS.SET_VALUE,
      value: p,
      label: p,
    }),
  );

  // Live-transition section uses `showTerminal` to flip between an
  // in-flight value (`streaming`) and `idle` so the slot's mount
  // boundary can be HMR-vetted.
  const transitionPhase: CodeSessionPhase = showTerminal ? "idle" : "streaming";

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-tide-asst-half-stack"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* ---- Section 1 — Side-by-side states ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Z1 asst-half — Side-by-side states</TugLabel>
          <TugLabel size="2xs" color="muted">
            Two-line stack: model name (top, persistent) over the status row
            (bottom, mode-dependent). The status row's container is mounted
            once and its content swaps between the live indicator and the
            end-state slot per [L26]. The in-flight version shows the
            three-bar pulse driven by `isLivePhase(snap.phase)`; the
            terminal version reserves the end-state slot for Step 20.4.13.
          </TugLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 48,
              padding: "16px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <Z1AsstHalfStack modelName={SAMPLE_MODEL_NAME} phase="streaming" />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                in-flight (streaming)
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <Z1AsstHalfStack modelName={SAMPLE_MODEL_NAME} phase="idle" />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                terminal (idle)
              </span>
            </div>
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 2 — Live transition ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Z1 asst-half — Live Transition</TugLabel>
          <TugLabel size="2xs" color="muted">
            Toggle the switch to flip the synthetic phase between `streaming`
            and `idle`. The status-row container
            (`data-slot="tide-asst-half-status-slot"`) is always mounted —
            only its child swaps. Inspect via DOM tools to confirm the slot
            div survives the swap (no parent re-mount).
          </TugLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "12px 0",
            }}
          >
            <Z1AsstHalfStack
              modelName={SAMPLE_MODEL_NAME}
              phase={transitionPhase}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <TugSwitch
                checked={showTerminal}
                senderId={transitionSwitchId}
                label="show terminal (idle)"
                size="sm"
              />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                current phase: {transitionPhase} · isLivePhase = {String(isLivePhase(transitionPhase))}
              </span>
            </div>
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 3 — Phase coverage ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Z1 asst-half — Phase Coverage</TugLabel>
          <TugLabel size="2xs" color="muted">
            The stack rendered for every `CodeSessionPhase` from the
            indicator's perspective. Every live phase (submitting,
            awaiting_first_token, streaming, tool_work,
            awaiting_approval, replaying) drives the indicator the same
            way — the model row above remains stable across them.
            Terminal phases (idle, errored) surface the end-state
            placeholder. Use the picker to scrub through the spectrum.
          </TugLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "12px 0",
            }}
          >
            <Z1AsstHalfStack modelName={SAMPLE_MODEL_NAME} phase={phase} />
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <TugPopupButton
                label={`phase: ${phase}`}
                items={phaseItems}
                senderId={phasePopupId}
                size="sm"
                aria-label="session phase"
              />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                isLivePhase = {String(isLivePhase(phase))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </ResponderScope>
  );
}
