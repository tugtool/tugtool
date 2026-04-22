# Tugplan: Selection and Focus Subsystem

A complete, top-to-bottom redesign of how the tugdeck preserves and restores text selection and keyboard focus across every state transition in a card's lifetime. Replaces the current patchwork of `selectionGuard` / `domInputs` / ad-hoc restore paths with a single authoritative concept.

Companion document: **`persistence-reliability.md`** (live investigation + status dashboard + failure-case diagnosis). This plan is the resolution of every open thread labeled as a selection or focus concern there.

## Why this exists

The tugdeck today conflates three browser-level concepts under the single word "selection":

1. **DOM selection** — `window.getSelection()`, a singleton range anchored at nodes in the document tree.
2. **Form-control selection** — per-element `selectionStart` / `selectionEnd` on `<input>` / `<textarea>`, invisible to `window.getSelection()`.
3. **Focus** — which element is the active input target. Form-control selection is **invisible without focus**; DOM selection is grayed without window key status.

Each is saved and restored differently. Each is lost under a different set of transitions. The current code handles fragments of each through scattered subsystems — `selectionGuard.saveSelection` for DOM selection, `domInputs` for form-control selection, no one for focus. No single subsystem knows the full state; no single trigger restores all of it; no two code paths agree on ownership.

The result is every failure mode captured in `persistence-reliability.md` Part 7:

