<!-- tugplan-skeleton v2 -->

## Tugways Phase 5f4: State Preservation Solidified {#phase-5f4}

**Purpose:** Replace the double-RAF timing bet in tugcard's scroll/selection restore with a deterministic child-driven ready callback, establishing `onContentReady` as a general-purpose primitive in `useTugcardPersistence`.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5f4-state-preservation-solidified |
| Last updated | 2026-03-09 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current restore flow in `tugcard.tsx` (lines 344-409) uses a double-RAF (nested `requestAnimationFrame`) to wait for child content layout before applying scroll position and selection. This pattern is fundamentally flawed: RAF timing relative to React's commit cycle is a browser scheduler implementation detail, not a contract. Under heavy rendering loads (e.g., app launch with many cards), the child's re-render may not have committed by the second frame, silently clamping `scrollTop` to 0 with no retry. Additionally, RAF is not testable in happy-dom (it uses `setTimeout(0)`, which does not match browser scheduling).

Phase 5f4 replaces this timing bet with the child-driven ready callback pattern proven by spikes against React 19.2.4. When a parent triggers a child's `setState` via `onRestore`, the parent cannot measure the child's DOM inline because the child's re-render has not committed yet. But the child's own `useLayoutEffect` fires deterministically after its DOM commits. The `onContentReady` callback exploits this contract: tugcard sets a `restorePendingRef` flag, and a no-deps `useLayoutEffect` in `useTugcardPersistence` checks the flag on every commit and fires the callback when set.

#### Strategy {#strategy}

- Extend `TugcardPersistenceCallbacks` with `onContentReady` before touching the restore flow, so the contract is established first.
- Add the ref-flag mechanism (`restorePendingRef` + no-deps `useLayoutEffect`) to `useTugcardPersistence` as a general-purpose facility, not a scroll-restore one-off.
- Rewrite tugcard's restore flow to use two paths: a persist path (content registered) that calls `onRestore` and waits for `onContentReady` to apply scroll/selection (hiding content only when scroll state exists to suppress wrong-position flash); and a no-persist path (no content registered) that applies scroll directly in the Phase 1 effect without hiding.
- Rewrite RAF-dependent tests (T01, T02) for the `onContentReady` pattern.
- Verify existing spike tests pass (they were written during pre-phase exploration and already prove the React 19 commit timing guarantees).
- All 1072 existing tests must continue to pass.

#### Success Criteria (Measurable) {#success-criteria}

- Zero `requestAnimationFrame` calls in tugcard's restore flow (verified by grep: no `requestAnimationFrame` in tugcard.tsx restore effect).
- `onContentReady` fires deterministically after child DOM commits (verified by spike test and rewritten T01/T02).
- No-persistence fallback applies scroll directly without `visibility:hidden` (verified by new test).
- All 1072 existing tests pass (`bun test`).
- Spike tests (`react19-commit-timing.test.tsx` and `content-ready-spike.test.tsx`) pass and remain as reference documentation.

#### Scope {#scope}

1. Extend `TugcardPersistenceCallbacks` with `onContentReady?: () => void`.
2. Add ref-flag mechanism to `useTugcardPersistence`: `restorePendingRef` + no-deps `useLayoutEffect`.
3. Rewrite tugcard's restore flow (persist path and no-persist fallback).
4. Rewrite T01 and T02 tests for `onContentReady` pattern; add no-persistence fallback test.
5. Verify existing spike tests pass (already committed).

#### Non-goals (Explicitly out of scope) {#non-goals}

- Modifying Rules of Tugways 11 and 12 or decisions D78/D79 in design-system-concepts.md (already written).
- Monaco editor integration or any other card content changes.
- Changes to tugbank storage format or DeckManager save/flush mechanics.
- Modifying the existing `useTugcardPersistence` registration `useLayoutEffect` (the new no-deps effect is additional).

#### Dependencies / Prerequisites {#dependencies}

