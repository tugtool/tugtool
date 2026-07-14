/**
 * tug-text-editor/list-hanging-indent.ts — soft-wrap hanging indent
 * for markdown list items.
 *
 * When soft wrap is on, a long list item wraps its continuation lines
 * back to the left margin, so they run underneath the `-`/`1.` marker
 * and the eye loses the item boundary. This extension gives each list
 * line a hanging indent: the wrapped continuation is pushed right by the
 * width of the marker plus its trailing space, so it aligns under the
 * item's first content character (both bullet and ordered lists).
 *
 * Mechanism ([L06] — appearance through the DOM, via decorations): a
 * `Decoration.line` sets `padding-left: N ch` (indents the whole block,
 * so wrapped lines start at N) and `text-indent: -N ch` (pulls the FIRST
 * visual line back by N, cancelling the padding for it). N is measured in
 * `ch`. On a monospace surface (the Text card) the marker glyphs occupy
 * exactly those N cells, so the first line reads flush and only the wrap
 * hangs. On a proportional surface (e.g. the prompt entry under IBM Plex
 * Sans) `1ch` is the width of `0`, so the indent approximates rather than
 * exactly matches the marker width — accepted by design: a wrapped
 * continuation still lands under the content rather than the margin, which
 * is the whole point, and per-font marker measurement is complexity this
 * effect doesn't earn.
 *
 * Scope: list lines are identified from the markdown syntax tree
 * (`ListMark` nodes), so this only fires in markdown documents and never
 * misreads a `-`/`1.` at the head of a wrapped code line. Bundled with the
 * markdown grammar wherever it is installed, so it is live exactly when
 * markdown styling + soft wrap are both on.
 *
 * @module components/tugways/tug-text-editor/list-hanging-indent
 */

import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { language, syntaxTree } from "@codemirror/language";

/**
 * The list prefix: optional leading indent, a bullet (`-`/`*`/`+`) or an
 * ordered marker (`1.`/`1)`), then the run of spaces before the item's
 * content. Its length is the hanging-indent width, in monospace cells.
 */
const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+)/;

/** Reuse one decoration per indent width (CM6 prefers stable objects). */
const decoCache = new Map<number, Decoration>();

function lineDecoForIndent(indent: number): Decoration {
  let deco = decoCache.get(indent);
  if (deco === undefined) {
    deco = Decoration.line({
      attributes: {
        style: `text-indent:-${indent}ch;padding-left:${indent}ch`,
      },
    });
    decoCache.set(indent, deco);
  }
  return deco;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const { doc } = view.state;
  // Walk only the viewport. `ListMark` nodes appear in ascending
  // position, so the line starts we add stay sorted for the builder.
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "ListMark") return;
        const line = doc.lineAt(node.from);
        const match = LIST_PREFIX.exec(line.text);
        // Fall back to marker-end + one space if the regex somehow misses
        // (e.g. a tab after the marker), so a list line always indents.
        const indent = match ? match[1].length : node.to - line.from + 1;
        builder.add(line.from, line.from, lineDecoForIndent(indent));
      },
    });
  }
  return builder.finish();
}

/**
 * Hanging-indent decorations for markdown list items. Rebuilds on doc
 * or viewport change, and when the language facet flips (so it engages
 * once the lazily-loaded markdown grammar is installed).
 */
export const mdListHangingIndent: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.startState.facet(language) !== update.state.facet(language)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
