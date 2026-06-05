/**
 * TugTextEditor — CodeMirror 6-backed text editing substrate.
 *
 * The lower-level editing primitive that backs higher-level tug
 * components. Built on an `EditorView` from CodeMirror 6: the
 * React shell owns mount and dispose, observes via
 * `EditorView.updateListener`, and exposes an imperative delegate
 * via `ref`.
 *
 * Owns the document, caret, selection, and embedded atoms — the state
 * that editing actions (cut, copy, paste, selectAll, undo, redo,
 * insertAtom, submit) mutate. Per [L11], `TugTextEditor` is the responder
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

import "./tug-text-editor.css";
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
import { createPortal } from "react-dom";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, highlightActiveLineGutter, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import {
  cursorGroupBackward,
  cursorGroupForward,
  defaultKeymap,
  deleteGroupBackward,
  deleteLineBoundaryBackward,
  history,
  historyKeymap,
  redo,
  selectAll,
  undo,
} from "@codemirror/commands";
import { cn } from "@/lib/utils";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { subscribeThemeChange, unsubscribeThemeChange } from "@/theme-tokens";
import type { AtomSegment } from "@/lib/tug-atom-img";
import type { AtomBytesStore } from "@/lib/atom-bytes-store";
import type { HistoryProvider, InputAction } from "@/lib/tug-text-types";
import {
  hasNativeClipboardBridge,
  readClipboardViaNative,
} from "@/lib/tug-native-clipboard";
import { tugDevLogStore } from "@/lib/tug-dev-log-store/tug-dev-log-store";
import { tugTheme } from "./tug-text-editor/theme";
import { hostFocusMirror } from "./tug-text-editor/host-state";
import {
  addAtomsEffect,
  atomBytesStoreFacet,
  atomDecorationField,
  atomInvertedEffects,
  getAtomHeightPx,
  insertAtomAtSelection,
  pendingAtomSyncPlugin,
  pendingAtomTheme,
  regenerateAtomsEffect,
} from "./tug-text-editor/atom-decoration";
import { atomicRangesExt } from "./tug-text-editor/atomic-ranges";
import {
  clipboardExtension,
  parseClipboardHtmlEnvelope,
} from "./tug-text-editor/clipboard-filters";
import { tugDropExtension } from "./tug-text-editor/drop-extension";
import { createCMSelectionAdapter } from "./tug-text-editor/selection-adapter";
import type { TextSelectionAdapter } from "./text-selection-adapter";
import { tugCaretInteractionPlugin, tugCaretLayer } from "./tug-text-editor/caret-layer";
import { tugLineNumbersGutter } from "./tug-text-editor/line-numbers-gutter";
import { tugSelectionLayer } from "./tug-text-editor/selection-layer";
import { captureEditState, tugTextEditorKeymap } from "./tug-text-editor/keymap";
import type { TugTextEditorKeymapConfig } from "./tug-text-editor/keymap";
import {
  acceptCompletionAt,
  cancelCompletion,
  completionPopupIsInteractive,
  getCompletionState,
  navigateCompletion,
  subscribeCompletionState,
  tugCompletionExt,
} from "./tug-text-editor/completion-extension";
import {
  paintMirrorAsActive as paintMirrorAsActiveImpl,
  paintMirrorAsInactive as paintMirrorAsInactiveImpl,
  restoreEditState,
  TugTextEditorStatePreservation,
} from "./tug-text-editor/state-preservation";
import type { PendingEditRestore } from "./tug-text-editor/state-preservation";
import { deckTrace } from "@/deck-trace";
import { getDeckStore } from "@/lib/deck-store-registry";
import { selectionGuard } from "./selection-guard";
import { useTextSurfaceContextMenu } from "./use-text-surface-context-menu";
import { useCardId } from "./use-card-state-preservation";
import { useCompanionPopupBinding } from "./use-companion-popup-binding";
import { useOptionalResponder } from "./use-responder";
import { useResponderChain } from "./responder-chain-provider";
import { TAB_CONSUME_ATTRIBUTE } from "./focus-manager";
import type { ActionHandler, ActionHandlerResult } from "./responder-chain";
import { TUG_ACTIONS, type TugAction } from "./action-vocabulary";
import type {
  CompletionItem,
  CompletionProvider,
  DropHandler,
  TugTextEditingState,
} from "@/lib/tug-text-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default focus indication when `focusStyle` is not supplied. */
const DEFAULT_FOCUS_STYLE = "background" as const;

/** Default Enter-key action. Matches `tug-prompt-input`'s historical default. */
const DEFAULT_RETURN_ACTION: InputAction = "submit";

/** Default numpad-Enter action. Matches `tug-prompt-input`'s default. */
const DEFAULT_NUMPAD_ENTER_ACTION: InputAction = "submit";

/**
 * Default maxRows when `maxRows` is not supplied. Matches
 * `tug-prompt-input`'s historical maximum visible rows.
 */
const DEFAULT_MAX_ROWS = 8;

/** No-op submit handler used when the host omits `onSubmit`. */
const noopSubmit = (): void => {};

// ---------------------------------------------------------------------------
// Compartments
// ---------------------------------------------------------------------------
//
// Compartments let the React shell reconfigure individual extensions
// (placeholder text, soft-wrap toggle, gutter toggle, read-only toggle)
// without rebuilding the EditorView. Each Compartment is module-scoped
// because CM6 identifies a Compartment by reference — the shell
// dispatches `compartment.reconfigure(newExt)` whenever the
// corresponding prop changes, and CM6 swaps the Compartment's contents
// in place. The view, the document, the selection, the history, and
// every other extension are untouched.
//
// Why module-scope, not per-instance: a Compartment's identity is the
// reference itself; dispatching `reconfigure(...)` on a Compartment
// the view doesn't carry is a no-op. Module-scope means every
// `TugTextEditor` mount uses the same Compartment identities — the
// `buildExtensions` call wraps each one for that particular view
// when the view is constructed, and subsequent `useLayoutEffect`
// passes can reach into the live view and reconfigure.
//
// `Compartment.of(initial)` returns the wrapped extension; we feed
// the initial prop values at view-construction time inside
// `buildExtensions`, then use `compartment.reconfigure(next)` from
// effects on prop change.

/** Reconfigurable placeholder text. Empty extension when no placeholder. */
const placeholderCompartment = new Compartment();

/** Reconfigurable soft-wrap (`EditorView.lineWrapping` or empty). */
const lineWrapCompartment = new Compartment();

/** Reconfigurable line-number gutter (`lineNumbers()` or empty). */
const lineNumbersCompartment = new Compartment();

/**
 * Reconfigurable active-line gutter highlight
 * (`highlightActiveLineGutter()` from `@codemirror/view`, or
 * empty). Toggling this on adds a `cm-activeLineGutter` class to
 * the gutter cell of the line containing the cursor. Has no
 * visible effect when no gutter is rendered (i.e. when
 * `lineNumbers` is false), but the two props are independent
 * because future custom gutters may be added separately.
 */
const activeLineGutterCompartment = new Compartment();

/** Reconfigurable read-only state (`EditorState.readOnly.of(true|false)`). */
const readOnlyCompartment = new Compartment();

/**
 * Reconfigurable geometry-revision marker.
 *
 * Holds an empty `EditorView.theme({})` extension whose contributed
 * style-module identity changes every time a prop-response
 * `useLayoutEffect` reconfigures it. The compartment exists solely
 * to bridge the gap between two state systems:
 *
 *   1. Geometry-affecting props change rendered metrics through
 *      paths CM6 doesn't observe natively:
 *        - **Typography props** (`fontFamily`, `fontSize`,
 *          `lineHeight`, `letterSpacing`) flow through CSS custom
 *          properties on the host wrapper and propagate via
 *          inheritance into `.cm-content`. The browser re-flows
 *          on its own when these change.
 *        - **`lineNumbers`** toggling adds or removes the
 *          line-number gutter, changing the scroller's
 *          clientWidth (and through it the contentDOM's
 *          available width) — affecting per-line wrap counts.
 *        - **`lineWrap`** toggling changes whether `.cm-content`
 *          wraps overflow at all, directly altering per-line
 *          heights for any line that previously overflowed.
 *   2. CodeMirror 6 maintains a private `heightOracle` cache of
 *      the editor's default line-height (read once via
 *      `getComputedStyle` of `.cm-content`) plus per-line height
 *      measurements in its `heightMap`. Gutter row heights,
 *      scroll geometry, and viewport calculations all read from
 *      these caches. CM6 does NOT observe CSS-variable changes
 *      or geometry shifts induced by sibling-extension toggling;
 *      its private `mustMeasureContent` flag is what tells the
 *      next measure pass to re-read computed styles and
 *      per-line rects into the oracle and heightMap.
 *
 * The decisive trigger for that flag — confirmed empirically and
 * by reading CM6's source (`view.update` ~ line 7962 of
 * `@codemirror/view/dist/index.js`) — is:
 *
 *     if (update.startState.facet(theme) != update.state.facet(theme))
 *       this.viewState.mustMeasureContent = true;
 *
 * Each call to `EditorView.theme(spec)` mints a fresh prefix via
 * `StyleModule.newName()` and contributes that prefix string to
 * the `theme` facet. Reconfiguring this compartment with a
 * freshly-built (even empty) `EditorView.theme({})` produces a
 * new prefix → the `theme` facet's resolved value differs by
 * reference → `mustMeasureContent` flips → the next measure
 * pass calls `heightOracle.refresh(...)` against the
 * now-current computed line-height → the heightMap rebuilds
 * with the new oracle values → the gutter plugin picks up the
 * fresh row heights on the post-measure update.
 *
 * No CSS rules go through this theme — its `spec` is `{}`. We
 * don't want it to influence visual rendering; the marker's
 * identity (the per-call prefix) is what CM6 compares, not its
 * stylistic content. The real theme rules live in `tugTheme`
 * from `theme.ts`, which stays as a static extension.
 *
 * Other paths considered and rejected by the trace in
 * `typography-diag.ts`:
 *
 *   - Empty `view.dispatch({})` and `selection: state.selection`:
 *     produce transactions with no facet diff. `mustMeasureContent`
 *     stays false; the measure pass skips the refresh branch.
 *   - `lineNumbersCompartment.reconfigure(tugLineNumbersGutter)`: same
 *     shape — touches the gutter facet but not the theme facet.
 *   - `EditorView.contentAttributes.of({})` reconfigure: CM6
 *     compares `contentAttributes` between updates inside
 *     `viewState.update` (different code path), but
 *     `mustMeasureContent` is set only on the `theme` facet diff.
 *     Confirmed via the trace: the contentAttributes-reconfigure
 *     dispatch fired but produced `heightChanged: false`.
 *
 * Without this bridge, CSS-variable typography changes are
 * invisible to CM6 until the next "real" trigger (the user types
 * a character, scrolls, or the window resizes) — which is the
 * latency the user reported as "I have to click+type to see the
 * gutter update."
 */
