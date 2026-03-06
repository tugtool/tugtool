<!-- tugplan-skeleton v2 -->

## Tugways Phase 5d3: Mutation Transactions {#phase-5d3-mutation-transactions}

**Purpose:** Implement the MutationTransaction class, MutationTransactionManager singleton, and StyleCascadeReader utility so that live-preview editing has formal snapshot/preview/commit/cancel semantics in the appearance zone. A vertical-slice gallery demo proves all three interaction models (color picker, pointer-scrub swatch, number slider) with a positioned mock card element.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5d3-mutation-transactions |
| Last updated | 2026-03-05 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Inspector panels need live preview: as you scrub a color picker, the target element updates in real time. But if you cancel, everything must revert. The three-zone mutation model (Phase 4) established appearance-zone hooks (`useCSSVar`, `useDOMClass`, `useDOMStyle`) for direct DOM mutation without React re-renders. Phase 5d2 added `ActionEvent` with five-phase lifecycle (`begin`/`change`/`commit`/`cancel`/`discrete`). What is missing is a formal mechanism to snapshot CSS/DOM state before a preview begins, apply intermediate mutations during the gesture, and either finalize or restore on completion.

The "bypass React during the gesture, sync on commit" principle from the Excalidraw study describes the timing correctly. Mutation transactions formalize this with snapshot/restore semantics, bridging the gap between the action phase lifecycle (D61) and the appearance-zone mutation hooks.

#### Strategy {#strategy}

- Implement `MutationTransaction` as a plain TypeScript class (not interface) with `begin()`, `preview()`, `commit()`, `cancel()` methods -- matching the imperative singleton pattern of `ResponderChainManager` and `SelectionGuard`.
- Implement `MutationTransactionManager` as a module-level singleton that creates and tracks active transactions per element, auto-canceling previous transactions when a new one begins on the same element.
- Implement `StyleCascadeReader` as a stateless utility class with `getDeclared()`, `getComputed()`, and `getTokenValue()` methods for read-only style introspection.
- Wire the cascade reader's `preview` source detection through the `MutationTransactionManager` -- if a transaction is active, its previewed properties report `source: 'preview'`.
- Build a gallery demo tab with all three interaction models: HTML color input, pointer-scrub swatch, and number slider. The demo dispatches `ActionEvent`s through the responder chain to drive the transaction lifecycle, proving the action-phase-to-transaction mapping.
- The demo includes a positioned mock card element whose CSS `left`/`top` inline style values demonstrate multi-property snapshotting.
- Add the gallery tab below existing Phase 4 demo content -- a new "Mutation Transactions" tab alongside the six existing gallery tabs.

#### Success Criteria (Measurable) {#success-criteria}

- `MutationTransaction.begin()` snapshots targeted CSS properties; `cancel()` restores them exactly (verified by unit test comparing before/after values)
- `MutationTransaction.preview()` applies appearance-zone mutations via `element.style.setProperty()` -- no React re-renders during preview (verified by test asserting inline style changes)
- `MutationTransaction.commit()` leaves final values in place (verified by unit test)
- `MutationTransactionManager` enforces one transaction per element -- starting a new transaction auto-cancels the previous one (verified by unit test)
- `StyleCascadeReader.getDeclared()` correctly identifies source layers: `inline`, `preview`, `class`, `token` (verified by unit tests with mocked DOM)
- Gallery demo shows all three interaction models dispatching `ActionEvent`s through the responder chain (verified by visual inspection and test)
- `bun run build` succeeds with zero type errors
- `bun vitest run` passes all existing and new tests

#### Scope {#scope}

1. `MutationTransaction` class with `begin`/`preview`/`commit`/`cancel` lifecycle
2. `MutationTransactionManager` singleton with per-element transaction tracking and auto-cancel
3. `StyleCascadeReader` utility with `getDeclared`/`getComputed`/`getTokenValue`
4. Gallery demo tab (`gallery-mutation-tx`) with three interaction models and positioned mock card
5. Unit tests for all three new modules
6. Integration test verifying action-phase-to-transaction lifecycle

#### Non-goals (Explicitly out of scope) {#non-goals}

