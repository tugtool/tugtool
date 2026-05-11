/**
 * TugCodeView — CodeMirror 6-backed read-only code/text viewer.
 *
 * The read-only sibling to `tug-text-editor`. Both are React shells
 * around a CM6 `EditorView`, but their responsibilities are disjoint:
 *
 *  - `TugTextEditor` is sized for *typing* — owns the document, the
 *    caret, selection ranges, an embedded-atom decoration field, a
 *    history, clipboard filters that round-trip atoms, drop handling,
 *    typeahead completion providers, a substrate-specific keymap
 *    (Enter / Cmd-Enter / Cmd-Up / Cmd-Down semantics), and the
 *    responder handlers for the full editing-action vocabulary.
 *  - `TugCodeView` is sized for *displaying file content* — owns the
 *    document only as a way to render bytes the host hands it, exposes
 *    no editing actions, registers only the responder handlers that
 *    a reader needs (SELECT_ALL, COPY, FIND), and ships nothing for
 *    caret / atoms / drop / typeahead / history.
 *
 * Why a peer primitive, not a flag on `tug-text-editor`:
 *  the editor's lifecycle — fast-refresh snapshot ref, state-preservation
 *  bag, responder for cut/paste/undo/redo, atom-decoration field,
 *  drop extension — is sized for an editing surface. Adding a
 *  "read-only" branch that disables half of it pollutes both call
 *  sites. The two primitives share CM6 plumbing (CodeMirror itself,
 *  the `Compartment`-based reconfiguration pattern, the line-numbers
 *  gutter shape) but their React shells stay independent.
 *
 * What this component does:
 *
 *  1. Mounts an `EditorView` in `useLayoutEffect` with empty deps and
 *     disposes it on cleanup, mirroring the StrictMode-safe pattern
 *     from `tug-text-editor` ([L03] before paint; the React 19 dev
 *     mount → cleanup → mount cycle constructs a fresh view each pass).
 *  2. Seeds the document from `value` at mount. On subsequent `value`
 *     changes, dispatches a single replace transaction so the host
 *     can swap displayed content without remounting the view.
 *  3. Three `Compartment`-wrapped extensions reconfigure live without
 *     view rebuilds: soft-wrap (`EditorView.lineWrapping`), line-number
 *     gutter (`lineNumbers()` from `@codemirror/view`), and the
 *     `@codemirror/search` extension that backs the find panel.
 *  4. Registers as a responder for SELECT_ALL, COPY, and FIND. CUT /
 *     PASTE / UNDO / REDO are intentionally NOT registered — a viewer
 *     is read-only by contract; those keystrokes walk past us in the
 *     responder chain to whatever editor or document responder is
 *     above us.
 *
 * Reading the public-API contract:
 *
 *  - `value`: the source text. Required. Updates dispatch a doc
 *    replacement; selection collapses to position 0 on update.
 *  - `wrap`: soft-wrap toggle. Defaults to `true` for file viewing
 *    (long lines wrap rather than horizontally scrolling — the bug
 *    that motivated Step 10.9's recast).
 *  - `lineNumbers`: gutter toggle. Defaults to `true` — file viewers
 *    show line numbers by convention.
 *  - `language`: informational only in v1. Reserved for the syntax-
 *    highlighting bridge that lands in a follow-up step (Shiki via
 *    CM6 decorations, or a `@codemirror/language`-based grammar
 *    integration). The prop exists today so consumers can pre-wire it.
 *  - `className`: composed onto the host `<div class="tug-code-view">`.
 *
 *  Imperative handle (via `ref`):
 *  - `view()`: returns the live `EditorView`, or `null` between
 *    unmount and re-mount. Consumers that need to dispatch
 *    transactions or query state hold this handle.
 *  - `openSearch()`: opens CM6's search panel for find-in-content.
 *    No-op when no view is mounted.
 *
 * Laws:
 *  - [L02] external state (the document) enters via a controlled
 *    `value` prop; CM6 is the runtime store, not React state, but the
 *    flow is one-way (host → view). No `useSyncExternalStore`
 *    machinery is needed because the viewer doesn't expose data
 *    upstream.
 *  - [L03] mount, dispose, and the Compartment reconfigures run in
 *    `useLayoutEffect`, so the responder registration and the view
 *    construction land before paint.
 *  - [L06] all appearance (selection painting, scroll, gutter,
 *    wrap, search panel) flows through CM6's DOM, not React state.
 *  - [L19] component authoring guide — file pair, module docstring,
 *    exported props interface, `data-slot="tug-code-view"` on the
 *    host, a single `body {}` declaring `--tugx-codeview-*` slots.
 *  - [L20] component-token sovereignty — owns the `--tugx-codeview-*`
 *    slot family; consumes `--tugx-block-*` directly for the shared
 *    code-typography pattern.
 *  - [L21] CodeMirror 6 (MIT). See `THIRD_PARTY_NOTICES.md` — the
 *    notice already covers the substrate.
 *
 * @module components/tugways/tug-code-view
 */

