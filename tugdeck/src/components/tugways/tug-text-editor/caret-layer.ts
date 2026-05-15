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
 * Geometry: glyph center + rendered row height × `CARET_HEIGHT_FACTOR`.
 *
 *   - **Y position**: vertically centered on `coordsAtPos(head)`'s
 *     glyph rect. `coordsAtPos` returns the *glyph* bounds, which
 *     wobble between text-only and atom-bearing positions (text
 *     glyphs ~18px tall, atom widgets ~21px), so we don't use the
 *     glyph height directly. We use the glyph rect only to find
 *     the visual-row's vertical *center* (the midpoint of `top` and
 *     `bottom`) and pad outward symmetrically by half of the
 *     caret height.
 *   - **Height**: `rowHeight × CARET_HEIGHT_FACTOR`. The caret is
 *     visibly slimmer than the row — text-editing convention since
 *     the caret needs to read as a thin vertical mark, not a
 *     full-row bar.
 *   - **Row height source**: read via `getComputedStyle` on the
 *     `.cm-line::before` ghost (whose height is the floor
 *     `max(1lh, atom-height)` set by `theme.ts`). Direct read of
 *     the rendered floor — works for every font / size /
 *     line-height / atom configuration without re-implementing
 *     the floor math in JS. See the inline comment in `markers()`
 *     for the alternatives considered and why this source won.
 *
 * Why not the containing `.cm-line` element's `getBoundingClientRect()`
 * directly: with `EditorView.lineWrapping` engaged, one `.cm-line`
 * element wraps multiple visual rows; the element's rect is the
 * *whole wrapped block* (N × row-height tall), not the row the
 * caret actually sits on. The `::before` pseudo is a single
 * inline-block whose computed height is *one* row regardless of
 * wrap state, so reading it via `getComputedStyle(line, '::before')`
 * gives us the per-row height we want. The glyph-center approach
 * for the Y position scales correctly because `coordsAtPos` always
 * reports the position at the head's specific visual row, even
 * mid-wrap.
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

import { getResponderChainManager } from "@/action-dispatch";
import { deckTrace } from "@/deck-trace";

/** Caret stroke width in pixels. Matches WebKit's native caret stroke. */
const CARET_STROKE_WIDTH = 2;

/**
 * Caret height as a fraction of the rendered row height. A caret
 * spanning the full row reads as a vertical bar rather than a
 * text-editing caret — every code editor (VS Code, Sublime, IDEA,
 * Vim) paints the caret slimmer than the row. 0.9 (90%) is the
 * starting target; hand-tuned in the gallery against the rest of
 * the substrate's chrome.
 */
const CARET_HEIGHT_FACTOR = 0.9;

/**
 * Idle delay before the typing-steady attribute clears and blink resumes.
 */
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
 * Walk up from the DOM node at `pos` to find the enclosing `.cm-line`
 * element. CM6's `domAtPos` returns the leaf node nearest the offset;
 * we walk parents to the line element. Returns `null` if no line
 * ancestor is found before reaching the contentDOM root.
 */
