/**
 * dev-card-z1b.tsx — Z1B "end-state" row for both halves of a
 * dev-card transcript turn (user + assistant).
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
 *     [Z1B — end-state + copy]               ← THIS COMPONENT
 *
 * **Committed-end-state only.** Per [D19], TideZ1B owns the
 * end-state aggregate (OK / interrupted / error badge, per-turn
 * time + tokens, whole-turn COPY). The transcript-level in-flight
 * indicator is `TideZ1C`'s job (chrome below `TugListView`, not a
 * list row). TideZ1B no longer multiplexes "indicator ↔
 * end-state" — the live thinking indicator does not appear here.
 *
 * **Participant variants.** The component dispatches on `participant`:
 *
 *  - **`participant="assistant"`** — asst-half. Renders
 *    `[badge • time • tokens] • [COPY]` only when `turn` is
 *    defined; renders nothing (an empty slot div) while in-flight
 *    (`turn === undefined`).
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
 * data-driving prop: `turn`. End-state presence is derived
 * per-participant:
 *
 *  - user half → always end-state (submission completes the
 *    instant it posts; `turn` only adds the copy text once it lands).
 *  - assistant half, `turn !== undefined` → end-state.
 *  - assistant half, `turn === undefined` → no child (empty slot div).
 *
 * **Mount-identity discipline ([L26]).** Z1B is a single always-
 * mounted `<div data-slot="dev-z1b">` whose CHILD swaps exactly
 * once per row when `turn` lands. The slot div itself is never
 * unmounted at the turn boundary — so any focus / hover state the
 * row carries survives the swap. `AssistantTurnCell` / `UserMessageCell` are
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
 *    `data-participant` attributes and the `:empty` collapse rule.
 *    No inline style for appearance.
 *  - [L19] file pair with the component; `data-slot` anchors on
 *    every visible primitive.
 *  - [L20] consumer-only — no new token slot family. The component
 *    inherits typography from the row's chrome.
 *
 * @module components/tugways/cards/dev-card-z1b
 */

import "./dev-card-z1b.css";

import React from "react";
import { Check, ShieldAlert, ShieldX, Unplug } from "lucide-react";

import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugLabel } from "@/components/tugways/tug-label";
import { endStateBadgeFor } from "@/lib/code-session-store/end-state";
import type {
  TurnEntry,
  TurnEndReason,
} from "@/lib/code-session-store/types";

import {
  formatDurationMs,
  formatTokensCaps,
} from "./dev-card-telemetry-renderers";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Which half of the turn this Z1B instance belongs to. Drives the
 * `data-participant` attribute and the per-variant content choices
 * (see module docstring).
 */
export type TideZ1BParticipant = "user" | "assistant";

export interface TideZ1BProps {
  /**
   * Which transcript half the Z1B sits on. The user variant
   * suppresses the time / tokens metrics (those are asst-side
   * data) and is always end-state (the submission completes the
   * instant it posts). The asst variant carries the full metrics
   * row, but only renders end-state once `turn` is defined; while
   * in-flight, the transcript-level `TideZ1C` carries the
   * indicator (this slot is empty).
   */
  participant: TideZ1BParticipant;
  /**
   * The committed turn entry for this row, if any. `undefined` for
   * the in-flight row (the single row the data source emits while
   * a turn is mid-stream); populated post-`turn_complete` for every
   * committed row. The presence of this field gates whether the
   * assistant half renders its end-state.
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
   * The user half passes the submitted message text; the assistant half
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
  // End-state presence — per [D19] TideZ1B is committed-end-state
  // only.
  //
  //  - User half: submission completes the instant it posts; end-
  //    state is shown immediately, in-flight and committed alike.
  //  - Assistant half: end-state shown only when `turn !== undefined`.
  //    While in-flight the transcript-level `TideZ1C` carries the
  //    indicator; this slot renders nothing.
  const hasEndState = isUserHalf || turn !== undefined;
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
    participant === "assistant" ? "Copy response" : "Copy message";

  return (
    <div
      className="dev-z1b"
      data-slot="dev-z1b"
      data-participant={participant}
    >
      {hasEndState ? (
        <EndStateDisplay
          participant={participant}
          reason={reason}
          turn={turn}
          perTurnTokens={perTurnTokens}
        />
      ) : null}
      {showCopy ? (
        <>
          <TugLabel
            size="xs"
            emphasis="calm"
            aria-hidden
            className="dev-z1b-separator"
          >
            •
          </TugLabel>
          <span className="dev-z1b-copy">
            <BlockCopyButton
              data-slot="dev-z1b-copy"
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
 *  - `participant="assistant"` → `[badge • time • tokens]`
 *  - `participant="user"` → `[badge]` only
 *
 * The badge is driven by the caller-supplied `reason`: the assistant
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
      className="dev-z1b-end-state"
      data-slot="dev-z1b-end-state"
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
      {participant === "assistant" && turn !== undefined ? (
        <>
          <TugLabel size="xs" emphasis="calm" aria-hidden>
            •
          </TugLabel>
          <TugLabel size="xs">{formatDurationMs(turn.activeMs)}</TugLabel>
          <TugLabel size="xs" emphasis="calm" aria-hidden>
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
