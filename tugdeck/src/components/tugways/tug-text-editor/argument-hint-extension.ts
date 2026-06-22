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

import { Facet, StateEffect } from "@codemirror/state";
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

  // Anchor at the caret (selection head), biased right so the slot renders
  // immediately *after* the caret — the user types the argument into the gap
  // before the ghost text. Anchoring at the caret (rather than the document
  // end) keeps the slot on the caret's line and to its right regardless of
  // trailing whitespace: acceptance leaves a trailing space (caret past it),
  // and a trailing newline at doc end would otherwise both push the slot onto
  // a second line and strand the caret before it.
  const caret = view.state.selection.main.head;
  return Decoration.set([
    Decoration.widget({
      widget: new ArgumentHintWidget(hint),
      side: 1,
    }).range(caret),
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
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      refreshed
    ) {
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
