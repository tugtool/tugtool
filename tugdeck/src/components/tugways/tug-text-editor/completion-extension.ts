/**
 * tug-text-editor/completion-extension.ts — typeahead completion engine.
 *
 * Detects a registered trigger character (`@`, `/`, etc. — supplied by
 * the host via `completionProviders`), opens a popup of matching
 * items, tracks the query string between the trigger and the caret,
 * navigates with arrow keys / Page / Home / End, and on Enter or Tab
 * inserts the chosen item as a tug atom — replacing the trigger +
 * query range with U+FFFC and a matching `AtomWidget` decoration in
 * a single transaction.
 *
 * Architecture:
 *
 *   - **State**: a `StateField` (`completionField`) holds the current
 *     typeahead snapshot — active flag, trigger char, anchor offset,
 *     query, filtered items, selected index, and the live provider.
 *     The field's `update` is pure — every side effect (subscribing
 *     to async providers, painting the popup) runs downstream of
 *     state changes.
 *
 *   - **Detection**: a `ViewPlugin` (`completionPlugin`) watches every
 *     transaction. On a trigger insertion (matching a registered
 *     provider key) it dispatches `activateEffect`. While active, it
 *     re-derives the query from the doc-text between the anchor and
 *     the caret and dispatches `updateEffect` when the query changed.
 *     Cursor moves outside the trigger zone or selection becoming a
 *     non-empty range dispatch `cancelEffect`. The plugin also owns
 *     the per-view subscriber set that powers the `useSyncExternalStore`
 *     adapter and manages the active provider's async-result
 *     subscription.
 *
 *   - **Keys**: a `Prec.highest` `domEventHandlers` keymap intercepts
 *     Tab / Enter / Arrows / Page / Home / End / Escape only when
 *     typeahead is active. When inactive, every branch returns
 *     `false` and the keystroke falls through to the Step 4 keymap
 *     (Enter → submit/newline, Cmd-Up → history) and beyond.
 *
 *   - **Accept**: `acceptCompletionAt(view, index?)` deletes the
 *     trigger + query range, inserts U+FFFC, attaches an
 *     `AtomWidget` decoration via `addAtomsEffect`, sets the caret
 *     after the new atom, and dispatches `cancelEffect` — all in one
 *     transaction so the editor never observes a partially-applied
 *     accept. The function is exposed so the popup's clickable items
 *     can call it directly without round-tripping through a
 *     keystroke.
 *
 * React shell integration: `subscribeCompletionState` and
 * `getCompletionState` are the `useSyncExternalStore` pair. The shell
 * reads the snapshot to render the popup; CM6's `coordsAtPos`
 * provides the anchor rect for absolute positioning.
 *
 * Provider lookup: the extension factory accepts a `getProviders`
 * thunk so the React shell can swap providers across renders without
 * rebuilding the editor [L07].
 *
 * Trigger normalization: full-width punctuation (e.g. `＠` / `／`
 * U+FF01–U+FF5E) maps to its ASCII counterpart so CJK keyboard layouts
 * activate the same providers. Mirrors `tug-prompt-input`'s
 * `lookupTrigger`.
 *
 * Laws: [L02] popup-state observed by React via `useSyncExternalStore`
 *        over the per-view subscriber set — never copied into
 *        `useState`, [L03] the React shell registers its subscriber
 *        in `useLayoutEffect` so the first paint observes the right
 *        snapshot, [L06] popup position is set via DOM style
 *        assignment, [L07] handlers and the `getProviders` thunk read
 *        the latest provider table at call time, [L11] tug-text-editor is
 *        the responder for typeahead-accept; popup items dispatch
 *        directly into `acceptCompletionAt` because the popup is a
 *        substrate-internal UI, [L19] file structure, [L20] atom
 *        insertion uses the same `addAtomsEffect` other tug-text-editor
 *        modules use — no token-slot violations or composed-child
 *        overrides, [L22] async provider results stream into the
 *        field via a direct subscribe-and-dispatch path, never
 *        through React state.
 */

