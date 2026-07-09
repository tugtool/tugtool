/**
 * tug-file-editor/theme.ts — `EditorView.theme` extension for the File
 * card's editing surface.
 *
 * Follows the same token strategy as `tugCodeViewTheme` (the read-only
 * sibling): code typography rides the shared `--tugx-block-*` family,
 * editor-local concerns (gutter, selection, caret, search-match tints)
 * ride `--tugx-fileeditor-*` slots declared in `tug-file-editor.css`.
 * All rules read CSS variables directly so brio ↔ harmony theme
 * switches propagate without remount.
 *
 * Caret and selection are NATIVE — unlike `tug-text-editor`, which
 * paints custom caret/selection layers because atom widgets stale
 * WebKit's caret paint cache and need blur-surviving selection divs.
 * A plain-text file editor has neither problem: the native caret is
 * recolored via `caretColor`, and native `::selection` paints ranges.
 *
 * Full-height: the editor root fills its host and the `.cm-scroller`
 * owns scrolling — the File card's body is the fixed viewport and the
 * document scrolls inside it (CM6's viewport virtualization handles
 * large files from this configuration).
 *
 * Laws: [L06] appearance via CSS/DOM; [L16] rules pair element +
 * surface (or inherit an enclosing surface); [L17]/[L20] editor-local
 * slots resolve to base tokens in one hop in `tug-file-editor.css`.
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export const tugFileEditorTheme: Extension = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--tugx-fileeditor-bg)",
    color: "var(--tugx-block-text-color)",
    fontFamily: "var(--tugx-block-code-font)",
    fontSize: "var(--tugx-block-code-font-size)",
    lineHeight: "var(--tugx-block-code-line-height)",
    outline: "none",
  },
  // The scroller is the ONE scrolling surface for the document. The
  // stable gutter reserves scrollbar space so toggling overflow doesn't
  // jitter line layout.
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--tugx-block-code-font)",
    lineHeight: "var(--tugx-block-code-line-height)",
    scrollbarGutter: "stable",
  },
  ".cm-content": {
    caretColor: "var(--tugx-fileeditor-caret)",
    color: "var(--tugx-block-text-color)",
    padding: "var(--tugx-fileeditor-content-padding)",
  },
  ".cm-line": {
    padding: "0 var(--tugx-fileeditor-line-padding-x)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "var(--tugx-fileeditor-gutter-bg)",
    borderRight: "1px solid var(--tugx-fileeditor-gutter-border)",
    color: "var(--tugx-fileeditor-gutter-text)",
    fontFamily: "var(--tugx-block-code-font)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 var(--tugx-fileeditor-gutter-padding-x)",
    minWidth: "var(--tugx-fileeditor-gutter-min-width)",
  },
  // Fold gutter (CM6 `foldGutter()`): center each chevron in its line
  // box and give it breathing room + a pointer, so the ⌄/› markers sit
  // cleanly beside the line numbers instead of crowding them.
  ".cm-foldGutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 var(--tug-space-2xs)",
    color: "var(--tugx-fileeditor-gutter-text)",
    cursor: "pointer",
  },
  // The inline "…" placeholder shown in place of a folded range.
  ".cm-foldPlaceholder": {
    margin: "0 var(--tug-space-2xs)",
    padding: "0 var(--tug-space-xs)",
    backgroundColor: "var(--tugx-fileeditor-gutter-bg)",
    border: "1px solid var(--tugx-fileeditor-gutter-border)",
    borderRadius: "3px",
    color: "var(--tugx-fileeditor-gutter-text)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--tugx-fileeditor-active-line-bg)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--tugx-fileeditor-active-line-bg)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--tugx-fileeditor-selection-bg)",
  },
  // CM6's bundled search panel stays mounted-but-hidden: mounting
  // initializes the search state's `panel` field, which the match
  // highlighter requires before painting decorations. The Tug find UI
  // is host chrome driven through the delegate (same pattern as
  // `TugCodeView`).
  ".cm-panels": {
    display: "none",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--tugx-fileeditor-match-bg)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--tugx-fileeditor-match-active-bg)",
    outline: "1px solid var(--tugx-fileeditor-match-active-outline)",
  },
});
