/**
 * tug-text-editor/drop-extension.ts — file-drop atom insertion + live drop
 * caret indicator.
 *
 * Wires three concerns into one extension:
 *
 *   1. **Drop caret indicator.** A live thin-vertical-line caret
 *      tracks the resolved drop position in real time as the user
 *      drags a file over the editor. Without this the user has no
 *      idea where their drop will land — a critical UX gap. The
 *      caret position carries the same vertical bias the existing
 *      `TugTextEngine` uses (`DROP_Y_OFFSET_RATIO`): the hit-test
 *      point is shifted ~0.9 line-heights upward so the resolved
 *      position sits above the drag ghost rather than behind it.
 *
 *   2. **`dragover` accept.** `preventDefault()` on `dragover` is
 *      required to indicate the editor accepts drops; without it
 *      the OS refuses the drag and no `drop` event ever fires.
 *      We further set `dataTransfer.dropEffect = "copy"` so the
 *      cursor shows the copy-cursor variant.
 *
 *   3. **`drop` insertion.** `preventDefault()` to suppress the
 *      WebView's default navigate-to-file-URL behavior, then a
 *      single transaction inserts each dropped file as an atom at
 *      the (bias-adjusted) drop offset. File → atom conversion
 *      defers to a host-supplied `DropHandler` thunk; without one
 *      an extension-based default classifies known image formats
 *      as `image` and everything else as `file`.
 *
 * The caret is implemented with CM6's standard StateField +
 * ViewPlugin + `requestMeasure` pattern — same shape as CM6's
 * built-in `dropCursor` extension. We don't compose `dropCursor`
 * directly because its `dragover` observer doesn't apply the Y
 * bias and runs as `eventObservers` (which cannot
 * `preventDefault`); we need the bias and we need to claim the
 * dragover event so the `drop` event ever fires.
 *
 * The whole drop is one CM6 transaction: a single `changes` insert
 * of `N × U+FFFC` followed by `addAtomsEffect.of([…])` carrying
 * every atom's segment + position. CM6 only ever observes the
 * post-drop state — there's no intermediate frame where the
 * placeholder characters render without their widgets.
 *
 * Laws: [L06] appearance via DOM (the drop caret is an
 *        absolutely-positioned `<div>` in `view.scrollDOM`, not
 *        React state; atom widgets render as images), [L07] the
 *        dropHandler thunk reads the latest host-supplied handler
 *        at fire time, [L13] no rAF — the caret position is
 *        committed via `view.requestMeasure` (CM6's measure-phase
 *        scheduler), the drop is one transaction dispatched
 *        directly from the DOM event handler, [L19] file structure
 *        (`tug-text-editor/drop-extension.ts` paired with
 *        `tug-text-editor-drop.test.ts`).
 *
 * Third-party notice: CodeMirror 6 (MIT) — see
 * `THIRD_PARTY_NOTICES.md`. The drop caret pattern (StateField
 * tracking a position + ViewPlugin painting it via
 * `requestMeasure`) is adapted from CM6's `dropCursor`
 * implementation.
 */

import { StateEffect, StateField } from "@codemirror/state";
import type { Extension, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { PluginValue, ViewUpdate } from "@codemirror/view";
import {
  TUG_ATOM_CHAR,
  type AtomSegment,
} from "@/lib/tug-atom-img";
import { addAtomsEffect } from "./atom-decoration";
import type { DropHandler } from "@/lib/tug-text-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Fraction of line-height to shift the drop hit-point upward.
 *
 * Mirror of `DROP_Y_OFFSET_RATIO` in `tug-text-engine.ts`. The drag
 * ghost rendered by the OS sits centered on the cursor; without the
 * bias, `posAtCoords` resolves to the position *under* the ghost,
 * which is hidden from the user. Shifting the hit-test point ~0.9
 * line-heights upward puts the resolved position directly above the
 * ghost where the eye is naturally looking.
 *
 * The negative value subtracts from `clientY`. Keeping the constant
 * shape and name identical to the engine so a future alignment pass
 * (or a regression report citing one) maps to both substrates.
 */
const DROP_Y_OFFSET_RATIO = -0.9;

/** File extensions classified as images for the default file→atom map. */
const IMG_EXTS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
]);

/** CSS class applied to the drop caret indicator element. */
const DROP_CARET_CLASS = "cm-tug-drop-caret";

// ---------------------------------------------------------------------------
// Default file → atom conversion
// ---------------------------------------------------------------------------

