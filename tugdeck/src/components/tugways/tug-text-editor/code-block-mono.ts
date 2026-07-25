/**
 * tug-text-editor/code-block-mono.ts — the code face for markdown code
 * blocks.
 *
 * The `monospace` tag carries the face for inline code and for a fence with
 * no inner grammar, but a fence that declares a language is tokenized by that
 * language's grammar, so its runs carry `keyword`/`string`/`number` tags and
 * no `monospace` at all. A tag-level family alone would therefore give an
 * *unhighlighted* fence the code face and take it away from a *highlighted*
 * one. This extension carries the face per line instead, which is independent
 * of how the body was tokenized.
 *
 * Mechanism ([L06] — appearance through the DOM, via decorations): a
 * `Decoration.line` on every line of a `FencedCode` or `CodeBlock` node,
 * fence delimiters included so the block reads as one. Family only: size,
 * leading, and color stay the host's, per the scheme's rule that a uniform
 * line box is what keeps these surfaces reading as text.
 *
 * The rule rides in an `EditorView.baseTheme` bundled here, so no CSS file
 * needs to know this extension exists.
 *
 * @module components/tugways/tug-text-editor/code-block-mono
 */

import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { language, syntaxTree } from "@codemirror/language";

const codeLineDeco = Decoration.line({ class: "tug-md-code-line" });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const { doc } = view.state;
  // Line starts must reach the builder in ascending order. Code-block nodes
  // arrive in ascending position and cannot overlap, so walking each node's
  // lines in order keeps the sequence sorted. A node may begin before the
  // viewport, so clamp to the visible range rather than skipping the node.
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        const first = doc.lineAt(Math.max(node.from, from));
        const last = doc.lineAt(Math.min(node.to, to));
        for (let n = first.number; n <= last.number; n++) {
          const line = doc.line(n);
          builder.add(line.from, line.from, codeLineDeco);
        }
      },
    });
  }
  return builder.finish();
}

/**
 * The code face for markdown code-block lines. Rebuilds on doc or viewport
 * change, and when the language facet flips, so it engages as soon as the
 * markdown grammar is installed.
 */
export const mdCodeBlockMono: Extension = [
  ViewPlugin.fromClass(
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
  ),
  EditorView.baseTheme({
    ".tug-md-code-line": {
      fontFamily: "var(--tug-font-family-mono)",
    },
  }),
];
