<!-- tugplan-skeleton v2 -->

## HMR as a First-Class State-Preservation Transition {#hmr-state-preservation}

**Purpose:** Make Vite's HMR (Hot Module Replacement) a first-class "known transition" in the tugdeck Component State Preservation pipeline so that editing a substrate's source file during development preserves the user's typing state across the React Fast Refresh remount that follows. Today HMR remounts silently destroy editor content (CM6 internal state) and any non-React-state-backed substrate state, because the framework's existing capture moments (tab deactivation, `beforeunload`, cross-pane move, cold-boot) don't include "module replaced." This plan adds HMR as a recognized transition, routes it through the existing `useCardStatePreservation` / `useComponentStatePreservation` pipeline, and lands a smoke test that pins the contract.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | `hmr-state-preservation` |
| Last updated | 2026-04-29 |
| Roadmap anchor | this document |
| Predecessor | [text-editing-base.md](text-editing-base.md) Step 11 — the gallery card walkthrough surfaced the regression |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugdeck Component State Preservation Protocol (see [`tuglaws/state-preservation.md`](../tuglaws/state-preservation.md)) preserves the user's state — selection, focus, scroll, form-control value, card content — across a small set of "known transitions":

1. **Tab deactivation** — switching to a sibling card within the same pane.
2. **`saveState` RPC** — Swift-side app-suspend / hide events.
3. **`beforeunload`** — browser-level page reload or navigation.
4. **Close-before-destroy** — card close or cross-pane move.

Outside these moments, the framework writes nothing to its `CardStateBag`. The protocol's design philosophy is "preserve where you can, capture-and-replay only when you must" — DOM stays mounted across in-app transitions, so no save is needed; serialized capture happens only when the DOM is genuinely about to be torn down.

**HMR breaks this assumption in dev.** When Vite hot-replaces a module that's transitively imported by a React component (e.g. an edit to `tug-edit/theme.ts` invalidates `tug-edit.tsx`), Fast Refresh remounts the component. The DOM is torn down without firing any of the four known transitions. CardHost's registered `onSave` callbacks aren't invoked. The bag stays as it was at the last real save (often empty for never-deactivated cards).

Concrete user-visible consequence on the `tug-edit` gallery card:
- User types text into the editor.
- User toggles a setting (e.g. line numbers ON).
- User edits `tug-edit/theme.ts` and saves to tune the gutter color.
- HMR fires. React Fast Refresh remounts `TugEdit`. The CM6 view is destroyed. The new view mounts with an empty document. **All typing is gone.**

The gallery's *toggles* survive this transition only because `GalleryTextEdit`'s `useState` lives in a module that wasn't invalidated by the theme.ts edit, and React Fast Refresh preserves that React state across hot reloads as a separate, ad-hoc mechanism. This is fragile (it breaks the moment someone edits `gallery-text-edit.tsx` itself) and not load-bearing for the substrate's own document, which lives in CM6, not React.

The substrate-local cache approach — a module-scoped `Map<cardId, capturedState>` written on cleanup and read on mount — was prototyped briefly. It works for `tug-edit` specifically but introduces a second source of truth alongside the bag pipeline, doesn't generalize to other components that need preservation, and quietly cancels Fast Refresh's React-state preservation if it accidentally fires for in-app transitions. Rejected.

The right answer: make HMR *another known transition* and let the existing pipeline handle it.

#### Strategy {#strategy}

- **One contract, one pipeline.** Adding HMR as a transition expands the set from four to six (HMR + full-reload), without forking any of the bag-handling code. The substrate doesn't grow a sidecar cache; the framework grows one new producer of save events.
- **Vite's HMR API is already in the browser.** `import.meta.hot.on("vite:beforeUpdate", …)` and `import.meta.hot.on("vite:beforeFullReload", …)` are synchronous, dev-only, and fire before any module replacement. No backend or middleware changes are needed — the "channel" is Vite's HMR WebSocket, internal to the browser.
- **Production-safe.** `import.meta.hot` is `undefined` in production builds. Zero runtime cost when shipped.
- **Generic.** Every component using `useCardStatePreservation` (cards) and `useComponentStatePreservation` (controls) benefits — `tug-edit`, `tug-prompt-input`, future components alike. No per-component opt-in.
- **AT0042 extends.** The existing `at0042-tug-edit-state-roundtrip.test.ts` already pins the bag-based preservation contract for cold-boot. We add a smoke test that fires `vite:beforeUpdate` programmatically and asserts the same contract holds.

