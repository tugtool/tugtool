## Tugways Phase 4: Mutation Model + DOM Hooks {#tugways-phase-4}

**Purpose:** Ship the three-zone mutation model with useCSSVar, useDOMClass, and useDOMStyle hooks for zero-re-render appearance mutations, document the three mutation zones, apply the five structure-zone rules, and prove the hooks end-to-end via a Component Gallery demo section.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-4-mutation-model |
| Last updated | 2026-03-02 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 0 through 3 are complete. The canvas is empty, the theme foundation loads design tokens, TugButton is live in the Component Gallery, and the responder chain routes actions and keyboard events through a focus-managed node tree. Phase 3 established the `tugways/` directory structure with flat file organization (responder-chain.ts, use-responder.tsx, tug-button.tsx, etc.).

Phase 4 implements the three-zone mutation model (design-system-concepts.md Concept 5), the discipline that governs how every future tugways component changes its appearance, data, and structure. The core deliverable is three DOM utility hooks -- useCSSVar, useDOMClass, and useDOMStyle -- that provide the sanctioned way to make appearance-zone mutations without React re-renders. These hooks are thin wrappers around `ref.current.style.setProperty()` and `ref.current.classList.toggle()`, but having them as named patterns prevents developers from accidentally reaching for `useState` when CSS or DOM manipulation is the correct tool.

The phase is scoped to ~200 lines across 3 new hook files, plus tests and a gallery demo section. No existing code is retrofitted -- the hooks establish the discipline for Phase 5 and beyond.

#### Strategy {#strategy}

- Implement the three hooks as separate files in `tugdeck/src/components/tugways/hooks/` with a barrel export via `hooks/index.ts`.
- Each hook follows the single-property signature pattern: `useCSSVar(ref, name, value)`, `useDOMClass(ref, className, condition)`, `useDOMStyle(ref, property, value)` -- consistent APIs, no object signatures, idiomatic React (call the hook multiple times for multiple properties).
- Write tests for each hook using bun:test with @testing-library/react, matching the pattern established by `use-responder.test.tsx`.
- Add a minimal "Mutation Model" demo section to the Component Gallery: a colored box whose CSS var, class, and inline style are toggled via buttons using the three hooks.
- Document the three-zone model and five structure-zone rules via JSDoc headers on each hook file -- design-system-concepts.md is the authoritative reference, not a separate doc file.
- useResponder stays in `tugways/` (not moved to hooks/) since it was placed there in Phase 3 and is not a DOM utility hook.

#### Success Criteria (Measurable) {#success-criteria}

