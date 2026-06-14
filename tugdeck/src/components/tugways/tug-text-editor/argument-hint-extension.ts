/**
 * tug-text-editor/argument-hint-extension.ts — the ghost-text argument
 * placeholder shown after an accepted slash-command atom.
 *
 * When the document is exactly one command atom and no arguments have been
 * typed yet (`/devise` alone), this paints a muted ghost slot after it —
 * `/devise ┆ type arguments…` — so the next thing to type is obvious. The
 * moment the user types a non-whitespace character the slot disappears (the
 * doc no longer matches), the same way a CodeMirror empty-state placeholder
 * clears on first keystroke.
 *
 * What to show is decided by {@link resolveArgumentHint} (pure, in
 * `lib/slash-argument-hint.ts`); the *lookup* from an atom's value to a
 * command's catalog category / explicit hint / local `takesArgs` flag is the
 * host's concern, injected through {@link argumentHintResolverFacet} as a
 * resolver thunk (mirroring how `atomBytesStoreFacet` injects the bytes
 * store). An editor with no resolver registered (gallery, standalone) gets
 * the no-op default and never paints a slot.
 *
 * Laws:
 *  - [L06] the ghost text is appearance only — a `Decoration.widget` whose
 *    DOM carries `aria-hidden` and no editable content; it never enters the
 *    document, the wire payload, or the editing-state snapshot.
 *  - [L20] color/spacing ride `--tug*` tokens via the `baseTheme` block.
 *  - [L22] the placeholder is a `StateField`-free `ViewPlugin` reading the
 *    live document + the resolver facet; no React, no store round-trip.
 *
 * @module components/tugways/tug-text-editor/argument-hint-extension
 */

import { Facet } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, PluginValue, ViewUpdate } from "@codemirror/view";

import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";

import { getAtomsInState } from "./atom-decoration";

/**
 * Resolve an accepted command atom's value (e.g. `"tugplug:devise"`) to the
 * argument placeholder it should show, or `null` for a command that takes no
 * arguments. The host builds this from its command catalog + local registry.
 */
export type ArgumentHintResolver = (commandValue: string) => string | null;

const NO_HINT: ArgumentHintResolver = () => null;

/**
 * CM6 facet injecting the host's {@link ArgumentHintResolver} as a thunk, so
 * the plugin reads the live resolver (which itself reads the live catalog) at
 * compute time. An editor that never registers it gets the no-op default.
 */
export const argumentHintResolverFacet = Facet.define<
  () => ArgumentHintResolver,
  () => ArgumentHintResolver
>({
  combine: (values) => (values.length > 0 ? values[0]! : () => NO_HINT),
});

/** Ghost-text widget — non-editable, screen-reader-hidden placeholder. */
class ArgumentHintWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: ArgumentHintWidget): boolean {
    return other.text === this.text;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-tug-arg-hint";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    return span;
  }

  /** Ghost text is inert — never intercept selection / pointer events. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Build the placeholder decoration for the current state, or `Decoration.none`
 * when the doc isn't "a lone command atom awaiting arguments."
 */
function computeArgumentHint(view: EditorView): DecorationSet {
  const atoms = getAtomsInState(view.state);
  if (atoms.length !== 1) return Decoration.none;
  const atom = atoms[0]!;
  if (atom.segment.type !== "command") return Decoration.none;

  // Only before any argument is typed: everything in the doc besides the
  // atom's own U+FFFC placeholder must be whitespace.
  const doc = view.state.doc.toString();
  const withoutAtom = doc.split(TUG_ATOM_CHAR).join("");
  if (withoutAtom.trim() !== "") return Decoration.none;

  const resolve = view.state.facet(argumentHintResolverFacet)();
  const hint = resolve(atom.segment.value);
  if (hint === null) return Decoration.none;

  // Anchor at the document end (after the atom + any trailing space), biased
  // to the right so the caret sits before it.
  return Decoration.set([
    Decoration.widget({
      widget: new ArgumentHintWidget(hint),
      side: 1,
    }).range(view.state.doc.length),
  ]);
}

/**
 * The placeholder plugin. Recomputes on any document change (acceptance,
 * typing args, clearing) and on focus changes; the candidate doc is tiny so
 * the recompute is free.
 */
export const argumentHintPlugin = ViewPlugin.fromClass(
  class implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = computeArgumentHint(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.focusChanged) {
        this.decorations = computeArgumentHint(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** [L20] ghost-text appearance — muted field text, a small leading gap. */
export const argumentHintTheme = EditorView.baseTheme({
  ".cm-tug-arg-hint": {
    color: "var(--tug7-element-field-text-normal-plain-disabled)",
    marginLeft: "var(--tug-space-2xs, 0.25rem)",
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "pre",
  },
});