- **Case α** — hide/unhide loses selection on any widget (form controls have the wrong save path; DOM selections hit Case γ's degradation).
- **Case β** — Cmd-Tab loses form-control selection on any widget (form-control save path is bypassed, restore path ignores form controls).
- **Case γ** — repeated Cmd-Tab degrades on `TugPromptEntry` (programmatic DOM selection set by our own restore is treated differently by WebKit on the next resign).
- **Case δ** — reload loses form-control selection visibility (no focus restoration; `setSelectionRange` on unfocused element paints no highlight).

These are four symptoms of one missing concept.

## Goals

1. **One authoritative subsystem** — `SelectionKeeper` — that owns the concept of "what is selected and what is focused" in every card.
2. **Capture is unified.** One call produces one snapshot that covers DOM selection OR form-control selection, plus focus, plus enough fallback data to survive reasonable DOM reshaping.
3. **Restore is unified.** One call applies a snapshot: re-focuses the right element, then restores the right kind of selection.
4. **Restore is idempotent and skip-if-correct.** Applying a snapshot that already matches reality is a no-op, avoiding WebKit's programmatic-vs-user-made degradation.
5. **Every transition is covered** by explicit, trigger-driven wiring. No React-dep-array gating for any selection concern.
6. **No silent failures.** If a snapshot cannot be applied (paths don't resolve, key not found), the system logs in dev and falls back where possible (textual anchor, nearest-neighbor, etc.).
7. **The subsystem is the only code that reads or writes selection and focus.** No other module calls `selection.setBaseAndExtent`, `el.setSelectionRange`, or `el.focus()` for restoration purposes. (User-initiated events still set selection/focus directly; `selectionGuard`'s clipping remains for drag interactions; this rule applies only to save/restore semantics.)

## Non-goals

- Drag-select across card boundaries — that's `selectionGuard`'s tracking/clipping concern during live interaction. The keeper consumes the live state; the guard continues to police it.
- Undo/redo of selection history — out of scope; different subsystem entirely.
- Multi-range selections — `window.getSelection` carries one range at a time in our usage; form controls have one range by definition. If the need arises, the snapshot becomes a list.
- Cross-card selections (e.g., a selection that spans two cards) — the keeper is per-card; cross-card selections are not a concept our UI supports today.
- Restoring selection across a real browser tab switch (different DOM tab in the browser, not our tab/card abstraction). The browser handles that itself.

## Concepts

### The three kinds of state

**(1) DOM selection.** A `Range` in `window.getSelection()`. Anchor node + offset and focus node + offset. Lives at the document scope. Visible when:
- its nodes are rendered, not `display: none`, not behind `::selection` overrides that elide it;
- the window has key status (otherwise grayed / hidden depending on browser and OS).

**(2) Form-control selection.** `<input>` and `<textarea>` each own three things: `selectionStart`, `selectionEnd`, `selectionDirection`. These are DOM-level properties, not React state. Visible only when the element has focus. `setSelectionRange` on an unfocused element updates the properties but paints no highlight.

**(3) Focus.** `document.activeElement`. Exactly one element at a time, or `<body>` / `null`. Preserved across some transitions (resign/activate, hide/unhide on most browsers) and destroyed across others (reload, relaunch, element unmount).

At any moment exactly one of these is the *interesting* state per card:
- If an `<input>`/`<textarea>` has focus, its form-control selection is the active selection; DOM selection is empty.
- If focus is on a contenteditable or body, DOM selection may be non-empty; form-control state is not relevant.

### The five transition classes

Each transition destroys or obscures different subsets of state. This is the table that drives the wiring.

| Transition | DOM tree | focused element | DOM sel | form-control sel |
|---|---|---|---|---|
| Reload (in-process) | destroyed | destroyed | destroyed | destroyed |
| Relaunch (process) | destroyed | destroyed | destroyed | destroyed |
| Hide → Unhide | preserved | preserved (usually) | grayed/cleared | preserved internally, highlight cleared |
| Resign → Become Active | preserved | preserved | grayed, then clear after 1st Cmd-Tab cycle for programmatic | preserved internally, highlight cleared |
| Tab/card activation (within app) | preserved | preserved | preserved | preserved |
| Cross-pane card move | reparented (via CardPortal slot) | preserved | *possibly* invalidated if anchor nodes reparent without identity | preserved |

Legend: "preserved" = state still valid, no restore needed (but visibility may still need a nudge). "destroyed" = full re-application required. "grayed/cleared" = state may be there or gone, system can't tell without checking.

The keeper handles all of them uniformly: apply at the restore trigger, skip if already correct.

## Design

### `SelectionSnapshot` (tagged union)

The saved-state shape. Exhaustive, JSON-serializable.

```ts
export type SelectionSnapshot =
  | { kind: "none" }
  | {
      kind: "dom";
      // Path-based anchors into the card's boundary element. Existing
      // SelectionGuard encoding (child-index arrays).
      anchorPath: number[];
      anchorOffset: number;
      focusPath: number[];
      focusOffset: number;
      // Fallback: a short window of text around the anchor, used when
      // `pathToNode` fails because the DOM tree reshaped. Captured at
      // save time from `boundary.textContent` around the anchor.
      // Restore searches for this substring and recomputes offsets
      // against the found location if the path lookup fails.
      textContext?: {
        text: string;           // the surrounding text window, up to ~80 chars
        anchorOffsetInText: number;
        focusOffsetInText: number;
      };
    }
  | {
      kind: "form-control";
      // Identifies the target element via `data-tug-persist-value`.
      // The keeper requires opt-in — form controls without a key are
      // not participating in selection preservation.
      persistKey: string;
      start: number;
      end: number;
      direction: "forward" | "backward" | "none";
    };
```

### `FocusSnapshot`

Tagged union. Focus is always on at most one identifiable element, or nothing.

```ts
export type FocusSnapshot =
  | { kind: "none" }
  | { kind: "keyed"; focusKey: string }; // value of data-tug-focus-key or data-tug-persist-value
```

The keeper requires opt-in for focus too. Elements that want their focus preserved across reload must carry `data-tug-focus-key` (or `data-tug-persist-value`, which doubles as a focus key — the DOM element is uniquely identified either way).

### `CardSelectionState`

```ts
export interface CardSelectionState {
  selection: SelectionSnapshot;
  focus: FocusSnapshot;
}
```

### `CardStateBag` migration

The bag moves selection state into one place:

```ts
export interface CardStateBag {
  scroll?: { x: number; y: number };
  content?: unknown;
  // Replaces the old `selection?: SavedSelection` (DOM-only) and the
  // per-element selection fields of `domInputs`. One snapshot, any kind.
  selection?: CardSelectionState;
  // domInputs keeps value + scroll only; selection is no longer stored here.
  domInputs?: Record<string, { value: string; scrollTop?: number; scrollLeft?: number }>;
}
```

Read-side migration for in-flight bags: on `readCardStates`, if a bag has the old-shape `selection: SavedSelection`, wrap it as `{ selection: { kind: "dom", ... }, focus: { kind: "none" } }`. If `domInputs` entries carry `selectionStart`/`selectionEnd`, migrate the first one whose persistKey matches current focus (best effort; if nothing matches, drop).

### `SelectionKeeper` — the module

Singleton, lives at `tugdeck/src/components/tugways/selection-keeper.ts`. Shape:

```ts
export interface SelectionKeeper {
  /**
   * Capture the current selection + focus state for a card, scoped to
   * its DOM boundary. The boundary is the card-host subtree
   * (`[data-card-host][data-card-id="{id}"]`), not the pane content.
   * Returns a JSON-serializable snapshot.
   */
  capture(cardId: string, boundary: HTMLElement): CardSelectionState;

  /**
   * Apply a snapshot to the card. Three-step:
   *   1. Re-focus the keyed element (if any).
   *   2. Restore selection per its kind.
   *   3. Skip each step if the live state already matches.
   *
   * Returns:
   *   - `"applied"` when at least one step changed state.
   *   - `"already-correct"` when nothing needed doing.
   *   - `"failed"` when the target element or path could not be resolved
   *     and no fallback succeeded; the system logs the failure in dev.
   */
  apply(
    cardId: string,
    boundary: HTMLElement,
    state: CardSelectionState,
  ): "applied" | "already-correct" | "failed";

  /**
   * Test helper: clear any module-internal state. No-op in the current
   * design (the keeper is stateless across calls) but reserved for
   * future instrumentation.
   */
  reset(): void;
}
```

Stateless across calls except for a dev-only failure log. All state lives in the caller's bag.

### Element-level opt-in

Two data attributes that authors place on DOM elements to participate:

- **`data-tug-persist-value="<key>"`** — already exists. Attached by `TugInput` / `TugTextarea` when `persistKey` is set. Indicates: this element's value + scroll should be captured, and it is a form-control selection target.
- **`data-tug-focus-key="<key>"`** — new. Attached by any element that wants its focus preserved across reload. For contenteditable regions, custom input widgets, etc. Value is a per-card unique key.

The keeper's `capture` reads `document.activeElement`:
- If it has a `data-tug-focus-key`, capture `{ kind: "keyed", focusKey: <value> }`.
- Else if it has a `data-tug-persist-value`, same but using that value as the focus key.
- Else `{ kind: "none" }`.

Selection capture branches on the active element's kind:
- If form control and has `data-tug-persist-value`, kind: "form-control".
- Else (active element is body, contenteditable, or an unkeyed element), kind: "dom".
- If `window.getSelection()` has no range, kind: "none" regardless.

### Skip-if-already-correct

Before applying, `apply()` checks whether the live state already matches the snapshot:

- **Focus**: `document.activeElement === desiredElement` → skip focus step.
- **Form-control selection**: `desiredElement.selectionStart === snap.start && desiredElement.selectionEnd === snap.end` → skip selection step.
- **DOM selection**: current `window.getSelection()` has a range whose endpoints resolve to the same paths (or match via textContext) with the same offsets → skip.

This avoids the programmatic-vs-user-made degradation (Case γ) by not replacing a user's selection with an identical programmatic one, and by not re-applying the keeper's own prior apply.

### `textContext` fallback for DOM selection

`pathToNode` (current `selectionGuard` helper) is shape-fragile: if the DOM tree changes between save and restore, path lookup fails silently. The new snapshot captures a textual neighborhood at save time. On apply, if paths don't resolve, the keeper:

1. Concatenates the boundary's current text content.
2. Searches for `textContext.text`.
3. If found exactly once, computes anchor/focus positions relative to the match and walks the text nodes to re-anchor.
4. If found multiple times or not at all, logs "dom textContext ambiguous/missing" and returns `failed`.

Small window (say 40 characters of context on each side of the anchor), balance between specificity and tolerance for nearby text changes.

### Boundary isolation

The keeper takes a `boundary: HTMLElement` — always the card-host subtree. Everything it does is scoped to that boundary. Cross-card cross-contamination is structurally impossible.

`CardHost` provides the boundary at every call site via `findCardRoot(hostContentEl, cardId)` (already exists, was added in `8de575c4` for `domInputs` scoping).

## Lifecycle wiring — exhaustive

### Save triggers

Every path that must capture state **before** it can be lost.

| Trigger | Current | New wiring |
|---|---|---|
| `window.beforeunload` | `handleBeforeUnload` → all save callbacks | calls `saveCurrentCardState` which calls `keeper.capture` for each card |
| `document.visibilitychange(hidden)` | `handleVisibilityChange` | same path |
| Swift `applicationShouldTerminate` → `window.tugdeck.saveState()` | `saveAndFlushSync` | same path |
| `applicationWillResignActive` | **NEW** — add observer in `action-dispatch.ts` that calls `deckManager.saveAndFlush()` *before* the did-phase | `keeper.capture` via save callbacks |
| `applicationDidResignActive` | existing `saveAndFlush` stays as a backstop | idempotent with the new willResign save |
| `applicationWillHide` | **NEW** — same shape as willResignActive | `keeper.capture` via save callbacks |
| `applicationDidHide` | n/a | n/a |
| Blur on a keyed element | **NEW** — module-level `focusout` listener on the deck root | opportunistic capture when a keyed element loses focus, so we always have the freshest form-control selection |
| `_detachCard` / `_moveCardToPane` (fresh-bag invariant) | existing `invokeSaveCallback` | same path, now via keeper |
| Card deactivation (tab/pane switch within app) | **NEW** — observer on `cardDidDeactivate` (or willDeactivate for pre-DOM-change capture) | `keeper.capture` for the deactivating card |

The **will-phase observers** are critical. WebKit begins tearing down selection visibility during the did-phase; by then our save reads whatever the browser has left, which is sometimes nothing. `willResignActive` and `willHide` fire while the browser considers the state authoritative, so `window.getSelection()` and `el.selectionStart` return truthful values.

The **blur-time capture** is the safety net. If any transition we didn't anticipate causes focus to move off a keyed element, `focusout` fires synchronously before the browser can clear the old element's state. Capturing then gives the next restore trigger a fresh snapshot to apply.

### Restore triggers

Every path that must re-apply state **after** it may have been lost.

| Trigger | Current | New wiring |
|---|---|---|
| Cold mount (reload / relaunch) | `CardHost` `useLayoutEffect` on `[hostContentEl]` | replaced: calls `keeper.apply(cardId, cardRoot, state)` with `cardRoot` resolved via `findCardRoot` |
| `applicationDidBecomeActive` | existing `restoreActiveCardSelection` (selectionGuard only) | replaced: iterate all cards (or just focused), call `keeper.apply` for each |
| `applicationDidUnhide` | existing partial wire | same path as didBecomeActive |
| `cardDidActivate` (pane/card activation) | n/a (selection is orthogonal today) | `keeper.apply` for the activating card if its bag has a snapshot |
| `onContentReady` (child re-render with restored content) | existing partial wire | replaced: calls `keeper.apply` instead of `selectionGuard.restoreSelection` directly |
| Cross-pane move (destination mount) | existing `useLayoutEffect` re-fire | same path |

### Ordering invariants

- `keeper.apply` inside `didBecomeActive` fires **after** all card-level `useLayoutEffect`s — same event-loop tick, but at a higher level. Cards are mounted; their DOM boundaries exist.
- `keeper.capture` inside `willResignActive` fires **before** WebKit starts tearing down the selection highlight. Saves the real current range.
- `keeper.apply` is idempotent; running it twice in sequence (e.g. `willResign` captures, then something triggers a mid-lifecycle apply) has no effect beyond the first successful application.

## Per-failure-case walkthrough

Every case in `persistence-reliability.md` Part 7 resolves to a combination of:
- save at the right trigger with fresh enough state;
- apply at the right trigger with focus first, selection second, skip-if-correct gating both.

### Case δ — reload, `TugInput` / `TugTextarea` text restored, selection lost

**Before:** `domInputs` restore calls `setSelectionRange` on an unfocused element, no highlight paints.

**After:** On reload, `CardHost` mount-time `useLayoutEffect` calls `keeper.apply(cardId, cardRoot, bag.selection)`. Apply sees `focus: { kind: "keyed", focusKey: "input-1" }`, locates the element via `cardRoot.querySelector('[data-tug-persist-value="input-1"], [data-tug-focus-key="input-1"]')`, calls `el.focus()`. Then sees `selection: { kind: "form-control", persistKey: "input-1", ... }`, calls `el.setSelectionRange(start, end)`. With focus, highlight paints.

The *user's choice* of whether to auto-focus on reload is encoded in whether focus was on that element at save time. If it wasn't, `focus: { kind: "none" }`, and the keeper restores the selection range into the element without stealing focus. Highlight will appear the moment the user clicks into the element.

### Cases α + β — hide/unhide or Cmd-Tab, form controls

**Before:** save path looks only at `window.getSelection()` (empty for form controls); restore path ignores form controls.

**After:** `keeper.capture` on `willResignActive` (or `willHide`) inspects `document.activeElement`. Form control with a persistKey → `{ kind: "form-control", persistKey, start, end, direction }` + `focus: { kind: "keyed", focusKey: persistKey }`. Stored in bag.

`keeper.apply` on `didBecomeActive` (or `didUnhide`) finds the element by key, focuses it, setSelectionRange. Skip-if-correct skips both if the browser already preserved them.

### Case γ — `TugPromptEntry`, repeated Cmd-Tab, second cycle fails

**Before:** First apply sets programmatic selection via `setBaseAndExtent`. On the next resign, WebKit tears down the programmatic selection before our save reads it. Save captures null-or-wrong. Next apply restores nothing useful.

**After:** Two fixes compound:

1. Save runs on `willResignActive` instead of `didResignActive`. At will-phase time, WebKit has not yet touched the selection — it is still the correct selection from our previous apply. Capture succeeds.
2. Apply skip-if-correct: if `window.getSelection()`'s range already matches the snapshot (paths resolve to the same nodes + offsets), the keeper does not re-call `setBaseAndExtent`. The selection stays "user-programmatic" — still subject to WebKit's rules, but never re-set after the first apply. Over many cycles, the selection stays identical instead of being re-programmaticized.

If WebKit does clear it despite will-phase capture and skip-if-correct, the textContext fallback lets the keeper re-anchor against a moved tree.

### Tab/card activation (not previously broken, now explicit)

When the user switches from card A to card B in the same pane:
- `willDeactivate` for card A → `keeper.capture(A)` saves A's selection+focus.
- `didActivate` for card B → `keeper.apply(B)` restores B's saved state if any.

This lets selection + focus follow the active card without interfering with the browser's natural behavior. For cards that have never been focused, apply is `already-correct` (no snapshot exists, nothing to apply).

### Cross-pane move

The card's DOM reparents via the `CardPortal` slot; the element identities survive (L23). Selection and focus should survive naturally. The `useLayoutEffect` key `[hostContentEl]` re-fires on the destination mount; `keeper.apply` runs; skip-if-correct no-ops in the common case. If paths invalidate because of any reshaping, textContext fallback restores against the new tree.

### Reload / relaunch

The full loss-and-recover flow. Save on `beforeunload` or `saveAndFlushSync`; restore on cold-boot mount.

## Migration plan

### In-flight bag data

`readCardStates` on cold boot migrates old-shape bags in place:

```ts
function migrateBag(bag: any): CardStateBag {
  // Old DOM-only selection as a top-level SavedSelection
  if (bag.selection && typeof bag.selection === "object" && "anchorPath" in bag.selection) {
    bag.selection = {
      selection: { kind: "dom", ...bag.selection },
      focus: { kind: "none" },
    };
  }
  // Selection fields inside domInputs — promote to top-level selection
  // when there's an obvious single focused element at save time.
  // Strategy: scan domInputs for any entry that carries a non-zero-width
  // selection range; pick the first; promote; strip selection fields
  // from domInputs. Others' selection data is lost (best effort).
  if (bag.domInputs) {
    for (const [key, snap] of Object.entries(bag.domInputs)) {
      const s = snap as any;
      if (s.selectionStart !== undefined && s.selectionEnd !== undefined && s.selectionStart !== s.selectionEnd && !bag.selection) {
        bag.selection = {
          selection: {
            kind: "form-control",
            persistKey: key,
            start: s.selectionStart,
            end: s.selectionEnd,
            direction: s.selectionDirection ?? "none",
          },
          focus: { kind: "keyed", focusKey: key },
        };
      }
      // Strip regardless; new schema doesn't carry them here.
      delete s.selectionStart;
      delete s.selectionEnd;
      delete s.selectionDirection;
    }
  }
  return bag;
}
```

Back-compat is best-effort. Users who had a saved selection before the migration may see it restored or may see it dropped; they will never see a crash or corrupted payload.

### Bag schema version

Add a `version: 2` field on new-shape bags. `migrateBag` runs when absent. Future schema changes can bump.

## Implementation plan — commits

Ordered. Each commit green on `bun x tsc --noEmit` and `bun test`.

1. **Commit 1: types + keeper skeleton.**
   - Add `SelectionSnapshot`, `FocusSnapshot`, `CardSelectionState` to `layout-tree.ts`.
   - Create `tugdeck/src/components/tugways/selection-keeper.ts` with stub `capture` and `apply`. Both return placeholders; no real logic yet.
   - Barrel export.
   - Unit tests stub.

2. **Commit 2: capture — DOM selection.**
   - Implement `kind: "dom"` branch of `capture`. Uses existing path-builder from `selectionGuard` internally.
   - Add `textContext` capture (surrounding text window).
   - Unit tests: capture from a known boundary + selection.

3. **Commit 3: capture — form-control selection + focus.**
   - Implement `kind: "form-control"` branch. Reads `document.activeElement`; if keyed form control with a range, emits form-control snapshot.
   - Implement focus capture.
   - Unit tests.

4. **Commit 4: apply — DOM selection.**
   - Implement `kind: "dom"` branch of `apply`.
   - Skip-if-correct for DOM selection.
   - textContext fallback.
   - Unit tests with matching and non-matching paths.

5. **Commit 5: apply — form-control selection + focus.**
   - Implement `kind: "form-control"` branch and focus application.
   - Skip-if-correct for both.
   - Unit tests.

6. **Commit 6: `CardStateBag` schema update + migration.**
   - Move `selection` to `CardSelectionState`.
   - Strip selection fields from `domInputs`.
   - `migrateBag` on `readCardStates`.
   - Tests for round-trip of old-shape → new-shape.

7. **Commit 7: `CardHost` adoption.**
   - `saveCurrentCardStateRef` calls `keeper.capture(cardId, cardRoot)` and stores on bag.
   - Mount-time `useLayoutEffect` calls `keeper.apply(cardId, cardRoot, bag.selection)`.
   - Remove direct `selectionGuard.saveSelection` / `restoreSelection` call sites in `CardHost`.
   - Remove per-input selection capture from `captureDomInputs` and `applyDomInputSnapshot`; those now handle only value + scroll.
   - Integration tests.

8. **Commit 8: `action-dispatch` lifecycle wiring.**
   - Subscribe `observeApplicationWillResignActive` → `deckManager.saveAndFlush()` (captures via save callbacks, which go through keeper).
   - Subscribe `observeApplicationWillHide` → same.
   - Subscribe `observeApplicationDidBecomeActive` → **apply for every card** that has a saved selection, in render order (or just the focused card if that's enough; start with focused + promote to all if a case surfaces).
   - Subscribe `observeApplicationDidUnhide` → same.
   - Remove the existing ad-hoc `restoreActiveCardSelection` block — it's subsumed.

9. **Commit 9: blur-time capture safety net.**
   - Deck-root `focusout` listener (capture phase) that, if the blurred element has a keyed attribute and belongs to a live card, calls `keeper.capture` + `setCardState`.
   - Debounced so a rapid focus-chain traversal doesn't thrash.

10. **Commit 10: card activation wiring.**
    - `observeCardWillDeactivate(cardId, () => keeper.capture → setCardState)`.
    - `observeCardDidActivate(cardId, () => keeper.apply)`.

11. **Commit 11: `onContentReady` re-route.**
    - `CardHost`'s `onContentReady` closure no longer calls `selectionGuard.restoreSelection` directly; it calls `keeper.apply` for the same bag.selection.
    - The legacy `selectionGuard.restoreSelection` call sites in `CardHost` are all removed by the end of this commit.

12. **Commit 12: retire `selectionGuard.saveSelection` / `restoreSelection` as a public API.**
    - Mark the methods as `@internal` / `@private` or move their bodies into the keeper as helpers.
    - `selectionGuard` continues to own drag-clipping and boundary registration; it no longer owns save/restore.
    - Docstring sweep to point readers at the keeper.

13. **Commit 13: integration tests for each failure case.**
    - Simulate reload (mount fresh, bag populated) → assert keeper applies.
    - Simulate resign/activate via `AppLifecycle` events → assert captures at will, applies at did.
    - Simulate hide/unhide likewise.
    - Simulate tab/card activation.
    - Simulate cross-pane move.
    - For each: form-control, DOM, "none" variants.

14. **Commit 14: documentation + tuglaws.**
    - Selection-keeper module docstring finalized.
    - `tuglaws/` additions (see below).
    - Update `persistence-reliability.md` status dashboard (every row ✓ across every column).
    - Update `tugplan-tide-card-polish.md` Commit 1A section to point at this plan and mark Issues A, B, C resolved.

## Tuglaws additions

Three laws follow from this plan. Propose as additions to `tuglaws/tuglaws.md`:

**L-SEL-01. Selection and focus are singletons owned by `SelectionKeeper`.**
No other code reads or writes selection or focus state for save/restore purposes. User-initiated selection events (mouse, keyboard, programmatic from action handlers) remain the responsibility of the initiating code, but their durable persistence is the keeper's alone.

*Why:* before this, we had three subsystems (`selectionGuard`, `domInputs`, ad-hoc `restoreActiveCardSelection`) each handling a fragment. Every fragmentation point was a bug surface. One owner = one set of invariants.

**L-SEL-02. Selection save runs at the will-phase of every lifecycle-loss event.**
`willResignActive`, `willHide`, `beforeunload` → capture. Did-phase and saveAndFlushSync serve as backstops, not primary triggers.

*Why:* browsers begin tearing down selection visibility during the did-phase. Will-phase is the last honest read.

**L-SEL-03. Selection apply is skip-if-correct.**
Before setting `window.getSelection`'s range or `el.setSelectionRange` or `el.focus()`, verify the live state does not already match. If it does, do nothing.

*Why:* WebKit distinguishes user-made from programmatic selections and handles them differently on resign. Repeated programmatic apply degrades over cycles. Skip-if-correct means our apply is idempotent and non-degrading.

## Testing

Every commit in the implementation plan carries tests. The most important integration test is **Commit 13**, which covers the failure-case walkthrough in full. The shape:

```
describe("SelectionKeeper × lifecycle", () => {
  describe("form-control selection", () => {
    it("survives reload", ...);
    it("survives hide/unhide", ...);
    it("survives resign/activate once", ...);
    it("survives resign/activate twice", ...);
    it("visible after reload when focus was on the element", ...);
    it("not visible after reload when focus was elsewhere — but restored on click", ...);
  });
  describe("DOM selection", () => { /* same list */ });
  describe("focus", () => { /* focus-only cases */ });
  describe("migration", () => { /* old-shape bags */ });
});
```

Simulating `AppLifecycle` events in bun-test uses the existing `appLifecycle.notifyApplicationWillResignActive` / `notifyApplicationDidBecomeActive` fire helpers. The app-lifecycle module already supports firing in tests.

## Risks

1. **`willResignActive` / `willHide` are not currently fired by the Swift host.** Need to verify the AppDelegate → Control-frame path dispatches them. If not, Commit 8 expands to Swift changes (`tugapp/`). Action: verify during Commit 8 scoping; if Swift changes needed, add them as Commit 8a.

2. **Skip-if-correct false negatives.** If our equality check is too strict (e.g., `anchorPath` differs because a stray `<br>` was inserted, but the selection is effectively the same), we'll re-apply and fall into Case γ's degradation. Mitigation: skip-if-correct on DOM compares by resolved node + offset after `pathToNode` OR textContext, not by raw path equality. If either path or textContext resolves to the same anchor + offset, it's correct.

3. **Focus restoration steals keyboard events.** On `didBecomeActive`, if we focus an element, any keystroke the user already queued might land there instead of where they expected. Mitigation: only restore focus if focus was on that element at the save moment AND the element is still focusable (not disabled, not hidden). If the user explicitly clicked elsewhere between resign and activate, the browser's click handler runs first and wins. Skip-if-correct preserves that.

4. **Blur-time capture thrashes on tab order.** Every `focusout` fires a capture + `setCardState`. With five `<input>`s in a row and the user tab-cycling, we'd capture five times in 50 ms. Mitigation: debounce to 50 ms; last one wins.

5. **textContext ambiguity.** Identical text windows in different parts of a card (e.g., repeating boilerplate) cause textContext to be non-unique. Mitigation: widen the window adaptively until unique, or give up and log `failed` in dev.

6. **Cross-card selection (user-initiated).** If the user manages to select text spanning two cards, `keeper.capture` only captures the active card's side. The other side is lost. This is a long-standing behavior, not a regression of this plan. Out of scope.

7. **Migration data loss.** Best-effort migration drops selection data for non-primary `domInputs` entries. Acceptable because: (a) this schema change is one-way; (b) on the very next save, the correct selection is captured fresh.

## Rollback

Each commit is independently revertible. The keeper module is additive until Commit 7 (CardHost adoption) — up to that point, reverting means removing the new module and its types, no caller impact. From Commit 7 onward, rolling back individual commits is possible because each lifecycle path is wired independently; the callers are the keeper API, and the API shape does not change after Commit 5.

Full rollback of the plan: revert Commits 1 through 14 in reverse order. Back to `8de575c4`'s partial wire (DOM selection only, ad-hoc lifecycle), which is the state `persistence-reliability.md` Part 7 describes as broken.

## Scope boundary — what this plan does NOT do

- Does not attempt to rescue selection state for cards that never opted into `data-tug-persist-value` or `data-tug-focus-key`. If a card has custom input widgets that don't carry keys, their selection is the widget's concern, not the keeper's.
- Does not rewrite `selectionGuard`'s drag-clipping or boundary-registration logic. Keeper is about save/restore; guard is about runtime clipping. The two cooperate: guard registers boundaries; keeper uses those boundaries for DOM-selection scoping.
- Does not add undo/redo for selection changes. That's a different subsystem with different invariants.
- Does not unify DOM and form-control selection into a single in-memory representation. They remain two variants because the browser treats them as two things. The snapshot is a tagged union; the in-memory state is whatever the browser says it is.

---

## Open questions before Commit 1

Checklist for clarification with the user before starting:

1. **Scope of `didBecomeActive` restore** — every card, or only the focused one? Recommendation: focused only to start; promote to all if a case surfaces (the others are unlikely to need it since they're not visible-focused).
2. **Blur-time capture** — debounce interval? Recommendation: 50 ms.
3. **textContext window size** — 40 chars each side? Recommendation: 40, adaptive up to 200 on ambiguity.
4. **Focus restoration on reload** — always, or only when focus was on a keyed element in the active card? Recommendation: the latter. If the user's focus was on an input, they expect to find their cursor there. If it was on body, they don't.
5. **Do we need `data-tug-focus-key` as a separate attribute, or is `data-tug-persist-value` enough?** Recommendation: separate. `persistKey` means "persist my value and selection"; `focus-key` means "remember I was focused." Some elements want focus preservation but not value preservation (e.g., a `<button>` that was the keyboard focus).
6. **Testing with AppLifecycle simulation** — is the existing `notifyApplication*` helper enough, or do we need more plumbing? Recommendation: start with what exists; extend if Commit 13 needs more.

Resolve these before starting Commit 1; capture the decisions in a "Decisions" section at the top of this file.
