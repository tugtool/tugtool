<!-- tugplan-skeleton v2 -->

## Tugways Phase 5d4: Observable Properties {#observable-properties}

**Purpose:** Cards expose inspectable properties via a typed key-path PropertyStore. Inspectors discover, read, write, and observe properties without importing card internals. PropertyStore integrates with `useSyncExternalStore` for targeted React re-renders.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5d4-observable-properties |
| Last updated | 2026-03-06 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Inspectors and card content need to stay in sync without tight coupling. When a card has editable properties (background color, font size, font family), an inspector panel needs to read and write those properties without importing the card's internals. Today there is no shared property model — each card manages its own state independently.

This is the KVC/KVO problem from Apple's Cocoa framework: key-value coding provides uniform property access by string path, and key-value observing provides change notification without explicit delegation. The tugways equivalent needs to work with the three-zone mutation model and `useSyncExternalStore`. Phase 5d4 is the capstone of the 5d sub-phases, building on explicit-target dispatch (Phase 5d2) and mutation transactions (Phase 5d3) to establish the full inspector pipeline.

#### Strategy {#strategy}

- Build PropertyStore as a standalone class first — no React dependencies in the core, pure TypeScript with get/set/observe/schema
- Wire useSyncExternalStore compatibility into PropertyStore.observe() from the start — the subscribe signature must match React's contract (callback-in, unsubscribe-out)
- Implement usePropertyStore hook as a thin bridge: creates a store, registers it with Tugcard via context callback, returns the store instance
- Add a TugcardPropertyContext to Tugcard for store registration — card content calls the context callback on mount, Tugcard exposes the registered store to the responder chain
- Wire setProperty action handler in Tugcard's responder node — routes incoming property-write actions to the card content's registered PropertyStore
- Build a self-contained gallery demo as the eighth tab that proves the full round-trip: schema discovery, property reading, property writing via dispatchTo, observer notification, source attribution

#### Success Criteria (Measurable) {#success-criteria}

- PropertyStore.get(path) returns the current value for any schema-valid path; throws for invalid paths (unit test)
- PropertyStore.set(path, value, source) updates the stored value, fires observers with correct PropertyChange record including source and transactionId (unit test)
- PropertyStore.observe(path, listener) returns an unsubscribe function; after unsubscribe, listener no longer fires (unit test)
- useSyncExternalStore(cb => store.observe(path, cb), () => store.get(path)) triggers a React re-render only when the observed path's value changes — not when other paths change (gallery demo verification)
- Inspector demo: editing a control dispatches setProperty via dispatchTo to the target card content's responder, the PropertyStore updates, and the target element's appearance changes (gallery demo verification)
- Source attribution: when an observer receives a change with the same source it originated, it can skip re-dispatch — no infinite loops (gallery demo verification)
- Gallery tab "Observable Props" loads correctly as the eighth tab in Component Gallery (manual verification)

#### Scope {#scope}

1. PropertyStore class with typed schema, get/set/observe, change records
2. PropertySchema and PropertyDescriptor types
3. usePropertyStore hook with context-callback registration
4. TugcardPropertyContext in Tugcard for store wiring
5. setProperty action handler in Tugcard's responder node
6. Gallery demo: observable-props tab with color, fontSize, fontFamily properties and inspector panel
7. New gallery tab registration as eighth tab in GALLERY_DEFAULT_TABS

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full inspector panel UI (Phase 8e) — the gallery demo is a minimal proof-of-concept
- Feed data bridging into PropertyStore — deferred to Phase 6/7 integration
- Nested object property types (e.g., point.x subpath access) — flat key-path strings only
- Tugbank persistence of property values — deferred to Phase 5e/5f
- Transaction-based live preview in the gallery demo — the demo uses direct set() calls, not MutationTransaction preview cycles

#### Dependencies / Prerequisites {#dependencies}

- Phase 5d2 (Target/Action Control Model) — COMPLETE: provides dispatchTo for inspector-to-card action routing
- Phase 5d3 (Mutation Transactions) — COMPLETE: provides MutationTransaction infrastructure; PropertyStore change records include optional transactionId for future live-preview integration
- Tugcard composition component — COMPLETE: provides the responder node and context provider pattern to extend