import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type { Extension, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import {
  addAtomsEffect,
  type PositionedAtom,
} from "./atom-decoration";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import type {
  CompletionItem,
  CompletionProvider,
} from "@/lib/tug-text-types";

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

/**
 * Snapshot of the typeahead state. Held in `completionField`; the
 * React shell observes via `useSyncExternalStore` against
 * `subscribeCompletionState`.
 *
 * The `provider` reference is included for the `ViewPlugin`'s
 * subscription / refresh path. It is intentionally non-serializable;
 * typeahead state is transient and is not preserved across reloads
 * (Step 7 snapshot drops typeahead).
 */
export interface TugCompletionState {
  /** True when a typeahead session is in progress. */
  active: boolean;
  /** The trigger character (e.g. "@", "/") that opened the session. */
  trigger: string;
  /** Document offset of the trigger character. */
  anchorOffset: number;
  /** Query string typed after the trigger. */
  query: string;
  /** Items returned by the active provider for the current query. */
  filtered: readonly CompletionItem[];
  /** Index of the keyboard-selected item in `filtered`. */
  selectedIndex: number;
  /** Live provider — used for async refresh. `null` when inactive. */
  provider: CompletionProvider | null;
}

const inactiveState: TugCompletionState = {
  active: false,
  trigger: "",
  anchorOffset: 0,
  query: "",
  filtered: [],
  selectedIndex: 0,
  provider: null,
};

// ---------------------------------------------------------------------------
// State effects
// ---------------------------------------------------------------------------

/** Open a typeahead session. */
const activateEffect = StateEffect.define<{
  trigger: string;
  anchorOffset: number;
  provider: CompletionProvider;
  query: string;
  filtered: readonly CompletionItem[];
}>();

/** Refresh the active session's query / filtered / selectedIndex. */
const updateEffect = StateEffect.define<{
  query: string;
  filtered: readonly CompletionItem[];
  selectedIndex: number;
}>();

/** Move the keyboard selection within the active session's list. */
const navigateEffect = StateEffect.define<number>();

/** Cancel the active session. */
const cancelEffect = StateEffect.define<null>();

// ---------------------------------------------------------------------------
// State field
// ---------------------------------------------------------------------------

/** Single source of truth for typeahead state. */
export const completionField = StateField.define<TugCompletionState>({
  create(): TugCompletionState {
    return inactiveState;
  },

  update(value: TugCompletionState, tr: Transaction): TugCompletionState {
    let next = value;
    // Map the anchor through document changes so passive edits
    // elsewhere keep typeahead glued to the original trigger
    // character. The `activateEffect` carries an absolute offset and
    // overrides this by re-assigning the whole state.
    if (tr.docChanged && next.active) {
      next = {
        ...next,
        anchorOffset: tr.changes.mapPos(next.anchorOffset, 1),
      };
    }
    for (const effect of tr.effects) {
      if (effect.is(activateEffect)) {
        next = {
          active: true,
          trigger: effect.value.trigger,
          anchorOffset: effect.value.anchorOffset,
          query: effect.value.query,
          filtered: effect.value.filtered,
          selectedIndex: 0,
          provider: effect.value.provider,
        };
      } else if (effect.is(updateEffect)) {
        if (!next.active) continue;
        next = {
          ...next,
          query: effect.value.query,
          filtered: effect.value.filtered,
          selectedIndex: effect.value.selectedIndex,
        };
      } else if (effect.is(navigateEffect)) {
        if (!next.active) continue;
        const max = Math.max(0, next.filtered.length - 1);
        const clamped = Math.max(0, Math.min(effect.value, max));
        if (clamped !== next.selectedIndex) {
          next = { ...next, selectedIndex: clamped };
        }
      } else if (effect.is(cancelEffect)) {
        next = inactiveState;
      }
    }
    return next;
  },
});

// ---------------------------------------------------------------------------
// Trigger detection (pure helpers — testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Map a typed character to a registered provider, normalizing
 * full-width Unicode punctuation (U+FF01–U+FF5E) to its ASCII
 * counterpart so CJK keyboard layouts activate the same providers.
 * Mirrors `tug-prompt-input`'s `lookupTrigger`.
 */
export function lookupCompletionProvider(
  providers: Record<string, CompletionProvider>,
  ch: string,
): CompletionProvider | undefined {
  const direct = providers[ch];
  if (direct) return direct;
  if (ch.length === 0) return undefined;
  const code = ch.charCodeAt(0);
  if (code >= 0xFF01 && code <= 0xFF5E) {
    const ascii = String.fromCharCode(code - 0xFEE0);
    return providers[ascii];
  }
  return undefined;
}

/**
 * Inspect a transaction to decide whether a trigger character was
 * just inserted at the caret. Returns the trigger position (the
 * inserted character's offset in the new doc) and the matching
 * provider, or `null` if no trigger fired.
 *
 * The detection rule is deliberately narrow — only a single-step
 * insertion that lands the caret immediately after a trigger char
 * activates typeahead. Programmatic doc replacements (history
 * navigation, paste, accept-completion) replace large ranges and
 * do not match this rule.
 */
export function detectTriggerInsertion(
  tr: Transaction,
  providers: Record<string, CompletionProvider>,
):
  | { provider: CompletionProvider; trigger: string; anchorOffset: number }
  | null {
  if (!tr.docChanged) return null;
  const head = tr.state.selection.main.head;
  if (head === 0) return null;
  let firedAt: number | null = null;
  let firedChar = "";
  tr.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
    if (firedAt !== null) return;
    if (toB !== head) return;
    if (inserted.length === 0) return;
    // Only single-character insertions count as trigger activations.
    // Multi-char inserts (paste, history) might happen to contain a
    // trigger but we don't want to activate from those.
    const text = inserted.toString();
    if (text.length !== 1) return;
    const ch = text;
    if (lookupCompletionProvider(providers, ch) !== undefined) {
      firedAt = toB - 1;
      firedChar = ch;
    }
  });
  if (firedAt === null) return null;
  const provider = lookupCompletionProvider(providers, firedChar);
  if (!provider) return null;
  return { provider, trigger: firedChar, anchorOffset: firedAt };
}

