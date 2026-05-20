/**
 * tide-card-z1b.tsx — Z1B "status / end-state" row for both halves
 * of a tide-card transcript turn (user + assistant).
 *
 * The component lands inside `TugTranscriptEntry`'s controls slot
 * on both row halves. Z1A (identifier + timestamp + sequence) is
 * supplied by `TugTranscriptEntry`'s header; the entry body hosts
 * the per-half content (user text on the user row; streaming
 * markdown / thinking / tool-calls on the asst row); this
 * component owns the footer row that sits beneath the body.
 *
 * Layout (Option B — body on top, Z1B beneath):
 *
 *     [TugTranscriptEntry header — Z1A: identifier + timestamp]
 *     [body — per-half content]
 *     [Z1B — status / end-state + copy]      ← THIS COMPONENT
 *
 * **Participant variants.** The component dispatches on `participant`:
 *
 *  - **`participant="code"`** — asst-half. Terminal state shows
 *    `[badge :: time • tokens] :: [COPY]`. In-flight state shows
 *    `[TugThinkingIndicator]` (the live "agent is working on this
 *    turn" signal).
 *  - **`participant="user"`** — user-half. Terminal state shows
 *    `[badge] :: [COPY]` — the same badge as the asst-half so the
 *    two halves of a turn share an outcome glance, but no time /
 *    tokens (those are asst-side data). In-flight state renders
 *    nothing visible (the user message is already there; no live
 *    indicator on the user row).
 *
 * Both variants drive the badge off `endStateBadgeFor(turn.turnEndReason)`
 * — the same pure helper — so a turn's two halves always agree on
 * the outcome glyph + text + tone. Vertical symmetry by
 * construction.
 *
 * **Mode dispatch — purely per-row.** The component takes one
 * data-driving prop: `turn`. The data source's invariant is "a row
 * with `turn === undefined` is the (single) in-flight row; a row
 * with `turn !== undefined` is a committed row." Z1B dispatches
 * directly on that:
 *
 *  - `turn !== undefined` → committed → `terminal` mode.
 *  - `turn === undefined` → in-flight → `live` (code) or `idle` (user).
 *
 * The session `phase` is deliberately NOT an input here. Phase is
 * a session-wide signal; using it would force every assistant row
 * to re-derive "is this the in-flight row?" (the only one phase
 * actually applies to). The data source has already encoded that
 * distinction at the row level, so the component reads it
 * straight off `row.turn`.
 *
 * **Mount-identity discipline ([L26]).** Z1B is a single always-
 * mounted `<div data-slot="tide-z1b">` whose CHILD swaps exactly
 * once per row when `turn` lands. The slot div itself is never
 * unmounted at the turn boundary — so any focus / hover state the
 * row carries survives the swap. `CodeRowCell` / `UserRowCell` are
 * keyed by stable `turnKey` (byte-identical pre/post commit), so
 * the cell wrappers survive the same transition; this component
 * inherits that contract.
 *
 * **Trailing copy button.** When `turn` is defined and `bodyText`
 * is non-empty, the row's trailing edge renders a `BlockCopyButton`
 * whose `getText` returns `bodyText`. Suppressed for in-flight
 * rows (nothing to copy yet) and for empty-body committed rows.
 * The aria-label varies by participant ("Copy response" vs "Copy
 * message"); both share the same labelled `BlockCopyButton`
 * affordance so the COPY chip reads identically on both halves.
 *
 * Conformance:
 *  - [L02] no external-state reads — the component is a pure
 *    function of `participant` + `turn` + `bodyText`. The caller
 *    has already subscribed to the data source.
 *  - [L06] all appearance state flows through CSS classes /
 *    `data-mode` + `data-participant` attributes. No inline style
 *    for appearance.
 *  - [L19] file pair with the component; `data-slot` anchors on
 *    every visible primitive.
 *  - [L20] consumer-only — no new token slot family. The component
 *    inherits typography from the row's chrome.
 *  - [L26] always-mounted Z1B slot survives the in-flight ↔
 *    terminal swap. Both participant variants share the same
 *    slot-div mount contract.
 *
 * @module components/tugways/cards/tide-card-z1b
 */

import "./tide-card-z1b.css";

import React from "react";
import { Check, ShieldAlert, ShieldX, Unplug } from "lucide-react";

