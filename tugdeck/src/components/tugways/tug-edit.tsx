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
 *        [L02] atom segments, decoration set, keymap policy, and
 *        typeahead state live in CM6 (StateField + closure-captured
 *        refs), never in React state, [L03] mount, dispose, the
 *        keymap-config mirror, the completion-providers mirror,
 *        and the typeahead state subscription run in
 *        `useLayoutEffect`, [L04] popup position is read from CM6
 *        via `coordsAtPos`, never via React-state-driven layout,
 *        [L06] all editor appearance — including the typeahead
 *        popup body — flows through CSS and direct DOM, never
 *        React state, [L07] delegate methods, keymap handlers, the
 *        completion provider thunk, and the typeahead-change
 *        observer ref read their state at call time, [L11]
 *        responder for editing actions (including atom insert /
 *        clipboard / submit / history-nav) on the owned document,
 *        selection, atom set, and typeahead session — popup items
 *        dispatch directly into the substrate's accept helper
 *        because the popup is a substrate-internal UI surface,
 *        [L15] token-driven control states, [L19] component
 *        authoring guide, [L20] popup uses
 *        `tug-completion-menu`'s own tokens — no token-slot
 *        violations, [L21] CodeMirror 6 (MIT) — see
 *        `THIRD_PARTY_NOTICES.md`, [L22] theme-change subscription,
 *        typeahead state observer, and async completion-provider
 *        results all stream through CM6 transactions and direct
 *        DOM updates — never through React state, [L24] `viewRef`,
 *        `hostRef`, `popupRef`, `keymapConfigRef`,
 *        `completionProvidersRef` are local-data refs; CM6 owns
 *        document, selection, atom-decoration, and typeahead
 *        state; appearance via CSS / DOM.
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
// The substrate uses tug-completion-menu's CSS classes for the
// typeahead popup so the surface matches `tug-prompt-input`.
import "./tug-completion-menu.css";

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
import {
  acceptCompletionAt,
  getCompletionState,
  navigateCompletion,
  subscribeCompletionState,
  tugCompletionExt,
} from "./tug-edit/completion-extension";
import { useOptionalResponder } from "./use-responder";
import type { ActionHandler, ActionHandlerResult } from "./responder-chain";
import { TUG_ACTIONS, type TugAction } from "./action-vocabulary";
import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-engine";

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
  /**
   * Map of trigger character → `CompletionProvider`. When the user
   * types a key in the map (e.g. `@` or `/`), the substrate opens a
   * typeahead popup of items returned by the provider, lets the user
   * navigate with arrow keys, and on Enter or Tab inserts the chosen
   * item as a tug atom.
   *
   * Providers may be sync (a plain function) or async (with a
   * `.subscribe` method that the substrate uses to refresh results
   * as they stream in — `[L22]`).
   */
  completionProviders?: Record<string, CompletionProvider>;
  /**
   * Preferred direction for the completion popup relative to the
   * trigger character. `"down"` (default) places the popup below the
   * trigger when there's room; `"up"` places it above. The substrate
   * auto-flips when the preferred direction would clip against the
   * editor's scroll-clipping ancestor.
   * @default "down"
   */
  completionDirection?: "up" | "down";
  /**
   * Optional observer of typeahead state changes. Fires after every
   * activate / update / navigate / cancel — useful for hosts that
   * want to coordinate other UI (e.g. dim a sibling control while
   * typeahead is active). The substrate already drives the popup
   * itself; consumers do not need to render anything in response.
   */
  onTypeaheadChange?: (
    active: boolean,
    filtered: readonly CompletionItem[],
    selectedIndex: number,
  ) => void;
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
  getCompletionProviders: () => Record<string, CompletionProvider>,
): readonly Extension[] {
  return [
    history(),
    // Typeahead first so its `Prec.highest` keymap sees Enter / Tab /
    // Arrows / Escape before the Step 4 keymap when a session is
    // active. When inactive, every branch returns `false` and the
    // keystroke falls through to `tugEditKeymap` and beyond.
    tugCompletionExt(getCompletionProviders),
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
      completionProviders,
      completionDirection = "down",
      onTypeaheadChange,
      ...rest
    }: TugEditProps,
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    // Live providers ref. The typeahead extension reads this via a
    // thunk on every transaction, so swapping providers across
    // renders takes effect without rebuilding the editor [L07].
    const completionProvidersRef = useRef<Record<string, CompletionProvider>>(
      completionProviders ?? {},
    );
    useLayoutEffect(() => {
      completionProvidersRef.current = completionProviders ?? {};
    }, [completionProviders]);

    // Live observer ref for the optional `onTypeaheadChange` callback
    // — same [L07] pattern: the field-listener captured below reads
    // the current callback so a re-render with a new callback
    // identity doesn't require re-subscribing.
    const onTypeaheadChangeRef = useRef(onTypeaheadChange);
    useLayoutEffect(() => {
      onTypeaheadChangeRef.current = onTypeaheadChange;
    }, [onTypeaheadChange]);

    // Live preferred-direction ref read by the popup positioner.
    const completionDirectionRef = useRef(completionDirection);
    useLayoutEffect(() => {
      completionDirectionRef.current = completionDirection;
    }, [completionDirection]);

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
        extensions: buildExtensions(
          host,
          () => keymapConfigRef.current,
          () => completionProvidersRef.current,
        ),
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

      // Wire the typeahead state to the popup DOM. The completion
      // extension's per-view subscription fires on every state change
      // — we paint the popup body imperatively per [L06] (mirrors
      // `tug-prompt-input`'s approach) and forward to the optional
      // `onTypeaheadChange` callback. The painter uses `coordsAtPos`
      // to anchor the popup to the trigger character, auto-flipping
      // up vs. down based on space inside the nearest scroll-clipping
      // ancestor.
      const completionUnsub = subscribeCompletionState(view, () => {
        paintCompletionPopup(
          view,
          popupRef.current,
          hostRef.current,
          completionDirectionRef.current,
        );
        const snap = getCompletionState(view);
        onTypeaheadChangeRef.current?.(
          snap.active,
          snap.filtered,
          snap.selectedIndex,
        );
      });
      // Initial paint: the editor mounts inactive, but a future
      // step (e.g., state restoration) might mount with typeahead
      // already open — paint once so the popup matches.
      paintCompletionPopup(
        view,
        popupRef.current,
        hostRef.current,
        completionDirectionRef.current,
      );

      return () => {
        completionUnsub();
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
        >
          {/* Typeahead popup. Empty until a trigger fires; the
              typeahead-state subscriber installed in the mount
              effect paints the contents and the position via
              direct DOM writes (mirrors `tug-prompt-input`'s
              pattern, [L06] / [L22]). The popup sits inside the
              host so click-to-accept walks up to the editor's
              `data-responder-id` and keeps it as first responder. */}
          <div
            ref={popupRef}
            data-slot="tug-completion-menu"
            className="tug-completion-menu"
            style={{ display: "none" }}
          />
        </div>
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

// ---------------------------------------------------------------------------
// Completion popup painter
// ---------------------------------------------------------------------------

/** Padding between the trigger anchor and the popup. */
const POPUP_GAP = 4;

/**
 * Repaint the typeahead popup. Called whenever the typeahead state
 * changes via the per-view subscription installed in the mount
 * effect.
 *
 * Hides the popup when typeahead is inactive or the filtered list
 * is empty. Otherwise rebuilds the popup body if the items changed,
 * reuses existing DOM nodes when only the selected index moved, and
 * — via a deferred `view.requestMeasure` — positions the popup at
 * the trigger character with auto-flip up vs. down based on the
 * available space inside the nearest scroll-clipping ancestor.
 *
 * Why the deferred positioning: the painter is called from a CM6
 * `ViewPlugin.update` listener, which fires DURING CM6's update
 * cycle. Calling `view.coordsAtPos` synchronously from there throws
 * "Reading the editor layout isn't allowed during an update" — CM6
 * catches the throw, logs it, and deactivates the plugin. Once the
 * plugin is deactivated, no further state changes are observed:
 * the popup gets stuck at its last position and stops responding to
 * keyboard navigation. Routing the read+write through
 * `requestMeasure` schedules them in CM6's regular measure phase
 * where layout reads are legal.
 *
 * Mirrors `tug-prompt-input`'s painter for the visual surface.
 */
function paintCompletionPopup(
  view: EditorView,
  popup: HTMLDivElement | null,
  host: HTMLDivElement | null,
  direction: "up" | "down",
): void {
  if (popup === null || host === null) return;
  const state = getCompletionState(view);
  if (!state.active || state.filtered.length === 0) {
    popup.style.display = "none";
    return;
  }
  // ---- Item rendering (synchronous, no DOM measurement needed) ----
  const items = popup.querySelectorAll(".tug-completion-menu-item");
  let same = items.length === state.filtered.length;
  if (same) {
    for (let k = 0; k < state.filtered.length; k++) {
      const label = items[k]?.querySelector(".tug-completion-menu-label");
      if (label?.textContent !== state.filtered[k]!.label) {
        same = false;
        break;
      }
    }
  }
  if (same) {
    items.forEach((el, k) => {
      el.className = "tug-completion-menu-item"
        + (k === state.selectedIndex ? " tug-completion-menu-item-selected" : "");
    });
    popup.style.display = "block";
    (items[state.selectedIndex] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  } else {
    popup.style.display = "block";
    popup.innerHTML = "";
    state.filtered.forEach((item, i) => {
      const div = document.createElement("div");
      div.className = "tug-completion-menu-item"
        + (i === state.selectedIndex ? " tug-completion-menu-item-selected" : "");
      const label = document.createElement("span");
      label.className = "tug-completion-menu-label";
      if (item.matches && item.matches.length > 0) {
        let pos = 0;
        for (const [start, end] of item.matches) {
          if (start > pos) {
            label.appendChild(document.createTextNode(item.label.slice(pos, start)));
          }
          const mark = document.createElement("span");
          mark.className = "tug-completion-match";
          mark.textContent = item.label.slice(start, end);
          label.appendChild(mark);
          pos = end;
        }
        if (pos < item.label.length) {
          label.appendChild(document.createTextNode(item.label.slice(pos)));
        }
      } else {
        label.textContent = item.label;
      }
      div.appendChild(label);
      div.addEventListener("pointermove", () => {
        // Move the keyboard selection to the hovered item — single
        // highlight semantics, mirrors the prompt-input painter.
        navigateCompletionByIndex(view, i);
      });
      div.addEventListener("pointerdown", (e) => {
        // Don't let the click steal focus from the editor — the
        // accept transaction below moves the caret deliberately.
        e.preventDefault();
        acceptCompletionAt(view, i);
      });
      popup.appendChild(div);
    });
    const selectedEl = popup.children[state.selectedIndex] as HTMLElement | undefined;
    selectedEl?.scrollIntoView({ block: "nearest" });
  }

  // ---- Deferred positioning ----
  // Read coordsAtPos / hostRect / popupH / clipRect in the measure
  // phase (where layout reads are legal), then write the position
  // styles in the same phase's write step. The `key` field
  // coalesces multiple repaints in the same frame down to a single
  // measurement.
  view.requestMeasure({
    key: "tug-edit-completion-position",
    read(): {
      anchorCoords: { left: number; right: number; top: number; bottom: number } | null;
      hostRect: DOMRect;
      popupH: number;
      clipRect: { top: number; bottom: number };
    } | null {
      if (popup === null || host === null) return null;
      const anchorCoords = view.coordsAtPos(state.anchorOffset);
      const hostRect = host.getBoundingClientRect();
      const popupH = popup.offsetHeight;
      let scrollParent: HTMLElement | null = host.parentElement;
      while (scrollParent !== null) {
        const ov = getComputedStyle(scrollParent).overflowY;
        if (ov === "auto" || ov === "scroll" || ov === "hidden") break;
        scrollParent = scrollParent.parentElement;
      }
      const clipRect = scrollParent !== null
        ? scrollParent.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      return { anchorCoords, hostRect, popupH, clipRect };
    },
    write(measured) {
      if (measured === null || popup === null) return;
      const { anchorCoords, hostRect, popupH, clipRect } = measured;
      if (anchorCoords === null) return;
      popup.style.left = `${anchorCoords.left - hostRect.left}px`;
      popup.style.right = "";
      const spaceAbove = anchorCoords.top - clipRect.top;
      const spaceBelow = clipRect.bottom - anchorCoords.bottom;
      const useDown = direction === "down"
        ? spaceBelow >= popupH || spaceBelow >= spaceAbove
        : spaceAbove < popupH && spaceBelow > spaceAbove;
      if (useDown) {
        popup.style.top = `${anchorCoords.bottom - hostRect.top + POPUP_GAP}px`;
        popup.style.bottom = "";
      } else {
        popup.style.bottom = `${hostRect.bottom - anchorCoords.top + POPUP_GAP}px`;
        popup.style.top = "";
      }
    },
  });
}

/** Navigate to a specific item by index — used by the popup's hover handler. */
function navigateCompletionByIndex(view: EditorView, index: number): void {
  const state = getCompletionState(view);
  if (!state.active) return;
  if (index === state.selectedIndex) return;
  navigateCompletion(view, { to: index });
}
