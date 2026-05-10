/**
 * Diff data types — the JS-side mirror of `tugdiff-wasm`'s
 * `serde_wasm_bindgen` output shape.
 *
 * Both `parse_unified_diff` and `two_text_diff` (and the JS first-paint
 * `parseUnifiedDiffText`) return `DiffHunk[]`. Consumers narrow the
 * `DiffLine.kind` discriminant to render contextual / added / removed
 * lines.
 *
 * Stays in sync with `tugdeck/crates/tugdiff-wasm/src/lib.rs` —
 * structural changes there require a matching change here.
 *
 * @module lib/diff/types
 */

/**
 * One hunk of a unified diff.
 *
 *   - `before_start` / `after_start` are 1-based; `0` means "this side has
 *     no removed (or added) lines for the hunk".
 *   - `header` carries any text after the closing `@@` (often empty;
 *     git emits e.g. `fn foo()` to show the enclosing function).
 *   - `lines` are the body of the hunk in display order: a mix of
 *     context, additions, and removals.
 */
export interface DiffHunk {
  before_start: number;
  before_count: number;
  after_start: number;
  after_count: number;
  header: string;
  lines: DiffLine[];
}

/**
 * One line within a hunk. The `kind` discriminates how the line
 * advances the per-side line counters and which marker / styling to
 * render.
 *
 *   - `context` — present in both before and after; both line numbers set.
 *   - `add` — present only in after; `before_lineno` is `null`.
 *   - `remove` — present only in before; `after_lineno` is `null`.
 *
 * `content` is the raw line text with the leading marker (`+`, `-`,
 * space) already stripped.
 */
export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  before_lineno: number | null;
  after_lineno: number | null;
}

export type DiffLineKind = "context" | "add" | "remove";

/**
 * The render input for `<DiffBlock>` — three tagged variants for the
 * three ways a producer can describe a diff. Conversion happens inside
 * the body kind: `unified` parses synchronously in JS (first-paint OK);
 * `two-text` lazy-loads `tugdiff-wasm` and computes hunks once it's
 * ready; `hunks` is the already-prepared shape and renders directly.
 */
export type DiffData =
  | DiffDataUnified
  | DiffDataTwoText
  | DiffDataHunks;

export interface DiffDataUnified {
  source: "unified";
  /** Raw unified-diff text (one or more `@@` hunks; `---` / `+++` headers are tolerated). */
  text: string;
  /** Optional path label for the header. */
  filePath?: string;
}

export interface DiffDataTwoText {
  source: "two-text";
  before: string;
  after: string;
  /** Optional path label for the header. */
  filePath?: string;
}

export interface DiffDataHunks {
  source: "hunks";
  hunks: DiffHunk[];
  /** Optional path label for the header. */
  filePath?: string;
}

/**
 * Total-add / total-remove counts across an array of hunks. Used by
 * `<DiffBlock>` for the `+12 -3` header and by consumers (e.g.
 * `EditToolBlock` chrome) that want to surface the same numbers.
 */
export function countDiffStats(hunks: readonly DiffHunk[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") added++;
      else if (line.kind === "remove") removed++;
    }
  }
  return { added, removed };
}
