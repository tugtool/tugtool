/**
 * gallery-tide-asst-half-stack.tsx -- Z1 asst-half two-line stack
 * (gallery-only).
 *
 * Workshop surface for the production Z1 asst-half chrome that will
 * replace the dangling-model-name look in
 * `tide-card-transcript.tsx`'s assistant row (per Step 20.5.D's
 * promotion).
 *
 * The chrome is a two-row stack with body content between (Option
 * B layout):
 *
 *     [model name]  [timestamp]              ← Z1A (top, persistent)
 *
 *     [body — streaming assistant content
 *      flows here and grows downward]
 *
 *     [status OR end-state]      [copy]      ← Z1B (bottom, mode-dependent)
 *
 * **Z1A** holds the model name + timestamp; both fields are
 * persistent across the turn lifecycle. **Z1B** hosts the live
 * three-bar indicator while a turn is in flight, then swaps to
 * the end-state display (badge + active-time + tokens) once the
 * turn lands on a terminal phase. A trailing copy button appears
 * on Z1B's right edge when an `endState` and `onCopy` handler are
 * both supplied — the production analog of the copy-body action
 * currently surfaced via `TugTranscriptEntry`'s `controls` slot.
 *
 * **Mount-identity discipline ([L26]).** Z1B is a single always-
 * mounted `<div data-slot="tide-asst-half-z1b">` whose CHILD
 * swaps between the in-flight indicator and the end-state
 * display. The slot div itself is never unmounted at the turn
 * boundary — so any focus / hover / scroll-position state the
 * assistant row carries survives the indicator → end-state
 * transition. Z1A carries its own `data-slot="tide-asst-half-z1a"`
 * anchor so tests + tooling can pin both rows by selector.
 *
 * **End-state slot.** Renders `EndStateDisplay` ([Step 20.4.13])
 * when the consumer supplies an `endState`: a ghost-emphasis,
 * icon-leading badge (`endStateBadgeFor` + `endStateBadgeIcon`),
 * the turn's active-ms (`formatDurationMs`), and total tokens
 * (`perTurnTokens` + `formatTokensCaps`), separated by `•`
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
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
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
  perTurnTokens,
} from "@/lib/code-session-store/end-state";
import { TugBadge } from "@/components/tugways/tug-badge";
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

// ---------------------------------------------------------------------------
// Z1B layout tunables — adjust these directly to iterate the spacing
// + alignment of the badge / separators / COPY button. Every consumer
// of these numbers lives in this file, so a change here re-flows
// the whole Z1B chrome on the next HMR tick.
// ---------------------------------------------------------------------------

/**
 * Base inter-item gap (px) inside `EndStateDisplay`. Applies between
 * EVERY pair of adjacent items: badge → `::` → time → `•` → tokens.
 * The flex container's `gap` realises this uniformly.
 *
 * Bump this to push every item further from its neighbors; reduce
 * to tighten the row.
 */
const Z1B_INNER_GAP_PX = 6;

/**
 * Extra horizontal margin (px) on each side of the `::` separators
 * — added ON TOP of `Z1B_INNER_GAP_PX`. Lets the double-colons
 * breathe a bit more than the `•` separator without changing the
 * row's overall gap.
 *
 * Set to `0` to make every separator's spacing match `Z1B_INNER_GAP_PX`
 * exactly. Positive values push the `::` further from its neighbors
 * (effective gap around `::` = `Z1B_INNER_GAP_PX + SEP_EXTRA_MARGIN_PX`
 * on each side).
 */
const Z1B_DOUBLE_COLON_EXTRA_MARGIN_PX = 8;

/**
 * Base inter-item gap (px) on the outer Z1B row (between
 * `EndStateDisplay`, the trailing `::`, and `BlockCopyButton`).
 * Mirrors `Z1B_INNER_GAP_PX` by default so the outer row reads
 * with the same rhythm as the inner end-state row.
 */
const Z1B_OUTER_GAP_PX = 8;

