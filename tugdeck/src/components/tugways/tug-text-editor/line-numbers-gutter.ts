/**
 * tug-text-editor/line-numbers-gutter.ts — line-number gutter that
 * preserves baseline alignment between the gutter's smaller-text
 * line numbers and the content text, robustly across font
 * families and prop sizes.
 *
 * The problem this solves
 * ───────────────────────
 *
 * The substrate's design intent for the gutter is "Numbers read
 * as ancillary chrome, not as content peers" — line numbers are
 * visibly smaller than the content text. Achieving that with the
 * obvious approach — `font-size: 0.85em` on the cell — creates a
 * baseline-alignment problem:
 *
 *   - For inline content with font-size `F` and line-height `L`,
 *     the typographic baseline lands at `L/2 + 0.3F` from the top
 *     of the line-box (half-leading geometry plus a typical font
 *     ascent ratio of ~0.8).
 *   - With matching line-heights but different font-sizes
 *     (content `F`, gutter `0.85F`), the gutter baseline sits
 *     `0.045 × F` *above* the content baseline.
 *   - The constant `0.3` depends on each font's specific ascent
 *     ratio — it's only ~0.3 for system fonts; monospace and
 *     display fonts vary. A static padding-top compensation
 *     drifts visibly when the user changes `fontFamily`, and a
 *     calc()-based compensation only works for one font's metrics.
 *
 * The fix uses CSS line-box rules instead of arithmetic:
 *
 *   - The gutter cell `<div class="cm-gutterElement">` keeps
 *     the **content's** font-size (set by the theme on
 *     `.cm-gutters`), so its strut establishes the *content's*
 *     baseline within the cell's line-box.
 *   - The line-number text is wrapped in a `<span class=
 *     "tug-text-editor-line-number-text">` rendered at smaller
 *     font (`font-size: 0.85em` in the theme).
 *   - The span has CSS default `vertical-align: baseline`, so
 *     its baseline aligns to the cell strut's baseline — which
 *     is the content's baseline. Visibly smaller line-number
 *     text, baseline-aligned with content, no magic numbers,
 *     robust across all fonts (CSS does the math correctly per
 *     each font's metrics automatically).
 *
 * Why this needs a custom marker
 * ──────────────────────────────
 *
 * CM6's stock `lineNumbers()` extension uses a `NumberMarker`
 * whose `toDOM()` returns a plain text node, appended directly
 * to `.cm-gutterElement`. There's no element to hang a smaller
 * font-size on without affecting the cell's strut. Wrapping
 * the number in a `<span>` requires a custom marker class.
 *
 * Composition
 * ───────────
 *
 * `tugLineNumbersGutter` returns the gutters infrastructure +
 * the line-number gutter itself — but NOT the active-line gutter
 * highlight that CM6's stock `lineNumbers()` bundles in. The
 * active-line highlight is exposed as a separate
 * `highlightActiveLineGutter` prop on `TugTextEditor` so consumers
 * can opt in or out independently.
 *
 * Laws: [L06] appearance via CSS / DOM (the marker's `<span>`
 *        wrapper is appearance state, not React state),
 *        [L19] file structure (one concern per file —
 *        substrate-internal gutter detail).
 */

import {
  EditorView,
  GutterMarker,
  gutter,
  gutters,
} from "@codemirror/view";
import type { BlockInfo } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * Per-line gutter marker rendering the line number inside a
 * `<span>` so the theme can apply a smaller `font-size` to just
 * the number while leaving the cell's strut at the content
 * font-size. The span carries `tug-text-editor-line-number-text`
 * for the theme rule.
 */
class TugLineNumberMarker extends GutterMarker {
  constructor(public readonly num: number) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof TugLineNumberMarker && other.num === this.num;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "tug-text-editor-line-number-text";
    span.textContent = String(this.num);
    return span;
  }
}

/**
 * Spacer marker used by CM6's gutter infrastructure to size
 * the gutter column. We make the spacer the highest line
 * number we expect to render for the column-width estimate
 * (CM6 uses the spacer's rendered width as the column floor).
 *
 * Returns an oversized number so the column doesn't reflow
 * narrower→wider while the user types past line 9 / 99 / 999.
 * The min-width: 5ch CSS rule handles the same concern from a
 * different angle (CSS-side floor); the spacer ensures CM6's
 * own width measurement also reserves enough space.
 */
class TugLineNumberSpacer extends GutterMarker {
  override eq(other: GutterMarker): boolean {
    return other instanceof TugLineNumberSpacer;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "tug-text-editor-line-number-text";
    span.textContent = "99999";
    return span;
  }
}

/**
 * Custom line-number gutter for `tug-text-editor`. Includes the
 * gutters infrastructure plus the line-number gutter itself.
 * Uses `TugLineNumberMarker` so the rendered line-number text is
 * wrapped in a `<span>` for theme-driven visual sizing.
 *
 * Does NOT include CM6's `highlightActiveLineGutter()` — the
 * active-line highlight is opt-in via the substrate's
 * `highlightActiveLineGutter` prop, plumbed through a separate
 * compartment in `tug-text-editor.tsx`.
 */
export const tugLineNumbersGutter: Extension = [
  gutters(),
  gutter({
    class: "cm-lineNumbers",
    renderEmptyElements: false,
    lineMarker: (
      view: EditorView,
      line: BlockInfo,
      others: readonly GutterMarker[],
    ): GutterMarker | null => {
      if (others.some((m) => m.toDOM !== undefined)) return null;
      return new TugLineNumberMarker(view.state.doc.lineAt(line.from).number);
    },
    initialSpacer: () => new TugLineNumberSpacer(),
  }),
];