const typographyRevCompartment = new Compartment();

// ---------------------------------------------------------------------------
// TugTextEditorDelegate
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
export interface TugTextEditorDelegate {
  /**
   * Return the live `EditorView`, or `null` if no view is
   * currently mounted.
   */
  view(): EditorView | null;
  /**
   * If the completion popup is currently open and interactive (active
   * with at least one item), accept the highlighted item — inserting
   * its atom — and return `true`. Otherwise no-op and return `false`.
   *
   * Submit flows (the Z5 button, Shift+Return) call this BEFORE reading
   * the draft so a submit made while the popup is open commits the
   * *completed* command / mention, not the typed fragment. The keyboard
   * accept (plain Enter / Tab) lives in the completion keymap; this is
   * the seam for submit paths that bypass it. No-op when not mounted.
   */
  acceptActiveCompletion(): boolean;
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
   * `tug-text-editor` instance. [L23]
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
// TugTextEditorProps
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
export type TugTextEditorFocusStyle = "background" | "ring";

/**
 * Props for `TugTextEditor`. The component renders a host `<div>`
 * around the live `EditorView`; standard `<div>` props
 * (`className`, `style`, `data-*`, etc.) flow through to the
 * host.
 */
export interface TugTextEditorProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> {
  /**
   * Optional className applied to the host wrapper. Composed with
   * the component's own `tug-text-editor` base class.
   */
  className?: string;
  /**
   * Focus indication style for the host wrapper.
   * @default "background"
   * @selector .tug-text-editor[data-focus-style]
   */
  focusStyle?: TugTextEditorFocusStyle;
  /**
   * Suppress the host wrapper's border. For embedding in compound
   * components where the parent owns the border treatment.
   * @default false
   * @selector .tug-text-editor[data-borderless]
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
   * Per-card byte-payload store for inline image attachments. When
   * provided, the drop and paste pipelines route image files through
   * the async `downsampleImage` → bytes-store path: each image atom
   * comes back with a UUID `id` paired with bytes in this store, and
   * the wire-flattening at submit (Step 3) packs them as Attachments.
   *
   * Defaults to `undefined`, in which case drops use the synchronous
   * `defaultFilesToMixedItems` path (image atoms with no bytes,
   * non-image filenames as plain text) and image clipboard items fall
   * through to the substrate's text-paste path. Gallery cards and
   * stand-alone harnesses leave this absent;
   * dev-card prompt-entry instances wire it through from their
   * `CodeSessionStore`. Per [D03](roadmap/dev-atoms.md#d03-atom-bytes-store).
   *
   * The prop is a controlled reference — pass the same store
   * instance on every render. A late-arriving store (mounted as
   * `undefined`, then re-rendered with a value) is picked up via
   * ref-mirroring; the next drop / paste uses the latest reference.
   */
  attachmentBytesStore?: AtomBytesStore;
  /**
   * Callback invoked when the drop / paste downsample pipeline
   * rejects a file (oversize image, unsupported source format,
   * decode failure). The string is a user-facing message suitable
   * for a banner.
   *
   * Defaults to a no-op. Dev-card prompt-entry passes
   * `CodeSessionStore.publishAttachmentError`. Per
   * [Table T01](roadmap/dev-atoms.md#t01-failure-modes).
   */
  onAttachmentError?: (message: string) => void;
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
   * (storybook, unit tests) that mount `TugTextEditor` outside a deck;
   * the registration is silently a no-op when the
   * `CardStatePreservationContext` is null, but the
   * `preserveState=false` opt-out skips the hook entirely.
   *
   * @default true
   */
  preserveState?: boolean;
  /**
   * Empty-state hint rendered inside the editor when the document is
   * empty. Wired through `@codemirror/view`'s `placeholder` extension
   * via a Compartment so changes take effect without remounting.
   * @default ""
   */
  placeholder?: string;
  /**
   * Maximum visible rows before vertical scrolling kicks in. Caps the
   * height of `.cm-scroller` via CSS:
   * `max-height: calc(var(--tug-text-editor-max-rows) * 1lh + padding)`.
   * Ignored when `maximized` is true.
   * @default 8
   * @selector .tug-text-editor (CSS variable `--tug-text-editor-max-rows`)
   */
  maxRows?: number;
  /**
   * Direction the editor grows as lines are added.
   * `"down"` — top edge fixed, bottom extends (default).
   * `"up"` — bottom edge fixed, top extends. The host wrapper sets
   * `data-grow-direction="up"`; layout consumers anchor the editor to
   * the bottom of a flex parent (`align-self: flex-end` /
   * `margin-top: auto` patterns).
   * @default "down"
   * @selector .tug-text-editor[data-grow-direction]
   */
  growDirection?: "up" | "down";
  /**
   * Expand the editor to fill available container space. The container
   * must be a flex column with a constrained height. When true,
   * `maxRows` is ignored and `.cm-scroller` switches from
   * `max-height` (capped) to `flex: 1 1 auto` (fills parent).
   * @default false
   * @selector .tug-text-editor[data-maximized]
   */
  maximized?: boolean;
  /**
   * Whether the editor is disabled. Sets `EditorState.readOnly` so
   * CM6 rejects content edits at the transaction level, and toggles
   * `data-disabled` on the host wrapper for visual state.
   * @default false
   * @selector .tug-text-editor[data-disabled]
   */
  disabled?: boolean;
  /**
   * Soft-wrap long lines at the editor's width. When true, adds
   * `EditorView.lineWrapping` (sets `white-space: break-spaces` on
   * `.cm-content`); when false, long lines scroll horizontally.
   * @default false
   */
  lineWrap?: boolean;
  /**
   * Show line numbers in a left gutter. When true, adds the
   * substrate's `tugLineNumbersGutter` (a custom variant of
   * `@codemirror/view`'s `lineNumbers()` that wraps each
   * line-number value in a `<span>` for theme-driven sizing).
   * The gutter sits inside `.cm-scroller` and does not shift
   * the caret-column origin.
   * @default false
   */
  lineNumbers?: boolean;
  /**
   * Highlight the gutter cell of the line containing the cursor.
   * When true, adds `highlightActiveLineGutter()` from
   * `@codemirror/view`, which sets a `cm-activeLineGutter` class
   * on the gutter cell whose line block contains the cursor.
   * The class is theme-styled to a subtle background tint that
   * tracks the cursor as it moves.
   *
   * Independent of `lineNumbers`: the highlight only has a
   * visible effect when a gutter is rendered, but consumers can
   * toggle the two props independently in case future gutters
   * (folding markers, breakpoint markers) are added.
   * @default false
   */
  highlightActiveLineGutter?: boolean;
  /**
   * CSS `font-family` for the editor surface. Sets the
   * `--tug-font-family-editor` custom property on the host wrapper;
   * the theme reads it via `var(--tug-font-family-editor, …)` so
   * undefined falls back to the existing token.
   */
  fontFamily?: string;
  /**
   * CSS `font-size` for the editor surface (e.g. `"14px"`,
   * `"1rem"`). Sets `--tug-font-size-editor` on the host wrapper.
   */
  fontSize?: string;
  /**
   * CSS `line-height` for the editor surface. Accepts either a
   * unitless number (e.g. `1.6`, treated as a multiplier of
   * `font-size`) or a CSS length string (e.g. `"22px"`). Sets
   * `--tug-line-height-editor` on the host wrapper. The
   * `.cm-line::before` ghost uses `1lh` so any change propagates to
   * line-box height regardless of unit.
   *
   * Default (when the prop is undefined): `1.6` via the theme's
   * `var(--tug-line-height-editor, 1.6)` CSS fallback.
   */
  lineHeight?: string | number;
  /**
   * CSS `letter-spacing` for the editor surface (e.g. `"0.01em"`,
   * `"normal"`). Sets `--tug-letter-spacing-editor` on the host
   * wrapper.
   */
  letterSpacing?: string;
  /**
   * Additional CM6 extensions installed at mount time alongside the
   * substrate's built-in extension set. Use this seam for compound
   * components that need a host-supplied extension (e.g.
   * `tug-prompt-entry`'s route-prefix detector).
   *
   * Read once at mount: changes after the view is constructed do
   * NOT propagate. Host-supplied extensions are expected to be
   * stable for the life of the editor view; per-prop reactivity
   * should be threaded through refs read by the extension at fire
   * time per [L07].
   */
  extensions?: Extension | readonly Extension[];
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
  getKeymapConfig: () => TugTextEditorKeymapConfig,
  getCompletionProviders: () => Record<string, CompletionProvider>,
  getDropHandler: () => DropHandler | null,
  getBytesStore: () => AtomBytesStore | null,
  onAttachmentError: (message: string) => void,
  initial: {
    placeholder: string;
    lineWrap: boolean;
    lineNumbers: boolean;
    highlightActiveLineGutter: boolean;
    disabled: boolean;
  },
  hostExtensions: readonly Extension[],
): readonly Extension[] {
  return [
    history(),
    // [P02] A secondary-click (right-click or macOS Control-click) over a ranged
    // selection must NOT move the caret — it opens the context menu, which acts on
    // the existing selection. CodeMirror's built-in pointer selection otherwise
    // dispatches a `select.pointer` transaction on mouseup that collapses the
    // selection to the click point (even after the shared hook's capture/restore
    // runs, so restoring-after is the wrong shape here). This handler runs before
    // CM6's built-in mouse handling; returning `true` suppresses CM6's pointer
    // selection for this click. The OS-level `contextmenu` still fires, so the
    // menu opens. Only guards when a range exists — a plain-caret secondary-click
    // still positions the caret (Paste-at-click). Confirmed working by hand.
    // [P02] A secondary-click (right-click or macOS Control-click) over a ranged
    // selection must NOT move the caret — it opens the context menu, which acts on
    // the existing selection. CodeMirror's built-in pointer selection otherwise
    // dispatches a `select.pointer` transaction that collapses the selection to
    // the click point (even after the shared hook's capture/restore runs, so
    // restoring-after is the wrong shape here). This handler runs before CM6's
    // built-in mouse handling; returning `true` suppresses CM6's pointer selection
    // for this click. The OS-level `contextmenu` still fires, so the menu opens.
    // Only guards when a range exists — a plain-caret secondary-click still
    // positions the caret (Paste-at-click).
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const sel = view.state.selection.main;
        const hasRange = sel.from !== sel.to;
        const isSecondaryClick =
          event.button === 2 || (event.button === 0 && event.ctrlKey);
        return hasRange && isSecondaryClick;
      },
    }),
    // TEMP rclk probe ([#investigation]): catch the exact transaction that
    // collapses a ranged selection and dump a stack trace naming the clobberer.
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet) return;
      const before = update.startState.selection.main;
      const after = update.state.selection.main;
      if (before.from !== before.to && after.from === after.to) {
        tugDevLogStore.warn("rclk", "CM6 SELECTION CLOBBERED", {
          before: `${before.from}-${before.to}`,
          after: `${after.from}-${after.to}`,
          focused: update.view.hasFocus,
          userEvents: update.transactions.map(
            (t) => t.annotation(Transaction.userEvent) ?? "(none)",
          ),
          stack: new Error().stack,
        });
      }
    }),
    // Host-supplied extensions are layered first so they sit BELOW the
    // substrate's keymap / theme precedence. A compound component that
    // wants its own keymap or `Prec.highest` rules can wrap them in
    // `Prec.highest(...)` itself; lining them up under the substrate's
    // base keeps `tugTextEditorKeymap` and `tugTheme` authoritative
    // for the substrate's own contracts.
    ...hostExtensions,
    // Compartment-wrapped extensions go first so their initial values
    // are layered before precedence-sensitive extensions (keymap, theme).
    // Each compartment is reconfigured from the React shell on prop
    // change without rebuilding the view.
    placeholderCompartment.of(
      initial.placeholder !== "" ? cmPlaceholder(initial.placeholder) : [],
    ),
    lineWrapCompartment.of(initial.lineWrap ? EditorView.lineWrapping : []),
    lineNumbersCompartment.of(initial.lineNumbers ? tugLineNumbersGutter : []),
    activeLineGutterCompartment.of(
      initial.highlightActiveLineGutter ? highlightActiveLineGutter() : [],
    ),
    readOnlyCompartment.of(EditorState.readOnly.of(initial.disabled)),
    // Initial revision marker. Each `EditorView.theme({})` mints
    // a fresh style-module prefix; subsequent reconfigures
    // produce a new prefix → the `theme` facet's value differs
    // → CM6 flips `mustMeasureContent = true` → next measure
    // pass refreshes the heightOracle from the live computed
    // styles. See `typographyRevCompartment` docstring above.
    typographyRevCompartment.of(EditorView.theme({})),
    // Typeahead first so its `Prec.highest` keymap sees Enter / Tab /
    // Arrows / Escape before the Step 4 keymap when a session is
    // active. When inactive, every branch returns `false` and the
    // keystroke falls through to `tugTextEditorKeymap` and beyond.
    tugCompletionExt(getCompletionProviders),
    // tug-specific keymap runs before defaultKeymap / historyKeymap
    // (Prec.high inside `tugTextEditorKeymap`) so Enter / numpad Enter /
    // Cmd-Enter / Cmd-Up / Cmd-Down get tug semantics. Falling
    // through (returning false) lets the default bindings handle
    // newline insertion, undo/redo, selectAll, and the rest.
    tugTextEditorKeymap(getKeymapConfig),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    // Selection + caret painted by custom layers. We deliberately
    // do NOT use `drawSelection`: drawSelection bundles a styled
    // `.cm-cursor` (which sizes itself from `coordsAtPos`'s glyph
    // rect and wobbles between text and atom positions) and a
    // `Prec.highest` theme that forces `caret-color: transparent
    // !important` and `::selection: transparent !important` (which
    // collide with the substrate's existing glyph-recolor rule).
    // The two own-layer extensions cover the same surface without
    // the precedence battle:
    //   - `tugSelectionLayer` paints `.cm-selectionBackground` divs
    //     for non-empty ranges; survives editor blur and covers
    //     atom widgets cleanly.
    //   - `tugCaretLayer` paints a single `.tug-text-editor-caret` div at
    //     the head of a focused, collapsed selection. The native
    //     WebKit caret is suppressed by `caret-color: transparent`
    //     on `.cm-content` (in `tugTheme`); the layer paints the
    //     visible caret with height taken from
    //     `lineBlockAt(head).height` so it stays uniform across
    //     text-only, atom-only, and mixed lines. Replaces three
    //     prior cache-flush hacks (history-nav, typeahead-deactivate,
    //     atom-removal) that worked around WebKit's contentEditable
    //     caret-cache staleness.
    tugSelectionLayer,
    tugCaretLayer,
    tugCaretInteractionPlugin,
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
    // Bytes-store facet — read by `AtomWidget.toDOM` and the
    // pending-sync `ViewPlugin` to derive the pending appearance
    // for skeleton atoms (drop / paste inserted them synchronously
    // before the async byte-fill completed).
    atomBytesStoreFacet.of(getBytesStore),
    // Subscribes to the bytes-store; on bytes-arrival, walks atom
    // widgets in `view.contentDOM` and toggles `data-pending` via
    // direct DOM mutation ([L06]). No-op when no bytes-store is
    // registered (facet default thunk returns `null`).
    pendingAtomSyncPlugin,
    pendingAtomTheme,
    clipboardExtension(getBytesStore, onAttachmentError),
    tugDropExtension(host, getDropHandler, getBytesStore, onAttachmentError),
  ];
}

