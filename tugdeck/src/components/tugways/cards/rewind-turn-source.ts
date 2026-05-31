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
  /**
   * True for the most recent turn in the transcript — the picker marks it
   * `(current)` (rewinding to it drops only that turn). Purely a display hint.
   */
  isCurrent: boolean;
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
  let lastTargetableIndex = -1;
  transcript.forEach((turn, i) => {
    if (isTargetable(turn)) lastTargetableIndex = i;
  });
  transcript.forEach((turn, i) => {
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
      isCurrent: i === lastTargetableIndex,
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

  numberOfItems(): number {
    return this.rows.length;
  }

  idForIndex(index: number): string {
    // `promptUuid` is intrinsically unique per turn — a stable row id.
    return this.rows[index].promptUuid;
  }

  kindForIndex(): string {
    return "rewind-turn";
  }

  /** Cell-renderer accessor — the row at `index`. */
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
