<!-- tugplan-skeleton v2 -->

## Tugways Phase 5d2: Control Action Foundation {#phase-5d2-control-action}

**Purpose:** Extend the responder chain with typed `ActionEvent` payloads, continuous action phases, explicit-target dispatch, never-hide button semantics, and a last-resort responder at deck-canvas. Migrate all existing dispatch call sites from bare strings to `ActionEvent` with zero legacy support.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5d2-control-action |
| Last updated | 2026-03-05 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The responder chain currently dispatches actions as bare strings -- `dispatch('copy')`. This works for discrete commands but cannot express the richer interactions that continuous controls (sliders, color pickers) and inspector panels require. A slider scrub is a begin/change/change/commit sequence with a typed value at each step. Inspector panels need to target a specific card's responder by ID rather than walking the chain. The current dispatch signature -- a bare string -- is insufficient for these use cases.

Additionally, TugButton currently hides itself (returns null) when `canHandle` returns false for its action. This is incorrect UI behavior -- buttons should always be visible so users can see what actions exist. Unhandled actions should render the button as disabled, not hidden.

Phase 5a2 established DeckManager as a subscribable store with `useLayoutEffect`-based registration and single `root.render()`. The responder chain infrastructure is stable and ready for extension.

#### Strategy {#strategy}

- Define the `ActionEvent` interface and `ActionPhase` type in `responder-chain.ts` as the single dispatch currency -- no union with string, no backward compatibility overloads.
- Change `dispatch()` to accept only `ActionEvent`, change all handler signatures from `() => void` to `(event: ActionEvent) => void`.
- Migrate every existing dispatch call site and every action handler registration in a single step to ensure the codebase compiles at all times within the step boundary.
- Add `dispatchTo(targetId, event)` for explicit-target dispatch that bypasses chain walk and throws on unregistered target.
- Add `nodeCanHandle(nodeId, action)` as a public method for querying a specific node's capability without chain walk.
- Change TugButton to never hide -- buttons are always visible, disabled when unhandled.
- Add `target` prop to `TugButton` for explicit-target mode alongside existing `action` prop. When `target` is set, use `nodeCanHandle(target, action)` for the enabled/disabled check.
- Add a last-resort responder at deck-canvas with `canHandle: () => true` so chain-action buttons are almost never disabled in practice.
- Add an `ActionEvent` demo section within the existing Chain Actions tab in the gallery card.
- Verify all existing keyboard shortcuts, chain-action buttons, and test suites pass after migration.

#### Success Criteria (Measurable) {#success-criteria}

- `dispatch()` accepts only `ActionEvent` -- passing a bare string is a TypeScript compile error (verified by `bun run build`)
- All existing action handlers receive `ActionEvent` parameter (verified by grep: zero `() => void` action handler signatures remain)
- TugButton never returns null -- chain-action buttons with unhandled actions render as `aria-disabled` (verified by updated chain-action-button tests)
- `nodeCanHandle(nodeId, action)` returns correct results for registered and unregistered nodes (verified by unit test)
- `dispatchTo(targetId, event)` throws `Error` when target is not registered (verified by unit test)
- TugButton with `target` prop uses `nodeCanHandle` for enabled check and `dispatchTo` for click dispatch (verified by unit test)
- DeckCanvas registers `canHandle: () => true` as last-resort responder (verified by unit test)
- Gallery demo shows ActionEvent payload display in Chain Actions tab (verified by visual inspection)
- `bun run build` succeeds with zero type errors
- `bun vitest run` passes all existing and new tests

#### Scope {#scope}

1. `ActionEvent` interface and `ActionPhase` type definition
2. `dispatch(event: ActionEvent)` -- replaces `dispatch(action: string)`
3. `dispatchTo(targetId: string, event: ActionEvent)` -- new explicit-target dispatch
4. `nodeCanHandle(nodeId: string, action: string): boolean` -- new public method for per-node capability query
5. `canHandle` and `validateAction` signatures unchanged (queries remain string-based)
6. `ResponderNode.actions` map value type changed from `() => void` to `(event: ActionEvent) => void`
7. All existing dispatch call sites migrated to produce `ActionEvent`
8. All existing action handler registrations migrated to accept `ActionEvent`
9. TugButton never-hide behavior: disable instead of hide when `canHandle` returns false
10. TugButton `target` prop for explicit-target dispatch with `nodeCanHandle`-based enabled check
11. DeckCanvas last-resort responder with `canHandle: () => true`
12. Gallery demo section for ActionEvent in Chain Actions tab

#### Non-goals (Explicitly out of scope) {#non-goals}

- Continuous control components (TugSlider, TugColorPicker, etc.) -- those are Phase 8b
- Mutation transactions (begin/commit/cancel lifecycle) -- that is Phase 5d3
- Observable property store (PropertyStore, usePropertyStore) -- that is Phase 5d4
- Inspector panels -- that is Phase 8e
- Updating `design-system-concepts.md` -- user explicitly declined

#### Dependencies / Prerequisites {#dependencies}

- Phase 5a2 complete: DeckManager is a subscribable store, `useResponder` uses `useLayoutEffect`, `root.render()` called only once
- Phase 3 complete: responder chain exists with `dispatch(string)`, `canHandle`, `validateAction`, `useResponder` hook

#### Constraints {#constraints}

- Rules of Tugways must be followed: no `root.render()` after initial mount, `useSyncExternalStore` for external state, `useLayoutEffect` for registrations, appearance changes through CSS/DOM
- Clean break: zero backward compatibility for old string-based dispatch. No union types.
- `bun` only for JS/TS package management (never npm)