export const TugTextEditor = React.forwardRef<TugTextEditorDelegate, TugTextEditorProps>(
  function TugTextEditor(
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
      attachmentBytesStore,
      onAttachmentError,
      preserveState = true,
      placeholder = "",
      maxRows = DEFAULT_MAX_ROWS,
      growDirection = "down",
      maximized = false,
      disabled = false,
      lineWrap = false,
      lineNumbers: lineNumbersProp = false,
      highlightActiveLineGutter: highlightActiveLineGutterProp = false,
      fontFamily,
      fontSize,
      lineHeight,
      letterSpacing,
      extensions: extensionsProp,
      style: styleProp,
      ...rest
    }: TugTextEditorProps,
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    // Stable id for this editor's responder, declared up here so
    // `useImperativeHandle`'s focus closure can address the chain via
    // `manager.focusResponder(responderId)`. The actual responder
    // registration happens later (`useOptionalResponder` below) using
    // this same id. `useResponderChain()` returns null outside a
    // chain provider — TugTextEditor uses `useOptionalResponder` so
    // it can render in chain-less harness contexts; the focus
    // delegate falls back to `view.focus()` in that case.
    const responderId = useId();
    const responderChainManager = useResponderChain();
    // Render-flow signal: child <CompletionOverlay /> mounts only when
    // a non-null view is available. The view itself is canonical in
    // `viewRef` (used by every imperative consumer); this state is a
    // structure-zone signal for the child to subscribe to typeahead
    // events on the live view. [L02 — child observes view via this
    // state plus the completion-extension's own subscriber set.]
    const [view, setView] = useState<EditorView | null>(null);
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

    // Snapshot survival across React Fast Refresh's same-instance
    // effect re-run.
    //
    // When Vite hot-replaces a module whose source contains a hook
    // call (e.g. an edit to `tug-text-editor.tsx` itself, or to anything
    // it transitively imports like `tug-text-editor/theme.ts`), Fast
    // Refresh re-runs every effect *defined in that module's
    // source*. The component instance is preserved — `useRef`
    // values survive — but the mount effect's cleanup runs (which
    // destroys the CM6 view) and the body runs again (which
    // creates a fresh empty view). This destroys the user's
    // typed state without going through any framework transition:
    // `useCardStatePreservation`'s effect lives in a *different*
    // source module, so it does NOT re-run, no `register` call
    // happens, and CardHost's remount-detection (which keys off
    // register-twice) doesn't fire. The framework bag is captured
    // by the HMR bridge but no restore replay is triggered.
    //
    // This ref bridges that gap. The mount-effect cleanup writes
    // `captureEditState(view)` here just before destroying the
    // view. The new mount-effect body reads from here and replays
    // through `restoreEditState`, then clears it. On a true
    // remount (cardId changes, cross-pane move) the component
    // instance is gone and so is this ref — the framework bag is
    // the source of truth on those paths, as it should be.
    //
    // This is NOT a sidecar cache competing with the framework bag.
    // It's strictly a substrate-local mechanism for "the substrate
    // remembers across its own effect re-run." The framework bag
    // pipeline (`useCardStatePreservation` ↔ CardHost ↔
    // deck-manager) remains the load-bearing path for every other
    // transition (cold-boot, cross-pane, beforeunload, hard
    // remount); both layers are complementary, with this ref
    // covering the one case the framework can't observe (because
    // its hooks live in a different source module than the one
    // Fast Refresh hot-replaced).
    const fastRefreshSnapshotRef = useRef<TugTextEditingState | null>(null);

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

    // Phase E.11 Step 2 — engine-hook registration channel (additive).
    //
    // Register `paintMirrorAsActive` / `paintMirrorAsInactive` hooks
    // with the deck-manager-store so Step 3's `applyBagFocus`
    // dispatcher can invoke them when `bag.focus.kind === "engine"`.
    // The hooks read `viewRef.current` live at fire time per [L07] —
    // identity-stable across re-renders and across CodeMirror's
    // StrictMode mount/cleanup/mount cycle.
    //
    // Registration runs in `useLayoutEffect` keyed on `[cardId]` so
    // it's complete before any framework event that could invoke
    // the hook fires ([L03]). When no `cardId` is present
    // (standalone use outside a `CardStatePreservationContext`), we
    // skip — the imperative-API surface above still allows ad-hoc
    // callers to drive `paintMirrorAsActive` directly.
    //
    // The store registration notifies Phase E.11 Step 4's late-mount
    // subscriber chain (`subscribeEngineHooksChange`) so CardHost's
    // cold-boot RESTORE effect re-fires when a late-mounting engine
    // (dev's editor after `feedsReady`) registers. This wiring
    // exists today but is dead at Step 2 (no consumer); Step 3 wires
    // the dispatcher to invoke through this channel.
    useLayoutEffect(() => {
      if (cardId === null) return;
      const store = getDeckStore();
      if (store === null) return;
      const unregister = store.registerEngineHooks(cardId, {
        paintMirrorAsActive: () => {
          const view = viewRef.current;
          if (view === null) return;
          deckTrace.record({
            kind: "engine-paint-mirror-active",
            cardId,
            caller: "via-engine-hook",
          });
          paintMirrorAsActiveImpl(view);
        },
        paintMirrorAsInactive: () => {
          const view = viewRef.current;
          if (view === null) return;
          deckTrace.record({
            kind: "engine-paint-mirror-inactive",
            cardId,
          });
          paintMirrorAsInactiveImpl(view, (range) => {
            selectionGuard.updateCardDomSelection(cardId, range);
          });
        },
      });
      return unregister;
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

    // Live attachment-store ref + error-callback ref. Drop and paste
    // extensions read these thunks at fire time so a late-arriving
    // store (or a host that swaps stores between cards) is picked up
    // without rebuilding the editor [L07]. The default `null` /
    // no-op keeps stand-alone harnesses, gallery cards, and other
    // non-bytes-store consumers running unchanged.
    const attachmentBytesStoreRef = useRef<AtomBytesStore | null>(
      attachmentBytesStore ?? null,
    );
    useLayoutEffect(() => {
      attachmentBytesStoreRef.current = attachmentBytesStore ?? null;
    }, [attachmentBytesStore]);

    const onAttachmentErrorRef = useRef<(message: string) => void>(
      onAttachmentError ?? (() => undefined),
    );
    useLayoutEffect(() => {
      onAttachmentErrorRef.current = onAttachmentError ?? (() => undefined);
    }, [onAttachmentError]);

    // Snapshot of host-supplied extensions captured at mount only;
    // reactivity inside the host extension itself must come through
    // refs read at fire time per [L07]. Stored in a ref so the StrictMode
    // re-mount path reads the same value even though the closure
    // would otherwise be stale.
    const extensionsRef = useRef<readonly Extension[]>(
      extensionsProp === undefined
        ? []
        : Array.isArray(extensionsProp)
          ? (extensionsProp as readonly Extension[])
          : [extensionsProp as Extension],
    );

    // Snapshot refs for Compartment-wrapped extensions. The mount
    // effect (empty-deps) reads these refs to seed initial values into
    // `buildExtensions`. Subsequent prop changes flow through the
    // matching reconfigure effects below — the refs aren't read again
    // after mount, but they're convenient for the mount path because
    // React 19 StrictMode runs mount → cleanup → mount in dev and the
    // re-mount needs the latest values, not the values from the
    // closure that was captured at first mount [L07].
    const placeholderRef = useRef(placeholder);
    const lineWrapRef = useRef(lineWrap);
    const lineNumbersRef = useRef(lineNumbersProp);
    const highlightActiveLineGutterRef = useRef(highlightActiveLineGutterProp);
    const disabledRef = useRef(disabled);
    useLayoutEffect(() => {
      placeholderRef.current = placeholder;
    }, [placeholder]);
    useLayoutEffect(() => {
      lineWrapRef.current = lineWrap;
    }, [lineWrap]);
    useLayoutEffect(() => {
      lineNumbersRef.current = lineNumbersProp;
    }, [lineNumbersProp]);
    useLayoutEffect(() => {
      highlightActiveLineGutterRef.current = highlightActiveLineGutterProp;
    }, [highlightActiveLineGutterProp]);
    useLayoutEffect(() => {
      disabledRef.current = disabled;
    }, [disabled]);

    // Reconfigure each Compartment-wrapped extension on prop change.
    // CM6's `compartment.reconfigure(next)` swaps the extension in
    // place — no view rebuild, no document loss, no selection loss.
    // Each effect is independent so a placeholder change doesn't
    // touch the line-wrap state and vice-versa.
    useLayoutEffect(() => {
      const view = viewRef.current;
      if (view === null) return;
      view.dispatch({
        effects: placeholderCompartment.reconfigure(
          placeholder !== "" ? cmPlaceholder(placeholder) : [],
        ),
      });
    }, [placeholder]);
    // `lineWrap` and `lineNumbers` are *structural* prop changes
    // that move the rendered geometry: turning either on or off
    // changes per-line wrap counts (lineWrap) or contentDOM
    // width (lineNumbers, because the gutter takes space from
    // the scroller). Reconfiguring the compartment alone isn't
    // enough — CM6's heightMap caches per-line measurements
    // against the *previous* geometry, so the freshly-built
    // gutter (or the next render after a wrap toggle) reads
    // stale row heights until the next user-input transaction
    // refreshes the cache.
    //
    // Bundling the typography-rev reconfigure into the same
    // dispatch piggybacks the bridge ([typographyRevCompartment])
    // so CM6's `mustMeasureContent` flag flips as part of the
    // same update cycle. The measure pass on the next animation
    // frame refreshes the heightOracle from the now-current
    // computed styles → heightMap rebuilds → the new gutter
    // plugin (or the post-wrap-toggle layout) renders against
    // the fresh metrics. Same RAF, no stale frame.
    useLayoutEffect(() => {
      const view = viewRef.current;
      if (view === null) return;
      view.dispatch({
        effects: [
          lineWrapCompartment.reconfigure(
            lineWrap ? EditorView.lineWrapping : [],
          ),
          typographyRevCompartment.reconfigure(EditorView.theme({})),
        ],
      });
    }, [lineWrap]);
    useLayoutEffect(() => {
      const view = viewRef.current;
      if (view === null) return;
      view.dispatch({
        effects: [
          lineNumbersCompartment.reconfigure(
            lineNumbersProp ? tugLineNumbersGutter : [],
          ),
          typographyRevCompartment.reconfigure(EditorView.theme({})),
        ],
      });
    }, [lineNumbersProp]);
    // Active-line gutter highlight is a pure-appearance toggle
    // (CM6 adds / removes the `cm-activeLineGutter` class on the
    // gutter cell whose line block contains the cursor). It
    // doesn't affect geometry, so no typography-rev piggyback is
    // needed — a plain compartment reconfigure is sufficient.
    useLayoutEffect(() => {
      const view = viewRef.current;
      if (view === null) return;
      view.dispatch({
        effects: activeLineGutterCompartment.reconfigure(
          highlightActiveLineGutterProp ? highlightActiveLineGutter() : [],
        ),
      });
    }, [highlightActiveLineGutterProp]);
    useLayoutEffect(() => {
      const view = viewRef.current;
      if (view === null) return;
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          EditorState.readOnly.of(disabled),
        ),
      });
    }, [disabled]);

    // Typography prop changes flow through inline CSS variables on
    // the host wrapper (see `hostStyle` below) — the new values
    // cascade into `.cm-content` and `.cm-gutters` immediately. CM6
    // doesn't observe CSS-variable changes, though: its
    // `heightOracle` caches the measured `font-size` /
    // `line-height` / `char-width` from the last layout pass, and
    // the line-number gutter's per-row heights are part of an
    // internal `RangeSet` that's rebuilt only when an extension
    // reconfigure or a non-empty transaction lands. A
    // CSS-variable-only change leaves both stale — the content
    // re-flows (because plain CSS) but the gutter rows hold their
    // pre-change heights until a transaction fires.
    //
    // Empirically, neither `view.requestMeasure()` nor
    // `view.dispatch({})` (an empty no-op transaction) triggers
    // the gutter's `RangeSet` rebuild — both leave the gutter
    // visibly stale. The reliable hammer is reconfiguring the
    // `lineNumbersCompartment` with its current value: passing
    // the *same* extension instance still forces a compartment
    // swap, which CM6 treats as a structural reconfigure and runs
    // the full update cycle including gutter regeneration. We
    // pair it with `requestMeasure` so any geometry not covered
    // by the reconfigure (e.g. the scroller's height cache) also
    // refreshes on the same frame.
    //
    // The reconfigure is harmless when `lineNumbersProp` is false
    // — it swaps `[]` for `[]` — but it always forces the cycle
    // we need. Heavier than the no-op transaction but the
    // correctness benefit is decisive: gutter rebuilds within one
    // animation frame of the prop change, with no click-to-type
    // required (verified by `at0050`).
    useLayoutEffect(() => {
      const view = viewRef.current;
      if (view === null) return;
      // Bridge typography prop changes (CSS-variable-driven —
      // the browser re-flows automatically) into CM6's
      // `mustMeasureContent` flag — its invalidation primitive,
      // the only thing that tells the next measure pass to
      // re-read computed styles into the `heightOracle`. Without
      // this dispatch, CM6 holds its pre-change cached
      // line-height (and the gutter row heights derived from
      // it) until the next "real" trigger lands — typing,
      // scroll, ResizeObserver. Symptom: the user changes the
      // `lineHeight` prop, the content re-flows immediately,
      // the gutter waits.
      //
      // Mechanism: reconfigure `typographyRevCompartment` to
      // contribute a freshly-built `EditorView.theme({})`. Each
      // call mints a new style-module prefix via
      // `StyleModule.newName()` so the `theme` facet's resolved
      // value differs by reference between transactions. CM6's
      // `view.update` flips the flag in exactly that case:
      //
      //     if (update.startState.facet(theme) != update.state.facet(theme))
      //       this.viewState.mustMeasureContent = true;
      //
      // (`@codemirror/view/dist/index.js`, ~line 7962). The flag
      // flips → next measure pass enters `oracle.refresh(...)`
      // against the now-current computed line-height → the
      // heightMap rebuilds → the gutter plugin picks up the
      // fresh row heights on the post-measure update. End-to-end
      // within one animation frame of the prop change.
      view.dispatch({
        effects: typographyRevCompartment.reconfigure(
          EditorView.theme({}),
        ),
      });
    }, [fontFamily, fontSize, lineHeight, letterSpacing]);

    // Live keymap config. The extension's keydown handler reads
    // `keymapConfigRef.current` via the thunk passed to
    // `tugTextEditorKeymap`, so prop changes take effect on the next
    // keystroke without rebuilding any extension. Initialised with
    // a no-op submit; the layout-effect below installs the real
    // values before any user input can land [L03, L07].
    // Default-button defer: when the responder chain has a button
    // pushed (typically a dialog's primary action), a `submit` Enter
    // inside the editor activates that button instead of the
    // editor's own onSubmit. Reads through a closure over the live
    // manager so a dialog mounted later than the editor still wins.
    const peekDefaultButton = useCallback((): HTMLButtonElement | null => {
      const manager = responderChainManager;
      if (!manager) return null;
      // Pane-scope the defer. The default-button stack is process-global,
      // but a `Return` in THIS editor must only defer to a default button
      // in THIS editor's own pane — never one registered by a sheet in
      // another pane (e.g. an unbound card's picker Open button). Otherwise
      // a `Return` here would press that other pane's button, dismissing
      // its sheet ([D15] pane modality). Resolve the editor's `.tug-pane`
      // and scope the peek to it; with no pane context (gallery /
      // standalone) fall back to the global top.
      const pane = viewRef.current?.dom.closest(".tug-pane") ?? null;
      return pane !== null
        ? manager.peekDefaultButtonInScope(pane)
        : manager.peekDefaultButton();
    }, [responderChainManager]);
    const keymapConfigRef = useRef<TugTextEditorKeymapConfig>({
      returnAction,
      numpadEnterAction,
      onSubmit: noopSubmit,
      historyProvider: null,
      peekDefaultButton,
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
        peekDefaultButton,
      };
    }, [returnAction, numpadEnterAction, onSubmit, historyProvider, peekDefaultButton]);

    // Expose the imperative delegate. The closure reads `viewRef.current`
    // at call time so consumers see the live view across StrictMode's
    // mount/unmount/mount cycle [L07].
    useImperativeHandle(ref, () => ({
      view() {
        return viewRef.current;
      },
      acceptActiveCompletion(): boolean {
        const view = viewRef.current;
        if (view === null) return false;
        const state = getCompletionState(view);
        if (
          !completionPopupIsInteractive({
            active: state.active,
            itemCount: state.filtered.length,
          })
        ) {
          return false;
        }
        acceptCompletionAt(view);
        return true;
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
        // Route focus through the chain primitive when available:
        // `manager.focusResponder(responderId)` promotes the editor
        // to first responder AND invokes the responder's registered
        // `focus` callback (line below in `useOptionalResponder`),
        // which lands DOM focus on `viewRef.current?.focus()`. Going
        // through the chain keeps first-responder state in sync with
        // DOM focus, runs the focus-theft gate, and emits a chain
        // log for the transition — none of which a direct
        // `view.focus()` call would do. [L11]
        //
        // Fallback to direct `view.focus()` outside a
        // `ResponderChainProvider` (standalone harness, unit tests)
        // where the manager is null — same behavior the editor had
        // before this delegate routed through the chain.
        if (responderChainManager !== null) {
          responderChainManager.focusResponder(responderId);
          return;
        }
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
        const id = cardIdRef.current;
        if (id !== null) {
          deckTrace.record({
            kind: "engine-paint-mirror-active",
            cardId: id,
            caller: "imperative-api",
          });
        }
        paintMirrorAsActiveImpl(view, state);
      },
      paintMirrorAsInactive(
        publish: (range: Range | null) => void,
        state?: TugTextEditingState,
      ) {
        const view = viewRef.current;
        if (view === null) return;
        const id = cardIdRef.current;
        if (id !== null) {
          deckTrace.record({
            kind: "engine-paint-mirror-inactive",
            cardId: id,
          });
        }
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

    // The CM6 adapter is held in a ref so the surface listeners and
    // the responder-action handlers all read the same instance. The
    // adapter closes over `viewRef.current` at construction; we
    // refresh it whenever the view identity changes (substrate
    // remount, view recreation).
    const cmAdapterRef = useRef<TextSelectionAdapter | null>(null);
    useLayoutEffect(() => {
      cmAdapterRef.current = view !== null ? createCMSelectionAdapter(view) : null;
      // Test-only: expose the EditorView on its contentDOM so app-tests can seed
      // text + selection via a transaction. Native keystrokes don't land in an
      // unattended (non-key-window) test run, so JS seeding is the only reliable
      // path; gated on `__tugTestMode` so it never ships to normal builds.
      if (
        view !== null &&
        typeof window !== "undefined" &&
        (window as Window & { __tugTestMode?: boolean }).__tugTestMode === true
      ) {
        (view.contentDOM as unknown as { __tugEditorView?: EditorView }).__tugEditorView = view;
      }
    }, [view]);

    const {
      onPointerDown: onContextMenuPointerDown,
      onContextMenu: onContextMenuOpen,
      menu: contextMenu,
    } = useTextSurfaceContextMenu({
      adapter: cmAdapterRef.current,
      capabilities: { canEdit: true },
    });

    // Attach the hook's listeners only when the click lands inside the
    // editor's own contentDOM — clicks on host padding fall through to
    // the browser's native menu, matching the legacy behavior. The
    // listeners themselves are stable (returned by the hook); this
    // effect handles the wiring + the contentDOM-membership gate.
    useLayoutEffect(() => {
      const host = hostRef.current;
      if (host === null) return;
      const handlePointerDown = (e: PointerEvent) => {
        const v = viewRef.current;
        if (v === null) return;
        if (!v.dom.contains(e.target as Node)) return;
        onContextMenuPointerDown(e);
      };
      const handleContextMenu = (e: MouseEvent) => {
        const v = viewRef.current;
        if (v === null) return;
        if (!v.dom.contains(e.target as Node)) return;
        onContextMenuOpen(e);
      };
      host.addEventListener("pointerdown", handlePointerDown);
      host.addEventListener("contextmenu", handleContextMenu);
      return () => {
        host.removeEventListener("pointerdown", handlePointerDown);
        host.removeEventListener("contextmenu", handleContextMenu);
      };
    }, [onContextMenuPointerDown, onContextMenuOpen]);

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
      // TEMP rclk probe ([#investigation]): the selection the copy actually reads.
      const sel = view.state.selection.main;
      tugDevLogStore.info("rclk", "CM6 handleCopy", {
        from: sel.from,
        to: sel.to,
        text: view.state.sliceDoc(sel.from, sel.to),
      });
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
    // copy (WebKit packs custom MIMEs into the undocumented
    // `com.apple.WebKit.custom-pasteboard-data` archive blob,
    // invisible to NSPasteboard.string-typed reads). The atom data
    // rides along inside a `<span data-tug-atoms="…">` envelope on
    // `text/html` instead — `parseClipboardHtmlEnvelope` extracts and
    // base64-decodes it. When no envelope is present, fall through to
    // inserting `text` verbatim (label-substituted from external apps,
    // or the substrate's own copy on clipboards where the html got
    // stripped en route).
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
            const sidecar = parseClipboardHtmlEnvelope(html);
            if (sidecar !== null) {
              const placedAtoms = sidecar.atoms.map((a) => ({
                position: from + a.position,
                segment: a.segment,
              }));
              live.dispatch({
                changes: { from, to, insert: sidecar.text },
                effects: placedAtoms.length > 0
                  ? addAtomsEffect.of(placedAtoms)
                  : [],
                selection: { anchor: from + sidecar.text.length },
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

    // ---- Editing motion / deletion ----
    //
    // The four gap-fill actions (Ctrl-U / Ctrl-W / Alt-F / Alt-B)
    // are handled at the keymap layer in `tug-text-editor/keymap.ts`
    // for the keyboard path, where Shift extends selection idiomatically
    // via CM6's `shift:` slot. These responder handlers cover the chain
    // dispatch path — a future settings UI / menu invokes the same CM6
    // commands programmatically. Chain dispatch carries no native event,
    // so motion never extends selection from this path (per [DM05]; the
    // collapsed `cursorGroupForward` / `cursorGroupBackward` are used).
    // The CM6 commands push onto the editor's own `history()` stack, so
    // Cmd-Z reverts the deletions naturally per [DM04].
    const handleDeleteToLineStart = useCallback((): ActionHandlerResult => {
      const view = viewRef.current;
      if (view === null) return;
      view.focus();
      deleteLineBoundaryBackward(view);
    }, []);

    const handleDeleteWordBackward = useCallback((): ActionHandlerResult => {
      const view = viewRef.current;
      if (view === null) return;
      view.focus();
      deleteGroupBackward(view);
    }, []);

    const handleMoveWordForward = useCallback((): ActionHandlerResult => {
      const view = viewRef.current;
      if (view === null) return;
      view.focus();
      cursorGroupForward(view);
    }, []);

    const handleMoveWordBackward = useCallback((): ActionHandlerResult => {
      const view = viewRef.current;
      if (view === null) return;
      view.focus();
      cursorGroupBackward(view);
    }, []);

    // `responderId` is declared near the top of the component
    // (next to `viewRef`) so `useImperativeHandle`'s focus closure
    // can reference it; the registration here uses the same id.
    const actions: Partial<Record<TugAction, ActionHandler>> = {
      [TUG_ACTIONS.SELECT_ALL]: handleSelectAll,
      [TUG_ACTIONS.UNDO]: handleUndo,
      [TUG_ACTIONS.REDO]: handleRedo,
      [TUG_ACTIONS.COPY]: handleCopy,
      [TUG_ACTIONS.CUT]: handleCut,
      [TUG_ACTIONS.PASTE]: handlePaste,
      [TUG_ACTIONS.SUBMIT]: handleSubmit,
      // ---- Editing motion / deletion ----
      [TUG_ACTIONS.DELETE_TO_LINE_START]: handleDeleteToLineStart,
      [TUG_ACTIONS.DELETE_WORD_BACKWARD]: handleDeleteWordBackward,
      [TUG_ACTIONS.MOVE_WORD_FORWARD]: handleMoveWordForward,
      [TUG_ACTIONS.MOVE_WORD_BACKWARD]: handleMoveWordBackward,
    };
    const { responderRef, ResponderScope } = useOptionalResponder({
      id: responderId,
      actions,
      // Substrate-supplied focus callback per
      // `tugplan-dev-popup-bindings.md` [D03] (#focus-contract).
      // `manager.focusResponder(responderId)` invokes this AFTER
      // promoting us to first responder; we land DOM focus on the
      // CodeMirror view's contentDOM via `view.focus()`. The DOM-walk
      // fallback inside `focusResponder` cannot do this correctly:
      // CM6's contenteditable host is not a standard tabbable element
      // and the responder element (the wrapper host div carrying
      // `data-responder-id`) is not the focus target — querying for
      // tabbable descendants would land on a child input or button
      // depending on what's mounted, not on the contentDOM.
      //
      // Reading `viewRef.current` (not the `view` state) means we
      // always invoke `focus()` on the live view, even if the
      // EditorView was rebuilt between registration and invocation
      // (Fast Refresh re-mount, StrictMode double-mount). The captured
      // closure holds the stable ref object [L07]; the live view is
      // read at invocation time. The `?.` no-ops cleanly if the view
      // hasn't mounted yet (registration runs before the EditorView's
      // mount effect on the first render); subsequent invocations
      // observe the view that the mount effect installs.
      focus: () => viewRef.current?.focus(),
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

      // Read the latest prop snapshot for the Compartment-wrapped
      // extensions. The mount effect runs once per StrictMode pass and
      // captures these values; subsequent prop changes flow through
      // the dedicated `useLayoutEffect` reconfigure passes below.
      const initialPlaceholder = placeholderRef.current;
      const initialLineWrap = lineWrapRef.current;
      const initialLineNumbers = lineNumbersRef.current;
      const initialHighlightActiveLineGutter = highlightActiveLineGutterRef.current;
      const initialDisabled = disabledRef.current;

      const state = EditorState.create({
        doc: "",
        extensions: buildExtensions(
          host,
          () => keymapConfigRef.current,
          () => completionProvidersRef.current,
          () => dropHandlerRef.current,
          () => attachmentBytesStoreRef.current,
          (message) => onAttachmentErrorRef.current(message),
          {
            placeholder: initialPlaceholder,
            lineWrap: initialLineWrap,
            lineNumbers: initialLineNumbers,
            highlightActiveLineGutter: initialHighlightActiveLineGutter,
            disabled: initialDisabled,
          },
          extensionsRef.current,
        ),
      });
      const view = new EditorView({
        state,
        parent: host,
      });
      viewRef.current = view;
      // Promote the view to React state so the sibling
      // <CompletionOverlay /> can mount and subscribe. The state
      // change runs in the same commit as the mount effect; the
      // overlay's own useLayoutEffect runs on the subsequent commit
      // with the live view.
      setView(view);

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

      // Typeahead popup wiring lives in <CompletionOverlay /> below.
      // The overlay subscribes to subscribeCompletionState(view, ...)
      // in its own useLayoutEffect once `view` (this state) becomes
      // non-null, and owns the popup DOM under a portal into
      // <CanvasOverlayRoot />. The host element here no longer
      // contains the popup div.

      // Emit `engine-ready` for harness tests that gate on the
      // EditorView being constructed inside this card. Mirrors the
      // matching emit site in `tug-prompt-input.tsx`. The cardId is
      // read from the ref so a stand-alone TugTextEditor (no enclosing
      // CardHost) is silent — there's no card to associate the
      // event with.
      const readyCardId = cardIdRef.current;
      if (readyCardId !== null) {
        deckTrace.record({
          kind: "engine-ready",
          cardId: readyCardId,
          engine: "tug-text-editor",
        });
      }

      // Replay any onRestore payload that fired before this mount
      // effect ran. React fires child effects before parent
      // effects, so the `TugTextEditorStatePreservation` child's
      // registration may have dispatched onRestore one tick before
      // the EditorView was constructed. The hook stashed the
      // payload on `pendingRestoreRef`; we apply it now through
      // the appropriate channel, then clear the ref. [L23].
      //
      // Phase E.11 Step 4h — for the `isActive` branch, the replay
      // is `restoreEditState` ONLY. The framework's `applyBagFocus`
      // dispatcher (via CardHost's late-mount retry on
      // `subscribeEngineHooksChange`) owns the focus claim; the
      // engine no longer auto-paints itself active in replay.
      // `restoreEditState` is engine-internal state restore
      // (document content, atoms, selection, scroll) — a different
      // axis from the focus claim — and stays. For the inactive
      // branch, `paintMirrorAsInactive` continues to publish the
      // selection range through `selectionGuard`, which is also a
      // non-focus axis.
      const pending = pendingRestoreRef.current;
      if (pending !== null) {
        const { state: bufferedState, isActive } = pending;
        restoreEditState(view, bufferedState);
        const replayId = cardIdRef.current;
        if (isActive) {
          // Engine focus claim deferred to the framework's
          // `applyBagFocus` retry path. No autonomous paint here.
          void replayId;
        } else {
          if (replayId !== null) {
            deckTrace.record({
              kind: "engine-paint-mirror-inactive",
              cardId: replayId,
            });
          }
          paintMirrorAsInactiveImpl(view, (range) => {
            const id = cardIdRef.current;
            if (id !== null) {
              selectionGuard.updateCardDomSelection(id, range);
            }
          }, bufferedState);
        }
        pendingRestoreRef.current = null;
      } else if (fastRefreshSnapshotRef.current !== null) {
        // No framework-driven restore is pending, but our own
        // mount-effect cleanup just ran (Fast Refresh same-instance
        // effect re-run pattern) and stashed the live state. Replay
        // it through `restoreEditState` — same path the framework's
        // `onRestore` would use, just sourced from our local ref
        // instead of `bag.content`.
        //
        // The cardId-stable framework path skips this branch
        // because `pendingRestoreRef` would have been populated by
        // CardHost's onRestore dispatch on a true remount; it isn't
        // populated here precisely BECAUSE the framework couldn't
        // see this transition (Fast Refresh's effect re-run within
        // a preserved component instance).
        const snapshot = fastRefreshSnapshotRef.current;
        restoreEditState(view, snapshot);
        fastRefreshSnapshotRef.current = null;
      }

      return () => {
        // Capture the live state before destroying the view, so a
        // Fast Refresh same-instance effect re-run can replay it on
        // the next mount-effect body fire. See the
        // `fastRefreshSnapshotRef` declaration above for why this
        // path exists.
        //
        // Guarded on `view.contentDOM.isConnected` so we only
        // capture when there is actually a live DOM-attached view
        // (StrictMode mount → unmount → mount in dev, for example,
        // tears down the view between the two mounts; the second
        // mount would observe the snapshot from the first cleanup
        // and replay an empty-document state, which is a no-op).
        if (view.contentDOM.isConnected) {
          try {
            fastRefreshSnapshotRef.current = captureEditState(view);
          } catch {
            // Capture is best-effort; if anything goes wrong, fall
            // through to the framework bag path on the next true
            // remount.
            fastRefreshSnapshotRef.current = null;
          }
        }
        // Drop the card's last-published Range from selectionGuard
        // so the inactive-selection highlight doesn't linger over
        // DOM nodes that are about to unmount. Mirrors the
        // `tug-prompt-input` cleanup. [L23].
        const id = cardIdRef.current;
        if (id !== null) {
          selectionGuard.updateCardDomSelection(id, null);
        }
        unsubscribeThemeChange(onThemeChange);
        view.destroy();
        viewRef.current = null;
        // Clear the React state so <CompletionOverlay /> unmounts
        // its portal in the next commit and any internal subscription
        // is torn down via its effect cleanup.
        setView(null);
      };
    }, []);

    // Host inline style: caller-supplied `style` flows through first,
    // then we layer the substrate-managed CSS variables on top so prop
    // values win over a generic `style` object. `--tug-text-editor-max-rows`
    // is unitless (consumed by `calc(... * 1lh)` in the CSS); the
    // typography variables fall through verbatim so callers can pass
    // any valid CSS value. Each variable is conditionally set so an
    // omitted prop leaves the existing token cascade intact.
    //
    // `--tug-text-editor-atom-height` is always set: it's the row-height
    // floor used by the theme's `.cm-line::before { height: max(1lh, …) }`
    // rule so lines are tall enough to host an atom widget regardless
    // of the configured `lineHeight`. The value comes from
    // `getAtomHeightPx()` which tracks the atom widget's own
    // `_fontSize` × 1.75 sizing in `tug-atom-img.ts`. Always-set rather
    // than conditional because a missing variable would let the theme's
    // `max()` collapse to `1lh` (no floor) and atoms would re-introduce
    // the line-hop the floor is meant to prevent.
    const hostStyle = useMemo<React.CSSProperties>(() => {
      const next: Record<string, string | number> = {};
      if (styleProp !== undefined) {
        Object.assign(next, styleProp);
      }
      next["--tug-text-editor-max-rows"] = maxRows;
      next["--tug-text-editor-atom-height"] = `${getAtomHeightPx()}px`;
      if (fontFamily !== undefined) {
        next["--tug-font-family-editor"] = fontFamily;
      }
      if (fontSize !== undefined) {
        next["--tug-font-size-editor"] = fontSize;
      }
      if (lineHeight !== undefined) {
        next["--tug-line-height-editor"] =
          typeof lineHeight === "number" ? String(lineHeight) : lineHeight;
      }
      if (letterSpacing !== undefined) {
        next["--tug-letter-spacing-editor"] = letterSpacing;
      }
      return next as React.CSSProperties;
    }, [styleProp, maxRows, fontFamily, fontSize, lineHeight, letterSpacing]);

    return (
      <ResponderScope>
        <div
          ref={composedHostRef}
          data-slot="tug-text-editor"
          data-focus-style={focusStyle}
          data-borderless={borderless ? "" : undefined}
          data-disabled={disabled ? "" : undefined}
          data-maximized={maximized ? "" : undefined}
          data-grow-direction={growDirection}
          aria-disabled={disabled || undefined}
          className={cn("tug-text-editor", className)}
          style={hostStyle}
          {...rest}
        >
          {/* Right-click context menu. Conditionally rendered so the
              menu component only enters the React tree when actually
              open — keeping its `useRequiredResponderChain` hook off
              the path for stand-alone harnesses (storybook, unit
              tests) that mount `TugTextEditor` outside a
              `ResponderChainProvider` and never open the menu. The
              menu's own internal positioning runs via
              `useLayoutEffect` + DOM writes inside the menu, so the
              only React state involved here is the open lifecycle
              ([L06]). Items dispatch through the responder chain
              ([L11]); the substrate's responder is registered on
              this host so item activations land in the same
              handlers as the keyboard shortcuts. */}
          {contextMenu}
        </div>
        {/* Typeahead overlay. Renders `null` until the view is born;
            once `view` is non-null, mounts a portal into
            <CanvasOverlayRoot /> via `useCanvasOverlay` (or
            document.body fallback if no overlay root is registered
            — e.g., standalone harness). Owns the popup DOM, the
            paint subscription, the `onTypeaheadChange` host-callback
            relay, and a ResizeObserver that re-anchors on host
            bounds change (sash drags). [D01, D02, D03, D07]. */}
        {view !== null && (
          <CompletionOverlay
            view={view}
            hostRef={hostRef}
            onTypeaheadChangeRef={onTypeaheadChangeRef}
            completionDirectionRef={completionDirectionRef}
          />
        )}
        {/* State-preservation registration. Conditional on
            `preserveState` so stand-alone harnesses (storybook,
            unit tests) can opt out. Renders `null` (no DOM); the
            hook is the work — registers `onSave` / `onRestore` /
            `onCardActivated` / `onCardWillDeactivate` with the
            enclosing `CardHost` via `useCardStatePreservation`.
            [L23], [L03]. */}
        {preserveState && (
          <TugTextEditorStatePreservation
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
// Completion overlay (portaled popup shell)
// ---------------------------------------------------------------------------

interface CompletionOverlayProps {
  /** Live `EditorView`. Pre-conditioned on non-null at the call site. */
  view: EditorView;
  /** The editor's host `<div>` ref. Observed by ResizeObserver to re-anchor on host bounds change (sash drag, pane resize). */
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** Live ref to the optional `onTypeaheadChange` callback prop. */
  onTypeaheadChangeRef: React.RefObject<TugTextEditorProps["onTypeaheadChange"]>;
  /** Live ref to the preferred-direction prop. */
  completionDirectionRef: React.RefObject<"up" | "down">;
}

/**
 * `CompletionOverlay` — portaled shell for the typeahead popup.
 *
 * Renders one `<div data-slot="tug-completion-menu">` into
 * `<CanvasOverlayRoot />` via `createPortal` (or `document.body` as
 * fallback when no root is registered, per [D02]). The popup `<div>`
 * is `position: fixed` and `z-index: var(--tug-z-overlay-popup)` so
 * it escapes every pane's `overflow: hidden` and sits visually above
 * the entire pane tree.
 *
 * The popup `<div>` exists in the DOM whenever this component is
 * mounted (i.e., whenever the parent editor has a live view). The
 * painter writes `display: none` when typeahead is inactive and
 * `display: block` when active. We do not conditionally mount the
 * portal on the active boolean because:
 *   - The popup div is DOM-cheap (one empty element).
 *   - Always-mounted means a stable popup ref for the painter; no
 *     gap between "view ready" and "popup div ready" the painter has
 *     to coordinate around.
 *   - Toggling display is what the today's painter already does on
 *     state change; the migration preserves that semantics rather
 *     than introducing a new mount/unmount path.
 *
 * ## Subscriptions
 *
 * Three subscribers, all wired in this component's `useLayoutEffect`:
 *
 *   1. **Paint subscriber** — direct `subscribeCompletionState(view, …)`
 *      callback that runs `paintCompletionPopup(view, popup, direction)`
 *      and forwards to `onTypeaheadChangeRef.current`. Appearance-zone
 *      writes; per [L22] this is direct-DOM, never round-tripped
 *      through React state.
 *
 *   2. **ResizeObserver re-anchor + pane-collapse cancel** — observes
 *      the editor host element. On every observed resize:
 *        - if the host has collapsed to zero size (`offsetHeight === 0`
 *          or `offsetWidth === 0`), the holding pane has collapsed —
 *          dispatch `cancelCompletion(view)` and skip the re-anchor
 *          (no anchor exists when the editor is unrendered);
 *        - otherwise, fire the painter so the popup re-anchors.
 *      Catches sash-drag / pane-resize cases that don't fire window
 *      events and the pane-collapse path that would otherwise leave
 *      the popup orphaned. ([D06] pane-collapse fold-in.)
 *
 *   3. **Companion focus binding** — `useCompanionPopupBinding({
 *      ownerEl: view.contentDOM, onShouldDismiss: () =>
 *      cancelCompletion(view) })`. Observes DOM focus on the editor's
 *      contentDOM. When focus leaves the contentDOM subtree (Radix
 *      mounts a sibling popup and `FocusScope.onMountAutoFocus`
 *      grabs focus into it; the user clicks outside the editor; a
 *      peer card is activated and focus moves to it), dispatches
 *      `cancelCompletion(view)`. Per `tugplan-dev-popup-bindings.md`
 *      [D05] (#companion-binding), this signal strict-supersets the
 *      former `cardDidDeactivate` subscription: every dismissal the
 *      old signal triggered, the focus signal also triggers, AND the
 *      focus signal additionally catches the in-card service-popup
 *      case (the "image 5" font-picker bug) that the old signal
 *      missed. The previous deck-manager / `cardDidDeactivate` /
 *      `useCardId` plumbing for this concern is gone.
 *
 * The component itself reads no React state and renders no React
 * children apart from the portaled wrapper — it is structure-zone
 * housekeeping (which DOM exists where) plus the appearance-zone
 * subscribers.
 *
 * Laws: [L02] state observation goes through the per-view subscriber
 *        set the completion-extension already exposes (no React state
 *        copy), [L03] subscriptions and observers register in
 *        `useLayoutEffect` before any user gesture can fire, [L06]
 *        popup body and position are direct DOM writes, [L07] the
 *        `onTypeaheadChange` prop and `direction` prop are read via
 *        refs so a re-render with new identities doesn't re-subscribe,
 *        [L11] `pointerdown` + `acceptCompletionAt` is substrate-internal
 *        (verified across portal detachment in tests/app-test/at0051,
 *        recorded in [D08]), [L22] high-frequency repaints are
 *        direct-DOM not React-state, [L23] typeahead state lives in
 *        CM6's `StateField` and survives this migration trivially.
 */
function CompletionOverlay({
  view,
  hostRef,
  onTypeaheadChangeRef,
  completionDirectionRef,
}: CompletionOverlayProps): React.ReactElement {
  const overlayRoot = useCanvasOverlay();
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Companion focus binding per `tugplan-dev-popup-bindings.md` [D05]
  // (#companion-binding). The hook observes DOM focus on the editor's
  // contentDOM and dispatches `cancelCompletion(view)` when focus
  // leaves the subtree — strict-supersets the former
  // `observeCardDidDeactivate` subscription per [L23] and additionally
  // catches the in-card service-popup case (image 5 bug). The hook is
  // tolerant of `view.contentDOM` not being attached yet (no-op until
  // a non-null element is supplied). Listeners install at the document
  // level in `useLayoutEffect` per [L03], ride past in-subtree focus
  // transitions via a microtask defer, and tear down on unmount.
  useCompanionPopupBinding({
    ownerEl: view.contentDOM,
    onShouldDismiss: () => cancelCompletion(view),
  });

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (popup === null) return;

    // Initial paint: covers the case where the typeahead state was
    // already active when this overlay mounted (e.g., a state
    // restoration that landed an active session in the field).
    paintCompletionPopup(view, popup, completionDirectionRef.current);

    // Paint subscriber — fires on every typeahead-state change.
    // The completion-extension's per-view subscriber set is exactly
    // the right granularity: state changes only flip the snapshot
    // identity on real changes (the field's `update` reducer
    // returns `value` unchanged for non-events), so we only repaint
    // when something actually changed.
    // Advertise Tab-consumption to the focus engine: while the typeahead popup
    // is interactive, the editor owns Tab (it accepts the completion) and the
    // document-level focus walk must yield to it. The marker rides on the
    // contentDOM (the active element while editing), so the Tab pipeline's
    // `closest([data-tug-tab-consume])` check sees it. Appearance-zone DOM
    // write per [L06] — never React state.
    const applyTabConsumeMarker = (): void => {
      const snap = getCompletionState(view);
      const interactive = completionPopupIsInteractive({
        active: snap.active,
        itemCount: snap.filtered.length,
      });
      // Explicit "true"/absent (not toggleAttribute, which sets an empty
      // value) so the marker matches the `[data-tug-tab-consume="true"]`
      // selector the focus-walk pipeline reads.
      if (interactive) {
        view.contentDOM.setAttribute(TAB_CONSUME_ATTRIBUTE, "true");
      } else {
        view.contentDOM.removeAttribute(TAB_CONSUME_ATTRIBUTE);
      }
    };
    applyTabConsumeMarker();

    const unsubscribe = subscribeCompletionState(view, () => {
      paintCompletionPopup(view, popup, completionDirectionRef.current);
      const snap = getCompletionState(view);
      applyTabConsumeMarker();
      onTypeaheadChangeRef.current?.(
        snap.active,
        snap.filtered,
        snap.selectedIndex,
      );
    });

    // ResizeObserver re-anchor + pane-collapse cancel. Pane sash drags
    // do NOT fire window resize/scroll, but they DO change the editor
    // host's bounding rect. Without this, the popup goes stale at its
    // last computed viewport coords. The observer also handles full
    // window resize (the host's rect changes when the viewport does).
    // Coalescing is built into ResizeObserver — no manual rAF/throttle
    // needed unless profiling shows jank.
    //
    // Pane-collapse branch ([D06] fold-in): when the holding pane
    // collapses, the host's `offsetHeight` (or `offsetWidth`) drops to
    // zero. Re-anchoring would dereference a null `coordsAtPos` against
    // an unrendered editor; cancel instead so the popup vanishes
    // alongside the editor. `cancelCompletion` is a no-op when the
    // typeahead session is inactive, so the cancel is safe to fire
    // on the initial observer notification.
    let resizeObserver: ResizeObserver | null = null;
    const host = hostRef.current;
    if (host !== null && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (host.offsetHeight === 0 || host.offsetWidth === 0) {
          cancelCompletion(view);
          return;
        }
        // Re-paint goes through the painter's own
        // `view.requestMeasure` so the read happens in the legal
        // layout-read phase. We do not re-paint if the popup is
        // hidden — the painter early-returns on inactive state.
        paintCompletionPopup(view, popup, completionDirectionRef.current);
      });
      resizeObserver.observe(host);
    }

    return () => {
      unsubscribe();
      resizeObserver?.disconnect();
      view.contentDOM.removeAttribute(TAB_CONSUME_ATTRIBUTE);
    };
    // `view` is the externally-changing input; the refs are stable
    // for the component's lifetime by construction. Re-running on
    // view change is correct (a new view means we must re-subscribe
    // against its plugin instance). The companion-focus binding is
    // hoisted into its own `useCompanionPopupBinding` call above and
    // owns its listener lifecycle independently of this effect.
  }, [view, hostRef, onTypeaheadChangeRef, completionDirectionRef]);

  // Render the popup div via portal. Always rendered while the
  // overlay is mounted; visibility is controlled by the painter.
  return createPortal(
    <div
      ref={popupRef}
      data-slot="tug-completion-menu"
      className="tug-completion-menu"
      style={{
        position: "fixed",
        // `pointer-events: auto` re-enables clicks on this child of
        // the canvas overlay root (which has `pointer-events: none`).
        pointerEvents: "auto",
        // Hidden by default; the painter writes `display: block` on
        // active typeahead state.
        display: "none",
      }}
    />,
    overlayRoot,
  );
}

// ---------------------------------------------------------------------------
// Completion popup painter
// ---------------------------------------------------------------------------

/** Padding between the trigger anchor and the popup. */
const POPUP_GAP = 4;

/** Inset from each viewport edge, so the popup never sits flush. */
const POPUP_VIEWPORT_MARGIN = 8;

/**
 * Pure position-math function. Inputs are viewport-relative; outputs
 * are viewport-relative `top` / `left` for `position: fixed`. Exported
 * for unit tests; the painter inlines the call inside CM6's measure
 * phase.
 *
 * Auto-flip rule:
 *   - `direction = "down"`: open downward iff the space below the
 *     anchor is at least the popup's height OR is at least as much
 *     as the space above.
 *   - `direction = "up"`: open upward iff the space above is at
 *     least the popup's height; otherwise fall back to whichever
 *     side has more room.
 *
 * Horizontal: clamp `anchorCoords.left` so the popup never spills off
 * the viewport. The popup's natural left edge is the trigger char's
 * left edge; the clamp bounds it to `[POPUP_VIEWPORT_MARGIN,
 * viewportWidth - popupWidth - POPUP_VIEWPORT_MARGIN]`.
 *
 * Returns `null` for `top`/`left` when the popup should hide
 * (`anchorCoords` is null — caller maps off-screen).
 */
export interface ComputeCompletionPositionInput {
  anchorCoords: { left: number; top: number; bottom: number } | null;
  popupWidth: number;
  popupHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  direction: "up" | "down";
}

export interface ComputeCompletionPositionOutput {
  /** Top edge in viewport coords, or `null` if anchorCoords was null. */
  top: number | null;
  /** Left edge in viewport coords, or `null` if anchorCoords was null. */
  left: number | null;
  /** Whether the popup opens downward (`true`) or upward (`false`). */
  opensDown: boolean;
}

export function computeCompletionPosition(
  input: ComputeCompletionPositionInput,
): ComputeCompletionPositionOutput {
  const {
    anchorCoords,
    popupWidth,
    popupHeight,
    viewportWidth,
    viewportHeight,
    direction,
  } = input;
  if (anchorCoords === null) {
    return { top: null, left: null, opensDown: direction === "down" };
  }
  // Horizontal clamp. If popup is wider than the viewport (degenerate
  // case), `min` will be greater than `max` after the subtraction;
  // clamp to `POPUP_VIEWPORT_MARGIN` in that case so the popup at
  // least starts at the safe-margin edge rather than off-screen.
  const minLeft = POPUP_VIEWPORT_MARGIN;
  const maxLeft = Math.max(
    POPUP_VIEWPORT_MARGIN,
    viewportWidth - popupWidth - POPUP_VIEWPORT_MARGIN,
  );
  const left = Math.max(minLeft, Math.min(anchorCoords.left, maxLeft));

  // Vertical: pick down vs. up based on the requested `direction`
  // hint plus available viewport space. `direction === "down"` is
  // the default for an editor whose prompt sits in the page's
  // bottom area (typeahead floats above the line); `direction ===
  // "up"` is for editors near the top.
  const spaceAbove = anchorCoords.top - POPUP_VIEWPORT_MARGIN;
  const spaceBelow = viewportHeight - anchorCoords.bottom - POPUP_VIEWPORT_MARGIN;
  const useDown =
    direction === "down"
      ? spaceBelow >= popupHeight || spaceBelow >= spaceAbove
      : spaceAbove < popupHeight && spaceBelow > spaceAbove;

  let top: number;
  if (useDown) {
    top = anchorCoords.bottom + POPUP_GAP;
  } else {
    top = anchorCoords.top - POPUP_GAP - popupHeight;
  }
  return { top, left, opensDown: useDown };
}

/**
 * Repaint the typeahead popup against `popup` (a `<div>` portaled to
 * the canvas overlay root). Called whenever the typeahead state
 * changes via the per-view subscription installed in
 * `CompletionOverlay`.
 *
 * Hides the popup when typeahead is inactive or the filtered list
 * is empty. Otherwise rebuilds the popup body if the items changed,
 * reuses existing DOM nodes when only the selected index moved, and
 * — via a deferred `view.requestMeasure` — positions the popup at
 * the trigger character using viewport-relative coords (the popup
 * is `position: fixed` inside the canvas overlay root).
 *
 * Why the deferred positioning: the painter may be called from a CM6
 * `ViewPlugin.update` listener, which fires DURING CM6's update
 * cycle. Calling `view.coordsAtPos` synchronously from there throws
 * "Reading the editor layout isn't allowed during an update" — CM6
 * catches the throw, logs it, and deactivates the plugin. Once the
 * plugin is deactivated, no further state changes are observed:
 * the popup gets stuck at its last position and stops responding to
 * keyboard navigation. Routing the read+write through
 * `requestMeasure` schedules them in CM6's regular measure phase
 * where layout reads are legal.
 */
function paintCompletionPopup(
  view: EditorView,
  popup: HTMLDivElement | null,
  direction: "up" | "down",
): void {
  if (popup === null) return;
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
        // Confirmed cross-portal-detachment in tests/app-test/at0051.
        e.preventDefault();
        acceptCompletionAt(view, i);
      });
      popup.appendChild(div);
    });
    const selectedEl = popup.children[state.selectedIndex] as HTMLElement | undefined;
    selectedEl?.scrollIntoView({ block: "nearest" });
  }

  // ---- Deferred positioning ----
  // Read coordsAtPos + popup width/height in the measure phase
  // (where layout reads are legal), then write the position styles
  // in the same phase's write step. The `key` field coalesces
  // multiple repaints in the same frame down to a single measurement.
  view.requestMeasure({
    key: "tug-text-editor-completion-position",
    read(): {
      anchorCoords: { left: number; top: number; bottom: number } | null;
      popupWidth: number;
      popupHeight: number;
    } | null {
      if (popup === null) return null;
      const anchorCoords = view.coordsAtPos(state.anchorOffset);
      return {
        anchorCoords,
        popupWidth: popup.offsetWidth,
        popupHeight: popup.offsetHeight,
      };
    },
    write(measured) {
      if (measured === null || popup === null) return;
      const { anchorCoords, popupWidth, popupHeight } = measured;
      const result = computeCompletionPosition({
        anchorCoords,
        popupWidth,
        popupHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        direction,
      });
      if (result.top === null || result.left === null) {
        popup.style.display = "none";
        return;
      }
      popup.style.left = `${result.left}px`;
      popup.style.top = `${result.top}px`;
      // `bottom` is unused in the viewport-relative model — clear any
      // stale value left from a prior in-host-positioned mount, even
      // though that path no longer exists.
      popup.style.right = "";
      popup.style.bottom = "";
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
