/**
 * tug-text-editor/caret-layer.ts — custom CodeMirror 6 layer that paints a
 * single caret stroke at the head of a collapsed, focused selection,
 * plus a `ViewPlugin` that tracks interaction state (mouse drag,
 * typing) and toggles attributes on the editor root so theme.ts can
 * suppress the caret during drags and freeze the blink during typing.
 *
 * Replaces WebKit's contentEditable caret. The native caret renderer
 * caches paint geometry on focus and on scroll; layout-shifting
 * transitions that don't touch focus or scroll (history-nav doc swap,
 * typeahead-popup deactivate, atom removal via backspace / cut /
 * undo) leave the cache stale, and the new caret renders alongside
 * the cached one — the user sees doubled-caret strokes. Three patches
 * once flushed the cache by triggering `view.contentDOM.blur() →
 * offsetWidth read → view.focus()` after each known stale-able
 * transition. This layer makes those patches unnecessary by giving
 * CM6 ownership of caret rendering.
 *
 * Geometry: glyph center + `view.defaultLineHeight`.
 *
 *   - **Y position**: vertically centered on `coordsAtPos(head)`'s
 *     glyph rect. `coordsAtPos` returns the *glyph* bounds, which
 *     wobble between text-only and atom-bearing positions (text
 *     glyphs ~18px tall, atom widgets 24px), so we don't use the
 *     glyph height directly. We use the glyph rect only to find
 *     the visual-row's vertical *center* (the midpoint of `top` and
 *     `bottom`) and pad outward symmetrically by half of
 *     `view.defaultLineHeight`.
 *   - **Height**: `view.defaultLineHeight` (the computed pixel value
 *     of `.cm-content`'s `line-height`). This is one *visual row*
 *     tall regardless of line-wrap state, content composition, or
 *     where the caret lands.
 *
 * Why not the containing `.cm-line` element's `getBoundingClientRect()`:
 * with `EditorView.lineWrapping` engaged, one `.cm-line` element
 * wraps multiple visual rows; the element's rect is the *whole
 * wrapped block* (N × line-height tall), not the row the caret
 * actually sits on. A line-rect-derived caret height would render
 * the caret as a multi-row vertical bar — comically large. The
 * glyph-center approach scales correctly because `coordsAtPos`
 * always reports the position at the head's specific visual row,
 * even mid-wrap.
 *
 * The earlier line-rect approach was correct only because line wrap
 * was off; once we exposed `lineWrap` as a public prop, the same
 * caret-layer had to handle both layouts. `defaultLineHeight` is
 * the smallest invariant that works.
 *
 * Interaction-state plugin:
 *
 *   - `mousedown` on contentDOM → set `data-tug-text-editor-dragging` on
 *     `view.dom`. A document-level `mouseup` listener (registered
 *     once-per-mousedown via `{ once: true }`) clears the attribute.
 *     The theme suppresses the caret while the attribute is present
 *     so a click-and-drag selection doesn't paint a stale caret in
 *     the middle of the live drag — matching WebKit's native
 *     behavior.
 *   - `keydown` on contentDOM → set `data-tug-text-editor-typing` on
 *     `view.dom` and start a 500ms idle timer. Any further keydown
 *     resets the timer; when it fires the attribute clears. The
 *     theme freezes the blink animation while the attribute is
 *     present so the caret reads as steady during active typing —
 *     matching standard text-editor behavior since the 1980s.
 *
 * Both attributes are toggled directly on the DOM without
 * dispatching transactions; they are appearance-only state per [L06]
 * and [L22].
 *
 * Laws: [L02] caret position is owned by CM6's `EditorState.selection`,
 *        not React state, [L06] caret painted via DOM layer + DOM
 *        attribute toggles (real DOM nodes — appearance-only), [L19]
 *        file structure (next to `selection-layer.ts`, the sister
 *        rendering layer), [L22] direct DOM-update observers (CM6
 *        layer's `markers()` and the interaction plugin's event
 *        handlers run without React round-trips).
 */

import { EditorView, layer, RectangleMarker, ViewPlugin } from "@codemirror/view";
import type { LayerMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/** Caret stroke width in pixels. Matches WebKit's native caret stroke. */
const CARET_STROKE_WIDTH = 2;

/**
 * Upward nudge for the caret top, expressed as a fraction of the
 * line-box height. Geometric centering (caret top = line top, height
 * = full line box) renders a stroke spanning from the line's
 * typographic top to its descender bottom — visually bottom-heavy
 * because most text glyphs sit above the descender region. Shifting
 * the caret up by ~8% of the line-box (≈2px at 24.5px line-height)
 * aligns the stroke better with the optical center of the running
 * text without changing its height. Line-height-dependent so larger
 * font sizes (proportionally taller line boxes) shift
 * proportionally.
 */
const CARET_TOP_NUDGE_FACTOR = 0.08;

/** Idle delay before the typing-steady attribute clears and blink resumes. */
const TYPING_IDLE_MS = 500;

/**
 * Document-relative origin used to translate viewport coordinates
 * returned by `getBoundingClientRect` / `coordsAtPos` into the
 * layer's positioning context. Layer markers are absolutely
 * positioned with their parent at the scroller's content top-left,
 * so left/top must be relative to that.
 *
 * Mirrors the private `getBase(view)` helper in `@codemirror/view`'s
 * `RectangleMarker.forRange` implementation.
 */
function documentBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft,
    top: rect.top - view.scrollDOM.scrollTop,
  };
}

