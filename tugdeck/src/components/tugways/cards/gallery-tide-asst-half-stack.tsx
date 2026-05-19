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
 * **End-state slot.** Renders `EndStateDisplay` ([Step 20.4.13])
 * when the consumer supplies an `endState`: a ghost-emphasis,
 * icon-leading badge (`endStateBadgeFor` + `endStateBadgeIcon`),
 * the turn's active-ms (`formatDurationMs`), and total tokens
 * (`totalTokensForTurn` + `formatTokensCaps`), separated by `•`
 * glyphs. Terminal phases that receive no `endState` fall back to
 * `EndStatePlaceholder` — a muted "no end-state recorded" line
 * that holds the same vertical slot.
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
 *     mounted across the swap, and the end-state display lands
 *     into it when the phase goes terminal.
 *  3. **Phase coverage** — each live `CodeSessionPhase` rendered in
 *     the stack so designers can confirm the indicator behaves the
 *     same across the live spectrum (submitting / streaming /
 *     tool_work / awaiting_approval / replaying).
 *  4. **End-state coverage** — every `TurnEndReason` variant
 *     (complete / interrupted / error / transport_lost) driven by
 *     a representative `TurnEntry` fixture, demonstrating each
 *     badge tone + the active-time / total-tokens formatting.
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
import { PHASE_HUMAN_LABEL } from "@/components/tugways/tug-state-indicator";
import { TugBadge } from "@/components/tugways/tug-badge";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import { isLivePhase } from "@/lib/code-session-store/hooks/use-lifecycle-tick";
import type {
  CodeSessionPhase,
  TurnCost,
  TurnEndReason,
} from "@/lib/code-session-store/types";
import {
  endStateBadgeFor,
  totalTokensForTurn,
} from "@/lib/code-session-store/end-state";
import {
  formatDurationMs,
  formatTokensCaps,
} from "./tide-card-telemetry-renderers";
import { Check, ShieldAlert, ShieldX, Unplug } from "lucide-react";

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
/**
 * Synthetic stand-in for the post-turn data the production renderer
 * pulls off `TurnEntry`. The end-state display reads three fields;
 * the gallery hands them in via this shape so each section can mock
 * whichever turnEndReason / time / tokens combination it wants to
 * demonstrate.
 */
export interface Z1AsstHalfEndState {
  turnEndReason: TurnEndReason;
  activeMs: number;
  cost: TurnCost;
}

function Z1AsstHalfStack({
  modelName,
  phase,
  endState,
}: {
  modelName: string;
  phase: CodeSessionPhase;
  /**
   * Post-turn data for the end-state slot. When the phase is
   * terminal AND this is provided, the status slot renders
   * `EndStateDisplay`. When the phase is terminal and this is
   * absent, the slot falls back to a small muted "no end-state
   * recorded" line so existing gallery sections that don't carry
   * a completed-turn fixture still render meaningful chrome.
   */
  endState?: Z1AsstHalfEndState;
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
          // Use defaults for every tunable — `size`,
          // `barWidthRatio`, `sideBarRatio`, etc. — workshopped in
          // the TugThinkingIndicator tinker bench to read well in
          // exactly this context (a label-pair adjacent to small
          // mono text). Avoid passing overrides so the chrome
          // stays in lockstep with the indicator's defaults.
          //
          // The label reflects the actual phase via
          // `PHASE_HUMAN_LABEL` (the same map TugStateIndicator
          // reads) so "submitting" reads as "Submitting message",
          // "streaming" as "Streaming response", etc. — the
          // generic "Thinking…" default would understate what the
          // assistant is actually doing.
          <TugThinkingIndicator
            animating={true}
            labelPosition="right"
            label={PHASE_HUMAN_LABEL[phase]}
          />
        ) : endState !== undefined ? (
          <EndStateDisplay endState={endState} />
        ) : (
          <EndStatePlaceholder />
        )}
      </div>
    </div>
  );
}

/**
 * Per-reason icon for the end-state badge. The (text, role) shape
 * comes from `endStateBadgeFor`; the icon is paired here at the
 * gallery layer so the icon vocabulary stays beside the badge's
 * other appearance choices. Sized to track the badge's text height
 * at `size="sm"`.
 */
function endStateBadgeIcon(reason: TurnEndReason): React.ReactNode {
  switch (reason) {
    case "complete":
      return <Check size={11} aria-hidden="true" />;
    case "interrupted":
      return <ShieldAlert size={11} aria-hidden="true" />;
    case "error":
      return <ShieldX size={11} aria-hidden="true" />;
    case "transport_lost":
      return <Unplug size={11} aria-hidden="true" />;
  }
}

/**
 * Z1 asst-half end-state display ([Step 20.4.13]). One tight
 * inline row — ghost-emphasis badge with icon, active-time, a `•`
 * separator, total-tokens with a "tokens" label suffix. Reads as
 * a quiet footer under the model row; the badge's `ghost`
 * emphasis keeps it visually subordinate to the model name (the
 * tinted form drew the eye too strongly during workshop). Numbers
 * render in the regular text font (not mono) because they aren't
 * tabular — adjacent rows don't need to align column-wise. The
 * bullet sits only between the time and tokens (the badge has
 * enough visual weight on its own to mark the boundary against
 * the time).
 *
 * The (text, role) mapping for the badge comes from
 * `endStateBadgeFor`; the total-tokens sum comes from
 * `totalTokensForTurn`. Both are pure helpers exported from
 * `code-session-store/end-state` so the gallery and the (future)
 * production renderer compute them identically. Time formatting
 * uses `formatDurationMs` (drops leading-zero parts — `7s` not
 * `0h 0m 07s`).
 */
