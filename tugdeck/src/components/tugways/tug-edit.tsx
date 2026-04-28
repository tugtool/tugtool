/**
 * TugEdit — CodeMirror 6-backed text editing substrate.
 *
 * The lower-level editing primitive that backs higher-level tug
 * components. Built on an `EditorView` from CodeMirror 6: the
 * React shell owns mount and dispose, observes via
 * `EditorView.updateListener`, and exposes an imperative delegate
 * via `ref`.
 *
 * Owns the document, caret, selection, and embedded atoms — the state
 * that editing actions (cut, copy, paste, selectAll, undo, redo,
 * insertAtom, submit) mutate. Per [L11], `TugEdit` is the responder
 * that registers handlers for those actions on its owned state. The
 * responder registration is what binds Cmd-A / Cmd-C / Cmd-X / Cmd-V
 * / Cmd-Z / Cmd-Shift-Z to the editor: those keystrokes are routed
 * through the document-level capture-phase pipeline in
 * `responder-chain-provider.tsx`, which calls `preventDefault` for
 * every match (`preventDefaultOnMatch`) so the browser's native
 * handling is suppressed and the responder chain owns the semantics.
 * Without responder registration the suppressed default leaves the
 * keystrokes inert — CM6's own keymap never sees them because
 * `event.defaultPrevented` is already true by the time the event
 * reaches `contentDOM`.
 *
 * Laws: [L01] one root.render() at mount; CM6 manages its own DOM
 *        tree internally and is never re-rendered through React,
 *        [L02] atom segments, decoration set, and keymap policy
 *        live in CM6 (StateField + closure-captured ref), never in
 *        React state, [L03] mount, dispose, and the keymap-config
 *        mirror run in `useLayoutEffect`, [L06] all editor appearance
 *        flows through CSS and direct DOM, never React state, [L07]
 *        delegate methods and keymap handlers read `viewRef.current`
 *        and `keymapConfigRef.current` at call time, [L11] responder
 *        for editing actions (including atom insert / clipboard /
 *        submit / history-nav) on the owned document, selection,
 *        and atom set, [L15] token-driven control states, [L19]
 *        component authoring guide, [L21] CodeMirror 6 (MIT) — see
 *        `THIRD_PARTY_NOTICES.md`, [L22] theme-change subscription
 *        writes through a CM6 transaction, never round-tripping
 *        through React, [L24] `viewRef`/`hostRef`/`keymapConfigRef`
 *        local-data, CM6 owns document, selection, and
 *        atom-decoration state, appearance via CSS / DOM.
 *
 * StrictMode lifecycle: the `EditorView` is constructed inside a
 * `useLayoutEffect` with empty deps, stored on `viewRef`, and
 * disposed in the cleanup. React 19 StrictMode runs mount →
 * cleanup → mount in dev; each pass constructs a fresh view, the
 * prior cleanup destroys the prior view, and `viewRef.current`
 * is `null` between passes so callers see `view() === null`
 * rather than a destroyed view. Pattern matches the standard CM6
 * + React integration used by `@uiw/react-codemirror` and similar
 * wrappers.
 */

import "./tug-edit.css";

import React, {
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  selectAll,
  undo,
} from "@codemirror/commands";
import { cn } from "@/lib/utils";
import { subscribeThemeChange, unsubscribeThemeChange } from "@/theme-tokens";
import type { AtomSegment } from "@/lib/tug-atom-img";
import type { HistoryProvider, InputAction } from "@/lib/tug-text-engine";
import {
  hasNativeClipboardBridge,
  readClipboardViaNative,
} from "@/lib/tug-native-clipboard";
import { tugTheme } from "./tug-edit/theme";
import { hostFocusMirror } from "./tug-edit/host-state";
import {
  atomDecorationField,
  insertAtomAtSelection,
  regenerateAtomsEffect,
} from "./tug-edit/atom-decoration";
import { atomicRangesExt } from "./tug-edit/atomic-ranges";
import { clipboardExt } from "./tug-edit/clipboard-filters";
import { tugSelectionLayer } from "./tug-edit/selection-layer";
import { tugEditKeymap } from "./tug-edit/keymap";
import type { TugEditKeymapConfig } from "./tug-edit/keymap";
import { useOptionalResponder } from "./use-responder";
import type { ActionHandler, ActionHandlerResult } from "./responder-chain";
import { TUG_ACTIONS, type TugAction } from "./action-vocabulary";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default focus indication when `focusStyle` is not supplied. */
const DEFAULT_FOCUS_STYLE = "background" as const;