/**
 * Compute the typeahead query from the active session and current
 * doc/caret state, returning either the new query string, `"cancel"`
 * if the session should end, or `"unchanged"` if nothing changed.
 *
 * Cancel conditions:
 *   - Selection is non-empty (user dragged a range).
 *   - Caret is at or before the trigger anchor (user backspaced past it).
 *   - The query text would contain a newline.
 */
export function deriveQueryUpdate(
  state: TugCompletionState,
  doc: { sliceString: (from: number, to: number) => string; length: number },
  selection: { from: number; to: number; head: number },
): { kind: "unchanged" } | { kind: "cancel" } | { kind: "query"; value: string } {
  if (!state.active) return { kind: "unchanged" };
  if (selection.from !== selection.to) return { kind: "cancel" };
  const queryStart = state.anchorOffset + 1;
  if (selection.head < queryStart) return { kind: "cancel" };
  if (selection.head > doc.length) return { kind: "cancel" };
  const query = doc.sliceString(queryStart, selection.head);
  if (query.includes("\n")) return { kind: "cancel" };
  if (query === state.query) return { kind: "unchanged" };
  return { kind: "query", value: query };
}

// ---------------------------------------------------------------------------
// View plugin (detection + per-view subscribers + async refresh)
// ---------------------------------------------------------------------------

interface CompletionPluginValue {
  subscribe(listener: () => void): () => void;
  destroy?(): void;
}

const completionPlugin = ViewPlugin.fromClass(
  class implements CompletionPluginValue {
    private listeners = new Set<() => void>();
    private lastState: TugCompletionState;
    private providerUnsubscribe: (() => void) | null = null;

    constructor(
      private readonly view: EditorView,
      private readonly getProviders: () => Record<string, CompletionProvider>,
    ) {
      this.lastState = view.state.field(completionField);
      this.installProviderSubscription(this.lastState);
    }

    update(update: ViewUpdate): void {
      // Detection runs in a `transactionExtender` (registered below)
      // because dispatching from inside `ViewPlugin.update` throws —
      // CM6 prohibits nested updates. The extender appends
      // activate / update / cancel effects to the in-flight
      // transaction so they apply atomically with the user's
      // keystroke. This `update` method only reacts to the resulting
      // state changes: it manages the active provider's async-result
      // subscription and notifies React subscribers.
      const newState = update.state.field(completionField);
      if (newState !== this.lastState) {
        const providerChanged = newState.provider !== this.lastState.provider;
        if (providerChanged) {
          this.installProviderSubscription(newState);
        }
        this.lastState = newState;
        for (const listener of this.listeners) listener();
      }
    }

    /**
     * If the active provider exposes `subscribe`, register a refresh
     * listener that re-reads results for the current query and
     * dispatches `updateEffect`. Used by async completion sources
     * (file-tree, slash-command index) per [L22].
     */
    private installProviderSubscription(state: TugCompletionState): void {
      this.providerUnsubscribe?.();
      this.providerUnsubscribe = null;
      if (!state.active || !state.provider?.subscribe) return;
      const subscribedProvider = state.provider;
      this.providerUnsubscribe = subscribedProvider.subscribe!(() => {
        const live = this.view.state.field(completionField);
        if (!live.active || live.provider !== subscribedProvider) return;
        const filtered = subscribedProvider(live.query);
        const selectedIndex = Math.min(
          live.selectedIndex,
          Math.max(0, filtered.length - 1),
        );
        this.view.dispatch({
          effects: updateEffect.of({
            query: live.query,
            filtered,
            selectedIndex,
          }),
        });
      });
    }

    /**
     * Register a React subscriber. The listener fires after every
     * transaction in which the typeahead state changed identity (the
     * field's `update` returns a fresh object only on real changes).
     */
    subscribe(listener: () => void): () => void {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }

    destroy(): void {
      this.providerUnsubscribe?.();
      this.providerUnsubscribe = null;
      this.listeners.clear();
    }
  },
);