- Phase 5f3 must be merged (it is).
- Rules of Tugways 11 and 12 and decisions D78/D79 must be committed in design-system-concepts.md (they are).

#### Constraints {#constraints}

- All changes must follow Rules of Tugways 1-12 (including new Rules 11 and 12).
- React 19.2.4 (NOT React 18). Commit timing guarantees are verified against React 19.
- bun test runner, happy-dom environment.
- No `requestAnimationFrame` for any DOM operation that depends on React state commits (Rule 12, [D79]).
- The `onContentReady` pattern must be generally available via `useTugcardPersistence`, not a scroll-restore one-off.
- Card content `onRestore` implementations MUST call `setState` (triggering a child re-render) for the `onContentReady` mechanism to fire. Card content that restores via direct DOM mutation or no-op must not register persistence callbacks, because without a child re-render the no-deps `useLayoutEffect` never fires and `visibility:hidden` is never removed (until the next tab switch cleanup). No runtime safety timeout is added because a timeout would reintroduce the timing-bet pattern this phase eliminates.

#### Assumptions {#assumptions}

- The 1072 baseline tests all pass before this phase begins (this count includes the spike tests).
- The spike tests (`react19-commit-timing.test.tsx` and `content-ready-spike.test.tsx`) already exist and are committed from pre-phase exploration. They are not modified in this phase.
- The selection-only restore path (bag.selection exists, bag.scroll undefined) does not need `onContentReady` because `setBaseAndExtent` works without waiting for layout -- this path can apply selection directly in the Phase 1 effect.
- The existing no-deps `useLayoutEffect` guard in `useTugcardPersistence` (`[]`, `[register]`) is not changed -- the new `restorePendingRef` no-deps effect is an additional `useLayoutEffect` with no dependency array.

---

### Design Decisions {#design-decisions}

#### [D01] onContentReady as a general-purpose callback in TugcardPersistenceCallbacks (DECIDED) {#d01-on-content-ready}

**Decision:** `TugcardPersistenceCallbacks` gains an optional `onContentReady?: () => void` field. Tugcard writes this callback into `persistenceCallbacksRef.current` after the child registers and before calling `onRestore`. The hook's no-deps `useLayoutEffect` reads `onContentReady` from the same ref and calls it when `restorePendingRef` is set.

**Rationale:**
- Uses existing plumbing (`persistenceCallbacksRef`) and keeps `TugcardPersistenceCallbacks` as the single contract between Tugcard and card content.
- The callback is optional so existing card content components that don't need ready signaling are unaffected.
- General-purpose: any future consumer of `useTugcardPersistence` can provide an `onContentReady` callback for post-commit work.

**Implications:**
- `TugcardPersistenceCallbacks` interface gains one optional field.
- Tugcard mutates `persistenceCallbacksRef.current.onContentReady` before calling `onRestore` in the Phase 1 effect.
- The hook reads `onContentReady` from the ref in a no-deps `useLayoutEffect`, not from the options passed by card content.

#### [D02] Ref-flag mechanism for deterministic ready signaling (DECIDED) {#d02-ref-flag-mechanism}

**Decision:** `useTugcardPersistence` gains a `restorePendingRef` (`useRef<boolean>(false)`) and an additional no-deps `useLayoutEffect` (empty dependency array). When Tugcard calls `onRestore`, it first sets `restorePendingRef.current = true` and writes `onContentReady` into the callbacks ref. After the child's `setState` (triggered by `onRestore`) commits, the child's no-deps `useLayoutEffect` fires, checks `restorePendingRef.current`, and if true, calls `persistenceCallbacksRef.current.onContentReady()` and resets the flag.

**Rationale:**
- This is the proven 12-line mechanism from the spike: a `useLayoutEffect` with no dependencies fires on every commit, making it the perfect hook for detecting child DOM readiness.
- The ref flag ensures the callback fires only when a restore is actually pending, not on every re-render.
- Deterministic: relies on React's commit contract (child `useLayoutEffect` fires after child DOM commits), not on browser scheduling.