import "./tug-code-view.css";

import React, {
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers as cmLineNumbers,
} from "@codemirror/view";
import { selectAll as cmSelectAll } from "@codemirror/commands";
import {
  search,
  searchKeymap,
  openSearchPanel,
  closeSearchPanel,
} from "@codemirror/search";
import { cn } from "@/lib/utils";
import { useOptionalResponder } from "./use-responder";
import { TUG_ACTIONS, type TugAction } from "./action-vocabulary";
import type { ActionHandler } from "./responder-chain";

// ---------------------------------------------------------------------------
// Compartments
// ---------------------------------------------------------------------------
//
// Module-scoped so every TugCodeView mount uses the same Compartment
// identities — the reconfigure path inside the React shell calls
// `compartment.reconfigure(newExt)` on the live view and CM6 swaps the
// contents in place. Mirrors the pattern documented in
// `tug-text-editor.tsx` (see its Compartments section for the full
// rationale).

/** Reconfigurable soft-wrap (`EditorView.lineWrapping` or empty). */
const lineWrapCompartment = new Compartment();

/** Reconfigurable line-number gutter (`lineNumbers()` or empty). */
const lineNumbersCompartment = new Compartment();

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/**
 * Viewer theme. Paints the CM6 internals against the shared
 * `--tugx-block-*` family for code typography and `--tugx-codeview-*`
 * for viewer-local concerns (gutter colors, selection tint).
 *
 * Reads CSS variables directly so brio ↔ harmony theme switches
 * propagate without remount.
 */
const tugCodeViewTheme: Extension = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--tugx-block-text-color)",
    fontFamily: "var(--tugx-block-code-font)",
    fontSize: "var(--tugx-block-code-font-size)",
    lineHeight: "var(--tugx-block-code-line-height)",
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--tugx-block-code-font)",
    lineHeight: "var(--tugx-block-code-line-height)",
    // Reserve scrollbar space in layout even when no scrollbar is
    // visible so growing content doesn't induce horizontal jitter.
    scrollbarGutter: "stable",
  },
  ".cm-content": {
    caretColor: "transparent",
    color: "var(--tugx-block-text-color)",
    padding: "var(--tugx-codeview-content-padding)",
  },
  ".cm-line": {
    padding: "0 var(--tugx-codeview-line-padding-x)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--tugx-codeview-gutter-bg)",
    borderRight: "1px solid var(--tugx-codeview-gutter-border)",
    color: "var(--tugx-codeview-gutter-text)",
    fontFamily: "var(--tugx-block-code-font)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 var(--tugx-codeview-gutter-padding-x)",
    minWidth: "var(--tugx-codeview-gutter-min-width)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--tugx-codeview-selection-bg)",
  },
  ".cm-panels": {
    backgroundColor: "var(--tugx-block-strip-bg)",
    color: "var(--tugx-block-text-color)",
    borderTop: "1px solid var(--tugx-block-strip-border)",
  },
  // ---- @codemirror/search panel chrome ---------------------------------
  //
  // CM6's default search panel ships unstyled user-agent inputs and
  // buttons; against our dark strip they read as nearly-invisible greys
  // (visible at: gallery's pinned-headers card, Search icon → opens
  // panel). The rules below replace those defaults with theme-aware
  // paints via the `--tugx-codeview-search-*` slot family.
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "var(--tug-space-xs)",
    padding: "var(--tug-space-xs) var(--tug-space-sm)",
    color: "var(--tugx-block-text-color)",
    fontFamily: "var(--tug-font-family-sans)",
    fontSize: "var(--tug-font-size-2xs)",
  },
  ".cm-panel.cm-search .cm-textfield, .cm-panel.cm-search input[type='search'], .cm-panel.cm-search input[type='text']":
    {
      backgroundColor: "var(--tugx-codeview-search-input-bg)",
      color: "var(--tugx-codeview-search-input-color)",
      border: "1px solid var(--tugx-codeview-search-input-border)",
      padding: "var(--tugx-codeview-search-input-padding)",
      borderRadius: "var(--tugx-codeview-search-input-radius)",
      fontFamily: "var(--tug-font-family-sans)",
      fontSize: "var(--tug-font-size-xs)",
      minWidth: "10em",
    },
  ".cm-panel.cm-search input:focus-visible": {
    outline: "2px solid var(--tugx-codeview-search-focus-ring)",
    outlineOffset: "1px",
  },
  ".cm-panel.cm-search .cm-button, .cm-panel.cm-search button": {
    backgroundColor: "var(--tugx-codeview-search-button-bg)",
    color: "var(--tugx-codeview-search-button-color)",
    border: "1px solid var(--tugx-codeview-search-button-border)",
    padding: "var(--tugx-codeview-search-button-padding)",
    borderRadius: "var(--tugx-codeview-search-button-radius)",
    fontFamily: "var(--tug-font-family-sans)",
    fontSize: "var(--tug-font-size-2xs)",
    cursor: "pointer",
    backgroundImage: "none",
    textShadow: "none",
  },
  ".cm-panel.cm-search .cm-button:hover, .cm-panel.cm-search button:hover": {
    backgroundColor: "var(--tugx-codeview-search-button-hover-bg)",
    color: "var(--tugx-codeview-search-button-hover-color)",
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--tugx-codeview-search-label-gap)",
    color: "var(--tugx-codeview-search-label-color)",
    fontSize: "var(--tugx-codeview-search-label-size)",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-panel.cm-search [name='close']": {
    color: "var(--tugx-block-text-color-muted)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--tugx-codeview-match-bg)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--tugx-codeview-match-active-bg)",
    outline: "1px solid var(--tugx-codeview-match-active-outline)",
  },
});