function EndStateDisplay({
  endState,
}: {
  endState: Z1AsstHalfEndState;
}): React.ReactElement {
  const badge = endStateBadgeFor(endState.turnEndReason);
  const tokens = totalTokensForTurn(endState.cost);
  return (
    <span
      data-slot="tide-asst-half-end-state"
      style={{
        display: "inline-flex",
        alignItems: "center",
        // Gap matches the indicator's label-gap so the end-state's
        // visual rhythm reads identical to the in-flight chrome.
        gap: "var(--tug-space-sm, 6px)",
        fontSize: "var(--tug-font-size-xs)",
        color: TEXT_NORMAL,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <TugBadge
        size="sm"
        emphasis="ghost"
        role={badge.role}
        icon={endStateBadgeIcon(endState.turnEndReason)}
      >
        {badge.text}
      </TugBadge>
      <span style={{ color: TEXT_MUTED, paddingRight: 7, }} aria-hidden="true">
        ::
      </span>      <span>{formatDurationMs(endState.activeMs)}</span>
      <span style={{ color: TEXT_MUTED }} aria-hidden="true">
        •
      </span>
      <span>
        {formatTokensCaps(tokens)}
        <span style={{ color: TEXT_MUTED, marginLeft: "0.25em" }}>tokens</span>
      </span>
    </span>
  );
}

/**
 * Fallback for the terminal status slot when no `endState` is
 * provided. Keeps the existing gallery sections (live transition,
 * phase coverage) rendering meaningfully without forcing every
 * call site to mock a completed-turn fixture.
 */
function EndStatePlaceholder(): React.ReactElement {
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
      no end-state recorded
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

  // Synthetic completed-turn fixture for the live-transition
  // section's terminal half AND the side-by-side section's
  // terminal example — gives the end-state slot real numbers to
  // render against. A "happy path" turn: a successful complete
  // with a representative time and token count.
  const TRANSITION_SUCCESS_END_STATE: Z1AsstHalfEndState = {
    turnEndReason: "complete",
    activeMs: 5_400,
    cost: {
      inputTokens: 4_200,
      outputTokens: 1_350,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalCostUsd: 0,
    },
  };
  const transitionEndState: Z1AsstHalfEndState | undefined = showTerminal
    ? TRANSITION_SUCCESS_END_STATE
    : undefined;

  // End-state coverage fixtures — one per `TurnEndReason` value so
  // Section 4 demonstrates each badge / tone in isolation against
  // a representative active-time and token count. Numbers chosen
  // to give each scenario its own legible figure; the
  // helper-driven formatting is what's under test, not the
  // specific values.
  const END_STATE_FIXTURES: ReadonlyArray<{
    label: string;
    endState: Z1AsstHalfEndState;
  }> = [
    {
      label: "complete (happy path)",
      endState: {
        turnEndReason: "complete",
        activeMs: 7_200,
        cost: {
          inputTokens: 5_100,
          outputTokens: 2_400,
          cacheReadInputTokens: 1_200,
          cacheCreationInputTokens: 0,
          totalCostUsd: 0,
        },
      },
    },
    {
      label: "interrupted (user pressed Stop)",
      endState: {
        turnEndReason: "interrupted",
        activeMs: 2_800,
        cost: {
          inputTokens: 3_800,
          outputTokens: 480,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalCostUsd: 0,
        },
      },
    },
    {
      label: "error (model / tool failure)",
      endState: {
        turnEndReason: "error",
        activeMs: 4_300,
        cost: {
          inputTokens: 2_900,
          outputTokens: 110,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalCostUsd: 0,
        },
      },
    },
    {
      label: "transport_lost (wire dropped mid-turn)",
      endState: {
        turnEndReason: "transport_lost",
        activeMs: 12_500,
        cost: {
          inputTokens: 8_400,
          outputTokens: 5_200,
          cacheReadInputTokens: 3_100,
          cacheCreationInputTokens: 0,
          totalCostUsd: 0,
        },
      },
    },
  ];

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
            end-state display per [L26]. The in-flight version shows the
            three-bar pulse driven by `isLivePhase(snap.phase)`; the
            terminal version renders the end-state — a tone-coded badge,
            active-time, and total tokens — driven by a representative
            `complete`-status `TurnEntry` fixture.
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
              <Z1AsstHalfStack
                modelName={SAMPLE_MODEL_NAME}
                phase="idle"
                endState={TRANSITION_SUCCESS_END_STATE}
              />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                terminal (idle · complete)
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
              endState={transitionEndState}
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

        <TugSeparator />

        {/* ---- Section 4 — End-state coverage ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Z1 asst-half — End-state Coverage</TugLabel>
          <TugLabel size="2xs" color="muted">
            The stack rendered for each of the four `TurnEndReason`
            values with a representative `TurnEntry` fixture per row.
            Each fixture drives `EndStateDisplay` via the same pure
            helpers (`endStateBadgeFor`, `totalTokensForTurn`,
            `formatTimeAlwaysHours`, `formatTokensCaps`) the
            production renderer will use. `complete` → success
            badge; `interrupted` and `transport_lost` → caution
            (recoverable / user-initiated); `error` → danger
            (system failure).
          </TugLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              padding: "12px 0",
            }}
          >
            {END_STATE_FIXTURES.map((fixture) => (
              <div
                key={fixture.endState.turnEndReason}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 4,
                }}
              >
                <Z1AsstHalfStack
                  modelName={SAMPLE_MODEL_NAME}
                  phase="idle"
                  endState={fixture.endState}
                />
                <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                  {fixture.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ResponderScope>
  );
}
