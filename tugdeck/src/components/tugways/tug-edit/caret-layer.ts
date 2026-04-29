/**
 * tug-edit/caret-layer.ts — custom CodeMirror 6 layer that paints a
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
 * Why DOM-rect geometry instead of `coordsAtPos` + `lineBlockAt`:
 * `BlockInfo.top` returned by `lineBlockAt(pos)` is measured relative
 * to the *document model* — i.e., the inside of `.cm-content`'s
 * padding box. Layer markers are positioned relative to the
 * *scroller's content area* (`.cm-scroller`), which is `.cm-content`'s
 * outer edge — `padding-top` (8px in `theme.ts`) HIGHER. Using
 * `lineBlock.top` directly would put the caret 8px above the visible
 * line. Using `coordsAtPos(head).top - base.top` gives the *glyph*
 * top, which is what `RectangleMarker.forRange` does for selections
 * — but the glyph height (~14-18px) wobbles between text-only and
 * atom-bearing positions, which is why we built our own caret rather
 * than relying on `drawSelection`.
 *
 * The DOM approach reads the containing `.cm-line` element's
 * `getBoundingClientRect()` for both Y and height. That rect reflects
 * the *rendered* line box (including the `.cm-line::before` ghost
 * that pins height to 1.75em), which is exactly the visible target
 * we want the caret to track. One DOM read per `markers()` call —
 * cheap, deterministic, no padding-coord-system ambiguity.
 *
 * Interaction-state plugin:
 *
 *   - `mousedown` on contentDOM → set `data-tug-edit-dragging` on
 *     `view.dom`. A document-level `mouseup` listener (registered
 *     once-per-mousedown via `{ once: true }`) clears the attribute.
 *     The theme suppresses the caret while the attribute is present
 *     so a click-and-drag selection doesn't paint a stale caret in
 *     the middle of the live drag — matching WebKit's native
 *     behavior.
 *   - `keydown` on contentDOM → set `data-tug-edit-typing` on
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
 * Find the `.cm-line` element that contains the given document
 * position. Walks up from `view.domAtPos(pos).node` to the nearest
 * `.cm-line` ancestor (or returns the node itself when pos lands
 * directly on the line element).
 */
function findLineElement(view: EditorView, pos: number): HTMLElement | null {
  const { node } = view.domAtPos(pos);
  let walker: Node | null = node;
  while (walker !== null) {
    if (walker instanceof HTMLElement && walker.classList.contains("cm-line")) {
      return walker;
    }
    walker = walker.parentNode;
  }
  return null;
}

/**
 * Caret-overlay layer. Paints a single `tug-edit-caret` div at the
 * head of the main selection when the editor is focused and the
 * selection is collapsed.
 */
export const tugCaretLayer: Extension = layer({
  above: true,
  class: "tug-edit-caret-layer",
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
    const lineEl = findLineElement(view, sel.head);
    if (lineEl === null) return [];
    const lineRect = lineEl.getBoundingClientRect();
    const base = documentBase(view);
    const nudgeUp = lineRect.height * CARET_TOP_NUDGE_FACTOR;
    return [
      new RectangleMarker(
        "tug-edit-caret",
        coords.left - base.left,
        lineRect.top - base.top - nudgeUp,
        CARET_STROKE_WIDTH,
        lineRect.height,
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
      this.view.dom.removeAttribute("data-tug-edit-dragging");
      this.view.dom.removeAttribute("data-tug-edit-typing");
    }

    private onMouseDown = (): void => {
      this.view.dom.setAttribute("data-tug-edit-dragging", "");
      // Document-level mouseup so we still clear when the user
      // releases outside the editor (drag past the edge, etc.).
      // `once: true` so it auto-removes after firing.
      document.addEventListener("mouseup", this.onMouseUpGlobal, { once: true });
    };

    private onMouseUpGlobal = (): void => {
      this.view.dom.removeAttribute("data-tug-edit-dragging");
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
      this.view.dom.setAttribute("data-tug-edit-typing", "");
      if (this.typingIdleTimer !== null) {
        window.clearTimeout(this.typingIdleTimer);
      }
      this.typingIdleTimer = window.setTimeout(() => {
        this.view.dom.removeAttribute("data-tug-edit-typing");
        this.typingIdleTimer = null;
      }, TYPING_IDLE_MS);
    };
  },
);