import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugThinkingIndicator } from "@/components/tugways/tug-thinking-indicator";
import {
  endStateBadgeFor,
  perTurnTokens,
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
// Public types
// ---------------------------------------------------------------------------

/**
 * Which half of the turn this Z1B instance belongs to. Drives the
 * `data-participant` attribute and the per-variant content choices
 * (see module docstring).
 */
export type TideZ1BParticipant = "user" | "code";

export interface TideZ1BProps {
  /**
   * Which transcript half the Z1B sits on. The user variant
   * suppresses the time / tokens metrics (those are asst-side
   * data) and renders nothing in the in-flight branch (no live
   * indicator on the user row). The asst variant carries the
   * full metrics row and the `TugThinkingIndicator` while
   * in-flight.
   */
  participant: TideZ1BParticipant;
  /**
   * The committed turn entry for this row, if any. `undefined` for
   * the in-flight row (the single row the data source emits while
   * a turn is mid-stream); populated post-`turn_complete` for every
   * committed row. The presence of this field is the SOLE driver
   * of the live ↔ terminal mode dispatch.
   */
  turn?: TurnEntry;
  /**
   * The turn committed immediately before {@link turn}. The asst-half
   * uses it to compute the per-turn token delta against the prior
   * turn's context window (`perTurnTokens`). `undefined` for the
   * first turn and for in-flight / user rows.
   */
  prevTurn?: TurnEntry;
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
 * Z1B status / end-state row. See module docstring for layout,
 * mode dispatch, participant variants, and conformance notes.
 */
export const TideZ1B: React.FC<TideZ1BProps> = ({
  participant,
  turn,
  prevTurn,
  bodyText,
}) => {
  // Per-row mode dispatch. `turn !== undefined` is the data
  // source's "this row is committed" signal; the absence of a
  // turn is the data source's "this row is the in-flight row."
  // Both halves share the SAME signal, but the in-flight branch
  // differs: code shows the indicator, user renders nothing.
  const hasEndState = turn !== undefined;
  const mode: "live" | "terminal" | "idle" = hasEndState
    ? "terminal"
    : participant === "code"
      ? "live"
      : "idle";
  const showCopy =
    hasEndState && bodyText !== undefined && bodyText.length > 0;
  const bodyTextForCopy = bodyText ?? "";
  // Per-participant copy phrasing — the affordance itself is the
  // same `BlockCopyButton`; only the aria-label differs.
  const copyAriaLabel =
    participant === "code" ? "Copy response" : "Copy message";

  return (
    <div
      className="tide-z1b"
      data-slot="tide-z1b"
      data-participant={participant}
      data-mode={mode}
    >
      {hasEndState ? (
        <EndStateDisplay
          participant={participant}
          turn={turn}
          prevTurn={prevTurn}
        />
      ) : participant === "code" ? (
        <TugThinkingIndicator animating={true} labelPosition="hidden" />
      ) : null}
      {showCopy ? (
        <>
          <TugLabel
            size="xs"
            color="muted"
            aria-hidden
            className="tide-z1b-separator"
          >
            ::
          </TugLabel>
          <span className="tide-z1b-copy">
            <BlockCopyButton
              data-slot="tide-z1b-copy"
              getText={() => bodyTextForCopy}
              aria-label={copyAriaLabel}
              // One step up from the affordance default (`2xs`) so
              // COPY's 11px font + 12px icon read at the same scale
              // as the row's surrounding `TugLabel size="xs"` (12px)
              // and `TugBadge size="md"` (12px font). The `2xs`
              // default suits in-block-header callsites where the
              // surrounding text is muted path-label scale.
              size="xs"
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
 * Per-reason icon for the end-state badge. The Lucide `size` prop
 * sets the SVG's intrinsic dimensions; `tug-badge.css`'s
 * `.tug-badge-size-md .tug-badge-icon svg` rule then scales the
 * rendered icon to match the badge's 12px font-size. The 14px
 * source size leaves the glyph a hair larger than the label text
 * before the CSS scale-down, which keeps stroke weight crisp at
 * the rendered size.
 */
function endStateBadgeIcon(reason: TurnEndReason): React.ReactNode {
  switch (reason) {
    case "complete":
      return <Check size={14} aria-hidden="true" />;
    case "interrupted":
      return <ShieldAlert size={14} aria-hidden="true" />;
    case "error":
      return <ShieldX size={14} aria-hidden="true" />;
    case "transport_lost":
      return <Unplug size={14} aria-hidden="true" />;
  }
}

/**
 * Z1B end-state display. Two participant variants share a single
 * primitive:
 *
 *  - `participant="code"` → `[badge :: time • tokens]`
 *  - `participant="user"` → `[badge]` only
 *
 * Both variants drive the badge off
 * `endStateBadgeFor(turn.turnEndReason)` so the two halves of one
 * turn always show the same outcome glyph + text + tone. The
 * asst-half adds the per-turn time + tokens; the user-half omits
 * them because they're asst-side data (a user message doesn't
 * have an active-ms or token-cost field directly attributable to
 * the submission itself).
 *
 * The badge's `ghost` emphasis keeps it visually subordinate to
 * the identifier above; the bullet sits only between the time and
 * tokens (the badge has enough visual weight on its own to mark
 * the boundary against the time).
 */
function EndStateDisplay({
  participant,
  turn,
  prevTurn,
}: {
  participant: TideZ1BParticipant;
  turn: TurnEntry;
  prevTurn: TurnEntry | undefined;
}): React.ReactElement {
  const badge = endStateBadgeFor(turn.turnEndReason);
  const showMetrics = participant === "code";
  const tokens = showMetrics ? perTurnTokens(turn.cost, prevTurn?.cost) : 0;
  return (
    <span
      className="tide-z1b-end-state"
      data-slot="tide-z1b-end-state"
      data-participant={participant}
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
      {showMetrics ? (
        <>
          <TugLabel
            size="xs"
            color="muted"
            aria-hidden
            className="tide-z1b-end-state-separator"
          >
            ::
          </TugLabel>
          <TugLabel size="xs">{formatDurationMs(turn.activeMs)}</TugLabel>
          <TugLabel size="xs" color="muted" aria-hidden>
            •
          </TugLabel>
          <TugLabel size="xs">{`${formatTokensCaps(tokens)} tokens`}</TugLabel>
        </>
      ) : null}
    </span>
  );
}