#### Success Criteria (Measurable) {#success-criteria}

- [ ] Editing any substrate source file during dev (HMR-driven module replacement) preserves the editor's text + atoms + selection + scroll position across the resulting remount. (verification: manual walk on the `tug-edit` gallery card; automated smoke test driving `vite:beforeUpdate`)
- [ ] Editing a substrate file preserves all `useComponentStatePreservation`-backed component state (gallery toggles, popup values) without relying on Fast Refresh's React-state-survival side-effect.
- [ ] `vite:beforeFullReload` triggers the same save path as `beforeunload`, so a dev-mode full reload behaves like a production reload.
- [ ] Production bundle is unchanged in behavior — `import.meta.hot` guard is dead code in prod builds.
- [ ] [`tuglaws/state-preservation.md`](../tuglaws/state-preservation.md) updated to list HMR among the capture moments.
- [ ] No regression in AT0042 (existing cold-boot path) and the substrate's own unit tests.

---

### Investigation Notes {#investigation-notes}

#### The four (now six) known transitions {#known-transitions}

| Transition | Today | This plan |
|---|---|---|
| Tab deactivation | `useLayoutEffect` cleanup in `useCardStatePreservation` re-registers a no-op pair, but CardHost's deactivation flow has already called `onSave` first. Captured into bag. | unchanged |
| `saveState` RPC (Swift) | `deck-manager` exposes the entry point; iterates active cards, fires `onSave`, persists. | unchanged |
| `beforeunload` | `deck-manager` listens; same iterate-and-save pass. | unchanged |
| Close-before-destroy | `deck-manager` flushes one last save before card teardown. | unchanged |
| **HMR module replacement** | **Not handled.** Component remounts; CM6 / non-React state is lost. | **NEW: bridge module listens to `vite:beforeUpdate` and triggers the same save pass.** |
| **HMR full reload** | Falls through to `beforeunload`. | **NEW: `vite:beforeFullReload` triggers an explicit save pass before Vite reloads. Acts as a redundant safety with `beforeunload`.** |

#### Capture side — the easy half {#capture-side}

A small bridge module (≈30 lines) registers two Vite event handlers at app startup:

```ts
// tugdeck/src/hmr-bridge.ts (sketch)
import { deckManager } from "./deck-manager";

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeUpdate", () => {
    deckManager.captureAllForTeardown("hmr");
  });
  import.meta.hot.on("vite:beforeFullReload", () => {
    deckManager.captureAllForTeardown("hmr-full-reload");
  });
}
```

`deckManager.captureAllForTeardown(reason)` is a new public method that mirrors the body of `handleBeforeUnload` — synchronously iterates every active card and calls each registered `onSave`, plus walks `ComponentStatePreservationRegistry` for `bag.components`. The `reason` string is for telemetry / debug logging only; the path is otherwise identical.

Concerns to verify during research:
- Is there already a "save all active cards now" entry point on `deck-manager` that we can reuse, rather than duplicating the iteration?
- Does `ComponentStatePreservationRegistry`'s capture pass run in parallel with `useCardStatePreservation`'s `onSave` today, or is one a subset of the other? If they're a single pass, great. If split, `captureAllForTeardown` must invoke both.

#### Restore side — the harder half {#restore-side}

This is where the design decisions live.

**Today's restore path:** `onRestore` fires from CardHost on **cold-boot mount**. Specifically: when a `CardHost` for a given `cardId` mounts and a saved bag exists for that `cardId` in deck-manager's cache (or in tugbank), CardHost dispatches `onRestore` with the bag.

**HMR remount lookalike:** TugEdit's old `TugEditStatePreservation` cleanup runs and re-registers a no-op pair with CardHost. React Fast Refresh swaps the module. New TugEdit's `TugEditStatePreservation` mounts and registers fresh callbacks with CardHost.

**Question:** does CardHost's existing flow fire `onRestore` on the new registration?

Two possibilities:
1. **CardHost already does this.** It detects "a fresh, non-no-op registration for a cardId whose bag exists in the cache" and fires `onRestore`. If so, the capture-side bridge is the only change needed; the restore side flows through for free.
2. **CardHost only fires `onRestore` once, on first mount.** Subsequent re-registrations are silent. We'd need a small change to detect re-registration after a cleanup-no-op pair.