#### Assumptions {#assumptions}

- Phase 5a2 is complete and stable
- The three core files (responder-chain.ts, tug-button.tsx, gallery-card.tsx) plus action-dispatch.ts, responder-chain-provider.tsx, use-responder.tsx, deck-canvas.tsx, and tugcard.tsx are the files that need modification
- All test files with dispatch calls need migration
- The `GALLERY_DEFAULT_TABS` array remains at six entries -- the ActionEvent demo is added within the existing Chain Actions tab content

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan skeleton. All headings that are referenced use explicit `{#anchor-name}` anchors. Decisions use `[DNN]` labels, specs use `Spec SNN` labels.

---

### Design Decisions {#design-decisions}

#### [D01] ActionEvent is the sole dispatch currency (DECIDED) {#d01-action-event-sole-currency}

**Decision:** `dispatch()` accepts only `ActionEvent` objects. There is no string overload, no union type, no backward compatibility shim. All call sites produce `ActionEvent`, all handlers receive `ActionEvent`.

**Rationale:**
- User explicitly chose CLEAN BREAK over backward-compatible union approach
- Union types create ambiguity and make it unclear which form call sites should use
- A single type eliminates an entire class of runtime checks and documentation burden

**Implications:**
- Every existing `dispatch("actionName")` call becomes `dispatch({ action: "actionName", phase: "discrete" })`
- Every existing `actions: { name: () => void }` handler becomes `actions: { name: (event: ActionEvent) => void }`
- This is a large but mechanical migration -- all changes within a single step boundary

#### [D02] Handler signature is (event: ActionEvent) => void (DECIDED) {#d02-handler-signature}

**Decision:** `ResponderNode.actions` map type changes from `Record<string, () => void>` to `Record<string, (event: ActionEvent) => void>`. All handlers receive the full `ActionEvent` even for discrete actions.

**Rationale:**
- Handlers that only care about discrete actions can ignore the event parameter
- Handlers that need payload/phase/sender have it available without type narrowing
- Uniform signature simplifies the dispatch implementation

**Implications:**
- `UseResponderOptions.actions` type changes to `Record<string, (event: ActionEvent) => void>`
- Existing handlers that take no arguments will have `event` added as an unused parameter (or use `_event` convention)
- The `useResponder` hook interface changes correspondingly

#### [D03] dispatchTo throws on unregistered target (DECIDED) {#d03-dispatch-to-throws}

**Decision:** `dispatchTo(targetId, event)` throws a descriptive `Error` when the target ID is not found in the registered nodes map. It does not return false or silently fail.

**Rationale:**
- Explicit-target dispatch is a programmer assertion: "I know this target exists." A missing target is a programming error, not a runtime condition to handle gracefully.
- Throwing makes bugs immediately visible during development
- Nil-target `dispatch()` already returns boolean (false = unhandled), so the two modes have distinct error semantics

**Implications:**
- Callers must ensure the target is registered before calling `dispatchTo`
- Test assertions use `expect(() => ...).toThrow()`

#### [D04] TugButton target prop requires action prop (DECIDED) {#d04-target-requires-action}

**Decision:** The `target` prop on TugButton is only meaningful when `action` is also set. When both `target` and `action` are set, TugButton uses `dispatchTo(target, event)` instead of nil-target `dispatch(event)`, and uses `nodeCanHandle(target, action)` for the enabled/disabled check instead of the chain-walk `canHandle(action)`. A dev-mode console warning fires if `target` is set without `action`.

**Rationale:**
- `target` without `action` is meaningless -- there is nothing to dispatch
- Using `nodeCanHandle` for the target-mode enabled check ensures the button's enabled state reflects the actual target's capability, not the chain's
- The existing nil-target behavior (action without target) is preserved exactly

**Implications:**
- TugButton props interface gains `target?: string`
- Click handler branches: if `target` is set, call `manager.dispatchTo(target, event)`, otherwise call `manager.dispatch(event)`
- Enabled check branches: if `target` is set, call `manager.nodeCanHandle(target, action)`, otherwise call `manager.canHandle(action)`
- Known limitation: target-mode `validateAction` currently uses chain-walk semantics (not per-node). With [D08] last-resort responder, chain-walk `validateAction` always returns true (DeckCanvas has no `validateAction` callback, so it defaults to true). This means target-mode buttons cannot be independently disabled by their target's `validateAction`. A per-node `nodeValidateAction` method may be needed in a future phase (likely Phase 8e inspector panels) when target nodes require independent enabled/disabled control. No code change needed now.

#### [D05] Validation queries remain string-based (DECIDED) {#d05-validation-string-based}

**Decision:** `canHandle(action: string)` and `validateAction(action: string)` continue to accept bare action name strings. They are query methods, not dispatch methods -- they ask "can you handle this action name?" without needing payload or phase.

**Rationale:**
- Validation queries are about capability, not about a specific event instance
- TugButton uses these to determine enabled state based on action name alone
- Changing these to accept `ActionEvent` would require constructing throwaway event objects for queries

**Implications:**
- No change to `canHandle` or `validateAction` signatures
- The `ResponderNode.canHandle` and `validateAction` callback signatures remain `(action: string) => boolean`

#### [D06] TugButton never hides -- disable instead of hide (DECIDED) {#d06-never-hide}

**Decision:** TugButton must NEVER return null based on chain-action state. When `canHandle` returns false (nil-target mode) or `nodeCanHandle` returns false (target mode), the button renders as `aria-disabled` instead of being hidden. This is standard UI behavior -- users see the button exists but it is inert.

