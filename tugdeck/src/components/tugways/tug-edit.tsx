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
  useMemo,
  useRef,
  useState,
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
  addAtomsEffect,
  atomDecorationField,
  atomInvertedEffects,
  insertAtomAtSelection,
  regenerateAtomsEffect,
} from "./tug-edit/atom-decoration";
import { atomicRangesExt } from "./tug-edit/atomic-ranges";
import { clipboardExt, parseClipboardHtml } from "./tug-edit/clipboard-filters";
import { tugDropExtension } from "./tug-edit/drop-extension";
import { createCMSelectionAdapter } from "./tug-edit/selection-adapter";
import { tugSelectionLayer } from "./tug-edit/selection-layer";
import { captureEditState, tugEditKeymap } from "./tug-edit/keymap";
import type { TugEditKeymapConfig } from "./tug-edit/keymap";
import {
  acceptCompletionAt,
  getCompletionState,
  navigateCompletion,
  subscribeCompletionState,
  tugCompletionExt,
} from "./tug-edit/completion-extension";
import {
  paintMirrorAsActive as paintMirrorAsActiveImpl,
  paintMirrorAsInactive as paintMirrorAsInactiveImpl,
  restoreEditState,
  TugEditStatePreservation,
} from "./tug-edit/state-preservation";
import type { PendingEditRestore } from "./tug-edit/state-preservation";
import { deckTrace } from "@/deck-trace";
import { selectionGuard } from "./selection-guard";
import { TugEditorContextMenu, type TugEditorContextMenuEntry } from "./tug-editor-context-menu";
import { useCardId } from "./use-card-state-preservation";
import { useOptionalResponder } from "./use-responder";
import type { ActionHandler, ActionHandlerResult } from "./responder-chain";
import { TUG_ACTIONS, type TugAction } from "./action-vocabulary";
import type {
  CompletionItem,
  CompletionProvider,
  DropHandler,
  TugTextEditingState,
} from "@/lib/tug-text-engine";

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
  /**
   * Snapshot the editor's text + atoms + selection + scrollTop into
   * a `TugTextEditingState`. Used by save callbacks (state
   * preservation) and history-nav consumers that want the same
   * shape. Returns the empty seed `{ text: "", atoms: [],
   * selection: null }` when no view is mounted.
   */
  captureState(): TugTextEditingState;
  /**
   * Restore a previously-captured editing state without claiming
   * focus. Replaces doc + atoms + selection in one transaction;
   * writes saved `scrollTop` directly. The consumer is responsible
   * for choosing the paint channel afterward via
   * `paintMirrorAsActive` (active card) or `paintMirrorAsInactive`
   * (inactive card). No-op when the editor is not mounted.
   *
   * Distinct from history-nav restore (which focuses + scrolls the
   * cursor into view); used by state preservation. [L23]
   */
  restoreState(state: TugTextEditingState): void;
  /**
   * Paint the editor as the deck-level first responder. Claims focus
   * and (when `state` is supplied) asserts selection + scrollTop
   * verbatim from the bag. The single legitimate call site for
   * mutating the global Selection + claiming document focus from a
   * `tug-edit` instance. [L23]
   *
   * No-op when the editor is not mounted.
   */
  paintMirrorAsActive(state?: TugTextEditingState): void;
  /**
   * Paint the editor as a non-first-responder card. Builds a `Range`
   * from the (saved or live) selection over `view.contentDOM` and
   * routes it through `publish` (typically
   * `range => selectionGuard.updateCardDomSelection(cardId, range)`).
   * No focus claim; no `window.getSelection()` mutation; no
   * dispatch to CM6 itself. [L23], [L12].
   *
   * No-op when the editor is not mounted.
   */
  paintMirrorAsInactive(
    publish: (range: Range | null) => void,
    state?: TugTextEditingState,
  ): void;
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
  /**
   * File-drop handler. When the user drags a file from Finder onto
   * the editor, the substrate's drop extension calls this with the
   * dropped `FileList` and inserts each returned `AtomSegment` at
   * the drop point as one transaction. Omit to fall back to a
   * default mapping that classifies files as `image` or `file`
   * by extension and uses the bare filename as both `label` and
   * `value`. Hosts that need richer mapping (real paths, content
   * hashes, server URLs) supply their own.
   */
  dropHandler?: DropHandler;
  /**
   * Opt in to tugdeck card state preservation. When `true`, the
   * editor registers `onSave` / `onRestore` / `onCardActivated` /
   * `onCardWillDeactivate` callbacks with the enclosing `CardHost`
   * via `useCardStatePreservation`, so doc + atoms + selection +
   * scrollTop survive cmd-tab cycles, tab deactivation, and a
   * cold-mount restore from tugbank. The active / inactive paint
   * channel decisions follow [L23] — the active card claims focus
   * + global Selection; inactive cards publish their selection
   * through `selectionGuard`'s inactive highlight.
   *
   * Default `true`. Set to `false` for stand-alone harnesses
   * (storybook, unit tests) that mount `TugEdit` outside a deck;
   * the registration is silently a no-op when the
   * `CardStatePreservationContext` is null, but the
   * `preserveState=false` opt-out skips the hook entirely.
   *
   * @default true
   */
  preserveState?: boolean;
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
  getDropHandler: () => DropHandler | null,
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
    // through copy / cut / paste; the drop extension lifts dragged
    // files from Finder into atoms at the drop point;
    // `atomInvertedEffects` registers history-aware undo so a cut
    // atom's widget reappears on Cmd-Z.
    atomDecorationField,
    atomInvertedEffects,
    atomicRangesExt,
    clipboardExt,
    tugDropExtension(host, getDropHandler),
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
      dropHandler,
      preserveState = true,
      ...rest
    }: TugEditProps,
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    // Buffered onRestore payload for the rare case where onRestore
    // fires before the EditorView's mount effect creates the view.
    // React fires child effects before parent effects, so a sibling
    // state-preservation registration that lives "above" the editor's
    // mount in the tree can dispatch onRestore one tick earlier than
    // the view is born. The mount effect inspects this ref and
    // replays the buffered restore through the same paint channel
    // (active / inactive) the original onRestore call would have
    // chosen. [L23], [L07].
    const pendingRestoreRef = useRef<PendingEditRestore | null>(null);

    // Enclosing card's id from `CardStatePreservationContext`. Null
    // when this editor is rendered outside a `CardHost` (storybook,
    // unit test). Held in a ref so the mount effect's buffered-
    // restore branch can publish through `selectionGuard` with the
    // card's identity at fire time per [L07] (cross-pane moves
    // preserve cardId in practice, but the ref keeps the contract
    // safe under any future identity-semantics change).
    const cardId = useCardId();
    const cardIdRef = useRef(cardId);
    useLayoutEffect(() => {
      cardIdRef.current = cardId;
    }, [cardId]);

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

    // Live drop-handler ref. The drop extension reads this thunk on
    // every drop so the latest host-supplied handler runs without
    // rebuilding the editor [L07].
    const dropHandlerRef = useRef<DropHandler | null>(dropHandler ?? null);
    useLayoutEffect(() => {
      dropHandlerRef.current = dropHandler ?? null;
    }, [dropHandler]);

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
      captureState(): TugTextEditingState {
        const view = viewRef.current;
        if (view === null) return { text: "", atoms: [], selection: null };
        return captureEditState(view);
      },
      restoreState(state: TugTextEditingState) {
        const view = viewRef.current;
        if (view === null) return;
        restoreEditState(view, state);
      },
      paintMirrorAsActive(state?: TugTextEditingState) {
        const view = viewRef.current;
        if (view === null) return;
        paintMirrorAsActiveImpl(view, state);
      },
      paintMirrorAsInactive(
        publish: (range: Range | null) => void,
        state?: TugTextEditingState,
      ) {
        const view = viewRef.current;
        if (view === null) return;
        paintMirrorAsInactiveImpl(view, publish, state);
      },
    }), []);

    // ---------------------------------------------------------------
    // Right-click context menu
    // ---------------------------------------------------------------
    //
    // Mirrors `tug-prompt-input`'s context-menu wiring so the two
    // substrates produce identical UX. The menu itself
    // (`TugEditorContextMenu`) is portaled — its only React state is
    // mount/unmount via the `open` prop. We carry the open lifecycle
    // here as `menuState | null` (component-scoped local data per
    // L06's zone partition), the menu's own internal positioning runs
    // via `useLayoutEffect` + DOM writes inside the menu, and item
    // disabled flags flow through render as data.
    //
    // Pre-right-click selection capture:
    // CM6 wraps a contentEditable; WebKit's "smart click" expands the
    // selection at right-click before our `contextmenu` handler runs.
    // CM6 observes the resulting DOM `selectionchange` and dispatches
    // a transaction, so reading `view.state.selection` in the
    // contextmenu handler would observe the post-expansion state and
    // misreport `hasSelection`. We capture the live selection at
    // pointerdown (button === 2) — which fires before the browser's
    // mousedown default — and dispatch a CM6 transaction in the
    // contextmenu handler to restore it. Whatever WebKit did between
    // pointerdown and contextmenu is undone via the same chain CM6
    // uses for any other selection mutation.

    // Menu state: null when closed, {x, y, hasSelection} when open.
    // hasSelection is sampled once on open and drives Cut/Copy
    // enablement.
    const [menuState, setMenuState] = useState<{
      x: number;
      y: number;
      hasSelection: boolean;
    } | null>(null);

    // Captured at pointerdown on a right-click, restored at contextmenu.
    // Stored as `from` / `to` (CM6 selection range fields) so a CM6
    // transaction can rebuild the same range without translating
    // through DOM Selection.
    const preRightClickSelectionRef = useRef<{ from: number; to: number } | null>(null);

    useLayoutEffect(() => {
      const host = hostRef.current;
      if (host === null) return;
      // Pointerdown runs before the browser's native mousedown default
      // action, so reading the selection here captures it pre-expansion.
      // We don't `preventDefault` — the native action is allowed to
      // run (focus, place caret if none existed) and we undo only the
      // selection portion in the contextmenu handler.
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 2) return;
        const view = viewRef.current;
        if (view === null) return;
        if (!view.dom.contains(e.target as Node)) {
          preRightClickSelectionRef.current = null;
          return;
        }
        const sel = view.state.selection.main;
        preRightClickSelectionRef.current = { from: sel.from, to: sel.to };
      };
      const onContextMenu = (e: MouseEvent) => {
        const view = viewRef.current;
        if (view === null) return;
        // Only intercept right-clicks that land inside the editor proper.
        // Clicks on host padding fall through to the browser's native
        // menu — matching `tug-prompt-input`.
        if (!view.dom.contains(e.target as Node)) return;
        e.preventDefault();
        // No makeFirstResponder call: the document-level pointerdown
        // listener in ResponderChainProvider already promoted this
        // node via data-responder-id lookup, and a right-click issues
        // pointerdown before contextmenu.
        //
        // Restore the pre-right-click selection, undoing any WebKit
        // smart-click expansion that ran during native mousedown
        // handling. When the captured value is null (right-click into
        // an unfocused or off-target editor), skip the restore and
        // let whatever caret WebKit placed be the effective state —
        // avoids clearing a caret the user expects.
        const captured = preRightClickSelectionRef.current;
        if (captured !== null) {
          view.dispatch({
            selection: EditorSelection.range(captured.from, captured.to),
            userEvent: "select",
          });
        }
        const adapter = createCMSelectionAdapter(view);
        const classification = adapter.classifyRightClick(e.clientX, e.clientY);

        let hasSelection: boolean;
        if (classification === "elsewhere") {
          // Click landed away from the selection — move to click point
          // and expand to word boundaries.
          adapter.selectWordAtPoint(e.clientX, e.clientY);
          hasSelection = adapter.hasRangedSelection();
        } else {
          // "near-caret" or "within-range" — leave the restored
          // selection as-is. hasSelection is true only for "within-range".
          hasSelection = classification === "within-range";
        }

        setMenuState({ x: e.clientX, y: e.clientY, hasSelection });
      };
      host.addEventListener("pointerdown", onPointerDown);
      host.addEventListener("contextmenu", onContextMenu);
      return () => {
        host.removeEventListener("pointerdown", onPointerDown);
        host.removeEventListener("contextmenu", onContextMenu);
      };
    }, []);

    const closeMenu = useCallback(() => setMenuState(null), []);

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
    //
    // Bridge-paste atom round-trip: the bridge exposes
    // `text/plain` + `text/html` only — never the
    // `application/x-tug-atoms` custom MIME the substrate writes on
    // copy. We parse `html` first via `parseClipboardHtml`. When the
    // html carries atom `<img data-atom-*>` markup, we reconstruct
    // the atoms in a single transaction (text + decorations
    // together, mirrors the `clipboardExt.handlePaste` sidecar
    // branch). When the html is empty / atom-free / malformed, we
    // fall through to inserting `text` verbatim.
    const handlePaste = useCallback((): ActionHandlerResult => {
      const view = viewRef.current;
      if (view === null) return;
      view.focus();
      if (hasNativeClipboardBridge()) {
        const readPromise = readClipboardViaNative();
        return () => {
          void readPromise.then(({ text, html }) => {
            const live = viewRef.current;
            if (live === null) return;
            const { from, to } = live.state.selection.main;
            const parsedHtml = parseClipboardHtml(html);
            if (parsedHtml !== null) {
              const placedAtoms = parsedHtml.atoms.map((a) => ({
                position: from + a.position,
                segment: a.segment,
              }));
              live.dispatch({
                changes: { from, to, insert: parsedHtml.docText },
                effects: placedAtoms.length > 0
                  ? addAtomsEffect.of(placedAtoms)
                  : [],
                selection: { anchor: from + parsedHtml.docText.length },
                userEvent: "input.paste",
              });
              return;
            }
            if (text === "") return;
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

    // Menu items: stable for the menu's lifetime. `hasSelection` is
    // the only input that can change while the menu is open, but the
    // menu reads `items` once at mount per its own contract, so
    // re-deriving on `menuState?.hasSelection` change is safe. Kept
    // identical in shape to `tug-prompt-input`'s menu so cross-
    // substrate UX matches: same labels, same shortcuts, same order.
    const menuItems = useMemo<TugEditorContextMenuEntry[]>(() => {
      const hasSelection = menuState?.hasSelection ?? false;
      return [
        { action: TUG_ACTIONS.CUT,        label: "Cut",        shortcut: "⌘X", disabled: !hasSelection },
        { action: TUG_ACTIONS.COPY,       label: "Copy",       shortcut: "⌘C", disabled: !hasSelection },
        { action: TUG_ACTIONS.PASTE,      label: "Paste",      shortcut: "⌘V" },
        { type: "separator" },
        { action: TUG_ACTIONS.SELECT_ALL, label: "Select All", shortcut: "⌘A" },
      ];
    }, [menuState?.hasSelection]);

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
          () => dropHandlerRef.current,
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

      // Emit `engine-ready` for harness tests that gate on the
      // EditorView being constructed inside this card. Mirrors the
      // matching emit site in `tug-prompt-input.tsx`. The cardId is
      // read from the ref so a stand-alone TugEdit (no enclosing
      // CardHost) is silent — there's no card to associate the
      // event with.
      const readyCardId = cardIdRef.current;
      if (readyCardId !== null) {
        deckTrace.record({
          kind: "engine-ready",
          cardId: readyCardId,
          engine: "tug-edit",
        });
      }

      // Replay any onRestore payload that fired before this mount
      // effect ran. React fires child effects before parent
      // effects, so the `TugEditStatePreservation` child's
      // registration may have dispatched onRestore one tick before
      // the EditorView was constructed. The hook stashed the
      // payload on `pendingRestoreRef`; we apply it now through the
      // same paint channel the live `onRestore` call would have
      // chosen, then clear the ref. [L23].
      const pending = pendingRestoreRef.current;
      if (pending !== null) {
        const { state: bufferedState, isActive } = pending;
        restoreEditState(view, bufferedState);
        if (isActive) {
          paintMirrorAsActiveImpl(view, bufferedState);
        } else {
          paintMirrorAsInactiveImpl(view, (range) => {
            const id = cardIdRef.current;
            if (id !== null) {
              selectionGuard.updateCardDomSelection(id, range);
            }
          }, bufferedState);
        }
        pendingRestoreRef.current = null;
      }

      return () => {
        // Drop the card's last-published Range from selectionGuard
        // so the inactive-selection highlight doesn't linger over
        // DOM nodes that are about to unmount. Mirrors the
        // `tug-prompt-input` cleanup. [L23].
        const id = cardIdRef.current;
        if (id !== null) {
          selectionGuard.updateCardDomSelection(id, null);
        }
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
          {/* Right-click context menu. Conditionally rendered so the
              menu component only enters the React tree when actually
              open — keeping its `useRequiredResponderChain` hook off
              the path for stand-alone harnesses (storybook, unit
              tests) that mount `TugEdit` outside a
              `ResponderChainProvider` and never open the menu. The
              menu's own internal positioning runs via
              `useLayoutEffect` + DOM writes inside the menu, so the
              only React state involved here is the open lifecycle
              ([L06]). Items dispatch through the responder chain
              ([L11]); the substrate's responder is registered on
              this host so item activations land in the same
              handlers as the keyboard shortcuts. */}
          {menuState !== null && (
            <TugEditorContextMenu
              open
              x={menuState.x}
              y={menuState.y}
              items={menuItems}
              onClose={closeMenu}
            />
          )}
        </div>
        {/* State-preservation registration. Conditional on
            `preserveState` so stand-alone harnesses (storybook,
            unit tests) can opt out. Renders `null` (no DOM); the
            hook is the work — registers `onSave` / `onRestore` /
            `onCardActivated` / `onCardWillDeactivate` with the
            enclosing `CardHost` via `useCardStatePreservation`.
            [L23], [L03]. */}
        {preserveState && (
          <TugEditStatePreservation
            viewRef={viewRef}
            pendingRestoreRef={pendingRestoreRef}
          />
        )}
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
