/**
 * TugTextCardEditor — CodeMirror 6-backed read-write file editing surface.
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
 * `TextCardStore` (the card's autosave engine) through the
 * `TextCardBridge` contract:
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
 *  - [L19]/[L20] file pair, `data-slot`, `--tugx-textcard-*` slots.
 *  - [L21] CodeMirror 6 (MIT) — covered in `THIRD_PARTY_NOTICES.md`.
 *
 * @module components/tugways/tug-text-card-editor
 */

import "./tug-text-card-editor.css";
// The find landing-flash ring class + keyframes — the SAME one-shot accent
// ring the Dev card's transcript find draws ([L14] reduced-motion aware).
import "./transcript-find.css";
import { placeFindFlash, type FindFlashHandle } from "./find-flash";

import React, {
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  lineNumbers as cmLineNumbers,
} from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
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
  TextCardStore,
  FilePositions,
} from "@/lib/text-card-store";
import {
  DEFAULT_TEXT_CARD_SETTINGS,
  type TextCardSettings,
} from "@/lib/text-card-settings";
import type { EditorStats } from "@/lib/editor-stats-store";
import { countWords, wordCountDelta } from "@/lib/word-count";
import { languageForExtension, tugHighlightStyle } from "@/lib/language-registry";

import { useOptionalResponder } from "./use-responder";
import { useCardId } from "./use-card-state-preservation";
import { getDeckStore } from "@/lib/deck-store-registry";
import { TUG_ACTIONS, type TugAction } from "./action-vocabulary";
import type { ActionHandler, ActionHandlerResult } from "./responder-chain";
import { useTextSurfaceContextMenu } from "./use-text-surface-context-menu";
import { createCMSelectionAdapter } from "./tug-text-editor/selection-adapter";
import type { TextSelectionAdapter } from "./text-selection-adapter";
import { undoMenuStatePlugin } from "./tug-text-editor/undo-menu-state-plugin";
import { tugTextCardEditorTheme } from "./tug-text-card-editor/theme";

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
function tabConfigFor(settings: TextCardSettings): Extension {
  const unit = settings.softTabs ? " ".repeat(settings.tabSize) : "\t";
  return [EditorState.tabSize.of(settings.tabSize), indentUnit.of(unit)];
}

/** Doc-derived stats (recomputed only when the document changes). */
interface DocStats {
  lines: number;
  words: number;
  chars: number;
}