This is the central thing to confirm by reading the code.

#### Why a substrate-local cache was rejected {#why-not-cache}

Briefly, for the record:

- **Two sources of truth.** A `tug-edit`-internal cache and the framework bag both claim authority over editor state. On every restore the substrate has to choose; the wrong choice loses data silently.
- **Doesn't generalize.** `tug-prompt-input` would need the same fix. So would any future card content. So would every gallery control whose state needs to survive HMR. Each gets its own cache or its own ad-hoc mechanism.
- **Hides the contract.** State preservation should be visible at the framework layer. A substrate-local cache buries it inside one component's implementation.
- **Fights React Fast Refresh.** Fast Refresh has its own state-preservation mechanism for React `useState`. Two systems racing on the same state can produce subtle bugs (stale snapshot wins).

The framework-level approach has none of these problems.

#### What this plan does NOT do {#non-goals}

- **Does not change production behavior.** `import.meta.hot` guard ensures the bridge is a no-op in production.
- **Does not change the framework's cardId stability contract.** HMR remount keeps the cardId; this is the existing assumption that lets a re-registration be recognizable.
- **Does not handle "edit while bag is empty."** If the user types into the editor and immediately HMRs (no prior save), the capture-on-`vite:beforeUpdate` is the first save that fires. Same path; same outcome (their text is preserved).

---

### Implementation Plan — Concrete {#implementation-plan}

After reading the registration flow, the gap is split between capture-side and restore-side, both small.

#### Capture side {#capture-side-impl}

Today's flow (`deck-manager.ts:handleBeforeUnload`) is:

```ts
private readonly handleBeforeUnload = (): void => {
  if (this.reloadPending || this.stateFlushed) return;
  // …flush save timer…
  for (const cardId of Array.from(this.saveCallbacks.keys())) {
    this.invokeSaveCallback(cardId, "beforeunload");
  }
  this.flushDirtyCardStates({ sync: true });
};
```

Each `invokeSaveCallback` calls the per-card `saveCurrentCardStateRef.current()` registered by `CardHost` on mount, which walks `assembleFrameworkBagRef` (capturing scroll, content, formControls, regionScroll, domSelection, focus) and the `cardStateOrchestrator` (capturing the components axis), then writes the assembled bag to `store.setCardState(cardId, bag)`. The bag lives in deck-manager's in-memory cache and is debounced to tugbank.

**Change:** add a sibling method that does the same iteration, distinguished by trace tag.

```ts
// deck-manager.ts (new public method)
captureAllForTeardown(reason: SaveCallbackSource): void {
  if (this.stateFlushed) return;
  if (this.saveTimer !== null) {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saveLayout();
  }
  for (const cardId of Array.from(this.saveCallbacks.keys())) {
    this.invokeSaveCallback(cardId, reason);
  }
  this.flushDirtyCardStates({ sync: true });
}
```

`handleBeforeUnload` can collapse into `captureAllForTeardown("beforeunload")` to share the body.

**SaveCallbackSource extension** (`deck-trace.ts`): add `"hmr"` and `"hmr-full-reload"` to the union so the trace ring records the source correctly.

```ts
export type SaveCallbackSource =
  | "close-handoff"
  | "debounced"
  | "visibilitychange"
  | "beforeunload"
  | "window-blur"
  | "manual"
  | "hmr"             // NEW
  | "hmr-full-reload"; // NEW
```

#### The bridge module {#bridge-impl}