/** Default Enter-key action. Matches `tug-prompt-input`'s historical default. */
const DEFAULT_RETURN_ACTION: InputAction = "submit";

/** Default numpad-Enter action. Matches `tug-prompt-input`'s default. */
const DEFAULT_NUMPAD_ENTER_ACTION: InputAction = "submit";

/** No-op submit handler used when the host omits `onSubmit`. */
const noopSubmit = (): void => {};

// ---------------------------------------------------------------------------
// TugEditDelegate
// ---------------------------------------------------------------------------

/**
 * Imperative handle exposed via `ref`.
 *
 * Exposes the underlying `EditorView`. Consumers that need to
 * dispatch transactions, query state, or reach into extension
 * data hold this handle and call `view()` at use time.
 *
 * `view()` returns `null` between unmount and re-mount — for
 * example during React 19 StrictMode's dev double-mount, or after
 * the component has been disposed. See the lifecycle note in the
 * module docstring.
 */
export interface TugEditDelegate {
  /**
   * Return the live `EditorView`, or `null` if no view is
   * currently mounted.
   */
  view(): EditorView | null;
  /**
   * Insert an atom at the current selection head, replacing any
   * non-empty selection. The transaction inserts the U+FFFC text
   * marker and the matching decoration in a single step, so the
   * editor never observes a partially-applied atom. After the
   * insertion the caret lands immediately after the new atom.
   *
   * No-op when the editor is not mounted.
   */
  insertAtom(segment: AtomSegment): void;
  /**
   * Clear the editor: empty document, no selection range, no atoms.
   * Used by submit flows that want a fresh draft after the current
   * one has been committed. No-op when the editor is not mounted.
   */
  clear(): void;
  /**
   * Move keyboard focus to the editor and place a caret. No-op when
   * the editor is not mounted. The caret lands at the current
   * selection's anchor; if the document is empty, the caret is at
   * offset 0.
   */
  focus(): void;
}

// ---------------------------------------------------------------------------
// TugEditProps
// ---------------------------------------------------------------------------

/**
 * Focus indication variants for the host wrapper.
 *
 *   `"background"` — focused state shifts the editor surface to a
 *                    subtle focus tint and the host border to the
 *                    field's active border color.
 *   `"ring"`        — focused state draws an accent-colored ring
 *                    around the host wrapper.
 */
export type TugEditFocusStyle = "background" | "ring";

/**
 * Props for `TugEdit`. The component renders a host `<div>`
 * around the live `EditorView`; standard `<div>` props
 * (`className`, `style`, `data-*`, etc.) flow through to the
 * host.
 */