/**
 * Vertical nudge (px) applied to the trailing COPY button so its
 * text baseline lines up with the badge / time / tokens text.
 * Negative values shift the button UP; positive shift DOWN.
 *
 * The COPY button (TugPushButton size=2xs, 20px tall) is shorter
 * than the badge (TugBadge size=md, 24px tall). With
 * `alignItems: center` the COPY's text-middle sits ~2px below the
 * badge's text-middle (the badge's text is offset upward by its
 * larger padding+border allowance). A small negative `translateY`
 * pulls COPY back onto the row's baseline.
 *
 * Tune by eyeball until COPY's "COPY" letters share a baseline
 * with the badge's "OK" letters.
 */
const Z1B_COPY_BASELINE_NUDGE_PX = 0.25;

/**
 * Horizontal nudge (px) applied to the trailing COPY button's
 * left edge. Negative values pull COPY CLOSER to the trailing
 * `::` separator; positive values push it further away.
 *
 * Operates independently of `Z1B_OUTER_GAP_PX` and
 * `Z1B_DOUBLE_COLON_EXTRA_MARGIN_PX` so the gap between
 * `EndStateDisplay` and the `::` stays fixed while only COPY's
 * proximity to `::` is adjusted.
 *
 * The effective COPY-to-`::` gap = `Z1B_OUTER_GAP_PX +
 * Z1B_DOUBLE_COLON_EXTRA_MARGIN_PX + Z1B_COPY_LEFT_NUDGE_PX`.
 * Set negative to tighten; positive to loosen.
 */
const Z1B_COPY_LEFT_NUDGE_PX = -14;

/**
 * Sample model name displayed in the model row. Mirrors the literal
 * Anthropic identifier the SessionMetadataStore reports (the
 * `[1m]` suffix is present in production — kept so the gallery
 * design accounts for the worst-case width).
 */
const SAMPLE_MODEL_NAME = "claude-opus-4-7[1m]";

/**
 * Sample timestamp displayed in Z1A alongside the model name.
 * Mirrors the format `formatTranscriptTimestamp` produces in
 * production. Hard-coded here so the gallery rendering is stable
 * across mounts (a live `Date.now()` would shift the value on
 * every render and obscure visual regressions).
 */
