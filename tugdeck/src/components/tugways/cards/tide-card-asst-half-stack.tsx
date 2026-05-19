/**
 * tide-card-asst-half-stack.tsx — Z1B "status / end-state" row for
 * the production assistant transcript row.
 *
 * The component is the polished design promoted from
 * `gallery-tide-asst-half-stack.tsx` per [Step 20.4.15]. It lands
 * inside the `TugTranscriptEntry` controls slot of the assistant
 * row — Z1A (model + timestamp + sequence) is supplied by
 * `TugTranscriptEntry`'s header; the entry body hosts the streaming
 * markdown / thinking / tool-calls content; this component owns
 * the footer row that sits beneath the body.
 *
 * Layout (Option B — body on top, Z1B beneath):
 *
 *     [TugTranscriptEntry header — Z1A: model + timestamp]
 *     [body — streaming assistant content]
 *     [Z1B — status / end-state + copy]      ← THIS COMPONENT
 *
 * **Mode dispatch.** When `isLivePhase(phase)` is true the slot
 * paints a `TugThinkingIndicator` (animating, label-hidden) — the
 * canonical "agent is working on this turn" signal. When the phase
 * is terminal AND an `endState` is supplied, the slot swaps to
 * `EndStateDisplay`: a tone-coded ghost-emphasis badge with icon,
 * the turn's active-time, a `•` separator, and the total tokens.
 * Terminal phases without an `endState` (e.g., a turn that lived
 * across a wire restart and is missing telemetry) render nothing
 * but still hold the slot div mounted — preserving the per-row
 * mount-identity contract below.
 *
 * **Mount-identity discipline ([L26]).** Z1B is a single always-
 * mounted `<div data-slot="tide-asst-half-z1b">` whose CHILD swaps
 * between the in-flight indicator, the end-state display, and an
 * empty render. The slot div itself is never unmounted at the
 * turn boundary — so any focus / hover / scroll-position state the
 * assistant row carries survives the indicator → end-state
 * transition.
 *
 * **Trailing copy button.** When the phase is terminal, an
 * `endState` exists, and `bodyText` is non-empty, the row's
 * trailing edge renders a `BlockCopyButton` whose `getText`
 * returns `bodyText`. Suppressed for live phases (nothing to
 * copy yet) and for empty-body terminal scenarios.
 *
 * Conformance:
 *  - [L02] external state — `phase` is read by the caller (the
 *    transcript cell) via `useSyncExternalStore` and threaded down
 *    as a prop. This component is a pure function of inputs.
 *  - [L06] all appearance state flows through CSS classes /
 *    `data-mode` attribute. No inline style for appearance.
 *  - [L19] file pair with the component; `data-slot` anchors on
 *    every visible primitive.
 *  - [L20] consumer-only — no new token slot family. The component
 *    inherits typography from the row's chrome.
 *  - [L26] always-mounted Z1B slot survives the in-flight ↔
 *    terminal swap. Same contract the workshop gallery validates.
 *
 * @module components/tugways/cards/tide-card-asst-half-stack
 */

import "./tide-card-asst-half-stack.css";

import React from "react";
import { Check, ShieldAlert, ShieldX, Unplug } from "lucide-react";

import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugThinkingIndicator } from "@/components/tugways/tug-thinking-indicator";
import {
  endStateBadgeFor,
  totalTokensForTurn,
} from "@/lib/code-session-store/end-state";
import { isLivePhase } from "@/lib/code-session-store/hooks/use-lifecycle-tick";
import type {
  CodeSessionPhase,
  TurnEntry,
  TurnEndReason,
} from "@/lib/code-session-store/types";