#### Constraints {#constraints}

- Must follow Rules of Tugways: no root.render() calls, useSyncExternalStore for external state, useLayoutEffect for registrations, appearance changes through CSS/DOM
- PropertyStore.observe() signature must be directly usable as useSyncExternalStore's subscribe argument: `(callback: () => void) => () => void`
- No React state changes during continuous property-edit gestures in the gallery demo (Rule #9)
- Controls emit actions, responders handle actions (Rule #10)

#### Assumptions {#assumptions}

- PropertyStore, PropertySchema, and PropertyDescriptor are implemented in a new file at `tugdeck/src/components/tugways/property-store.ts`, consistent with `mutation-transaction.ts` placement
- usePropertyStore is implemented in a new file at `tugdeck/src/components/tugways/hooks/use-property-store.ts`, consistent with the existing hooks/ directory structure
- The setProperty action's value payload shape is `{ path: string, value: unknown }` as documented in the design-system-concepts.md inspector actions table
- The gallery demo element is a new self-contained styled div (not reusing the mutation-tx mock card element), so the two demos are visually and logically independent
- No new CSS file is needed beyond what already exists in gallery-card.css — the existing `.cg-*` class recipes are sufficient for the inspector demo layout
- The new gallery tab is an eighth tab appended to GALLERY_DEFAULT_TABS with componentId `gallery-observable-props`, following the exact pattern of the mutation-tx tab
- The store owns values internally; onGet/onSet are optional override callbacks for bridging to external state (e.g., feed data, tugbank)
- The store always notifies all observers; each observer checks event.source and skips updates it originated (same pattern as the existing mutation demo)

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit, named anchors and rich `References:` lines per the skeleton contract. All anchors are kebab-case, lowercase, no phase numbers. Decision anchors use `dNN-...` prefix; spec anchors use `sNN-...`; step anchors use `step-N`.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All design decisions are resolved in design-system-concepts.md Concept 21, and user answers have clarified the three implementation choices (store wiring, storage model, circular guard).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| useSyncExternalStore snapshot instability | med | low | Cache get() return values; only replace reference when value actually changes | Spurious re-renders in gallery demo |
| Circular observer notification loops | high | low | Source attribution on every change record; demo verifies no infinite loops | Observer callback stack overflow or visible UI jitter |

**Risk R01: Snapshot instability with useSyncExternalStore** {#r01-snapshot-instability}

- **Risk:** If PropertyStore.get() returns a new object reference on every call (even when the value has not changed), useSyncExternalStore will trigger unnecessary re-renders.
- **Mitigation:** Store caches values internally and returns the same reference for unchanged values. Primitive values (string, number, boolean) are compared by value; object values are replaced only on actual change.
- **Residual risk:** Deep object equality is not checked — only reference identity. For this phase, all property types are primitives, so this is not a concern.

**Risk R02: Circular observer notification** {#r02-circular-notification}

- **Risk:** An inspector writes a property, the store notifies the card content observer, which re-dispatches the change back to the store, creating an infinite loop.
- **Mitigation:** Every PropertyChange record includes a `source` field. Observers check the source and skip re-dispatch when they originated the change. The gallery demo explicitly verifies this pattern.
- **Residual risk:** A third-party observer that ignores source attribution could still create loops. This is a documentation/convention concern, not a code concern.

---

### Design Decisions {#design-decisions}

#### [D01] Context callback registration for PropertyStore (DECIDED) {#d01-context-callback}

**Decision:** Tugcard provides a `TugcardPropertyContext` with a registration callback. Card content calls `usePropertyStore()`, which internally calls the context callback on mount to install the store. This mirrors the TugcardDataContext pattern.

**Rationale:**
- Consistent with existing Tugcard context patterns (TugcardDataContext, ResponderScope)
- Card content controls when and what properties to expose
- Tugcard can expose the registered store to the responder chain for setProperty routing without importing card internals

**Implications:**
- Tugcard must create and provide the TugcardPropertyContext
- The context value is a registration callback `(store: PropertyStore) => void`
- usePropertyStore calls the callback in useLayoutEffect (Rule #3) so the store is available before events fire

#### [D02] Store owns values with optional callbacks (DECIDED) {#d02-store-owns-values}

**Decision:** PropertyStore owns property values internally in a `Map<string, unknown>`. Optional `onGet` and `onSet` callbacks allow bridging to external state (DOM, feed data, tugbank) when needed.

**Rationale:**
- Self-contained store is simpler to test and reason about
- Optional callbacks provide an escape hatch for future phases where properties are backed by external systems
- Matches the user's stated preference for "owns values + optional callbacks"

**Implications:**
- Default get() reads from the internal map; if onGet is provided, it overrides
- Default set() writes to the internal map and fires observers; if onSet is provided, it is called after the internal write
- Schema validation happens in both paths

#### [D03] Observer-side circular guard (DECIDED) {#d03-observer-circular-guard}

**Decision:** The store always notifies all observers on every set(). Each observer is responsible for checking `change.source` and deciding whether to act. The store does not filter notifications by source.

**Rationale:**
- Matches the existing mutation-tx demo pattern where source attribution is observer-side
- Simpler store implementation — no source-tracking bookkeeping in the notification path
- Allows flexible policies: some observers may want to see all changes regardless of source

**Implications:**
- Every set() call must include a source string
- Observers that bridge to other systems (e.g., inspector updating a control) must check source to avoid re-dispatch
- Gallery demo must demonstrate correct source-checking pattern

#### [D04] setProperty action routed through Tugcard responder (DECIDED) {#d04-set-property-action}

**Decision:** Tugcard registers a `setProperty` action handler in its responder node. When a `setProperty` action arrives (via dispatchTo from an inspector), Tugcard routes it to the card content's registered PropertyStore.

**Rationale:**
- Inspectors do not import card content code — they dispatch actions through the responder chain
- Tugcard already owns the responder node for the card; adding setProperty is a natural extension
- The registered PropertyStore is available to Tugcard via the context callback from [D01]

**Implications:**
- setProperty action payload: `{ path: string, value: unknown, source?: string }`
- Tugcard reads the registered PropertyStore from a ref (set by the context callback)
- If no PropertyStore is registered, setProperty is a no-op (card does not support inspection)

#### [D05] Per-path observe for useSyncExternalStore (DECIDED) {#d05-per-path-observe}

**Decision:** PropertyStore.observe(path, listener) subscribes to changes on a single path. For useSyncExternalStore compatibility, observe() also accepts a plain `() => void` callback (no PropertyChange argument) and returns an unsubscribe function. This dual signature allows both detailed change observation and React subscription.

**Rationale:**
- useSyncExternalStore requires `subscribe: (callback: () => void) => () => void`
- Per-path subscription means React re-renders only for the specific property being displayed
- The detailed PropertyChangeListener signature is still available for non-React observers that need source/oldValue/newValue

**Implications:**
- observe() accepts `PropertyChangeListener | (() => void)` and returns `() => void`
- No runtime type discrimination needed: the store always calls every observer with the PropertyChange record as the first argument. Plain `() => void` callbacks simply ignore the extra argument (JavaScript allows this)
- Implementation: internally the store maintains a `Map<string, Set<Function>>` of listeners per path
- get() must return stable references for unchanged values (Risk R01 mitigation)

---

### Specification {#specification}

#### Spec S01: PropertyStore API {#s01-property-store-api}

```typescript
interface PropertyStore {
  get(path: string): unknown;
  set(path: string, value: unknown, source: string): void;
  observe(path: string, listener: PropertyChangeListener | (() => void)): () => void;
  getSchema(): PropertySchema;
}
```

- `get(path)`: Returns the current value for the given path. Throws if path is not in the schema. Returns stable references for unchanged values.
- `set(path, value, source)`: Updates the value at the given path. Validates against schema constraints (type, min/max, enumValues, readOnly). For number properties with min/max, values are clamped to the valid range (not rejected). For enum properties, invalid values throw. Fires all observers for that path with a PropertyChange record. Throws if path is not in the schema or if the property is readOnly.
- `observe(path, listener)`: Subscribes to changes on the given path. Returns an unsubscribe function. The store always calls every observer with the PropertyChange record as the first argument. Plain `() => void` callbacks simply ignore the argument — JavaScript allows calling a zero-arity function with extra arguments, so no runtime type discrimination is needed. This makes observe() directly usable as useSyncExternalStore's subscribe function while also supporting detailed PropertyChangeListener observers.
- `getSchema()`: Returns the PropertySchema describing all available paths and their types.

#### Spec S02: PropertySchema and PropertyDescriptor {#s02-property-schema}

```typescript
interface PropertySchema {
  paths: PropertyDescriptor[];
}

interface PropertyDescriptor {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'point' | 'enum';
  label: string;
  enumValues?: string[];
  min?: number;
  max?: number;
  readOnly?: boolean;
}
```

#### Spec S03: PropertyChange record {#s03-property-change}

```typescript
interface PropertyChange {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  source: string;
  transactionId?: string;
}

type PropertyChangeListener = (change: PropertyChange) => void;
```

#### Spec S04: usePropertyStore hook {#s04-use-property-store}

```typescript
function usePropertyStore(options: {
  schema: PropertyDescriptor[];
  initialValues: Record<string, unknown>;
  onGet?: (path: string) => unknown;
  onSet?: (path: string, value: unknown, source: string) => void;
}): PropertyStore;
```

- Creates a PropertyStore instance on first render (useRef)
- Registers the store with Tugcard via TugcardPropertyContext callback in useLayoutEffect
- Returns the stable store instance

#### Spec S05: TugcardPropertyContext {#s05-tugcard-property-context}

```typescript
type PropertyStoreRegistrar = (store: PropertyStore) => void;
const TugcardPropertyContext = createContext<PropertyStoreRegistrar | null>(null);
```

- Tugcard creates a registration callback that stores the PropertyStore in a ref
- The ref is read by the setProperty action handler
- Exported from the hooks barrel for use by usePropertyStore

#### Spec S06: setProperty action payload {#s06-set-property-action}

```typescript
// ActionEvent for setProperty:
{
  action: 'setProperty',
  value: {
    path: string;
    value: unknown;
    source?: string;  // defaults to 'inspector' if omitted
  }
}
```

#### Spec S07: Gallery demo tab registration {#s07-gallery-demo}

- componentId: `gallery-observable-props`
- Title: `Observable Props`
- Appended as eighth entry in GALLERY_DEFAULT_TABS
- Content component: `GalleryObservablePropsContent` exported from `gallery-observable-props-content.tsx`
- Demo properties: `style.backgroundColor` (color), `style.fontSize` (number, min: 8, max: 72), `style.fontFamily` (enum: system-ui, monospace, serif)

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/property-store.ts` | PropertyStore class, PropertySchema, PropertyDescriptor, PropertyChange types |
| `tugdeck/src/components/tugways/hooks/use-property-store.ts` | usePropertyStore hook with context registration |
| `tugdeck/src/components/tugways/cards/gallery-observable-props-content.tsx` | Gallery demo: inspector panel + target element |
| `tugdeck/src/__tests__/property-store.test.ts` | Unit tests for PropertyStore |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `PropertyStore` | class | `property-store.ts` | Core typed key-value store with observe |
| `PropertySchema` | interface | `property-store.ts` | Schema type with paths array |
| `PropertyDescriptor` | interface | `property-store.ts` | Per-property type/label/constraints |
| `PropertyChange` | interface | `property-store.ts` | Change record with source attribution |
| `PropertyChangeListener` | type | `property-store.ts` | Callback type for observers |
| `usePropertyStore` | function | `hooks/use-property-store.ts` | Hook: creates store, registers with context |
| `TugcardPropertyContext` | context | `hooks/use-property-store.ts` | React context for store registration callback |
| `GalleryObservablePropsContent` | function | `gallery-observable-props-content.tsx` | Gallery tab demo component; accepts `cardId` prop for dispatchTo |
| `setProperty` | action handler | `tugcard.tsx` | New action in Tugcard's useResponder actions |
| `GALLERY_DEFAULT_TABS` | const (modified) | `gallery-card.tsx` | Eighth entry added |

---

### Documentation Plan {#documentation-plan}

- [ ] JSDoc comments on all exported symbols in property-store.ts citing D67, D68, D69
- [ ] JSDoc on usePropertyStore citing D01 (context callback), Spec S04
- [ ] Module-level doc comment on gallery-observable-props-content.tsx describing the demo purpose
- [ ] Update hooks/index.ts barrel to export usePropertyStore and TugcardPropertyContext

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test PropertyStore get/set/observe/schema in isolation | Core logic, constraint validation, observer lifecycle |
| **Integration** | Test usePropertyStore + Tugcard context wiring | Hook registration, setProperty action routing |
| **Visual** | Gallery demo: manual verification of round-trip property editing | Inspector reads match card state, writes update card, source attribution works |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Implement PropertyStore class and types {#step-1}

**Commit:** `feat(tugways): implement PropertyStore class with typed schema and observation`

**References:** [D02] Store owns values with optional callbacks, [D03] Observer-side circular guard, [D05] Per-path observe for useSyncExternalStore, Spec S01, Spec S02, Spec S03, (#s01-property-store-api, #s02-property-schema, #s03-property-change)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/property-store.ts`
- New file: `tugdeck/src/__tests__/property-store.test.ts`

**Tasks:**
- [ ] Create `property-store.ts` with PropertySchema, PropertyDescriptor, PropertyChange, and PropertyChangeListener types (Spec S02, Spec S03)
- [ ] Implement PropertyStore class with constructor accepting PropertyDescriptor[] and initial values Record<string, unknown>
- [ ] Implement get(path): validate path against schema, return cached value from internal Map. If onGet callback provided, delegate to it. Return stable references for unchanged values
- [ ] Implement set(path, value, source): validate path against schema, check readOnly constraint, validate type constraints (min/max for number, enumValues for enum). Store new value, fire all observers for that path with PropertyChange record
- [ ] Implement observe(path, listener): accept both PropertyChangeListener and plain () => void. Always call every observer with the PropertyChange record — plain callbacks ignore the extra argument (no runtime type discrimination). Maintain Map<string, Set<Function>> internally. Return unsubscribe function that removes the listener from the set
- [ ] Implement getSchema(): return the PropertySchema
- [ ] Handle optional onGet/onSet callbacks: onGet overrides internal map read, onSet is called after internal map write and observer notification
- [ ] Export all types and the PropertyStore class

**Tests:**
- [ ] get() returns initial value for valid path
- [ ] get() throws for path not in schema
- [ ] set() updates value and fires observers with correct PropertyChange
- [ ] set() throws for readOnly property
- [ ] set() clamps number values to min/max range (e.g., set fontSize to 100 with max 72 stores 72)
- [ ] set() throws for invalid enum values (e.g., set fontFamily to 'comic-sans' when not in enumValues)
- [ ] observe() returns unsubscribe; after unsubscribe listener does not fire
- [ ] observe() with plain () => void callback works as useSyncExternalStore subscribe
- [ ] get() returns stable reference for unchanged value (same object identity)
- [ ] Multiple observers on same path all fire on set()
- [ ] Observer on path A does not fire when path B changes

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit` passes with no type errors
- [ ] All PropertyStore unit tests pass

---

#### Step 2: Implement usePropertyStore hook and TugcardPropertyContext {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugways): add usePropertyStore hook and TugcardPropertyContext`

**References:** [D01] Context callback registration for PropertyStore, [D05] Per-path observe for useSyncExternalStore, Spec S04, Spec S05, (#s04-use-property-store, #s05-tugcard-property-context, #symbol-inventory)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/hooks/use-property-store.ts`
- Modified file: `tugdeck/src/components/tugways/hooks/index.ts` (add exports)

**Tasks:**
- [ ] Create `use-property-store.ts` with TugcardPropertyContext (React.createContext with null default)
- [ ] Implement usePropertyStore hook: create PropertyStore in useRef on first render, call TugcardPropertyContext registration callback in useLayoutEffect (Rule #3), return stable store instance
- [ ] Export TugcardPropertyContext and usePropertyStore from the file
- [ ] Update `hooks/index.ts` barrel to export usePropertyStore and TugcardPropertyContext

**Tests:**
- [ ] usePropertyStore creates a PropertyStore with the provided schema and initial values
- [ ] usePropertyStore calls the context callback with the store instance

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit` passes with no type errors

---

#### Step 3: Wire TugcardPropertyContext and setProperty action into Tugcard {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugways): wire PropertyStore context and setProperty action in Tugcard`

**References:** [D01] Context callback registration for PropertyStore, [D04] setProperty action routed through Tugcard responder, Spec S05, Spec S06, (#s05-tugcard-property-context, #s06-set-property-action)

**Artifacts:**
- Modified file: `tugdeck/src/components/tugways/tugcard.tsx`

**Tasks:**
- [ ] Import TugcardPropertyContext from hooks/use-property-store
- [ ] Add a `propertyStoreRef = useRef<PropertyStore | null>(null)` to Tugcard
- [ ] Create a stable registration callback: `const registerPropertyStore = useCallback((store: PropertyStore) => { propertyStoreRef.current = store; }, [])`
- [ ] Wrap children with `<TugcardPropertyContext value={registerPropertyStore}>` inside the existing provider chain (inside TugcardDataProvider, inside ResponderScope)
- [ ] Add `setProperty` to the useResponder actions object: read propertyStoreRef.current, extract path/value/source from event.value (Spec S06), call store.set(path, value, source ?? 'inspector'). No-op if store is null
- [ ] Use a ref for the registration callback to keep the responder action closure fresh (Rule #5)

**Tests:**
- [ ] Tugcard renders without error when no PropertyStore is registered (setProperty is no-op)
- [ ] When a card content registers a PropertyStore via usePropertyStore, setProperty action dispatched via dispatchTo reaches the store

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit` passes with no type errors
- [ ] Gallery card loads without errors (existing tabs unaffected)

---

#### Step 4: Build gallery observable-props demo content {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugways): add Observable Props gallery tab with inspector demo`

**References:** [D01] Context callback registration for PropertyStore, [D02] Store owns values with optional callbacks, [D03] Observer-side circular guard, [D04] setProperty action routed through Tugcard responder, [D05] Per-path observe for useSyncExternalStore, Spec S01, Spec S06, Spec S07, (#s07-gallery-demo, #symbol-inventory)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/cards/gallery-observable-props-content.tsx`
- Modified file: `tugdeck/src/components/tugways/cards/gallery-card.tsx` (add tab + import)

**Tasks:**
- [ ] Create `gallery-observable-props-content.tsx` with `GalleryObservablePropsContent` component that accepts a `cardId: string` prop
- [ ] Register a PropertyStore via usePropertyStore with three properties: style.backgroundColor (color, initial: '#4f8ef7'), style.fontSize (number, min: 8, max: 72, initial: 16), style.fontFamily (enum, values: ['system-ui', 'monospace', 'serif'], initial: 'system-ui')
- [ ] Render a target element (styled div with sample text) whose appearance is driven by the PropertyStore values via useSyncExternalStore for each property
- [ ] Render an inspector panel section with three controls: color input for backgroundColor, number input/range for fontSize, select dropdown for fontFamily
- [ ] Inspector controls dispatch setProperty actions via `manager.dispatchTo(cardId, { action: 'setProperty', value: { path, value, source: 'inspector' } })` where cardId is the prop received from the contentFactory. This exercises the Tugcard-level setProperty handler from Step 3 — the action routes through the parent Tugcard's responder node to the registered PropertyStore. There is no second setProperty handler in the demo; the demo relies entirely on the Tugcard-level routing
- [ ] Target element's appearance updates reactively via useSyncExternalStore subscriptions — each property subscribed independently so only the affected field re-renders
- [ ] Add source attribution check: when the target element's own observer sees source === 'content', it applies the change; when it sees source === 'inspector', it skips re-dispatch (demonstrates circular guard)
- [ ] In gallery-card.tsx, import GalleryObservablePropsContent
- [ ] Append eighth entry to GALLERY_DEFAULT_TABS: `{ id: "template", componentId: "gallery-observable-props", title: "Observable Props", closable: true }`
- [ ] Add registerCard call for `gallery-observable-props` with contentFactory that passes cardId through: `contentFactory: (cardId) => <GalleryObservablePropsContent cardId={cardId} />`. This is the first gallery tab to use the cardId argument from contentFactory (existing tabs discard it as `_cardId`)

**Tests:**
- [ ] Gallery card shows eight tabs including "Observable Props"
- [ ] Observable Props tab renders target element and inspector panel without errors
- [ ] Changing color input updates target element background color
- [ ] Changing font size input updates target element font size
- [ ] Changing font family dropdown updates target element font family

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit` passes with no type errors
- [ ] Gallery card loads with all eight tabs
- [ ] Observable Props demo shows target element and inspector panel
- [ ] All three property controls update the target element

---

#### Step 5: Integration Checkpoint — Full Round-Trip Verification {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Context callback registration for PropertyStore, [D02] Store owns values with optional callbacks, [D03] Observer-side circular guard, [D04] setProperty action routed through Tugcard responder, [D05] Per-path observe for useSyncExternalStore, Spec S01, Spec S07, (#success-criteria, #r01-snapshot-instability, #r02-circular-notification)

**Tasks:**
- [ ] Verify inspector reads match card state: open Observable Props tab, confirm inspector controls display the target element's current values
- [ ] Verify inspector writes update the card: change each control, confirm target element appearance changes
- [ ] Verify card-side changes notify inspector: if the store is programmatically updated (e.g., via console), confirm inspector controls reflect the new value
- [ ] Verify source attribution prevents circular updates: inspector writes should not cause infinite observer loops
- [ ] Verify useSyncExternalStore triggers re-renders only for changed property: changing backgroundColor should not re-render the fontSize or fontFamily inspector fields
- [ ] Verify PropertyStore setProperty action works via dispatchTo: use browser console to call `manager.dispatchTo(cardId, { action: 'setProperty', value: { path: 'style.backgroundColor', value: '#ff0000' } })` and confirm the target updates

**Tests:**
- [ ] All success criteria from #success-criteria are met

**Checkpoint:**
- [ ] `cd tugdeck && bun run tsc --noEmit` passes with no type errors
- [ ] Gallery card loads with eight tabs, all functional
- [ ] Observable Props demo completes full round-trip: schema discovery, read, write, observe, source attribution

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Cards can expose inspectable properties via PropertyStore. Inspectors discover, read, write, and observe properties via the responder chain and useSyncExternalStore, without importing card internals. A gallery demo proves the full round-trip.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] PropertyStore class exists with get/set/observe/getSchema (Spec S01)
- [ ] PropertySchema and PropertyDescriptor types exist (Spec S02)
- [ ] usePropertyStore hook registers a store with Tugcard via context callback
- [ ] Tugcard handles setProperty action by routing to registered PropertyStore
- [ ] Gallery Observable Props tab loads as eighth tab and demonstrates full inspector round-trip
- [ ] No TypeScript type errors (`bun run tsc --noEmit`)
- [ ] No new warnings in browser console when using the gallery demo

**Acceptance tests:**
- [ ] PropertyStore unit tests pass (get, set, observe, unsubscribe, schema validation, constraint enforcement)
- [ ] Gallery demo: inspector controls update target element appearance
- [ ] Gallery demo: target element state reflected in inspector controls
- [ ] Gallery demo: no circular update loops

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 8e: Full inspector panels with TugSlider, TugColorPicker, and form controls
- [ ] Feed data bridging: PropertyStore backed by feed accumulator for read-only inspectable properties
- [ ] Tugbank persistence: PropertyStore values saved/restored via tugbank
- [ ] Transaction integration: MutationTransaction live preview for continuous property editing gestures

| Checkpoint | Verification |
|------------|--------------|
| TypeScript compilation | `cd tugdeck && bun run tsc --noEmit` |
| Gallery tab count | Component Gallery shows 8 tabs |
| Round-trip property editing | Inspector write -> target update -> observer notification |
| Source attribution | No circular loops when inspector writes |
