<!-- tugplan-skeleton v2 -->

## Phase 5d1: Default Button Infrastructure {#phase-5d1}

**Purpose:** Extend ResponderChainManager with a default-button stack and wire Enter-key activation through the stage-2 key pipeline, establishing infrastructure that Phase 8a components (alerts, sheets, popovers) will later use to register their default buttons.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5d1-default-button |
| Last updated | 2026-03-05 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugways design system includes dialog-like components (alerts, sheets, popovers) that need a "default button" -- the button activated when the user presses Enter. This is a standard UI pattern: the accent-filled primary button in a dialog accepts Enter as a keyboard shortcut. The responder chain (Phase 3) and key pipeline already exist, but they have no concept of a default button and no Enter-key handling at stage 2.

Phase 5d1 adds the default-button stack to ResponderChainManager and the Enter-key logic to the bubble-phase key pipeline. Phase 8a will later wire concrete components (TugConfirmPopover, TugAlertHost, TugSheetHost) into this infrastructure. This phase also fixes the destructive button variant styling, which currently lacks a distinct visual appearance.

#### Strategy {#strategy}

- Add `setDefaultButton` / `clearDefaultButton` methods to ResponderChainManager as a stack (push/pop), supporting nested modal scoping where the most recent registration wins.
- Extend the stage-2 bubble-phase key pipeline handler to intercept Enter: if no native `<button>` or text input has DOM focus, activate the topmost default button via synthetic click.
- Fix destructive variant CSS to be visually distinct (bold red fill, white text).
- Verify primary variant styling uses `--td-accent` correctly across all three themes (already wired via `--primary: var(--td-accent)` in tokens.css).
- Add a gallery demo section to make the default button mechanism testable without real modal components.
- Write unit tests for the stack and integration tests for Enter-key pipeline behavior.

#### Success Criteria (Measurable) {#success-criteria}

- `ResponderChainManager.setDefaultButton(el)` pushes onto stack; `clearDefaultButton(el)` pops the matching entry; `getDefaultButton()` returns the top of stack or null (unit tests pass)
- Pressing Enter when no native button/input is focused activates the registered default button via synthetic click (integration test passes)
- Pressing Enter when a native `<button>` or text input has DOM focus does NOT activate the default button (integration test passes)
- `.tug-button-destructive` has explicit `background-color: var(--td-danger)` and `color: var(--td-text-inverse)` (visual inspection in gallery across all three themes)
- Gallery demo shows default button registration + Enter activation working end-to-end

#### Scope {#scope}

1. Default button stack in ResponderChainManager (`setDefaultButton`, `clearDefaultButton`, `getDefaultButton`)
2. Enter-key handling in stage-2 bubble pipeline
3. Destructive variant CSS fix in `tug-button.css`
4. Primary variant visual verification (no code change expected, confirm in gallery)
5. Gallery demo section for default button feature
6. Unit and integration tests

#### Non-goals (Explicitly out of scope) {#non-goals}

- TugConfirmPopover, TugAlertHost, TugSheetHost -- Phase 8a work that will wire into this infrastructure later
- Any React hooks for default-button registration (Phase 8a components will call the raw API directly)
- Changes to TugButton React component for default-button awareness

#### Dependencies / Prerequisites {#dependencies}

- Phase 3 complete: ResponderChainManager and four-stage key pipeline exist
- Phase 5a2 complete: DeckManager store migration stable
- Phase 2 complete: Component Gallery exists for demo/verification

#### Constraints {#constraints}

- Rules of Tug compliance: never call `root.render()` after mount [D40, D42]; read external state with `useSyncExternalStore` only [D40]; `useLayoutEffect` for registrations events depend on [D41]; appearance changes through CSS/DOM, never React state [D08, D09]
- The API takes raw `HTMLButtonElement` (direct DOM reference), not React refs or component instances
- Stack semantics: push on set, pop on clear, most recent active

#### Assumptions {#assumptions}

- The primary variant's `--td-accent` fill is already correctly wired via tokens.css (`--primary: var(--td-accent)`) and only needs verification, not code changes
- The stage-2 bubble pipeline in `responder-chain-provider.tsx` currently has a stub comment with no Enter-key logic
- `useLayoutEffect` will be used for any future React-side registration hooks (Phase 8a), but this phase uses raw DOM API only
- The gallery demo can adequately prove the mechanism without real modal components

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All scope and API decisions are resolved per user answers.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Enter-key interception breaks existing text input behavior | high | low | Guard: skip when focus is on INPUT, TEXTAREA, SELECT, contentEditable, or native button | User reports Enter not working in text fields |
| Stack pop with stale element reference | med | low | clearDefaultButton matches by reference; no-op if element not found on stack | Crash or console error during modal teardown |

