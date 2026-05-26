/**
 * tug-text-editor/keymap.ts — high-precedence keyboard handler for the
 * tug-specific input actions: Enter (submit / newline), numpad Enter,
 * Cmd-Enter (forced submit), Cmd-Up / Cmd-Down (history nav), and the
 * gap-fill text-editing bindings Ctrl-U / Ctrl-W / Alt-F / Alt-B.
 *
 * Cmd-A (selectAll), Cmd-Z (undo), and Cmd-Shift-Z (redo) are inherited
 * from `@codemirror/commands` `defaultKeymap` + `historyKeymap`, which
 * the React shell wires alongside this module — no need to redeclare
 * them here.
 *
 * Why `EditorView.domEventHandlers` rather than `keymap.of` for the
 * Enter / Cmd-Up / Cmd-Down family: the keymap facet normalizes both
 * main-row Enter and numpad Enter to the same key string, so a binding
 * written against `key: "Enter"` cannot tell them apart. Tug requires
 * per-source action: numpad Enter submits even when
 * `returnAction === "newline"` if the host wires
 * `numpadEnterAction === "submit"`. We need `KeyboardEvent.code`,
 * which only the raw event exposes, so the handler reads keydown
 * events directly. `Prec.high` ensures we run before the default
 * keymap and the history extension; returning `false` from any branch
 * lets the next handler take over (e.g., a "newline" Enter falls
 * through to `defaultKeymap`'s `insertNewlineAndIndent`).
 *
 * The four gap-fill bindings (Ctrl-U / Ctrl-W / Alt-F / Alt-B) ride on
 * a `keymap.of([...])` block layered alongside the `domEventHandlers`
 * inside the same `Prec.high([...])` wrapper. They dispatch existing
 * `@codemirror/commands` commands directly per [DM04]:
 *   - Ctrl-U → `deleteLineBoundaryBackward`
 *   - Ctrl-W → `deleteGroupBackward`
 *   - Alt-F  → `cursorGroupForward` (Shift variant: `selectGroupForward`)
 *   - Alt-B  → `cursorGroupBackward` (Shift variant: `selectGroupBackward`)
 * The `shift:` slot on each entry expresses the [DM05] shift-extends
 * pattern idiomatically — CM6 routes Shift-Alt-F to `selectGroupForward`
 * while a bare Alt-F runs `cursorGroupForward`. The CM6 commands push
 * onto CM6's own `history()` stack, so Cmd-Z reverts them naturally
 * (no execCommand bridge needed for the editor substrate).
 *
 * Configuration is supplied as a `getConfig` thunk so the React shell
 * can update the values (returnAction / onSubmit / historyProvider)
 * across renders without rebuilding the editor — the closure reads
 * the latest config at fire time per [L07].
 *
 * Laws: [L02] config reaches CM6 through a closure over a ref, never
 *        React state copied into CM6 state, [L07] handlers read
 *        config / view at call time via the supplied closure, [L11]
 *        the substrate is the responder for the submit / history-nav
 *        actions on its owned document, [L19] file structure.
 */

