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
 *  - **`participant="code"`** — asst-half. Committed state shows
 *    `[badge • time • tokens] • [COPY]`, the badge driven by
 *    `endStateBadgeFor(turn.turnEndReason)`. In-flight state shows
 *    `[TugThinkingIndicator]` (the live "agent is working on this
 *    turn" signal).
 *  - **`participant="user"`** — user-half. Always shows
 *    `[badge] • [COPY]` with a static "OK" badge — no time /
 *    tokens (those are asst-side data). The user's submission is
 *    complete the instant it posts, so the row carries its end-
 *    state immediately, in-flight and committed alike, and the
 *    badge never reflects `turn.turnEndReason`: an interrupt or
 *    error belongs to the *response*, not to the act of
 *    submitting.
 *
 * **Mode dispatch — purely per-row.** The component takes one
 * data-driving prop: `turn`. The data source's invariant is "a row
 * with `turn === undefined` is the (single) in-flight row; a row
 * with `turn !== undefined` is a committed row." Z1B dispatches
 * directly on that, per participant:
 *
 *  - user half → always `terminal` (the submission is complete the
 *    instant it posts; `turn` only adds the copy text once it lands).
 *  - code half, `turn !== undefined` → committed → `terminal` mode.
 *  - code half, `turn === undefined` → in-flight → `live` mode.
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
import { endStateBadgeFor } from "@/lib/code-session-store/end-state";
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
   * The committed turn's signed per-turn token count — `window(N) −
   * window(N−1)` from the transcript window-walk, computed by the
   * transcript data source. The asst-half renders it; the user half
   * ignores it. `undefined` for in-flight / user rows. Negative at a
   * `/compact` turn.
   */
  perTurnTokens?: number;
  /**
   * The markdown the copy-button affordance writes to the clipboard.
   * The user half passes the submitted message text; the code half
   * passes the full turn serialized by `turnEntryToMarkdown` (every
   * tool call's input/output plus the assistant prose). When non-
   * empty AND `turn` is defined, the row's trailing edge renders a
   * `BlockCopyButton` whose `getText` returns this string. Suppressed
   * for in-flight rows (nothing to copy yet) and for empty-body
   * committed rows.
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
  perTurnTokens,
  bodyText,
}) => {
  const isUserHalf = participant === "user";
  // Per-row mode dispatch.
  //
  //  - User half: the submission is complete the instant it posts,
  //    so the row always carries its end-state — in-flight and
  //    committed alike. Always `terminal`.
  //  - Code half: `turn !== undefined` is the data source's "this
  //    row is committed" signal; while in-flight (`turn ===
  //    undefined`) the live thinking indicator stands in.
  const hasEndState = isUserHalf || turn !== undefined;
  const mode: "live" | "terminal" = hasEndState ? "terminal" : "live";
  // End-state reason. The user half is pinned to `complete` — its
  // badge reports "the message was submitted," never the response's
  // outcome, so an interrupt / error never bleeds onto the user row.
  const reason: TurnEndReason =
    isUserHalf || turn === undefined ? "complete" : turn.turnEndReason;
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
          reason={reason}
          turn={turn}
          perTurnTokens={perTurnTokens}
        />
      ) : (
        <TugThinkingIndicator animating={true} labelPosition="hidden" />
      )}
      {showCopy ? (
        <>
          <TugLabel
            size="xs"
            color="muted"
            aria-hidden
            className="tide-z1b-separator"
          >
            •
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
 *  - `participant="code"` → `[badge • time • tokens]`
 *  - `participant="user"` → `[badge]` only
 *
 * The badge is driven by the caller-supplied `reason`: the code
 * half passes `turn.turnEndReason`; the user half passes a fixed
 * `complete` so its badge always reads "OK" — the user's
 * submission is done the instant it posts, independent of how the
 * response ends. The asst-half adds the per-turn time + tokens;
 * the user-half omits them because they're asst-side data (a user
 * message has no active-ms or token-cost attributable to the
 * submission itself), and its `turn` may still be `undefined`
 * while the response is in-flight.
 *
 * The badge's `ghost` emphasis keeps it visually subordinate to
 * the identifier above. A `•` separator sits between each pair of
 * items (badge / time / tokens) — the same glyph as the trailing
 * `•` before COPY, so the whole row reads with one separator.
 */
function EndStateDisplay({
  participant,
  reason,
  turn,
  perTurnTokens,
}: {
  participant: TideZ1BParticipant;
  reason: TurnEndReason;
  turn: TurnEntry | undefined;
  perTurnTokens: number | undefined;
}): React.ReactElement {
  const badge = endStateBadgeFor(reason);
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
        icon={endStateBadgeIcon(reason)}
        iconGap={5}
      >
        {badge.text}
      </TugBadge>
      {participant === "code" && turn !== undefined ? (
        <>
          <TugLabel size="xs" color="muted" aria-hidden>
            •
          </TugLabel>
          <TugLabel size="xs">{formatDurationMs(turn.activeMs)}</TugLabel>
          <TugLabel size="xs" color="muted" aria-hidden>
            •
          </TugLabel>
          <TugLabel size="xs">
            {`${formatTokensCaps(perTurnTokens ?? 0)} tokens`}
          </TugLabel>
        </>
      ) : null}
    </span>
  );
}
