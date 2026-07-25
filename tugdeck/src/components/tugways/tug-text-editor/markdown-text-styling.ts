/**
 * tug-text-editor/markdown-text-styling.ts — the shared "light markdown
 * formatting" capability for the `TugTextEditor` substrate.
 *
 * Styles markdown *visually* without ever removing or hiding the raw
 * syntax: heading / emphasis / strong / inline-code / link tokens take
 * their colors and weights from the shared highlight style (the `#`, `*`,
 * `` ` `` markers stay in the buffer and on screen), and a wrapped list
 * item's continuation lines hang-indent under the item content.
 *
 * Styling only — deliberately NOT markdown *editing* behavior. The parser
 * configuration that expresses this lives in
 * {@link markdownTextStyleSupport}, shared with the read-only filter so both
 * forms of the scheme parse one dialect: `addKeymap` and `pasteURLAsLink` off
 * (the markdown keymap would take Enter on list lines and break
 * submit-on-Return; the paste handler would fight the substrate's own
 * `clipboardExtension`), `completeHTMLTags` off (the substrate runs its own
 * typeahead), and `autoCloseTags` off on the HTML sub-language.
 *
 * The grammar is a static import, so this resolves an already-built value.
 * The `Promise<Extension>` signature stays because the substrate's enable
 * effect is written around it, and because the bundle is a natural place for
 * a future lazily-loaded piece.
 *
 * @module components/tugways/tug-text-editor/markdown-text-styling
 */

import type { Extension } from "@codemirror/state";
import { tugEditingHighlightStyle } from "@/lib/language-registry";
import { markdownTextStyleSupport } from "@/lib/markdown-text-style-grammar";
import { mdCodeBlockMono } from "./code-block-mono";
import { mdListHangingIndent } from "./list-hanging-indent";

/**
 * Resolve the styling-only markdown extension bundle.
 *
 * The language support supplies the grammar (so the highlight style has
 * tags to color and the line plugins have nodes to key off); the highlight
 * style paints the tokens; the hanging indent aligns wrapped list
 * continuations; the code-block mono plugin gives code-block lines the code
 * face. Raw markdown syntax is never hidden or removed.
 */
export function loadMarkdownTextStyling(): Promise<Extension> {
  return Promise.resolve([
    markdownTextStyleSupport,
    tugEditingHighlightStyle,
    mdListHangingIndent,
    mdCodeBlockMono,
  ]);
}