**Risk R01: Enter-key interception breaks text input** {#r01-enter-key-breaks-input}

- **Risk:** The Enter-key handler in stage 2 could intercept Enter presses that should go to native form elements or buttons.
- **Mitigation:**
  - Check `document.activeElement` tag name and `isContentEditable` before activating default button
  - Also skip if `document.activeElement` is a `<button>` (native buttons handle their own Enter)
  - Integration tests verify passthrough for all guarded element types
- **Residual risk:** Custom web components with non-standard focus behavior could be affected.

**Risk R02: Stack reference mismatch on clear** {#r02-stack-reference-mismatch}

- **Risk:** If `clearDefaultButton` is called with a different element reference than what was pushed, the stack becomes corrupted.
- **Mitigation:**
  - Use strict reference equality (`===`) to find and remove the element
  - If the element is not found on the stack, `clearDefaultButton` is a no-op (defensive)
  - Unit tests verify mismatched-clear behavior
- **Residual risk:** A leaked registration (set without matching clear) keeps a detached element on the stack. Phase 8a components must pair set/clear in mount/unmount.

---

### Design Decisions {#design-decisions}

#### [D01] Default button is a stack of HTMLButtonElement references (DECIDED) {#d01-default-button-stack}

**Decision:** `ResponderChainManager` maintains a `defaultButtonStack: HTMLButtonElement[]` where `setDefaultButton` pushes and `clearDefaultButton` removes by reference. `getDefaultButton` returns the top element or null.

**Rationale:**
- Stack supports nested modals: inner modal pushes its default button, outer modal's button is restored when inner closes
- Raw `HTMLButtonElement` aligns with the appearance-zone pattern (direct DOM, no React indirection)
- Reference-based removal is O(n) but the stack will never exceed 3-4 entries in practice (nested modal depth)

**Implications:**
- Phase 8a components must call `clearDefaultButton` in their cleanup (unmount or close handler)
- The stack does not participate in `validationVersion` / `useSyncExternalStore` -- there is no React UI that needs to re-render based on default-button changes

#### [D02] Enter-key check lives in stage-2 of the bubble pipeline (DECIDED) {#d02-enter-key-stage-2}

**Decision:** The Enter-key default-button activation is handled in the stage-2 (keyboard navigation) section of the `bubbleListener` in `responder-chain-provider.tsx`.

**Rationale:**
- Stage 2 is designated for keyboard navigation (the stub comment says "deferred to browser in Phase 3")
- Enter-key activation of a default button IS keyboard navigation -- it is a navigation shortcut for "activate the expected action"
- Must run before stage 3 (chain action dispatch) and stage 4 (text input passthrough)
- The existing stage 3/4 guards already skip INPUT/TEXTAREA/SELECT/contentEditable -- but the Enter check needs additional guards for `<button>` elements

**Implications:**
- The guard logic checks `document.activeElement` (not `event.target`) because we need to know what element currently holds focus, not what element the event is traveling through
- If a default button is activated, the event is `preventDefault()`ed and `stopPropagation()`ed to prevent further processing

#### [D03] Destructive variant gets explicit background and text color (DECIDED) {#d03-destructive-variant-fix}

**Decision:** Add `background-color: var(--td-danger)` and `color: var(--td-text-inverse)` to `.tug-button-destructive` in `tug-button.css` (base state, not just hover/active).

**Rationale:**
- The destructive variant currently inherits shadcn's default styling which uses the bridge variables `--destructive` / `--destructive-foreground`, but the visual distinction is insufficient
- Explicit CSS in the tugways layer ensures the button has a bold red fill with white text in all three themes
- This matches the implementation strategy's requirement: "destructive buttons have a bold red fill with white text"

**Implications:**
- The existing hover/active rules for `.tug-button-destructive` (brightness/saturate filters) continue to work on top of the new base color
- The `--td-danger` token resolves to `--tways-accent-4` (red) in all themes

#### [D04] Synthetic click activation for default button (DECIDED) {#d04-synthetic-click}

**Decision:** When Enter activates the default button, it calls `element.click()` on the `HTMLButtonElement` -- a synthetic click event that triggers all attached event handlers (React onClick, chain-action dispatch, etc.).

**Rationale:**
- `element.click()` fires a real DOM click event that React's synthetic event system picks up
- Works for both direct-action buttons (onClick handler) and chain-action buttons (action dispatch)
- Simpler and more robust than trying to replicate the button's behavior at a higher level

**Implications:**
- The default button must be an `HTMLButtonElement` (not a div or span styled as a button)
- Disabled buttons (`disabled` attribute or `aria-disabled="true"`) will not fire click events per browser spec (for `disabled`) or will fire but be ignored (for `aria-disabled` with pointer-events: none) -- this is correct behavior

---

### Specification {#specification}

#### Public API Surface {#public-api}

**Spec S01: ResponderChainManager default-button methods** {#s01-default-button-api}

```typescript
class ResponderChainManager {
  // ... existing methods ...

  /** Push a default button onto the stack. */
  setDefaultButton(element: HTMLButtonElement): void;

  /** Remove a specific button from the stack (by reference). No-op if not found. */
  clearDefaultButton(element: HTMLButtonElement): void;

  /** Return the topmost default button, or null if stack is empty. */
  getDefaultButton(): HTMLButtonElement | null;
}
```

**Spec S02: Enter-key activation guard logic** {#s02-enter-key-guard}

When Enter is pressed in the bubble-phase listener (stage 2):

1. Check `event.key === "Enter"`
2. Get `document.activeElement`
3. Skip if activeElement is `INPUT`, `TEXTAREA`, `SELECT`, `isContentEditable`, or `BUTTON`
4. Get `manager.getDefaultButton()`
5. If non-null, call `element.click()`, then `event.preventDefault()` and `event.stopPropagation()`
6. If null, fall through to stage 3

**Spec S03: Destructive variant CSS addition** {#s03-destructive-css}

Add to `tug-button.css`:

```css
.tug-button-destructive {
  background-color: var(--td-danger);
  color: var(--td-text-inverse);
}
```

This rule goes before the existing `.tug-button-destructive.tug-button-bordered` rule.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/__tests__/default-button.test.tsx` | Unit and integration tests for default button stack + Enter-key pipeline |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `defaultButtonStack` | private field | `responder-chain.ts` | `HTMLButtonElement[]`, initialized to `[]` |
| `setDefaultButton` | method | `responder-chain.ts` | Push element onto stack |
| `clearDefaultButton` | method | `responder-chain.ts` | Remove element by reference |
| `getDefaultButton` | method | `responder-chain.ts` | Return top of stack or null |
| Enter-key handler | code block | `responder-chain-provider.tsx` | Stage-2 logic in `bubbleListener` |
| `.tug-button-destructive` base rule | CSS rule | `tug-button.css` | `background-color` + `color` |
| `GalleryDefaultButtonContent` | function component | `gallery-card.tsx` | Demo section for default button |
| `gallery-default-button` | card registration | `gallery-card.tsx` | New gallery tab |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test default button stack push/pop/get in isolation | Core stack logic, edge cases (empty stack, mismatched clear, duplicate push) |
| **Integration** | Test Enter-key pipeline end-to-end with React rendering | Full pipeline: register button, press Enter, verify click fires |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add default-button stack to ResponderChainManager {#step-1}

**Commit:** `feat(tugways): add default-button stack to ResponderChainManager`

**References:** [D01] Default button is a stack of HTMLButtonElement references, Spec S01 (#s01-default-button-api, #d01-default-button-stack, #public-api)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/responder-chain.ts` -- three new methods + private field

**Tasks:**
- [ ] Add `private defaultButtonStack: HTMLButtonElement[] = []` to ResponderChainManager
- [ ] Implement `setDefaultButton(element: HTMLButtonElement): void` -- pushes element onto the stack
- [ ] Implement `clearDefaultButton(element: HTMLButtonElement): void` -- finds the last occurrence by strict reference equality (`===`) via `lastIndexOf` and removes exactly one instance; no-op if not found
- [ ] Implement `getDefaultButton(): HTMLButtonElement | null` -- returns `this.defaultButtonStack[this.defaultButtonStack.length - 1] ?? null`

**Tests:**
- [ ] Unit: push one element, `getDefaultButton()` returns it
- [ ] Unit: push two elements, `getDefaultButton()` returns the second (most recent)
- [ ] Unit: push two, clear the second, `getDefaultButton()` returns the first
- [ ] Unit: clear with element not on stack -- no-op, stack unchanged
- [ ] Unit: clear on empty stack -- no-op, returns null
- [ ] Unit: push same element twice, clear once -- one instance removed, element still on stack

**Checkpoint:**
- [ ] All unit tests for stack behavior pass: `cd tugdeck && bun test src/__tests__/default-button.test.tsx`

---

#### Step 2: Wire Enter-key activation in stage-2 bubble pipeline {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugways): wire Enter-key default-button activation in stage-2 pipeline`

**References:** [D02] Enter-key check in stage-2 bubble pipeline, [D04] Synthetic click activation, Spec S02 (#s02-enter-key-guard, #d02-enter-key-stage-2, #d04-synthetic-click)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/responder-chain-provider.tsx` -- Enter-key logic in `bubbleListener`

**Tasks:**
- [ ] In the `bubbleListener` function, replace the stage-2 stub comment with Enter-key logic per Spec S02
- [ ] Structure: wrap the entire stage-2 logic in an `if (event.key === "Enter") { ... }` block. For non-Enter keys, execution falls through unchanged to the existing stage-3/4 guard and passthrough logic. The existing stage-3 guard code (INPUT/TEXTAREA/SELECT/isContentEditable check at lines 80-92) must remain untouched and reachable for all non-Enter keys.
- [ ] Inside the Enter block: check `document.activeElement` -- skip activation if it is INPUT, TEXTAREA, SELECT, isContentEditable, or BUTTON
- [ ] Inside the Enter block: call `manager.getDefaultButton()` -- if non-null, call `element.click()`, then `event.preventDefault()` and `event.stopPropagation()`, then return (skip stages 3/4 for this event)
- [ ] If no default button is registered or guards triggered, fall through to existing stage 3/4 logic

**Tests:**
- [ ] Integration: render a button, register as default, press Enter on a div -- button click handler fires
- [ ] Integration: same setup but focus is on an INPUT -- button click handler does NOT fire
- [ ] Integration: same setup but focus is on a TEXTAREA -- button click handler does NOT fire
- [ ] Integration: same setup but focus is on a native BUTTON -- button click handler does NOT fire
- [ ] Integration: no default button registered, press Enter -- no error, no dispatch
- [ ] Integration: nested stack -- inner default button receives Enter, after clear outer button receives Enter

**Checkpoint:**
- [ ] All integration tests pass: `cd tugdeck && bun test src/__tests__/default-button.test.tsx`

---

#### Step 3: Fix destructive variant CSS {#step-3}

**Depends on:** #step-1

**Commit:** `fix(tugways): add explicit destructive button background and text color`

**References:** [D03] Destructive variant explicit background and text color, Spec S03 (#s03-destructive-css, #d03-destructive-variant-fix)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-button.css` -- new `.tug-button-destructive` base rule

**Tasks:**
- [ ] Add `.tug-button-destructive { background-color: var(--td-danger); color: var(--td-text-inverse); }` before the existing `.tug-button-destructive.tug-button-bordered` rule
- [ ] Verify existing hover/active/disabled rules for destructive variant still layer correctly on top of the new base color

**Tests:**
- [ ] Visual: open gallery TugButton tab, confirm destructive variant has red fill with white text in all three themes (dawn, dusk, night)
- [ ] Visual: confirm primary variant has accent fill -- verify it is clearly distinct from destructive

**Checkpoint:**
- [ ] Destructive buttons in gallery are visually distinct from primary buttons across all three themes

---

#### Step 4: Add gallery demo for default button {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat(tugways): add default-button gallery demo section`

**References:** [D01] Default button stack, [D02] Enter-key stage-2 pipeline, [D04] Synthetic click, Spec S01, Spec S02 (#s01-default-button-api, #s02-enter-key-guard, #d01-default-button-stack, #d04-synthetic-click)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-card.tsx` -- new `GalleryDefaultButtonContent` component + card registration + tab entry
- Modified `tugdeck/src/__tests__/gallery-card.test.tsx` -- update count assertions from five to six, add `gallery-default-button` to componentId lists
- Modified `tugdeck/src/__tests__/component-gallery.test.tsx` -- update count assertions from five to six, add `gallery-default-button` to componentId lists
- Gallery shows default button registration and Enter-key activation

**Tasks:**
- [ ] Create `GalleryDefaultButtonContent` component that:
  - Renders a primary "Confirm" button and a secondary "Cancel" button
  - Uses `useLayoutEffect` to register the Confirm button as the default button via `manager.setDefaultButton(buttonRef.current)` on mount, and `clearDefaultButton` on unmount (per [D41] useLayoutEffect for registrations)
  - Uses `useRequiredResponderChain()` to get the manager
  - Displays a status line showing the last action taken (e.g., "Confirm clicked" or "Cancel clicked") via local `useState` (this is local UI state, not external store state, so Rules of Tug [D40] does not apply)
  - Includes instructions: "Click outside the buttons, then press Enter to activate the default button"
- [ ] Add `gallery-default-button` to `GALLERY_DEFAULT_TABS` array
- [ ] Add `registerCard` call for `gallery-default-button` in `registerGalleryCards()`
- [ ] Update `gallery-card.test.tsx`: change `GALLERY_DEFAULT_TABS.length` assertion from 5 to 6; update "registers all five gallery componentIds" to include `gallery-default-button` (test title and id list); update "gallery-buttons has defaultTabs with five entries" count to 6; update "creates a card with five tabs" describe/test titles and assertions to six; add `gallery-default-button` to all componentId enumeration lists
- [ ] Update `component-gallery.test.tsx`: update "registers all five gallery componentIds" to include `gallery-default-button` (test title and id list); update "gallery-buttons has defaultTabs with five tabs" count to 6; update "all five gallery registrations have family 'developer'" and "all five gallery registrations have acceptsFamilies" to include `gallery-default-button` in their id lists and update titles to say "six"
- [ ] Verify the demo works: clicking outside buttons and pressing Enter triggers the Confirm button

**Tests:**
- [ ] Manual: open Component Gallery, navigate to Default Button tab, press Enter -- Confirm button activates
- [ ] Manual: click on Cancel button -- Cancel clicked message appears, Enter still activates Confirm
- [ ] Manual: verify primary button (accent fill) and destructive button styling are both visible in the gallery

**Checkpoint:**
- [ ] Gallery default-button demo is functional and Enter-key activation works end-to-end
- [ ] `cd tugdeck && bun test` -- all existing tests still pass

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Default button stack, [D02] Enter-key stage-2, [D03] Destructive variant fix, [D04] Synthetic click, Spec S01, Spec S02, Spec S03 (#success-criteria)

**Tasks:**
- [ ] Verify all success criteria are met
- [ ] Verify default button stack works with nested registrations (gallery demo or test)
- [ ] Verify Enter does not interfere with text inputs, native buttons, or contenteditable
- [ ] Verify destructive and primary variants are visually distinct in all three themes
- [ ] Verify no Rules of Tug violations: no `root.render()` calls, useSyncExternalStore for external state, useLayoutEffect for registrations

**Tests:**
- [ ] All tests pass: `cd tugdeck && bun test`
- [ ] Gallery visual inspection across dawn, dusk, night themes

**Checkpoint:**
- [ ] `cd tugdeck && bun test` -- full test suite green
- [ ] Gallery demo functional in all three themes

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Default button infrastructure in ResponderChainManager with Enter-key activation, ready for Phase 8a components to wire into.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `setDefaultButton` / `clearDefaultButton` / `getDefaultButton` methods exist on ResponderChainManager with stack semantics (unit tests pass)
- [ ] Enter key activates the topmost default button when no native input/button is focused (integration tests pass)
- [ ] Destructive variant has explicit red fill + white text in `tug-button.css` (visual verification)
- [ ] Gallery demo tab shows default button mechanism working end-to-end
- [ ] All existing tests continue to pass (`cd tugdeck && bun test`)

**Acceptance tests:**
- [ ] `cd tugdeck && bun test src/__tests__/default-button.test.tsx` -- all default-button tests pass
- [ ] `cd tugdeck && bun test` -- full test suite passes (no regressions)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 8a: TugConfirmPopover registers confirm button as default on open
- [ ] Phase 8a: TugAlertHost wires role-based default button logic (cancel for destructive, default for standard)
- [ ] Phase 8a: TugSheetHost wires same role-based default button logic
- [ ] Phase 8a: `useDefaultButton(ref)` convenience hook wrapping setDefaultButton/clearDefaultButton in useLayoutEffect

| Checkpoint | Verification |
|------------|--------------|
| Default button stack | `cd tugdeck && bun test src/__tests__/default-button.test.tsx` |
| Enter-key pipeline | `cd tugdeck && bun test src/__tests__/default-button.test.tsx` |
| Full regression | `cd tugdeck && bun test` |
| Visual verification | Gallery demo in all three themes |