**Implications:**
- `useTugcardPersistence` gains one `useRef` and one `useLayoutEffect` (no dependencies).
- The `restorePendingRef` must be exposed to Tugcard. Tugcard accesses it via a new `restorePendingRef` field on the registered callbacks object (or equivalently, via a shared ref set during registration). See [D03].

#### [D03] restorePendingRef shared via TugcardPersistenceCallbacks (DECIDED) {#d03-restore-pending-ref}

**Decision:** `TugcardPersistenceCallbacks` gains an optional `restorePendingRef?: React.RefObject<boolean>` field. The hook creates the ref and includes it in the callbacks object registered with Tugcard. Tugcard reads `persistenceCallbacksRef.current.restorePendingRef` and sets it to `true` before calling `onRestore`.

**Rationale:**
- Keeps the ref co-located with the hook that owns the `useLayoutEffect` reading it.
- No new context or side channel needed -- the existing `persistenceCallbacksRef` carries it.
- The ref is a `React.RefObject<boolean>` (read-write via `.current`), which is the standard React pattern for shared mutable state between parent and child.

**Implications:**
- Tugcard's Phase 1 effect sets `persistenceCallbacksRef.current.restorePendingRef.current = true` before calling `onRestore`.
- The hook's no-deps `useLayoutEffect` checks this ref and fires `onContentReady` when true.

#### [D04] Two-path restore: persist path vs no-persist fallback (DECIDED) {#d04-two-path-restore}

**Decision:** Tugcard's activation `useLayoutEffect` checks whether `persistenceCallbacksRef.current` is non-null (card content has registered persistence). If registered (persist path): set `restorePendingRef`, write `onContentReady` callback, hide content via `visibility:hidden` only when `bag.scroll` exists (flash suppression is only needed when there is a scroll position to restore), call `onRestore`. If not registered (no-persist fallback): apply scroll directly in the Phase 1 effect without hiding, apply selection directly -- no `onContentReady` needed because there is no child `setState` to wait for.

**Rationale:**
- The no-persist path has no child re-render to wait for, so hiding content and waiting for `onContentReady` would be unnecessary overhead and a flash of hidden content.
- Scroll can be applied directly because the DOM height is already stable when no content restoration occurs.
- Selection can also be applied directly (same reasoning as the existing selection-only path).
- In the persist path, hiding is conditional on `bag.scroll` because content-only restores (no scroll saved) have no wrong-scroll-position flash to suppress.

**Implications:**
- The Phase 1 effect has an `if (persistenceCallbacksRef.current)` branch.
- No-persist path: no `visibility:hidden`, no `onContentReady`, direct scroll + selection.
- Persist path with scroll: `visibility:hidden` + `onContentReady` callback for scroll/selection/unhide.
- Persist path without scroll: no `visibility:hidden`, but `onContentReady` still fires for selection restore after child re-render.

#### [D05] Cleanup resets all pending state (DECIDED) {#d05-cleanup-reset}

**Decision:** The Phase 1 effect's cleanup function (runs when `activeTabId` changes before the new effect fires) resets `restorePendingRef.current` to `false` (cancels stale callback), clears `pendingScrollRef` and `pendingSelectionRef`, and restores content visibility. This cleanup applies to the persist path only -- the no-persist path never hid anything, so there is nothing to clean up beyond what React already handles.

**Rationale:**
- On rapid tab switches, the previous `onContentReady` callback must not fire for the old tab. Resetting the ref flag is the cancellation mechanism.
- Clearing pending refs prevents stale scroll/selection from leaking across tabs.
- Restoring visibility prevents permanently hidden content if the effect re-fires before `onContentReady`.