export interface TugEditProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> {
  /**
   * Optional className applied to the host wrapper. Composed with
   * the component's own `tug-edit` base class.
   */
  className?: string;
  /**
   * Focus indication style for the host wrapper.
   * @default "background"
   * @selector .tug-edit[data-focus-style]
   */
  focusStyle?: TugEditFocusStyle;
  /**
   * Suppress the host wrapper's border. For embedding in compound
   * components where the parent owns the border treatment.
   * @default false
   * @selector .tug-edit[data-borderless]
   */
  borderless?: boolean;
  /**
   * Action triggered by the main-row Enter key.
   *   `"submit"`  — fire `onSubmit`. Shift-Enter then inserts a newline.
   *   `"newline"` — insert a newline. Shift-Enter then fires `onSubmit`.
   * @default "submit"
   */
  returnAction?: InputAction;
  /**
   * Action triggered by the numpad Enter key. Distinct from
   * `returnAction` because some workflows (numeric data entry)
   * benefit from a different policy on the numpad.
   * @default "submit"
   */
  numpadEnterAction?: InputAction;
  /**
   * Submit handler. Invoked when the resolved Enter / numpad-Enter
   * action is `"submit"`, or on Cmd-Enter regardless of the
   * configured action.
   */
  onSubmit?: () => void;
  /**
   * History provider for Cmd-Up / Cmd-Down navigation. The substrate
   * captures the current editing state on each `back()` call so the
   * provider can stash it as the in-progress draft and restore it
   * when the user reaches the forward end of the stack.
   */
  historyProvider?: HistoryProvider;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Build the CM6 extension set used at mount. The host element is
 * captured so the focus-mirror extension can reach it directly. The
 * `getKeymapConfig` thunk is captured by the high-precedence tug
 * keymap; the React shell mutates the underlying ref on prop change
 * so the latest `returnAction` / `onSubmit` / `historyProvider` are
 * read at every keystroke without rebuilding any extension [L07].
 *
 * Kept as a free function so the extension list is easy to grow
 * without disturbing the lifecycle code.
 */
function buildExtensions(
  host: HTMLElement,
  getKeymapConfig: () => TugEditKeymapConfig,
): readonly Extension[] {
  return [
    history(),
    // tug-specific keymap runs before defaultKeymap / historyKeymap
    // (Prec.high inside `tugEditKeymap`) so Enter / numpad Enter /
    // Cmd-Enter / Cmd-Up / Cmd-Down get tug semantics. Falling
    // through (returning false) lets the default bindings handle
    // newline insertion, undo/redo, selectAll, and the rest.
    tugEditKeymap(getKeymapConfig),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    // Selection painted by `tugSelectionLayer` — a custom layer that
    // emits `.cm-selectionBackground` divs covering every non-empty
    // range in the editor's selection. We deliberately do NOT use
    // `drawSelection`: drawSelection bundles a styled `.cm-cursor`
    // (which sizes itself from `coordsAtPos`'s glyph rect and
    // wobbles between text and atom positions) and a `Prec.highest`
    // theme that forces `caret-color: transparent !important` and
    // `::selection: transparent !important` (which we cannot
    // override from outside). Building our own selection layer lets
    // us keep CM6's atom-aware selection paint while leaving the
    // native caret intact — the native caret is sized by the
    // line-box, which the `.cm-line::before` ghost in `tugTheme`
    // pins to a uniform line-height.
    tugSelectionLayer,
    tugTheme,
    hostFocusMirror(host),
    // Atom support: the decoration field is the data layer; the
    // atomic-ranges provider lifts that data into CM6's motion /
    // deletion machinery; clipboard filters round-trip the atoms
    // through copy / cut / paste.
    atomDecorationField,
    atomicRangesExt,
    clipboardExt,
  ];
}

export const TugEdit = React.forwardRef<TugEditDelegate, TugEditProps>(
  function TugEdit(
    {
      className,
      focusStyle = DEFAULT_FOCUS_STYLE,
      borderless = false,
      returnAction = DEFAULT_RETURN_ACTION,
      numpadEnterAction = DEFAULT_NUMPAD_ENTER_ACTION,
      onSubmit,
      historyProvider,
      ...rest
    }: TugEditProps,
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    // Live keymap config. The extension's keydown handler reads
    // `keymapConfigRef.current` via the thunk passed to
    // `tugEditKeymap`, so prop changes take effect on the next
    // keystroke without rebuilding any extension. Initialised with
    // a no-op submit; the layout-effect below installs the real
    // values before any user input can land [L03, L07].
    const keymapConfigRef = useRef<TugEditKeymapConfig>({
      returnAction,
      numpadEnterAction,
      onSubmit: noopSubmit,
      historyProvider: null,
    });

    // Mirror the live policy props into the keymap config ref. Runs
    // synchronously in `useLayoutEffect` so the ref is up-to-date
    // before any subsequent keystroke can fire [L03].
    useLayoutEffect(() => {
      keymapConfigRef.current = {
        returnAction,
        numpadEnterAction,
        onSubmit: onSubmit ?? noopSubmit,
        historyProvider: historyProvider ?? null,
      };
    }, [returnAction, numpadEnterAction, onSubmit, historyProvider]);

    // Expose the imperative delegate. The closure reads `viewRef.current`
    // at call time so consumers see the live view across StrictMode's
    // mount/unmount/mount cycle [L07].
    useImperativeHandle(ref, () => ({
      view() {
        return viewRef.current;
      },
      insertAtom(segment: AtomSegment) {
        const view = viewRef.current;
        if (view === null) return;
        insertAtomAtSelection(view, segment);
      },
      clear() {
        const view = viewRef.current;
        if (view === null) return;
        clearEditor(view);
      },
      focus() {
        const view = viewRef.current;
        if (view === null) return;
        view.focus();
      },
    }), []);

    // ---------------------------------------------------------------
    // Responder-chain action handlers
    // ---------------------------------------------------------------
    //
    // The app installs a document-level capture-phase keydown listener
    // (`responder-chain-provider.tsx`) that maps Cmd-A / Cmd-C / Cmd-X
    // / Cmd-V / Cmd-Z / Cmd-Shift-Z to action names and dispatches them
    // through the responder chain. Every matched binding calls
    // `event.preventDefault()` BEFORE dispatching, so the editor MUST
    // register handlers — otherwise the suppressed default leaves the
    // keystrokes inert (CM6's own keymap never runs because
    // `event.defaultPrevented` is already true at runHandlers time).
    //
    // All handlers are read live by `useOptionalResponder` through an
    // options ref proxy, so the closures here can capture `viewRef`
    // safely; the handlers run with the latest view at dispatch time
    // [L07]. Each handler returns either `void` (sync-only) or a
    // `() => void` continuation. The keyboard-shortcut path runs
    // continuations immediately; the context-menu path defers them
    // past the activation blink. Mirrors `tug-prompt-input`'s pattern
    // exactly so the two substrates produce identical UX from the
    // chain's perspective.

    const handleSelectAll = useCallback((): ActionHandlerResult => {
      return () => {
        const view = viewRef.current;
        if (view === null) return;
        view.focus();
        selectAll(view);
      };
    }, []);

    const handleUndo = useCallback((): ActionHandlerResult => {
      return () => {
        const view = viewRef.current;
        if (view === null) return;
        view.focus();
        undo(view);
      };
    }, []);

    const handleRedo = useCallback((): ActionHandlerResult => {
      return () => {
        const view = viewRef.current;
        if (view === null) return;
        view.focus();
        redo(view);
      };
    }, []);

    // Copy: focus + execCommand("copy") fires a copy event on the
    // contentDOM. `clipboardExt` (registered in `buildExtensions`)
    // intercepts it, writes the plain-text + atom-sidecar payload, and
    // calls preventDefault. Sync-only — nothing to defer past the
    // menu blink.
    const handleCopy = useCallback((): ActionHandlerResult => {
      const view = viewRef.current;
      if (view === null) return;
      view.focus();
      document.execCommand("copy");
    }, []);

    // Cut: sync `execCommand("copy")` so the selection stays painted
    // during a context-menu activation blink (matches
    // `tug-prompt-input`'s split). Continuation deletes the selection
    // through a CM6 transaction so undo / redo see one atomic edit.
    const handleCut = useCallback((): ActionHandlerResult => {
      const view = viewRef.current;
      if (view === null) return;
      view.focus();
      document.execCommand("copy");
      return () => {
        const live = viewRef.current;
        if (live === null) return;
        const { from, to } = live.state.selection.main;
        if (from === to) return;
        live.dispatch({
          changes: { from, to, insert: "" },
          selection: { anchor: from },
          userEvent: "delete.cut",
        });
      };
    }, []);

    // Paste: prefer the native bridge (Tug.app WKWebView) — Safari's
    // permission popup fires for both `navigator.clipboard.*` and
    // `document.execCommand("paste")`, so the only popup-free read
    // path is to delegate to Swift. Outside Tug.app, fall back to
    // execCommand("paste") which fires a paste event on contentDOM
    // that our `clipboardExt` decodes (atom sidecar or plain text).
    // Native bridge returns plain text only — atom sidecars never
    // cross the bridge, which matches the tug-prompt-input policy.
    const handlePaste = useCallback((): ActionHandlerResult => {
      const view = viewRef.current;
      if (view === null) return;
      view.focus();
      if (hasNativeClipboardBridge()) {
        const readPromise = readClipboardViaNative();
        return () => {
          void readPromise.then(({ text }) => {
            const live = viewRef.current;
            if (live === null || text === "") return;
            const { from, to } = live.state.selection.main;
            live.dispatch({
              changes: { from, to, insert: text },
              selection: { anchor: from + text.length },
              userEvent: "input.paste",
            });
          });
        };
      }
      document.execCommand("paste");
    }, []);

    // Submit: substrate-level handler so a "Submit" button somewhere
    // up the chain (e.g. in a wrapper compound) reaches the same
    // policy as the keymap's Enter handler. Reads `onSubmit` through
    // the keymap-config ref so the latest closure runs at dispatch
    // time [L07].
    const handleSubmit = useCallback((): ActionHandlerResult => {
      return () => {
        keymapConfigRef.current.onSubmit();
      };
    }, []);

    const responderId = useId();
    const actions: Partial<Record<TugAction, ActionHandler>> = {
      [TUG_ACTIONS.SELECT_ALL]: handleSelectAll,
      [TUG_ACTIONS.UNDO]: handleUndo,
      [TUG_ACTIONS.REDO]: handleRedo,
      [TUG_ACTIONS.COPY]: handleCopy,
      [TUG_ACTIONS.CUT]: handleCut,
      [TUG_ACTIONS.PASTE]: handlePaste,
      [TUG_ACTIONS.SUBMIT]: handleSubmit,
    };
    const { responderRef, ResponderScope } = useOptionalResponder({
      id: responderId,
      actions,
    });

    // Compose the host ref so a single ref callback writes the local
    // `hostRef`, the `responderRef` (which writes `data-responder-id`
    // for first-responder promotion on click), and the standard
    // `useRef` slot. Mirrors the `composedRef` pattern in
    // `useTextInputResponder`.
    const composedHostRef = useCallback(
      (el: HTMLDivElement | null) => {
        hostRef.current = el;
        responderRef(el);
      },
      [responderRef],
    );

    // Mount the EditorView. Cleanup destroys it; re-mount creates
    // a fresh one. See module docstring for the StrictMode rationale [L03].
    useLayoutEffect(() => {
      const host = hostRef.current;
      if (host === null) return;

      const state = EditorState.create({
        doc: "",
        extensions: buildExtensions(host, () => keymapConfigRef.current),
      });
      const view = new EditorView({
        state,
        parent: host,
      });
      viewRef.current = view;

      // Atom SVGs bake their colors at construction time (`tug-atom-img.ts`
      // resolves token values via `getTokenValue` at the moment the
      // `<img>` is built). When the application theme changes, those
      // colors are stale, so we dispatch a `regenerateAtomsEffect` to
      // force every widget to be reconstructed [D05]. Subscription is
      // direct DOM observation per [L22] — no React state round-trip.
      const onThemeChange = (): void => {
        view.dispatch({ effects: regenerateAtomsEffect.of(null) });
      };
      subscribeThemeChange(onThemeChange);

      return () => {
        unsubscribeThemeChange(onThemeChange);
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    return (
      <ResponderScope>
        <div
          ref={composedHostRef}
          data-slot="tug-edit"
          data-focus-style={focusStyle}
          data-borderless={borderless ? "" : undefined}
          className={cn("tug-edit", className)}
          {...rest}
        />
      </ResponderScope>
    );
  },
);

/**
 * Replace the entire document with the empty string and collapse the
 * caret to offset 0. Atom decorations track document changes (the
 * range mapping in the StateField drops widgets whose covering
 * character is deleted), so the U+FFFC characters and their
 * decorations vanish in the same transaction.
 */
function clearEditor(view: EditorView): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: "" },
    selection: EditorSelection.cursor(0),
    userEvent: "delete.tug-clear",
  });
}
