/**
 * tug-text-editor/argument-hint-extension.ts — the argument placeholder shown
 * after an accepted slash-command atom.
 *
 * When the document is exactly one command atom and no arguments have been
 * typed yet (`/devise` alone), this paints a muted hint after the chip —
 * `/devise ┆ type arguments…` — so the next thing to type is obvious. The
 * moment the user types a real argument the hint disappears (the doc no longer
 * matches), the same way a CodeMirror empty-state placeholder clears.
 *
 * Why a line decoration + CSS `::after`, not a widget. An input placeholder is
 * pure appearance — it marks where the argument goes; it is never content. A
 * `Decoration.widget` would give it a real document offset, which puts it in
 * competition with the caret and with typed whitespace: anchored at the caret
 * it chases arrow-keys, anchored at a fixed offset the caret advances *past* it
 * on the next space. There is no correct offset because the premise is wrong.
 * Instead this attaches a class + the hint text (as a `data-` attribute) to the
 * chip's *line* and renders the text through a `::after` pseudo-element. A
 * pseudo-element is painted after all of the line's real content and has no
 * document offset at all, so the native caret — which only ever sits at offsets
 * `0..docLength` — is structurally incapable of landing on the far side of it.
 * Arrow keys, spacebar, anything: the caret stays in the real text and the hint
 * is always painted after the chip. (This is how CM's stock placeholder stays
 * inert for empty docs.)
 *
 * What to show is decided by {@link resolveArgumentHint} (pure, in
 * `lib/slash-argument-hint.ts`); the *lookup* from an atom's value to a
 * command's catalog category / explicit hint / local `takesArgs` flag is the
 * host's concern, injected through {@link argumentHintResolverFacet} as a
 * resolver thunk (mirroring how `atomBytesStoreFacet` injects the bytes
 * store). An editor with no resolver registered (gallery, standalone) gets
 * the no-op default and never paints a hint.
 *
 * Laws:
 *  - [L06] the hint is appearance only — a `Decoration.line` adding a class +
 *    `data-` attribute whose text surfaces via a CSS pseudo-element; nothing
 *    enters the document, the wire payload, or the editing-state snapshot.
 *  - [L20] color/spacing ride `--tug*` tokens via the `baseTheme` block.
 *  - [L22] the placeholder is a `StateField`-free `ViewPlugin` reading the
 *    live document + the resolver facet; no React, no store round-trip.
 *
 * @module components/tugways/tug-text-editor/argument-hint-extension
 */

