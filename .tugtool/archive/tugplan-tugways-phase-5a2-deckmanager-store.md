<!-- tugplan-skeleton v2 -->

## Tugways Phase 5a2: DeckManager Store Migration {#deckmanager-store}

**Purpose:** DeckManager becomes a subscribable store with a single `root.render()` at construction time. All subsequent state changes flow through `useSyncExternalStore`, eliminating the async render gap that causes timing bugs between imperative state and React rendering.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5a2-deckmanager-store |
| Last updated | 2026-03-03 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

React 19's `createRoot().render()` is asynchronous -- it schedules work via `queueMicrotask()` and returns immediately. DeckManager currently calls `root.render()` on every state mutation (in `addCard`, `removeCard`, `moveCard`, `focusCard`, `applyLayout`, `refresh`, and the constructor), creating a timing gap where imperative code (like `makeFirstResponder` in the `cyclePanel` action) runs before React has processed the render. This manifests as responder chain bugs (Ctrl+\` cycling fails intermittently) and will affect any future feature that combines imperative state mutations with React rendering.

The fix is well-established in the React ecosystem: make DeckManager a subscribable store that conforms to the `useSyncExternalStore` contract. `useSyncExternalStore` forces SyncLane updates (always synchronous, no concurrent interleaving), eliminating tearing between store state and rendered UI. Combined with switching `useResponder` registration from `useEffect` to `useLayoutEffect`, this guarantees that all responder registrations complete in the same synchronous commit phase before the browser returns to the event loop.

#### Strategy {#strategy}

- Add the `useSyncExternalStore` contract (`subscribe`, `getSnapshot`, `notify`) to DeckManager as the store primitive.
- Extract an `IDeckManagerStore` interface into a separate types file to avoid circular imports between `deck-manager.ts` and `deck-manager-context.tsx`.
- Create a React context (`DeckManagerContext`) and convenience hook (`useDeckManager`) so components can access the DeckManager instance.
- Wrap the single `root.render()` in the constructor with `DeckManagerContext.Provider`, making it the only render call that ever executes.
- Replace all `this.render()` calls in mutating methods with `this.notify()`, then remove the private `render()` method entirely.
- Migrate DeckCanvas from prop-driven state to store-driven state via `useSyncExternalStore`.
- Switch `useResponder` registration from `useEffect` to `useLayoutEffect` for commit-phase registration.

#### Success Criteria (Measurable) {#success-criteria}

- All existing tests pass without modification (except test files that must adapt to the new DeckCanvas API by providing a store context instead of deckState props).
- DeckManager has zero calls to `this.render()` or `root.render()` after construction.
- DeckCanvas reads `deckState` exclusively via `useSyncExternalStore` -- the `deckState` prop is removed from `DeckCanvasProps`.
- `useResponder` uses `useLayoutEffect` for registration.
- `bun test` passes with no regressions.

#### Scope {#scope}

1. DeckManager subscribable store API (`subscribe`, `getSnapshot`, `getVersion`, `notify`).
2. `IDeckManagerStore` interface in a new types file.
3. `DeckManagerContext` and `useDeckManager` hook in a new module.
4. Constructor wraps single `root.render()` with `DeckManagerContext.Provider`.
5. All `this.render()` calls in mutating methods replaced with `this.notify()`.
6. DeckCanvas migrated from props to store subscription.
7. `useResponder` registration switched from `useEffect` to `useLayoutEffect`.

#### Non-goals (Explicitly out of scope) {#non-goals}

- New user-facing features -- this is a pure infrastructure refactor.
- Changes to the card registry, serialization, or layout persistence logic.
- Changes to `action-dispatch.ts` beyond what naturally follows from the DeckManager API change.
- Server-side or backend changes.
- Tab switching, card snapping, or any Phase 5b+ work.

#### Dependencies / Prerequisites {#dependencies}

- Phase 5a (Selection Model) must be complete -- card content in all subsequent phases needs correct selection behavior.
- Phase 5 (Tugcard Base) must be complete -- DeckManager, DeckCanvas, CardFrame, and Tugcard are all in place.

#### Constraints {#constraints}

- No new runtime dependencies. `useSyncExternalStore` is built into React 18+/19.
- The `IDeckManagerStore` interface must live in a separate types file to prevent circular imports.
- All existing tests must continue to pass (with minimal test-side adaptations for the new context-based API).
- Warnings are errors -- `bun test` must produce zero warnings.