- Observable property store (PropertyStore, usePropertyStore) -- that is Phase 5d4
- Inspector panels -- that is Phase 8e
- Continuous control components (TugSlider, TugColorPicker as reusable components) -- Phase 8b; the gallery demo uses raw HTML controls
- Persisting committed values to tugbank or any external store
- Data-attribute and class-toggle snapshotting -- D64 lists these as snapshotable state, but the immediate use case (inspector CSS property editing) only needs CSS inline style properties. Data-attribute and class-toggle support is deferred until a concrete consumer requires it
- Updating `design-system-concepts.md` concept status

#### Dependencies / Prerequisites {#dependencies}

- Phase 5d2 (Control Action Foundation) -- complete. Provides `ActionEvent`, `ActionPhase`, `dispatch()`, `dispatchTo()`, and the five-phase action lifecycle.
- Phase 4 (Mutation Model) -- complete. Provides appearance-zone hooks (`useCSSVar`, `useDOMClass`, `useDOMStyle`) and the three-zone mutation model.
- Phase 5b3 (Gallery Card) -- complete. Provides the gallery card tab infrastructure and `registerCard` pattern.

#### Constraints {#constraints}

- All preview mutations must be CSS/DOM only -- no React state changes during a transaction (Rule of Tug #9).
- Controls emit actions; responders handle actions (Rule of Tug #10). The demo must dispatch `ActionEvent`s, not call `MutationTransaction` methods directly from controls.
- The `MutationTransactionManager` must be a plain TypeScript object, not React state -- consistent with `ResponderChainManager` and `SelectionGuard`.

#### Assumptions {#assumptions}

- `element.style.getPropertyValue()` returns empty string for properties set by class rules, allowing the cascade reader to distinguish inline from class sources.
- `getComputedStyle()` returns resolved values for all CSS properties, including custom properties defined by theme tokens.
- The gallery demo does not need real card persistence -- mock DOM elements with inline styles are sufficient to demonstrate the transaction lifecycle.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per the skeleton conventions. All anchors are kebab-case, lowercase, hyphenated, with no phase numbers. Decision anchors use `dNN-` prefix, spec anchors use `sNN-` prefix, step anchors use `step-N` prefix.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Cascade reader heuristic misidentifies source layer | med | med | Conservative fallback: if ambiguous, report `class` | Inspector shows wrong source badge |
| Snapshot restoration incomplete for complex CSS properties | med | low | Unit test every property type (custom prop, inline style, data attribute) | Cancel leaves stale values |

**Risk R01: Cascade reader heuristic accuracy** {#r01-cascade-heuristic}

- **Risk:** The `getDeclared` heuristic (empty `getPropertyValue` + non-empty `getComputedStyle` = class source) may misidentify values in edge cases where an inline style was explicitly set to the initial/inherited value.
- **Mitigation:** Conservative fallback to `class` when ambiguous. Document the heuristic limitations. The preview source is tracked explicitly by the manager, so that layer is always accurate.
- **Residual risk:** Edge cases with `inherit`, `initial`, or `unset` values may report as `class` when they are actually inline resets.

**Risk R02: Snapshot restoration for shorthand properties** {#r02-shorthand-restore}

- **Risk:** Snapshotting `background` (a shorthand) does not capture individual longhand sub-properties. Restoring the shorthand may not produce identical results if longhands were mixed.
- **Mitigation:** Document that transactions should snapshot longhand properties (e.g., `background-color`) not shorthands. The `begin()` API accepts an explicit property list, giving the caller control.
- **Residual risk:** Callers who pass shorthands may see unexpected restore behavior.

---

### Design Decisions {#design-decisions}

#### [D01] MutationTransaction is a class with snapshot map (DECIDED) {#d01-transaction-class}

**Decision:** `MutationTransaction` is a plain TypeScript class (not an interface) that stores a `Map<string, string>` of `property -> original-value` pairs captured at `begin()` time.

**Rationale:**
- Matches the imperative pattern of `ResponderChainManager` and `SelectionGuard` -- plain TS objects outside React state.
- A class (not interface) provides concrete implementation that the manager instantiates directly.

**Implications:**
- The constructor takes `(id: string, target: HTMLElement)` -- target is set once at construction time and exposed as a readonly field. The type is `HTMLElement` (not `Element`) because `.style` is an `HTMLElement`-only property.
- `begin(properties)` iterates the property list and calls `this.target.style.getPropertyValue(prop)` for each, storing the result (including empty string for unset properties).
- `preview(property, value)` calls `this.target.style.setProperty(property, value)`. If the property was not included in the `begin(properties)` list, `preview()` throws an `Error` -- callers must declare all properties upfront so the snapshot is complete. This prevents orphaned mutations that `cancel()` cannot restore.
- `cancel()` iterates the snapshot map and calls `this.target.style.setProperty(prop, originalValue)` for each, restoring the original state. Sets `isActive` to false.
- `commit()` is a no-op on the DOM (values already in place). Sets `isActive` to false.
- **Cleanup contract:** `MutationTransaction` has no back-reference to the manager. Callers must not call `commit()`/`cancel()` directly on the transaction object -- instead, they call `mutationTransactionManager.commitTransaction(target)` or `mutationTransactionManager.cancelTransaction(target)`, which delegates to the transaction's `commit()`/`cancel()` and then removes the entry from the manager's Map. This keeps the transaction class simple (no callback or circular reference) while ensuring the manager's Map stays clean.

#### [D02] MutationTransactionManager is a module-level singleton (DECIDED) {#d02-manager-singleton}

**Decision:** `MutationTransactionManager` is exported as a singleton instance (like `selectionGuard`), not a React context. It tracks active transactions in a `Map<HTMLElement, MutationTransaction>`.

**Rationale:**
- Consistent with `ResponderChainManager` (instantiated once per provider) and `SelectionGuard` (module-level singleton).
- Transaction state is imperative DOM bookkeeping, not React state -- it must not trigger re-renders during preview.

**Implications:**
- `beginTransaction(target, properties)` auto-generates a unique transaction ID via an incrementing counter (e.g., `"tx-1"`, `"tx-2"`), creates a new `MutationTransaction(id, target)`, auto-cancels any existing transaction on the same target element, stores the new transaction, and calls `begin()`.
- `commitTransaction(target)` calls `commit()` on the active transaction for the element and removes it from the Map. No-op if no active transaction exists.
- `cancelTransaction(target)` calls `cancel()` on the active transaction for the element and removes it from the Map. No-op if no active transaction exists.
- `getActiveTransaction(target)` returns the current transaction for an element, or `null`.
- `isPreviewProperty(element, property)` returns `true` if the property is being previewed in an active transaction -- used by `StyleCascadeReader` for the `preview` source layer.

#### [D03] StyleCascadeReader is a stateless utility (DECIDED) {#d03-cascade-reader}

**Decision:** `StyleCascadeReader` is a class with stateless methods that take an element and property name. It reads from the DOM and the `MutationTransactionManager` to determine source layers.

**Rationale:**
- The reader does not own any state -- it queries the DOM and the manager on each call.
- A class (rather than free functions) groups related methods and allows the manager reference to be injected for testability.

**Implications:**
- `getDeclared(element, property)` returns `{ value, source }` where source is `'preview'` | `'inline'` | `'class'` | `'token'`.
- Source detection order: (1) check manager for active preview, (2) check `element.style.getPropertyValue()` for inline, (3) check `getComputedStyle()` for class/token values.
- `getComputed(element, property)` is a thin wrapper around `getComputedStyle(element).getPropertyValue(property)`.
- `getTokenValue(tokenName)` reads from `getComputedStyle(document.documentElement).getPropertyValue(tokenName)`.

#### [D04] Action phases drive transaction lifecycle in the demo (DECIDED) {#d04-action-phase-lifecycle}

**Decision:** The gallery demo responder maps action phases to transaction methods: `begin` opens a transaction, `change` calls `preview()`, `commit` calls `commit()`, `cancel` calls `cancel()`. The demo dispatches `ActionEvent`s through the responder chain -- it does not call transaction methods directly from controls.

**Rationale:**
- Proves the integration path that real inspector panels will use (Phase 8e).
- Validates Rule of Tug #10: controls emit actions, responders handle actions.
- The responder that handles the continuous action owns the transaction lifecycle, keeping transaction management decoupled from control implementation.

**Implications:**
- The demo registers a responder node (via `useResponder`) with action handlers for `previewColor`, `previewHue`, and `previewPosition`.
- Each handler creates/manages a `MutationTransaction` based on the event's `phase` field.
- HTML controls (`<input type="color">`, pointer events, `<input type="range">`) emit `ActionEvent`s via `manager.dispatchTo(responderId, event)` (explicit-target dispatch). This matches the existing `ActionEventDemo` pattern and avoids stealing first-responder status from the card's tugcard node with `makeFirstResponder()`. The demo's responder node has a known ID so controls dispatch directly to it.

#### [D05] Gallery demo uses three interaction models (DECIDED) {#d05-three-demos}

**Decision:** The gallery demo shows all three interaction models requested by the user: (1) HTML color input for background-color preview, (2) pointer-scrub swatch for hue scrubbing, (3) number slider for opacity or position. A positioned mock card element with CSS `left`/`top` demonstrates multi-property snapshotting.

**Rationale:**
- Each model exercises a different gesture pattern: discrete change events (color input), continuous pointer tracking (scrub), and range input.
- The positioned card element proves that `begin()` can snapshot multiple properties and `cancel()` restores all of them atomically.

**Implications:**
- Three demo sections within a single gallery tab, each with its own controls and a shared mock target element.
- Cascade reader display shows the current source layer for each property being edited.

#### [D06] Cascade reader display uses direct DOM writes during preview (DECIDED) {#d06-dom-display-writes}

**Decision:** The gallery demo's cascade reader display panel updates via direct DOM writes (`element.textContent = ...` on ref'd `<span>` elements) during continuous preview gestures. It does not use `useState`/`setState` during the `change` phase.

**Rationale:**
- Rule of Tug #9: live preview is appearance-zone only. The existing `ActionEventDemo` uses `useState` for its display, but that demo only handles discrete (one-shot) events. The mutation transaction demo handles continuous `change` events at 60fps -- calling `setState` on every tick would trigger React re-renders, violating #9.
- Direct DOM writes to display elements are consistent with how the preview mutations themselves work (CSS `style.setProperty` calls).

**Implications:**
- Display `<span>` elements for source layer, value, and property name are accessed via `useRef` and updated imperatively.
- On commit/cancel, direct DOM writes are also fine -- no need to switch to `setState` for terminal phases.
- Tests can assert `textContent` on the ref'd elements rather than relying on React-driven DOM updates.

---

### Specification {#specification}

#### Public API Surface {#public-api}

**Spec S01: MutationTransaction class** {#s01-mutation-transaction}

```typescript
class MutationTransaction {
  constructor(id: string, target: HTMLElement);

  readonly id: string;
  readonly target: HTMLElement;

  begin(properties: string[]): void;
  /** Throws Error if property was not declared in begin(). */
  preview(property: string, value: string): void;
  commit(): void;
  cancel(): void;

  /** Returns true if the transaction has been started (begin called) and not yet committed/cancelled. */
  readonly isActive: boolean;
  /** Returns the set of property names currently being previewed. */
  readonly previewedProperties: ReadonlySet<string>;
}
```

**Spec S02: MutationTransactionManager singleton** {#s02-transaction-manager}

```typescript
class MutationTransactionManager {
  /** Auto-generates a unique transaction ID (incrementing counter: "tx-1", "tx-2", ...). */
  beginTransaction(target: HTMLElement, properties: string[]): MutationTransaction;
  /** Calls commit() on the active transaction and removes it from the Map. No-op if none. */
  commitTransaction(target: HTMLElement): void;
  /** Calls cancel() on the active transaction and removes it from the Map. No-op if none. */
  cancelTransaction(target: HTMLElement): void;
  getActiveTransaction(target: HTMLElement): MutationTransaction | null;
  isPreviewProperty(element: HTMLElement, property: string): boolean;
  cancelAll(): void;
  /** Clears all active transactions and resets the ID counter. For test cleanup. */
  reset(): void;
}

export const mutationTransactionManager: MutationTransactionManager;
```

**Spec S03: StyleCascadeReader utility** {#s03-cascade-reader}

```typescript
interface StyleLayer {
  value: string;
  source: 'token' | 'class' | 'inline' | 'preview';
}

class StyleCascadeReader {
  constructor(manager: MutationTransactionManager);

  getDeclared(element: HTMLElement, property: string): StyleLayer | null;
  getComputed(element: HTMLElement, property: string): string;
  getTokenValue(tokenName: string): string;
}

export const styleCascadeReader: StyleCascadeReader;
```

#### Source Layer Detection Logic {#source-detection}

**Table T01: getDeclared source detection algorithm** {#t01-source-detection}

| Priority | Check | Result |
|----------|-------|--------|
| Highest | `manager.isPreviewProperty(element, property)` is true | `source: 'preview'`, value from `element.style.getPropertyValue(property)` |
| Second | `element.style.getPropertyValue(property)` is non-empty | `source: 'inline'`, value from the property value |
| Third | Property name starts with `--`, `getComputedStyle(element).getPropertyValue(property)` is non-empty, AND its value equals `getComputedStyle(document.documentElement).getPropertyValue(property)` (i.e., the element inherits the root token value, not a class-scoped override) | `source: 'token'`, value from computed style |
| Fourth | `getComputedStyle(element).getPropertyValue(property)` is non-empty (custom property with element-local override, or standard CSS property from class rules) | `source: 'class'`, value from computed style |
| Fallback | None of the above | return `null` |

#### Terminology and Naming {#terminology}

| Term | Definition |
|------|-----------|
| Transaction | A `MutationTransaction` instance tracking snapshot and preview state for one element |
| Preview | An intermediate CSS/DOM mutation applied during a continuous gesture, before commit |
| Snapshot | The map of property names to original values captured at `begin()` time |
| Source layer | One of `token`, `class`, `inline`, `preview` -- where a CSS value originates |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/mutation-transaction.ts` | `MutationTransaction` class and `MutationTransactionManager` singleton |
| `tugdeck/src/components/tugways/style-cascade-reader.ts` | `StyleCascadeReader` utility and singleton |
| `tugdeck/src/__tests__/mutation-transaction.test.ts` | Unit tests for MutationTransaction and MutationTransactionManager |
| `tugdeck/src/__tests__/style-cascade-reader.test.ts` | Unit tests for StyleCascadeReader |
| `tugdeck/src/components/tugways/cards/gallery-mutation-tx-content.tsx` | `GalleryMutationTxContent` demo component (separate file to avoid growing gallery-card.tsx) |
| `tugdeck/src/__tests__/mutation-tx-demo.test.tsx` | Integration test for gallery demo |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `MutationTransaction` | class | `mutation-transaction.ts` | Snapshot/preview/commit/cancel lifecycle |
| `MutationTransactionManager` | class | `mutation-transaction.ts` | Singleton managing per-element transactions |
| `mutationTransactionManager` | const | `mutation-transaction.ts` | Exported singleton instance |
| `StyleCascadeReader` | class | `style-cascade-reader.ts` | Read-only style introspection utility |
| `StyleLayer` | interface | `style-cascade-reader.ts` | `{ value, source }` return type |
| `styleCascadeReader` | const | `style-cascade-reader.ts` | Exported singleton instance |
| `GalleryMutationTxContent` | function | `gallery-mutation-tx-content.tsx` | Gallery tab content component for mutation transaction demo |
| `GALLERY_DEFAULT_TABS` | const (modify) | `gallery-card.tsx` | Add `gallery-mutation-tx` tab entry |
| `registerGalleryCards` | function (modify) | `gallery-card.tsx` | Add `gallery-mutation-tx` card registration |

---

### Documentation Plan {#documentation-plan}

- [ ] JSDoc comments on all exported symbols in `mutation-transaction.ts` and `style-cascade-reader.ts`
- [ ] Inline comments in gallery demo explaining the action-phase-to-transaction mapping

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test MutationTransaction snapshot/restore, MutationTransactionManager per-element tracking, StyleCascadeReader source detection | Core logic, edge cases |
| **Integration** | Test gallery demo action dispatch through responder chain triggers transaction lifecycle | End-to-end action-to-preview flow |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: MutationTransaction and MutationTransactionManager {#step-1}

**Commit:** `feat(tugways): MutationTransaction class and MutationTransactionManager singleton`

**References:** [D01] MutationTransaction is a class with snapshot map, [D02] MutationTransactionManager is a module-level singleton, Spec S01, Spec S02, (#d01-transaction-class, #d02-manager-singleton, #s01-mutation-transaction, #s02-transaction-manager, #public-api)

**Artifacts:**
- `tugdeck/src/components/tugways/mutation-transaction.ts` -- new file
- `tugdeck/src/__tests__/mutation-transaction.test.ts` -- new file

**Tasks:**
- [ ] Create `mutation-transaction.ts` in `tugdeck/src/components/tugways/`
- [ ] Implement `MutationTransaction` class per Spec S01: constructor takes `(id: string, target: HTMLElement)`, `begin(properties)` snapshots via `this.target.style.getPropertyValue()`, `preview(property, value)` sets via `this.target.style.setProperty()`, `commit()` sets `isActive` to false (no DOM changes), `cancel()` restores snapshot values via `this.target.style.setProperty()` and sets `isActive` to false. The transaction class has no back-reference to the manager -- cleanup is the manager's responsibility
- [ ] Implement `isActive` getter (true after `begin()`, false after `commit()`/`cancel()`)
- [ ] Implement `previewedProperties` getter (set of property names that have been `preview()`ed)
- [ ] Implement `MutationTransactionManager` class per Spec S02: `beginTransaction(target, properties)` auto-cancels existing transaction on same element and creates new one, `commitTransaction(target)` delegates to `transaction.commit()` then removes from Map, `cancelTransaction(target)` delegates to `transaction.cancel()` then removes from Map, `getActiveTransaction(target)` returns current or null, `isPreviewProperty(element, property)` checks active transaction's previewed set, `cancelAll()` cancels all active transactions, `reset()` clears the Map and resets the ID counter (for test cleanup)
- [ ] Export `mutationTransactionManager` singleton instance
- [ ] Write unit tests covering: begin snapshots values, preview changes inline styles, commit leaves values in place, cancel restores original values, manager auto-cancels previous transaction, manager tracks multiple elements independently, `isPreviewProperty` returns correct results, `cancelAll` clears all transactions

**Tests:**
- [ ] `begin()` snapshots current inline style values (including empty string for unset)
- [ ] `preview()` sets inline style values on the target element
- [ ] `commit()` marks transaction inactive; values remain in DOM
- [ ] `cancel()` restores all snapshotted values; element returns to original state
- [ ] Manager auto-cancels previous transaction when new one begins on same element
- [ ] Manager tracks independent transactions on different elements
- [ ] `isPreviewProperty()` returns true for previewed properties, false for others
- [ ] `cancelAll()` cancels all active transactions across all elements
- [ ] `commitTransaction(target)` delegates to `commit()` and removes transaction from Map
- [ ] `cancelTransaction(target)` delegates to `cancel()`, restores values, and removes transaction from Map
- [ ] `commitTransaction(target)` / `cancelTransaction(target)` are no-ops when no active transaction exists
- [ ] `reset()` clears all transactions and resets the ID counter
- [ ] `preview()` throws `Error` when called with a property not declared in `begin()`

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with zero type errors
- [ ] `cd tugdeck && bun vitest run src/__tests__/mutation-transaction.test.ts` -- all tests pass

---

#### Step 2: StyleCascadeReader {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugways): StyleCascadeReader utility for source layer introspection`

**References:** [D03] StyleCascadeReader is a stateless utility, Spec S03, Table T01, (#d03-cascade-reader, #s03-cascade-reader, #t01-source-detection, #source-detection, #terminology)

**Artifacts:**
- `tugdeck/src/components/tugways/style-cascade-reader.ts` -- new file
- `tugdeck/src/__tests__/style-cascade-reader.test.ts` -- new file

**Tasks:**
- [ ] Create `style-cascade-reader.ts` in `tugdeck/src/components/tugways/`
- [ ] Implement `StyleLayer` interface: `{ value: string, source: 'token' | 'class' | 'inline' | 'preview' }`
- [ ] Implement `StyleCascadeReader` class per Spec S03: constructor accepts `MutationTransactionManager`, `getDeclared(element, property)` follows Table T01 detection algorithm, `getComputed(element, property)` wraps `getComputedStyle`, `getTokenValue(tokenName)` reads from document root computed style
- [ ] Export `styleCascadeReader` singleton instance (constructed with the `mutationTransactionManager` singleton)
- [ ] Add JSDoc on `getDeclared` documenting two heuristic limitations (see Risk R01): (1) edge cases with `inherit`, `initial`, or `unset` inline values may be misidentified as `class` source; (2) if a class rule sets a custom property to the same value as the root token, `getDeclared` will misreport the source as `token` instead of `class` because the element-vs-root comparison produces a match
- [ ] Write unit tests: `getDeclared` returns `preview` source when transaction is active, `inline` when property is set on element.style, `token` for custom properties from document root, `class` for computed-only values, `null` when property is absent. **Mock strategy for happy-dom:** happy-dom does not process CSS stylesheets or resolve custom properties through the cascade -- `getComputedStyle()` returns empty strings for `--`-prefixed properties. Tests must mock `getComputedStyle` on the window object (e.g., `vi.spyOn(window, 'getComputedStyle')`) to return controlled `CSSStyleDeclaration`-like objects with specific `getPropertyValue()` results for token and class detection tests

**Tests:**
- [ ] `getDeclared` returns `source: 'preview'` when property is in an active transaction's preview set
- [ ] `getDeclared` returns `source: 'inline'` when property is set via element.style but no active transaction
- [ ] `getDeclared` returns `source: 'token'` for custom properties (--prefixed) resolved from document root
- [ ] `getDeclared` returns `source: 'class'` for computed-only properties not from inline or token
- [ ] `getDeclared` returns `null` for properties with no value at any layer
- [ ] `getComputed` returns the computed style value
- [ ] `getTokenValue` reads from document.documentElement computed style

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with zero type errors
- [ ] `cd tugdeck && bun vitest run src/__tests__/style-cascade-reader.test.ts` -- all tests pass

---

#### Step 3: Gallery Demo -- Mutation Transactions Tab {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tugways): gallery mutation-transactions demo with three interaction models`

**References:** [D04] Action phases drive transaction lifecycle, [D05] Gallery demo uses three interaction models, [D06] Cascade reader display uses direct DOM writes, (#d04-action-phase-lifecycle, #d05-three-demos, #d06-dom-display-writes, #constraints, #assumptions)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-mutation-tx-content.tsx` -- new file: `GalleryMutationTxContent` component with three interaction demos
- `tugdeck/src/components/tugways/cards/gallery-card.tsx` -- modified: update `GALLERY_DEFAULT_TABS` (add 7th entry), add `gallery-mutation-tx` card registration in `registerGalleryCards()`, import and re-export `GalleryMutationTxContent`
- `tugdeck/src/components/tugways/cards/gallery-card.css` -- modified: add styles for mutation transaction demo elements
- `tugdeck/src/__tests__/gallery-card.test.tsx` -- modified: update all hardcoded count-of-6 assertions to 7, add `gallery-mutation-tx` to componentId/title/others arrays, add render test for `GalleryMutationTxContent`
- `tugdeck/src/__tests__/mutation-tx-demo.test.tsx` -- new file: integration test for gallery demo

**Tasks:**
- [ ] Create `gallery-mutation-tx-content.tsx` in `tugdeck/src/components/tugways/cards/` as a separate file (gallery-card.tsx is already 922 lines)
- [ ] Implement `GalleryMutationTxContent` component that renders: (a) a positioned mock card element (div with absolute positioning, background color, and left/top inline styles), (b) cascade reader display panel with ref'd `<span>` elements for each property's source and value. These display elements are updated via direct DOM writes (`el.textContent = ...`) during preview -- never via `useState`/`setState` -- to comply with Rule of Tug #9 (no React re-renders during continuous gestures). On commit/cancel, a single `setState` call may update any React-managed summary state
- [ ] Implement color input demo section: an HTML `<input type="color">` that dispatches `ActionEvent` with `phase: 'begin'` on the first `input` event (native color picker dialog opened and user started picking), `phase: 'change'` on subsequent `input` events (intermediate color selections within the dialog), `phase: 'commit'` on the `change` event (dialog closed with final color). To distinguish begin from change without stale closure issues, the `input` event handler checks `mutationTransactionManager.getActiveTransaction(target) !== null` -- if null, dispatch `phase: 'begin'`; if non-null, dispatch `phase: 'change'`. The responder handler manages a `MutationTransaction` for `background-color` on the mock card element
- [ ] Implement pointer-scrub swatch demo section: a hue swatch div that dispatches `ActionEvent` with `phase: 'begin'` on pointerdown, `phase: 'change'` on pointermove (mapping x-position to hue), `phase: 'commit'` on pointerup, `phase: 'cancel'` on Escape keydown. The responder handler manages a `MutationTransaction` for `background-color`
- [ ] Implement number slider demo section: two `<input type="range">` controls for X and Y position. Dispatch `ActionEvent` with `phase: 'begin'` on `pointerdown` only (not `focus` -- clicking a range input fires both `mousedown` and `focus` in sequence, which would auto-cancel the first transaction), `phase: 'change'` on `input`, `phase: 'commit'` on `pointerup`. The responder handler manages a `MutationTransaction` for both `left` and `top` on the mock card element, demonstrating multi-property snapshotting
- [ ] Register a responder node within the demo component (via `useResponder`) with a known ID (e.g., `"mutation-tx-demo"`) and action handlers for `previewColor`, `previewHue`, and `previewPosition`
- [ ] Each action handler implements the phase-to-transaction mapping: `begin` -> `mutationTransactionManager.beginTransaction(target, properties)`, `change` -> `transaction.preview(property, value)` (where `transaction` is obtained via `getActiveTransaction(target)`), `commit` -> `mutationTransactionManager.commitTransaction(target)`, `cancel` -> `mutationTransactionManager.cancelTransaction(target)`. All lifecycle calls go through the manager -- never call `transaction.commit()`/`cancel()` directly. Controls use `chainManager.dispatchTo("mutation-tx-demo", event)` (explicit-target dispatch) to deliver events directly to the demo's responder node, matching the existing `ActionEventDemo` pattern and avoiding `makeFirstResponder()` conflicts with the card's tugcard node
- [ ] Update cascade reader display during preview via direct DOM writes to ref'd `<span>` elements (e.g., `sourceSpanRef.current!.textContent = layer.source`). This avoids `useState`/`setState` during continuous gestures, complying with Rule of Tug #9. On commit/cancel, update display the same way (direct DOM writes are fine for all phases)
- [ ] Add `gallery-mutation-tx` entry to `GALLERY_DEFAULT_TABS` array (after the existing `gallery-default-button` entry) -- this changes the tab count from 6 to 7
- [ ] Add `gallery-mutation-tx` card registration in `registerGalleryCards()` following the existing pattern, importing `GalleryMutationTxContent` from the new file
- [ ] Add CSS styles for the mock card element, swatch, and demo layout
- [ ] Update `tugdeck/src/__tests__/gallery-card.test.tsx`: change all `toBe(6)` tab count assertions to `toBe(7)`, change `new Set(ids).size).toBe(6)` to `toBe(7)`, add `"gallery-mutation-tx"` to all componentId arrays in registry tests, add `"Mutation Transactions"` to the titles array, add `"gallery-mutation-tx"` to the `others` array in the "no defaultTabs" test, add a render test for `GalleryMutationTxContent` following the existing pattern (wrap in `ResponderChainProvider`, assert `data-testid`). Note: `GalleryMutationTxContent` is the first gallery content component in a separate file -- import it from `gallery-mutation-tx-content.tsx` (or via the re-export from `gallery-card.tsx`) and verify the import path works in tests

**Tests:**
- [ ] Gallery tab renders without errors (render test for `GalleryMutationTxContent`)
- [ ] Mock card element is visible with initial styles
- [ ] All existing gallery-card.test.tsx assertions pass with updated counts (7 tabs, 7 componentIds, 7 unique IDs)
- [ ] Color input dispatches ActionEvents (verified by integration test)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with zero type errors
- [ ] `cd tugdeck && bun vitest run` -- all existing and new tests pass

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** MutationTransaction class, MutationTransactionManager singleton, StyleCascadeReader utility, and a gallery demo tab proving live-preview editing with snapshot/restore semantics across three interaction models.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `mutation-transaction.ts` exports `MutationTransaction`, `MutationTransactionManager`, and `mutationTransactionManager` singleton (`bun run build` verifies)
- [ ] `style-cascade-reader.ts` exports `StyleCascadeReader`, `StyleLayer`, and `styleCascadeReader` singleton (`bun run build` verifies)
- [ ] Gallery "Mutation Transactions" tab renders three demo sections (visual inspection)
- [ ] All unit tests pass (`bun vitest run`)
- [ ] No React re-renders during preview mutations (manual profiler check)

**Acceptance tests:**
- [ ] `bun vitest run src/__tests__/mutation-transaction.test.ts` -- all pass
- [ ] `bun vitest run src/__tests__/style-cascade-reader.test.ts` -- all pass
- [ ] `bun vitest run` -- full suite passes with zero failures
- [ ] `bun run build` -- zero type errors

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5d4: Observable Properties (PropertyStore + usePropertyStore) -- builds on mutation transactions for inspector workflows
- [ ] Phase 8b: Continuous control components (TugSlider, TugColorPicker) -- reusable controls that emit `ActionEvent` with continuous phases
- [ ] Phase 8e: Inspector panels -- compose `StyleCascadeReader` + `MutationTransaction` + `PropertyStore` for full inspector editing

| Checkpoint | Verification |
|------------|--------------|
| MutationTransaction unit tests | `bun vitest run src/__tests__/mutation-transaction.test.ts` |
| StyleCascadeReader unit tests | `bun vitest run src/__tests__/style-cascade-reader.test.ts` |
| Full test suite | `bun vitest run` |
| Type check | `bun run build` |
| Gallery demo visual | Load Component Gallery, click "Mutation Transactions" tab |