import { Facet, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
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

/**
 * A minimal store-like source the plugin can subscribe to so a hint refreshes
 * when its backing data lands *after* the slot was already painted. The host
 * passes its `SessionMetadataStore` here (any `{ subscribe }` satisfies it):
 * the command catalog arrives asynchronously, so a command accepted before the
 * catalog loads first resolves to the generic slot — without this signal the
 * `ViewPlugin` would never recompute (it only reacts to doc / focus changes),
 * leaving the generic text frozen even once the explicit hint is known.
 */
export interface ArgumentHintRefreshSource {
  /** Register a listener for data changes; returns an unsubscribe thunk. */
  subscribe(listener: () => void): () => void;
}

/**
 * CM6 facet injecting the host's {@link ArgumentHintRefreshSource} as a thunk,
 * mirroring {@link argumentHintResolverFacet}. An editor that never registers
 * it (gallery / standalone, whose catalog is static) gets the `null` default
 * and the plugin simply never subscribes.
 */
export const argumentHintRefreshFacet = Facet.define<
  () => ArgumentHintRefreshSource | null,
  () => ArgumentHintRefreshSource | null
>({
  combine: (values) => (values.length > 0 ? values[0]! : () => null),
});

/**
 * Empty effect dispatched when the refresh source fires; its only job is to
 * carry a transaction the plugin's `update` recognizes as "recompute the hint"
 * (the catalog changed without any doc / focus change to piggyback on).
 */
const refreshArgumentHintEffect = StateEffect.define<void>();

/** The `data-` attribute the `::after` rule reads the hint text from. */
const HINT_ATTR = "data-tug-arg-hint";

/**
 * Build the placeholder decoration for the current state, or `Decoration.none`
 * when the doc isn't "a lone command atom awaiting arguments."
 *
 * The decoration is a `Decoration.line` on the chip's line — it adds a class
 * and carries the hint text in a `data-` attribute the `::after` rule renders.
 * Because the text lives in a pseudo-element (not a widget at a document
 * offset), the caret can never sit on the far side of it: it is painted after
 * whatever real content the line holds, wherever the caret happens to be.
 */
function computeArgumentHint(view: EditorView): DecorationSet {
  const atoms = getAtomsInState(view.state);
  if (atoms.length !== 1) return Decoration.none;
  const atom = atoms[0]!;
  if (atom.segment.type !== "command") return Decoration.none;

  // Only before any argument is typed. The "empty" state is exactly the chip
  // plus the single separating space acceptance leaves (or none, if a space
  // already followed) — so the only allowed non-atom content is "" or " ". The
  // first character the user types, *including a space*, ends it and clears the
  // hint, like any input placeholder; a looser whitespace test would instead
  // let a typed space slide the hint rightward without dismissing it.
  const doc = view.state.doc.toString();
  const withoutAtom = doc.split(TUG_ATOM_CHAR).join("");
  if (withoutAtom !== "" && withoutAtom !== " ") return Decoration.none;

  const resolve = view.state.facet(argumentHintResolverFacet)();
  const hint = resolve(atom.segment.value);
  if (hint === null) return Decoration.none;

  // Attach to the line holding the chip; the `::after` paints the hint after
  // the line's content (the chip + its separating space), so it follows the
  // chip regardless of where the caret is and never wraps onto a second line
  // for any trailing whitespace the doc carries.
  const lineStart = view.state.doc.lineAt(atom.position).from;
  return Decoration.set([
    Decoration.line({
      class: "cm-tug-arg-hint-line",
      attributes: { [HINT_ATTR]: hint },
    }).range(lineStart),
  ]);
}

/**
 * The placeholder plugin. Recomputes on any document change (acceptance,
 * typing args, clearing) and on focus changes; the candidate doc is tiny so
 * the recompute is free.
 *
 * It also subscribes to the {@link argumentHintRefreshFacet} source so a
 * command accepted *before* its catalog entry loads upgrades from the generic
 * slot to the explicit hint the moment the catalog lands — the source fires,
 * the plugin dispatches {@link refreshArgumentHintEffect}, and the resulting
 * transaction recomputes against the now-current resolver. Without it the slot
 * would freeze at whatever the resolver returned the instant the atom appeared.
 */
class ArgumentHintPluginValue implements PluginValue {
  decorations: DecorationSet;
  private unsubscribe: (() => void) | null = null;
  private subscribedSource: ArgumentHintRefreshSource | null = null;

  constructor(private readonly view: EditorView) {
    this.decorations = computeArgumentHint(view);
    this.syncSubscription();
  }

  update(update: ViewUpdate): void {
    const refreshed = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(refreshArgumentHintEffect)),
    );
    if (update.docChanged || update.focusChanged || refreshed) {
      this.decorations = computeArgumentHint(update.view);
    }
    // The facet's thunk reads a host ref the card swaps on rebind (e.g. a
    // `/compact` + resume mints a fresh metadata store); re-evaluate so we
    // never stay bound to a dead source. Idempotent when unchanged.
    this.syncSubscription();
  }

  destroy(): void {
    this.unsubscribeCurrent();
  }

  /** Subscribe to the source the facet currently returns; idempotent. */
  private syncSubscription(): void {
    const source = this.view.state.facet(argumentHintRefreshFacet)();
    if (source === this.subscribedSource) return;
    this.unsubscribeCurrent();
    if (source === null) return;
    this.subscribedSource = source;
    const view = this.view;
    this.unsubscribe = source.subscribe(() => {
      // Only the explicit-effect transaction matters; recompute happens in
      // `update`. Dispatching from a store callback is outside CM's update
      // cycle, so this is the normal, safe way to re-enter it.
      view.dispatch({ effects: refreshArgumentHintEffect.of() });
    });
  }

  private unsubscribeCurrent(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.subscribedSource = null;
  }
}

export const argumentHintPlugin = ViewPlugin.fromClass(ArgumentHintPluginValue, {
  decorations: (plugin) => plugin.decorations,
});

/**
 * [L20] placeholder appearance — the hint text rides a `::after` pseudo-element
 * on the chip's line, reading its content from the `data-` attribute the line
 * decoration sets. A pseudo-element is inert: not selectable, not hit-tested,
 * not a caret position — exactly the input-placeholder semantics we want. Muted
 * field text, a small leading gap, `pre` so the hint keeps its literal spaces.
 */
export const argumentHintTheme = EditorView.baseTheme({
  ".cm-tug-arg-hint-line::after": {
    content: `attr(${HINT_ATTR})`,
    color: "var(--tug7-element-field-text-normal-plain-disabled)",
    marginLeft: "var(--tug-space-2xs, 0.25rem)",
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "pre",
  },
});