#### Assumptions {#assumptions}

- `subscribe()` follows the standard `useSyncExternalStore` contract: takes a callback, calls it on every `notify()`, returns an unsubscribe function.
- `getSnapshot()` returns the current `deckState` object reference -- the existing shallow-copy-on-mutation pattern (`this.deckState = { ...this.deckState }`) means React sees a new reference after every `notify()`.
- `getVersion()` returns a monotonically increasing integer incremented by `notify()` -- used by TugButton's `useSyncExternalStore` subscription for the responder chain validation version (already in ResponderChainManager), not directly by DeckCanvas.
- The single `root.render()` in the DeckManager constructor wraps the entire provider tree: `TugThemeProvider > ErrorBoundary > ResponderChainProvider > DeckManagerContext.Provider > DeckCanvas`.
- The `useLayoutEffect` change in `useResponder` is safe for the existing test suite because happy-dom and React Testing Library flush `useLayoutEffect` synchronously inside `act()`.
- The `refresh()` method on DeckManager becomes `this.notify()` internally -- its public signature is kept for any external callers (e.g., action-dispatch).
- No new user-visible behavior is introduced -- this is a pure infrastructure refactor.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the skeleton v2 anchor and reference conventions. All headings that are referenced use explicit `{#anchor}` syntax. Steps cite decisions, specs, and anchors in their `**References:**` lines.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Existing tests break due to DeckCanvas prop removal | med | med | Adapt test helpers to provide DeckManagerContext | Any test failure after Step 5 |
| useLayoutEffect causes test warnings in happy-dom | low | low | happy-dom flushes useLayoutEffect synchronously in act() | Warning output in test runs |
| Circular import between deck-manager and context | med | med | IDeckManagerStore interface in separate types file | TypeScript compilation error |

