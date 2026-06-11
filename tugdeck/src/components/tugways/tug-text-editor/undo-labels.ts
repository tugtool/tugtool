/**
 * undo-labels.ts — menu-title nouns for the editor's undo/redo steps.
 *
 * CM6's history tracks *depths* (`undoDepth`/`redoDepth`) but not what
 * kind of edit each history event was, so the editor keeps a parallel
 * pair of label stacks — one noun per history event — synced to the
 * depths after every document change. The top of `done` names the next
 * Undo ("Typing", "Paste", …); the top of `undone` names the next Redo.
 * The native menu composes "Undo Typing" / "Redo Paste" from these.
 *
 * The sync is deliberately depth-driven rather than a re-implementation
 * of CM6's event-grouping rules: after classifying the step (edit /
 * undo / redo) the stacks are hard-resynced to the reported depths —
 * trimmed from the oldest end when history was culled, padded with ""
 * (plain "Undo") when an event arrived through a path we didn't label.
 * Whatever grouping CM6 applied, the stacks converge on the truth.
 *
 * Pure module — no CM6 imports — so the mapping and the sync are
 * unit-testable without an editor.
 *
 * @module components/tugways/tug-text-editor/undo-labels
 */

/** Label stacks mirroring CM6's done/undone history events. */
export interface UndoLabelStacks {
  /** Oldest-first; top (last) names the next Undo. */
  readonly done: readonly string[];
  /** Oldest-first; top (last) names the next Redo. */
  readonly undone: readonly string[];
}

export const EMPTY_UNDO_LABEL_STACKS: UndoLabelStacks = {
  done: [],
  undone: [],
};

/**
 * Map a CM6 transaction `userEvent` to a menu-title noun, following the
 * macOS Edit-menu conventions ("Undo Typing", "Undo Cut", "Undo Paste",
 * "Undo Delete", "Undo Drag"). Unknown events map to "" → plain "Undo".
 */
export function undoLabelForUserEvent(userEvent: string | null): string {
  if (userEvent === null) return "";
  if (userEvent === "delete.cut") return "Cut";
  if (userEvent === "input.paste") return "Paste";
  if (
    userEvent === "input.drop" ||
    userEvent === "input.tug-atom-drop" ||
    userEvent.startsWith("move.")
  ) {
    return "Drag";
  }
  if (userEvent.startsWith("delete")) return "Delete";
  if (userEvent.startsWith("input")) return "Typing";
  return "";
}

/** One document change, classified for the label sync. */
export interface HistoryStep {
  /** `undo`/`redo` when the transaction was a history command. */
  kind: "edit" | "undo" | "redo";
  /** Noun for an `edit` step (ignored for undo/redo). */
  label: string;
  /** `undoDepth(state)` after the change. */
  undoDepthAfter: number;
  /** `redoDepth(state)` after the change. */
  redoDepthAfter: number;
}

/** Resync one stack to the reported depth: trim oldest, pad oldest. */
function resync(stack: string[], depth: number): string[] {
  while (stack.length > depth) stack.shift();
  while (stack.length < depth) stack.unshift("");
  return stack;
}

/**
 * Advance the label stacks across one document change.
 *
 * - `undo` moves the top of `done` onto `undone`.
 * - `redo` moves the top of `undone` back onto `done`.
 * - `edit` pushes its label when the undo depth grew (a new history
 *   event); a merged edit (depth unchanged — CM6 grouped it into the
 *   open event) keeps the event's first label, matching macOS, where a
 *   continued typing run stays "Undo Typing".
 *
 * Both stacks are then hard-resynced to the reported depths.
 */
export function applyHistoryStep(
  stacks: UndoLabelStacks,
  step: HistoryStep,
): UndoLabelStacks {
  const done = [...stacks.done];
  const undone = [...stacks.undone];

  if (step.kind === "undo") {
    const moved = done.pop();
    if (moved !== undefined) undone.push(moved);
  } else if (step.kind === "redo") {
    const moved = undone.pop();
    if (moved !== undefined) done.push(moved);
  } else if (step.undoDepthAfter > done.length) {
    done.push(step.label);
  }

  return {
    done: resync(done, step.undoDepthAfter),
    undone: resync(undone, step.redoDepthAfter),
  };
}
