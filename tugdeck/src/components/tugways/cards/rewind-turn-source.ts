/**
 * rewind-turn-source.ts — the `/rewind` turn-picker projection ([#step-7-3]).
 *
 * Projects the committed `code-session-store` transcript into the rows the
 * `RewindSheet`'s picker lists: one row per *rewind-targetable* turn — a turn
 * that opened with a real user submission AND carries the `promptUuid` anchor
 * ([#step-7-1]). Wake turns (no user message) and pre-anchor turns (older
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
 * One turn-picker row. `promptUuid` is the rewind anchor passed to
 * `session_rewind` / `rewind_preview`; `turnKey` is the committed turn's
 * React-key seed (a stable, unique row id). `preview` is the user submission
 * text (the cell truncates for display); `submitAt` is the wall-clock the
 * cell renders as the row timestamp.
 */
export interface RewindRow {
  promptUuid: string;
  turnKey: string;
  preview: string;
  submitAt: number;
}

/**
 * Pure projection of the committed transcript into the picker's *valid* rewind
 * rows, in conversation order (oldest first).
 *
 * A row represents "rewind to here" — dropping that turn and everything after
 * it (matching the tugcode chop, [#step-7-2]). The retained prefix is the
 * turns BEFORE the picked one, so a row is only valid when at least one
 * targetable turn precedes it: rewinding to the *first* turn would empty the
 * session, which claude can't `--resume` and which tugcode/the store refuse
 * (`no_retained_turns`, [#step-7-2]). Clearing the whole conversation is a
 * new-session operation, not a rewind — so the first targetable turn is
 * excluded here rather than shown as a row that errors on confirm.
 *
 * Consequence: a 0- or 1-targetable-turn session projects to zero rows, which
 * is exactly the empty-state gate ({@link canOfferRewind}) the plan specifies.
 */
export function projectRewindTurns(
  transcript: ReadonlyArray<TurnEntry>,
): RewindRow[] {
  const rows: RewindRow[] = [];
  let seenTargetable = 0;
  transcript.forEach((turn) => {
    if (!isTargetable(turn)) return;
    seenTargetable += 1;
    // Skip the first targetable turn — rewinding to it leaves no retained
    // conversation (see the doc comment).
    if (seenTargetable === 1) return;
    const opener = turn.messages[0];
    rows.push({
      promptUuid: turn.promptUuid as string,
      turnKey: turn.turnKey,
      preview: opener.kind === "user_message" ? opener.text : "",
      submitAt: opener.kind === "user_message" ? opener.submitAt : turn.endedAt,
    });
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