```ts
// tugdeck/src/hmr-bridge.ts (NEW)
import type { DeckManager } from "./deck-manager";

/**
 * Wire Vite's HMR pre-update events into the deck-manager save
 * pipeline. Dev-only: `import.meta.hot` is `undefined` in production,
 * so the body is dead code in shipped bundles.
 *
 * Adds two new "known transitions" to the state-preservation contract
 * documented in `tuglaws/state-preservation.md`:
 *
 *   - `vite:beforeUpdate` — fires synchronously before any HMR update
 *     applies. Triggers a full save pass so the freshly-captured bag
 *     is in deck-manager's cache by the time React Fast Refresh
 *     remounts components.
 *   - `vite:beforeFullReload` — fires before Vite does a full page
 *     reload (used when HMR can't apply incrementally). Sibling of
 *     `beforeunload`; we trigger an explicit save pass to be
 *     defensive.
 */
export function installHmrBridge(deck: DeckManager): void {
  if (typeof import.meta === "undefined" || !import.meta.hot) return;
  import.meta.hot.on("vite:beforeUpdate", () => {
    deck.captureAllForTeardown("hmr");
  });
  import.meta.hot.on("vite:beforeFullReload", () => {
    deck.captureAllForTeardown("hmr-full-reload");
  });
  // Force a full reload if THIS module is hot-replaced. Without this,
  // every self-edit re-runs the body and accumulates duplicate
  // `vite:beforeUpdate` listeners, each firing a redundant save pass.
  // The bridge changes rarely; full reload is the simplest correct
  // behavior.
  import.meta.hot.accept(() => {
    import.meta.hot?.invalidate();
  });
}
```

**Wire-up in `main.tsx`** (one new line after the `new DeckManager(...)` call):

```ts
const deck = new DeckManager(...);
installHmrBridge(deck);
```

#### Restore side {#restore-side-impl}

The capture side is straightforward; the restore side is the one the user has to design carefully because CardHost's restore effects are one-shot per CardHost mount.

**Found in `card-host.tsx`:**

Three restore effects, gated differently:

```ts
// (1) content-axis restore (~line 710)
const hasAppliedContentRestoreRef = useRef(false);
useLayoutEffect(() => {
  if (hasAppliedContentRestoreRef.current) return;
  // … applies bag.content via callbacks.onRestore …
  hasAppliedContentRestoreRef.current = true;
}, [hostContentEl, callbacksVersion, cardId, store]);

// (2) framework-axes restore (~line 843) — scroll, formControls,
//     regionScroll, domSelection, bag.focus
useLayoutEffect(() => {
  if (!hostContentEl) return;
  const bag = store.getCardState(cardId);
  if (!bag) return;
  // … applies bag.scroll, bag.formControls, bag.regionScroll,
  //     bag.domSelection, bag.focus via applyFocusSnapshot …
}, [cardId, hostStackId, hostContentEl, store]);

// (3) components-axis restore (~line 1167)
const hasRestoredComponentsRef = useRef(false);
useLayoutEffect(() => {
  if (hasRestoredComponentsRef.current) return;
  hasRestoredComponentsRef.current = true;
  // … applies bag.components via store.restoreCardState …
}, [cardId, store]);
```

(1) already re-fires on `callbacksVersion` bump (which `registerStatePreservationCallbacks` triggers on every register call). (2) and (3) don't have `callbacksVersion` in their deps, so they never re-fire after first mount.

**Focus across HMR for content-owning cards (`tug-edit`).** Effect (2)'s `bag.focus` branch skips content-owning cards (`ownsSelectionAndFocus = bag.content !== undefined`); focus is owned by the engine instead. tug-edit's `onRestore` (in `state-preservation.ts`) calls `paintMirrorAsActive(view, state)` which calls `view.focus()`. So once effect (1) re-fires (via the remount-detection fix below), tug-edit's focus is restored automatically through `onRestore` → `paintMirrorAsActive`. No additional change needed for content-owning cards.

**Focus across HMR for form-control / non-content cards.** Effect (2) is the only mechanism — `applyFocusSnapshot` reads `bag.focus.kind` and re-focuses the matching `data-tug-state-key` / `data-tug-focus-key` element. For these cards we need effect (2) to re-fire on HMR remount. Today it depends on `[cardId, hostStackId, hostContentEl, store]`, none of which change on HMR (CardHost stays mounted; only its descendant content factory remounts). Adding `callbacksVersion` to effect (2)'s deps wires it into the same remount signal as effect (1). One extra restore pass on cold-boot too, but the body is idempotent (scroll/form-controls/region-scroll/DOM-selection writes are no-ops when already-applied; focus re-application during cold-boot's first commit is benign — the user hasn't moved focus yet).

**HMR sequence today:**

1. `vite:beforeUpdate` fires (with capture-side fix above): `onSave` writes the bag.
2. Old `TugEditStatePreservation` cleanup: `register({onSave: ()=>undefined, onRestore: ()=>{}})` — a no-op pair with `restorePendingRef === undefined`.
3. React Fast Refresh swaps the module.
4. New `TugEditStatePreservation` mounts: `register(realCallbacks)` — `restorePendingRef !== undefined`.

