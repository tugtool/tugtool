## Tugways Phase 3: Responder Chain {#tugways-phase-3}

**Purpose:** Ship the responder chain infrastructure -- ResponderChainManager, useResponder hook, four-stage key pipeline, action validation, chain-action TugButton mode -- and prove it end-to-end by wiring DeckCanvas and the component gallery as responders with working keyboard shortcuts.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-3-responder-chain |
| Last updated | 2026-03-02 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 2 is complete. TugButton ships with all four subtypes in direct-action mode, and the Component Gallery is visible on the canvas via Mac Developer menu toggle. The existing `action-dispatch.ts` handles control frames from the backend, but all keyboard handling and focus management is ad-hoc -- the old `keydownHandler` in DeckManager was deleted during Phase 0 demolition.

Phase 3 builds the responder chain (design-system-concepts.md Concept 4), the architectural keystone that all subsequent phases depend on. The chain is an imperative system operating outside React state: a stable `ResponderChainManager` object provided via React context, with components registering as responder nodes via a `useResponder` hook. The four-stage key pipeline (global shortcuts, keyboard navigation, action dispatch via chain, text input) routes keyboard events through the chain. Two-level action validation (`canHandle` + `validateAction`) drives dynamic UI -- TugButton's new chain-action mode (`action` prop) uses it to auto-enable/disable based on what the focused responder can handle.

#### Strategy {#strategy}

- Build ResponderChainManager as a plain TypeScript class (not a React component) -- stable reference provided via React context, zero re-renders on chain mutations.
- Use nested-context pattern for parent discovery in useResponder: each responder provides itself as context to its children, so children auto-discover their parent without walking the fiber tree.
- Scope ResponderChainProvider to wrap DeckCanvas only (inside ErrorBoundary), keeping the chain scoped to the canvas subtree per user direction.
- Implement exactly two responder levels in Phase 3: gallery panel (or no focused responder) and DeckCanvas, with TugApp as the app-level terminus. Card-level responders are stubbed for Phase 5.
- Add chain-action mode to TugButton in this phase -- the `action` prop connects the button to the chain for validation and dispatch, proving the full pipeline end-to-end.
- Define a minimal static keybinding map (key-to-action-name) for the stage-1 global shortcut handler. The full concept-14 keybindings view is deferred.
- Wire panel cycling shortcut at stage 1 (global shortcuts) since no real card panels exist yet; it will be redefined as a chain-dispatched action once cards exist in Phase 5.

#### Success Criteria (Measurable) {#success-criteria}

- ResponderChainManager singleton registers and unregisters responder nodes without errors (`bun test` passes for registration/deregistration lifecycle)
- useResponder hook correctly discovers parent responder via nested context and registers with the manager (`bun test` passes for parent discovery)
- Four-stage key pipeline processes keyboard events in correct priority order: global shortcuts first, then keyboard navigation, then chain action dispatch, then text input (`bun test` passes for pipeline stage ordering)
- `canHandle` returns true for actions registered by any responder in the chain and false otherwise (`bun test` passes for capability queries)
- `validateAction` returns enabled/disabled state from the handler that canHandle found (`bun test` passes for validation queries)
- Chain-action TugButton with `action="cyclePanel"` is visible and enabled when the gallery responder is registered, and dispatches the action on click (`bun test` passes for chain-action button integration)
- DeckCanvas responder handles `cyclePanel` action and the Ctrl+` keyboard shortcut triggers it via the key pipeline (`bun test` passes for shortcut-to-action flow)
- Gallery panel registers as a responder with ID `component-gallery` on show, deregisters on hide (`bun test` passes for gallery responder lifecycle)
- `makeFirstResponder` / `resignFirstResponder` correctly update the chain's first responder (`bun test` passes for focus management)
- `bun test` passes with zero failures for all new and existing tests

#### Scope {#scope}

1. `ResponderChainManager` class with chain tree management, action dispatch, validation queries, first responder tracking
2. `useResponder` hook with nested-context parent discovery and ref-based registration
3. `ResponderChainProvider` React context provider wrapping DeckCanvas
4. Four-stage key pipeline with `keydown` listener
5. Minimal static keybinding map (key-to-action-name string mapping)
6. Two-level action validation (`canHandle` + `validateAction`)
7. Chain-action mode for TugButton (`action` prop, `useSyncExternalStore` for validation subscription)
8. DeckCanvas wired as a responder (handles `cyclePanel`, `resetLayout`)
9. Component Gallery wired as a responder (registers on show, deregisters on hide)
10. Unit and integration tests for all new code

#### Non-goals (Explicitly out of scope) {#non-goals}

- Card-level responders (deferred to Phase 5 when Tugcard exists)
- Modal boundaries / `modalScope` flag (deferred to Phase 8 when alerts exist)
- Full keybindings view (Concept 14, deferred)
- Mouse/pointer event routing through the chain (hit-testing only, per Apple's model)
- Text input stage of the key pipeline beyond passing through to the focused element
- Keyboard navigation stage (Tab/Shift+Tab) beyond default browser behavior

#### Dependencies / Prerequisites {#dependencies}

- Phase 0 (Demolition) complete: empty canvas, connection working
- Phase 1 (Theme Foundation) complete: `--td-*` semantic tokens, TugThemeProvider, stylesheet injection
- Phase 2 (First Component) complete: TugButton (direct-action mode), Component Gallery panel, `action-dispatch.ts` operational
- design-system-concepts.md Concept 4 fully designed: chain structure, action vocabulary, validation model, key pipeline

#### Constraints {#constraints}

- ResponderChainManager must operate outside React state -- no `useState`, no `useReducer` in the manager. The context value (the manager reference) never changes.
- `useResponder` must use refs internally, not state, to avoid re-renders on registration.
- Chain-action TugButton must subscribe to validation via `useSyncExternalStore` so only that button re-renders when its validation state changes.
- All new files go under `tugdeck/src/components/tugways/` consistent with Phase 2 layout.
- Tests use `bun:test` + React Testing Library following `tug-button.test.tsx` pattern.

#### Assumptions {#assumptions}

- The ResponderChainManager is a plain TypeScript class provided via React context as a stable object reference -- the context value never changes so providing it causes zero re-renders.
- useResponder uses a nested-context pattern for parent discovery: each call reads the nearest ancestor responder from context and registers itself as a child, then provides itself as the new context value to its subtree.
- The chain has exactly two levels in Phase 3 -- gallery panel (or no focused responder) and DeckCanvas -- with TugApp as the app-level terminus. Card-level responders are stubbed and added in Phase 5.
- The panel cycling shortcut operates at stage 1 (global shortcuts) since there are no real card panels yet; it will be redefined as an action dispatched through stage 3 once cards exist.
- Tests use bun:test + React Testing Library following the pattern established in tug-button.test.tsx.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor-name}` anchors on all referenceable headings. Execution steps cite decisions by `[DNN]` ID, specs by `Spec SNN`, tables by `Table TNN`, and sections by `#anchor` references. No line-number citations.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarifying questions were resolved during planning:

- Keybinding map: minimal static object (key-to-action-name string), full concept-14 view deferred (user answer)
- Chain-action TugButton: wired in Phase 3, primary consumer of canHandle/validateAction (user answer)
- Provider placement: wraps DeckCanvas only, inside ErrorBoundary (user answer)
- Gallery responder identity: well-known string ID `component-gallery`, makeFirstResponder on show, resignFirstResponder on hide (user answer)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Nested context for parent discovery causes unexpected re-renders | med | low | Context value is the stable manager reference, never changes; useResponder reads parent via a separate context that provides a ref | Performance profiling shows unexpected re-renders in chain subtree |
| useSyncExternalStore subscription for chain-action TugButton causes excessive re-renders | med | low | Subscription selector returns a narrow boolean (canHandle + validateAction result for one action); only the specific button re-renders | Multiple chain-action buttons cause visible jank on focus change |
| Key pipeline intercepts keys that should reach native browser controls (e.g., Tab in input fields) | high | med | Stage-2 keyboard navigation defers to default browser Tab behavior; pipeline only intercepts keys that match the keybinding map or global shortcuts | Users report broken Tab navigation in form controls |
| Capture-phase `stopImmediatePropagation` blocks future document-level key listeners | low | low | Stage 1 only matches a small set of modified key combinations; future key handling should use the responder chain, not separate document listeners | A future phase needs a parallel document-level key listener |

