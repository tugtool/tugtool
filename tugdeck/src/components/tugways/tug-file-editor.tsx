/**
 * TugFileEditor — CodeMirror 6-backed read-write file editing surface.
 *
 * The third CM6 primitive, peer to `tug-text-editor` (the prompt
 * composer) and `tug-code-view` (the read-only viewer). Forked from
 * `TugCodeView`'s shell — same StrictMode-safe mount, Compartment
 * reconfiguration, host-owned Find UI — with the write side grafted
 * from `TugTextEditor`'s responder shape: full editing-action
 * registration, plain-text clipboard through the native bridge (no
 * atom sidecar — files are plain text), CM6 `history()` with the
 * shared undo-menu-state plugin, and a right-click context menu via
 * `useTextSurfaceContextMenu`.
 *
 * What is deliberately NOT here (prompt-only concerns): atoms,
 * completion/typeahead, drop handling, attachments, submit/history
 * navigation, the custom caret/selection layers (native caret and
 * `::selection` work fine without atom widgets in the document).
 *
 * Document ownership: CM6 is the runtime store for the text — the
 * document never enters React state. The component binds to a
 * `FileEditorStore` (the card's autosave engine) through the
 * `FileEditorBridge` contract:
 *
 *   - mount seeds the document from `snapshot.seedContent`;
 *   - every user edit calls `store.noteEdit()` (arming the autosave
 *     debounce); the store reads the buffer back via `getText()` at
 *     flush time;
 *   - external-change reverts arrive via `replaceText()`, a single
 *     transaction annotated so the update listener does NOT re-arm
 *     autosave, preserving cursor/scroll as far as the new text allows;
 *   - `getPositions()`/`applyPositions()` carry cursor + scroll for
 *     the card bag (positions-only persistence).
 *
 * Full height: the host fills the card body and CM6's `.cm-scroller`
 * owns scrolling (unlike both siblings — the composer is auto-height,
 * the viewer content-sized). CM6's viewport virtualization handles
 * large documents from this configuration.
 *
 * Laws:
 *  - [L02] document lives in CM6; React renders only from props.
 *  - [L03] mount, bridge attach, and responder registration in
 *    `useLayoutEffect`.
 *  - [L06] all appearance through CM6's DOM and the theme extension.
 *  - [L07] every handler reads `viewRef.current` / prop refs at
 *    dispatch time, never captured closures.
 *  - [L11] this component owns the caret, selection, undo stack, and
 *    disk binding — it registers as the responder for the actions
 *    that mutate them (cut/copy/paste/selectAll/undo/redo/save).
 *  - [L12] `data-tug-select="custom"` exempts the CM6 surface from
 *    SelectionGuard clipping (the editor owns selection autonomously).
 *  - [L19]/[L20] file pair, `data-slot`, `--tugx-fileeditor-*` slots.
 *  - [L21] CodeMirror 6 (MIT) — covered in `THIRD_PARTY_NOTICES.md`.
 *
 * @module components/tugways/tug-file-editor
 */

import "./tug-file-editor.css";

import React, {
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  lineNumbers as cmLineNumbers,
} from "@codemirror/view";
import { foldGutter as cmFoldGutter, indentUnit } from "@codemirror/language";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  selectAll as cmSelectAll,
  undo,
  undoDepth,
} from "@codemirror/commands";
import {
  search,
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  searchPanelOpen,
  openSearchPanel,
  closeSearchPanel,
  findNext as cmFindNext,
  findPrevious as cmFindPrevious,
} from "@codemirror/search";

import { cn } from "@/lib/utils";
import {
  hasNativeClipboardBridge,
  readClipboardViaNative,
  writeClipboardViaNative,
} from "@/lib/tug-native-clipboard";
import { quoteMarkdown, stripMarkdown } from "@/lib/paste-transforms";
import type {
  FileEditorStore,
  FilePositions,
} from "@/lib/file-editor-store";
import {
  DEFAULT_FILE_EDITOR_SETTINGS,
  type FileEditorSettings,
} from "@/lib/file-editor-settings";
import type { EditorStats } from "@/lib/editor-stats-store";
import { languageForExtension, tugHighlightStyle } from "@/lib/language-registry";

