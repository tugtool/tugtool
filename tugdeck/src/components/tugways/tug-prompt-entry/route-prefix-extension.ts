/**
 * route-prefix-extension — one-shot route detection for `tug-prompt-entry`.
 *
 * Watches the substrate's transactions and, on the FIRST transaction
 * whose insertion makes `doc[0]` a configured route-prefix character,
 * calls the host's `setRoute` callback with the matching route. The
 * extension never dispatches its own transactions; the prefix
 * character stays in the doc as plain text per [Q05]=a.
 *
 * Detection is one-way per [Q06]=b:
 *   - Typing / pasting / replace-inserting a prefix at offset 0 → flip.
 *   - Deleting the leading prefix character → no-op (route stays where it
 *     is).
 *   - Replaying the same prefix while the route is already that route
 *     → no-op (idempotent).
 *
 * "An insertion at offset 0" is detected by iterating the change set
 * and looking for any change with `fromB === 0` and a non-empty
 * `inserted` text. This catches the common cases — typing `>` into an
 * empty doc, pasting `>foo` into an empty doc, select-all + type `>`
 * — while distinguishing them from a pure deletion that happens to
 * leave a prefix at offset 0 (which would be ambiguous between
 * "user-typed prefix" and "user-deleted past a prefix").
 *
 * Laws:
 *   - [L02] route state lives in `tug-prompt-entry`'s React state; this
 *     extension is the seam that hands events out to the React layer.
 *     The `setRoute` callback drives `setState` upstream.
 *   - [L07] `getCurrentRoute` and `setRoute` are read at fire time so
 *     the extension's behavior reflects the latest route state without
 *     rebuilding the editor.
 */

import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Configuration for {@link createRoutePrefixExtension}.
 *
 * `aliasMap` is a frozen mapping from prefix character → route value.
 * Multiple characters may map to the same route (e.g. ASCII `>` aliases
 * the chevron `❯` route in `tug-prompt-entry`'s default config).
 *
 * `getCurrentRoute` and `setRoute` are thunks read at fire time per
 * [L07], so the extension stays correct across re-renders without
 * rebuilding the editor view.
 */
export interface RoutePrefixExtensionOptions {
  /**
   * Map of prefix character → route value. Lookup is by the literal
   * first character of the doc; characters not in the map produce no
   * flip.
   */
  readonly aliasMap: Readonly<Record<string, string>>;
  /** Read the host's current route at fire time. */
  readonly getCurrentRoute: () => string;
  /** Set the host's current route. The extension never dispatches a doc transaction. */
  readonly setRoute: (route: string) => void;
}

// ---------------------------------------------------------------------------
// createRoutePrefixExtension
// ---------------------------------------------------------------------------

/**
 * Build a CM6 extension that flips the host's route when the user
 * types / pastes / replace-inserts a prefix character that lands at
 * offset 0 in the new doc.
 *
 * Returns an `Extension` ready to feed into the substrate's
 * `extensions` prop. The extension's lifetime matches the editor
 * view's; thunks are read at fire time per [L07].
 *
 * Edge cases:
 *   - Deletion of the leading prefix → no-op (one-way detection per [Q06]=b).
 *   - The same prefix re-inserted while the route already matches → no-op.
 *   - Insertions strictly past offset 0 (e.g. typing in the middle of
 *     a doc) → no-op.
 *   - Paste of `>foo` into an empty doc → flip to the `>` route.
 *   - Select-all + type `>` → flip to the `>` route. (The `inserted`
 *     starts at `fromB === 0` even though the change set also covers
 *     a deletion.)
 */
export function createRoutePrefixExtension(
  options: RoutePrefixExtensionOptions,
): Extension {
  return ViewPlugin.define(() => ({
    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      // Did any change in this transaction insert non-empty text at
      // offset 0 of the new doc? `fromB` is the position in the
      // post-change doc; an insert that starts at 0 is a candidate.
      // Pure deletions report `inserted` as empty and are filtered
      // out — that's the [Q06]=b "deletion is a no-op" branch.
      let insertedAtZero = false;
      update.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
        if (fromB === 0 && inserted.length > 0) insertedAtZero = true;
      });
      if (!insertedAtZero) return;
      const newDoc = update.state.doc;
      if (newDoc.length === 0) return;
      const firstChar = newDoc.sliceString(0, 1);
      const matched = options.aliasMap[firstChar];
      if (matched === undefined) return;
      // Idempotent: replaying the same prefix when the route already
      // matches doesn't fire `setRoute` — keeps the host's state
      // identity stable across no-op events.
      if (matched === options.getCurrentRoute()) return;
      options.setRoute(matched);
    },
  }));
}