**Implications:**
- Cleanup function checks whether content was hidden (via a local `didHide` flag) and restores visibility if so.
- `restorePendingRef` reset is the cancellation contract -- the no-deps `useLayoutEffect` in the hook checks the flag and does nothing if it was cleared.

---

### Specification {#specification}

#### Spec S01: Extended TugcardPersistenceCallbacks {#s01-extended-callbacks}

```typescript
export interface TugcardPersistenceCallbacks {
  onSave: () => unknown;
  onRestore: (state: unknown) => void;
  /** Written by Tugcard before calling onRestore. Fired by the hook's
   *  no-deps useLayoutEffect after the child's DOM commits. */
  onContentReady?: () => void;
  /** Ref created by the hook, set to true by Tugcard before onRestore.
   *  Read by the hook's no-deps useLayoutEffect. */
  restorePendingRef?: React.RefObject<boolean>;
}
```

#### Spec S02: useTugcardPersistence ref-flag mechanism {#s02-ref-flag-mechanism}

The hook adds the following to the existing implementation:

1. A `restorePendingRef = useRef<boolean>(false)` created at hook initialization.
2. A `callbacksObjRef = useRef<TugcardPersistenceCallbacks | null>(null)` to hold the callbacks object so the no-deps effect can read `onContentReady` from it. Set inside the registration `useLayoutEffect` after `register()`.
3. The `restorePendingRef` is included in the callbacks object passed to `register()`.
4. An additional `useLayoutEffect` with no dependency array:

```typescript
useLayoutEffect(() => {
  if (!restorePendingRef.current) return;
  restorePendingRef.current = false;
  const onReady = callbacksObjRef.current?.onContentReady;
  if (onReady) onReady();
});
```

