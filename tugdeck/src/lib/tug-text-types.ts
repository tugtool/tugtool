/**
 * tug-text-types — shared type surface for the tug-text-editor substrate.
 *
 * Lives in `@/lib/` rather than under the substrate directory because
 * non-substrate consumers (gallery cards, completion providers, the
 * tide-card) reference these types without taking a hard dependency
 * on CodeMirror or any view code.
 *
 * Only types live here — no runtime helpers and no React. Everything
 * is JSON-serializable where it needs to be (notably {@link
 * TugTextEditingState}, used by the [L23] state-preservation pipeline).
 */

import type { AtomSegment } from "./tug-atom-img";

export type { AtomSegment };

// ---------------------------------------------------------------------------
// InputAction
// ---------------------------------------------------------------------------

/**
 * Resolved action for the main-row Enter (and numpad Enter) key.
 *
 *   `"submit"`  — fire the editor's `onSubmit` callback. Shift-Enter
 *                 inserts a newline.
 *   `"newline"` — insert a newline. Shift-Enter fires `onSubmit`.
 */
export type InputAction = "submit" | "newline";

// ---------------------------------------------------------------------------
// CompletionItem / CompletionProvider
// ---------------------------------------------------------------------------

/** Item returned by a completion provider. */
export interface CompletionItem {
  label: string;
  atom: AtomSegment;
  /** Byte-offset ranges [start, end) of matched characters for highlighting. */
  matches?: [number, number][];
}

/**
 * Completion provider: given a query string, return matching items.
 *
 * Async providers (e.g., file completion) attach a `subscribe` method so the
 * substrate can observe result changes via [L22] (direct store
 * observation, no React round-trip). Synchronous providers (command
 * completion) omit it.
 */
export type CompletionProvider = ((query: string) => CompletionItem[]) & {
  subscribe?: (listener: () => void) => () => void;
};

// ---------------------------------------------------------------------------
// DropHandler
// ---------------------------------------------------------------------------

/** Drop handler: given a `FileList` from a drag-and-drop, return atoms to insert. */
export type DropHandler = (files: FileList) => AtomSegment[];

// ---------------------------------------------------------------------------
// HistoryProvider
// ---------------------------------------------------------------------------

/**
 * History provider: navigates through previously submitted entries.
 * The provider manages the stack, cursor, and draft state internally.
 */
export interface HistoryProvider {
  /** Navigate backward. Receives the current editor state (saved as draft on first call). */
  back(current: TugTextEditingState): TugTextEditingState | null;
  /** Navigate forward. Returns the next entry, or the draft when reaching the end. */
  forward(): TugTextEditingState | null;
}

// ---------------------------------------------------------------------------
// TugTextEditingState
// ---------------------------------------------------------------------------

/**
 * Serializable snapshot of editing state.
 *
 * Used for persistence via tugbank (survives reload, app quit) [L23].
 * Plain object — no DOM, no methods. JSON round-trips cleanly.
 */
export interface TugTextEditingState {
  /** Plain text with TUG_ATOM_CHAR at atom positions. */
  text: string;
  /** Atom identity and position. Position is the index of TUG_ATOM_CHAR in text. */
  atoms: { position: number; type: string; label: string; value: string }[];
  /** Cursor/selection as flat offsets. Null if editor was not focused. */
  selection: { start: number; end: number } | null;
  /**
   * Editor's contenteditable `scrollTop` at capture time. Null or omitted
   * means "no asserted scroll position" — restore leaves the editor's
   * scroll at whatever bake-in default the new mount lands on. A number
   * means "set `root.scrollTop` to this value after the text + atoms +
   * selection have been applied" ([L23]).
   *
   * Optional in the type so existing literal constructions (empty seeds,
   * legacy fixtures, on-disk payloads written before this field existed)
   * compile and decode without churn — `undefined` and `null` are
   * semantically identical at the restore site.
   */
  scrollTop?: number | null;
  /**
   * Editor's contenteditable `scrollLeft` at capture time. Same
   * semantics as {@link scrollTop} but for the horizontal axis: a
   * number means "restore `root.scrollLeft` to this value after the
   * doc + selection are applied", `null`/`undefined` means "no
   * asserted horizontal scroll position".
   *
   * Editors that wrap lines never accumulate non-zero horizontal
   * scroll, so this stays at 0 in practice for them. Editors with
   * line-wrap off (e.g. the `tug-text-editor` substrate's default) need
   * this axis to round-trip whenever the user has scrolled
   * horizontally. Optional for the same forward-compat reason as
   * {@link scrollTop}.
   */
  scrollLeft?: number | null;
}