const SAMPLE_TIMESTAMP = "12:34:56";

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
  timestamp = SAMPLE_TIMESTAMP,
  phase,
  endState,
  body,
  bodyText,
}: {
  modelName: string;
  /**
   * Timestamp text rendered in Z1A alongside the model name. In
   * production this is `formatTranscriptTimestamp(turn.endedAt)`.
   * The gallery defaults to `SAMPLE_TIMESTAMP` so most callsites
   * don't need to repeat it.
   */
  timestamp?: string;
  phase: CodeSessionPhase;
  /**
   * Post-turn data for Z1B. When the phase is terminal AND this
   * is provided, Z1B renders `EndStateDisplay`. When the phase is
   * terminal and this is absent, Z1B falls back to a small muted
   * "no end-state recorded" line so existing gallery sections
   * that don't carry a completed-turn fixture still render
   * meaningful chrome.
   */
  endState?: Z1AsstHalfEndState;
  /**
   * Body content rendered BETWEEN Z1A (model + timestamp) and Z1B
   * (status / end-state + copy). In production this hosts the
   * streaming markdown / thinking / tool-calls content; in the
   * gallery it's a static paragraph.
   */
  body?: React.ReactNode;
  /**
   * Plain-text source for the copy-button affordance. When non-
   * empty AND the phase is terminal AND an `endState` exists,
   * Z1B's trailing slot renders a `BlockCopyButton` whose
   * `getText` returns this string. The button reuses the same
   * affordance the block renderers use (`FileBlock`,
   * `DiffBlock`, etc.) so the rest/confirm flash + width
   * stabilization match the rest of the chrome library.
   * Suppressed for live phases (nothing to copy yet) and for
   * empty-end-state terminal scenarios.
   */
  bodyText?: string;
}): React.ReactElement {
  const live = isLivePhase(phase);
  const hasBody = body !== undefined && body !== null;
  const showCopy =
    !live &&
    endState !== undefined &&
    bodyText !== undefined &&
    bodyText.length > 0;
  const bodyTextForCopy = bodyText ?? "";
  return (
    <div
      data-slot="tide-asst-half-stack"
      style={{
        display: "flex",
        flexDirection: "column",
        // Wider gap when a body is present so Z1B reads as a
        // footer beneath the content, not as a sibling of Z1A.
        // Without a body the chrome collapses to a tight
        // label-pair (Z1A directly atop Z1B).
        gap: hasBody
          ? "var(--tug-space-md, 12px)"
          : "var(--tug-space-2xs, 2px)",
        // With a body, stretch so the body content can fill the
        // available reading column; without one, collapse to the
        // model name's natural width.
        alignItems: hasBody ? "stretch" : "flex-start",
      }}
    >
      {/*
        Z1A — model + timestamp.
        The bold model name carries the row; the timestamp sits
        beside it in a muted weight so the model name reads as
        the primary identifier. Both fields render in `MONO` at
        `--tug-font-size-sm` so Z1A and Z1B share typographic
        rhythm.
      */}
      <div
        data-slot="tide-asst-half-z1a"
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: "var(--tug-space-sm, 6px)",
          fontFamily: MONO,
          fontSize: "var(--tug-font-size-sm)",
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: TEXT_NORMAL, fontWeight: 600 }}>
          {modelName}
        </span>
        <span
          data-slot="tide-asst-half-z1a-timestamp"
          style={{
            color: TEXT_MUTED,
            fontSize: "var(--tug-font-size-xs)",
          }}
        >
          {timestamp}
        </span>
      </div>
      {hasBody ? (
        <div
          data-slot="tide-asst-half-body"
          style={{
            color: TEXT_NORMAL,
            fontSize: "var(--tug-font-size-sm)",
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>
      ) : null}
      {/*
        Z1B — status row. Single always-mounted div per [L26];
        the child swaps (indicator ↔ end-state ↔ placeholder)
        but the container does not. Tooling can observe
        `data-slot="tide-asst-half-z1b"` to verify the boundary
        survives the swap.

        Layout: leading content (indicator OR end-state OR
        placeholder) left-aligned; optional trailing copy button
        pushed to the row's right edge via `margin-left: auto`.
      */}
      <div
        data-slot="tide-asst-half-z1b"
        style={{
          display: "flex",
          // Center alignment puts each item's vertical-middle on
          // the same row-middle line. With the inline badge (no
          // fixed height), every item shares the same effective
          // text-line height, so center alignment also lands all
          // text baselines on the same y.
          alignItems: "center",
          // Uniform 2px left indent across both Z1B variants —
          // the indicator and the inline end-state badge both
          // shift 2px right relative to Z1A above. The same
          // padding applies to both variants so the indicator
          // and end-state share the same horizontal start.
          paddingLeft: 2,
          // End-states only: pull Z1B up by 2px so the row sits
          // tighter under the body. The live variant keeps its
          // natural rhythm (the indicator's pulse looks better
          // with a hair more space above it).
          marginTop:
            !live && endState !== undefined ? -2 : 0,
          minHeight: "var(--tug-space-xl, 20px)",
          width: "100%",
          // Outer-row gap. Tunable via `Z1B_OUTER_GAP_PX`.
          gap: Z1B_OUTER_GAP_PX,
        }}
      >
        {live ? (
          <TugThinkingIndicator animating={true} labelPosition="hidden" />
        ) : endState !== undefined ? (
          <EndStateDisplay endState={endState} />
        ) : (
          <EndStatePlaceholder />
        )}
        {showCopy ? (
          <>
            <TugLabel
              size="xs"
              color="muted"
              aria-hidden
              style={{ marginInline: Z1B_DOUBLE_COLON_EXTRA_MARGIN_PX }}
            >
              ::
            </TugLabel>
            <span
              style={{
                // Per-button vertical nudge so COPY's text
                // baseline lines up with the badge / time /
                // tokens text. Tunable via
                // `Z1B_COPY_BASELINE_NUDGE_PX`. Negative =
                // shift up; positive = shift down.
                transform: `translateY(${Z1B_COPY_BASELINE_NUDGE_PX}px)`,
                // Per-button horizontal nudge so COPY can sit
                // closer to the trailing `::` than the row's
                // base gap would put it. Tunable via
                // `Z1B_COPY_LEFT_NUDGE_PX`. Negative = pull
                // closer; positive = push further.
                marginLeft: Z1B_COPY_LEFT_NUDGE_PX,
                display: "inline-flex",
              }}
            >
              <BlockCopyButton
                data-slot="tide-asst-half-copy"
                getText={() => bodyTextForCopy}
                aria-label="Copy response"
              />
            </span>
          </>
        ) : null}
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
  // Icon size 13 tracks the `md` badge's natural icon dimensions
  // a hair larger so the glyph reads as the badge's anchor next
  // to the slightly bigger label text.
  switch (reason) {
    case "complete":
      return <Check size={13} aria-hidden="true" />;
    case "interrupted":
      return <ShieldAlert size={13} aria-hidden="true" />;
    case "error":
      return <ShieldX size={13} aria-hidden="true" />;
    case "transport_lost":
      return <Unplug size={13} aria-hidden="true" />;
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
 * `endStateBadgeFor`; the per-turn token count comes from
 * `perTurnTokens`. Both are pure helpers exported from
 * `code-session-store/end-state` so the gallery and the production
 * renderer compute them identically. Time formatting
 * uses `formatDurationMs` (drops leading-zero parts — `7s` not
 * `0h 0m 07s`).
 */
function EndStateDisplay({
  endState,
}: {
  endState: Z1AsstHalfEndState;
}): React.ReactElement {
  const badge = endStateBadgeFor(endState.turnEndReason);
  // Workshop card — synthetic single end-state, no prior turn. The
  // prior window degenerates to this turn's own observed input
  // (`input + cache_read + cache_creation`), so the per-turn delta
  // shows the turn's `output`.
  const tokens = perTurnTokens(
    endState.cost,
    endState.cost.inputTokens +
      endState.cost.cacheReadInputTokens +
      endState.cost.cacheCreationInputTokens,
  );
  // Style for the `::` separators — base color + an extra
  // horizontal margin on each side (tunable via
  // `Z1B_DOUBLE_COLON_EXTRA_MARGIN_PX`). The flex container's
  // `gap` provides the base spacing; this margin adds to that
  // for the `::` only, leaving the `•` at the base gap.
  const doubleColonStyle: React.CSSProperties = {
    marginInline: Z1B_DOUBLE_COLON_EXTRA_MARGIN_PX,
  };
  return (
    <span
      data-slot="tide-asst-half-end-state"
      style={{
        display: "inline-flex",
        // Center alignment + matching font-size across every
        // child (TugBadge size=md uses 11px, TugLabel size=xs
        // uses 12px — close enough that center-alignment lands
        // their text-middle within ~0.5px of each other; the
        // baselines read as one line). Baseline alignment is
        // wrong here because TugBadge is inline-flex with a
        // fixed height, and its outer baseline per the CSS spec
        // is its margin-box bottom rather than its inner text
        // baseline.
        alignItems: "center",
        // Base inter-item gap. Tunable via `Z1B_INNER_GAP_PX`.
        gap: Z1B_INNER_GAP_PX,
        whiteSpace: "nowrap",
      }}
    >
      <TugBadge
        size="md"
        emphasis="ghost"
        role={badge.role}
        icon={endStateBadgeIcon(endState.turnEndReason)}
        iconGap={5}
      >
        {badge.text}
      </TugBadge>
      <TugLabel size="xs" color="muted" aria-hidden style={doubleColonStyle}>
        ::
      </TugLabel>
      <TugLabel size="xs">{formatDurationMs(endState.activeMs)}</TugLabel>
      <TugLabel size="xs" color="muted" aria-hidden>
        •
      </TugLabel>
      <TugLabel size="xs">{`${formatTokensCaps(tokens)} tokens`}</TugLabel>
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

  // Body content used across every section so each chrome
  // example renders with representative streaming output above
  // Z1B. Single source so iterating typography doesn't drift
  // between sections. Used as both the renderable body and the
  // copy-button's `getText` source (passed in as `bodyText`).
  const SAMPLE_BODY =
    "Sure — to enable tugbank's defaults store you'll want to add the `enableDefaults: true` flag to your `TugcastConfig` and restart the supervisor. The defaults are scoped per domain, so set `domain: \"my-app\"` to keep your keys isolated from other consumers on the same instance.";

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
    body: string;
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
      body: "Sure — to enable tugbank's defaults store you'll want to add the `enableDefaults: true` flag to your `TugcastConfig` and restart the supervisor. The defaults are scoped per domain, so set `domain: \"my-app\"` to keep your keys isolated from other consumers on the same instance.",
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
      body: "Looking at the migration, the first step is to back up your existing config file. Run `cp config.toml config.toml.bak` before",
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
      body: "Let me check the schema for that table.",
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
      body: "The handshake completes in three stages: first the client sends its capability list, then the server replies with the supported subset and a session token, and finally the client acknowledges by echoing the token back over the same channel. Each stage has its own timeout — the spec calls out 5s, 10s, and 5s respectively — and a failure at any stage falls back to the legacy",
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
            Two-row chrome with body content between: Z1A (model + timestamp,
            top, persistent) over the body and Z1B (status / end-state +
            copy, bottom, mode-dependent). Z1B's container is mounted once
            and its content swaps between the live indicator and the
            end-state display per [L26]. The in-flight version shows the
            three-bar pulse driven by `isLivePhase(snap.phase)`; the
            terminal version renders the end-state — a tone-coded badge,
            active-time, total tokens, and a trailing copy button — driven
            by a representative `complete`-status `TurnEntry` fixture.
          </TugLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 32,
              padding: "16px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: 8,
              }}
            >
              <Z1AsstHalfStack
                modelName={SAMPLE_MODEL_NAME}
                phase="streaming"
                body={SAMPLE_BODY}
              />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                in-flight (streaming)
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: 8,
              }}
            >
              <Z1AsstHalfStack
                modelName={SAMPLE_MODEL_NAME}
                phase="idle"
                endState={TRANSITION_SUCCESS_END_STATE}
                body={SAMPLE_BODY}
                bodyText={SAMPLE_BODY}
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
            and `idle`. Z1B's container
            (`data-slot="tide-asst-half-z1b"`) is always mounted — only
            its child swaps between the live indicator and the end-state
            display. The copy button appears at the trailing edge only
            once the turn lands on a terminal phase with an end-state.
            Inspect via DOM tools to confirm the slot div survives the
            swap (no parent re-mount).
          </TugLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "12px 0",
              maxWidth: 640,
            }}
          >
            <Z1AsstHalfStack
              modelName={SAMPLE_MODEL_NAME}
              phase={transitionPhase}
              endState={transitionEndState}
              body={SAMPLE_BODY}
              bodyText={SAMPLE_BODY}
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
            way — Z1A above remains stable across them. Terminal phases
            (idle, errored) surface the end-state placeholder when no
            `endState` fixture is supplied. Use the picker to scrub
            through the spectrum.
          </TugLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "12px 0",
              maxWidth: 640,
            }}
          >
            <Z1AsstHalfStack
              modelName={SAMPLE_MODEL_NAME}
              phase={phase}
              body={SAMPLE_BODY}
            />
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

        {/* ---- Section 4 — End-state coverage (Option B layout) ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Z1 asst-half — End-state Coverage (Option B)</TugLabel>
          <TugLabel size="2xs" color="muted">
            The stack rendered for each of the four `TurnEndReason`
            values with a representative `TurnEntry` fixture per
            row, laid out with the status row BENEATH a body of
            sample assistant content (Option B). The body sits
            between the model name (top) and the end-state row
            (bottom); as text streams in during a real turn it
            would grow downward and the indicator / end-state
            would always sit underneath the most recent line.
            Each row drives `EndStateDisplay` via the same pure
            helpers (`endStateBadgeFor`, `perTurnTokens`,
            `formatDurationMs`, `formatTokensCaps`) the
            production renderer will use. `complete` → success
            badge; `interrupted` and `transport_lost` → caution
            (recoverable / user-initiated); `error` → danger
            (system failure).
          </TugLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 32,
              padding: "12px 0",
              maxWidth: 640,
            }}
          >
            {END_STATE_FIXTURES.map((fixture) => (
              <div
                key={fixture.endState.turnEndReason}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 4,
                }}
              >
                <Z1AsstHalfStack
                  modelName={SAMPLE_MODEL_NAME}
                  phase="idle"
                  endState={fixture.endState}
                  body={fixture.body}
                  bodyText={fixture.body}
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