import {
  formatDurationMs,
  formatTokensCaps,
} from "./tide-card-telemetry-renderers";

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface TideAsstHalfZ1BProps {
  /**
   * The session phase, threaded down from the cell's
   * `useSyncExternalStore` subscription to `CodeSessionStore`.
   * Drives the live vs terminal branch via {@link isLivePhase}.
   */
  phase: CodeSessionPhase;
  /**
   * The committed turn entry, if any. Populated post-`turn_complete`;
   * `undefined` for in-flight rows. Required for the end-state
   * display (the badge + numbers read off this).
   */
  turn?: TurnEntry;
  /**
   * Plain-text source for the copy-button affordance. When non-
   * empty AND the phase is terminal AND `turn` is defined, the
   * row's trailing edge renders a `BlockCopyButton` whose
   * `getText` returns this string. Suppressed for live phases
   * (nothing to copy yet) and for empty-body terminal scenarios.
   */
  bodyText?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Z1B status / end-state row for the production assistant
 * transcript row. See module docstring for layout, mode dispatch,
 * and conformance notes.
 */
export const TideAsstHalfZ1B: React.FC<TideAsstHalfZ1BProps> = ({
  phase,
  turn,
  bodyText,
}) => {
  const live = isLivePhase(phase);
  const hasEndState = !live && turn !== undefined;
  const showCopy =
    hasEndState && bodyText !== undefined && bodyText.length > 0;
  const bodyTextForCopy = bodyText ?? "";

  // `data-mode` is the only dispatch the parent CSS needs: `live`
  // for the indicator branch, `terminal` for the end-state branch,
  // `idle` for the always-mounted-but-empty fallback. The slot div
  // itself is unconditionally mounted ([L26]).
  const mode: "live" | "terminal" | "idle" = live
    ? "live"
    : hasEndState
      ? "terminal"
      : "idle";

  return (
    <div
      className="tide-asst-half-z1b"
      data-slot="tide-asst-half-z1b"
      data-mode={mode}
    >
      {live ? (
        <TugThinkingIndicator animating={true} labelPosition="hidden" />
      ) : hasEndState ? (
        <EndStateDisplay turn={turn!} />
      ) : null}
      {showCopy ? (
        <>
          <TugLabel
            size="xs"
            color="muted"
            aria-hidden
            className="tide-asst-half-z1b-separator"
          >
            ::
          </TugLabel>
          <span className="tide-asst-half-z1b-copy">
            <BlockCopyButton
              data-slot="tide-asst-half-copy"
              getText={() => bodyTextForCopy}
              aria-label="Copy response"
            />
          </span>
        </>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// End-state display
// ---------------------------------------------------------------------------

/**
 * Per-reason icon for the end-state badge. Sized to track the
 * `md` badge's natural icon dimensions — a hair larger so the
 * glyph reads as the badge's anchor next to the slightly bigger
 * label text.
 */
function endStateBadgeIcon(reason: TurnEndReason): React.ReactNode {
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
 * Z1B end-state display. One tight inline row: ghost-emphasis badge
 * with icon, active-time, a `•` separator, total-tokens with a
 * "tokens" label suffix. The badge's `ghost` emphasis keeps it
 * visually subordinate to the model name above; the bullet sits
 * only between the time and tokens (the badge has enough visual
 * weight on its own to mark the boundary against the time).
 *
 * The (text, role) mapping for the badge comes from
 * `endStateBadgeFor`; the total-tokens sum from
 * `totalTokensForTurn`. Both are pure helpers exported from
 * `code-session-store/end-state` so the workshop gallery and this
 * production component compute identical numbers.
 */
function EndStateDisplay({ turn }: { turn: TurnEntry }): React.ReactElement {
  const badge = endStateBadgeFor(turn.turnEndReason);
  const tokens = totalTokensForTurn(turn.cost);
  return (
    <span
      className="tide-asst-half-end-state"
      data-slot="tide-asst-half-end-state"
    >
      <TugBadge
        size="md"
        emphasis="ghost"
        role={badge.role}
        icon={endStateBadgeIcon(turn.turnEndReason)}
        iconGap={5}
      >
        {badge.text}
      </TugBadge>
      <TugLabel
        size="xs"
        color="muted"
        aria-hidden
        className="tide-asst-half-end-state-separator"
      >
        ::
      </TugLabel>
      <TugLabel size="xs">{formatDurationMs(turn.activeMs)}</TugLabel>
      <TugLabel size="xs" color="muted" aria-hidden>
        •
      </TugLabel>
      <TugLabel size="xs">{`${formatTokensCaps(tokens)} tokens`}</TugLabel>
    </span>
  );
}