**Risk R01: Test Breakage from DeckCanvas Prop Removal** {#r01-test-breakage}

- **Risk:** DeckCanvas tests currently pass `deckState` and callback props directly. Removing these props will break existing test call sites.
- **Mitigation:**
  - Update test helpers to wrap DeckCanvas in a mock DeckManager store provider.
  - Keep `connection` prop on DeckCanvas for DisconnectBanner (unchanged).
  - Adapt tests incrementally in Step 5, verifying each test passes before moving on.
- **Residual risk:** Tests that rely on specific prop-passing patterns may need deeper refactoring, but the existing test suite is small and well-structured.

**Risk R02: Circular Import** {#r02-circular-import}

- **Risk:** `deck-manager-context.tsx` needs to reference DeckManager's type, and DeckManager needs to import the context provider. This creates a circular dependency.
- **Mitigation:** Extract `IDeckManagerStore` interface (with `subscribe`, `getSnapshot`, `getVersion`, and callback methods) into `tugdeck/src/deck-manager-store.ts`. The context module imports only the interface, not the class.
- **Residual risk:** None -- this is a standard TypeScript pattern for breaking circular dependencies.

---

### Design Decisions {#design-decisions}

#### [D01] DeckManager is a subscribable store with one root.render() at mount (DECIDED) {#d01-subscribable-store}

**Decision:** DeckManager implements the `useSyncExternalStore` contract (`subscribe`, `getSnapshot`, `getVersion`) and calls `root.render()` exactly once in the constructor. All subsequent state changes call `notify()` instead of `render()`.

**Rationale:**
- `useSyncExternalStore` forces SyncLane updates, eliminating the async render gap.
- One `root.render()` call means no timing races between imperative mutations and React rendering.
- This is the pattern prescribed by [D40] in design-system-concepts.md and Rule of Tug #1.

**Implications:**
- The private `render()` method is removed from DeckManager entirely.
- Every mutating method (`addCard`, `removeCard`, `moveCard`, `focusCard`, `applyLayout`, `refresh`) calls `this.notify()` instead of `this.render()`.
- DeckCanvas reads state via `useSyncExternalStore(store.subscribe, store.getSnapshot)` instead of props. The variable is named `store` (not `manager`) to avoid collision with the existing `manager` variable used for `ResponderChainManager` in DeckCanvas.

#### [D02] Extract IDeckManagerStore interface to break circular imports (DECIDED) {#d02-store-interface}

**Decision:** An `IDeckManagerStore` interface defining `subscribe`, `getSnapshot`, `getVersion`, and the stable callback methods (`handleCardMoved`, `handleCardClosed`, `handleCardFocused`) lives in `tugdeck/src/deck-manager-store.ts`. The context module imports only this interface.

**Rationale:**
- DeckManager imports the context provider for the `root.render()` wrapper.
- The context module needs a type for the store. Importing the DeckManager class would create a circular dependency.
- An interface in a separate file breaks the cycle cleanly.

**Implications:**
- `DeckManagerContext` is typed as `createContext<IDeckManagerStore | null>(null)`.
- `useDeckManager()` returns `IDeckManagerStore`.
- DeckManager class implements `IDeckManagerStore`.

#### [D03] useResponder uses useLayoutEffect for registration (DECIDED) {#d03-layout-effect}

**Decision:** `useResponder` switches its registration `useEffect` to `useLayoutEffect`. Responder nodes register during the commit phase (after DOM mutations, before paint), not in a deferred effect.

**Rationale:**
- Combined with [D01]'s SyncLane renders, registration is always complete before the next browser event fires.
- This ensures the responder chain is consistent when keyboard/pointer handlers run.
- This is prescribed by [D41] in design-system-concepts.md and Rule of Tug #3.

**Implications:**
- `use-responder.tsx` import changes from `useEffect` to `useLayoutEffect`.
- Existing tests are unaffected because happy-dom flushes `useLayoutEffect` synchronously inside `act()`.

#### [D04] DeckCanvas reads state from store, not props (DECIDED) {#d04-canvas-reads-store}

**Decision:** DeckCanvas obtains `deckState` via `const store = useDeckManager()` followed by `useSyncExternalStore(store.subscribe, store.getSnapshot)`, and reads stable callback methods (`store.handleCardMoved`, `store.handleCardClosed`, `store.handleCardFocused`) from the store instance. The `deckState`, `onCardMoved`, `onCardClosed`, and `onCardFocused` props are removed from `DeckCanvasProps`. The variable is named `store` to avoid collision with the existing `manager` variable (ResponderChainManager) in DeckCanvas.

**Rationale:**
- Props were the delivery mechanism for `root.render()` calls. With a single `root.render()`, props cannot update state.
- `useSyncExternalStore` is the React-sanctioned way to read external mutable state.
- Callbacks are stable (bound once in the DeckManager constructor), so reading them from the instance is safe.

**Implications:**
- `DeckCanvasProps` retains only `connection` (for DisconnectBanner).
- Test helpers must wrap DeckCanvas in a `DeckManagerContext.Provider` with a mock or real store.
- The `deckState` default (`{ cards: [] }`) moves from prop defaulting to store initialization.

---

### Specification {#specification}

#### IDeckManagerStore Interface {#store-interface}

**Spec S01: IDeckManagerStore** {#s01-store-interface}

```typescript
// tugdeck/src/deck-manager-store.ts

import type { DeckState } from "./layout-tree";

/**
 * Subscribable store interface for DeckManager.
 * Conforms to the useSyncExternalStore contract.
 */
export interface IDeckManagerStore {
  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   * Must be an arrow property (stable identity, auto-bound this)
   * so it can be passed directly to useSyncExternalStore without .bind().
   */
  subscribe: (callback: () => void) => () => void;

  /**
   * Return the current DeckState snapshot.
   * Must be an arrow property (stable identity, auto-bound this).
   */
  getSnapshot: () => DeckState;

  /**
   * Return the current state version (monotonically increasing integer).
   * Must be an arrow property (stable identity, auto-bound this).
   */
  getVersion: () => number;

  /** Stable bound callback: update card position/size on drag-end/resize-end. */
  handleCardMoved: (
    id: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;

  /** Stable bound callback: remove a card. */
  handleCardClosed: (id: string) => void;

  /** Stable bound callback: bring a card to front. */
  handleCardFocused: (id: string) => void;
}
```

#### DeckManagerContext Module {#context-module}

**Spec S02: DeckManagerContext and useDeckManager** {#s02-context-hook}

```typescript
// tugdeck/src/deck-manager-context.tsx

import { createContext, useContext } from "react";
import type { IDeckManagerStore } from "./deck-manager-store";

export const DeckManagerContext = createContext<IDeckManagerStore | null>(null);

export function useDeckManager(): IDeckManagerStore {
  const store = useContext(DeckManagerContext);
  if (store === null) {
    throw new Error("useDeckManager must be used inside a DeckManagerContext.Provider");
  }
  return store;
}
```

#### DeckManager Store Methods {#store-methods}

**Spec S03: DeckManager store API additions** {#s03-store-api}

| Member | Kind | Visibility | Description |
|--------|------|-----------|-------------|
| `subscribe` | arrow property | public | Adds callback to subscriber set, returns unsubscribe function. Arrow property for stable identity and auto-bound `this`. |
| `getSnapshot` | arrow property | public | Returns `this.deckState` (current snapshot reference). Arrow property for stable identity and auto-bound `this`. |
| `getVersion` | arrow property | public | Returns `this.stateVersion` (monotonically increasing integer). Arrow property for stable identity and auto-bound `this`. |
| `notify()` | method | private | Increments `stateVersion`, fires all subscriber callbacks |

`subscribe`, `getSnapshot`, and `getVersion` are defined as arrow function class properties (not regular methods) so they auto-bind `this` and have stable function identity. This means they can be passed directly to `useSyncExternalStore(store.subscribe, store.getSnapshot)` without `.bind()`, and React will not trigger unnecessary re-subscriptions on every render.

The existing `getDeckState()` method is kept as a convenience alias that calls `this.getSnapshot()` for backward compatibility with `action-dispatch.ts` and tests.

#### DeckCanvas Revised Props {#canvas-props}

**Spec S04: DeckCanvasProps after migration** {#s04-canvas-props}

```typescript
export interface DeckCanvasProps {
  connection: TugConnection | null;
}
```

All other props (`deckState`, `onCardMoved`, `onCardClosed`, `onCardFocused`) are removed. DeckCanvas reads them from the store via context.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/deck-manager-store.ts` | `IDeckManagerStore` interface (breaks circular import) |
| `tugdeck/src/deck-manager-context.tsx` | `DeckManagerContext` + `useDeckManager()` hook |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `IDeckManagerStore` | interface | `tugdeck/src/deck-manager-store.ts` | Store contract: subscribe, getSnapshot, getVersion, callbacks |
| `DeckManagerContext` | const (React context) | `tugdeck/src/deck-manager-context.tsx` | `createContext<IDeckManagerStore \| null>(null)` |
| `useDeckManager` | function (hook) | `tugdeck/src/deck-manager-context.tsx` | Convenience hook, throws if context is null |
| `DeckManager.subscribe` | arrow property | `tugdeck/src/deck-manager.ts` | useSyncExternalStore contract; stable identity, auto-bound `this` |
| `DeckManager.getSnapshot` | arrow property | `tugdeck/src/deck-manager.ts` | Returns current deckState; stable identity, auto-bound `this` |
| `DeckManager.getVersion` | arrow property | `tugdeck/src/deck-manager.ts` | Returns stateVersion; stable identity, auto-bound `this` |
| `DeckManager.notify` | private method | `tugdeck/src/deck-manager.ts` | Increments version, fires subscribers |
| `DeckManager.subscribers` | private field | `tugdeck/src/deck-manager.ts` | `Set<() => void>` |
| `DeckManager.stateVersion` | private field | `tugdeck/src/deck-manager.ts` | `number`, starts at 0 |
| `DeckManager.handleCardMoved` | private -> public field | `tugdeck/src/deck-manager.ts` | Visibility change: required by IDeckManagerStore interface |
| `DeckManager.handleCardClosed` | private -> public field | `tugdeck/src/deck-manager.ts` | Visibility change: required by IDeckManagerStore interface |
| `DeckManager.handleCardFocused` | private -> public field | `tugdeck/src/deck-manager.ts` | Visibility change: required by IDeckManagerStore interface |
| `DeckManager.render` | private method (REMOVED) | `tugdeck/src/deck-manager.ts` | Deleted -- replaced by single root.render() in constructor |
| `DeckCanvasProps.deckState` | prop (REMOVED) | `tugdeck/src/components/chrome/deck-canvas.tsx` | Read from store instead |
| `DeckCanvasProps.onCardMoved` | prop (REMOVED) | `tugdeck/src/components/chrome/deck-canvas.tsx` | Read from store instead |
| `DeckCanvasProps.onCardClosed` | prop (REMOVED) | `tugdeck/src/components/chrome/deck-canvas.tsx` | Read from store instead |
| `DeckCanvasProps.onCardFocused` | prop (REMOVED) | `tugdeck/src/components/chrome/deck-canvas.tsx` | Read from store instead |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test DeckManager store API (subscribe, getSnapshot, notify) in isolation | Step 1 store API tests |
| **Integration** | Test DeckCanvas reading from store via context, responder chain timing | Steps 5 and 6 |
| **Regression** | Verify all existing tests pass with adapted test helpers | Step 7 verification |

#### Test Strategy: Mock Store Provider {#test-strategy}

DeckCanvas tests use minimal mock object literals implementing `IDeckManagerStore` -- not real DeckManager instances. This avoids the complexity of constructing a real DeckManager (which needs a DOM container, mock connection, createRoot, etc.) and keeps tests focused on DeckCanvas behavior. The mock provides a `getSnapshot()` with the desired `DeckState`, a trivial `subscribe`, and stable no-op callbacks. Tests that need callback behavior override individual fields with spies. This follows the user's stated preference for mock store providers.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add IDeckManagerStore interface {#step-1}

**Commit:** `feat(tugdeck): add IDeckManagerStore interface for store contract`

**References:** [D02] Extract IDeckManagerStore interface to break circular imports, Spec S01 (#s01-store-interface), (#store-interface, #r02-circular-import)

**Artifacts:**
- New file: `tugdeck/src/deck-manager-store.ts`

**Tasks:**
- [ ] Create `tugdeck/src/deck-manager-store.ts` with the `IDeckManagerStore` interface as specified in Spec S01.
- [ ] The interface defines: `subscribe(callback: () => void): () => void`, `getSnapshot(): DeckState`, `getVersion(): number`, `handleCardMoved`, `handleCardClosed`, `handleCardFocused`.
- [ ] Import `DeckState` from `./layout-tree` (no circular dependency -- layout-tree is a pure types file).

**Tests:**
- [ ] TypeScript compilation succeeds with no errors (`bun run typecheck` or `bunx tsc --noEmit`).

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`

---

#### Step 2: Create DeckManagerContext and useDeckManager hook {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add DeckManagerContext and useDeckManager hook`

**References:** [D02] Extract IDeckManagerStore interface, Spec S02 (#s02-context-hook), (#context-module)

**Artifacts:**
- New file: `tugdeck/src/deck-manager-context.tsx`

**Tasks:**
- [ ] Create `tugdeck/src/deck-manager-context.tsx` with `DeckManagerContext` and `useDeckManager()` as specified in Spec S02.
- [ ] `DeckManagerContext` is `createContext<IDeckManagerStore | null>(null)`.
- [ ] `useDeckManager()` reads the context and throws a descriptive error if null.
- [ ] Import only `IDeckManagerStore` from `./deck-manager-store` (no import of DeckManager class).

**Tests:**
- [ ] TypeScript compilation succeeds with no errors.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`

---

#### Step 3: Add subscribe/getSnapshot/getVersion/notify to DeckManager {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add subscribable store API to DeckManager`

**References:** [D01] DeckManager is a subscribable store, Spec S03 (#s03-store-api), (#store-methods, #assumptions)

**Artifacts:**
- Modified file: `tugdeck/src/deck-manager.ts`

**Tasks:**
- [ ] Change `handleCardMoved`, `handleCardClosed`, and `handleCardFocused` from `private` to `public`. These are currently declared as `private` fields in DeckManager but must be public to satisfy the `IDeckManagerStore` interface contract. No other code changes are needed -- they are already bound in the constructor and used as stable callbacks.
- [ ] Add private field `subscribers: Set<() => void> = new Set()`.
- [ ] Add private field `stateVersion: number = 0`.
- [ ] Add public arrow property `subscribe = (callback: () => void): (() => void) => { ... }` -- adds callback to subscribers, returns unsubscribe function that removes it. Must be an arrow property (not a regular method) so `this` is auto-bound and the function has stable identity. This allows `useSyncExternalStore(store.subscribe, store.getSnapshot)` without `.bind()`.
- [ ] Add public arrow property `getSnapshot = (): DeckState => this.deckState` -- returns the current deckState reference. Arrow property for stable identity and auto-bound `this`.
- [ ] Add public arrow property `getVersion = (): number => this.stateVersion` -- returns the current state version. Arrow property for stable identity and auto-bound `this`.
- [ ] Add private method `notify(): void` -- increments `this.stateVersion` and calls each subscriber callback. Note: the shallow copy of `this.deckState` is already performed by the calling mutating method (e.g., `addCard`, `removeCard`), so `notify()` does NOT need to copy again.
- [ ] Make DeckManager implement `IDeckManagerStore` (add `implements IDeckManagerStore` to class declaration, import the interface).
- [ ] Keep `getDeckState()` as a convenience alias that calls `this.getSnapshot()`.

**Tests:**
- [ ] New unit test: `subscribe()` returns an unsubscribe function; calling the unsubscribe function removes the listener.
- [ ] New unit test: `getSnapshot()` returns current deckState; after `addCard()`, `getSnapshot()` reflects the new card.
- [ ] New unit test: `getVersion()` increments after each mutating method call.
- [ ] New unit test: subscriber callback fires on `addCard()`, `removeCard()`, `moveCard()`, `focusCard()`.
- [ ] All existing DeckManager tests still pass.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 4: Wrap constructor root.render() with DeckManagerContext.Provider and replace this.render() with this.notify() {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `refactor(tugdeck): single root.render() with context provider, notify() replaces render()`

**References:** [D01] DeckManager is a subscribable store, [D02] Extract IDeckManagerStore interface, Spec S02 (#s02-context-hook), Spec S03 (#s03-store-api), (#assumptions, #strategy)

**Artifacts:**
- Modified file: `tugdeck/src/deck-manager.ts`

**Tasks:**
- [ ] Modify the constructor: the single `root.render()` call wraps the component tree with `<DeckManagerContext.Provider value={this}>` around `DeckCanvas`. The exact nesting order (outermost to innermost):
  ```
  TugThemeProvider
    ErrorBoundary
      ResponderChainProvider
        DeckManagerContext.Provider(value=this)
          DeckCanvas(connection=this.connection)
  ```
  `DeckManagerContext.Provider` sits inside `ResponderChainProvider` so DeckCanvas can access both the responder chain and the store via context.
- [ ] Remove `deckState`, `onCardMoved`, `onCardClosed`, `onCardFocused` from the DeckCanvas props in the `root.render()` call (DeckCanvas will read them from the store). Keep `connection` prop.
- [ ] Replace `this.render()` with `this.notify()` in: `addCard()`, `removeCard()`, `moveCard()`, `focusCard()`, `applyLayout()`. Note: `focusCard()` has an early-return path (card not found or already top-most) that correctly has no `this.render()` call today -- leave that early-return path unchanged (no `notify()` needed there, since no state mutation occurs).
- [ ] Change `refresh()` to call `this.notify()` instead of `this.render()`.
- [ ] Remove the private `render()` method entirely.
- [ ] Import `DeckManagerContext` from `./deck-manager-context`.
- [ ] The constructor still calls `this.render()` for the initial render before replacing it -- rename the initial render to an inline `this.reactRoot.render(...)` call that is not a method, since the `render()` method is being removed. The constructor is the only place `root.render()` executes.
- [ ] Ensure initialization ordering in the constructor: `subscribers`, `stateVersion`, `handleCardMoved/Closed/Focused`, and `deckState` must all be initialized before the `root.render()` call executes. React may synchronously flush the render and call `subscribe`/`getSnapshot` during the first `root.render()`, so the store must be in a valid state before that point.

**Tests:**
- [ ] All existing DeckManager tests still pass (they test state via `getDeckState()`, not rendering).
- [ ] Verify DeckManager has no remaining calls to `this.render()` (grep for `this.render()` in deck-manager.ts returns zero matches).

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] `grep -c 'this\.render()' /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/deck-manager.ts` returns `0`

---

#### Step 5: Migrate DeckCanvas from props to store subscription {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(tugdeck): DeckCanvas reads state from store via useSyncExternalStore`

**References:** [D04] DeckCanvas reads state from store, Spec S04 (#s04-canvas-props), Spec S01 (#s01-store-interface), (#store-interface, #test-strategy)

**Artifacts:**
- Modified file: `tugdeck/src/components/chrome/deck-canvas.tsx`
- Modified file: `tugdeck/src/__tests__/deck-canvas.test.tsx`
- Modified file: `tugdeck/src/__tests__/e2e-responder-chain.test.tsx`

**Tasks:**
- [ ] Import `useSyncExternalStore` from `react`.
- [ ] Import `useDeckManager` from `@/deck-manager-context`.
- [ ] Remove `deckState`, `onCardMoved`, `onCardClosed`, `onCardFocused` from `DeckCanvasProps`. The interface retains only `connection: TugConnection | null`.
- [ ] Inside DeckCanvas function body: call `const store = useDeckManager()` to get the store instance. **Important:** name the variable `store`, not `manager`, because DeckCanvas already uses `manager` for the `ResponderChainManager` obtained via `useRequiredResponderChain()`. Using `store` avoids a name collision and keeps the two roles distinct throughout the component.
- [ ] Call `const deckState = useSyncExternalStore(store.subscribe, store.getSnapshot)` to read current state.
- [ ] Read `store.handleCardMoved`, `store.handleCardClosed`, `store.handleCardFocused` from the store instance instead of props.
- [ ] Remove the resolved-defaults section for `handleCardMoved` and `handleCardClosed` (no longer optional -- they always come from the store).
- [ ] Update the `handleCardFocused` useCallback: the body must call both `store.handleCardFocused(id)` and `setDeselected(false)` -- the deselection-clearing behavior from the current code must be preserved. Update the dependency array to `[store]` (store is a stable context value, so the callback is effectively stable).
- [ ] Since `store.handleCardFocused` is a stable bound method (bound once in the DeckManager constructor), the `onCardFocusedRef` ref can be removed. Replace `onCardFocusedRef.current?.(nextId)` in the `cyclePanel` action handler with a direct `store.handleCardFocused(nextId)` call. The store instance is available in the closure because `useResponder` captures its options at mount time and `store` comes from context (stable singleton).
- [ ] Update `cardsRef` to source from the store-derived `deckState.cards` (this is unchanged in mechanism -- `cardsRef.current = cards` where `cards = deckState.cards`).
- [ ] Update ALL test call sites in `deck-canvas.test.tsx` that render DeckCanvas -- including those that previously passed no `deckState` prop at all (e.g., the responder registration and action handler tests that render `<DeckCanvas connection={null} />`). After migration, every DeckCanvas render requires a `DeckManagerContext.Provider` because `useDeckManager()` throws if context is null. Create a `renderDeckCanvasWithStore` helper that wraps DeckCanvas in both `ResponderChainProvider` and `DeckManagerContext.Provider` with a mock store, and use it for every test.
- [ ] The mock store should be a minimal object literal implementing `IDeckManagerStore` -- not a real DeckManager instance. This avoids the complexity of constructing a real DeckManager (DOM container, mock connection, createRoot) and keeps tests focused on DeckCanvas behavior. The mock provides: a `getSnapshot()` returning the desired `DeckState`, a `subscribe()` returning a no-op unsubscribe, a `getVersion()` returning 0, and stable no-op callbacks for `handleCardMoved`, `handleCardClosed`, `handleCardFocused`. Tests that need specific callback behavior (e.g., the onClose wiring test) override individual callbacks with spies.
- [ ] Wrap DeckCanvas renders in `e2e-responder-chain.test.tsx` with a `DeckManagerContext.Provider` supplying a mock store (same pattern as the deck-canvas.test.tsx helper). The e2e test currently renders `<DeckCanvas connection={null} />` directly -- without the store provider, it will throw because `useDeckManager()` requires a non-null context.

**Tests:**
- [ ] T25 adapted: DeckCanvas renders cards from store-provided deckState (via mock store provider).
- [ ] T26 adapted: DeckCanvas with empty store renders no cards.
- [ ] T27 adapted: DeckCanvas skips unregistered componentIds (via mock store provider).
- [ ] onClose wiring test adapted: the mock store must provide a `handleCardClosed` spy. After clicking the close trigger, assert the spy was called with the card ID.
- [ ] All existing DeckCanvas responder registration and action tests adapted to use store provider.
- [ ] All existing e2e-responder-chain tests adapted to use store provider and pass.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 6: Switch useResponder to useLayoutEffect {#step-6}

**Depends on:** #step-4

**Commit:** `refactor(tugdeck): useResponder uses useLayoutEffect for commit-phase registration`

**References:** [D03] useResponder uses useLayoutEffect for registration, (#assumptions)

**Artifacts:**
- Modified file: `tugdeck/src/components/tugways/use-responder.tsx`

**Tasks:**
- [ ] Change `import { useEffect }` to `import { useLayoutEffect }` in `use-responder.tsx` (remove `useEffect` from the import if it is no longer used).
- [ ] Replace the `useEffect` call for registration with `useLayoutEffect`. The dependency array and callback body remain identical.
- [ ] Update the JSDoc comment to reflect that registration now happens during the commit phase (before paint), not after.
- [ ] Verify: the import line includes `useLayoutEffect` and does not include `useEffect` (unless `useEffect` is used elsewhere in the file, which it is not).

**Tests:**
- [ ] All existing `use-responder.test.tsx` tests pass unchanged (happy-dom flushes `useLayoutEffect` synchronously inside `act()`).
- [ ] All existing `deck-canvas.test.tsx` responder tests pass unchanged.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 7: End-to-End Verification {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] DeckManager is a subscribable store, [D03] useResponder uses useLayoutEffect, [D04] DeckCanvas reads state from store, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run the full test suite and confirm all tests pass.
- [ ] Verify DeckManager has zero calls to a private `render()` method (`grep` for `private render` in deck-manager.ts returns zero matches).
- [ ] Verify DeckManager has exactly one `root.render()` call (in the constructor).
- [ ] Verify DeckCanvas does not import or use `deckState` as a prop.
- [ ] Verify `use-responder.tsx` uses `useLayoutEffect`, not `useEffect`, for registration.
- [ ] Verify TypeScript compilation succeeds with no errors.
- [ ] Manual verification (if running the app): Ctrl+\` cycling works end-to-end, card focus visuals update correctly, add/remove cards works via Mac menu, layout persistence works (save/load), drag/resize works, close button works.

**Tests:**
- [ ] Full test suite passes: `bun test` exits 0 with no failures or warnings.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `grep -c 'private render' /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/deck-manager.ts` returns `0`
- [ ] `grep -c 'useLayoutEffect' /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/components/tugways/use-responder.tsx` returns a value greater than `0`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** DeckManager is a subscribable store. One `root.render()` at construction time. All state changes flow through `useSyncExternalStore`. Responder registration uses `useLayoutEffect`. The async render gap is eliminated.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] DeckManager implements `IDeckManagerStore` with `subscribe`, `getSnapshot`, `getVersion`, and `notify` (run `grep` for `implements IDeckManagerStore` in deck-manager.ts).
- [ ] DeckManager has zero calls to a private `render()` method after construction (`grep` returns 0).
- [ ] DeckManager constructor has exactly one `root.render()` call wrapping the full provider tree.
- [ ] DeckCanvas reads `deckState` via `useSyncExternalStore` from context, not props (`deckState` not in `DeckCanvasProps`).
- [ ] `useResponder` uses `useLayoutEffect` for registration.
- [ ] All existing tests pass (`bun test` exits 0).
- [ ] TypeScript compilation succeeds (`bunx tsc --noEmit` exits 0).

**Acceptance tests:**
- [ ] DeckManager store unit tests: subscribe/unsubscribe, getSnapshot reflects mutations, getVersion increments, subscriber callbacks fire.
- [ ] DeckCanvas integration tests: renders cards from store, skips unregistered componentIds, onClose wiring works via store.
- [ ] useResponder tests: all existing tests pass with useLayoutEffect.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5b: Card Tabs -- tab bar, tab switching, multi-tab cards (depends on this phase).
- [ ] Phase 5c: Card Snapping -- modifier-gated snap, Option+drag (depends on this phase).
- [ ] Phase 5d: Default Button -- Enter key routing, default button registration (depends on this phase).
- [ ] Phase 6: Feed Abstraction -- feed hooks, data flow (depends on this phase).

| Checkpoint | Verification |
|------------|--------------|
| Store API works | DeckManager store unit tests pass |
| DeckCanvas reads from store | DeckCanvas integration tests pass |
| Responder timing fixed | useResponder tests pass with useLayoutEffect |
| No regressions | Full `bun test` suite exits 0 |
| Type safety | `bunx tsc --noEmit` exits 0 |