// ---------------------------------------------------------------------------
// Transaction extender — detection + query refresh
// ---------------------------------------------------------------------------

/**
 * The detection-and-refresh half of the typeahead extension. Runs
 * once per transaction via `EditorState.transactionExtender` and
 * returns extra effects to merge into the in-flight transaction.
 *
 * Why a transaction extender (and not a `ViewPlugin.update`
 * dispatch): `EditorView.update` throws when called from inside
 * itself, and `ViewPlugin.update` runs inside the update cycle.
 * The extender runs as part of building the transaction's final
 * state, so it can append our effects synchronously without nesting.
 */
function completionExtender(
  tr: Transaction,
  getProviders: () => Record<string, CompletionProvider>,
): { effects: StateEffect<unknown>[] } | null {
  const fieldState = tr.state.field(completionField);

  // Activation: only when typeahead is currently inactive AND the
  // user typed a registered trigger character in this transaction.
  if (!fieldState.active) {
    const providers = getProviders();
    const detected = detectTriggerInsertion(tr, providers);
    if (detected === null) return null;
    const filtered = detected.provider("");
    return {
      effects: [
        activateEffect.of({
          trigger: detected.trigger,
          anchorOffset: detected.anchorOffset,
          provider: detected.provider,
          query: "",
          filtered,
        }),
      ],
    };
  }

  // Active path: re-derive query from the post-transaction state.
  // `tr.state.field(completionField)` already maps the anchor through
  // any doc changes via the field's own update reducer.
  const sel = tr.state.selection.main;
  const verdict = deriveQueryUpdate(fieldState, tr.state.doc, {
    from: sel.from,
    to: sel.to,
    head: sel.head,
  });
  if (verdict.kind === "cancel") {
    return { effects: [cancelEffect.of(null)] };
  }
  if (verdict.kind === "query") {
    const provider = fieldState.provider!;
    const filtered = provider(verdict.value);
    const selectedIndex = Math.min(
      fieldState.selectedIndex,
      Math.max(0, filtered.length - 1),
    );
    return {
      effects: [
        updateEffect.of({
          query: verdict.value,
          filtered,
          selectedIndex,
        }),
      ],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API for the React shell
// ---------------------------------------------------------------------------

/**
 * Read the current typeahead snapshot. Used by the React shell as
 * the `getSnapshot` half of `useSyncExternalStore`.
 */
export function getCompletionState(view: EditorView): TugCompletionState {
  return view.state.field(completionField);
}

/**
 * Subscribe to typeahead state changes. The listener fires after
 * every transaction in which the field's identity changed. Returns
 * an unsubscribe function. Used by the React shell as the
 * `subscribe` half of `useSyncExternalStore`. Returns a no-op
 * unsubscribe if the plugin is not present (e.g. an editor that
 * was built without `tugCompletionExt`).
 */
export function subscribeCompletionState(
  view: EditorView,
  listener: () => void,
): () => void {
  const plugin = view.plugin(completionPlugin);
  if (plugin === null) return () => {};
  return plugin.subscribe(listener);
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

/**
 * Insert the chosen completion as a tug atom. Replaces the trigger
 * character + query range with U+FFFC, attaches the matching
 * `AtomWidget` decoration via `addAtomsEffect`, sets the caret
 * immediately after the new atom, and cancels the typeahead session
 * — all in one transaction so the editor never observes a
 * partially-applied accept.
 *
 * `index` defaults to the currently-selected item. No-op if
 * typeahead is not active or `filtered` is empty.
 */
export function acceptCompletionAt(view: EditorView, index?: number): void {
  const state = view.state.field(completionField);
  if (!state.active || state.filtered.length === 0) return;
  const idx = index ?? state.selectedIndex;
  if (idx < 0 || idx >= state.filtered.length) return;
  const item = state.filtered[idx]!;
  const start = state.anchorOffset;
  const end = start + 1 + state.query.length;
  const positioned: PositionedAtom = {
    position: start,
    segment: item.atom,
  };
  view.dispatch({
    changes: { from: start, to: end, insert: TUG_ATOM_CHAR },
    effects: [
      addAtomsEffect.of([positioned]),
      cancelEffect.of(null),
    ],
    selection: { anchor: start + 1 },
    scrollIntoView: true,
    userEvent: "input.tug-completion",
  });
}

/**
 * Move the keyboard selection within the active typeahead's filtered
 * list. Accepts `"up"` / `"down"` / `"first"` / `"last"` or an
 * absolute index. No-op when typeahead is inactive.
 */
export function navigateCompletion(
  view: EditorView,
  direction: "up" | "down" | "first" | "last" | { delta: number } | { to: number },
): void {
  const state = view.state.field(completionField);
  if (!state.active || state.filtered.length === 0) return;
  let target = state.selectedIndex;
  if (direction === "up") target -= 1;
  else if (direction === "down") target += 1;
  else if (direction === "first") target = 0;
  else if (direction === "last") target = state.filtered.length - 1;
  else if ("delta" in direction) target += direction.delta;
  else target = direction.to;
  view.dispatch({ effects: navigateEffect.of(target) });
}

/** Cancel the active typeahead session. No-op when inactive. */
export function cancelCompletion(view: EditorView): void {
  const state = view.state.field(completionField);
  if (!state.active) return;
  view.dispatch({ effects: cancelEffect.of(null) });
}

// ---------------------------------------------------------------------------
// Keymap (active-only)
// ---------------------------------------------------------------------------

/** Page jump magnitude — matches `tug-prompt-input`'s 10-row page. */
const PAGE_STEP = 10;

const tugCompletionKeymap = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      const state = view.state.field(completionField);
      if (!state.active) return false;
      // IME composition: leave keys alone — the IME owns commit.
      if (event.isComposing) return false;
      switch (event.key) {
        case "Enter":
        case "Tab": {
          event.preventDefault();
          acceptCompletionAt(view);
          return true;
        }
        case "Escape": {
          event.preventDefault();
          cancelCompletion(view);
          return true;
        }
        case "ArrowDown": {
          event.preventDefault();
          if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
            navigateCompletion(view, "last");
          } else {
            navigateCompletion(view, "down");
          }
          return true;
        }
        case "ArrowUp": {
          event.preventDefault();
          if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
            navigateCompletion(view, "first");
          } else {
            navigateCompletion(view, "up");
          }
          return true;
        }
        case "PageDown": {
          event.preventDefault();
          navigateCompletion(view, { delta: PAGE_STEP });
          return true;
        }
        case "PageUp": {
          event.preventDefault();
          navigateCompletion(view, { delta: -PAGE_STEP });
          return true;
        }
        case "Home": {
          event.preventDefault();
          navigateCompletion(view, "first");
          return true;
        }
        case "End": {
          event.preventDefault();
          navigateCompletion(view, "last");
          return true;
        }
        default:
          return false;
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

/**
 * Build the typeahead extension bundle. The `getProviders` thunk is
 * read at every transaction so callers can swap providers across
 * renders without rebuilding the editor.
 *
 * Returns:
 *   - the typeahead `StateField`
 *   - a `transactionExtender` that detects trigger insertions and
 *     refreshes the query on every transaction (the only path that
 *     can dispatch effects without nesting inside `update`)
 *   - the `ViewPlugin` that manages the per-view subscriber set and
 *     the async-provider subscription lifecycle
 *   - the active-only keymap
 */
export function tugCompletionExt(
  getProviders: () => Record<string, CompletionProvider>,
): Extension {
  return [
    completionField,
    EditorState.transactionExtender.of((tr) =>
      completionExtender(tr, getProviders),
    ),
    completionPlugin.of(getProviders),
    tugCompletionKeymap,
  ];
}