import { useOptionalResponder } from "./use-responder";
import { TUG_ACTIONS, type TugAction } from "./action-vocabulary";
import type { ActionHandler, ActionHandlerResult } from "./responder-chain";
import { useTextSurfaceContextMenu } from "./use-text-surface-context-menu";
import { createCMSelectionAdapter } from "./tug-text-editor/selection-adapter";
import type { TextSelectionAdapter } from "./text-selection-adapter";
import { undoMenuStatePlugin } from "./tug-text-editor/undo-menu-state-plugin";
import { tugFileEditorTheme } from "./tug-file-editor/theme";

// ---------------------------------------------------------------------------
// Compartments and annotations
// ---------------------------------------------------------------------------

/** Reconfigurable soft-wrap (`EditorView.lineWrapping` or empty). */
const lineWrapCompartment = new Compartment();

/** Reconfigurable line-number gutter. */
const lineNumbersCompartment = new Compartment();

/** Reconfigurable read-only state (permission-refused files). */
const readOnlyCompartment = new Compartment();

/** Reconfigurable language/highlighting slot (installed per file type). */
const languageCompartment = new Compartment();

/** Reconfigurable code-folding gutter. */
const foldGutterCompartment = new Compartment();

/** Reconfigurable whitespace rendering (`highlightWhitespace` or empty). */
const whitespaceCompartment = new Compartment();

/** Reconfigurable indent unit + tab width (soft tabs / spaces per tab). */
const tabConfigCompartment = new Compartment();

/** Reconfigurable active-line highlight (line + gutter cell). */
const activeLineCompartment = new Compartment();

/**
 * The `[tabSize, indentUnit]` pair for a given settings snapshot. Soft
 * tabs make the Tab key (via `indentWithTab` → `insertTab`) insert
 * `tabSize` spaces; hard tabs insert a literal `\t`. `tabSize` also
 * sets how a literal tab already in the file is rendered/measured.
 */
function tabConfigFor(settings: FileEditorSettings): Extension {
  const unit = settings.softTabs ? " ".repeat(settings.tabSize) : "\t";
  return [EditorState.tabSize.of(settings.tabSize), indentUnit.of(unit)];
}

/** Doc-derived stats (recomputed only when the document changes). */
interface DocStats {
  lines: number;
  words: number;
  chars: number;
}

/** Whitespace-delimited word count. */
function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches === null ? 0 : matches.length;
}

/** The active-line-highlight extensions for a settings snapshot. */
function activeLineFor(settings: FileEditorSettings): Extension {
  return settings.highlightActiveLine
    ? [highlightActiveLine(), highlightActiveLineGutter()]
    : [];
}

/**
 * Whitespace rendering. `highlightWhitespace()` marks both spaces
 * (`.cm-highlightSpace`) and tabs (`.cm-highlightTab`); which glyphs
 * actually paint is narrowed by the host's `data-show-spaces` /
 * `data-show-tabs` attributes in CSS, so the two toggles are
 * independent without a custom decoration.
 */
function whitespaceFor(settings: FileEditorSettings): Extension {
  return settings.showSpaces || settings.showTabs ? highlightWhitespace() : [];
}

/**
 * Reflect the two invisibles toggles onto the host as data attributes
 * the CSS reads to narrow `highlightWhitespace`'s glyphs per kind.
 * DOM-only ([L06]) — no React state.
 */
function applyWhitespaceAttrs(host: HTMLElement, settings: FileEditorSettings): void {
  host.dataset.showSpaces = String(settings.showSpaces);
  host.dataset.showTabs = String(settings.showTabs);
}

/**
 * Marks a store-driven document replacement (external-change revert).
 * The update listener skips `noteEdit` for annotated transactions so a
 * revert never re-arms the autosave debounce.
 */
const externalReplace = Annotation.define<boolean>();

// ---------------------------------------------------------------------------
// Delegate
// ---------------------------------------------------------------------------

/** Search-query configuration (mirrors `TugCodeViewSearchQuery`). */
export interface TugFileEditorSearchQuery {
  search: string;
  caseSensitive?: boolean;
  regexp?: boolean;
  wholeWord?: boolean;
}