**Rationale:**
- Hiding buttons confuses users -- they cannot discover what actions are available
- Disabled buttons communicate "this action exists but is not currently available"
- The previous hide-when-unhandled behavior was a Phase 3 design choice that proved incorrect

**Implications:**
- Remove the `if (chainActive && !chainCanHandle) { return null; }` branch from TugButton
- Chain-action buttons with unhandled actions render as `aria-disabled="true"` (same visual treatment as `validateAction` returning false)
- Existing `chain-action-button.test.tsx` tests that assert "is hidden (returns null) when canHandle returns false" must be inverted to assert "is visible and aria-disabled"

#### [D07] nodeCanHandle for per-node capability query (DECIDED) {#d07-node-can-handle}

**Decision:** `nodeCanHandle(nodeId: string, action: string): boolean` is a new public method on `ResponderChainManager`. It checks whether a specific node can handle a given action by looking up the node in the nodes map and checking its actions record (and optional `canHandle` callback). Returns false if the node is not registered.

**Rationale:**
- TugButton with `target` prop needs to check whether the explicit target can handle the action, not whether the chain can
- Chain-walk `canHandle` is wrong for target mode because it checks from first responder upward, which may find a different handler
- A per-node query enables accurate enabled state for explicit-target buttons

**Implications:**
- New public method on `ResponderChainManager`
- TugButton target mode uses `nodeCanHandle(target, action)` instead of `canHandle(action)` for enabled/disabled state

#### [D08] DeckCanvas last-resort responder (DECIDED) {#d08-last-resort-responder}

**Decision:** DeckCanvas's existing `useResponder` registration adds `canHandle: () => true` so it handles ALL actions as a last-resort catch-all. The catch-all handler logs unhandled actions to console. This means chain-action buttons are almost never disabled in practice because the chain walk always reaches deck-canvas which always claims to handle every action.

**Rationale:**
- Without a last-resort responder, buttons for actions only handled by child responders (not ancestors in the chain) would be permanently disabled
- Logging unhandled actions surfaces potential wiring bugs during development
- This mirrors the "application object" pattern in AppKit/UIKit where the app delegate is the last responder

**Implications:**
- DeckCanvas `useResponder` registration gains `canHandle: () => true`
- The catch-all does not need entries in the `actions` map for every possible action -- `canHandle` is the advisory override that makes the chain walk succeed, and the actual dispatch to DeckCanvas for an unhandled action is a no-op (dispatch checks the actions map, not canHandle)
- Note: `canHandle: () => true` affects validation queries only. Dispatch still checks the actions map. So dispatch for an unregistered action returns false and continues up the chain. But since DeckCanvas is the root node (parentId null), the walk ends and dispatch returns false. This is correct -- the last-resort makes the button appear enabled, but clicking it for a truly unhandled action is a safe no-op.

---

### Specification {#specification}

#### ActionEvent Interface {#action-event-interface}

