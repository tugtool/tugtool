/**
 * tug-text-editor/inline-command-completion.ts — the mid-text slash-command
 * inline ghost completion.
 *
 * A slash command runs only when it leads the message. Typed anywhere else
 * (`hello /rewi…`) it is plain text that will never run, so the Session card does
 * not open the full descriptive popup there. It instead mirrors the terminal:
 * a single muted **ghost suffix** of the best-matching command, painted after
 * the caret, that the user accepts with Tab or → to fill in as ordinary text —
 * never a chip (a chip would imply the command runs).
 *
 * Split of concerns (mirrors `argument-hint-extension`):
 *  - the *decision* — whether a ghost shows and what its suffix is — is the
 *    pure {@link computeInlineGhost} (in `lib/inline-command-ghost.ts`);
 *  - the *catalog lookup* — query → best full-name prefix completion — is the
 *    host's concern, injected as a thunk through {@link inlineCommandMatcherFacet}
 *    so the plugin reads the live catalog at compute time. An editor that
 *    registers no matcher (gallery, standalone) gets the no-op default and
 *    never paints a ghost.
 *
 * Why this never disturbs the descriptive popup: the popup owns offset 0 and
 * the ghost owns mid-text (`computeInlineGhost` returns null at offset 0), so
 * exactly one is ever live. The accept keymap claims Tab / → only when a ghost
 * is actually present (it recomputes and returns false otherwise), the same
 * single-predicate rule the popup keymap uses for key ownership — so submit,
 * caret motion, and focus moves are never swallowed when no ghost is showing.
 *
 * Laws:
 *  - [L06] the ghost is appearance only — a `Decoration.widget` carrying
 *    `aria-hidden` and no editable content; it never enters the document, the
 *    wire payload, or the editing-state snapshot until the user accepts it
 *    (which inserts plain text through a normal transaction).
 *  - [L20] color / spacing ride `--tug*` tokens via the `baseTheme` block.
 *  - [L22] the ghost is a `StateField`-free `ViewPlugin` reading the live doc +
 *    selection + the matcher facet; no React, no store round-trip.
 *
 * @module components/tugways/tug-text-editor/inline-command-completion
 */

import { Facet, Prec } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
} from "@codemirror/view";
import type {
  Command,
  DecorationSet,
  KeyBinding,
  PluginValue,
  ViewUpdate,
} from "@codemirror/view";

import {
  computeInlineGhost,
  type InlineCommandMatcher,
  type InlineGhost,
} from "@/lib/inline-command-ghost";

const NO_MATCH: InlineCommandMatcher = () => null;

/**
 * CM6 facet injecting the host's {@link InlineCommandMatcher} as a thunk, so
 * the plugin reads the live matcher (which reads the live catalog) at compute
 * time. An editor that never registers it gets the no-op default.
 */
export const inlineCommandMatcherFacet = Facet.define<
  () => InlineCommandMatcher,
  () => InlineCommandMatcher
>({
  combine: (values) => (values.length > 0 ? values[0]! : () => NO_MATCH),
});

/** Muted, inert ghost-suffix widget — non-editable, screen-reader-hidden. */
class InlineGhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: InlineGhostWidget): boolean {
    return other.text === this.text;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-tug-inline-ghost";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * The live inline ghost for the view's current doc + caret, or `null`. Shared
 * by the painting plugin and the accept keymap so both agree on exactly one
 * decision. Requires a focused, collapsed caret — a range selection or a blurred
 * editor never ghosts.
 */
export function currentInlineGhost(view: EditorView): InlineGhost | null {
  if (!view.hasFocus) return null;
  const sel = view.state.selection.main;
  if (sel.from !== sel.to) return null;
  const matcher = view.state.facet(inlineCommandMatcherFacet)();
  return computeInlineGhost(view.state.doc.toString(), sel.head, matcher);
}

/** Build the ghost decoration for the current state, or `Decoration.none`. */
function computeDecoration(view: EditorView): DecorationSet {
  const ghost = currentInlineGhost(view);
  if (ghost === null) return Decoration.none;
  return Decoration.set([
    Decoration.widget({
      widget: new InlineGhostWidget(ghost.suffix),
      side: 1,
    }).range(ghost.caret),
  ]);
}

/**
 * The ghost-painting plugin. Recomputes on any doc change, caret move, or
 * focus change — the candidate scan is a few characters back from the caret,
 * so the recompute is free.
 */
export const inlineCommandGhostPlugin = ViewPlugin.fromClass(
  class implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = computeDecoration(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        this.decorations = computeDecoration(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * Accept the current inline ghost: insert its suffix as plain text at the
 * caret, follow it with a separating space, and move the caret past the
 * space. The trailing space mirrors the descriptive popup's accept
 * (`acceptCompletionAt`) so the user's next keystroke doesn't glue onto the
 * completed command name; it is skipped when a space already follows the
 * caret, to avoid a double space mid-text. A no-op (returns `false`) when no
 * ghost is present, so the bound keys fall through to their normal behavior
 * (Tab → focus move, → → caret right).
 */
export const acceptInlineGhost: Command = (view) => {
  const ghost = currentInlineGhost(view);
  if (ghost === null) return false;
  const hasTrailingSpace =
    view.state.doc.sliceString(ghost.caret, ghost.caret + 1) === " ";
  const insert = hasTrailingSpace ? ghost.suffix : ghost.suffix + " ";
  view.dispatch({
    changes: { from: ghost.caret, insert },
    // Past the one separating space — whether we just inserted it or it was
    // already there — so typing continues after the gap, not against the name.
    selection: { anchor: ghost.caret + ghost.suffix.length + 1 },
    userEvent: "input.complete.tug-inline-command",
    scrollIntoView: true,
  });
  return true;
};

const inlineGhostBindings: readonly KeyBinding[] = [
  { key: "Tab", run: acceptInlineGhost },
  { key: "ArrowRight", run: acceptInlineGhost },
];

/**
 * Accept keymap for the inline ghost. `Prec.highest` so it sees Tab / → before
 * the default keymap; each binding yields (returns false) when no ghost is
 * present, so it claims a key only in the moment a ghost is on screen.
 */
export const inlineCommandGhostKeymap = Prec.highest(
  keymap.of([...inlineGhostBindings]),
);

/** [L20] ghost-text appearance — muted field text, inert to pointer / select. */
export const inlineCommandGhostTheme = EditorView.baseTheme({
  ".cm-tug-inline-ghost": {
    color: "var(--tug7-element-field-text-normal-plain-disabled)",
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "pre",
  },
});