/** Imperative handle exposed via `ref`. */
export interface TugFileEditorDelegate {
  /** The live `EditorView`, or `null` if not mounted. */
  view(): EditorView | null;
  /** Land DOM focus on the editing surface. */
  focus(): void;
  /**
   * Move the cursor to the start of `line` (1-based, clamped) and
   * center it in the scrollport. The transcript's open-at-line links
   * land here.
   */
  revealLine(line: number): void;
  /** Set / replace the active search query (paints match highlights). */
  setSearchQuery(query: TugFileEditorSearchQuery): void;
  /** Tear down the active search and clear match highlights. */
  clearSearch(): void;
  findNext(): void;
  findPrevious(): void;
  /** Count matches for the active query (0 when none / invalid). */
  getMatchCount(): number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TugFileEditorProps {
  /**
   * The card's autosave engine. The editor seeds its document from the
   * store's snapshot at mount, reports edits via `noteEdit`, and
   * attaches the `FileEditorBridge` so the store can read the buffer
   * at flush time and replace it on external-change reverts.
   */
  store: FileEditorStore;
  /**
   * Refuse edits (permission-refused files). Reconfigures
   * `EditorState.readOnly` live; the store separately refuses to arm
   * autosave while read-only.
   * @default false
   */
  readOnly?: boolean;
  /**
   * CM6 view settings (line numbers, soft wrap, soft tabs, tab width,
   * fold gutter, active-line highlight, invisibles). Seeded from the
   * deck-wide File-editor defaults and overridden per card by the gear
   * popup; each field reconfigures its compartment live.
   * @default DEFAULT_FILE_EDITOR_SETTINGS
   */
  settings?: FileEditorSettings;
  /**
   * File extension (no dot) whose grammar to load for syntax
   * highlighting, or null for plain text. The File card derives this
   * from the file's path, overridable by the status-bar file-type
   * popup. Plain text while the grammar chunk loads.
   */
  languageExt?: string | null;
  /** Forwarded class name. */
  className?: string;
  /**
   * Called when the responder chain receives `FIND` (Cmd-F inside the
   * editor). The File card wires this to its find-bar toggle.
   */
  onFindRequested?: () => void;
  /**
   * Publish live document/selection stats (caret line/col, line/word/
   * char counts) for the card's status bar. Fires once at mount, then
   * on every selection or document change.
   */
  onStats?: (stats: EditorStats) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TugFileEditor = React.forwardRef<
  TugFileEditorDelegate,
  TugFileEditorProps
>(function TugFileEditor(
  {
    store,
    readOnly = false,
    settings = DEFAULT_FILE_EDITOR_SETTINGS,
    languageExt,
    className,
    onFindRequested,
    onStats,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // View identity as React state — structural: the selection adapter
  // (context menu) must be rebuilt when the view is recreated.
  const [view, setView] = useState<EditorView | null>(null);

  const responderId = useId();

  // Live prop/store refs read at event time [L07].
  const storeRef = useRef(store);
  const settingsRef = useRef(settings);
  const readOnlyRef = useRef(readOnly);
  const onFindRequestedRef = useRef<(() => void) | undefined>(onFindRequested);
  const onStatsRef = useRef<((stats: EditorStats) => void) | undefined>(onStats);
  // Doc-derived counts, recomputed only on document change; caret is
  // recomputed on every selection change from the live state.
  const docStatsRef = useRef<DocStats>({ lines: 1, words: 0, chars: 0 });
  useLayoutEffect(() => {
    onStatsRef.current = onStats;
  }, [onStats]);
  useLayoutEffect(() => {
    storeRef.current = store;
  }, [store]);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useLayoutEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);
  useLayoutEffect(() => {
    onFindRequestedRef.current = onFindRequested;
  }, [onFindRequested]);

  // ---- Bridge helpers ----

  const getPositions = useCallback((): FilePositions => {
    const live = viewRef.current;
    if (live === null) {
      return { anchor: { line: 1, ch: 0 }, scrollTop: 0 };
    }
    const head = live.state.selection.main.head;
    const line = live.state.doc.lineAt(head);
    return {
      anchor: { line: line.number, ch: head - line.from },
      scrollTop: live.scrollDOM.scrollTop,
    };
  }, []);

  const applyPositions = useCallback((positions: FilePositions): void => {
    const live = viewRef.current;
    if (live === null) return;
    const lineNumber = Math.max(
      1,
      Math.min(positions.anchor.line, live.state.doc.lines),
    );
    const line = live.state.doc.line(lineNumber);
    const pos = line.from + Math.min(positions.anchor.ch, line.length);
    if (positions.scrollTop > 0) {
      // A saved viewport: restore it verbatim.
      live.dispatch({ selection: { anchor: pos } });
      live.scrollDOM.scrollTop = positions.scrollTop;
      return;
    }
    // No saved viewport (a fresh open-at-line): center the target so a
    // deep-link into a long file lands with the line visible.
    live.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }, []);

  // Publish caret + counts to the status bar. Caret is read live from
  // `state`; the line/word/char counts come from `docStatsRef` (kept
  // fresh by the update listener on document change).
  const publishStats = useCallback((state: EditorState): void => {
    const cb = onStatsRef.current;
    if (cb === undefined) return;
    const pos = state.selection.main.from;
    const line = state.doc.lineAt(pos);
    const doc = docStatsRef.current;
    cb({
      caretLine: line.number,
      caretCol: pos - line.from + 1,
      lines: doc.lines,
      words: doc.words,
      chars: doc.chars,
    });
  }, []);

  const replaceText = useCallback((next: string): void => {
    const live = viewRef.current;
    if (live === null) return;
    if (live.state.doc.toString() === next) return;
    const scrollTop = live.scrollDOM.scrollTop;
    const head = live.state.selection.main.head;
    live.dispatch({
      changes: { from: 0, to: live.state.doc.length, insert: next },
      selection: { anchor: Math.min(head, next.length) },
      annotations: externalReplace.of(true),
    });
    // Keep the viewport where the user left it; the revert should read
    // as "the text changed under me", not "the editor jumped".
    live.scrollDOM.scrollTop = scrollTop;
  }, []);

  // ---- Mount the EditorView ----

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const snapshot = storeRef.current.getSnapshot();
    const s = settingsRef.current;
    applyWhitespaceAttrs(host, s);
    const state = EditorState.create({
      doc: snapshot.seedContent ?? "",
      extensions: [
        history(),
        readOnlyCompartment.of(EditorState.readOnly.of(readOnlyRef.current)),
        lineWrapCompartment.of(s.lineWrap ? EditorView.lineWrapping : []),
        lineNumbersCompartment.of(s.lineNumbers ? cmLineNumbers() : []),
        foldGutterCompartment.of(s.foldGutter ? cmFoldGutter() : []),
        tabConfigCompartment.of(tabConfigFor(s)),
        whitespaceCompartment.of(whitespaceFor(s)),
        activeLineCompartment.of(activeLineFor(s)),
        languageCompartment.of([]),
        search({ top: true }),
        // Every user edit arms the autosave debounce. Store-driven
        // replacements (external-change reverts) carry the
        // `externalReplace` annotation and must NOT re-arm it.
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const doc = update.state.doc;
            docStatsRef.current = {
              lines: doc.lines,
              chars: doc.length,
              words: countWords(doc.toString()),
            };
            const isExternal = update.transactions.some(
              (t) => t.annotation(externalReplace) === true,
            );
            // Store-driven reverts must NOT re-arm autosave; the stats
            // above still refresh for them.
            if (!isExternal) storeRef.current.noteEdit();
          }
          if (update.docChanged || update.selectionSet) {
            publishStats(update.state);
          }
        }),
        // Editing keymaps. The responder chain owns the Cmd-chords
        // (capture-phase preventDefault before CM6 sees them); these
        // cover everything else — cursor motion, Home/End, indent,
        // and history chords in browser contexts without the chain.
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        undoMenuStatePlugin,
        tugFileEditorTheme,
      ],
    });

