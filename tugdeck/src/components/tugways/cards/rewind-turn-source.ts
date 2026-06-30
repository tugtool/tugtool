/**
 * rewind-turn-source.ts — the `/rewind` turn-picker projection ([#step-7-3]).
 *
 * Projects the committed `code-session-store` transcript into the rows the
 * `RewindSheet`'s picker lists: one row per turn the user can *return to* — a
 * targetable turn (opened with a real user submission AND carrying the
 * `promptUuid` anchor, [#step-7-1]) that has a later targetable turn to anchor
 * the chop on. The row is displayed as its destination but anchored on the
 * next turn (the first one dropped). The newest turn is the `(current)`
 * present, not a row. Wake turns (no user message) and pre-anchor turns (older
 * sessions) are skipped — they cannot be `session_rewind` targets.
 *
 * This is NOT a `SessionPickerSheet` data source ([D05]): that lists *distinct
 * sessions* for `/resume`; this lists *turns within the current session*. The
 * projection is pure (no diff-stat) — the per-row diff-stat is fetched lazily
 * by the cell from the store snapshot's `rewindPreviews`, keyed by
 * `promptUuid` (the N+1-avoiding lazy/cached discipline lives in the sheet).
 *
 * @module components/tugways/cards/rewind-turn-source
 */

import type {
  TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import type { TurnEntry } from "@/lib/code-session-store/types";
import type { AtomSegment } from "@/lib/tug-atom-img";

/**
 * Stable id + kind for the `(current)` row the picker appends below the last
 * targetable turn. It marks the live present — the state after the most recent
 * turn — so the list reads "…earlier turns… → (current)". Unlike a turn row it
 * is NOT a rewind anchor: it is the picker's **default selection**, and while
 * it is selected Rewind is disabled (picking "the present" is a no-op). The
 * sheet maps a selection on this row to a `null` rewind target. A selectable
 * `"cell"`-role row — the arrows reach it; the consumer gates Rewind on it.
 */
export const REWIND_CURRENT_ROW_ID = "rewind-current";
export const REWIND_CURRENT_KIND = "rewind-current";

/**
 * One turn-picker row — a turn the user can *return to*.
 *
 * The row is displayed as its destination (the turn that stays as the new
 * tip) but is anchored on the turn that gets dropped to reach it. Picking
 * "return to T" rewinds by chopping the turn that came AFTER T (and
 * everything past it), so the anchor is that next turn, not T itself.
 *
 * - `promptUuid` — the rewind anchor passed to `session_rewind` /
 *   `rewind_preview`: the FIRST dropped turn (the one after the destination).
 *   Diff-stats and the conversation/code restore key off this.
 * - `turnKey` — the anchor turn's committed React-key seed (a stable, unique
 *   row id).
 * - `landingPreview` / `landingSubmitAt` — the DESTINATION turn's submission
 *   text and wall-clock: what the cell renders as the row title + timestamp
 *   ("the message you navigate back to").
 * - `draftText` / `draftAtoms` — the DROPPED turn's submission, carried so a
 *   rewind can seed the composer with the full original prompt (text +
 *   attachments) for re-edit, not the destination's.
 */
export interface RewindRow {
  promptUuid: string;
  turnKey: string;
  landingPreview: string;
  landingSubmitAt: number;
  draftText: string;
  draftAtoms: ReadonlyArray<AtomSegment>;
}

/**
 * Pure projection of the committed transcript into the picker's *valid* rewind
 * rows, in conversation order (oldest first).
 *
 * A row represents "return to this turn" — keeping it as the new tip and
 * dropping everything that came after. The tugcode chop ([#step-7-2]) drops a
 * given turn and all turns past it, so to LAND on turn T the anchor is the turn
 * AFTER T (the first one dropped). Each row therefore pairs a destination
 * (displayed) with the next turn (the anchor + the prompt offered back for
 * re-edit).
 *
 * The newest targetable turn is the live present — it is the `(current)`
 * marker, never a row (returning to it is a no-op). A turn is a valid
 * destination only when a later targetable turn exists to anchor the chop, so
 * the projection walks consecutive targetable pairs (destination, next) and
 * emits one row per pair. The newest turn closes the list as `(current)`; a 0-
 * or 1-targetable-turn session yields zero rows — exactly the empty-state gate
 * ({@link canOfferRewind}) the plan specifies. (Returning to the present, or to
 * a session with nothing earlier, is not a rewind.)
 */
export function projectRewindTurns(
  transcript: ReadonlyArray<TurnEntry>,
): RewindRow[] {
  const rows: RewindRow[] = [];
  let landing: TurnEntry | null = null;
  transcript.forEach((turn) => {
    if (!isTargetable(turn)) return;
    // The first targetable turn has no earlier turn to anchor on; it opens as
    // the first destination for the turn that follows it.
    if (landing === null) {
      landing = turn;
      return;
    }
    // `turn` is the dropped anchor; `landing` is the destination it returns to.
    const dropped = turn.messages[0];
    const dest = landing.messages[0];
    rows.push({
      promptUuid: turn.promptUuid as string,
      turnKey: turn.turnKey,
      landingPreview: dest.kind === "user_message" ? dest.text : "",
      landingSubmitAt:
        dest.kind === "user_message" ? dest.submitAt : landing.endedAt,
      draftText: dropped.kind === "user_message" ? dropped.text : "",
      draftAtoms: dropped.kind === "user_message" ? dropped.attachments : [],
    });
    landing = turn;
  });
  return rows;
}

/** A turn is rewind-targetable iff it opened with a user submission + anchor. */
function isTargetable(turn: TurnEntry): boolean {
  return (
    typeof turn.promptUuid === "string" &&
    turn.promptUuid.length > 0 &&
    turn.messages.length > 0 &&
    turn.messages[0].kind === "user_message"
  );
}

/**
 * Whether `/rewind` should be offered for this transcript ([#step-7-3]
 * empty-state gating). True iff there is at least one valid rewind row — i.e.
 * ≥2 targetable turns (a 0- or 1-turn session offers nothing to rewind to).
 */
export function canOfferRewind(
  transcript: ReadonlyArray<TurnEntry>,
): boolean {
  return projectRewindTurns(transcript).length > 0;
}

/**
 * Static, single-section data source over the projected rows. The row set is
 * resolved at sheet-open time and fixed for the sheet's lifetime, so
 * `subscribe` is a no-op and `getVersion` a stable constant — exactly the
 * `ModelPickerDataSource` shape. Diff-stats update underneath via the store
 * snapshot the cell reads, not via this data source.
 */
export class RewindTurnDataSource implements TugListViewDataSource {
  private readonly rows: readonly RewindRow[];

  constructor(rows: readonly RewindRow[]) {
    this.rows = rows;
  }

  /** The turns, plus one trailing `(current)` marker row. */
  numberOfItems(): number {
    return this.rows.length + 1;
  }

  /** True for the trailing `(current)` marker (the last index). */
  isCurrentRow(index: number): boolean {
    return index === this.rows.length;
  }

  idForIndex(index: number): string {
    if (this.isCurrentRow(index)) return REWIND_CURRENT_ROW_ID;
    // `promptUuid` is intrinsically unique per turn — a stable row id.
    return this.rows[index].promptUuid;
  }

  kindForIndex(index: number): string {
    return this.isCurrentRow(index) ? REWIND_CURRENT_KIND : "rewind-turn";
  }

  /** Cell-renderer accessor — the turn at `index` (never the `(current)` row). */
  rowAt(index: number): RewindRow {
    return this.rows[index];
  }

  subscribe(): () => void {
    return () => {};
  }

  getVersion(): unknown {
    return 0;
  }
}