function lineElementAtPos(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.domAtPos(pos);
  let node: Node | null = dom.node;
  while (node !== null && node !== view.contentDOM) {
    if (node instanceof HTMLElement && node.classList.contains("cm-line")) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

/**
 * Production row-height source: parse the `::before` ghost's
 * computed height (in pixels). The ghost's CSS is
 * `height: max(1lh, var(--tug-text-editor-atom-height))` (set by
 * `theme.ts`), so this read returns the actual rendered floor
 * regardless of how `1lh` and the atom-height variable resolve at
 * the current font / line-height props.
 *
 * Returns `view.defaultLineHeight` as a fallback when the line
 * element can't be located or the parsed value isn't finite. The
 * fallback is correct only when no atom forces the row taller than
 * `defaultLineHeight`; in production this only fires before CM6
 * has rendered any line element, which for a focused-editor caret
 * paint shouldn't happen.
 */
function readRowHeightFromGhost(view: EditorView, head: number): number {
  const line = lineElementAtPos(view, head);
  if (line === null) return view.defaultLineHeight;
  const ghost = window.getComputedStyle(line, "::before");
  const parsed = parseFloat(ghost.height);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : view.defaultLineHeight;
}

// ---------------------------------------------------------------------------
// Dev-only focus / first-responder invariant probe
// ---------------------------------------------------------------------------

/**
 * Last-reported invariant signature per view. The caret layer's
 * `markers()` runs on every relevant update (every keystroke produces
 * a `docChanged`), so the probe dedupes: it records only when the
 * signature *transitions* — into a divergence, or back to in-sync —
 * never once-per-repaint. Keyed weakly so a destroyed view's entry is
 * collected with it.
 */
const lastInvariantSignature = new WeakMap<EditorView, string>();
/** Signature sentinel for "first responder matches the focused editor". */
const INVARIANT_OK = "ok";

/**
 * Dev-only invariant probe: when this runs, the editor genuinely has
 * DOM focus (the caller gated on `view.hasFocus`), so the responder
 * chain's first responder MUST be this editor's responder. A
 * divergence is the "UI lie" — a blinking caret says "you are focused
 * here" while chain-routed keyboard actions route elsewhere.
 *
 * The editor's responder id is read off the nearest
 * `[data-responder-id]` ancestor (written by the substrate's
 * `responderRef` onto the editor host). No chain (`getResponderChainManager`
 * is `null`) or no responder ancestor → standalone / gallery / test
 * use, nothing to assert. Records a `caret-responder-divergence`
 * deck-trace event + a `console.error` once per divergence transition.
 */
function checkCaretResponderInvariant(view: EditorView): void {
  const manager = getResponderChainManager();
  if (manager === null) return;
  const host = view.dom.closest("[data-responder-id]");
  const editorResponderId = host?.getAttribute("data-responder-id") ?? null;
  if (editorResponderId === null) return;

  const firstResponderId = manager.getFirstResponder();
  const inSync = firstResponderId === editorResponderId;
  const signature = inSync
    ? INVARIANT_OK
    : `${editorResponderId}!=${firstResponderId ?? "null"}`;
  if (lastInvariantSignature.get(view) === signature) return;
  lastInvariantSignature.set(view, signature);
  if (inSync) return;

  deckTrace.record({
    kind: "caret-responder-divergence",
    editorResponderId,
    firstResponderId,
  });
  console.error(
    `[caret-layer] focus/first-responder divergence: editor ` +
      `'${editorResponderId}' has DOM focus (caret painting) but the ` +
      `responder chain's first responder is ` +
      `'${firstResponderId ?? "null"}'. Chain-routed keyboard actions ` +
      `will not reach this editor — the caret is a UI lie. See the ` +
      `deck-trace ring for the surrounding event sequence.`,
  );
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
    // Dev-only: a painted caret asserts the editor is the first
    // responder. Probe fires once per divergence transition.
    if (process.env.NODE_ENV !== "production") {
      checkCaretResponderInvariant(view);
    }
    const sel = view.state.selection.main;
    if (!sel.empty) return [];
    const coords = view.coordsAtPos(sel.head, 1);
    if (coords === null) return [];
    const base = documentBase(view);
    // Row-height source: the rendered `::before` ghost. The theme
    // pins `.cm-line::before { height: max(1lh, var(...)) }` so
    // reading it via `getComputedStyle` returns the actual rendered
    // floor, regardless of font ascent metrics or how `1lh` and the
    // atom-height variable resolve at the current props.
    //
    // Two alternatives were instrumented during Step 14.5 (per [Q11]):
    //
    //   - `view.lineBlockAt(head).height / rowCount` — CM6's measured
    //     block height divided by visual-row count. Routed through
    //     CM6's heightOracle.
    //   - `Math.max(view.defaultLineHeight, getAtomHeightPx())` — JS
    //     baseline that re-implements the floor in code.
    //
    // The empirical hand-tune in the gallery confirmed the
    // `getComputedStyle('::before')` source produces visually-correct
    // carets across every font / size / line-height / atom
    // configuration we exercise. The alternatives weren't observed
    // to disagree in any tested scenario, but they each have a
    // failure mode the ghost read avoids: `lineBlockAt` returns
    // stale-cache values when CM6 hasn't measured a fresh row yet,
    // and the JS baseline re-derives a value that already lives in
    // the theme — duplication invites drift. The ghost is direct
    // and cheap (one synchronous style read per caret paint, the
    // same pattern the `selection-layer` uses).
    const rowHeight = readRowHeightFromGhost(view, sel.head);
    const caretHeight = rowHeight * CARET_HEIGHT_FACTOR;
    // Center the caret on the glyph's vertical center: the glyph's
    // top / bottom are the only stable reference for the visual row
    // the head currently sits on. Pad outward by half `caretHeight`
    // so the caret is centered on the row's optical center and
    // shrinks symmetrically as `CARET_HEIGHT_FACTOR` decreases.
    const glyphCenter = (coords.top + coords.bottom) / 2;
    const top = glyphCenter - caretHeight / 2;
    return [
      new RectangleMarker(
        "tug-text-editor-caret",
        coords.left - base.left,
        top - base.top,
        CARET_STROKE_WIDTH,
        caretHeight,
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