    const cmView = new EditorView({ state, parent: host });
    viewRef.current = cmView;
    setView(cmView);
    storeRef.current.attachEditor({
      getText: () => cmView.state.doc.toString(),
      replaceText,
      getPositions,
      applyPositions,
    });

    // Seed the status bar with the mounted document's stats.
    docStatsRef.current = {
      lines: cmView.state.doc.lines,
      chars: cmView.state.doc.length,
      words: countWords(cmView.state.doc.toString()),
    };
    publishStats(cmView.state);

    return () => {
      // Flush BEFORE detaching: child cleanups run before the parent
      // card's, so this is the last moment the store can read the
      // buffer — without it, the final debounce window of edits would
      // be lost on unmount. `flush` snapshots the text synchronously;
      // keepalive carries the write through teardown.
      void storeRef.current.flush({ keepalive: true });
      storeRef.current.detachEditor();
      cmView.destroy();
      viewRef.current = null;
      setView(null);
    };
    // Empty deps — mount once per StrictMode pass; reconfigures below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Compartment reconfigures ----

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: lineWrapCompartment.reconfigure(
        settings.lineWrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [settings.lineWrap]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: lineNumbersCompartment.reconfigure(
        settings.lineNumbers ? cmLineNumbers() : [],
      ),
    });
  }, [settings.lineNumbers]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: foldGutterCompartment.reconfigure(
        settings.foldGutter ? cmFoldGutter() : [],
      ),
    });
  }, [settings.foldGutter]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: tabConfigCompartment.reconfigure(tabConfigFor(settings)),
    });
  }, [settings.softTabs, settings.tabSize]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: activeLineCompartment.reconfigure(activeLineFor(settings)),
    });
  }, [settings.highlightActiveLine]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host !== null) applyWhitespaceAttrs(host, settings);
    viewRef.current?.dispatch({
      effects: whitespaceCompartment.reconfigure(whitespaceFor(settings)),
    });
  }, [settings.showSpaces, settings.showTabs]);

  useLayoutEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  // ---- Language / syntax highlighting ----
  //
  // Resolved asynchronously (the grammar chunk lazy-loads); the
  // compartment swap lands whenever the import settles. The stale-path
  // guard drops a late-resolving grammar after the card re-anchored to
  // a different file.
  useLayoutEffect(() => {
    const ext = languageExt ?? null;
    if (ext === null) {
      viewRef.current?.dispatch({
        effects: languageCompartment.reconfigure([]),
      });
      return;
    }
    let alive = true;
    void languageForExtension(ext).then((language) => {
      if (!alive) return;
      const live = viewRef.current;
      if (live === null) return;
      live.dispatch({
        effects: languageCompartment.reconfigure(
          language !== null ? [language, tugHighlightStyle] : [],
        ),
      });
    });
    return () => {
      alive = false;
    };
  }, [languageExt]);

  // ---- Search (host-owned Find UI, delegate-driven) ----

  const setSearchQueryFn = useCallback((spec: TugFileEditorSearchQuery) => {
    const live = viewRef.current;
    if (live === null) return;
    // Mounting the (hidden) bundled panel initializes the search
    // state's `panel` field, which the match highlighter requires
    // before painting decorations — same mechanism as `TugCodeView`.
    if (!searchPanelOpen(live.state)) {
      openSearchPanel(live);
    }
    live.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: spec.search,
          caseSensitive: spec.caseSensitive ?? false,
          regexp: spec.regexp ?? false,
          wholeWord: spec.wholeWord ?? false,
        }),
      ),
    });
  }, []);

  const clearSearchFn = useCallback(() => {
    const live = viewRef.current;
    if (live === null) return;
    live.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "" })),
    });
    if (searchPanelOpen(live.state)) {
      closeSearchPanel(live);
    }
  }, []);

  const getMatchCountFn = useCallback((): number => {
    const live = viewRef.current;
    if (live === null) return 0;
    const query = getSearchQuery(live.state);
    if (!query.valid) return 0;
    const cursor = query.getCursor(live.state);
    let count = 0;
    let next = cursor.next();
    while (!next.done) {
      count += 1;
      next = cursor.next();
    }
    return count;
  }, []);

  const revealLineFn = useCallback((lineNumber: number): void => {
    const live = viewRef.current;
    if (live === null) return;
    const clamped = Math.max(1, Math.min(lineNumber, live.state.doc.lines));
    const pos = live.state.doc.line(clamped).from;
    live.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    live.focus();
  }, []);

  useImperativeHandle(
    ref,
    (): TugFileEditorDelegate => ({
      view: () => viewRef.current,
      focus: () => viewRef.current?.focus(),
      revealLine: revealLineFn,
      setSearchQuery: setSearchQueryFn,
      clearSearch: clearSearchFn,
      findNext: () => {
        const live = viewRef.current;
        if (live !== null) cmFindNext(live);
      },
      findPrevious: () => {
        const live = viewRef.current;
        if (live !== null) cmFindPrevious(live);
      },
      getMatchCount: getMatchCountFn,
    }),
    [revealLineFn, setSearchQueryFn, clearSearchFn, getMatchCountFn],
  );

  // ---- Context menu ----

  const cmAdapterRef = useRef<TextSelectionAdapter | null>(null);
  useLayoutEffect(() => {
    cmAdapterRef.current =
      view !== null ? createCMSelectionAdapter(view) : null;
  }, [view]);

  const {
    onMouseDown: onContextMenuMouseDown,
    onContextMenu: onContextMenuOpen,
    menu: contextMenu,
  } = useTextSurfaceContextMenu({
    adapterRef: cmAdapterRef,
    capabilities: { canEdit: !readOnly },
  });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const handleContextMenu = (e: MouseEvent) => {
      const live = viewRef.current;
      if (live === null) return;
      if (!live.dom.contains(e.target as Node)) return;
      onContextMenuOpen(e);
    };
    const handleMouseDown = (e: MouseEvent) => {
      const live = viewRef.current;
      if (live === null) return;
      if (!live.dom.contains(e.target as Node)) return;
      onContextMenuMouseDown(e);
    };
    host.addEventListener("contextmenu", handleContextMenu);
    host.addEventListener("mousedown", handleMouseDown);
    return () => {
      host.removeEventListener("contextmenu", handleContextMenu);
      host.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onContextMenuOpen, onContextMenuMouseDown]);

  // ---- Responder-chain action handlers ----
  //
  // The chain's capture-phase keydown pipeline maps Cmd-A/C/X/V/Z/⇧Z/S
  // to actions and calls `preventDefault` before dispatch, so the
  // editor MUST register handlers — the suppressed default leaves the
  // keystrokes inert otherwise. Plain-text clipboard only: files carry
  // no atom sidecar, so the write path is text-only and the read path
  // inserts the clipboard's text verbatim.

  const handleSelectAll = useCallback((): ActionHandlerResult => {
    return () => {
      const live = viewRef.current;
      if (live === null) return;
      live.focus();
      cmSelectAll(live);
    };
  }, []);

  const handleUndo = useCallback((): ActionHandlerResult => {
    return () => {
      const live = viewRef.current;
      if (live === null) return;
      live.focus();
      undo(live);
    };
  }, []);

  const handleRedo = useCallback((): ActionHandlerResult => {
    return () => {
      const live = viewRef.current;
      if (live === null) return;
      live.focus();
      redo(live);
    };
  }, []);

  /** Write the current selection as plain text; true when handled. */
  const writeSelectionToClipboard = useCallback((): boolean => {
    const live = viewRef.current;
    if (live === null) return false;
    const { from, to } = live.state.selection.main;
    if (from === to) return true; // nothing selected — handled no-op
    const text = live.state.sliceDoc(from, to);
    if (hasNativeClipboardBridge()) {
      return writeClipboardViaNative(text, "");
    }
    void navigator.clipboard?.writeText(text);
    return true;
  }, []);

  const handleCopy = useCallback((): ActionHandlerResult => {
    const live = viewRef.current;
    if (live === null) return;
    live.focus();
    if (!writeSelectionToClipboard()) {
      document.execCommand("copy");
    }
  }, [writeSelectionToClipboard]);

  const handleCut = useCallback((): ActionHandlerResult => {
    const live = viewRef.current;
    if (live === null || readOnlyRef.current) return;
    live.focus();
    if (!writeSelectionToClipboard()) {
      document.execCommand("copy");
    }
    return () => {
      const inner = viewRef.current;
      if (inner === null) return;
      const { from, to } = inner.state.selection.main;
      if (from === to) return;
      inner.dispatch({
        changes: { from, to, insert: "" },
        selection: { anchor: from },
        userEvent: "delete.cut",
      });
    };
  }, [writeSelectionToClipboard]);

  /** Insert clipboard text at the selection, via a transform. */
  const pasteWithTransform = useCallback(
    (transform: (text: string) => string): ActionHandlerResult => {
      const live = viewRef.current;
      if (live === null || readOnlyRef.current) return;
      live.focus();
      const insert = (raw: string) => {
        const inner = viewRef.current;
        if (inner === null) return;
        const text = transform(raw);
        if (text === "") return;
        const { from, to } = inner.state.selection.main;
        inner.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          userEvent: "input.paste",
          scrollIntoView: true,
        });
      };
      if (hasNativeClipboardBridge()) {
        const readPromise = readClipboardViaNative();
        return () => {
          void readPromise.then(({ text }) => insert(text));
        };
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        const readPromise = navigator.clipboard.readText().catch(() => "");
        return () => {
          void readPromise.then(insert);
        };
      }
      return;
    },
    [],
  );

  const handlePaste = useCallback(
    (): ActionHandlerResult => pasteWithTransform((text) => text),
    [pasteWithTransform],
  );

  const handlePasteAsQuote = useCallback(
    (): ActionHandlerResult => pasteWithTransform(quoteMarkdown),
    [pasteWithTransform],
  );

  const handlePasteAsPlainText = useCallback(
    (): ActionHandlerResult => pasteWithTransform(stripMarkdown),
    [pasteWithTransform],
  );

  // SAVE — flush pending edits now (⌘S still works on top of live
  // autosave; it just forces the debounce to fire immediately).
  const handleSave = useCallback((): ActionHandlerResult => {
    return () => {
      void storeRef.current.saveNow();
    };
  }, []);

  const handleFind = useCallback((): ActionHandlerResult => {
    onFindRequestedRef.current?.();
  }, []);

  const handleFindNext = useCallback((): ActionHandlerResult => {
    const live = viewRef.current;
    if (live !== null) cmFindNext(live);
  }, []);

  const handleFindPrevious = useCallback((): ActionHandlerResult => {
    const live = viewRef.current;
    if (live !== null) cmFindPrevious(live);
  }, []);

  const actions: Partial<Record<TugAction, ActionHandler>> = {
    [TUG_ACTIONS.SELECT_ALL]: handleSelectAll,
    [TUG_ACTIONS.UNDO]: handleUndo,
    [TUG_ACTIONS.REDO]: handleRedo,
    [TUG_ACTIONS.COPY]: handleCopy,
    [TUG_ACTIONS.CUT]: handleCut,
    [TUG_ACTIONS.PASTE]: handlePaste,
    [TUG_ACTIONS.PASTE_AS_QUOTE]: handlePasteAsQuote,
    [TUG_ACTIONS.PASTE_AS_PLAIN_TEXT]: handlePasteAsPlainText,
    [TUG_ACTIONS.SAVE]: handleSave,
    [TUG_ACTIONS.FIND]: handleFind,
    [TUG_ACTIONS.FIND_NEXT]: handleFindNext,
    [TUG_ACTIONS.FIND_PREVIOUS]: handleFindPrevious,
  };

  const { responderRef, ResponderScope } = useOptionalResponder({
    id: responderId,
    actions,
    validateAction: (action) => {
      if (action === TUG_ACTIONS.UNDO) {
        const live = viewRef.current;
        return live !== null && undoDepth(live.state) > 0;
      }
      if (action === TUG_ACTIONS.REDO) {
        const live = viewRef.current;
        return live !== null && redoDepth(live.state) > 0;
      }
      if (
        action === TUG_ACTIONS.CUT ||
        action === TUG_ACTIONS.PASTE ||
        action === TUG_ACTIONS.PASTE_AS_QUOTE ||
        action === TUG_ACTIONS.PASTE_AS_PLAIN_TEXT ||
        action === TUG_ACTIONS.SAVE
      ) {
        return !readOnlyRef.current;
      }
      return true;
    },
    focus: () => viewRef.current?.focus(),
  });

  const composedHostRef = useCallback(
    (el: HTMLDivElement | null) => {
      hostRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  return (
    <ResponderScope>
      <div
        ref={composedHostRef}
        data-slot="tug-file-editor"
        data-tug-select="custom"
        className={cn("tug-file-editor", className)}
      />
      {contextMenu}
    </ResponderScope>
  );
});