- All three hooks (useCSSVar, useDOMClass, useDOMStyle) are importable from `@/components/tugways/hooks` (verified by barrel export and import in gallery)
- Each hook has at least 4 passing tests covering mount, update, unmount cleanup, and null ref safety (`bun test`)
- The "Mutation Model" gallery demo section renders and all three toggle buttons produce visible DOM changes; the hooks produce DOM mutations without requiring additional React state for the visual mutations themselves (the demo uses useState for toggle booleans which triggers re-renders, but the appearance changes are driven by the hooks, not by React's reconciliation)
- No regressions in existing tests (`bun test` passes all existing test files)

#### Scope {#scope}

1. Three new hook files: `use-css-var.ts`, `use-dom-class.ts`, `use-dom-style.ts`
2. Barrel export: `hooks/index.ts`
3. Tests for each hook
4. Component Gallery "Mutation Model" demo section
5. JSDoc documentation on each hook file

#### Non-goals (Explicitly out of scope) {#non-goals}

- Retrofitting existing code (e.g., tug-button.tsx inline styles) to use the new hooks -- violations get fixed naturally when code is touched in later phases
- High-frequency RAF-based mutation patterns (drag, resize) -- those bypass even these hooks per Concept 5 guidance and belong to Phase 5's DeckManager rebuild
- Object-signature variant for useDOMStyle -- the single-property API is the design that matches the system's principles
- Moving useResponder into the hooks/ directory -- it stays where Phase 3 placed it

#### Dependencies / Prerequisites {#dependencies}

- Phase 3 complete (responder chain, Component Gallery, useResponder) -- already done
- Phase 2 complete (TugButton, Component Gallery infrastructure) -- already done
- `tugdeck/src/components/tugways/` directory exists with current component set

#### Constraints {#constraints}

- All hooks must be pure TypeScript with full generic typing
- Tests must use bun:test with @testing-library/react and happy-dom (matching existing test infrastructure)
- All CSS in the gallery demo must use semantic `--td-*` tokens exclusively
- No backend changes required

#### Assumptions {#assumptions}

- The hooks/ subdirectory within tugways/ is the right home for DOM utility hooks, keeping them distinct from component files
- useResponder is not a DOM utility hook and stays at the tugways/ root level
- The five structure-zone rules are enforced only for code written in Phase 4 and forward; no retroactive audit of Phase 2/3 code
- happy-dom provides sufficient `style.setProperty()` and `classList.toggle()` support for testing the hooks
- Phase 4 runs after Phase 3 (which is already complete)

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan skeleton. All anchors are explicit, kebab-case, and stable. Decision anchors use the `d01-slug` pattern. Step anchors use the `step-1` pattern. All references use IDs and anchors, never line numbers.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| happy-dom incomplete style API | med | low | Test against real browser behavior in gallery; fall back to manual DOM assertions | Tests pass but gallery demo fails visually |
| Hook cleanup race conditions | med | low | Explicit null-ref checks; useEffect cleanup returns void (not conditional) | Unmount tests fail or console warnings appear |

**Risk R01: happy-dom Style API Gaps** {#r01-happy-dom-gaps}

- **Risk:** happy-dom may not fully implement `style.setProperty()` or `classList.toggle()` semantics, causing tests to pass vacuously.
- **Mitigation:** Write assertions that check actual DOM state after hook invocation (e.g., `el.style.getPropertyValue('--my-var')`). Add the gallery demo as a visual proof point in the live app.
- **Residual risk:** Some CSS cascade behavior is untestable in happy-dom; the gallery demo is the real verification.

---

### Design Decisions {#design-decisions}

#### [D01] Three Mutation Zones Are the Governing Discipline (DECIDED) {#d01-three-zones}

**Decision:** All UI mutations in tugways are classified into three zones: appearance (CSS/DOM, zero re-renders), local data (targeted setState), and structure (subtree re-render). The zone determines the mechanism.

**Rationale:**
- The appearance zone -- the biggest source of cascade re-renders in typical React apps -- never touches React at all
- The classification makes the mechanism choice mechanical, not a judgment call
- Follows the architecture established in design-system-concepts.md [D12]

**Implications:**
- Every new component must classify its mutations by zone before implementation
- Appearance mutations use the DOM hooks, never useState
- The five structure-zone rules apply to all new code from Phase 4 forward

#### [D02] Single-Property Hook Signatures (DECIDED) {#d02-single-property}

**Decision:** All three DOM hooks use single-property signatures: `useCSSVar(ref, name, value)`, `useDOMClass(ref, className, condition)`, `useDOMStyle(ref, property, value)`. No object-signature variants.

**Rationale:**
- Consistent API across all three hooks
- Eliminates the Rule 5 tension (no object to stabilize in JSX props)
- Calling hooks multiple times for multiple properties is idiomatic React
- The object-signature variant creates a footgun that the design system's own structure-zone rules warn against

**Implications:**
- Components that need to set multiple CSS vars call useCSSVar multiple times
- Components that need to set multiple inline styles call useDOMStyle multiple times
- No need for useMemo/useCallback to stabilize object arguments

#### [D03] Hooks Live in tugways/hooks/ Subdirectory (DECIDED) {#d03-hooks-directory}

**Decision:** The three DOM utility hooks live in `tugdeck/src/components/tugways/hooks/` with a barrel export via `hooks/index.ts`. useResponder stays at the tugways/ root.

**Rationale:**
- DOM utility hooks are a distinct category from component files and the responder hook
- useResponder was placed at the tugways/ root in Phase 3 and should not be moved (stable locations)
- Barrel export provides a clean import path: `import { useCSSVar, useDOMClass, useDOMStyle } from "@/components/tugways/hooks"`

**Implications:**
- New `hooks/` directory created under tugways/
- Future DOM utility hooks (if any) go in the same directory
- useResponder import path remains `@/components/tugways/use-responder`

#### [D04] JSDoc-Only Documentation (DECIDED) {#d04-jsdoc-only}

**Decision:** The three-zone model and five structure-zone rules are documented via JSDoc headers on each hook file. No separate documentation file is created.

**Rationale:**
- design-system-concepts.md is the authoritative reference for the mutation model
- JSDoc headers are visible at the import site and in IDE tooltips
- A separate doc file would duplicate design-system-concepts.md content and drift over time

**Implications:**
- Each hook file's JSDoc header explains which zone it serves and cites the relevant Concept 5 decisions
- The five structure-zone rules are summarized in the barrel export's JSDoc header

#### [D05] No Existing Code Retrofit (DECIDED) {#d05-no-retrofit}

**Decision:** Phase 4 creates the hooks and establishes the discipline. Existing code (e.g., tug-button.tsx inline styles) is not audited or retrofitted.

**Rationale:**
- The strategy scopes Phase 4 to ~200 lines and 3 hook files
- Violations in existing code get fixed naturally when that code is touched in later phases
- Retroactive audit is scope creep that adds risk without immediate value

**Implications:**
- tug-button.tsx keeps its current inline style approach until Phase 5+ touches it
- The hooks are available for immediate use by any new code

#### [D06] Minimal Gallery Demo Section (DECIDED) {#d06-gallery-demo}

**Decision:** Add a minimal "Mutation Model" demo section to the Component Gallery: a colored box whose CSS var, class, and inline style are toggled via buttons using the three hooks. This proves the hooks work end-to-end in the live app.

**Rationale:**
- Without a visual proof point, the only verification is unit tests
- Matches Phase 2's pattern of proving TugButton via the gallery
- Keeps the demo small and focused on proving the hooks, not building a complex UI

**Implications:**
- Component Gallery gains a new section after the existing Chain-Action Buttons section
- The demo component uses a ref to a single div and all three hooks
- Toggle buttons use TugButton (direct-action mode) to trigger state changes that drive the hooks

---

### Specification {#specification}

#### Public API Surface {#public-api}

**Spec S01: useCSSVar Hook** {#s01-use-css-var}

```typescript
/**
 * Set a CSS custom property on a ref'd element -- zero React re-renders.
 *
 * Appearance-zone hook. Uses useEffect to call ref.current.style.setProperty()
 * when name or value changes. Safe against null refs.
 *
 * @param ref - React ref to the target DOM element
 * @param name - CSS custom property name (e.g., "--td-accent")
 * @param value - CSS value string (e.g., "var(--tways-accent-orange)")
 */
function useCSSVar(
  ref: React.RefObject<HTMLElement | null>,
  name: string,
  value: string
): void;
```

**Spec S02: useDOMClass Hook** {#s02-use-dom-class}

```typescript
/**
 * Toggle a CSS class on a ref'd element -- zero React re-renders.
 *
 * Appearance-zone hook. Uses useEffect to call ref.current.classList.toggle()
 * when className or condition changes. Safe against null refs.
 *
 * @param ref - React ref to the target DOM element
 * @param className - CSS class name to toggle
 * @param condition - Boolean: true adds the class, false removes it
 */
function useDOMClass(
  ref: React.RefObject<HTMLElement | null>,
  className: string,
  condition: boolean
): void;
```

**Spec S03: useDOMStyle Hook** {#s03-use-dom-style}

```typescript
/**
 * Set a single inline style property on a ref'd element -- zero React re-renders.
 *
 * Appearance-zone hook. Uses useEffect to call ref.current.style.setProperty()
 * when property or value changes. Removes the property when value is empty string.
 * Safe against null refs.
 *
 * @param ref - React ref to the target DOM element
 * @param property - CSS property name (e.g., "border-width")
 * @param value - CSS value string (e.g., "2px"), or "" to remove
 */
function useDOMStyle(
  ref: React.RefObject<HTMLElement | null>,
  property: string,
  value: string
): void;
```

**Spec S04: Barrel Export** {#s04-barrel-export}

```typescript
// hooks/index.ts
export { useCSSVar } from "./use-css-var";
export { useDOMClass } from "./use-dom-class";
export { useDOMStyle } from "./use-dom-style";
```

#### Semantics {#semantics}

**Table T01: Hook Behavior Rules** {#t01-hook-behavior}

| Rule | Description |
|------|-------------|
| Null ref safety | If `ref.current` is null when the effect runs, the hook is a no-op. No error, no warning. |
| Stable element capture | Each hook captures `const el = ref.current` at the top of the useEffect callback and uses `el` in both the effect body and the cleanup function. This ensures cleanup has a stable reference to the DOM element even if `ref.current` changes or becomes null during unmount. |
| Cleanup on unmount | useEffect cleanup removes the property/class using the captured `el`. useCSSVar calls `el.style.removeProperty(name)`. useDOMClass calls `el.classList.remove(className)`. useDOMStyle calls `el.style.removeProperty(property)`. Cleanup is a no-op if `el` was null when captured. |
| Value change | When value/condition changes, the new value is applied on the next effect flush. The previous value is cleaned up by React's effect lifecycle (cleanup runs before the new effect). |
| Multiple calls | Calling the same hook multiple times with different names/properties is the intended usage pattern. Each call is independent. |
| SSR safety | Hooks are no-ops during SSR (ref.current is always null server-side). |

**Table T02: Zone Classification Quick Reference** {#t02-zone-reference}

| Zone | Mechanism | Hooks/Tools | Re-renders |
|------|-----------|-------------|------------|
| Appearance | CSS custom properties, CSS classes, DOM style | useCSSVar, useDOMClass, useDOMStyle, requestAnimationFrame + refs | Never |
| Local data | External mutable store + selective subscriptions | useSyncExternalStore, useState (local) | Only the subscribing component |
| Structure | React state at the right ancestor level | useState, useReducer, split contexts | The affected subtree |

**Table T03: Five Structure-Zone Rules** {#t03-structure-rules}

| Rule | Statement | Anti-pattern |
|------|-----------|-------------|
| Rule 1 | State lives at the lowest common ancestor, not higher | Lifting card-local state to deck canvas |
| Rule 2 | Split contexts by domain and frequency | Mixing connection status and feed data in one context |
| Rule 3 | Never derive state in useEffect | `useEffect(() => setFiltered(items.filter(...)))` |
| Rule 4 | Never define components inside components | `function Card() { const Inner = () => <div/>; }` |
| Rule 5 | Never create objects/arrays/functions inline in JSX props | `<Child style={{ color: 'red' }} />` without stable ref |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/hooks/use-css-var.ts` | useCSSVar hook implementation |
| `tugdeck/src/components/tugways/hooks/use-dom-class.ts` | useDOMClass hook implementation |
| `tugdeck/src/components/tugways/hooks/use-dom-style.ts` | useDOMStyle hook implementation |
| `tugdeck/src/components/tugways/hooks/index.ts` | Barrel export for all three hooks |
| `tugdeck/src/__tests__/use-css-var.test.tsx` | Tests for useCSSVar |
| `tugdeck/src/__tests__/use-dom-class.test.tsx` | Tests for useDOMClass |
| `tugdeck/src/__tests__/use-dom-style.test.tsx` | Tests for useDOMStyle |
| `tugdeck/src/__tests__/mutation-model-demo.test.tsx` | Tests for gallery Mutation Model demo |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `useCSSVar` | fn | `hooks/use-css-var.ts` | `(ref, name, value) => void` |
| `useDOMClass` | fn | `hooks/use-dom-class.ts` | `(ref, className, condition) => void` |
| `useDOMStyle` | fn | `hooks/use-dom-style.ts` | `(ref, property, value) => void` |
| `MutationModelDemo` | fn (component) | `component-gallery.tsx` | Gallery demo section component |

---

### Documentation Plan {#documentation-plan}

- [ ] JSDoc header on `use-css-var.ts` explaining appearance-zone purpose, citing Concept 5 [D12], [D13]
- [ ] JSDoc header on `use-dom-class.ts` explaining appearance-zone purpose, citing Concept 5 [D12], [D13]
- [ ] JSDoc header on `use-dom-style.ts` explaining appearance-zone purpose, citing Concept 5 [D12], [D13]
- [ ] JSDoc header on `hooks/index.ts` summarizing three-zone model and five structure-zone rules, citing Concept 5 [D12], [D14]

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test each hook in isolation with a ref'd element | All three hooks: mount, update, unmount, null ref |
| **Integration** | Test hooks working together in the gallery demo | Gallery demo renders, toggles produce DOM changes |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Create hooks/ Directory and useCSSVar Hook {#step-1}

**Commit:** `feat(tugways): add useCSSVar hook for appearance-zone CSS var mutations`

**References:** [D01] Three mutation zones, [D02] Single-property signatures, [D03] Hooks directory, [D04] JSDoc-only documentation, Spec S01, Table T01, (#public-api, #semantics, #context)

**Artifacts:**
- `tugdeck/src/components/tugways/hooks/use-css-var.ts`
- `tugdeck/src/components/tugways/hooks/index.ts` (initial barrel with useCSSVar only)
- `tugdeck/src/__tests__/use-css-var.test.tsx`

**Tasks:**
- [ ] Create `tugdeck/src/components/tugways/hooks/` directory
- [ ] Implement `useCSSVar(ref, name, value)` per Spec S01: useEffect with dependency array `[name, value]` (ref excluded -- React refs are stable objects) captures `const el = ref.current` at the top of the callback, calls `el?.style.setProperty(name, value)` in the effect body, and returns a cleanup function that calls `el?.style.removeProperty(name)` using the same captured `el`
- [ ] Add null-ref guard: if `el` (captured `ref.current`) is null, both the effect body and cleanup are no-ops
- [ ] Add JSDoc header citing Concept 5 [D12], [D13], explaining appearance-zone purpose
- [ ] Create `hooks/index.ts` with `export { useCSSVar } from "./use-css-var"`

**Tests:**
- [ ] T1: mount sets the CSS custom property on the ref'd element
- [ ] T2: value change updates the property to the new value
- [ ] T3: unmount removes the CSS custom property (cleanup effect)
- [ ] T4: null ref on mount does not throw (no-op safety)
- [ ] T5: name change removes old property and sets new property

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/use-css-var.test.tsx` -- all tests pass

---

#### Step 2: Add useDOMClass Hook {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugways): add useDOMClass hook for appearance-zone class toggling`

**References:** [D01] Three mutation zones, [D02] Single-property signatures, [D03] Hooks directory, [D04] JSDoc-only documentation, Spec S02, Table T01, (#public-api, #semantics)

**Artifacts:**
- `tugdeck/src/components/tugways/hooks/use-dom-class.ts`
- `tugdeck/src/__tests__/use-dom-class.test.tsx`
- Updated `hooks/index.ts` barrel export

**Tasks:**
- [ ] Implement `useDOMClass(ref, className, condition)` per Spec S02: useEffect with dependency array `[className, condition]` (ref excluded -- React refs are stable objects) captures `const el = ref.current` at the top of the callback, calls `el?.classList.toggle(className, condition)` in the effect body, and returns a cleanup function that calls `el?.classList.remove(className)` using the same captured `el`
- [ ] Add null-ref guard: if `el` (captured `ref.current`) is null, both the effect body and cleanup are no-ops
- [ ] Add JSDoc header citing Concept 5 [D12], [D13], explaining appearance-zone purpose
- [ ] Add `useDOMClass` to `hooks/index.ts` barrel export

**Tests:**
- [ ] T6: mount with condition=true adds the class to the element
- [ ] T7: mount with condition=false does not add the class
- [ ] T8: condition change from true to false removes the class
- [ ] T9: unmount removes the class (cleanup effect)
- [ ] T10: null ref on mount does not throw (no-op safety)
- [ ] T11: className change removes old class and adds new class (when condition=true)

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/use-dom-class.test.tsx` -- all tests pass

---

#### Step 3: Add useDOMStyle Hook {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tugways): add useDOMStyle hook for appearance-zone inline style mutations`

**References:** [D01] Three mutation zones, [D02] Single-property signatures, [D03] Hooks directory, [D04] JSDoc-only documentation, Spec S03, Table T01, (#public-api, #semantics)

**Artifacts:**
- `tugdeck/src/components/tugways/hooks/use-dom-style.ts`
- `tugdeck/src/__tests__/use-dom-style.test.tsx`
- Updated `hooks/index.ts` barrel export

**Tasks:**
- [ ] Implement `useDOMStyle(ref, property, value)` per Spec S03: useEffect with dependency array `[property, value]` (ref excluded -- React refs are stable objects) captures `const el = ref.current` at the top of the callback; when value is non-empty, calls `el?.style.setProperty(property, value)`; when value is empty string, calls `el?.style.removeProperty(property)` instead; cleanup function calls `el?.style.removeProperty(property)` using the same captured `el`
- [ ] Add null-ref guard: if `el` (captured `ref.current`) is null, both the effect body and cleanup are no-ops
- [ ] Add JSDoc header citing Concept 5 [D12], [D13], explaining appearance-zone purpose
- [ ] Add `useDOMStyle` to `hooks/index.ts` barrel export

**Tests:**
- [ ] T12: mount sets the inline style property on the ref'd element
- [ ] T13: value change updates the property to the new value
- [ ] T14: unmount removes the inline style property (cleanup effect)
- [ ] T15: null ref on mount does not throw (no-op safety)
- [ ] T16: empty string value removes the property
- [ ] T17: property change removes old property and sets new property

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/use-dom-style.test.tsx` -- all tests pass

---

#### Step 4: Hooks Integration Checkpoint {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [D01] Three mutation zones, [D03] Hooks directory, Spec S04, (#success-criteria)

**Tasks:**
- [ ] Verify all three hooks are importable from the barrel export: `import { useCSSVar, useDOMClass, useDOMStyle } from "@/components/tugways/hooks"`
- [ ] Verify all hook tests pass together
- [ ] Verify no regressions in existing tests

**Tests:**
- [ ] T-int1: All hook test files pass when run together (aggregate verification)
- [ ] T-int2: Full test suite passes with no regressions

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/use-css-var.test.tsx src/__tests__/use-dom-class.test.tsx src/__tests__/use-dom-style.test.tsx` -- all tests pass
- [ ] `cd tugdeck && bun test` -- all existing tests still pass (no regressions)

---

#### Step 5: Component Gallery Mutation Model Demo {#step-5}

**Depends on:** #step-4

**Commit:** `feat(tugways): add Mutation Model demo section to Component Gallery`

**References:** [D01] Three mutation zones, [D05] No existing code retrofit, [D06] Minimal gallery demo, Spec S01, Spec S02, Spec S03, Table T02, (#public-api, #success-criteria, #context)

**Artifacts:**
- Updated `tugdeck/src/components/tugways/component-gallery.tsx` with new MutationModelDemo section
- Updated `tugdeck/src/components/tugways/component-gallery.css` with demo styles (if needed)
- `tugdeck/src/__tests__/mutation-model-demo.test.tsx` -- tests for the gallery demo section

**Tasks:**
- [ ] Create a `MutationModelDemo` component defined outside ComponentGallery (per structure-zone Rule 4, Table T03)
- [ ] The demo renders a colored box div with a ref, and three TugButton (direct-action mode) toggle buttons
- [ ] "Toggle CSS Var" button: uses useState for a boolean toggle, drives `useCSSVar(boxRef, "--demo-bg", toggledValue)` to swap the box's background color between two CSS var values
- [ ] "Toggle Class" button: uses useState for a boolean toggle, drives `useDOMClass(boxRef, "demo-highlighted", condition)` to add/remove a highlight class
- [ ] "Toggle Style" button: uses useState for a boolean toggle, drives `useDOMStyle(boxRef, "border-width", toggledValue)` to swap between "1px" and "3px" border width
- [ ] Note: the demo uses useState for boolean toggles, which causes the MutationModelDemo component to re-render on click. This is intentional -- the re-render drives new values into the hooks, which then apply appearance changes via direct DOM manipulation. The hooks themselves never cause re-renders; they consume values produced by local state. In production usage (Phase 5+), the toggle values would come from imperative sources (responder chain, external stores) with no re-render at all.
- [ ] The box uses semantic `--td-*` tokens for its base styling; the CSS var toggle swaps between two `--td-*` color values
- [ ] Add the demo section to ComponentGallery's scrollable content area after the Chain-Action Buttons section, with a "Mutation Model" section title and divider
- [ ] Import hooks from `@/components/tugways/hooks`

**Tests:**
- [ ] T18: MutationModelDemo renders without errors when wrapped in a minimal test harness
- [ ] T19: Verify the three toggle buttons are present in the rendered output
- [ ] T20: Click "Toggle CSS Var" button and assert the box element's style has the expected CSS custom property value via `el.style.getPropertyValue("--demo-bg")`

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- all tests pass including new gallery tests
- [ ] Manual verification: open the app, show Component Gallery via Developer menu, scroll to "Mutation Model" section, click all three toggle buttons and observe DOM changes

---

#### Step 6: Final JSDoc Barrel Documentation {#step-6}

**Depends on:** #step-4

**Commit:** `docs(tugways): add three-zone model summary to hooks barrel export JSDoc`

**References:** [D04] JSDoc-only documentation, Table T02, Table T03, (#documentation-plan)

**Artifacts:**
- Updated `tugdeck/src/components/tugways/hooks/index.ts` with comprehensive JSDoc

**Tasks:**
- [ ] Add a module-level JSDoc comment to `hooks/index.ts` that summarizes the three mutation zones (Table T02) and the five structure-zone rules (Table T03)
- [ ] Cite design-system-concepts.md Concept 5 as the authoritative reference
- [ ] Verify the JSDoc renders correctly in IDE tooltips (manual check)

**Tests:**
- [ ] T21: Full test suite regression check after JSDoc changes (no functional code changed, all existing tests still pass)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- no regressions

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three DOM utility hooks (useCSSVar, useDOMClass, useDOMStyle) for zero-re-render appearance mutations, with tests, JSDoc documentation, and a Component Gallery demo proving the hooks work end-to-end.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All three hooks exist in `tugdeck/src/components/tugways/hooks/` and are importable via barrel export
- [ ] Each hook has passing tests covering mount, update, unmount cleanup, and null ref safety
- [ ] Component Gallery "Mutation Model" demo section renders and toggles produce visible DOM changes
- [ ] All existing tests pass with no regressions
- [ ] JSDoc headers on all hook files and barrel export document the three-zone model

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` -- all tests pass (existing + new)
- [ ] Manual: Component Gallery > Mutation Model section > all three toggle buttons produce visible DOM changes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5: Use hooks in Tugcard base component and DeckManager rebuild
- [ ] Phase 5+: Retrofit existing components (tug-button.tsx, etc.) to use hooks when touched
- [ ] Future: High-frequency RAF-based mutation patterns for drag/resize (bypasses hooks per Concept 5)

| Checkpoint | Verification |
|------------|--------------|
| Hooks importable | `import { useCSSVar, useDOMClass, useDOMStyle } from "@/components/tugways/hooks"` compiles |
| All tests pass | `cd tugdeck && bun test` exits 0 |
| Gallery demo works | Manual: toggle buttons produce DOM changes in the colored box |