// ---------------------------------------------------------------------------
// Imperative handle
// ---------------------------------------------------------------------------

/**
 * Imperative handle exposed via `ref`.
 *
 * Consumers that need to reach into the live CM6 view hold this handle
 * and call methods at use time. `view()` returns `null` between unmount
 * and re-mount — for example during React 19 StrictMode's dev
 * double-mount, or after the component has been disposed.
 */
export interface TugCodeViewDelegate {
  /** Return the live `EditorView`, or `null` if not mounted. */
  view(): EditorView | null;
  /** Open the search panel. No-op when no view is mounted. */
  openSearch(): void;
  /** Close the search panel. No-op when no view is mounted. */
  closeSearch(): void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for `TugCodeView`. The component renders a host `<div>` around
 * the live `EditorView`; standard `<div>` props (`className`, `style`,
 * `data-*`) flow through to the host.
 */
export interface TugCodeViewProps {
  /**
   * Source text. Required. Changes after mount dispatch a single
   * replace transaction that swaps the document in place; selection
   * collapses to position 0.
   */
  value: string;
  /**
   * Language identifier (e.g. `"typescript"`, `"python"`). Informational
   * in v1 — reserved for the syntax-highlighting bridge that lands in
   * a follow-up. The prop is wired today so consumers can pre-pass it
   * and migrate without an API change.
   */
  language?: string;
  /**
   * Soft-wrap. Adds `EditorView.lineWrapping` to the compartment when
   * `true`; removes it when `false`.
   * @default true
   */
  wrap?: boolean;
  /**
   * Line-number gutter. Adds `lineNumbers()` from `@codemirror/view`
   * to the compartment when `true`; removes it when `false`.
   * @default true
   */
  lineNumbers?: boolean;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Read-only CM6-backed code/text viewer. See the module docstring
 * for the lifecycle, API contract, and the responder vocabulary.
 */
export const TugCodeView = React.forwardRef<
  TugCodeViewDelegate,
  TugCodeViewProps
>(function TugCodeView(
  { value, language: _language, wrap = true, lineNumbers = true, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Stable id for this viewer's responder. Captured up here so the
  // imperative-handle focus closure can address the chain.
  const responderId = useId();

  // Live prop refs read at mount-effect time. React 19 StrictMode runs
  // mount → cleanup → mount in dev; the re-mount pass needs the latest
  // values, not the values from the closure that was captured at first
  // mount [L07].
  const wrapRef = useRef(wrap);
  const lineNumbersRef = useRef(lineNumbers);
  useLayoutEffect(() => {
    wrapRef.current = wrap;
  }, [wrap]);
  useLayoutEffect(() => {
    lineNumbersRef.current = lineNumbers;
  }, [lineNumbers]);

  // ---- Imperative handle (delegate) ----

  const openSearch = useCallback(() => {
    const view = viewRef.current;
    if (view === null) return;
    openSearchPanel(view);
  }, []);

  const closeSearch = useCallback(() => {
    const view = viewRef.current;
    if (view === null) return;
    closeSearchPanel(view);
  }, []);

  useImperativeHandle(
    ref,
    (): TugCodeViewDelegate => ({
      view: () => viewRef.current,
      openSearch,
      closeSearch,
    }),
    [openSearch, closeSearch],
  );

  // ---- Responder registration ----

  const handleSelectAll = useCallback((): void => {
    const view = viewRef.current;
    if (view === null) return;
    cmSelectAll(view);
  }, []);

  const handleCopy = useCallback((): void => {
    const view = viewRef.current;
    if (view === null) return;
    // CM6 doesn't expose a "copy" command directly because the
    // browser's clipboard copy handler runs against the focused
    // contenteditable. With our content focused, the browser's
    // native copy works on the current selection. Selection-empty
    // fallback: copy the whole document.
    const { from, to } = view.state.selection.main;
    const text =
      from === to
        ? view.state.doc.toString()
        : view.state.sliceDoc(from, to);
    void navigator.clipboard?.writeText(text);
  }, []);

  const handleFind = useCallback((): void => {
    openSearch();
  }, [openSearch]);

  const actions: Partial<Record<TugAction, ActionHandler>> = {
    [TUG_ACTIONS.SELECT_ALL]: handleSelectAll,
    [TUG_ACTIONS.COPY]: handleCopy,
    [TUG_ACTIONS.FIND]: handleFind,
  };

  const { responderRef, ResponderScope } = useOptionalResponder({
    id: responderId,
    actions,
    // Substrate-supplied focus callback. `manager.focusResponder(id)`
    // promotes us to first responder, then invokes this to land DOM
    // focus on CM6's contentDOM. Reading `viewRef.current` (not a
    // closure-captured view) means we always invoke `focus()` on the
    // live view, even after a StrictMode re-mount.
    focus: () => viewRef.current?.focus(),
  });

  // Compose host ref so a single callback writes both the local
  // `hostRef` and the chain's `responderRef` (which sets
  // `data-responder-id` on the host for click-driven promotion).
  const composedHostRef = useCallback(
    (el: HTMLDivElement | null) => {
      hostRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  // ---- Mount the EditorView ----

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const initialWrap = wrapRef.current;
    const initialLineNumbers = lineNumbersRef.current;

    const state = EditorState.create({
      doc: value,
      extensions: [
        EditorState.readOnly.of(true),
        lineWrapCompartment.of(
          initialWrap ? EditorView.lineWrapping : [],
        ),
        lineNumbersCompartment.of(
          initialLineNumbers ? cmLineNumbers() : [],
        ),
        // The search extension is always present; the panel toggles
        // open/closed via `openSearchPanel` / `closeSearchPanel`. The
        // search keymap binds Cmd/Ctrl-F inside the editor; the
        // responder also exposes FIND so the chain can reach us from
        // outside the editor's focus scope.
        search({ top: true }),
        keymap.of(searchKeymap),
        tugCodeViewTheme,
      ],
    });

    const view = new EditorView({
      state,
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Empty deps — mount once per StrictMode pass. Value swaps and
    // compartment reconfigures happen in dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Value swap ----

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    if (view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      // Collapse selection to 0 on doc swap; the prior selection is
      // not meaningful against a new document.
      selection: { anchor: 0 },
    });
  }, [value]);

  // ---- Wrap reconfigure ----

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: lineWrapCompartment.reconfigure(
        wrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [wrap]);

  // ---- Line-numbers reconfigure ----

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: lineNumbersCompartment.reconfigure(
        lineNumbers ? cmLineNumbers() : [],
      ),
    });
  }, [lineNumbers]);

  return (
    <ResponderScope>
      <div
        ref={composedHostRef}
        data-slot="tug-code-view"
        className={cn("tug-code-view", className)}
      />
    </ResponderScope>
  );
});