/**
 * Convert a `FileList` into atom segments using only the file name.
 *
 * Image extensions land as `type: "image"` so the atom renders with
 * the image-kind treatment from `tug-atom-img`; everything else
 * lands as `type: "file"`. The label and value are both the bare
 * filename — callers that need real paths (or content hashes, or
 * server-side URLs) supply their own `DropHandler` and the default
 * is bypassed entirely.
 */
function defaultFilesToAtoms(files: FileList): AtomSegment[] {
  const out: AtomSegment[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const type = IMG_EXTS.has(ext) ? "image" : "file";
    out.push({ kind: "atom", type, label: f.name, value: f.name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Position resolution
// ---------------------------------------------------------------------------

/**
 * Resolve `(clientX, clientY)` to a document offset, applying the
 * DROP_Y_OFFSET_RATIO bias so the result sits above the drag ghost
 * rather than behind it.
 *
 * Returns `null` when the resolver can't anchor the bias-adjusted
 * point (typical for drops landing above the first line). Exported
 * for test-side coverage of the bias math without having to
 * synthesize a `DragEvent`.
 */
export function dropOffsetAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const lh = view.defaultLineHeight;
  const adjustedY = clientY + lh * DROP_Y_OFFSET_RATIO;
  // `posAtCoords` reads measured layout state; in happy-dom and in
  // some pre-measure mounts on real WebKit it can throw "Reading
  // the editor layout isn't allowed during an update" or a
  // related InvalidStateError. Treat any throw as "couldn't
  // resolve the point" so the caller falls back to end-of-doc
  // rather than the whole drop pipeline failing.
  try {
    return view.posAtCoords({ x: clientX, y: adjustedY });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drop-caret state field + effect
// ---------------------------------------------------------------------------

/**
 * Effect carrying the new drop-caret document position (or `null`
 * to hide the caret). Read by the StateField below; produced by
 * the DOM event handlers.
 */
const setTugDropCaretPos = StateEffect.define<number | null>();

/**
 * StateField holding the live drop-caret document position, or
 * `null` when no drag is in progress. Maps through document
 * changes so a long-running drag over a doc-changing editor
 * (rare, but possible) doesn't lock the caret to a stale offset.
 */
const tugDropCaretField = StateField.define<number | null>({
  create(): number | null {
    return null;
  },
  update(pos: number | null, tr: Transaction): number | null {
    let next = pos === null ? null : tr.changes.mapPos(pos);
    for (const effect of tr.effects) {
      if (effect.is(setTugDropCaretPos)) {
        next = effect.value;
      }
    }
    return next;
  },
});

// ---------------------------------------------------------------------------
// Drop-caret painter (ViewPlugin)
// ---------------------------------------------------------------------------

interface DropCaretMeasure {
  left: number;
  top: number;
  height: number;
}

/**
 * ViewPlugin that owns the drop-caret `<div>` and reconciles its
 * position with the StateField on every update. Uses
 * `view.requestMeasure` for layout reads + writes — same pattern
 * as CM6's built-in `dropCursor`.
 *
 * Plugin lifecycle:
 *   - Construct: lazy — the caret element is created on first
 *     non-null position so editors that never see a drop pay no
 *     DOM cost.
 *   - Update: when the StateField position changes, schedule a
 *     measure read + write.
 *   - Destroy: remove the caret element.
 */
class TugDropCaretPlugin implements PluginValue {
  caret: HTMLDivElement | null = null;
  private readonly measureReq = {
    read: this.readPos.bind(this),
    write: this.writePos.bind(this),
  };

  constructor(private readonly view: EditorView) {}

  update(update: ViewUpdate): void {
    const pos = update.state.field(tugDropCaretField);
    if (pos === null) {
      // No active drag — drop the caret element so a stale stub
      // doesn't survive subsequent layout changes.
      if (this.caret !== null) {
        this.caret.remove();
        this.caret = null;
      }
      return;
    }
    if (this.caret === null) {
      this.caret = this.view.scrollDOM.appendChild(
        document.createElement("div"),
      );
      this.caret.className = DROP_CARET_CLASS;
    }
    // Re-measure when the position changed, the doc changed (CM6
    // re-laid out lines), or geometry changed (window resize, font
    // load, etc.).
    if (
      update.startState.field(tugDropCaretField) !== pos
      || update.docChanged
      || update.geometryChanged
    ) {
      this.view.requestMeasure(this.measureReq);
    }
  }

  /**
   * Measure-phase read: convert the StateField position into
   * scrollDOM-relative coords so the caret sits at the resolved
   * drop point and scrolls with the content.
   *
   * Caret height matches `view.defaultLineHeight` (the line-box
   * height pinned by the `.cm-line::before` ghost in
   * `tug-text-editor/theme.ts`) rather than the glyph rect from
   * `coordsAtPos` — the regular browser caret renders at the
   * full line-box height, and the drop caret should match so
   * the user reads them as the same kind of position indicator.
   * The caret is centered vertically on the glyph rect so a
   * mid-line atom (24px) and adjacent text (~18px) both produce
   * the same drop-caret position.
   *
   * Returns `null` when the position cannot be resolved (typical
   * for drops above the first line); the writer then hides the
   * caret by sliding it off-screen.
   */
  private readPos(): DropCaretMeasure | null {
    const pos = this.view.state.field(tugDropCaretField);
    if (pos === null) return null;
    const rect = this.view.coordsAtPos(pos);
    if (rect === null) return null;
    const outer = this.view.scrollDOM.getBoundingClientRect();
    const lineHeight = this.view.defaultLineHeight;
    const center = (rect.top + rect.bottom) / 2;
    return {
      left: rect.left - outer.left + this.view.scrollDOM.scrollLeft,
      top: center - lineHeight / 2 - outer.top + this.view.scrollDOM.scrollTop,
      height: lineHeight,
    };
  }

  /**
   * Measure-phase write: position the caret element. When the
   * read returned `null`, slide the caret off-screen rather than
   * removing it (the StateField is still non-null, so the
   * destroy path isn't appropriate; off-screen positioning is
   * the same trick CM6's built-in dropCursor uses).
   */
  private writePos(measured: DropCaretMeasure | null): void {
    if (this.caret === null) return;
    if (measured === null) {
      this.caret.style.left = "-100000px";
      return;
    }
    this.caret.style.left = `${measured.left}px`;
    this.caret.style.top = `${measured.top}px`;
    this.caret.style.height = `${measured.height}px`;
  }

  destroy(): void {
    if (this.caret !== null) {
      this.caret.remove();
      this.caret = null;
    }
  }
}

const tugDropCaretPlugin = ViewPlugin.fromClass(TugDropCaretPlugin);

// ---------------------------------------------------------------------------
// Insertion helper
// ---------------------------------------------------------------------------

/**
 * Dispatch a single transaction inserting `atoms` at `pos`.
 *
 * Each atom takes one document character (the U+FFFC sentinel),
 * matched by an `addAtomsEffect` entry whose `position` falls inside
 * the just-inserted run. The selection lands immediately after the
 * last inserted atom — same convention as `insertAtomAt` /
 * `insertAtomAtSelection`. No `scrollIntoView`: the user's eye is
 * already on the drop site, so an automatic scroll would be jarring.
 *
 * Exported so tests can drive the insertion without a `DragEvent`.
 */
export function insertAtomsAt(
  view: EditorView,
  pos: number,
  atoms: readonly AtomSegment[],
): void {
  if (atoms.length === 0) return;
  const insert = TUG_ATOM_CHAR.repeat(atoms.length);
  const positioned = atoms.map((segment, i) => ({
    position: pos + i,
    segment,
  }));
  view.dispatch({
    changes: { from: pos, insert },
    effects: [
      addAtomsEffect.of(positioned),
      // Hide the drop caret in the same transaction as the
      // insertion — atomic from the user's perspective.
      setTugDropCaretPos.of(null),
    ],
    selection: { anchor: pos + atoms.length },
    userEvent: "input.tug-atom-drop",
  });
}

// ---------------------------------------------------------------------------
// Theme — drop-caret styling
// ---------------------------------------------------------------------------

/**
 * Drop-caret styling. Width / position / pointer-events are
 * structural; color is themed via the same token the engine uses,
 * so brio and harmony pick up the right blue without needing a
 * separate per-substrate theme entry.
 */
const tugDropCaretTheme = EditorView.baseTheme({
  [`.${DROP_CARET_CLASS}`]: {
    position: "absolute",
    width: "2px",
    borderRadius: "1px",
    pointerEvents: "none",
    backgroundColor: "var(--tug7-element-highlight-fill-normal-drop-rest)",
  },
});

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

/**
 * Mark/clear the host's `data-drop-active` attribute. The CSS in
 * `tug-text-editor.css` keys the drop ring, caret-hide, and inactive-
 * selection-paint rules off this attribute; setting/clearing it is
 * the only signal those rules need.
 *
 * Idempotent — checking before mutating avoids redundant attribute
 * writes that would re-trigger MutationObservers (none today, but
 * cheap insurance).
 */
function setDropActive(host: HTMLElement | null, active: boolean): void {
  if (host === null) return;
  const has = host.hasAttribute("data-drop-active");
  if (active && !has) {
    host.setAttribute("data-drop-active", "");
  } else if (!active && has) {
    host.removeAttribute("data-drop-active");
  }
}

/**
 * Build the drop-handling extension.
 *
 * `host` is the `tug-text-editor` wrapper `<div>` rendered by `TugTextEditor`.
 * The drop pipeline writes the `data-drop-active` attribute on
 * this element so the CSS rules in `tug-text-editor.css` can paint the
 * drop ring, hide the regular caret, and switch the selection
 * overlay to the inactive variant — all while a drag is in
 * progress, restored to the pre-drag appearance the moment the
 * drag ends (drop / dragleave-out / dragend).
 *
 * `getDropHandler` is a thunk so the React shell can mirror its
 * `dropHandler` prop into a ref and pass a closure that reads the
 * ref at fire time — same [L07] pattern the keymap and completion
 * extensions use. Returns `null` to opt into the default
 * extension-based file→atom conversion.
 *
 * The DOM event handlers attach to `view.contentDOM` via
 * `EditorView.domEventHandlers`. Drag events on the scroller
 * padding (the gap between contentDOM and scrollDOM) bubble up
 * through contentDOM in WebKit, so this is sufficient coverage —
 * users dropping on the visible editor area always reach the
 * handlers.
 *
 * Returns an array of extensions (StateField + ViewPlugin + theme +
 * event handlers) so the consumer doesn't have to know the
 * internal pieces.
 */
export function tugDropExtension(
  host: HTMLElement | null,
  getDropHandler: () => DropHandler | null,
): Extension {
  return [
    tugDropCaretField,
    tugDropCaretPlugin,
    tugDropCaretTheme,
    EditorView.domEventHandlers({
      dragenter(event, _view) {
        // Required to allow drops at all. Without it the WebView
        // refuses the drag and the dragover/drop pipeline never
        // runs. Only claim file drags — keyboard-driven or
        // application-specific drags pass through.
        if (!event.dataTransfer?.types.includes("Files")) return false;
        event.preventDefault();
        setDropActive(host, true);
        return true;
      },
      dragover(event, view) {
        if (!event.dataTransfer?.types.includes("Files")) return false;
        event.preventDefault();
        // Show the OS copy-cursor variant. `dropEffect` is read-
        // only in some test environments (happy-dom); ignore the
        // throw so the test path doesn't have to mock the setter.
        try {
          event.dataTransfer.dropEffect = "copy";
        } catch {
          // intentional: see comment above
        }
        setDropActive(host, true);
        // Update the drop-caret StateField. The ViewPlugin will
        // re-measure on the next update and reposition the caret.
        const pos = dropOffsetAtCoords(view, event.clientX, event.clientY);
        if (view.state.field(tugDropCaretField) !== pos) {
          view.dispatch({ effects: setTugDropCaretPos.of(pos) });
        }
        return true;
      },
      dragleave(event, view) {
        // Only hide when the cursor truly exits the editor — a
        // dragleave fires for every internal element-to-element
        // crossing too. `relatedTarget` names the element being
        // entered; if it's inside contentDOM, the drag is still
        // over the editor.
        const related = event.relatedTarget as Node | null;
        if (related !== null && view.contentDOM.contains(related)) {
          return false;
        }
        setDropActive(host, false);
        if (view.state.field(tugDropCaretField) !== null) {
          view.dispatch({ effects: setTugDropCaretPos.of(null) });
        }
        return false;
      },
      dragend(_event, view) {
        setDropActive(host, false);
        if (view.state.field(tugDropCaretField) !== null) {
          view.dispatch({ effects: setTugDropCaretPos.of(null) });
        }
        return false;
      },
      drop(event, view) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) {
          // No files — clear the caret if a previous dragover
          // left one up, then bail without preventDefault so the
          // browser handles the (non-file) drop natively.
          setDropActive(host, false);
          if (view.state.field(tugDropCaretField) !== null) {
            view.dispatch({ effects: setTugDropCaretPos.of(null) });
          }
          return false;
        }
        // Suppress the WebView's default file-URL navigation. Done
        // first so even an early `return` below leaves the page
        // intact.
        event.preventDefault();
        setDropActive(host, false);

        const handler = getDropHandler();
        const atoms = handler !== null
          ? handler(files)
          : defaultFilesToAtoms(files);
        if (atoms.length === 0) {
          if (view.state.field(tugDropCaretField) !== null) {
            view.dispatch({ effects: setTugDropCaretPos.of(null) });
          }
          return true;
        }

        const pos = dropOffsetAtCoords(view, event.clientX, event.clientY);
        const insertPos = pos !== null ? pos : view.state.doc.length;

        // `insertAtomsAt` includes the caret-clear effect in the
        // same transaction as the insert.
        insertAtomsAt(view, insertPos, atoms);
        return true;
      },
    }),
  ];
}
