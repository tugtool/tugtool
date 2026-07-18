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
 * Styling only — deliberately NOT markdown *editing* behavior. The default
 * `markdown()` bundle pushes `Prec.high(keymap.of(markdownKeymap))` (Enter →
 * `insertNewlineContinueMarkup`, Backspace → `deleteMarkupBackward`) and a
 * `pasteURLAsLink` paste handler. At equal `Prec.high` the markdown keymap
 * would win by extension order over `tugTextEditorKeymap` and change Enter
 * on list lines (breaking submit-on-Return in the prompt entry), and the
 * paste handler would fight the substrate's own `clipboardExtension`. So the
 * grammar loads with `addKeymap: false` and `pasteURLAsLink: false`.
 * `completeHTMLTags: false` drops the autocomplete source the substrate
 * doesn't use (it runs its own typeahead), keeping the bundle minimal.
 *
 * The `@codemirror/lang-markdown` grammar chunk is lazy-loaded and the
 * resulting bundle is cached module-wide, so every editor that turns the
 * capability on shares one import and one `markdown(...)` instantiation.
 *
 * @module components/tugways/tug-text-editor/markdown-text-styling
 */

import type { Extension } from "@codemirror/state";
import { tugEditingHighlightStyle } from "@/lib/language-registry";
import { mdListHangingIndent } from "./list-hanging-indent";

/**
 * One shared promise for the whole app: the first caller triggers the
 * dynamic import + `markdown(...)` instantiation; every later caller awaits
 * the same resolved bundle.
 */
let bundlePromise: Promise<Extension> | null = null;

/**
 * Resolve the styling-only markdown extension bundle:
 * `[markdownLanguage, tugEditingHighlightStyle, mdListHangingIndent]`.
 *
 * The language support supplies the grammar (so the highlight style has
 * tags to color and the hanging indent has `ListMark` nodes to key off);
 * the highlight style paints the tokens; the hanging indent aligns wrapped
 * list continuations. Raw markdown syntax is never hidden or removed.
 */
export function loadMarkdownTextStyling(): Promise<Extension> {
  if (bundlePromise === null) {
    const attempt: Promise<Extension> = import("@codemirror/lang-markdown").then(
      (m) => [
        m.markdown({
          addKeymap: false,
          pasteURLAsLink: false,
          completeHTMLTags: false,
        }),
        tugEditingHighlightStyle,
        mdListHangingIndent,
      ],
    );
    // A rejected dynamic import — a chunk fetch that 404s or 500s while the
    // dev server is mid-rebuild, a transient network drop — must NOT be
    // cached. Without this the module-level `bundlePromise` would hold a
    // permanently-rejected promise, so every editor mounted for the rest of
    // the page's life awaits that same rejection and silently renders
    // unstyled markdown (the "sometimes randomly doesn't apply" bite). Clear
    // the slot on failure so the next caller re-attempts a fresh import, and
    // re-throw so the awaiting effect can observe (and retry) the rejection.
    bundlePromise = attempt.catch((err) => {
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}