/** The active-line-highlight extensions for a settings snapshot. */
function activeLineFor(settings: TextCardSettings): Extension {
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
function whitespaceFor(settings: TextCardSettings): Extension {
  return settings.showSpaces || settings.showTabs ? highlightWhitespace() : [];
}

/**
 * Reflect the two invisibles toggles onto the host as data attributes
 * the CSS reads to narrow `highlightWhitespace`'s glyphs per kind.
 * DOM-only ([L06]) — no React state.
 */
function applyWhitespaceAttrs(host: HTMLElement, settings: TextCardSettings): void {
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
// Reveal flash — a momentary accent highlight over jumped-to lines
// ---------------------------------------------------------------------------
//
// When the editor reveals a passage (a tool-call file-ref click landing
// on the touched line(s)), a transient LINE decoration washes those
// lines in the theme accent and fades out — a momentary "look here" that
// leaves no persistent selection (the reveal places a plain caret, so
// the Active-line highlight settles on the target once the flash ends).
// Appearance only: a CM6 line decoration + a CSS `@keyframes` in
// `tug-text-card-editor.css`, never React state ([L06]). Cleared after the
// animation window so it neither lingers nor re-fires on later edits.

/** Set the flashed line span (doc positions), or `null` to clear it. */
const setRevealFlash = StateEffect.define<{ from: number; to: number } | null>();

/** The per-line flash decoration (washes the whole `.cm-line`). */
const revealFlashLine = Decoration.line({ class: "tug-textcard-reveal-flash" });

/** How long the flash decoration lives before it is cleared (ms). Must
 *  outlast the CSS animation so the wash completes its single fade. */
const REVEAL_FLASH_MS = 900;

const revealFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setRevealFlash)) {
        if (effect.value === null) {
          deco = Decoration.none;
        } else {
          const { doc } = tr.state;
          const lines: ReturnType<typeof revealFlashLine.range>[] = [];
          let pos = effect.value.from;
          const end = Math.min(effect.value.to, doc.length);
          while (pos <= end) {
            const line = doc.lineAt(pos);
            lines.push(revealFlashLine.range(line.from));
            if (line.to + 1 <= pos) break; // guard against zero-advance
            pos = line.to + 1;
          }
          deco = Decoration.set(lines);
        }
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ---------------------------------------------------------------------------
// Delegate
// ---------------------------------------------------------------------------

/** Search-query configuration (mirrors `TugCodeViewSearchQuery`). */
export interface TugTextCardEditorSearchQuery {
  search: string;
  caseSensitive?: boolean;
  regexp?: boolean;
  wholeWord?: boolean;
}

/** Imperative handle exposed via `ref`. */
/**
 * Enumeration cap for `getMatchInfo` — mirrors the transcript engine's
 * `DEFAULT_MATCH_LIMIT` so a degenerate query over a huge file cannot stall
 * the chip's per-keystroke recount. A capped count renders as `N+`.
 */
const MATCH_INFO_CAP = 5000;

export interface TugTextCardEditorDelegate {
  /** The live `EditorView`, or `null` if not mounted. */
  view(): EditorView | null;
  /** Land DOM focus on the editing surface. */
  focus(): void;
  /**
   * The editor's responder id. A caller that needs the editor to become
   * the chain FIRST RESPONDER — not merely DOM-focused — uses this with
   * `manager.focusResponder(id)`: a bare `focus()` is a no-op when the
   * editor already holds DOM focus, so it can't repair a DOM-focus /
   * first-responder divergence (e.g. after a title-bar drag promoted the
   * pane). See responder-chain.md § "Bringing DOM focus in sync".
   */
  responderId(): string;
  /**
   * Reveal line(s) and momentarily flash them in the theme accent. Places
   * a plain caret at the start of `line` (1-based, clamped), centers it,
   * and washes `line`..`endLine` (or just `line`) with a fading accent
   * highlight — no persistent selection. The transcript's tool-call
   * file-ref links land here: a Read jumps to its window start, an Edit
   * flashes its first changed line(s).
   */
  revealLine(line: number, endLine?: number): void;
  /** Set / replace the active search query (paints match highlights). */
  setSearchQuery(query: TugTextCardEditorSearchQuery): void;
  /**
   * Select the active query's FIRST match and reveal it — vertically
   * centred and horizontally scrolled to the match (a long unwrapped line
   * must pan). Selection + scroll only; no focus claim, so a find field
   * driving this keeps its caret. No-op when the query has no match.
   * The find bar calls this after every query edit (search-as-you-type
   * lands on the first result the way every find bar does).
   */
  selectFirstMatch(): void;
  /** Tear down the active search and clear match highlights. */
  clearSearch(): void;
  findNext(): void;
  findPrevious(): void;
  /** Count matches for the active query (0 when none / invalid). */
  getMatchCount(): number;
  /**
   * Count + active ordinal for the shared find cluster. The walk is capped
   * (a huge file's enumeration must not stall typing): `capped` is `true`
   * when the cap was hit, and the chip renders `N+`. The active ordinal is
   * the match whose range equals the current main selection (the
   * `findNext`/`findPrevious` landing), or `null` when the selection sits
   * elsewhere.
   */
  getMatchInfo(): { count: number; activeOrdinal: number | null; capped: boolean };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TugTextCardEditorProps {
  /**
   * The card's autosave engine. The editor seeds its document from the
   * store's snapshot at mount, reports edits via `noteEdit`, and
   * attaches the `TextCardBridge` so the store can read the buffer
   * at flush time and replace it on external-change reverts.
   */
  store: TextCardStore;
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
   * deck-wide Text Card defaults and overridden per card by the gear
   * popup; each field reconfigures its compartment live.
   * @default DEFAULT_TEXT_CARD_SETTINGS
   */
  settings?: TextCardSettings;
  /**
   * File extension (no dot) whose grammar to load for syntax
   * highlighting, or null for plain text. The Text card derives this
   * from the file's path, overridable by the status-bar file-type
   * popup. Plain text while the grammar chunk loads.
   */
  languageExt?: string | null;
  /** Forwarded class name. */
  className?: string;
  /**
   * Called when the responder chain receives `FIND` (Cmd-F inside the
   * editor). The Text card wires this to its find-bar toggle.
   */
  onFindRequested?: () => void;
  /**
   * Invoked after this editor's OWN find-navigation handlers run (⌘G /
   * ⇧⌘G handled here because the walk from the focused document reaches
   * this responder first). The host forwards it to the find bar so the
   * count badge tracks navigations made outside the bar.
   */
  onFindNavigated?: () => void;
  /**
   * Route a save-verb chain action (⌘S and the File menu items) up to the
   * card, which owns the save panels and confirm sheets. In manual mode
   * `SAVE` routes here too (the card's `save()` + needs-path panel flow);
   * in automatic mode `SAVE` stays the in-editor `saveNow()` flush.
   */
  onSaveCommand?: (
    command: "save" | "save-as" | "save-a-copy" | "revert-to-saved" | "reload-from-disk",
  ) => void;
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

export const TugTextCardEditor = React.forwardRef<
  TugTextCardEditorDelegate,
  TugTextCardEditorProps
>(function TugTextCardEditor(
  {
    store,
    readOnly = false,
    settings = DEFAULT_TEXT_CARD_SETTINGS,
    languageExt,
    className,
    onFindRequested,
    onFindNavigated,
    onSaveCommand,
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
  const onFindNavigatedRef = useRef<(() => void) | undefined>(onFindNavigated);
  const onSaveCommandRef = useRef<TugTextCardEditorProps["onSaveCommand"]>(onSaveCommand);
  const onStatsRef = useRef<((stats: EditorStats) => void) | undefined>(onStats);
  useLayoutEffect(() => {
    onSaveCommandRef.current = onSaveCommand;
  }, [onSaveCommand]);
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
  useLayoutEffect(() => {
    onFindNavigatedRef.current = onFindNavigated;
  }, [onFindNavigated]);

  // Engine-hook registration — the Text card is an engine-managed card
  // (`engineKind: "em"`), so the activation focus channel resolves through
  // `store.invokeEnginePaintMirrorAsActive`. Without this registration a
  // FRESH text card's activation claim resolves `deferred-engine` forever
  // (nothing ever registers), leaving `document.activeElement` — and every
  // content accelerator (⌘F, ⌘G, clipboard) — stranded on the previous
  // card. The active hook claims real DOM focus on the CM6 view; the
  // resulting `focusin` promotes this editor's responder ([P21] closes the
  // loop). The inactive hook is deliberately a no-op: the text card's
  // deactivated-selection paint is unchanged from its long-standing
  // behavior, and the focus channel only needs the active half.
  const engineCardId = useCardId();
  useLayoutEffect(() => {
    if (engineCardId === null) return;
    const store = getDeckStore();
    if (store === null) return;
    return store.registerEngineHooks(engineCardId, {
      paintMirrorAsActive: () => {
        viewRef.current?.focus();
      },
      paintMirrorAsInactive: () => {},
    });
  }, [engineCardId]);

  // ---- Bridge helpers ----

  const getPositions = useCallback((): FilePositions => {
    const live = viewRef.current;
    if (live === null) {
      return { anchor: { line: 1, ch: 0 }, scrollTop: 0 };
    }
    // Capture BOTH selection ends — the anchor (fixed) and the head
    // (caret). Collapsing to the head here would silently drop a real
    // selection, which [L23] forbids.
    const sel = live.state.selection.main;
    const toLineCh = (offset: number): { line: number; ch: number } => {
      const line = live.state.doc.lineAt(offset);
      return { line: line.number, ch: offset - line.from };
    };
    return {
      anchor: toLineCh(sel.anchor),
      head: toLineCh(sel.head),
      scrollTop: live.scrollDOM.scrollTop,
    };
  }, []);

  const applyPositions = useCallback((positions: FilePositions): void => {
    const live = viewRef.current;
    if (live === null) return;
    const toOffset = (p: { line: number; ch: number }): number => {
      const lineNumber = Math.max(1, Math.min(p.line, live.state.doc.lines));
      const line = live.state.doc.line(lineNumber);
      return line.from + Math.min(p.ch, line.length);
    };
    const anchor = toOffset(positions.anchor);
    // A missing `head` (an older bag, or a fresh open-at-line) restores a
    // collapsed caret at the anchor.
    const head = positions.head === undefined ? anchor : toOffset(positions.head);

    if (positions.scrollTop > 0) {
      // A saved viewport: restore the selection now, then the scroll
      // offset AFTER CM6 has measured the freshly-seeded document. A
      // synchronous `scrollTop =` here lands before CM6 knows the line
      // heights, so it re-measures and clamps and the viewport jumps
      // (the [L23] regression this fixes). `requestMeasure`'s write
      // phase runs once geometry is known — the "scroll last" ordering
      // `card-host.tsx` uses for the same reason. The `alive` capture
      // drops the restore if the card re-anchors before it fires.
      live.dispatch({ selection: { anchor, head } });
      const target = positions.scrollTop;
      live.requestMeasure({
        read: () => null,
        write: (_measured, view) => {
          if (view !== viewRef.current) return;
          view.scrollDOM.scrollTop = target;
        },
      });
      return;
    }
    // No saved viewport (a fresh open-at-line): center the target so a
    // deep-link into a long file lands with the line visible.
    live.dispatch({
      selection: { anchor, head },
      effects: EditorView.scrollIntoView(head, { y: "center" }),
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
        revealFlashField,
        search({ top: true }),
        // Every user edit arms the autosave debounce. Store-driven
        // replacements (external-change reverts) carry the
        // `externalReplace` annotation and must NOT re-arm it.
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const doc = update.state.doc;
            // Lines/chars are O(1) off CM6's rope; the word count is
            // maintained incrementally in O(change size) from the
            // changeset — never a full re-scan (see `word-count.ts`).
            docStatsRef.current = {
              lines: doc.lines,
              chars: doc.length,
              words:
                docStatsRef.current.words +
                wordCountDelta(update.changes, update.startState.doc, doc),
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
        tugTextCardEditorTheme,
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

  const setSearchQueryFn = useCallback((spec: TugTextCardEditorSearchQuery) => {
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

  // Find landing-flash ring + horizontal settle. After every find
  // navigation (typed landing, next, previous):
  //  - if the selected match is fully visible with the scroller panned all
  //    the way LEFT, snap `scrollLeft` to 0 — zero horizontal scroll is
  //    favored over the minimal pan CM6's scrollIntoView leaves behind;
  //  - draw the one-shot accent ring over the match (the Dev card's
  //    landing flash), absolutely positioned in the scroller's content
  //    coordinates so it scrolls with the text and clips at the editor.
  const findFlashRef = useRef<FindFlashHandle | null>(null);
  const removeFindFlash = useCallback((): void => {
    findFlashRef.current?.remove();
    findFlashRef.current = null;
  }, []);
  useLayoutEffect(() => removeFindFlash, [removeFindFlash]);

  const settleFindNavigation = useCallback((): void => {
    const live = viewRef.current;
    if (live === null) return;
    const sel = live.state.selection.main;
    if (sel.empty) return;
    live.requestMeasure({
      read: (view) => {
        const scroller = view.scrollDOM;
        const start = view.coordsAtPos(sel.from, 1);
        const end = view.coordsAtPos(sel.to, -1);
        if (start === null || end === null) return null;
        const rect = scroller.getBoundingClientRect();
        const contentLeft = start.left - rect.left + scroller.scrollLeft;
        const contentRight = end.right - rect.left + scroller.scrollLeft;
        const contentTop = start.top - rect.top + scroller.scrollTop;
        return {
          scroller,
          contentLeft,
          contentTop,
          width: Math.max(contentRight - contentLeft, 8),
          height: Math.max(start.bottom - start.top, 12),
          snapZero:
            scroller.scrollLeft > 0 &&
            contentRight <= scroller.clientWidth - 8,
        };
      },
      write: (m) => {
        if (m === null) return;
        if (m.snapZero) m.scroller.scrollLeft = 0;
        removeFindFlash();
        // Shared placement helper takes VIEWPORT coordinates; convert the
        // measured content-space rect back through the live scroller box.
        const box = m.scroller.getBoundingClientRect();
        findFlashRef.current = placeFindFlash(m.scroller, {
          left: m.contentLeft + box.left + m.scroller.clientLeft - m.scroller.scrollLeft,
          top: m.contentTop + box.top + m.scroller.clientTop - m.scroller.scrollTop,
          width: m.width,
          height: m.height,
        });
      },
    });
  }, [removeFindFlash]);

  const selectFirstMatchFn = useCallback((): void => {
    const live = viewRef.current;
    if (live === null) return;
    const query = getSearchQuery(live.state);
    if (!query.valid) return;
    const first = query.getCursor(live.state).next();
    if (first.done) return;
    live.dispatch({
      selection: EditorSelection.single(first.value.from, first.value.to),
      effects: EditorView.scrollIntoView(
        EditorSelection.range(first.value.from, first.value.to),
        // `x: "nearest"` pans a long unwrapped line to the match; the
        // vertical centre matches the findNext/findPrevious landing.
        { y: "center", x: "nearest" },
      ),
      userEvent: "select.search",
    });
    settleFindNavigation();
  }, [settleFindNavigation]);

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

  const getMatchInfoFn = useCallback((): {
    count: number;
    activeOrdinal: number | null;
    capped: boolean;
  } => {
    const live = viewRef.current;
    if (live === null) return { count: 0, activeOrdinal: null, capped: false };
    const query = getSearchQuery(live.state);
    if (!query.valid) return { count: 0, activeOrdinal: null, capped: false };
    const sel = live.state.selection.main;
    const cursor = query.getCursor(live.state);
    let count = 0;
    let activeOrdinal: number | null = null;
    let capped = false;
    let next = cursor.next();
    while (!next.done) {
      if (next.value.from === sel.from && next.value.to === sel.to) {
        activeOrdinal = count;
      }
      count += 1;
      if (count >= MATCH_INFO_CAP) {
        capped = !cursor.next().done;
        break;
      }
      next = cursor.next();
    }
    return { count, activeOrdinal, capped };
  }, []);

  const revealLineFn = useCallback(
    (startLine: number, endLine?: number): void => {
      const live = viewRef.current;
      if (live === null) return;
      const doc = live.state.doc;
      const sLine = Math.max(1, Math.min(startLine, doc.lines));
      const eLine =
        endLine === undefined
          ? sLine
          : Math.max(sLine, Math.min(endLine, doc.lines));
      const from = doc.line(sLine).from;
      const flashTo = doc.line(eLine).from;
      // Place a PLAIN caret at the first changed line — no persistent
      // selection. The momentary accent flash draws the eye; once it
      // fades, the Active-line highlight (if enabled) settles on the
      // caret's line. Flash spans the changed line(s) start..end.
      live.dispatch({
        selection: { anchor: from },
        effects: [
          EditorView.scrollIntoView(from, { y: "center" }),
          setRevealFlash.of({ from, to: flashTo }),
        ],
      });
      live.focus();
      // Clear the flash after its animation window so it neither lingers
      // nor re-fires on later edits. Guarded against a destroyed view.
      window.setTimeout(() => {
        viewRef.current?.dispatch({ effects: setRevealFlash.of(null) });
      }, REVEAL_FLASH_MS);
    },
    [],
  );

  useImperativeHandle(
    ref,
    (): TugTextCardEditorDelegate => ({
      view: () => viewRef.current,
      focus: () => viewRef.current?.focus(),
      responderId: () => responderId,
      revealLine: revealLineFn,
      setSearchQuery: setSearchQueryFn,
      selectFirstMatch: selectFirstMatchFn,
      clearSearch: clearSearchFn,
      findNext: () => {
        const live = viewRef.current;
        if (live !== null) cmFindNext(live);
        settleFindNavigation();
      },
      findPrevious: () => {
        const live = viewRef.current;
        if (live !== null) cmFindPrevious(live);
        settleFindNavigation();
      },
      getMatchCount: getMatchCountFn,
      getMatchInfo: getMatchInfoFn,
    }),
    [
      revealLineFn,
      setSearchQueryFn,
      selectFirstMatchFn,
      clearSearchFn,
      getMatchCountFn,
      getMatchInfoFn,
      settleFindNavigation,
      responderId,
    ],
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

  // SAVE — automatic mode: flush pending edits now (⌘S forces the debounce
  // to fire). Manual mode: route to the card's save() + needs-path panel
  // flow, since ⌘S must write the REAL file, not the aside.
  //
  // The work runs INLINE (not as a returned continuation): the `save`
  // control action dispatches via `sendToFirstResponder`, which DISCARDS
  // the continuation — a returned `() => …` would silently never run, so
  // File ▸ Save would do nothing.
  const handleSave = useCallback((): ActionHandlerResult => {
    if (storeRef.current.getSnapshot().saveMode === "manual") {
      onSaveCommandRef.current?.("save");
    } else {
      void storeRef.current.saveNow();
    }
  }, []);

  const handleSaveAs = useCallback((): ActionHandlerResult => {
    onSaveCommandRef.current?.("save-as");
  }, []);
  const handleSaveACopy = useCallback((): ActionHandlerResult => {
    onSaveCommandRef.current?.("save-a-copy");
  }, []);
  const handleRevertToSaved = useCallback((): ActionHandlerResult => {
    onSaveCommandRef.current?.("revert-to-saved");
  }, []);
  const handleReloadFromDisk = useCallback((): ActionHandlerResult => {
    onSaveCommandRef.current?.("reload-from-disk");
  }, []);

  const handleFind = useCallback((): ActionHandlerResult => {
    onFindRequestedRef.current?.();
  }, []);

  const handleFindNext = useCallback((): ActionHandlerResult => {
    const live = viewRef.current;
    if (live !== null) cmFindNext(live);
    onFindNavigatedRef.current?.();
  }, []);

  const handleFindPrevious = useCallback((): ActionHandlerResult => {
    const live = viewRef.current;
    if (live !== null) cmFindPrevious(live);
    onFindNavigatedRef.current?.();
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
    [TUG_ACTIONS.SAVE_AS]: handleSaveAs,
    [TUG_ACTIONS.SAVE_A_COPY]: handleSaveACopy,
    [TUG_ACTIONS.REVERT_TO_SAVED]: handleRevertToSaved,
    [TUG_ACTIONS.RELOAD_FROM_DISK]: handleReloadFromDisk,
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
        data-slot="tug-text-card-editor"
        data-tug-select="custom"
        className={cn("tug-text-card-editor", className)}
      />
      {contextMenu}
    </ResponderScope>
  );
});