**Change** — detect "no-op pair → real callbacks" transition in `registerStatePreservationCallbacks` and reset the content-axis and components-axis one-shot flags:

```ts
const registerStatePreservationCallbacks = useCallback(
  (callbacks: CardStatePreservationCallbacks) => {
    const prev = cardStatePreservationCallbacksRef.current;
    // A "real" registration carries `restorePendingRef`; a cleanup
    // no-op pair does not. A real-after-no-op transition means a
    // remount happened (likely HMR-driven Fast Refresh). The bag in
    // deck-manager's cache is fresh from the `vite:beforeUpdate`
    // capture pass; reset the one-shot guards so the existing
    // restore effects can re-fire and replay the bag onto the new
    // child tree.
    const isRemount =
      callbacks.restorePendingRef !== undefined &&
      prev !== null &&
      prev.restorePendingRef === undefined;
    cardStatePreservationCallbacksRef.current = callbacks;
    if (isRemount) {
      hasAppliedContentRestoreRef.current = false;
      hasRestoredComponentsRef.current = false;
    }
    setCallbacksVersion((v) => v + 1);
  },
  [],
);
```

Plus add `callbacksVersion` to the components-axis effect's dep array so the version bump re-fires it (effect 3):

```ts
}, [cardId, store, callbacksVersion]);
```

…and to the framework-axes effect's dep array (effect 2) so `bag.focus` re-applies for non-content cards on HMR remount:

```ts
}, [cardId, hostStackId, hostContentEl, store, callbacksVersion]);
```

That's the complete restore-side change. ~13 lines net.

#### Smoke test {#smoke-test-impl}

A new app-test that pins the contract end-to-end:

```ts
// tests/app-test/atXXXX-hmr-state-preservation.test.ts
// Setup:
//   1. Mount the tug-edit gallery card.
//   2. Type "hello world" into the editor.
//   3. Toggle line numbers ON.
//
// Action:
//   Programmatically dispatch the `vite:beforeUpdate` event, then
//   simulate the React Fast Refresh remount by unmounting and
//   remounting the card body.
//
// Assertion:
//   - Editor text equals "hello world" after remount.
//   - Selection is at end-of-text after remount (or wherever it was
//     pre-fire).
//   - Line numbers toggle is still ON.
//   - bag.content and bag.components both round-tripped.
```

The test sits next to AT0042 in the inventory; same harness, same shape.

#### Documentation

`tuglaws/state-preservation.md`'s "Capture moments" list grows from four entries to five:

```diff
 1. Tab deactivation.
 2. saveState RPC.
 3. Close-before-destroy.
+4. HMR module replacement (dev-only). Fired by Vite's
+   `vite:beforeUpdate` event; triggers the same iterate-and-save
+   pass as `beforeunload`. Production bundles never observe this
+   transition (`import.meta.hot === undefined`).
```

Plus a brief subsection in the doc explaining the bridge module and pointing at `tugdeck/src/hmr-bridge.ts`.

#### File summary {#file-summary}

| File | Change | Lines |
|---|---|---|
| **NEW** `tugdeck/src/hmr-bridge.ts` | Vite event handlers calling into deck-manager | ~30 |
| **MODIFIED** `tugdeck/src/main.tsx` | One `installHmrBridge(deck)` call after `new DeckManager(...)` | +2 |
| **MODIFIED** `tugdeck/src/deck-manager.ts` | New `captureAllForTeardown(reason)` method; refactor `handleBeforeUnload` to call it | ~15 |
| **MODIFIED** `tugdeck/src/deck-trace.ts` | Two new `SaveCallbackSource` literals | +2 |
| **MODIFIED** `tugdeck/src/components/chrome/card-host.tsx` | Detect remount in `registerStatePreservationCallbacks`; reset content-axis and components-axis one-shot guards; add `callbacksVersion` to framework-axes and components-axis effect deps | ~13 |
| **NEW** `tests/app-test/atXXXX-hmr-state-preservation.test.ts` | End-to-end smoke test | ~80 |
| **MODIFIED** `tuglaws/state-preservation.md` | Add HMR to "Capture moments" list; brief subsection on the bridge | ~10 |

**Total touched files: 7. Total net lines: ~150.**

---