**Risk R01: Key event interception breaks native controls** {#r01-key-interception}

- **Risk:** The top-level `keydown` listener for the key pipeline could intercept key events that should reach native browser controls (inputs, textareas, selects).
- **Mitigation:**
  - Stage-1 global shortcuts only match specific modified key combinations (Ctrl+`, Cmd+N, etc.) -- plain letter keys are never intercepted.
  - The pipeline checks `event.target` -- if the target is an `<input>`, `<textarea>`, or `<select>`, stages 1 and 3 skip unless the key matches a global shortcut with a modifier.
  - Integration tests verify that typing in an input field inside the gallery is not intercepted.
- **Residual risk:** Edge cases with contenteditable elements or third-party components may still require per-component opt-out.

**Risk R02: Stale validation state in chain-action buttons** {#r02-stale-validation}

- **Risk:** Chain-action buttons could display stale enabled/disabled state if the validation subscription does not fire when the first responder changes.
- **Mitigation:**
  - ResponderChainManager notifies all validation subscribers whenever `makeFirstResponder` or `resignFirstResponder` is called.
  - Each chain-action TugButton subscribes via `useSyncExternalStore` with a `getSnapshot` that calls `canHandle` + `validateAction` on the current chain state.
  - Tests verify that button enabled state updates synchronously after focus change.
- **Residual risk:** If a responder's `validateAction` result changes without a focus change (e.g., selection state changes within a card), the button won't update until the next notification. Phase 5 can add fine-grained notification for within-card state changes.

**Risk R03: Capture-phase stopImmediatePropagation blocks future document listeners** {#r03-stop-immediate-propagation}

- **Risk:** The capture-phase `keydown` listener for Stage 1 (global shortcuts) calls `stopImmediatePropagation()` after matching a keybinding. This prevents any subsequently-registered document-level `keydown` listeners from seeing the event. If future phases or third-party integrations add their own document-level key listeners, those listeners will never fire for consumed shortcuts.
- **Mitigation:**
  - Stage 1 only matches specific modified key combinations (Ctrl+`, Cmd+N, etc.) -- the set is small and well-defined.
  - The keybinding map is the single source of truth. Any new document-level listener that needs to see these keys can instead register as a responder in the chain (the preferred pattern).
  - If a future phase genuinely needs a parallel document-level listener (e.g., analytics/telemetry), the capture listener can be refactored to use a shared event bus or set a flag on the event object instead of calling `stopImmediatePropagation`. This is a low-cost refactor since the listener is in a single file (`responder-chain-provider.tsx`).
- **Residual risk:** Low. The responder chain is the canonical key-event routing mechanism, so most new key handling should go through the chain, not through separate document listeners.

---

### Design Decisions {#design-decisions}

#### [D01] ResponderChainManager is a plain TypeScript class outside React state (DECIDED) {#d01-manager-class}

**Decision:** ResponderChainManager is a plain TypeScript class, not a React component or hook. It is instantiated once and provided via React context as a stable reference that never changes.

**Rationale:**
- The chain is an imperative system -- registration, dispatch, and focus management are function calls, not state transitions.
- A stable context value means providing it causes zero re-renders in the entire subtree.
- Follows the design-system-concepts.md Concept 4 architecture: "The chain operates outside React state."

**Implications:**
- Components interact with the manager via imperative method calls, not props or state.
- The manager must implement a subscriber pattern (for `useSyncExternalStore`) so chain-action buttons can react to validation changes.
- The manager is a singleton within the canvas subtree -- one manager per `ResponderChainProvider`.

#### [D02] useResponder uses nested context for parent discovery (DECIDED) {#d02-nested-context}

**Decision:** Each `useResponder` call reads the nearest ancestor responder from a `ResponderParentContext`, registers itself as a child of that parent in the manager, then provides itself as the new `ResponderParentContext` value to its subtree.

**Rationale:**
- Automatic parent discovery without walking the React fiber tree or passing explicit parent IDs.
- The nested context value is a stable ref (responder node ID), not a state value, so providing it causes no re-renders.
- Follows the design-system-concepts.md resolved question: "Parent discovery: nested context (option b)."

**Implications:**
- Each component that calls `useResponder` must render a `ResponderParentContext.Provider` wrapping its children.
- The hook returns a wrapper element or uses React's `children` pattern to inject the provider.
- The root responder (DeckCanvas) has no parent context and registers as a root node in the manager.

#### [D03] Four-stage key pipeline with global keydown listener (DECIDED) {#d03-key-pipeline}

**Decision:** Two `keydown` event listeners on `document` implement the four-stage pipeline. A **capture-phase** listener handles stage 1 (global shortcuts checked against the keybinding map). A **bubble-phase** listener handles stages 2-4 (keyboard navigation, chain action dispatch, text input passthrough). This split ensures global shortcuts always see key events first -- before any component can `stopPropagation()` -- faithfully matching Apple's key equivalent model where key equivalents are checked top-down before the responder chain.

**Rationale:**
- Capture-phase for stage 1 guarantees global shortcuts always take priority, even if a component lower in the tree calls `stopPropagation()`. This matches Apple's model where key equivalents are checked before the chain.
- Bubble-phase for stages 2-4 allows components to call `stopPropagation()` to prevent chain dispatch if they have already handled the event locally (e.g., a text input consuming a keypress).
- Both listeners are installed by `ResponderChainProvider` on mount and removed on unmount.

**Implications:**
- The capture-phase listener checks the keybinding map. If a match is found, the action is dispatched. `preventDefault` and `stopImmediatePropagation` are called only if `dispatch` returns true (the action was handled). If no responder handles the matched action, the event continues through the normal DOM flow.
- The bubble-phase listener handles stages 2-4. Stage 3 maps remaining unhandled key events to actions and walks the chain. Stage 4 is implicit -- if no stage handles the event, the browser's default behavior (text input) proceeds.
- The bubble-phase listener must check `event.target` to avoid intercepting keys in native form controls.

#### [D04] Minimal static keybinding map for Phase 3 (DECIDED) {#d04-keybinding-map}

**Decision:** Define a small static keybinding map as a plain TypeScript object mapping key descriptors to action name strings. The full concept-14 keybindings view is deferred.

**Rationale:**
- Phase 3 needs at least one working shortcut (panel cycling) to prove the key pipeline works.
- A static object is trivially replaceable when the full keybindings system is built.
- Keeps Phase 3 scope focused on the chain infrastructure, not the keybindings UI.

**Implications:**
- The map is a module-level constant in the key pipeline file, not a user-configurable store.
- Key descriptors use a simple string format: `"ctrl+Backquote"`, `"meta+n"`, etc.
- The map is extensible -- later phases add entries without changing the pipeline logic.

#### [D05] Two-level action validation following Apple's model (DECIDED) {#d05-action-validation}

**Decision:** Adopt Apple's two-level validation: `canHandle(action)` is a capability query ("does any responder implement this?") and `validateAction(action)` is an enabled-state query ("is it currently available?"). Chain-action TugButton uses both.

**Rationale:**
- `canHandle` determines visibility (should the button exist?), `validateAction` determines enabled state (should the button be clickable?).
- Decades of battle-tested usage in AppKit/UIKit.
- Decouples controls from handlers completely -- a button doesn't know who handles its action.

**Implications:**
- `canHandle` walks the chain from the first responder upward. For each node, it first checks the `actions` map (primary): if the action key exists, the node can handle it. If the action key is not in the map, it falls back to the node's optional `canHandle` function (dynamic override) for card-specific or runtime-determined capabilities. The `actions` map is the normal path; the `canHandle` function is the escape hatch for cases where the set of handleable actions is not statically known.
- `validateAction` calls the `validateAction` function on the responder that `canHandle` found. If the responder has no `validateAction` function, it defaults to true (the action is enabled).
- If no responder can handle the action, `canHandle` returns false and `validateAction` is not called.
- Chain-action TugButton subscribes to a combined `canHandle + validateAction` result via `useSyncExternalStore`.

#### [D06] Chain-action TugButton uses useSyncExternalStore for validation (DECIDED) {#d06-button-subscription}

**Decision:** Chain-action TugButton subscribes to the ResponderChainManager's validation state for its specific action via `useSyncExternalStore`. The subscription fires when the first responder changes or when the manager's validation version increments.

**Rationale:**
- `useSyncExternalStore` is the React-sanctioned pattern for external mutable stores.
- Only the specific button re-renders when its validation state changes -- not the toolbar, not the card, not the deck.
- Follows the local-data zone pattern from Concept 5 (design-system-concepts.md).

**Implications:**
- ResponderChainManager maintains a `validationVersion` counter that increments on any change that could affect validation (focus change, responder register/unregister).
- The `subscribe` method accepts a callback and returns an unsubscribe function.
- The `getSnapshot` function returns the `validationVersion` -- React compares versions to decide whether to re-render.
- TugButton's chain-action code path calls `canHandle` and `validateAction` during render to compute enabled/disabled.

#### [D07] ResponderChainProvider wraps DeckCanvas only (DECIDED) {#d07-provider-placement}

**Decision:** The `ResponderChainProvider` sits inside `ErrorBoundary`, wrapping `DeckCanvas`. The chain is scoped to the canvas subtree.

**Rationale:**
- The chain manages canvas-level concerns (card focus, panel actions, keyboard shortcuts).
- Scoping to DeckCanvas means the chain does not affect error boundary rendering.
- Matches the user's explicit direction on provider placement.

**Implications:**
- The render tree becomes: `TugThemeProvider > ErrorBoundary > ResponderChainProvider > DeckCanvas`.
- DeckManager's `render()` method is updated to insert the provider.
- Components outside the provider (e.g., error boundary fallback) cannot access the chain.

#### [D08] Gallery responder uses well-known string ID (DECIDED) {#d08-gallery-responder-id}

**Decision:** The Component Gallery uses a well-known string ID `component-gallery` as its responder identity. `makeFirstResponder` is called when the gallery is shown and `resignFirstResponder` when it is hidden.

**Rationale:**
- A string ID is simple and debuggable -- no generated UUIDs or opaque handles needed for Phase 3.
- The gallery is the only non-DeckCanvas responder in Phase 3, so a well-known ID is sufficient.
- Focus lifecycle (show = first responder, hide = resign) matches the expected behavior.

**Implications:**
- The gallery's `useResponder` registration uses `id: "component-gallery"`.
- When the gallery becomes visible, it calls `manager.makeFirstResponder("component-gallery")`.
- When the gallery is hidden (unmount), `useResponder` cleanup calls `manager.unregister("component-gallery")`. Because the gallery's `parentId` is `"deck-canvas"`, the manager's auto-promotion logic makes DeckCanvas the new first responder. No separate `resignFirstResponder` call is needed.
- DeckCanvas is the fallback responder when no gallery (or card) is focused.

---

### Specification {#specification}

#### Terminology and Naming {#terminology}

| Term | Definition |
|------|-----------|
| **Responder** | A component that can handle actions routed through the chain. Registered via `useResponder`. |
| **Responder node** | An entry in the manager's chain tree. Has an ID, parent link, actions map, and optional validate function. |
| **First responder** | The starting point for chain traversal. One per chain. Set via `makeFirstResponder`. |
| **Action** | A semantic string command (e.g., `"copy"`, `"cyclePanel"`). Dispatched through the chain. |
| **Chain walk** | Traversal from the first responder up through parent links to the root, looking for a handler. |
| **Validation** | Two-level query: `canHandle` (capability) and `validateAction` (enabled state). |
| **Key pipeline** | Four-stage processing of keyboard events: global shortcuts, keyboard navigation, chain action dispatch, text input. |
| **Keybinding map** | Static object mapping key descriptors (e.g., `"ctrl+Backquote"`) to action names. |

#### Public API Surface {#api-surface}

**Spec S01: ResponderChainManager API** {#s01-manager-api}

```typescript
interface ResponderNode {
  id: string;
  parentId: string | null;
  actions: Record<string, () => void>;
  // canHandle is advisory for validation queries only. dispatch() only invokes
  // handlers from the actions map. Any action that should be dispatchable MUST
  // have an entry in the actions map. canHandle is for cases where a responder
  // wants to report capability for actions it does not directly handle (e.g.,
  // a card that knows its content can handle "find" but delegates to a child).
  canHandle?: (action: string) => boolean;
  validateAction?: (action: string) => boolean;
}

class ResponderChainManager {
  // Registration
  register(node: ResponderNode): void;
  // register behavior: if the node is a root (parentId is null) and
  // firstResponderId is null, auto-set firstResponderId to this node's ID.
  // This ensures the chain always has a first responder once a root registers.

  unregister(id: string): void;
  // unregister behavior: if the removed node is the current first responder,
  // auto-promote its parentId to first responder. If no parent exists, set
  // firstResponderId to null. Always increments validationVersion.

  // First responder
  makeFirstResponder(id: string): void;
  resignFirstResponder(): void;
  getFirstResponder(): string | null;

  // Action dispatch — only invokes handlers from the actions map (not canHandle).
  // Any dispatchable action must have an entry in the actions map.
  dispatch(action: string): boolean;  // returns true if handled

  // Validation queries
  canHandle(action: string): boolean;
  validateAction(action: string): boolean;

  // Subscription for useSyncExternalStore
  subscribe(callback: () => void): () => void;
  getValidationVersion(): number;
}
```

**Spec S02: useResponder hook API** {#s02-use-responder-api}

```typescript
interface UseResponderOptions {
  id: string;
  actions?: Record<string, () => void>;
  canHandle?: (action: string) => boolean;
  validateAction?: (action: string) => boolean;
}

function useResponder(options: UseResponderOptions): {
  /** Wrapper component that provides this responder as parent context to children */
  ResponderScope: React.FC<{ children: React.ReactNode }>;
};
```

The hook returns a `ResponderScope` component that wraps children to provide the nested parent context. Usage:

```tsx
function MyComponent({ children }) {
  const { ResponderScope } = useResponder({
    id: "my-component",
    actions: { doSomething: () => { /* ... */ } },
  });
  return <ResponderScope>{children}</ResponderScope>;
}
```

**Spec S03: ResponderChainProvider API** {#s03-provider-api}

```tsx
function ResponderChainProvider({ children }: { children: React.ReactNode }): JSX.Element;
```

Creates a `ResponderChainManager` instance and provides it via `ResponderChainContext`. Also installs the `keydown` listener for the key pipeline.

**Spec S04: Chain-action TugButton extension** {#s04-chain-action-button}

```typescript
// Added to existing TugButtonProps
interface TugButtonProps {
  // ... existing props ...

  /** Chain-action mode: action name to dispatch via responder chain.
   *  Mutually exclusive with onClick. */
  action?: string;
}
```

Hook calls are unconditional (React rules of hooks):
- `useResponderChain()` is called on every render, returning `manager | null`.
- `useSyncExternalStore()` is called on every render. When manager is null or action is undefined, module-level constant no-op functions (`NOOP_SUBSCRIBE`, `NOOP_SNAPSHOT`) are passed to ensure stable references and prevent re-subscribe churn.

When `action` is set and manager is available:
- On render, calls `manager.canHandle(action)` -- if false, button is hidden (returns null).
- On render, calls `manager.validateAction(action)` -- if false, button uses `aria-disabled="true"` (stays in tab order but visually disabled via CSS `[aria-disabled='true']` rules).
- On click, calls `manager.dispatch(action)`.

When `action` is undefined or manager is null, TugButton falls through to direct-action mode (existing onClick behavior).

**Spec S05: Keybinding map format** {#s05-keybinding-map}

```typescript
interface KeyBinding {
  key: string;        // KeyboardEvent.code (e.g., "Backquote", "KeyN")
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: string;     // action name to dispatch
}

const KEYBINDINGS: KeyBinding[] = [
  { key: "Backquote", ctrl: true, action: "cyclePanel" },
  // ... additional bindings as needed
];
```

#### Action Vocabulary (Phase 3 Subset) {#action-vocabulary-phase3}

**Table T01: Actions registered by Phase 3 responders** {#t01-phase3-actions}

| Action | Responder | Level | Description |
|--------|-----------|-------|-------------|
| `cyclePanel` | DeckCanvas | canvas | Cycle focus to the next panel/card. Note: the design-system-concepts.md action vocabulary defines `focusNextCard` and `focusPreviousCard` at the card level. `cyclePanel` is a Phase 3 canvas-level action that wraps simple sequential cycling before cards exist. Phase 5 will replace it with `focusNextCard`/`focusPreviousCard` dispatched through the chain at card level. |
| `resetLayout` | DeckCanvas | canvas | Reset card layout to default positions |
| `showSettings` | DeckCanvas (app-level) | app | Open settings (stub -- logged, not implemented until Phase 8) |
| `showComponentGallery` | DeckCanvas | canvas | Toggle Component Gallery visibility |

**Table T02: Phase 3 keybinding map** {#t02-keybinding-map}

| Key Combination | Action | Stage |
|-----------------|--------|-------|
| Ctrl+` | `cyclePanel` | 1 (global shortcut) |

#### Internal Architecture {#internal-architecture}

**Spec S06: Chain tree structure** {#s06-chain-tree}

The manager maintains a `Map<string, ResponderNode>` and a `firstResponderId: string | null`. Chain walk starts at `firstResponderId` and follows `parentId` links until a handler is found or the root is reached. If `firstResponderId` is null (no responders registered or all unregistered), `dispatch` and `canHandle` return false.

```
component-gallery (first responder when gallery is shown)
  └── parent: deck-canvas
        └── parent: null (root)
```

DeckCanvas auto-becomes the first responder when it registers as a root node (parentId null, firstResponderId null). When the gallery mounts, it explicitly calls `makeFirstResponder("component-gallery")`. When the gallery unmounts, `unregister("component-gallery")` auto-promotes `"deck-canvas"` (its parent) to first responder. DeckCanvas is the effective first responder whenever no child responder is focused.

**Spec S07: Validation subscription model** {#s07-validation-subscription}

The manager maintains:
- `validationVersion: number` -- incremented on any mutation that could affect validation results (register, unregister, makeFirstResponder, resignFirstResponder).
- `subscribers: Set<() => void>` -- callbacks registered via `subscribe()`.

When `validationVersion` increments, all subscribers are notified. `useSyncExternalStore` compares the version number returned by `getValidationVersion()` to decide whether to re-render.

**Spec S08: Key pipeline event flow** {#s08-key-pipeline-flow}

```
document keydown event (capture phase — stage 1 listener)
  │
  └─ Stage 1: Check keybinding map for global shortcuts
      └─ Match? → dispatch(action)
          ├─ dispatch returns true? → preventDefault + stopImmediatePropagation, done
          └─ dispatch returns false? → event continues through DOM normally

document keydown event (bubble phase — stages 2-4 listener)
  │
  ├─ Stage 2: Keyboard navigation (Tab, Escape, Enter)
  │   └─ Defer to browser defaults in Phase 3
  │
  ├─ Stage 3: Map remaining keys to actions, walk chain
  │   └─ Handler found? → call handler, preventDefault, stop
  │
  └─ Stage 4: Text input passthrough
      └─ No interception -- browser handles it
```

The capture-phase listener processes global shortcuts before any component can `stopPropagation()`. The bubble-phase listener checks `event.target`: if it is an `<input>`, `<textarea>`, `<select>`, or a `contenteditable` element (`isContentEditable === true`), stages 3 and 4 are skipped to avoid intercepting typing.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/responder-chain.ts` | `ResponderChainManager` class, `ResponderNode` interface, `ResponderChainContext`, validation subscription |
| `tugdeck/src/components/tugways/use-responder.tsx` | `useResponder` hook with nested-context parent discovery (`.tsx` because the returned `ResponderScope` component uses JSX) |
| `tugdeck/src/components/tugways/responder-chain-provider.tsx` | `ResponderChainProvider` component, `ResponderChainContext`, key pipeline listener |
| `tugdeck/src/components/tugways/keybinding-map.ts` | Static keybinding map and key-matching utility |
| `tugdeck/src/__tests__/responder-chain.test.ts` | Unit tests for ResponderChainManager |
| `tugdeck/src/__tests__/use-responder.test.tsx` | Tests for useResponder hook and nested context |
| `tugdeck/src/__tests__/key-pipeline.test.tsx` | Tests for four-stage key pipeline |
| `tugdeck/src/__tests__/chain-action-button.test.tsx` | Tests for chain-action TugButton mode |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ResponderChainManager` | class | `responder-chain.ts` | Chain tree, dispatch, validation, subscription |
| `ResponderNode` | interface | `responder-chain.ts` | Node in the chain tree |
| `useResponder` | function (hook) | `use-responder.tsx` | Registers component as responder, returns `ResponderScope` |
| `ResponderChainProvider` | function (component) | `responder-chain-provider.tsx` | Creates manager, provides context, installs key listener |
| `ResponderChainContext` | React context | `responder-chain.ts` | Provides `ResponderChainManager` to subtree; co-located with the manager so `use-responder.ts` can import it without depending on the provider |
| `ResponderParentContext` | React context | `use-responder.tsx` | Provides current parent responder ID to children |
| `useResponderChain` | function (hook) | `responder-chain-provider.tsx` | Returns `ResponderChainManager \| null`; returns null outside provider (safe for TugButton) |
| `useRequiredResponderChain` | function (hook) | `responder-chain-provider.tsx` | Returns `ResponderChainManager`; throws outside provider (for components that must be inside the chain) |
| `KEYBINDINGS` | const array | `keybinding-map.ts` | Static keybinding map entries |
| `matchKeybinding` | function | `keybinding-map.ts` | Matches a `KeyboardEvent` against the keybinding map |
| `TugButtonProps.action` | prop (string) | `tug-button.tsx` | Chain-action mode: action name for dispatch and validation |
| `DeckCanvas` | modified | `deck-canvas.tsx` | Registers as responder via `useResponder`, handles canvas-level actions |
| `ComponentGallery` | modified | `component-gallery.tsx` | Registers as responder, calls `makeFirstResponder` on show |
| `DeckManager.render()` | modified | `deck-manager.ts` | Inserts `ResponderChainProvider` between `ErrorBoundary` and `DeckCanvas` |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `tug-button.tsx` header comment to document chain-action mode
- [ ] Add JSDoc to all new public APIs (ResponderChainManager, useResponder, ResponderChainProvider)
- [ ] Document the keybinding map format and how to add new shortcuts

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test ResponderChainManager methods in isolation (register, dispatch, canHandle, validateAction, subscription) | Core chain logic, edge cases (empty chain, missing responder, circular parents) |
| **Integration** | Test useResponder hook with nested React components, test key pipeline with simulated keyboard events, test chain-action TugButton rendering | Hook registration lifecycle, pipeline stage ordering, button validation subscription |
| **Golden / Contract** | Verify that the ResponderChainProvider + DeckCanvas + Gallery responder tree matches the expected chain structure | Chain tree shape after mount |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Implement ResponderChainManager {#step-1}

**Commit:** `feat(tugways): implement ResponderChainManager class`

**References:** [D01] ResponderChainManager is a plain TypeScript class outside React state, [D05] Two-level action validation, Spec S01, Spec S06, Spec S07, (#api-surface, #internal-architecture, #terminology)

**Artifacts:**
- `tugdeck/src/components/tugways/responder-chain.ts` -- new file
- `tugdeck/src/__tests__/responder-chain.test.ts` -- new file

**Tasks:**
- [ ] Create `responder-chain.ts` with `ResponderNode` interface and `ResponderChainManager` class
- [ ] Implement `register(node)` -- adds node to the internal `Map<string, ResponderNode>`. **Auto-first-responder for root nodes:** if the node's `parentId` is `null` (root node) and `firstResponderId` is currently `null`, auto-set `firstResponderId` to the node's ID, increment `validationVersion`, and notify subscribers. This ensures the chain always has a first responder once a root responder registers -- no separate `makeFirstResponder` call is needed for the initial root.
- [ ] Implement `unregister(id)` -- removes node from the map. If the unregistered node was the first responder, auto-promote its parent to first responder (walk `parentId`). If the node has no parent, set `firstResponderId` to `null`. Increment `validationVersion` and notify subscribers in either case.
- [ ] Implement `makeFirstResponder(id)` -- sets `firstResponderId`, increments `validationVersion`, notifies subscribers
- [ ] Implement `resignFirstResponder()` -- clears `firstResponderId`, increments `validationVersion`, notifies subscribers
- [ ] Implement `getFirstResponder()` -- returns current `firstResponderId`
- [ ] Implement `dispatch(action)` -- walks chain from first responder upward via `parentId`. For each node, checks the `actions` map only (not the `canHandle` function). If the action key exists in the map, calls the handler and returns true. Continues to parent if not found. Returns false if the root is reached with no match. Note: `dispatch` does not consult the `canHandle` function -- `canHandle` is advisory for validation queries only. Any action that should be dispatchable must have an entry in the `actions` map.
- [ ] Implement `canHandle(action)` -- walks chain from first responder upward. For each node: first check the `actions` map (primary) -- if the key exists, return true. Otherwise check the node's optional `canHandle` function (dynamic override) -- if it returns true, return true. Continue to parent if neither matches. Return false if the root is reached with no match.
- [ ] Implement `validateAction(action)` -- finds the responder via canHandle walk, calls its `validateAction` if present (defaults to true)
- [ ] Implement `subscribe(callback)` / `getValidationVersion()` for `useSyncExternalStore` compatibility
- [ ] Define `ResponderChainContext` (React context holding `ResponderChainManager | null`, default `null`) in `responder-chain.ts` -- co-located with the manager so both `use-responder.ts` and `responder-chain-provider.tsx` can import it without circular dependencies
- [ ] Export `ResponderChainManager`, `ResponderNode` types, and `ResponderChainContext`

**Tests:**
- [ ] Register a node and verify it appears in the manager
- [ ] Unregister a node and verify it is removed
- [ ] Dispatch an action and verify the correct handler is called
- [ ] Chain walk: register parent and child, dispatch from child, verify walk-up to parent if child doesn't handle
- [ ] `canHandle` returns true for registered action, false for unknown action
- [ ] `validateAction` returns handler's validate result
- [ ] `validateAction` returns true by default when handler has no validate function
- [ ] `makeFirstResponder` / `resignFirstResponder` increment validation version
- [ ] Subscription callback fires on version increment
- [ ] Dispatch returns false when no handler found
- [ ] Unregister first responder auto-promotes parent: register parent + child, make child first responder, unregister child, verify parent is now first responder
- [ ] Unregister first responder with no parent sets firstResponderId to null
- [ ] Register root node (parentId null) when firstResponderId is null auto-promotes it to first responder
- [ ] Register root node when firstResponderId is already set does not change firstResponderId
- [ ] Register non-root node (parentId non-null) when firstResponderId is null does not auto-promote

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test responder-chain.test`

---

#### Step 2: Implement useResponder hook {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugways): implement useResponder hook with nested context`

**References:** [D02] useResponder uses nested context for parent discovery, Spec S02, (#api-surface, #terminology)

**Artifacts:**
- `tugdeck/src/components/tugways/use-responder.tsx` -- new file (`.tsx` because the returned `ResponderScope` component contains JSX)
- `tugdeck/src/__tests__/use-responder.test.tsx` -- new file

**Tasks:**
- [ ] Create `use-responder.tsx` with `ResponderParentContext` (React context holding current parent responder ID, default `null`)
- [ ] Implement `useResponder(options)` hook:
  - Read `ResponderChainManager` from `ResponderChainContext` (imported from `responder-chain.ts`, provided at runtime by `ResponderChainProvider` in step 3). **Null-manager guard:** If the context value is null (meaning `useResponder` was called outside a `ResponderChainProvider`), throw a descriptive error: `"useResponder must be used inside a <ResponderChainProvider>"`. This is a programming error -- unlike `useResponderChain` (which returns null safely for TugButton's optional chain-action mode), `useResponder` is always called by components that intend to register as responders, so null is never a valid runtime state.
  - Read parent responder ID from `ResponderParentContext`
  - On mount: call `manager.register({ id: options.id, parentId, actions: options.actions, canHandle: options.canHandle, validateAction: options.validateAction })`
  - On unmount: call `manager.unregister(options.id)`
  - Use refs for all mutable state to avoid re-renders
  - **Stable ResponderScope identity:** Create the `ResponderScope` component via `useMemo(() => ({ children }: { children: React.ReactNode }) => <ResponderParentContext.Provider value={options.id}>{children}</ResponderParentContext.Provider>, [options.id])`. This ensures the component function has a stable identity across renders (React will not unmount/remount children on re-render of the parent). The memo depends only on `options.id`, which should be a stable string literal for each call site. If `useMemo` is insufficient (e.g., strict-mode double-invocation concerns), use a `useRef` to hold the component function and only create it once.
  - Return `{ ResponderScope }` -- the memoized component that provides this responder's ID via `ResponderParentContext.Provider`
- [ ] Export `useResponder`, `ResponderParentContext`, `UseResponderOptions`

**Tests:**
- [ ] Mount a component using `useResponder` inside a mock `ResponderChainContext.Provider` -- verify register is called
- [ ] Unmount the component -- verify unregister is called
- [ ] Nest two components each using `useResponder` -- verify the child's parentId is the parent's ID
- [ ] Three-level nesting: grandparent > parent > child -- verify chain links are correct
- [ ] Verify that mounting and unmounting does not cause re-renders in sibling components
- [ ] Verify that ResponderScope has stable identity across re-renders: render a component using useResponder, force a re-render, verify that children of ResponderScope are not unmounted/remounted
- [ ] Calling `useResponder` outside a `ResponderChainProvider` (no `ResponderChainContext.Provider` in tree) throws a descriptive error

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test use-responder.test`

---

#### Step 3: Implement ResponderChainProvider and key pipeline {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tugways): implement ResponderChainProvider and four-stage key pipeline`

**References:** [D03] Four-stage key pipeline with global keydown listener, [D04] Minimal static keybinding map, [D07] ResponderChainProvider wraps DeckCanvas only, Spec S03, Spec S05, Spec S08, Table T02, (#internal-architecture, #api-surface)

**Artifacts:**
- `tugdeck/src/components/tugways/responder-chain-provider.tsx` -- new file
- `tugdeck/src/components/tugways/keybinding-map.ts` -- new file
- `tugdeck/src/__tests__/key-pipeline.test.tsx` -- new file

**Tasks:**
- [ ] Create `responder-chain-provider.tsx`:
  - Import `ResponderChainContext` from `responder-chain.ts` (defined in step 1)
  - Implement `ResponderChainProvider` component: creates a `ResponderChainManager` instance via `useRef`, provides it via `ResponderChainContext`
  - Install two `keydown` event listeners on `document` in a single `useEffect`. The cleanup function removes both listeners on unmount.
    - **Capture-phase listener** (`{ capture: true }`): handles stage 1 only. Calls `matchKeybinding(event)` -- if match, calls `manager.dispatch(action)`. If dispatch returns true, calls `preventDefault()` and `stopImmediatePropagation()` (prevents the bubble-phase listener from seeing the event). If dispatch returns false, does nothing (event continues normally).
    - **Bubble-phase listener** (default, no capture flag): handles stages 2-4. Components lower in the tree can `stopPropagation()` to prevent events from reaching this listener.
      - Stage 2: keyboard navigation -- no-op in Phase 3 (defer to browser)
      - Stage 3: if event.target is not an input/textarea/select/contenteditable, attempt chain dispatch for unmapped keys (stub for Phase 3)
      - Stage 4: passthrough (implicit)
  - The bubble-phase listener checks `event.target`: skips stages 3-4 if the target's tagName is `INPUT`, `TEXTAREA`, or `SELECT`, or if `(event.target as HTMLElement).isContentEditable` is true. This future-proofs the pipeline for contenteditable elements used by rich text editors.
  - Implement `useResponderChain()` convenience hook -- returns `ResponderChainManager | null`. Returns `null` when called outside a `ResponderChainProvider` (safe for components like TugButton that may render both inside and outside the chain scope). This is the hook TugButton uses.
  - Implement `useRequiredResponderChain()` convenience hook -- returns `ResponderChainManager` and throws if called outside a provider. This is the hook for components that must be inside the chain scope.
- [ ] Create `keybinding-map.ts`:
  - Define `KeyBinding` interface and `KEYBINDINGS` array
  - Add `Ctrl+Backquote` -> `cyclePanel` binding
  - Implement `matchKeybinding(event: KeyboardEvent): string | null` -- returns action name or null

**Tests:**
- [ ] ResponderChainProvider renders children and provides manager via context
- [ ] `useResponderChain()` returns the manager inside the provider
- [ ] `useResponderChain()` returns `null` outside the provider (does not throw)
- [ ] `useRequiredResponderChain()` throws outside the provider
- [ ] Key pipeline: Ctrl+` triggers `cyclePanel` dispatch via capture-phase listener and calls `preventDefault` + `stopImmediatePropagation` when dispatch returns true
- [ ] Key pipeline: matched keybinding where dispatch returns false (no handler) does not call `preventDefault` and event reaches bubble-phase listener
- [ ] Key pipeline: unmatched key does not trigger dispatch
- [ ] Key pipeline: typing in an input element does not trigger dispatch for non-global-shortcut keys
- [ ] Key pipeline: Ctrl+` still works even when an input element is focused (global shortcut takes priority)
- [ ] `matchKeybinding` returns correct action for matching key event
- [ ] `matchKeybinding` returns null for non-matching key event

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test key-pipeline.test`

---

#### Step 4: Add chain-action mode to TugButton {#step-4}

**Depends on:** #step-1, #step-3

**Commit:** `feat(tugways): add chain-action mode to TugButton`

**References:** [D05] Two-level action validation, [D06] Chain-action TugButton uses useSyncExternalStore, Spec S04, (#api-surface, #action-vocabulary-phase3)

**Artifacts:**
- `tugdeck/src/components/tugways/tug-button.tsx` -- modified (add `action` prop and chain-action logic)
- `tugdeck/src/__tests__/chain-action-button.test.tsx` -- new file

**Tasks:**
- [ ] Add `action?: string` prop to `TugButtonProps` interface
- [ ] Import `useResponderChain` from `responder-chain-provider.tsx`
- [ ] **All hooks are called unconditionally on every render** (React rules of hooks). The hooks are not gated on whether `action` is defined:
  - Call `useResponderChain()` unconditionally at the top of the component -- returns `ResponderChainManager | null`. When `action` is undefined or manager is null, the hook result is simply unused.
  - Call `useSyncExternalStore()` unconditionally. When manager is null or `action` is undefined, pass **module-level constant** no-op functions to avoid re-subscribe churn: define `const NOOP_SUBSCRIBE = (_cb: () => void) => () => {};` and `const NOOP_SNAPSHOT = () => 0;` at the top of `tug-button.tsx` (outside the component). Pass these stable references to `useSyncExternalStore` when the chain is inactive. This ensures React never sees new function identities and never triggers unnecessary re-subscriptions.
- [ ] **Conditional behavior is computed from hook results, not by skipping hook calls:**
  - After the unconditional hooks, compute a `isChainDisabled` boolean: true when `action` is defined, manager is available, `canHandle(action)` is true, but `validateAction(action)` is false.
  - If `action` is defined and manager is not null:
    - Call `manager.canHandle(action)` -- if false, return null (button hidden)
    - Call `manager.validateAction(action)` -- if false, set `aria-disabled="true"` and apply disabled visual styling via CSS class
    - **Click prevention for disabled chain-action buttons:** in the `handleClick` function, check `isChainDisabled` first -- if true, return early without dispatching. This prevents clicks on `aria-disabled` buttons from reaching `manager.dispatch()`. (Note: `aria-disabled` does not prevent click events the way the HTML `disabled` attribute does -- the click handler must guard explicitly.)
    - On click (when enabled): call `manager.dispatch(action)` instead of `onClick`
  - If `action` is undefined or manager is null, fall through to direct-action mode (existing onClick behavior)
- [ ] Ensure `action` and `onClick` are mutually exclusive (dev-mode warning if both set)
- [ ] Add CSS rules to `tug-button.css` targeting `[aria-disabled='true']` that mirror the existing `:disabled` visual treatment (reduced opacity, `cursor: not-allowed`) so chain-action disabled buttons look the same as HTML-disabled buttons but remain in the tab order. Additionally, suppress hover and active visual states for `[aria-disabled='true']` buttons: for each variant class (`.tug-button-primary`, `.tug-button-secondary`, `.tug-button-ghost`, `.tug-button-destructive`), add rules like `.tug-button-primary[aria-disabled='true']:hover { filter: none; border-color: var(--td-border); }` and `.tug-button-primary[aria-disabled='true']:active { transform: none; }` so that disabled chain-action buttons do not respond visually to hover or press. Alternatively, add a blanket guard to existing hover/active rules: change `:not(:disabled):hover` to `:not(:disabled):not([aria-disabled='true']):hover` throughout `tug-button.css`.
- [ ] Update component header comment to document Phase 3 chain-action mode

**Tests:**
- [ ] Chain-action button renders when `canHandle` returns true
- [ ] Chain-action button is hidden (returns null) when `canHandle` returns false
- [ ] Chain-action button is visually disabled when `validateAction` returns false
- [ ] Chain-action button is enabled when `validateAction` returns true
- [ ] Click on enabled chain-action button calls `manager.dispatch(action)`
- [ ] Click on disabled chain-action button does not dispatch
- [ ] Button re-renders when validation version changes (e.g., focus change)
- [ ] Dev-mode warning when both `action` and `onClick` are set
- [ ] TugButton without `action` prop (direct-action mode) still works as before
- [ ] TugButton with `action` prop rendered outside ResponderChainProvider falls through to inert state (no crash, no dispatch)
- [ ] Chain-action disabled button has `aria-disabled="true"` attribute (not HTML `disabled`) and remains in tab order
- [ ] CSS `[aria-disabled='true']` rules apply reduced opacity and `cursor: not-allowed` matching `:disabled` visual treatment
- [ ] CSS `[aria-disabled='true']` hover/active states are suppressed (no filter change, no transform, no border-color change on hover)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test chain-action-button.test`

---

#### Step 5: Wire DeckCanvas as a responder {#step-5}

**Depends on:** #step-2, #step-3

**Commit:** `feat(tugways): wire DeckCanvas as root responder`

**References:** [D07] ResponderChainProvider wraps DeckCanvas only, [D08] Gallery responder uses well-known string ID, Spec S01, Table T01, (#internal-architecture, #action-vocabulary-phase3)

**Artifacts:**
- `tugdeck/src/components/chrome/deck-canvas.tsx` -- modified (add `useResponder` registration)
- `tugdeck/src/deck-manager.ts` -- modified (insert `ResponderChainProvider` in render tree)

**Tasks:**
- [ ] Modify `DeckManager.render()` to insert `ResponderChainProvider` between `ErrorBoundary` and `DeckCanvas`. Note: `DeckManager.render()` uses `React.createElement()` calls (not JSX) because it is a plain TypeScript class, not a `.tsx` file. The provider insertion follows the existing nesting pattern: `React.createElement(ResponderChainProvider, null, React.createElement(DeckCanvas, { ref, connection }))` nested inside the ErrorBoundary createElement call.
  - Tree becomes: `TugThemeProvider > ErrorBoundary > ResponderChainProvider > DeckCanvas`
- [ ] In `DeckCanvas` (a `forwardRef` component), add `useResponder` call. **Hook ordering:** `useState(galleryVisible)` must come first so `setGalleryVisible` is available for the action closures. Then `useResponder` (actions directly close over `setGalleryVisible` -- no ref workaround needed since React guarantees state setters are stable across renders). Then `useImperativeHandle`. Then `useEffect(registerGallerySetter)`. The hook order becomes: `useState(galleryVisible)` -> `useResponder` -> `useImperativeHandle` -> `useEffect(registerGallerySetter)`.
  - `id: "deck-canvas"`
  - `actions: { cyclePanel: () => { /* cycle logic or log stub */ }, resetLayout: () => { /* stub */ }, showSettings: () => { console.log('showSettings: stub -- not implemented until Phase 8') }, showComponentGallery: () => { setGalleryVisible(prev => !prev) } }`
  - The action handlers close directly over `setGalleryVisible` which is a stable function identity (React useState setter guarantee). No ref indirection is needed.
  - **Rules-of-hooks compliance:** this hook reordering is a one-time change from the Phase 2 order. The new order (`useState` -> `useResponder` -> `useImperativeHandle` -> `useEffect`) is fixed and unconditional -- all hooks are called on every render in the same order, satisfying React's rules of hooks. The `actions` object passed to `useResponder` is captured at registration time via the hook's internal `useEffect` mount callback, so the stable `setGalleryVisible` setter inside the closures is sufficient for the lifetime of the registration.
- [ ] Wrap DeckCanvas's returned JSX in the `ResponderScope` component. The JSX changes from `<>...</>` to `<ResponderScope><DisconnectBanner ... />{galleryVisible && <ComponentGallery ... />}</ResponderScope>`.
- [ ] `cyclePanel` action handler: in Phase 3, log to console (no real panels to cycle to); the key pipeline will call this via Ctrl+`. Note: DeckCanvas automatically becomes the first responder when it registers as a root node (parentId null, per Spec S01 auto-first-responder behavior), so Ctrl+` works immediately after mount without any explicit `makeFirstResponder` call.
- [ ] `showComponentGallery` action handler: toggle the gallery visibility state via the same `setGalleryVisible` React state setter
- [ ] **Reconcile dual toggle mechanisms:** The existing `action-dispatch.ts` `show-component-gallery` handler uses `gallerySetterRef` to toggle gallery visibility from Mac menu control frames. The new `showComponentGallery` responder chain action toggles the same state from within the chain. Both paths converge on the same `setGalleryVisible` state setter in DeckCanvas. Keep both paths operational: the `action-dispatch.ts` handler remains for Mac menu control frames (which arrive outside the responder chain), and the chain action handles keyboard shortcuts and chain-action buttons. No removal of the existing handler is needed -- they are complementary entry points to the same state.

**Tests:**
- [ ] DeckCanvas registers as responder "deck-canvas" on mount and is auto-promoted to first responder (root node with no prior first responder)
- [ ] DeckCanvas responder handles `cyclePanel` action
- [ ] DeckCanvas responder handles `showComponentGallery` action
- [ ] Ctrl+` keyboard shortcut triggers `cyclePanel` via key pipeline (integration test with rendered DeckCanvas inside ResponderChainProvider)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 6: Wire Component Gallery as a responder {#step-6}

**Depends on:** #step-5

**Commit:** `feat(tugways): wire Component Gallery as responder with focus management`

**References:** [D08] Gallery responder uses well-known string ID, [D02] useResponder uses nested context, Spec S02, Table T01, (#internal-architecture, #action-vocabulary-phase3)

**Artifacts:**
- `tugdeck/src/components/tugways/component-gallery.tsx` -- modified (add `useResponder` registration and focus management)

**Tasks:**
- [ ] In `ComponentGallery`, call `useResponder` with:
  - `id: "component-gallery"`
  - `actions: {}` (no gallery-specific actions in Phase 3; the gallery is a passive responder that receives focus)
- [ ] Wrap the gallery's JSX in the returned `ResponderScope`
- [ ] On mount (via `useEffect`): call `manager.makeFirstResponder("component-gallery")` to make the gallery the first responder
- [ ] On unmount (handled by `useResponder` cleanup): `manager.unregister("component-gallery")` is called. Because the gallery was the first responder and its `parentId` is `"deck-canvas"`, the manager's unregister auto-promotion logic (per Spec S01) sets `firstResponderId` to `"deck-canvas"`. This ensures DeckCanvas automatically becomes the first responder when the gallery is hidden -- no explicit `resignFirstResponder` call is needed.
- [ ] Verify that when gallery is shown, it becomes the first responder; when hidden, DeckCanvas becomes the first responder via auto-promotion

**Tests:**
- [ ] Gallery registers as responder "component-gallery" on mount
- [ ] Gallery calls `makeFirstResponder` on mount
- [ ] Gallery unregisters on unmount, first responder auto-promotes to "deck-canvas" (not null)
- [ ] With gallery focused: `canHandle("cyclePanel")` returns true (walks up to DeckCanvas parent)
- [ ] Key pipeline dispatches work correctly when gallery is the first responder

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 7: Add chain-action TugButton to Component Gallery {#step-7}

**Depends on:** #step-4, #step-6

**Commit:** `feat(tugways): add chain-action TugButton demo to Component Gallery`

**References:** [D06] Chain-action TugButton uses useSyncExternalStore, Spec S04, Table T01, (#action-vocabulary-phase3)

**Artifacts:**
- `tugdeck/src/components/tugways/component-gallery.tsx` -- modified (add chain-action button demo section)

**Tasks:**
- [ ] Add a new "Chain-Action Buttons" section to the Component Gallery below the existing TugButton sections
- [ ] Add a chain-action TugButton with `action="cyclePanel"` labeled "Cycle Panel"
- [ ] Add a chain-action TugButton with `action="showComponentGallery"` labeled "Toggle Gallery"
- [ ] Add a chain-action TugButton with `action="nonexistentAction"` to demonstrate hidden behavior (canHandle returns false)
- [ ] Verify visually that the chain-action buttons reflect the correct enabled/disabled state based on the current chain

**Tests:**
- [ ] Chain-action "Cycle Panel" button is visible and enabled when DeckCanvas responder is registered
- [ ] Chain-action "nonexistentAction" button is hidden (not rendered)
- [ ] Click on "Cycle Panel" dispatches the `cyclePanel` action

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 8: Integration Checkpoint {#step-8}

**Depends on:** #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] ResponderChainManager is a plain TypeScript class, [D03] Four-stage key pipeline, [D05] Two-level action validation, [D07] ResponderChainProvider wraps DeckCanvas only, (#success-criteria, #internal-architecture)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-7 are complete and work together
- [ ] Verify the render tree is: TugThemeProvider > ErrorBoundary > ResponderChainProvider > DeckCanvas
- [ ] Verify the chain tree is: component-gallery (when visible) -> deck-canvas -> null (root)
- [ ] Verify Ctrl+` triggers cyclePanel action end-to-end
- [ ] Verify chain-action TugButton in gallery shows correct enabled/disabled state
- [ ] Verify gallery focus lifecycle: show gallery -> gallery becomes first responder -> hide gallery -> first responder auto-promotes to deck-canvas
- [ ] Verify no React re-render cascade when focus changes (manager operates outside React state)

**Tests:**
- [ ] Full integration test: render DeckCanvas with ResponderChainProvider, show gallery, verify chain structure, press Ctrl+`, verify action dispatched
- [ ] Full integration test: render chain-action button, change first responder, verify button re-renders with updated validation

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] All tests pass with zero failures

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Responder chain infrastructure with key pipeline, action validation, chain-action TugButton mode, and DeckCanvas + gallery responder wiring -- proving the event routing architecture works end-to-end before cards are built in Phase 5.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] ResponderChainManager registers/unregisters responders, dispatches actions through chain walk, validates with two-level canHandle + validateAction (`bun test` passes)
- [ ] useResponder hook auto-discovers parent via nested context and manages registration lifecycle (`bun test` passes)
- [ ] Four-stage key pipeline routes Ctrl+` to cyclePanel action (`bun test` passes)
- [ ] Chain-action TugButton subscribes to validation, shows/hides based on canHandle, enables/disables based on validateAction (`bun test` passes)
- [ ] DeckCanvas is a root responder handling canvas-level actions (`bun test` passes)
- [ ] Component Gallery registers as a focused responder on show, deregisters on hide (`bun test` passes)
- [ ] All existing tests continue to pass (`bun test` passes with zero failures)

**Acceptance tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` passes with zero failures
- [ ] Manual: app loads, Ctrl+` logs cyclePanel action, gallery shows chain-action buttons with correct states

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Card-level responders (Phase 5: Tugcard registers as responder, card content registers as child)
- [ ] Modal boundaries / `modalScope` flag (Phase 8: app-modal and card-modal dialogs)
- [ ] Full keybindings view (Concept 14: user-visible keybinding display and customization)
- [ ] Keyboard navigation stage (Tab/Shift+Tab between cards/controls)
- [ ] Action dispatch from text input stage (stage 4 integration with text fields)
- [ ] Fine-grained validation notifications (within-card state changes trigger button updates)
- [ ] Action update mechanism for useResponder (Phase 5: add `updateActions(id, newActions)` to ResponderChainManager so useResponder can update a responder's actions map when the actions option changes after mount -- needed when card content dynamically adds/removes capabilities)

| Checkpoint | Verification |
|------------|--------------|
| ResponderChainManager unit tests pass | `bun test responder-chain.test` |
| useResponder hook tests pass | `bun test use-responder.test` |
| Key pipeline tests pass | `bun test key-pipeline.test` |
| Chain-action TugButton tests pass | `bun test chain-action-button.test` |
| Full test suite passes | `bun test` |