/**
 * Caret-overlay layer. Paints a single `tug-text-editor-caret` div at the
 * head of the main selection when the editor is focused and the
 * selection is collapsed.
 */
export const tugCaretLayer: Extension = layer({
  above: true,
  class: "tug-text-editor-caret-layer",
  update(update) {
    return (
      update.docChanged
      || update.selectionSet
      || update.viewportChanged
      || update.geometryChanged
      || update.focusChanged
    );
  },
  markers(view: EditorView): readonly LayerMarker[] {
    if (!view.hasFocus) return [];
    const sel = view.state.selection.main;
    if (!sel.empty) return [];
    const coords = view.coordsAtPos(sel.head, 1);
    if (coords === null) return [];
    const base = documentBase(view);
    // One *visual* row tall, regardless of line-wrap state. See the
    // module docstring for the rationale — `getBoundingClientRect()`
    // on `.cm-line` would return the *wrapped block* height (N rows
    // tall) when wrapping is engaged.
    const lineHeight = view.defaultLineHeight;
    // Center the caret on the glyph's vertical center: the glyph's
    // top / bottom are the only stable reference for the visual row
    // the head currently sits on. Padding outward by half
    // `lineHeight` gives a row-aligned caret that doesn't wobble
    // when the head crosses an atom widget (whose glyph rect is
    // 24px tall vs. ~18px for plain text).
    const glyphCenter = (coords.top + coords.bottom) / 2;
    const top = glyphCenter - lineHeight / 2;
    const nudgeUp = lineHeight * CARET_TOP_NUDGE_FACTOR;
    return [
      new RectangleMarker(
        "tug-text-editor-caret",
        coords.left - base.left,
        top - base.top - nudgeUp,
        CARET_STROKE_WIDTH,
        lineHeight,
      ),
    ];
  },
});

/**
 * Interaction-state plugin. Tracks mouse-drag and active-typing
 * windows and reflects them as attributes on `view.dom` so the theme
 * can adjust caret visibility / blink behavior. No transactions
 * dispatched — appearance-only ([L06], [L22]).
 */
export const tugCaretInteractionPlugin: Extension = ViewPlugin.fromClass(
  class {
    private typingIdleTimer: number | null = null;

    constructor(private readonly view: EditorView) {
      view.contentDOM.addEventListener("mousedown", this.onMouseDown);
      view.contentDOM.addEventListener("keydown", this.onKeyDown);
    }

    destroy(): void {
      this.view.contentDOM.removeEventListener("mousedown", this.onMouseDown);
      this.view.contentDOM.removeEventListener("keydown", this.onKeyDown);
      document.removeEventListener("mouseup", this.onMouseUpGlobal);
      if (this.typingIdleTimer !== null) {
        window.clearTimeout(this.typingIdleTimer);
        this.typingIdleTimer = null;
      }
      this.view.dom.removeAttribute("data-tug-text-editor-dragging");
      this.view.dom.removeAttribute("data-tug-text-editor-typing");
    }

    private onMouseDown = (): void => {
      this.view.dom.setAttribute("data-tug-text-editor-dragging", "");
      // Document-level mouseup so we still clear when the user
      // releases outside the editor (drag past the edge, etc.).
      // `once: true` so it auto-removes after firing.
      document.addEventListener("mouseup", this.onMouseUpGlobal, { once: true });
    };

    private onMouseUpGlobal = (): void => {
      this.view.dom.removeAttribute("data-tug-text-editor-dragging");
    };

    private onKeyDown = (event: KeyboardEvent): void => {
      // Pure modifier-only keystrokes (Shift / Cmd / Ctrl / Alt held
      // alone) shouldn't pin the caret as "typing" — the user might
      // be preparing to navigate or hold Shift to select. Filter on
      // key name; everything else (printable input, Backspace,
      // Delete, Enter, Tab, arrows) counts as active interaction.
      const key = event.key;
      const isModifierOnly =
        key === "Shift" || key === "Meta" || key === "Control" || key === "Alt";
      if (isModifierOnly) return;
      this.view.dom.setAttribute("data-tug-text-editor-typing", "");
      if (this.typingIdleTimer !== null) {
        window.clearTimeout(this.typingIdleTimer);
      }
      this.typingIdleTimer = window.setTimeout(() => {
        this.view.dom.removeAttribute("data-tug-text-editor-typing");
        this.typingIdleTimer = null;
      }, TYPING_IDLE_MS);
    };
  },
);