### Steps {#steps}

#### Step 1: SaveCallbackSource extension {#step-1}

**Commit:** `feat(deck-trace): add hmr / hmr-full-reload to SaveCallbackSource`

**References:** [L23], (#tuglaws-compliance)

Add the two new literals to `deck-trace.ts`'s `SaveCallbackSource` union. No call sites yet; this is a forward-declaration commit so subsequent edits in `deck-manager.ts` and the bridge module type-check cleanly.

**Audit before editing:** confirmed no consumer in `tugdeck/src` switches exhaustively on the union (the literal is used only as a trace tag passed through `invokeSaveCallback`, where the consumer reads it as an opaque string). Adding new literals is purely additive — no other site needs to learn about them in this step.

**Implementation:** the two new literals are appended at the end of the union per the implementation note in [Tuglaws Compliance](#tuglaws-compliance), keeping the diff minimal. The type's docstring is expanded to distinguish production tags (lifecycle-driven) from dev-only tags (Vite HMR pipeline) and to record that the dev tags are dead code in production bundles (`import.meta.hot === undefined`).

**Tests:**
- [x] `bun run check` exits 0 — TypeScript accepts the augmented union.
- [x] `bun test` exits 0 (unit suite incidental regression check) — 2548 / 2548 pass.

**Checkpoint:**
- [x] Type union compiles; no other behavior change. Forward-declared literals are ready for consumption in Steps 2–3.

---

#### Step 2: deck-manager.captureAllForTeardown {#step-2}

**Commit:** `refactor(deck-manager): extract captureAllForTeardown from handleBeforeUnload`

**References:** [L10], [L23], (#tuglaws-compliance)

Refactor `handleBeforeUnload`'s body into a new public method `captureAllForTeardown(reason: SaveCallbackSource)`. Have `handleBeforeUnload` call `captureAllForTeardown("beforeunload")` to share the iterate-and-save pass. Pure refactor — no behavior change at this step. The new public method becomes the entry point used by the bridge in Step 3.

**Tests:**
- [ ] AT0042 still passes (cold-boot preservation contract unchanged).
- [ ] Existing deck-manager unit tests still pass.

**Checkpoint:**
- [ ] `bun test`, `bun run check` exit 0.

---

#### Step 3: HMR bridge module {#step-3}

**Commit:** `feat(deck): hmr bridge — Vite beforeUpdate / beforeFullReload save passes`

**References:** [L03], [L07], [L10], [L19], [L21], [L23], (#tuglaws-compliance)

Add `tugdeck/src/hmr-bridge.ts` with `installHmrBridge(deck)` registering `vite:beforeUpdate` and `vite:beforeFullReload` handlers. Wire from `main.tsx` after the `new DeckManager(...)` line. Bridge calls `import.meta.hot.accept(() => import.meta.hot.invalidate())` so a self-edit forces a full reload (avoids listener accumulation across hot replacements of the bridge module itself).

**Manual verification:**
- [ ] In dev mode, type into a tug-edit gallery card. Observe deck-trace ring (browser devtools): edit a theme.ts file → see `save-callback` events with `source: "hmr"` for the active card. Bag is now in deck-manager's cache.

**Tests:**
- [ ] `bun run check` exits 0 (`import.meta.hot` typed via Vite's client.d.ts).

**Checkpoint:**
- [ ] Capture side proven: bag is written on every HMR pre-update.

---

#### Step 4: Restore-side remount detection in CardHost {#step-4}

**Commit:** `fix(card-host): detect content-factory remount and replay bag.content + bag.components`

**References:** [L03], [L07], [L23], [L24], (#tuglaws-compliance)

Modify `registerStatePreservationCallbacks` in `card-host.tsx` to detect the "no-op pair → real callbacks" transition that signals a content-factory remount. When detected, reset `hasAppliedContentRestoreRef` and `hasRestoredComponentsRef`. Add `callbacksVersion` to the components-axis effect's dep array (so its one-shot reset re-fires the restore) and to the framework-axes effect's dep array (so `bag.focus` re-applies for non-content cards on HMR remount).

**Manual verification:**
- [ ] In dev mode, type into a tug-edit gallery card. Edit `tug-edit/theme.ts` → observe text, atoms, selection, scroll all survive the HMR remount.
- [ ] AT0042 still passes (cold-boot path unaffected).

**Tests:**
- [ ] `bun run check`, `bun test` exit 0.

**Checkpoint:**
- [ ] Both axes (content, components) round-trip across HMR remount on the gallery card.

---

#### Step 5: Smoke test {#step-5}

**Commit:** `test(app-test): atXXXX hmr state-preservation smoke`

**References:** [L23], (#tuglaws-compliance)

Add a new app-test that fires `vite:beforeUpdate` programmatically and asserts the bag round-trips for a populated tug-edit gallery card (text, selection, scroll). Sits next to AT0042 in the inventory.

**Tests:**
- [ ] New app-test passes.
- [ ] Full sweep stays green.

**Checkpoint:**
- [ ] Contract is pinned by automation, not just by manual gallery walkthrough.

---

#### Step 6: Documentation {#step-6}

**Commit:** `docs(tuglaws): list HMR among state-preservation capture moments`

**References:** [L23], (#tuglaws-compliance)

Update `tuglaws/state-preservation.md`'s "Capture moments" list to include HMR module replacement. Add a brief subsection on the bridge module pointing at `tugdeck/src/hmr-bridge.ts`. Mention the new app-test by AT-tag.

**Checkpoint:**
- [ ] Doc reflects implementation.

---

#### Step 7: Manual walkthrough on the `tug-edit` gallery card {#step-7}

**References:** [L23], (#tuglaws-compliance)

**Tasks:**
- [ ] Open the gallery, navigate to TugEdit card.
- [ ] Type a paragraph; insert atoms; select a range; scroll.
- [ ] Toggle every gallery control to a non-default value.
- [ ] Edit `tug-edit/theme.ts` (any innocuous CSS tweak); save.
- [ ] Observe: editor text, atoms, selection, scroll all preserved; gallery toggles all preserved.
- [ ] Repeat with edits to `tug-edit.tsx`, `tug-edit.css`, `caret-layer.ts` — every substrate file. All preserve.
- [ ] Repeat with an edit to `gallery-text-edit.tsx` itself — full subtree remounts; bag-driven preservation kicks in for everything.

**Checkpoint:**
- [ ] HMR feels like an in-app transition, not a teardown.

---

### Tuglaws Compliance {#tuglaws-compliance}

Audit against [`tuglaws/tuglaws.md`](../tuglaws/tuglaws.md). Engaged laws have a compliance approach; non-engaged laws are listed for completeness so a future reader can see the full surface was considered.

#### Centrally engaged

| Law | What it requires | Compliance approach | Step |
|---|---|---|---|
| **[L23] Internal operations must not lose user-visible state** | Re-lex / re-parse / DOM rebuild / tab switch / cmd-tab / cold boot must preserve selection, focus, scroll, content. The plan's reason-for-being. | Adds HMR module replacement and full-reload to the recognized capture moments. The capture pass is the same body that runs on `beforeunload`; the restore pass is the same body that runs on cold-boot. No new contract, no new mechanism — one new producer. | All steps. |

#### Engaged in implementation

| Law | What it requires | Compliance approach | Step |
|---|---|---|---|
| **[L03] Use `useLayoutEffect` for registrations that events depend on** | Mount-time wiring must complete before any event-driven handler runs. | `import.meta.hot.on(...)` in the bridge module runs at module init (before any React render). The CardHost restore effects we modify are already `useLayoutEffect`. | Steps 3, 4. |
| **[L07] Action handlers access state through refs / stable singletons, never stale closures** | Handlers registered once at mount must read live state at call time. | Bridge's Vite event handlers close over the `deck` instance — a stable singleton constructed once in `main.tsx`. CardHost's remount-detection reads `cardStatePreservationCallbacksRef.current` (a ref) at call time. | Steps 3, 4. |
| **[L10] One responsibility per layer** | DeckManager owns layout / orchestration; CardHost bridges per-card context; layers don't reach across. | Bridge module sits at the deck level (calls a method on `deck`); deck-manager grows one new public method that does what `handleBeforeUnload` already does; CardHost grows internal logic confined to its own scope. No cross-layer reaches. | Steps 2, 3, 4. |
| **[L19] Component authoring guide** | File pair, module docstring, scoped responsibilities. | `hmr-bridge.ts` carries a module docstring describing purpose, dev-only nature, and the two registered events. Not a tugways component, but follows file-conventions. | Step 3. |
| **[L21] Third-party code requires license compliance** | Adopting external code/patterns demands attribution. | `import.meta.hot.*` is Vite's runtime API exposed to the browser, not third-party code we're copying. No `THIRD_PARTY_NOTICES.md` entry needed. | Step 3 (negative invariant). |
| **[L24] State partitioned into appearance / local data / structure** | Each piece of state belongs to exactly one zone. | Structure zone: `callbacksVersion` state, effect dep arrays, registration. Local data: the one-shot refs (`hasAppliedContentRestoreRef`, `hasRestoredComponentsRef`) are component-scoped React refs that don't coordinate outside CardHost. Appearance zone: untouched. | Step 4. |

#### Non-engaged (explicit)

| Law | Why not engaged |
|---|---|
| **[L01] One `root.render()` at mount, ever** | Plan adds no new `root.render` calls. |
| **[L02] External state via `useSyncExternalStore` only** | Bridge module runs outside React. CardHost reads from refs (local data) and from `store.getCardState(cardId)` (the existing direct-read pattern, not `useState`-mirrored). No new `useState`+manual-sync paths. |
| **[L04] No measure-after-parent-setState on child DOM** | No measurement / no parent→child setState cycles introduced. |
| **[L05] No `requestAnimationFrame` for React-commit-coupled work** | Plan explicitly avoids RAF. The `vite:beforeUpdate` event is synchronous; the deck-manager save pass is synchronous; React Fast Refresh's commit cycle drives the remount detection. |
| **[L06] Appearance via CSS and DOM, never React state** | Plan handles user data preservation, not appearance. |
| **[L08] Mutation transactions: preview is appearance-only** | No mutation transactions. |
| **[L09], [L25] Pane chrome / Deck → Pane → Card** | Plan doesn't touch chrome or hierarchy. |
| **[L11] Controls emit; responders own state** | No new controls / responders. |
| **[L12] Selection stays inside card boundaries** | Selection-guard pipeline untouched. |
| **[L13], [L14] Motion / Radix Presence** | Not engaged. |
| **[L15]–[L18], [L20] Token system / element vs surface / scoping** | No CSS / token changes. |
| **[L22] External-state DOM updates observe the store directly** | Bridge listens to Vite events (not a tug store) and writes via `deck.captureAllForTeardown(...)`. The bag updates eventually drive React renders for restore — not direct-DOM-mutation paths from a store observer. The existing CardHost effects (which DO observe the store) are unchanged in their observer pattern. |

#### Implementation notes that fell out of the audit

1. **Bridge module self-HMR.** If `hmr-bridge.ts` is itself hot-replaced, Vite's `import.meta.hot.on(...)` listeners accumulate (each module-load registers new ones, old ones may remain unless explicitly disposed). The bridge should call `import.meta.hot.accept(() => import.meta.hot.invalidate())` so any change to it forces a full reload — no listener accumulation, no stale registrations. Costs nothing in production. Alternative (more nuanced) is to track listener references and `off()` them in `import.meta.hot.dispose(...)`; the invalidate-on-self-change pattern is simpler and fits a file that should rarely change.
2. **Deck instance threading.** `installHmrBridge(deck)` takes the deck as an argument rather than using a module-level singleton getter (consistent with how `connection-singleton.ts` works for the WS connection). main.tsx is the single call site, called once after `new DeckManager(...)`.
3. **`SaveCallbackSource` extension order.** Adding the two new literals at the END of the union (not alphabetical) keeps the diff minimal and matches the existing ordering (which mirrors the order events were added to the framework).

---

### References {#references}

- [`tuglaws/tuglaws.md`](../tuglaws/tuglaws.md) — the law surface this plan was audited against.
- [`tuglaws/state-preservation.md`](../tuglaws/state-preservation.md) — the protocol this plan extends.
- [`tuglaws/card-state-model.md`](../tuglaws/card-state-model.md) — per-axis contract (focus, scroll, form-control value).
- [Vite HMR API](https://vitejs.dev/guide/api-hmr.html) — `import.meta.hot.on` events including `vite:beforeUpdate`, `vite:beforeFullReload`, `vite:beforePrune`.
- [text-editing-base.md](text-editing-base.md) Step 11 — where the regression surfaced.
- AT0042 — the cold-boot preservation gate that the new HMR smoke test mirrors.