import { EditorSelection, Prec } from "@codemirror/state";
import type { Extension, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { WidgetType } from "@codemirror/view";
import {
  cursorGroupBackward,
  cursorGroupForward,
  deleteGroupBackward,
  deleteLineBoundaryBackward,
  selectGroupBackward,
  selectGroupForward,
} from "@codemirror/commands";
import {
  AtomWidget,
  atomDecorationField,
  replaceAtomsEffect,
} from "./atom-decoration";
import type { PositionedAtom } from "./atom-decoration";
import type {
  HistoryProvider,
  InputAction,
  TugTextEditingState,
} from "@/lib/tug-text-types";
import type { AtomSegment } from "@/lib/tug-atom-img";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Live policy values consulted at every keystroke. The React shell
 * mirrors its props into a ref of this shape and passes a thunk that
 * dereferences the ref, so prop changes take effect on the next event
 * without needing to rebuild any extension.
 */
export interface TugTextEditorKeymapConfig {
  /** Action for the main-row Enter key (modifier-free). */
  returnAction: InputAction;
  /** Action for the numpad Enter key. */
  numpadEnterAction: InputAction;
  /** Submit handler. Invoked when the resolved action is `"submit"`. */
  onSubmit: () => void;
  /**
   * History provider. Cmd-Up / Cmd-Down are no-ops when this is
   * `null`; in that case the modifier-arrow combination falls through
   * to whatever the default keymap chooses (typically: do nothing).
   */
  historyProvider: HistoryProvider | null;
  /**
   * When the editor's resolved Enter action is `"submit"`, the
   * keymap consults this callback to see whether a higher-priority
   * default button is registered (typically by a dialog overlaying
   * the editor). When the callback returns a non-null `HTMLButtonElement`,
   * the editor clicks it instead of calling {@link onSubmit} — the
   * chain's bubble-phase activation path (press visual + click)
   * runs through the click handler the button itself owns. When
   * the callback returns `null` (no dialog default registered),
   * Enter falls through to the editor's own submit. Optional;
   * omit to keep the original "Enter always submits" behavior.
   */
  peekDefaultButton?: () => HTMLButtonElement | null;
}

// ---------------------------------------------------------------------------
// State capture / restore
// ---------------------------------------------------------------------------

/**
 * Snapshot the editor's text + atoms + selection + scroll position
 * (both axes) into the serializable shape the existing
 * `HistoryProvider` and state-preservation APIs both consume. The
 * shape matches `TugTextEditingState` produced by `TugTextEngine` so
 * a session / route history populated from `tug-prompt-input` can
 * drive `tug-text-editor` without translation, and so the same payload
 * survives a tugbank round-trip across reloads ([L23]).
 *
 * Both scroll axes are read directly off `view.scrollDOM` (the
 * `.cm-scroller` element CM6 owns) — the live, single-source-of-
 * truth scroll positions. History nav consumers ignore these fields;
 * state preservation consumers honor them. `scrollLeft` matters
 * specifically for `tug-text-editor` (line-wrap off by default) — long
 * lines scroll horizontally and the user's chosen horizontal
 * position must survive reload.
 */
export function captureEditState(view: EditorView): TugTextEditingState {
  const text = view.state.doc.toString();
  const atoms: TugTextEditingState["atoms"] = [];
  const cursor = view.state.field(atomDecorationField).iter();
  while (cursor.value !== null) {
    const widget = (cursor.value.spec as { widget?: WidgetType }).widget;
    if (widget instanceof AtomWidget) {
      atoms.push({
        position: cursor.from,
        type: widget.segment.type,
        label: widget.segment.label,
        value: widget.segment.value,
      });
    }
    cursor.next();
  }
  const sel = view.state.selection.main;
  // Layout-invariant scroll anchor: doc position of the line at the
  // top of the viewport plus the sub-line pixel offset. Computed from
  // CM6's height map (`lineBlockAtHeight`) rather than the DOM so it
  // tracks the engine's authoritative line layout even when the
  // scroller's CSS height differs from the height map (transient
  // states during ResizeObserver settle). See
  // `TugTextEditingState#scrollAnchor` for the restore contract.
  const scrollTop = view.scrollDOM.scrollTop;
  let scrollAnchor: { topPos: number; topOffsetPx: number } | null = null;
  if (view.contentDOM.isConnected && scrollTop > 0) {
    const block = view.lineBlockAtHeight(scrollTop);
    scrollAnchor = {
      topPos: block.from,
      topOffsetPx: scrollTop - block.top,
    };
  } else if (scrollTop === 0) {
    // Explicit top-of-document anchor — round-trips deterministically
    // even when the document is short enough to not require scroll on
    // restore (CM6 has no anchor to drift away from).
    scrollAnchor = { topPos: 0, topOffsetPx: 0 };
  }
  return {
    text,
    atoms,
    selection: { start: sel.from, end: sel.to },
    scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
    scrollAnchor,
  };
}

/**
 * Build the transaction spec that replaces the document, atom
 * decorations, and selection in one step. Shared between
 * `applyEditState` (history nav — also requests `scrollIntoView`) and
 * `restoreEditState` in `state-preservation.ts` (state-preservation
 * restore — writes scrollTop separately so a saved scroll position
 * is honored verbatim).
 *
 * The replace-atoms effect feeds the atom decoration field's
 * `replaceAtomsEffect` branch, so the new positions point into the
 * freshly-installed document — never into a stale one.
 */
export function buildEditStateTransaction(
  view: EditorView,
  state: TugTextEditingState,
  opts: { scrollIntoView: boolean },
): TransactionSpec {
  const positioned: PositionedAtom[] = state.atoms.map((a) => ({
    position: a.position,
    segment: {
      kind: "atom",
      type: a.type,
      label: a.label,
      value: a.value,
    } satisfies AtomSegment,
  }));
  const docLen = view.state.doc.length;
  const sel = state.selection
    ? EditorSelection.range(state.selection.start, state.selection.end)
    : EditorSelection.cursor(state.text.length);
  const spec: TransactionSpec = {
    changes: { from: 0, to: docLen, insert: state.text },
    effects: replaceAtomsEffect.of(positioned),
    selection: sel,
  };
  if (opts.scrollIntoView) {
    spec.scrollIntoView = true;
  }
  return spec;
}

/**
 * History-navigation restore: replace the document, atom decorations,
 * and selection in a single transaction; scroll the cursor into view.
 *
 * `state.scrollTop` is intentionally ignored on the history-nav
 * path: the user just navigated to a different document and expects
 * the cursor to be visible, not the prior scroll offset
 * reinstated. The state-preservation restore path uses
 * `restoreEditState` in `state-preservation.ts`, which honors
 * `state.scrollTop`.
 *
 * Caret rendering after the doc swap is owned by `caret-layer.ts`,
 * which paints from `state.selection` on every transaction — no
 * cache to flush, no blur/focus thrash needed.
 */
export function applyEditState(
  view: EditorView,
  state: TugTextEditingState,
): void {
  view.dispatch(buildEditStateTransaction(view, state, { scrollIntoView: true }));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective action for an Enter-family keystroke,
 * considering whether Shift flipped the base action.
 *
 * Exported separately so unit tests can drive the policy logic
 * without synthesizing keyboard events or mounting an editor.
 */
export function resolveEnterAction(
  config: TugTextEditorKeymapConfig,
  isNumpad: boolean,
  shiftKey: boolean,
): InputAction {
  const base = isNumpad ? config.numpadEnterAction : config.returnAction;
  if (!shiftKey) return base;
  return base === "submit" ? "newline" : "submit";
}

/**
 * History navigation precondition: caret is collapsed AND positioned
 * at either end of the document. Matches the existing
 * `tug-prompt-input` boundary rule so that mid-document arrow-keys
 * pan the caret normally; only edge taps hand off to the history
 * provider. The rule is symmetric across `back` and `forward` so a
 * single Cmd-Up at the end of an unsubmitted draft pushes it onto
 * the provider's draft slot before serving the most-recent entry.
 */
function atHistoryBoundary(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  return sel.head === 0 || sel.head === view.state.doc.length;
}

/** Handle a Cmd-Up / Cmd-Down keystroke. */
function handleHistoryNav(
  view: EditorView,
  config: TugTextEditorKeymapConfig,
  direction: "back" | "forward",
): boolean {
  if (config.historyProvider === null) return false;
  if (!atHistoryBoundary(view)) return false;
  const next = direction === "back"
    ? config.historyProvider.back(captureEditState(view))
    : config.historyProvider.forward();
  if (next === null) return false;
  applyEditState(view, next);
  return true;
}

/** Handle an Enter or numpad-Enter keystroke. */
function handleEnter(
  view: EditorView,
  config: TugTextEditorKeymapConfig,
  event: KeyboardEvent,
): boolean {
  // IME composition: leave Enter alone — the IME owns commit.
  if (event.isComposing) return false;
  const isNumpad = event.code === "NumpadEnter";
  // Cmd-Enter (no Shift / Alt / Ctrl on macOS): forced submit, regardless
  // of the configured returnAction. Wrappers (e.g., `tug-prompt-entry`)
  // can layer additional Cmd-Enter semantics on top via the action
  // chain; the substrate guarantees a submit fires.
  if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
    event.preventDefault();
    config.onSubmit();
    return true;
  }
  // Disqualify any other modifier combinations — pass through.
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const action = resolveEnterAction(config, isNumpad, event.shiftKey);
  if (action === "submit") {
    event.preventDefault();
    // Defer to a chain-registered default button (e.g., a dialog's
    // primary action) when one is in scope. The click routes
    // through the button's own onClick — and the chain provider's
    // bubble-phase activation already paints the press visual via
    // `data-pressing` — so a Return from inside the editor looks
    // and behaves like a real mouse click on that button. Without
    // a default button registered, the editor's own submit runs.
    const defaultButton = config.peekDefaultButton?.() ?? null;
    if (defaultButton !== null) {
      // Mirror the press-visual the chain provider applies for
      // direct (non-editor) default-button activations, so the
      // two paths look identical.
      defaultButton.setAttribute("data-pressing", "true");
      window.setTimeout(() => {
        defaultButton.removeAttribute("data-pressing");
      }, 120);
      defaultButton.click();
      return true;
    }
    config.onSubmit();
    return true;
  }
  // Newline: fall through to `defaultKeymap`'s `insertNewlineAndIndent`.
  return false;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

/**
 * Build the high-precedence tug keymap extension.
 *
 * Layers two registrations inside one `Prec.high([...])` wrapper:
 *
 *   1. `EditorView.domEventHandlers` for the Enter family + Cmd-Up /
 *      Cmd-Down history nav. Reads `KeyboardEvent.code` directly to
 *      tell main-row Enter and numpad Enter apart (the keymap facet
 *      normalizes them).
 *   2. `keymap.of([...])` for the four gap-fill bindings (Ctrl-U /
 *      Ctrl-W / Alt-F / Alt-B), each dispatching an existing
 *      `@codemirror/commands` command. The `shift:` slot expresses
 *      shift-extends-selection per [DM05] — CM6 idiom for "same
 *      motion with extension."
 *
 * `Prec.high` ensures both registrations precede `defaultKeymap` and
 * `historyKeymap`. Returning `true` from a `domEventHandlers` branch
 * claims the event; returning `false` lets the lower-precedence
 * handlers run (e.g. newline insertion via `insertNewlineAndIndent`).
 * `keymap.of` calls `preventDefault` automatically on a matched
 * binding.
 */
export function tugTextEditorKeymap(
  getConfig: () => TugTextEditorKeymapConfig,
): Extension {
  return Prec.high([
    EditorView.domEventHandlers({
      keydown(event, view) {
        const config = getConfig();
        if (event.key === "Enter") {
          return handleEnter(view, config, event);
        }
        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown")
          && (event.metaKey || event.ctrlKey)
          && !event.altKey
          && !event.shiftKey
        ) {
          return handleHistoryNav(
            view,
            config,
            event.key === "ArrowUp" ? "back" : "forward",
          );
        }
        return false;
      },
    }),
    keymap.of([
      { key: "Ctrl-u", run: deleteLineBoundaryBackward },
      { key: "Ctrl-w", run: deleteGroupBackward },
      { key: "Alt-f", run: cursorGroupForward, shift: selectGroupForward },
      { key: "Alt-b", run: cursorGroupBackward, shift: selectGroupBackward },
    ]),
  ]);
}