This effect fires on every commit. When `restorePendingRef` is true (set by Tugcard's Phase 1 effect), it reads `onContentReady` from `callbacksObjRef` and calls it, then resets the flag.

#### Spec S03: Tugcard restore flow (rewritten) {#s03-restore-flow}

The activation `useLayoutEffect` (`[activeTabId, cardId]`) is rewritten as follows:

**Phase 1 effect body:**

1. Early return if `!activeTabId`.
2. Read `bag = store.getTabState(activeTabId)`.
3. Early return if no bag or bag has no restorable state.
4. Check `hasPersistence = persistenceCallbacksRef.current !== null && persistenceCallbacksRef.current.restorePendingRef !== undefined`. Both conditions are required: the callbacks object must exist AND must include `restorePendingRef` (the cleanup re-registration writes a no-op pair without `restorePendingRef`, so a non-null `persistenceCallbacksRef.current` alone is not sufficient).

**Persist path** (`hasPersistence && bag.content !== undefined`):
1. Store pending scroll in `pendingScrollRef.current`.
2. Store pending selection in `pendingSelectionRef.current`.
3. If `bag.scroll` exists, apply `visibility:hidden` to `contentRef.current` (set `didHide = true`). Content-only restores without scroll skip hiding because there is no wrong-scroll-position flash to suppress.
4. Write `onContentReady` callback into `persistenceCallbacksRef.current`:
   - Apply `pendingScrollRef.current` (scrollLeft/scrollTop) if present.
   - If `didHide`, restore visibility.
   - Apply `pendingSelectionRef.current` (selectionGuard.restoreSelection) if present.
   - Clear pending refs.
5. Set `persistenceCallbacksRef.current.restorePendingRef!.current = true` (safe: `hasPersistence` guard already checked `restorePendingRef !== undefined`).
6. Call `persistenceCallbacksRef.current.onRestore(bag.content)`.

**Direct-apply fallback** (`!hasPersistence`, which covers both no-persistence-registered AND persistence-registered-but-no-content cases):
1. Apply scroll directly (scrollLeft/scrollTop) if `bag.scroll` exists.
2. Apply selection directly (selectionGuard.restoreSelection) if `bag.selection` exists.
3. No `visibility:hidden`, no `onContentReady` (either no child to re-render, or no content to restore).

**Cleanup:**
1. If `didHide`, restore `contentRef.current.style.visibility = ""`.
2. If `persistenceCallbacksRef.current?.restorePendingRef`, set `.current = false`.
3. Clear `pendingScrollRef.current` and `pendingSelectionRef.current`.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. The spike test files (`src/__tests__/react19-commit-timing.test.tsx` and `src/__tests__/content-ready-spike.test.tsx`) already exist from pre-phase exploration.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugcardPersistenceCallbacks.onContentReady` | optional field | `use-tugcard-persistence.tsx` | `() => void`, written by Tugcard |
| `TugcardPersistenceCallbacks.restorePendingRef` | optional field | `use-tugcard-persistence.tsx` | `React.RefObject<boolean>`, created by hook |
| `restorePendingRef` | useRef | `useTugcardPersistence()` | `useRef<boolean>(false)` |
| `callbacksObjRef` | useRef | `useTugcardPersistence()` | `useRef<TugcardPersistenceCallbacks \| null>(null)`, holds callbacks for no-deps effect |
| no-deps `useLayoutEffect` | hook call | `useTugcardPersistence()` | Fires onContentReady when restorePendingRef is true |
| `pendingScrollRef` | useRef | `Tugcard` | `useRef<{x: number, y: number} \| null>(null)` |
| `pendingSelectionRef` | useRef | `Tugcard` | `useRef<unknown>(null)` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Spike/Reference** | Prove React 19 commit timing guarantees that the pattern depends on | Written once, kept permanently as documentation |
| **Unit** | Test onContentReady mechanism in useTugcardPersistence in isolation | Hook behavior, ref-flag lifecycle |
| **Integration** | Test end-to-end restore flow through Tugcard with onContentReady | T01/T02 rewrites, no-persist fallback |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Verify existing spike tests pass {#step-1}

**Commit:** `N/A (verification only)`

**References:** [D02] Ref-flag mechanism, (#context, #strategy)

**Artifacts:**
- `src/__tests__/react19-commit-timing.test.tsx` (existing) -- proves that when a parent effect calls child `setState`, the child's `useLayoutEffect` fires after child DOM commit in the same synchronous flush
- `src/__tests__/content-ready-spike.test.tsx` (existing) -- proves the ref-flag `onContentReady` pattern works: parent sets flag + triggers child setState, child's no-deps useLayoutEffect reads flag and fires callback with correct DOM state

**Tasks:**
- [ ] Run both spike test files and verify all assertions pass
- [ ] Confirm the spike tests document the React 19 commit timing guarantees that Steps 2-4 depend on

**Tests:**
- [ ] `react19-commit-timing.test.tsx` -- all spike assertions pass
- [ ] `content-ready-spike.test.tsx` -- all spike assertions pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/react19-commit-timing.test.tsx`
- [ ] `cd tugdeck && bun test src/__tests__/content-ready-spike.test.tsx`

---

#### Step 2: Extend TugcardPersistenceCallbacks and useTugcardPersistence {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add onContentReady ref-flag mechanism to useTugcardPersistence`

**References:** [D01] onContentReady callback, [D02] Ref-flag mechanism, [D03] restorePendingRef shared via callbacks, Spec S01, Spec S02, (#s01-extended-callbacks, #s02-ref-flag-mechanism)

**Artifacts:**
- Modified `src/components/tugways/use-tugcard-persistence.tsx`:
  - `TugcardPersistenceCallbacks` gains `onContentReady?: () => void` and `restorePendingRef?: React.RefObject<boolean>`
  - `useTugcardPersistence` gains `restorePendingRef = useRef<boolean>(false)` included in registered callbacks
  - New no-deps `useLayoutEffect` that fires `onContentReady` when `restorePendingRef.current` is true

**Tasks:**
- [ ] Add `onContentReady?: () => void` to `TugcardPersistenceCallbacks` interface
- [ ] Add `restorePendingRef?: React.RefObject<boolean>` to `TugcardPersistenceCallbacks` interface (use `React.RefObject<boolean>` which is read-write in React 19)
- [ ] In `useTugcardPersistence`, create `const restorePendingRef = useRef<boolean>(false)`
- [ ] Create `const callbacksObjRef = useRef<TugcardPersistenceCallbacks | null>(null)` to hold the callbacks object after creation, so the no-deps effect can read `onContentReady` from it
- [ ] Include `restorePendingRef` in the callbacks object passed to `register()`
- [ ] Store the callbacks object in `callbacksObjRef.current` after creation (inside the registration `useLayoutEffect` body, after `register()`)
- [ ] Add no-deps `useLayoutEffect` after the existing registration effect:
  ```typescript
  useLayoutEffect(() => {
    if (!restorePendingRef.current) return;
    restorePendingRef.current = false;
    const onReady = callbacksObjRef.current?.onContentReady;
    if (onReady) onReady();
  });
  ```
- [ ] Add a code comment on `callbacksObjRef` explaining that it may reference a stale callbacks object after unmount cleanup (which re-registers a no-op pair). This is safe because unmounting means no further effects fire, so the no-deps `useLayoutEffect` never reads the stale ref.
- [ ] Update JSDoc comments referencing [D78], Rule 11, Rule 12

**Tests:**
- [ ] Existing `use-tugcard-persistence.test.tsx` tests (T-P01, T-P02, T-P03) still pass unchanged
- [ ] Add T-P04: `restorePendingRef` is included in registered callbacks and defaults to `false`
- [ ] Add T-P05: when `restorePendingRef.current` is set to `true` and `onContentReady` is written, triggering a re-render causes the no-deps effect to fire `onContentReady` and reset the flag
- [ ] Add T-P06: exercises the parent-sets-ref, child-reads-ref indirection that the actual Tugcard code path uses (distinct from the spike which bundles flag-set + onRestore atomically). The test provider sets `callbacks.restorePendingRef.current = true`, writes `callbacks.onContentReady = mock()`, then calls `callbacks.onRestore(state)` (which triggers child setState). Verify `onContentReady` fires after the child re-render commits and the flag is reset to `false`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/use-tugcard-persistence.test.tsx`

---

#### Step 3: Rewrite tugcard restore flow {#step-3}

**Depends on:** #step-2

**Commit:** `feat: replace double-RAF with onContentReady in tugcard restore flow`

**References:** [D01] onContentReady callback, [D04] Two-path restore, [D05] Cleanup reset, Spec S03, (#s03-restore-flow, #d04-two-path-restore, #d05-cleanup-reset)

**Artifacts:**
- Modified `src/components/tugways/tugcard.tsx`:
  - New refs: `pendingScrollRef`, `pendingSelectionRef`
  - Rewritten activation `useLayoutEffect` (`[activeTabId, cardId]`) with persist path and no-persist fallback
  - Removed all `requestAnimationFrame` and `cancelAnimationFrame` from the restore flow
  - Updated JSDoc comments referencing [D78], [D79], Rules 11 and 12

**Tasks:**
- [ ] Add `pendingScrollRef = useRef<{x: number, y: number} | null>(null)` to Tugcard
- [ ] Add `pendingSelectionRef = useRef<unknown>(null)` to Tugcard
- [ ] Rewrite the activation `useLayoutEffect` (currently lines 344-409):
  - **Persist path** (`persistenceCallbacksRef.current !== null && persistenceCallbacksRef.current.restorePendingRef !== undefined && bag.content !== undefined`):
    1. Store `bag.scroll` in `pendingScrollRef.current`
    2. Store `bag.selection` in `pendingSelectionRef.current`
    3. If `bag.scroll` exists, apply `visibility:hidden` to `contentRef.current`; set local `didHide = true`. Content-only restores without scroll skip hiding (no wrong-scroll-position flash to suppress).
    4. Write `onContentReady` into `persistenceCallbacksRef.current`:
       - Apply scroll from `pendingScrollRef.current` if present
       - If `didHide`, restore `visibility: ""`
       - Apply selection from `pendingSelectionRef.current` if present
       - Clear pending refs
    5. Set `persistenceCallbacksRef.current.restorePendingRef!.current = true` (safe: persist path guard already checked `restorePendingRef !== undefined`)
    6. Call `persistenceCallbacksRef.current.onRestore(bag.content)`
  - **Direct-apply fallback** (no persistence registered, OR persistence registered but `bag.content` undefined):
    1. Apply scroll directly if `bag.scroll` exists
    2. Apply selection directly if `bag.selection` exists
    3. No visibility hiding, no `onContentReady` (either no child to re-render, or no content to restore)
- [ ] Rewrite cleanup:
  - If `didHide`, restore `visibility: ""`
  - If `persistenceCallbacksRef.current?.restorePendingRef`, set `.current = false`
  - Clear `pendingScrollRef.current = null`
  - Clear `pendingSelectionRef.current = null`
- [ ] Remove all `requestAnimationFrame` / `cancelAnimationFrame` references from the restore effect
- [ ] Update the block comment above the effect to reference [D78], [D79], Rules 11, 12

**Tests:**
- [ ] Verify the restore flow compiles without type errors

**Checkpoint:**
- [ ] `cd tugdeck && bun test` (all 1072+ tests pass)
- [ ] Grep: `grep -n 'requestAnimationFrame\|cancelAnimationFrame' src/components/tugways/tugcard.tsx` returns no non-comment matches (updated comments describing the old pattern are acceptable)

---

#### Step 4: Rewrite T01/T02 tests and add no-persist fallback test {#step-4}

**Depends on:** #step-3

**Commit:** `test: rewrite RAF-dependent tests for onContentReady pattern`

**References:** [D01] onContentReady callback, [D04] Two-path restore, Spec S03, (#s03-restore-flow, #d04-two-path-restore, #success-criteria)

**Artifacts:**
- Modified `src/__tests__/tugcard.test.tsx`:
  - T01 rewritten: verifies `onContentReady` fires after child DOM commits (no RAF involved)
  - T02 rewritten: verifies content-only restore still works synchronously via `onContentReady`
  - New T03: no-persist fallback test -- verifies scroll applied directly without `visibility:hidden` when no card content registered persistence
  - Existing selection-restore test rewritten: removes double-RAF flushing, verifies synchronous selection restore
  - New T04: selection-only restore with persistence registered -- verifies synchronous application without `onContentReady`

**Tasks:**
- [ ] Rewrite T01 ("onRestore is called synchronously before RAF"):
  - Remove RAF-blocking setup (no longer relevant)
  - Verify `onRestore` is called in the Phase 1 effect
  - Verify `onContentReady` callback fires after child re-render commits
  - Verify scroll and selection are applied by `onContentReady` (check `contentEl.scrollTop`, selection state)
  - Verify `visibility:hidden` is applied before `onContentReady` and removed after
- [ ] Rewrite T02 ("content-only restore with persistence, no scroll"):
  - Remove RAF-counting setup (no longer relevant)
  - Verify `onRestore` fires and `onContentReady` fires with correct DOM
  - Verify `visibility:hidden` is NOT applied (content-only without scroll skips hiding per Spec S03)
  - Verify `onContentReady` still fires after child re-render commits (the ref-flag mechanism is active regardless of hiding)
- [ ] Add T03: no-persist fallback test:
  - Render Tugcard with saved scroll state but no card content `useTugcardPersistence` registration
  - Verify scroll is applied directly in the Phase 1 effect
  - Verify `visibility:hidden` is never applied
  - Verify no `onContentReady` mechanism is engaged
- [ ] Rewrite existing selection-restore test ("after tab activation, selectionGuard.restoreSelection is called with the saved selection", around line 1050):
  - Remove double-RAF flushing (`setTimeout(resolve, 0)` x2) -- the new flow applies selection synchronously in useLayoutEffect for selection-only bags (no content, no scroll)
  - Verify `selectionGuard.restoreSelection` is called synchronously within `act()` (no async flushing needed)
  - This test covers the selection-only path with no persistence registered (no-persist fallback)
- [ ] Add T04: selection-only restore with persistence registered (bag has selection only, no scroll, no content):
  - Verify `setBaseAndExtent` / `selectionGuard.restoreSelection` is called synchronously in useLayoutEffect
  - Verify no `visibility:hidden` is applied
  - Verify no `onContentReady` is engaged (no `onRestore` call since bag.content is undefined)
- [ ] Update test section header comment to reference Phase 5f4

**Tests:**
- [ ] T01 passes with onContentReady-based assertions
- [ ] T02 passes with updated assertions
- [ ] T03 passes verifying no-persist fallback behavior
- [ ] Existing selection-restore test passes with synchronous assertions (no RAF flushing)
- [ ] T04 passes verifying selection-only restore with persistence registered

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tugcard.test.tsx`

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] onContentReady callback, [D02] Ref-flag mechanism, [D04] Two-path restore, [D05] Cleanup reset, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all spike tests pass
- [ ] Verify all useTugcardPersistence tests pass (including new T-P04, T-P05)
- [ ] Verify all tugcard tests pass (including rewritten T01, T02, new T03)
- [ ] Verify zero `requestAnimationFrame` in tugcard restore flow
- [ ] Verify all 1072+ existing tests pass

**Tests:**
- [ ] Full test suite passes with zero failures

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep -n 'requestAnimationFrame\|cancelAnimationFrame' src/components/tugways/tugcard.tsx` returns no non-comment matches

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Deterministic child-driven ready callback replaces the double-RAF timing bet in tugcard's restore flow, with `onContentReady` established as a general-purpose primitive in `useTugcardPersistence`.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `TugcardPersistenceCallbacks` includes `onContentReady` and `restorePendingRef` (code review)
- [ ] `useTugcardPersistence` includes ref-flag mechanism with no-deps `useLayoutEffect` (code review)
- [ ] Tugcard restore flow has zero `requestAnimationFrame` calls (`grep` verification)
- [ ] No-persist fallback applies scroll directly without hiding (T03 test)
- [ ] All tests pass (`bun test`)
- [ ] Spike tests exist as permanent reference documentation

**Acceptance tests:**
- [ ] `bun test src/__tests__/react19-commit-timing.test.tsx` -- spike passes
- [ ] `bun test src/__tests__/content-ready-spike.test.tsx` -- spike passes
- [ ] `bun test src/__tests__/use-tugcard-persistence.test.tsx` -- all pass including T-P04, T-P05
- [ ] `bun test src/__tests__/tugcard.test.tsx` -- all pass including rewritten T01, T02, new T03
- [ ] `bun test` -- all 1072+ tests pass

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Apply `onContentReady` pattern to Monaco editor integration when Monaco cards are implemented
- [ ] Consider whether `onContentReady` should support async ready signaling (e.g., for network-dependent content)

| Checkpoint | Verification |
|------------|--------------|
| Spike tests pass | `bun test src/__tests__/react19-commit-timing.test.tsx && bun test src/__tests__/content-ready-spike.test.tsx` |
| Hook tests pass | `bun test src/__tests__/use-tugcard-persistence.test.tsx` |
| Tugcard tests pass | `bun test src/__tests__/tugcard.test.tsx` |
| Full suite passes | `cd tugdeck && bun test` |
| No RAF in restore | `grep -n 'requestAnimationFrame' src/components/tugways/tugcard.tsx` shows no non-comment matches |
