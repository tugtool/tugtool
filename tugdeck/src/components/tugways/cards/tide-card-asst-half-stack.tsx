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
 * **Mode dispatch — purely per-row.** The component takes one
 * data-driving prop: `turn`. The data source's invariant is "a row
 * with `turn === undefined` is the (single) in-flight row; a row
 * with `turn !== undefined` is a committed row." Z1B dispatches
 * directly on that:
 *
 *  - `turn !== undefined` → committed row → `EndStateDisplay`
 *    (tone-coded ghost badge + active-time + total tokens).
 *  - `turn === undefined` → in-flight row → `TugThinkingIndicator`
 *    (animating, label-hidden).
 *
 * The session `phase` is deliberately NOT an input here. Phase is
 * a session-wide signal; using it would force every assistant row
 * in the transcript to re-derive "is this the in-flight row?"
 * (the only one phase actually applies to). The data source has
 * already encoded that distinction at the row level, so the
 * component reads it straight off `row.turn`.
 *
 * **Mount-identity discipline ([L26]).** Z1B is a single always-
 * mounted `<div data-slot="tide-asst-half-z1b">` whose CHILD swaps
 * exactly once per row when `turn` lands. The slot div itself is
 * never unmounted at the turn boundary — so any focus / hover
 * state the assistant row carries survives the indicator →
 * end-state transition. `CodeRowCell` is keyed by stable
 * `turnKey` (byte-identical pre/post commit), so the cell wrapper
 * survives the same transition; this component inherits that
 * contract.
 *
 * **Trailing copy button.** When `turn` is defined and `bodyText`
 * is non-empty, the row's trailing edge renders a `BlockCopyButton`
 * whose `getText` returns `bodyText`. Suppressed for in-flight
 * rows (nothing to copy yet) and for empty-body committed rows.
 *
 * Conformance:
 *  - [L02] no external-state reads — the component is a pure
 *    function of `turn` + `bodyText`. The caller has already
 *    subscribed to the data source.
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
import type {
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
   * The committed turn entry for this row, if any. `undefined` for
   * the in-flight row (the single row the data source emits while
   * a turn is mid-stream); populated post-`turn_complete` for every
   * committed row. The presence of this field is the SOLE driver
   * of the live ↔ terminal mode dispatch — see module docstring.
   */
  turn?: TurnEntry;
  /**
   * Plain-text source for the copy-button affordance. When non-
   * empty AND `turn` is defined, the row's trailing edge renders
   * a `BlockCopyButton` whose `getText` returns this string.
   * Suppressed for in-flight rows (nothing to copy yet) and for
   * empty-body committed rows.
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
  turn,
  bodyText,
}) => {
  // Per-row mode dispatch. `turn !== undefined` is the data
  // source's "this row is committed" signal; the absence of a
  // turn is the data source's "this row is the in-flight row."
  // No session-wide signal is consulted — every other row in the
  // transcript independently lands in `terminal` because each of
  // them has its own committed `TurnEntry`.
  const hasEndState = turn !== undefined;
  const mode: "live" | "terminal" = hasEndState ? "terminal" : "live";
  const showCopy =
    hasEndState && bodyText !== undefined && bodyText.length > 0;
  const bodyTextForCopy = bodyText ?? "";

  return (
    <div
      className="tide-asst-half-z1b"
      data-slot="tide-asst-half-z1b"
      data-mode={mode}
    >
      {hasEndState ? (
        <EndStateDisplay turn={turn} />
      ) : (
        <TugThinkingIndicator animating={true} labelPosition="hidden" />
      )}
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