**Spec S01: ActionEvent type definition** {#s01-action-event-type}

```typescript
/** Five-phase action lifecycle */
export type ActionPhase = 'discrete' | 'begin' | 'change' | 'commit' | 'cancel';

/** Typed action event -- the sole dispatch currency */
export interface ActionEvent {
  action: string;              // semantic name from action vocabulary
  sender?: unknown;            // the control that initiated (ref or instance)
  value?: unknown;             // typed payload (color, number, point, etc.)
  phase: ActionPhase;          // lifecycle phase
}
```

#### Updated dispatch Signature {#dispatch-signature}

**Spec S02: dispatch method** {#s02-dispatch-method}

```typescript
dispatch(event: ActionEvent): boolean
```

Walks from the first responder upward via `parentId`. For each node, checks `event.action` in the actions map. If found, calls the handler with the full `ActionEvent` and returns `true`. Returns `false` if root reached with no match.

#### dispatchTo Signature {#dispatch-to-signature}

**Spec S03: dispatchTo method** {#s03-dispatch-to-method}

```typescript
dispatchTo(targetId: string, event: ActionEvent): boolean
```

Looks up `targetId` in the nodes map. If not found, throws `Error` with message `dispatchTo: target "${targetId}" is not registered`. If found, checks `event.action` in the target node's actions map. If the action key exists, calls the handler with the `ActionEvent` and returns `true`. Returns `false` if the target does not handle the action.

#### nodeCanHandle Signature {#node-can-handle-signature}

**Spec S07: nodeCanHandle method** {#s07-node-can-handle}

```typescript
nodeCanHandle(nodeId: string, action: string): boolean
```

Looks up `nodeId` in the nodes map. If not found, returns `false`. If found, checks: (1) `action in node.actions` -- if true, returns true. (2) `node.canHandle?.(action)` -- if it returns true, returns true. Otherwise returns false. This is the per-node equivalent of the chain-walk `canHandle` method.

#### Updated ResponderNode Interface {#updated-responder-node}

**Spec S04: ResponderNode.actions type** {#s04-responder-node-actions}

```typescript
export interface ResponderNode {
  id: string;
  parentId: string | null;
  actions: Record<string, (event: ActionEvent) => void>;
  canHandle?: (action: string) => boolean;
  validateAction?: (action: string) => boolean;
}
```

#### Updated UseResponderOptions {#updated-use-responder-options}

**Spec S05: UseResponderOptions.actions type** {#s05-use-responder-options}

```typescript
export interface UseResponderOptions {
  id: string;
  actions?: Record<string, (event: ActionEvent) => void>;
  canHandle?: (action: string) => boolean;
  validateAction?: (action: string) => boolean;
}
```

#### TugButton target Prop {#tugbutton-target-prop}

**Spec S06: TugButton target prop** {#s06-tugbutton-target}

```typescript
export interface TugButtonProps {
  // ... existing props ...
  /**
   * Explicit-target dispatch: responder node ID to dispatch to directly.
   * Only meaningful when `action` is also set. When both are set, TugButton
   * uses dispatchTo(target, event) instead of nil-target dispatch(event),
   * and nodeCanHandle(target, action) instead of chain-walk canHandle(action)
   * for the enabled/disabled check.
   */
  target?: string;
}
```

#### TugButton Never-Hide Behavior {#tugbutton-never-hide}

**Spec S08: TugButton never-hide semantics** {#s08-never-hide}

In chain-action mode, TugButton's rendering behavior is:

| Condition | Old Behavior | New Behavior |
|-----------|-------------|-------------|
| `canHandle(action)` returns false (nil-target) | Return null (hidden) | Render with `aria-disabled="true"` |
| `nodeCanHandle(target, action)` returns false (target mode) | N/A (new) | Render with `aria-disabled="true"` |
| `canHandle(action)` returns true, `validateAction` returns false | `aria-disabled="true"` | `aria-disabled="true"` (unchanged) |
| `canHandle(action)` returns true, `validateAction` returns true | Enabled | Enabled (unchanged) |
| Outside provider (no manager) | Renders (inert) | Renders (inert, unchanged) |

The `isChainDisabled` variable is computed as: `chainActive && (!chainCanHandle || !chainValidated)` where `chainCanHandle` is either `canHandle(action)` (nil-target) or `nodeCanHandle(target, action)` (target mode).

#### Migration Call Site Inventory {#migration-inventory}

**Table T01: Production dispatch call sites** {#t01-production-dispatch-sites}

| File | Current Call | Migration |
|------|------------|-----------|
| `responder-chain.ts` | `dispatch(action: string)` | `dispatch(event: ActionEvent)` -- signature change |
| `responder-chain-provider.tsx` | `manager.dispatch(binding.action)` | `manager.dispatch({ action: binding.action, phase: "discrete" })` |
| `tug-button.tsx` | `manager.dispatch(action)` | `manager.dispatch({ action, phase: "discrete" })` (or `manager.dispatchTo(target, ...)` when target is set) |
| `action-dispatch.ts` | `responderChainManagerRef.dispatch("showComponentGallery")` | `responderChainManagerRef.dispatch({ action: "showComponentGallery", phase: "discrete" })` |
| `action-dispatch.ts` | `responderChainManagerRef.dispatch("addTab")` | `responderChainManagerRef.dispatch({ action: "addTab", phase: "discrete" })` |

**Table T02: Production handler registration sites** {#t02-production-handler-sites}

| File | Actions Map | Migration |
|------|------------|-----------|
| `tugcard.tsx` | `close`, `selectAll`, `previousTab`, `nextTab`, `minimize`, `toggleMenu`, `find` | Each handler gains `(_event: ActionEvent) => void` signature |
| `deck-canvas.tsx` | `cycleCard`, `showComponentGallery`, `addTab` | Each handler gains `(_event: ActionEvent) => void` signature; add `canHandle: () => true` for last-resort |
| `use-responder.tsx` | `UseResponderOptions.actions` type | Type changes to `Record<string, (event: ActionEvent) => void>` |

**Table T03: Test dispatch call sites** {#t03-test-dispatch-sites}

| Test File | Approximate Call Count | Migration |
|-----------|----------------------|-----------|
| `responder-chain.test.ts` | ~12 | Each `mgr.dispatch("action")` becomes `mgr.dispatch({ action: "action", phase: "discrete" })` |
| `chain-action-button.test.tsx` | ~3 | Same dispatch pattern + invert hide tests to assert visible+disabled |
| `tugcard.test.tsx` | ~5 | Same pattern |
| `deck-canvas.test.tsx` | ~12 | Same pattern |
| `use-responder.test.tsx` | ~2 | Same pattern |
| `e2e-responder-chain.test.tsx` | ~3 | Same pattern |
| `action-dispatch.test.ts` | ~1 | Mock manager's `dispatch` signature changes from `(_action: string) => false` to `(_event: ActionEvent) => false`; assertions change from `toHaveBeenCalledWith("showComponentGallery")` to `toHaveBeenCalledWith({ action: "showComponentGallery", phase: "discrete" })` |
| `component-gallery-action.test.ts` | ~4 | Same as `action-dispatch.test.ts`: mock manager's `dispatch` mock signature changes from `(_action: string) => false` to `(_event: ActionEvent) => false`; assertion `toHaveBeenCalledWith("showComponentGallery")` becomes `toHaveBeenCalledWith({ action: "showComponentGallery", phase: "discrete" })` |
| `key-pipeline.test.tsx` | 0 dispatch calls, 2 handler registrations | No direct `dispatch(string)` calls (spy pattern only, `not.toHaveBeenCalled()` assertions). However, has 2 direct `manager.register()` calls with `() => void` handler signatures (e.g., `actions: { cycleCard: () => { ... } }`). Each handler signature changes to `(_event: ActionEvent) => void`. Import `ActionEvent` type. |
| `selection-model.test.tsx` | ~4 | Same pattern |
| `component-gallery.test.tsx` | ~4 | `FakeDeckCanvas` and chain-action test wrapper have `useResponder` registrations with `() => void` handler signatures (e.g., `cycleCard: () => {}`, `showComponentGallery: () => {}`). Each handler signature changes to `(_event: ActionEvent) => void`. Import `ActionEvent` type. |

**Table T04: Test behavior inversions (hide to disable)** {#t04-test-behavior-inversions}

| Test File | Current Assertion | New Assertion |
|-----------|------------------|---------------|
| `chain-action-button.test.tsx` | `"is hidden (returns null) when canHandle returns false"` -- asserts `container.querySelector("button")` is null | Invert: assert button is NOT null, assert `aria-disabled="true"` |
| `chain-action-button.test.tsx` | Describe group title "visibility" | Rename to "enabled/disabled state (never-hide)" or merge into existing enabled/disabled group |
| `component-gallery.test.tsx` | `"'nonexistentAction' button is hidden (TugButton returns null for unhandled action)"` -- asserts button is undefined | Remove this test entirely (the `nonexistentAction` button is removed from gallery-card.tsx -- see OF3 below) |

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Large migration touches many files simultaneously | med | low | All changes are mechanical (string to object literal); TypeScript compiler catches missed sites | Any dispatch call produces a type error after migration |
| Test suite breakage from handler signature changes | med | med | Migrate tests in the same step as production code; run full suite after each step | Any test failure after migration step |
| Last-resort canHandle masks legitimate button wiring bugs | low | low | Console logging in catch-all handler surfaces unhandled dispatches during development | Buttons appear enabled but do nothing on click |

**Risk R01: Missed dispatch call site** {#r01-missed-call-site}

- **Risk:** A dispatch call site is missed during migration, causing a runtime error or type error.
- **Mitigation:** Use `bun run build` (TypeScript strict mode) to catch all type mismatches. Grep for `\.dispatch\(` and verify every hit is migrated.
- **Residual risk:** Dynamic dispatch calls constructed at runtime (none known) would not be caught by static analysis.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes are modifications to existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ActionPhase` | type | `responder-chain.ts` | `'discrete' \| 'begin' \| 'change' \| 'commit' \| 'cancel'` |
| `ActionEvent` | interface | `responder-chain.ts` | `{ action, sender?, value?, phase }` |
| `dispatch(event: ActionEvent)` | method (modify) | `ResponderChainManager` | Replaces `dispatch(action: string)` |
| `dispatchTo(targetId, event)` | method (new) | `ResponderChainManager` | Explicit-target dispatch, throws on missing target |
| `nodeCanHandle(nodeId, action)` | method (new) | `ResponderChainManager` | Per-node capability query |
| `ResponderNode.actions` | property (modify) | `responder-chain.ts` | Value type from `() => void` to `(event: ActionEvent) => void` |
| `UseResponderOptions.actions` | property (modify) | `use-responder.tsx` | Same type change |
| `TugButtonProps.target` | property (new) | `tug-button.tsx` | Optional string for explicit-target dispatch |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test ActionEvent dispatch, dispatchTo, nodeCanHandle, and error cases in isolation | `responder-chain.test.ts` |
| **Integration** | Test TugButton never-hide + target prop end-to-end with ResponderChainProvider | `chain-action-button.test.tsx` |
| **Regression** | Verify all existing tests pass after migration (with inversions for hide-to-disable) | All existing test files |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.**

#### Step 1: Define ActionEvent, Migrate dispatch, and Never-Hide TugButton {#step-1}

**Commit:** `feat(tugways): ActionEvent type, dispatch migration, never-hide buttons (Phase 5d2)`

**References:** [D01] ActionEvent is the sole dispatch currency, [D02] Handler signature, [D05] Validation queries remain string-based, [D06] TugButton never hides, Spec S01, Spec S02, Spec S04, Spec S05, Spec S08, Table T01, Table T02, Table T03, Table T04, (#action-event-interface, #dispatch-signature, #updated-responder-node, #updated-use-responder-options, #tugbutton-never-hide, #migration-inventory)

**Artifacts:**
- Modified `responder-chain.ts`: `ActionPhase` type, `ActionEvent` interface, `dispatch(event: ActionEvent)` signature, `ResponderNode.actions` type change
- Modified `use-responder.tsx`: `UseResponderOptions.actions` type change
- Modified `responder-chain-provider.tsx`: keybinding dispatch produces `ActionEvent`
- Modified `tug-button.tsx`: click handler produces `ActionEvent`, remove null-return hide branch, unhandled actions render as aria-disabled
- Modified `action-dispatch.ts`: responder chain dispatch calls produce `ActionEvent`
- Modified `tugcard.tsx`: all action handlers accept `ActionEvent` parameter
- Modified `deck-canvas.tsx`: all action handlers accept `ActionEvent` parameter
- Modified all test files in Table T03: dispatch calls produce `ActionEvent`, handler signatures updated
- Modified `gallery-card.tsx`: remove `nonexistentAction` button (obsolete after never-hide)
- Modified `chain-action-button.test.tsx`: hide tests inverted to assert visible+disabled (Table T04)
- Modified `component-gallery.test.tsx`: remove `nonexistentAction` hide test (Table T04)

**Tasks:**
- [ ] Add `ActionPhase` type and `ActionEvent` interface export to `responder-chain.ts`
- [ ] Change `ResponderNode.actions` type from `Record<string, () => void>` to `Record<string, (event: ActionEvent) => void>`
- [ ] Change `dispatch(action: string): boolean` to `dispatch(event: ActionEvent): boolean` -- internal implementation changes from `action in node.actions` to `event.action in node.actions`, and handler call from `node.actions[action]()` to `node.actions[event.action](event)`
- [ ] Change `UseResponderOptions.actions` type in `use-responder.tsx`
- [ ] **Never-hide TugButton:** Remove the `if (chainActive && !chainCanHandle) { return null; }` branch from `tug-button.tsx`. Instead, compute `isChainDisabled` as `chainActive && (!chainCanHandle || !chainValidated)`. When `isChainDisabled` is true, the button renders with `aria-disabled="true"` (same treatment as the existing validateAction-false path). The button is always visible.
- [ ] Migrate `responder-chain-provider.tsx` capture listener: `manager.dispatch(binding.action)` becomes `manager.dispatch({ action: binding.action, phase: "discrete" })`
- [ ] Migrate `tug-button.tsx` click handler: `manager.dispatch(action)` becomes `manager.dispatch({ action, phase: "discrete" })`
- [ ] Migrate `action-dispatch.ts`: both `responderChainManagerRef.dispatch(...)` calls become `ActionEvent` form
- [ ] Migrate `tugcard.tsx` action handlers: add `_event: ActionEvent` parameter to `close`, `selectAll`, `previousTab`, `nextTab`, `minimize`, `toggleMenu`, `find` handlers. Import `ActionEvent` type.
- [ ] Migrate `deck-canvas.tsx` action handlers: add `_event: ActionEvent` parameter to `cycleCard`, `showComponentGallery`, `addTab` handlers. Import `ActionEvent` type.
- [ ] Migrate all test files (Table T03): change every `mgr.dispatch("x")` / `manager.dispatch("x")` to `mgr.dispatch({ action: "x", phase: "discrete" })`, and update any mock handler signatures
- [ ] Migrate `action-dispatch.test.ts` and `component-gallery-action.test.ts` mock managers: change `dispatch: mock((_action: string) => false)` to `dispatch: mock((_event: ActionEvent) => false)`, and update assertions from `toHaveBeenCalledWith("showComponentGallery")` to `toHaveBeenCalledWith({ action: "showComponentGallery", phase: "discrete" })`
- [ ] Migrate `action-dispatch.test.ts` add-tab tests specifically: the inline stub managers record dispatch calls into a `dispatched: string[]` array via `dispatch(action: string)`. Change the array type to `dispatched: ActionEvent[]`, change the stub signature to `dispatch(event: ActionEvent)`, change `dispatched.push(action)` to `dispatched.push(event)`, and update assertions from `dispatched[0] === "addTab"` to `dispatched[0].action === "addTab"` (or use `toEqual({ action: "addTab", phase: "discrete" })`). Also update the last-registration-wins test which uses the same pattern.
- [ ] Migrate `component-gallery.test.tsx` handler signatures: `FakeDeckCanvas` and chain-action test wrapper `useResponder` registrations have `() => void` handlers (e.g., `cycleCard: () => {}`) -- change each to `(_event: ActionEvent) => void`. Import `ActionEvent` type.
- [ ] **Invert hide tests (Table T04):** In `chain-action-button.test.tsx`, change the test "is hidden (returns null) when canHandle returns false" to assert the button IS rendered (not null) AND has `aria-disabled="true"`. Update the test title to reflect the new behavior (e.g., "is visible and aria-disabled when canHandle returns false"). Also update `makeManagerWithAction` helper: the dispatched array recording must use the new `ActionEvent` type, and handler signatures must accept `ActionEvent`.
- [ ] **Remove nonexistentAction button:** In `gallery-card.tsx`, remove the `<TugButton action="nonexistentAction">Hidden (nonexistentAction)</TugButton>` from `GalleryChainActionsContent`. Its pedagogical purpose (demonstrating hide-when-unhandled) is obsolete after [D06] never-hide, and with [D08] last-resort it would be misleadingly enabled. In `component-gallery.test.tsx`, remove the test `"'nonexistentAction' button is hidden"` (Table T04).
- [ ] Migrate `key-pipeline.test.tsx` handler registrations: 2 direct `manager.register()` calls have `() => void` handler signatures (e.g., `actions: { cycleCard: () => { ... } }`). Change each to `(_event: ActionEvent) => void`. Import `ActionEvent` type. Spy-based dispatch assertions use `not.toHaveBeenCalled()` (call count only) and need no changes.
- [ ] Verify `canHandle(action: string)` and `validateAction(action: string)` signatures are unchanged

**Tests:**
- [ ] All existing tests in `responder-chain.test.ts` pass with `ActionEvent` dispatch
- [ ] All existing tests in `chain-action-button.test.tsx` pass (with inverted hide-to-disable assertions)
- [ ] All existing tests in `tugcard.test.tsx` pass
- [ ] All existing tests in `deck-canvas.test.tsx` pass
- [ ] All existing tests in `use-responder.test.tsx` pass
- [ ] All existing tests in `e2e-responder-chain.test.tsx` pass
- [ ] All existing tests in `action-dispatch.test.ts` pass
- [ ] All existing tests in `component-gallery-action.test.ts` pass
- [ ] All existing tests in `key-pipeline.test.tsx` pass
- [ ] All existing tests in `selection-model.test.tsx` pass
- [ ] All existing tests in `component-gallery.test.tsx` pass

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` -- zero type errors
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun vitest run` -- all tests pass

---

#### Step 2: Add dispatchTo and nodeCanHandle Methods {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugways): dispatchTo and nodeCanHandle methods (Phase 5d2)`

**References:** [D03] dispatchTo throws on unregistered target, [D07] nodeCanHandle for per-node capability query, Spec S03, Spec S07, (#dispatch-to-signature, #node-can-handle-signature, #symbol-inventory)

**Artifacts:**
- Modified `responder-chain.ts`: new `dispatchTo` and `nodeCanHandle` methods on `ResponderChainManager`
- Modified `responder-chain.test.ts`: new unit tests for both methods

**Tasks:**
- [ ] Add `dispatchTo(targetId: string, event: ActionEvent): boolean` to `ResponderChainManager`. Implementation: look up `targetId` in `this.nodes`. If not found, throw `new Error('dispatchTo: target "${targetId}" is not registered')`. If found, check `event.action in node.actions`. If found, call handler with event and return true. Otherwise return false.
- [ ] Add `nodeCanHandle(nodeId: string, action: string): boolean` to `ResponderChainManager`. Implementation: look up `nodeId` in `this.nodes`. If not found, return false. If found, check `action in node.actions` -- if true, return true. Check `node.canHandle?.(action)` -- if true, return true. Otherwise return false.
- [ ] Add unit tests for both methods

**Tests:**
- [ ] Test: `dispatchTo` delivers action to registered target and returns true
- [ ] Test: `dispatchTo` returns false when target exists but does not handle the action
- [ ] Test: `dispatchTo` throws Error with descriptive message when target is not registered
- [ ] Test: `dispatchTo` bypasses chain walk (action goes directly to target, not first responder)
- [ ] Test: `nodeCanHandle` returns true when node has action in actions map
- [ ] Test: `nodeCanHandle` returns true when node's canHandle callback returns true
- [ ] Test: `nodeCanHandle` returns false when node does not handle action
- [ ] Test: `nodeCanHandle` returns false when node is not registered

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` -- zero type errors
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun vitest run` -- all tests pass

---

#### Step 3: Add TugButton target Prop and DeckCanvas Last-Resort Responder {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugways): TugButton target prop and deck-canvas last-resort responder (Phase 5d2)`

**References:** [D04] TugButton target prop requires action prop, [D07] nodeCanHandle for per-node capability query, [D08] DeckCanvas last-resort responder, Spec S06, Spec S07, (#tugbutton-target-prop, #node-can-handle-signature, #symbol-inventory)

**Artifacts:**
- Modified `tug-button.tsx`: new `target?: string` prop, click handler branches on target presence, enabled check uses `nodeCanHandle` in target mode
- Modified `deck-canvas.tsx`: add `canHandle: () => true` to existing `useResponder` registration
- Modified `chain-action-button.test.tsx`: new tests for target prop
- Modified `responder-chain.test.ts` or `deck-canvas.test.tsx`: test for last-resort canHandle

**Tasks:**
- [ ] Add `target?: string` to `TugButtonProps` interface with JSDoc
- [ ] Add `target` to TugButton destructured props
- [ ] Add dev-mode warning when `target` is set without `action` (same pattern as existing `action`+`onClick` warning)
- [ ] Modify enabled check: when `target` is set and `chainActive`, compute `chainCanHandle` as `manager.nodeCanHandle(target, action)` instead of `manager.canHandle(action)`. This ensures the button's enabled state reflects the target node's capability, not the chain's.
- [ ] Modify click handler: when `chainActive && !isChainDisabled && target`, call `manager.dispatchTo(target, { action, phase: "discrete" })` instead of `manager.dispatch({ action, phase: "discrete" })`. If `dispatchTo` returns false (target exists but does not handle the action), log a dev-mode `console.warn` with a message like `TugButton: dispatchTo("${target}", "${action}") returned false -- target does not handle this action`.
- [ ] Add `canHandle: () => true` to DeckCanvas's existing `useResponder` registration. This makes DeckCanvas the last-resort responder for all actions. No new entries in the `actions` map are needed -- `canHandle` is the advisory override for validation queries only and is never consulted during dispatch.

**Tests:**
- [ ] Test: TugButton with `action` and `target` calls `manager.dispatchTo(target, event)` on click
- [ ] Test: TugButton with `action` and `target` uses `nodeCanHandle(target, action)` for enabled check
- [ ] Test: TugButton with `action` and `target` is disabled when `nodeCanHandle` returns false
- [ ] Test: TugButton with `action` but no `target` calls `manager.dispatch(event)` on click (existing behavior preserved)
- [ ] Test: TugButton with `target` but no `action` renders normally (no dispatch, dev warning logged)
- [ ] Test: TugButton with `action` and `target` logs dev warning when `dispatchTo` returns false
- [ ] Test: DeckCanvas responder has `canHandle` returning true for any action string (verify `manager.canHandle("anyArbitraryAction")` returns true when DeckCanvas is registered)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` -- zero type errors
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun vitest run` -- all tests pass

---

#### Step 4: Gallery ActionEvent Demo {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugways): ActionEvent gallery demo in Chain Actions tab (Phase 5d2)`

**References:** [D01] ActionEvent is the sole dispatch currency, [D02] Handler signature, [D03] dispatchTo throws on unregistered target, Spec S01, Spec S03, (#action-event-interface, #dispatch-to-signature, #context)

**Artifacts:**
- Modified `gallery-card.tsx`: new `ActionEventDemo` section within `GalleryChainActionsContent`, below the existing chain demo

**Tasks:**
- [ ] Add a new section within `GalleryChainActionsContent` below the existing "Chain-Action Buttons" section, separated by a `cg-divider`
- [ ] The new section title: "ActionEvent Dispatch"
- [ ] Register a local responder via `useResponder` with a stable ID (e.g., `"action-event-demo"`) that handles `demoAction` and updates local state with the received `ActionEvent` fields. Import `useResponder` from `use-responder.tsx` and use `useLayoutEffect` for registration per Rules of Tugways. The responder registers as a child of the gallery card's Tugcard responder node -- `useResponder` automatically picks up the parent ID from `ResponderParentContext` provided by Tugcard's `ResponderScope`. This is correct tree placement: the demo responder is a leaf node below the gallery card in the responder chain tree.
- [ ] Add a TugButton in **direct-action mode** (`onClick`) that calls `manager.dispatchTo("action-event-demo", { action: "demoAction", phase: "discrete" })` in its click handler. Use `useRequiredResponderChain()` to get the manager. Note: chain-action mode (`action` prop) without `target` would walk the chain upward and never find the demo responder (it is a child, not an ancestor). Using `target` prop would correctly use `nodeCanHandle`, but direct-action mode with explicit `dispatchTo` is simpler and demonstrates the same mechanism.
- [ ] The handler receives the full `ActionEvent` and stores a display string showing its fields (action, phase).
- [ ] A status line below the button shows the last received event's fields (action, phase) or "No event received" initially
- [ ] Use local `useState` for the display text (this is local component state, not external store state, so `useSyncExternalStore` does not apply per Rules of Tugways). Note on stale closures: the `demoAction` handler closes over the `useState` setter. This is safe because React guarantees `useState` setter identity stability across re-renders -- the setter never changes, so the closure captured at registration time always calls the current setter.

**Tests:**
- [ ] Existing gallery-card tests continue to pass
- [ ] Visual verification: Chain Actions tab shows both the existing chain-action buttons section and the new ActionEvent section
- [ ] Note: the gallery demo uses `onClick` + `dispatchTo` rather than TugButton's `target` prop. The `target` prop is designed for production use cases where the target is a known registered node (e.g., an inspector panel targeting a card). In the gallery, direct-action mode with explicit `dispatchTo` is simpler and demonstrates the same explicit-target dispatch mechanism.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` -- zero type errors
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun vitest run` -- all tests pass

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] ActionEvent is the sole dispatch currency, [D03] dispatchTo throws on unregistered target, [D04] TugButton target prop requires action prop, [D06] TugButton never hides, [D07] nodeCanHandle, [D08] DeckCanvas last-resort responder, (#success-criteria)

**Tasks:**
- [ ] Verify all production dispatch calls use `ActionEvent` -- grep for `\.dispatch\(` and confirm no bare string arguments remain
- [ ] Verify all action handler registrations use `(event: ActionEvent) => void` or `(_event: ActionEvent) => void` signature
- [ ] Verify TugButton never returns null in chain-action mode -- grep for `return null` in tug-button.tsx and confirm no chain-action hide branch exists
- [ ] Verify `dispatchTo` is available and throws on unregistered target
- [ ] Verify `nodeCanHandle` returns correct results
- [ ] Verify TugButton `target` prop uses `nodeCanHandle` for enabled check and `dispatchTo` for click
- [ ] Verify DeckCanvas has `canHandle: () => true` in its responder registration
- [ ] Verify gallery ActionEvent demo renders correctly in the Chain Actions tab
- [ ] Verify keyboard shortcuts (Cmd+W close, Cmd+Tab cycle, etc.) work unchanged in the running app

**Tests:**
- [ ] All tests from Steps 1-4 pass in aggregate (`bun vitest run`)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` -- zero type errors
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun vitest run` -- all tests pass
- [ ] Manual: open gallery card, switch to Chain Actions tab, verify existing buttons and new ActionEvent demo both function
- [ ] Manual: verify chain-action buttons (e.g., "Cycle Card") are never hidden, only disabled when not available

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The responder chain speaks a typed action language. `dispatch()` accepts only `ActionEvent` with action name, optional sender/value, and phase. `dispatchTo()` enables explicit-target dispatch. `nodeCanHandle()` enables per-node capability queries. TugButton never hides -- unhandled actions render as disabled. DeckCanvas is the last-resort responder. TugButton supports a `target` prop with `nodeCanHandle`-based enabled checks. All existing functionality is preserved with zero legacy code.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `ActionEvent` and `ActionPhase` are exported from `responder-chain.ts` (import check)
- [ ] `dispatch()` accepts only `ActionEvent` -- no string overload exists (TypeScript compiler check)
- [ ] TugButton never returns null in chain-action mode (code inspection)
- [ ] `dispatchTo()` throws on unregistered target (unit test)
- [ ] `nodeCanHandle()` correctly queries per-node capability (unit test)
- [ ] TugButton `target` prop dispatches via `dispatchTo` and uses `nodeCanHandle` for enabled check (unit test)
- [ ] DeckCanvas registers `canHandle: () => true` (unit test)
- [ ] All existing tests pass (full test suite, with hide-to-disable inversions)
- [ ] Gallery Chain Actions tab shows ActionEvent demo (visual check)
- [ ] Zero TypeScript errors in `bun run build`

**Acceptance tests:**
- [ ] `bun run build` succeeds
- [ ] `bun vitest run` passes all tests (existing + new)
- [ ] Manual: keyboard shortcuts work unchanged
- [ ] Manual: Chain Actions gallery tab shows ActionEvent demo
- [ ] Manual: chain-action buttons are never hidden, only disabled

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5d3: Mutation transactions using ActionEvent phases (begin/commit/cancel)
- [ ] Phase 5d4: Observable properties with inspector dispatch via `dispatchTo`
- [ ] Phase 8b: Continuous controls (TugSlider, TugColorPicker) that produce `begin`/`change`/`commit`/`cancel` phases
- [ ] Phase 8e: Inspector panels using `dispatchTo` for card-targeted property editing

| Checkpoint | Verification |
|------------|--------------|
| TypeScript compilation | `bun run build` -- zero errors |
| Full test suite | `bun vitest run` -- all pass |
| Never-hide buttons | chain-action buttons render as disabled, never null |
| Keyboard shortcuts | Manual: Cmd+W, Cmd+Tab, Cmd+A work unchanged |
| Gallery demo | Manual: Chain Actions tab shows ActionEvent section |
