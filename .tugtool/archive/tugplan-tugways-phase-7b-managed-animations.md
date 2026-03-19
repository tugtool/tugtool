<!-- tugplan-skeleton v2 -->

## Tugways Phase 7b: Managed Animations + Skeleton Loading {#managed-animations}

**Purpose:** Migrate three programmatic @keyframes animations (flash overlay, dropdown blink, button spinner) to TugAnimator, implement standalone TugSkeleton component with CSS shimmer, remove dead keyframes, and enforce the Rule 13/14 animation boundary.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-7b-managed-animations |
| Last updated | 2026-03-10 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 7a established TugAnimator as the single programmatic animation engine for tugways, wrapping WAAPI with completion promises, cancellation modes, named animation slots, and physics solvers. Three existing @keyframes animations in the codebase need completion handlers or cancellation that CSS cannot provide: the flash overlay (needs cleanup after fade-out), the dropdown blink (needs sequenced close-after-blink), and the button spinner (dead code — already replaced by tug-petals CSS). Additionally, skeleton loading states are a design system gap: cards currently show blank content while waiting for data.

This phase draws a clear line between CSS-only motion (continuous, Radix-managed, no completion needed) and TugAnimator motion (completion, cancellation, coordination). Rules 13 and 14 from the Rules of Tugways define this boundary. Every animation in the codebase must land in exactly one lane.

#### Strategy {#strategy}

- Migrate flash overlay animations first — they are the most complex (two functions: `flashSetPerimeter` for SVG hull flash, `flashCardPerimeter` for card break-out flash), both currently using `animationend` listeners for DOM cleanup.
- Migrate dropdown blink second — replace `setTimeout` + CSS class sequencing with `TugAnimator.animate().finished` for clean completion-based close.
- Remove dead `@keyframes tug-button-spin` from tug-button.css — the Spinner component already uses `tug-petals` (CSS, continuous, Rule 13 compliant).
- Build standalone `TugSkeleton` component with CSS shimmer (`@keyframes td-shimmer` + `background-attachment: fixed` for cross-element synchronization) — defer crossfade wiring to Phase 8c per user direction.
- Add missing skeleton shimmer token (`--tug-base-skeleton-base`, `--tug-base-skeleton-highlight`) to `bluenote.css` — Brio and Harmony already define these tokens in `tug-tokens.css` and `harmony.css` respectively.
- Validate the animation boundary: audit every `@keyframes` and `requestAnimationFrame` usage in the codebase and confirm each one is in the correct lane per Rule 13/14.

#### Success Criteria (Measurable) {#success-criteria}

- Flash overlay cleanup uses `TugAnimator.animate().finished` instead of `animationend` listener — verified by searching for `animationend` in `card-frame.tsx` (zero matches after migration)
- Dropdown blink uses `TugAnimator.animate().finished` instead of `setTimeout` — verified by searching for `setTimeout` in `tug-dropdown.tsx` (zero matches after migration)
- `@keyframes tug-button-spin` is removed from `tug-button.css` — verified by `grep tug-button-spin tugdeck/src/` (zero matches)
- `@keyframes set-flash-fade` is removed from `chrome.css` — verified by `grep set-flash-fade tugdeck/styles/` (zero matches)
- `@keyframes tug-dropdown-blink` is removed from `tug-dropdown.css` — verified by `grep tug-dropdown-blink tugdeck/src/` (zero matches)
- `TugSkeleton` component renders shimmer elements with `background-attachment: fixed` — verified by unit test
- Skeleton shimmer tokens exist in all three theme files — verified by `grep -r tug-base-skeleton tugdeck/styles/` returning 6 matches (2 tokens x 3 files: `tug-tokens.css`, `bluenote.css`, `harmony.css`)
- All existing tests pass: `cd tugdeck && bun test`
- Gallery card TugAnimator section displays migrated flash animation as a demo — verified visually

#### Scope {#scope}

1. Migrate `flashSetPerimeter` and `flashCardPerimeter` in `card-frame.tsx` from CSS `animationend` to `TugAnimator.animate().finished`
2. Migrate dropdown blink in `tug-dropdown.tsx` from `setTimeout` + CSS class to `TugAnimator.animate().finished`
3. Remove dead `@keyframes tug-button-spin` from `tug-button.css`
4. Remove `@keyframes set-flash-fade` from `chrome.css` (animation now driven by TugAnimator)
5. Remove `@keyframes tug-dropdown-blink` from `tug-dropdown.css` (animation now driven by TugAnimator)
6. Create `TugSkeleton` component with CSS shimmer in `tugdeck/src/components/tugways/tug-skeleton.tsx` and `tug-skeleton.css`
7. Add missing Bluenote skeleton shimmer tokens to `bluenote.css` (Brio and Harmony already have them)
8. Add TugSkeleton to the gallery card
9. Animation boundary audit — document which animations are in which lane

#### Non-goals (Explicitly out of scope) {#non-goals}

- Migrating gallery petals/pole animations to TugAnimator (Rule 13 — continuous, infinite, stay as CSS)
- Migrating any rAF loops to TugAnimator (Rule 13 — gesture-driven, not animations)
- Touching Radix-managed enter/exit animations (Rule 14 — Radix Presence owns that boundary)
- Skeleton-to-content crossfade wiring (deferred to Phase 8c per user direction)
- Per-card skeleton shapes (Phase 8c — requires card content components that do not exist yet)
- Startup continuity / flash elimination (Phase 7c)

#### Dependencies / Prerequisites {#dependencies}

- Phase 7a complete: `tug-animator.ts` with `animate()`, `group()`, named slots, completion promises (confirmed shipped)
- `physics.ts` with SpringSolver, GravitySolver, FrictionSolver (confirmed shipped)
- `scale-timing.ts` with `getTugTiming()` and `isTugMotionEnabled()` (confirmed present)
- Motion tokens in `tug-tokens.css`: `--tug-base-motion-duration-fast/moderate/slow/glacial`, `--tug-base-motion-easing-standard` (confirmed present)

#### Constraints {#constraints}

- Flash overlays are imperative DOM elements (not React-managed) — TugAnimator operates on raw DOM elements, which is the correct fit
- Dropdown blink must still prevent Radix from closing during the animation — the `event.preventDefault()` guard stays; only the timing mechanism changes
- `tug-petals` CSS animation must remain untouched (continuous, infinite, Rule 13)
- Skeleton shimmer must use CSS `@keyframes` with `background-attachment: fixed` — not TugAnimator (continuous, synchronized, Rule 13)
- Token prefix is `--tug-base-*` matching current `tug-tokens.css` state

#### Assumptions {#assumptions}

- `TugAnimator.animate()` works correctly on elements that are dynamically created and appended to the DOM (flash overlays are created imperatively)
- The `animate().finished` promise resolves after the WAAPI animation completes, enabling reliable DOM cleanup
- `background-attachment: fixed` is supported in all target browsers for shimmer synchronization
- The gallery card can be extended with a TugSkeleton demo section without architectural changes

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Skeleton token derivation (DECIDED) {#q01-skeleton-tokens}

**Question:** Should skeleton shimmer colors be derived from existing surface tokens via relative color syntax, or defined as standalone tokens per theme?

**Why it matters:** Relative color derivation means fewer tokens to maintain but ties shimmer appearance to surface colors. Standalone tokens allow independent tuning per theme.

**Options (if known):**
- Relative color syntax: `oklch(from var(--tug-base-surface-1) l a b / 0.5)` — fewer tokens, less flexibility
- Standalone tokens: `--tug-base-skeleton-base`, `--tug-base-skeleton-highlight` — more tokens, full control

**Plan to resolve:** Follow the design doc's approach (standalone semantic tokens).

**Resolution:** DECIDED — see [D05]. Standalone tokens per theme, following the design document's specification.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| WAAPI on dynamically-appended elements | med | low | Test with a minimal repro in the browser before full migration | Animation does not play on appended overlay |
| Flash overlay race with drag | med | low | TugAnimator named slots ensure only one flash animation per element at a time | Overlapping flashes during fast drag sequences |
| Dropdown blink timing change | low | low | The old code had a 50ms mismatch: CSS animation was 200ms (`--tug-base-motion-duration-moderate`) but `setTimeout` was 250ms. TugAnimator unifies both to 200ms via `--tug-base-motion-duration-moderate`, eliminating the drift. The 50ms reduction in total wait is imperceptible. | Blink feels different after migration |

**Risk R01: WAAPI on dynamic DOM elements** {#r01-waapi-dynamic}

- **Risk:** WAAPI `element.animate()` may not work correctly on elements that were just appended to the DOM in the same microtask.
- **Mitigation:** Flash overlay functions already append the element before starting the animation. WAAPI spec guarantees `animate()` works on connected elements. Verify in the first step with a manual browser test.
- **Residual risk:** None expected — WAAPI on connected elements is well-specified.

---

### Design Decisions {#design-decisions}

#### [D01] Flash overlays migrate to TugAnimator.animate().finished for cleanup (DECIDED) {#d01-flash-to-animator}

**Decision:** Replace `animationend` listeners in `flashSetPerimeter` and `flashCardPerimeter` with `TugAnimator.animate().finished` promise-based DOM cleanup.

**Rationale:**
- `animationend` is unreliable — can be missed if the element is removed from the DOM, if CSS is modified, or if the animation is interrupted
- `TugAnimator.animate().finished` provides a real promise that resolves reliably
- Aligns with Rule 13: flash overlays need completion-based cleanup (programmatic lane)

**Implications:**
- `@keyframes set-flash-fade` removed from `chrome.css` — the opacity fade is now expressed as WAAPI keyframes
- `.card-flash-overlay` and `.set-flash-svg` CSS rules lose their `animation:` property — opacity is driven by WAAPI
- `flashSetPerimeter` and `flashCardPerimeter` become async (fire-and-forget, no callers await)

#### [D02] Dropdown blink migrates to TugAnimator with animate().finished sequencing (DECIDED) {#d02-blink-to-animator}

**Decision:** Replace `setTimeout` + CSS class in the dropdown blink with `TugAnimator.animate()` driving the background-color keyframes, using `.finished` to sequence the menu close.

**Rationale:**
- `setTimeout(250)` is a timing guess, not a contract — if the system is under load, the timeout fires before/after the CSS animation ends
- `TugAnimator.animate().finished` resolves exactly when the animation completes
- The blink animation needs completion sequencing (close menu after blink), which is the defining criterion for TugAnimator (Rule 13)

**Implications:**
- `@keyframes tug-dropdown-blink` removed from `tug-dropdown.css`
- `.tug-dropdown-item-selected` class no longer needed for animation — may keep for static highlight if desired
- `BLINK_DURATION_MS` constant replaced by motion token resolution through TugAnimator

#### [D03] Dead tug-button-spin keyframes removed; tug-petals stays as CSS (DECIDED) {#d03-remove-dead-spin}

**Decision:** Remove the dead `@keyframes tug-button-spin` and `.tug-button-spinner` CSS. The Spinner component already uses `tug-petals` (CSS, continuous rotation), which stays as CSS per Rule 13.

**Rationale:**
- `tug-button-spin` is dead code — no element has the `.tug-button-spinner` class; the Spinner renders `tug-petals` markup instead
- `tug-petals` is a continuous, infinite rotation — no completion handler or cancellation needed — CSS is the correct lane (Rule 13)
- Removing dead code reduces confusion about which animation mechanism is in use

**Implications:**
- `@keyframes tug-button-spin` and `.tug-button-spinner` removed from `tug-button.css`
- No functional change — the Spinner component is already using `tug-petals`

#### [D04] TugSkeleton is a standalone component with CSS shimmer only (DECIDED) {#d04-skeleton-standalone}

**Decision:** Create `TugSkeleton` as a standalone React component that renders shimmer placeholders using CSS `@keyframes td-shimmer` + `background-attachment: fixed`. Crossfade wiring (skeleton-to-content transition) is deferred to Phase 8c.

**Rationale:**
- Skeleton shimmer is continuous and infinite — CSS `@keyframes` is the correct lane (Rule 13)
- `background-attachment: fixed` synchronizes all shimmer elements across the viewport
- Crossfade to content requires card content components that do not exist yet — deferring avoids premature abstraction
- Per user direction: standalone component + CSS shimmer only; defer crossfade to Phase 8c

**Implications:**
- `TugSkeleton` renders one or more `.tug-skeleton` div elements with configurable width/height
- `TugSkeletonGroup` wraps multiple skeleton elements with consistent spacing
- No `Tugcard` integration in this phase — TugSkeleton is gallery-only until Phase 8c
- Missing Bluenote shimmer tokens added to `bluenote.css` (Brio and Harmony already have them)

#### [D05] Skeleton tokens are standalone per-theme values (DECIDED) {#d05-skeleton-tokens}

**Decision:** Define `--tug-base-skeleton-base` and `--tug-base-skeleton-highlight` as standalone tokens in each theme file, not derived via relative color syntax. Brio tokens live in `tug-tokens.css`, Bluenote in `bluenote.css`, Harmony in `harmony.css`.

**Rationale:**
- Standalone tokens allow independent tuning of shimmer colors per theme (Brio dark gray vs Harmony warm tan)
- Follows the design document's approach: subtle, theme-aware shimmer
- Avoids browser compatibility concerns with `oklch(from ...)` relative color syntax

**Implications:**
- Brio and Harmony already define these tokens (`tug-tokens.css:535-536`, `harmony.css:228-229`) — only Bluenote (`bluenote.css`) needs additions
- Token values chosen to match each theme's surface color family with subtle contrast

---

### Specification {#specification}

#### Animation Boundary Audit {#animation-boundary-audit}

**Table T01: Animation Lane Assignment** {#t01-animation-lanes}

| Animation | Current Mechanism | Target Lane | Rationale |
|-----------|------------------|-------------|-----------|
| Flash overlay fade (`set-flash-fade`) | CSS @keyframes + `animationend` | **TugAnimator** | Needs completion for DOM cleanup |
| Dropdown blink (`tug-dropdown-blink`) | CSS @keyframes + `setTimeout` | **TugAnimator** | Needs completion for menu close sequencing |
| Button spinner (`tug-button-spin`) | CSS @keyframes (dead code) | **Remove** | Dead code; Spinner uses `tug-petals` already |
| Tug-petals fade (`tug-petals-fade`) | CSS @keyframes | **CSS (keep)** | Continuous, infinite, no completion needed (Rule 13) |
| Tug-petals scale (`tug-petals-scale`) | CSS @keyframes | **CSS (keep)** | Continuous, infinite (Rule 13) |
| Tug-petals rotate (`tug-petals-rotate`) | CSS @keyframes | **CSS (keep)** | Continuous, infinite (Rule 13) |
| Gallery pole scroll (`tug-pole-scroll`) | CSS @keyframes | **CSS (keep)** | Continuous, infinite (Rule 13) |
| Skeleton shimmer (`td-shimmer`) | New CSS @keyframes | **CSS (new)** | Continuous, synchronized via `background-attachment: fixed` (Rule 13) |
| Radix enter/exit (`tw-animate-css` plugin) | CSS @keyframes from `tw-animate-css` Tailwind plugin (external, not defined in project CSS) + `data-state` | **CSS (keep)** | Radix Presence depends on `animationend` (Rule 14) |
| Card drag/resize rAF | `requestAnimationFrame` | **rAF (keep)** | Gesture-driven frame loop (Rule 13) |
| Selection guard autoscroll rAF | `requestAnimationFrame` | **rAF (keep)** | Gesture-driven frame loop (Rule 13) |
| Tab drag coordinator rAF | `requestAnimationFrame` | **rAF (keep)** | Gesture-driven frame loop (Rule 13) |
| Tab bar overflow detection rAF | `requestAnimationFrame` | **rAF (keep)** | Layout measurement loop (Rule 13) |

#### TugSkeleton Component API {#skeleton-api}

**Spec S01: TugSkeleton Props** {#s01-skeleton-props}

```typescript
interface TugSkeletonProps {
  /** Width of the skeleton element. CSS value string (e.g., "60%", "100px"). Default: "100%" */
  width?: string;
  /** Height in pixels. Default: 14 */
  height?: number;
  /** Border radius override. Default: uses --tug-base-radius-sm token */
  radius?: string;
  /** Additional CSS class names */
  className?: string;
}

interface TugSkeletonGroupProps {
  /** Gap between skeleton elements in pixels. Default: 8 */
  gap?: number;
  /** Child TugSkeleton elements */
  children: React.ReactNode;
  /** Additional CSS class names */
  className?: string;
}
```

#### Flash Migration Detail {#flash-migration-detail}

**Spec S02: flashCardPerimeter migration** {#s02-flash-card}

Before (current):
```typescript
export function flashCardPerimeter(cardFrameEl: HTMLElement): void {
  const overlay = document.createElement("div");
  overlay.classList.add("card-flash-overlay");
  overlay.addEventListener("animationend", () => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  });
  cardFrameEl.appendChild(overlay);
}
```

After (migrated):
```typescript
export function flashCardPerimeter(cardFrameEl: HTMLElement): void {
  const overlay = document.createElement("div");
  overlay.classList.add("card-flash-overlay");
  cardFrameEl.appendChild(overlay);
  animate(overlay, [{ opacity: 1 }, { opacity: 0 }], {
    duration: "--tug-base-motion-duration-glacial",
    easing: "ease-out",
    fill: "forwards",
  }).finished.then(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  });
}
```

**Spec S03: flashSetPerimeter migration** {#s03-flash-set}

Same pattern as S02: the SVG element is appended first, then `animate(svg, [{opacity: 1}, {opacity: 0}], { duration: '--tug-base-motion-duration-glacial', easing: 'ease-out', fill: 'forwards' })` drives the opacity fade, and `.finished.then()` removes the SVG from the DOM. The `--tug-base-motion-duration-glacial` token resolves to 500ms, matching the existing CSS `animation: set-flash-fade 0.5s` timing exactly. Note: `flashSetPerimeter` creates an SVG element via `document.createElementNS`. WAAPI `element.animate()` works on SVG elements for the `opacity` property. TugAnimator's `commitStyles()` sets `el.style.opacity`, which is valid for SVG elements (the `style` attribute is a valid SVG attribute for presentation properties). The SVG element's initial opacity is 1 by default, matching the first keyframe.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tug-skeleton.tsx` | TugSkeleton and TugSkeletonGroup React components |
| `tugdeck/src/components/tugways/tug-skeleton.css` | Shimmer keyframes and skeleton element styles |
| `tugdeck/src/__tests__/tug-skeleton.test.tsx` | Unit tests for TugSkeleton component |
| `tugdeck/src/__tests__/tug-dropdown.test.tsx` | Basic test for TugDropdown blink-then-close behavior |
| `tugdeck/src/components/tugways/cards/gallery-skeleton-content.tsx` | Gallery tab for TugSkeleton shimmer demo |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugSkeleton` | component | `tug-skeleton.tsx` | Renders a single shimmer placeholder |
| `TugSkeletonGroup` | component | `tug-skeleton.tsx` | Wraps multiple TugSkeleton elements with spacing |
| `flashSetPerimeter` | fn (modify) | `card-frame.tsx` | Replace `animationend` with `animate().finished` |
| `flashCardPerimeter` | fn (modify) | `card-frame.tsx` | Replace `animationend` with `animate().finished` |
| `handleItemSelect` | fn (modify) | `tug-dropdown.tsx` | Replace `setTimeout` with `animate().finished` |
| `--tug-base-skeleton-base` | CSS token (add) | `bluenote.css` | Shimmer base color — already exists in `tug-tokens.css` (Brio) and `harmony.css` |
| `--tug-base-skeleton-highlight` | CSS token (add) | `bluenote.css` | Shimmer highlight color — already exists in `tug-tokens.css` (Brio) and `harmony.css` |

---

### Documentation Plan {#documentation-plan}

- [ ] Add TugSkeleton to the gallery card with shimmer demo
- [ ] Document animation boundary decision in code comments (which lane each animation is in and why)

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test TugSkeleton renders correct DOM structure and CSS classes | Component rendering, props |
| **Integration** | Test flash migration produces correct TugAnimator calls | Flash overlay + TugAnimator interaction |
| **Drift Prevention** | Verify no `animationend` listeners remain in migrated code | Animation boundary enforcement |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Remove dead tug-button-spin keyframes {#step-1}

**Commit:** `refactor: remove dead @keyframes tug-button-spin from tug-button.css`

**References:** [D03] Dead tug-button-spin removal, Table T01 (#t01-animation-lanes), (#context, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-button.css` — remove `@keyframes tug-button-spin` and `.tug-button-spinner` class

**Tasks:**
- [ ] Remove `@keyframes tug-button-spin { ... }` block from `tug-button.css`
- [ ] Remove `.tug-button-spinner` CSS class from `tug-button.css`
- [ ] Verify no other files reference `tug-button-spin` or `.tug-button-spinner`

**Tests:**
- [ ] Existing `tug-button.test.tsx` tests still pass (Spinner uses `tug-petals`, not `tug-button-spinner`)

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tug-button.test.tsx`
- [ ] `grep -r "tug-button-spin" tugdeck/src/` returns zero matches

---

#### Step 2: Migrate flashCardPerimeter to TugAnimator {#step-2}

**Depends on:** #step-1

**Commit:** `feat: migrate flashCardPerimeter to TugAnimator.animate().finished cleanup`

**References:** [D01] Flash overlays to TugAnimator, Spec S02 (#s02-flash-card), Table T01 (#t01-animation-lanes), (#flash-migration-detail)

**Artifacts:**
- Modified `tugdeck/src/components/chrome/card-frame.tsx` — `flashCardPerimeter` uses `animate()` instead of `animationend`
- Modified `tugdeck/styles/chrome.css` — `.card-flash-overlay` loses `animation:` property

**Tasks:**
- [ ] Import `animate` from `tug-animator.ts` in `card-frame.tsx`
- [ ] Rewrite `flashCardPerimeter` to use `animate(overlay, [{opacity: 1}, {opacity: 0}], { duration: '--tug-base-motion-duration-glacial', easing: 'ease-out', fill: 'forwards' }).finished.then(() => remove overlay)` — `glacial` resolves to 500ms, matching the existing CSS `animation: set-flash-fade 0.5s` timing exactly
- [ ] Remove `animation: set-flash-fade ...` from `.card-flash-overlay` CSS rule (keep the styling: position, inset, border, box-shadow, z-index, pointer-events)
- [ ] Remove the `animationend` event listener from `flashCardPerimeter`

**Tests:**
- [ ] Existing card-frame tests still pass
- [ ] Manual verification: drag a card out of a set, observe break-out flash and overlay cleanup

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep "animationend" tugdeck/src/components/chrome/card-frame.tsx` — verify count decreased by 1 (flashCardPerimeter listener removed)

---

#### Step 3: Migrate flashSetPerimeter to TugAnimator {#step-3}

**Depends on:** #step-2

**Commit:** `feat: migrate flashSetPerimeter to TugAnimator.animate().finished cleanup`

**References:** [D01] Flash overlays to TugAnimator, Spec S03 (#s03-flash-set), Table T01 (#t01-animation-lanes), (#flash-migration-detail)

**Artifacts:**
- Modified `tugdeck/src/components/chrome/card-frame.tsx` — `flashSetPerimeter` uses `animate()` instead of `animationend`
- Modified `tugdeck/styles/chrome.css` — `.set-flash-svg` loses `animation:` property

**Tasks:**
- [ ] Rewrite `flashSetPerimeter` SVG cleanup to use `animate(svg, [{opacity: 1}, {opacity: 0}], { duration: '--tug-base-motion-duration-glacial', easing: 'ease-out', fill: 'forwards' }).finished.then(() => remove SVG)` — `glacial` resolves to 500ms, matching the existing CSS `animation: set-flash-fade 0.5s` timing exactly
- [ ] Note: WAAPI `element.animate()` works on SVG namespace elements for the `opacity` property. TugAnimator's `commitStyles()` sets `el.style.opacity`, which is valid for SVG elements (SVG supports the `style` attribute for presentation properties). The SVG's initial opacity is 1 by default, so the `[{opacity:1}, {opacity:0}]` keyframes produce the correct visual from creation time.
- [ ] Remove `animation: set-flash-fade ...` from `.set-flash-svg` CSS rule (keep position, overflow, pointer-events, z-index)
- [ ] Remove the `animationend` event listener from `flashSetPerimeter`
- [ ] Update the `flashSetPerimeter` JSDoc comment (line ~1574) from "Self-removes on animationend" to "Self-removes on animate().finished" — the Step 6 checkpoint greps for zero `animationend` matches in `card-frame.tsx`, so stale comments will fail the checkpoint

**Tests:**
- [ ] Existing tests still pass
- [ ] Manual verification: snap two cards together, observe set hull flash and SVG cleanup

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep "animationend" tugdeck/src/components/chrome/card-frame.tsx` — zero matches (both flash listeners removed)

---

#### Step 4: Remove @keyframes set-flash-fade from chrome.css {#step-4}

**Depends on:** #step-3

**Commit:** `refactor: remove @keyframes set-flash-fade (now driven by TugAnimator)`

**References:** [D01] Flash overlays to TugAnimator, Table T01 (#t01-animation-lanes)

**Artifacts:**
- Modified `tugdeck/styles/chrome.css` — `@keyframes set-flash-fade` block removed

**Tasks:**
- [ ] Remove `@keyframes set-flash-fade { ... }` block from `chrome.css`
- [ ] Verify no CSS rules reference `set-flash-fade` (the `animation:` properties were already removed in Steps 2 and 3)

**Tests:**
- [ ] Existing tests still pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep -r "set-flash-fade" tugdeck/` returns zero matches

---

#### Step 5: Migrate dropdown blink to TugAnimator {#step-5}

**Depends on:** #step-4

**Commit:** `feat: migrate dropdown blink to TugAnimator.animate().finished sequencing`

**References:** [D02] Dropdown blink to TugAnimator, Table T01 (#t01-animation-lanes), (#animation-boundary-audit)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-dropdown.tsx` — `handleItemSelect` uses `animate().finished` instead of `setTimeout`
- Modified `tugdeck/src/components/tugways/tug-dropdown.css` — `@keyframes tug-dropdown-blink` and `.tug-dropdown-item-selected` removed

**Tasks:**
- [ ] Import `animate` from `tug-animator.ts` in `tug-dropdown.tsx`
- [ ] Rewrite `handleItemSelect` to use `animate(target, blinkKeyframes, { duration: '--tug-base-motion-duration-moderate', easing: 'cubic-bezier(0.2, 0, 0, 1)' }).finished.then(() => { blinkingRef.current = false; onSelect(id); dispatch Escape })` where blinkKeyframes reproduces the double-blink pattern: `[{backgroundColor: surfaceDefault}, {backgroundColor: 'transparent'}, {backgroundColor: surfaceDefault}, {backgroundColor: surfaceDefault}]`. Critical: `blinkingRef.current = false` must be reset inside the `.finished.then()` callback before calling `onSelect` — the dropdown trigger persists after menu close, so without the reset, all subsequent selections would be blocked by the re-entrancy guard. Note: the easing must be a raw CSS easing function, not a `var()` reference — WAAPI does not resolve CSS custom properties in easing strings. The value `cubic-bezier(0.2, 0, 0, 1)` matches `--tug-base-motion-easing-standard` from `tug-tokens.css`. Alternatively, read it at runtime via `getComputedStyle(target).getPropertyValue('--tug-base-motion-easing-standard').trim()`.
- [ ] Read `--tug-base-surface-default` via `getComputedStyle(target).getPropertyValue('--tug-base-surface-default').trim()` to get the resolved (computed) color value for WAAPI keyframes — `.trim()` is required because `getPropertyValue()` returns a string with leading whitespace per CSS spec. The returned value is the `--tug-color()` expanded `oklch()` result, which WAAPI can interpolate directly. WAAPI cannot interpolate CSS variable references.
- [ ] Remove `BLINK_DURATION_MS` constant
- [ ] Remove `@keyframes tug-dropdown-blink` from `tug-dropdown.css`
- [ ] Remove `.tug-dropdown-item-selected` class from `tug-dropdown.css`
- [ ] Remove `setTimeout` call from `handleItemSelect`
- [ ] Keep `blinkingRef` guard to prevent re-entrant blink animations
- [ ] Keep `event.preventDefault()` to prevent Radix from closing during blink

**Tests:**
- [ ] No existing `tug-dropdown.test.tsx` exists — create a basic test verifying that `TugDropdown` renders and that clicking an item triggers `onSelect` (with animation mocked via the WAAPI mock in `setup-rtl.ts`)
- [ ] Manual verification: click a dropdown item, observe double-blink then menu close

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep "setTimeout" tugdeck/src/components/tugways/tug-dropdown.tsx` returns zero matches
- [ ] `grep "tug-dropdown-blink" tugdeck/src/` returns zero matches

---

#### Step 6: Flash + Blink Migration Integration Checkpoint {#step-6}

**Depends on:** #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Flash overlays to TugAnimator, [D02] Blink to TugAnimator, [D03] Dead spin removal, Table T01 (#t01-animation-lanes), (#success-criteria)

**Tasks:**
- [ ] Verify all three @keyframes blocks are gone: `set-flash-fade`, `tug-dropdown-blink`, `tug-button-spin`
- [ ] Verify no `animationend` listeners remain in card-frame.tsx
- [ ] Verify no `setTimeout` remains in tug-dropdown.tsx
- [ ] Verify tug-petals CSS animation is untouched

**Tests:**
- [ ] Full test suite passes

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep -r "@keyframes set-flash-fade\|@keyframes tug-dropdown-blink\|@keyframes tug-button-spin" tugdeck/src/ tugdeck/styles/` returns zero matches
- [ ] `grep "animationend" tugdeck/src/components/chrome/card-frame.tsx` returns zero matches

---

#### Step 7: Add missing Bluenote skeleton shimmer tokens {#step-7}

**Depends on:** #step-1

**Commit:** `feat: add skeleton shimmer tokens to bluenote.css`

**References:** [D04] TugSkeleton standalone, [D05] Skeleton tokens standalone, (#skeleton-api)

**Artifacts:**
- Modified `tugdeck/styles/bluenote.css` — new `--tug-base-skeleton-base` and `--tug-base-skeleton-highlight` tokens

**Tasks:**
- [ ] Verify Brio tokens already exist in `tug-tokens.css` (lines 535-536: `--tug-base-skeleton-base`, `--tug-base-skeleton-highlight`)
- [ ] Verify Harmony tokens already exist in `harmony.css` (lines 228-229)
- [ ] Add `--tug-base-skeleton-base` and `--tug-base-skeleton-highlight` to `bluenote.css` — matching Bluenote's cool surface palette (use `--tug-color()` notation consistent with existing Bluenote tokens)
- [ ] Values should provide subtle contrast: base is close to Bluenote's card background, highlight is slightly lighter

**Tests:**
- [ ] Tokens are parseable CSS — build succeeds
- [ ] `grep -r "tug-base-skeleton" tugdeck/styles/` returns 6 matches (2 tokens in each of `tug-tokens.css`, `bluenote.css`, `harmony.css`)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] `grep -rc "tug-base-skeleton" tugdeck/styles/tug-tokens.css tugdeck/styles/bluenote.css tugdeck/styles/harmony.css` outputs 2 for each file

---

#### Step 8: Create TugSkeleton component and CSS {#step-8}

**Depends on:** #step-7

**Commit:** `feat: add TugSkeleton component with CSS shimmer`

**References:** [D04] TugSkeleton standalone, [D05] Skeleton tokens, Spec S01 (#s01-skeleton-props), (#skeleton-api)

**Artifacts:**
- New `tugdeck/src/components/tugways/tug-skeleton.tsx` — TugSkeleton and TugSkeletonGroup components
- New `tugdeck/src/components/tugways/tug-skeleton.css` — shimmer keyframes and skeleton element styles
- New `tugdeck/src/__tests__/tug-skeleton.test.tsx` — unit tests

**Tasks:**
- [ ] Create `tug-skeleton.css` with:
  - `.tug-skeleton` class: `linear-gradient` shimmer background using `--tug-base-skeleton-base` and `--tug-base-skeleton-highlight` tokens, `background-size: 200% 100%`, `background-attachment: fixed`, `animation: td-shimmer calc(var(--tug-base-motion-duration-glacial) * 1.5) ease-in-out infinite`, `border-radius: var(--tug-base-radius-sm)`
  - `@keyframes td-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`
  - `.tug-skeleton-group` class: flex column layout with configurable gap
  - No explicit `@media (prefers-reduced-motion)` rule needed — the global `body[data-tug-motion="off"] * { animation-duration: 0s !important }` rule in `tug-tokens.css` already suppresses all CSS animations (including shimmer) when reduced motion is active. The skeleton renders as a static placeholder in that case.
- [ ] Create `tug-skeleton.tsx` with:
  - `TugSkeleton` component rendering a `<div className="tug-skeleton">` with width/height/radius from props
  - `TugSkeletonGroup` component rendering a `<div className="tug-skeleton-group">` with gap from props
- [ ] Import `tug-skeleton.css` in the component file
- [ ] Create `tug-skeleton.test.tsx` testing:
  - TugSkeleton renders with correct CSS class and inline dimensions
  - TugSkeletonGroup renders children with correct gap
  - Default props produce expected output

**Tests:**
- [ ] `TugSkeleton` renders a div with class `tug-skeleton`
- [ ] `TugSkeleton` applies width and height as inline styles
- [ ] `TugSkeletonGroup` renders children within a `.tug-skeleton-group` container

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tug-skeleton.test.tsx`
- [ ] `cd tugdeck && bun test`

---

#### Step 9: Add TugSkeleton to gallery card {#step-9}

**Depends on:** #step-8

**Commit:** `feat: add TugSkeleton shimmer demo to gallery card`

**References:** [D04] TugSkeleton standalone, Spec S01 (#s01-skeleton-props), (#documentation-plan)

**Artifacts:**
- New `tugdeck/src/components/tugways/cards/gallery-skeleton-content.tsx` — standalone TugSkeleton gallery tab
- Modified `tugdeck/src/components/tugways/cards/gallery-card.tsx` — register new skeleton tab

**Tasks:**
- [ ] Create `gallery-skeleton-content.tsx` as a new gallery tab (TugSkeleton uses CSS shimmer per Rule 13, not TugAnimator, so it gets its own tab rather than being placed in the animator tab)
- [ ] Add a `registerCard()` call in `registerGalleryCards()` for the `"gallery-skeleton"` componentId, with `contentFactory` rendering `<GallerySkeletonContent />` and `defaultMeta: { title: "TugSkeleton", icon: "Loader", closable: true }`
- [ ] Add `{ id: "template", componentId: "gallery-skeleton", title: "TugSkeleton", closable: true }` to the `GALLERY_DEFAULT_TABS` array so the tab appears when a gallery card is opened
- [ ] Add demo sections showing TugSkeleton with various configurations:
  - Single skeleton element at different widths
  - TugSkeletonGroup with multiple elements mimicking text lines
  - Demonstrate `background-attachment: fixed` synchronization (multiple skeleton groups visible at once)
- [ ] Import TugSkeleton and TugSkeletonGroup components

**Tests:**
- [ ] Gallery card renders without errors
- [ ] Skeleton shimmer is visible and synchronized across elements

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] Visual verification: gallery card shows shimmer demo with synchronized animation

---

#### Step 10: Animation Boundary Audit and Final Verification {#step-10}

**Depends on:** #step-6, #step-9

**Commit:** `N/A (verification only)`

**References:** [D01] Flash to TugAnimator, [D02] Blink to TugAnimator, [D03] Dead spin removal, [D04] TugSkeleton standalone, Table T01 (#t01-animation-lanes), (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Audit all `@keyframes` in the codebase — each must be in the CSS lane per Table T01
- [ ] Audit all `requestAnimationFrame` usage — each must be in the rAF lane per Table T01
- [ ] Audit all `TugAnimator.animate()` calls — each must be for completion/cancellation/coordination
- [ ] Verify no `animationend` listeners remain in migrated code (card-frame.tsx)
- [ ] Verify no `setTimeout` timing workarounds remain in migrated code (tug-dropdown.tsx)

**Tests:**
- [ ] Full test suite passes
- [ ] All success criteria verified

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep -rn "animationend" tugdeck/src/components/chrome/card-frame.tsx` returns zero matches
- [ ] `grep -rn "setTimeout" tugdeck/src/components/tugways/tug-dropdown.tsx` returns zero matches
- [ ] `grep -rn "@keyframes tug-button-spin\|@keyframes set-flash-fade\|@keyframes tug-dropdown-blink" tugdeck/` returns zero matches

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three programmatic @keyframes animations migrated to TugAnimator with completion-based cleanup, dead button-spin keyframes removed, standalone TugSkeleton component with CSS shimmer shipping in the gallery, and animation boundary (Rule 13/14) enforced across the codebase.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero `animationend` listeners in `card-frame.tsx` (flash overlays use `animate().finished`)
- [ ] Zero `setTimeout` in `tug-dropdown.tsx` (blink uses `animate().finished`)
- [ ] Zero dead `@keyframes` (`tug-button-spin`, `set-flash-fade`, `tug-dropdown-blink` all removed)
- [ ] `TugSkeleton` component renders shimmer with `background-attachment: fixed` synchronization
- [ ] Skeleton tokens present in all three themes
- [ ] All animations in codebase are in the correct lane per Table T01
- [ ] Full test suite passes: `cd tugdeck && bun test`

**Acceptance tests:**
- [ ] Flash overlays (both set hull and card perimeter) animate and self-remove on completion
- [ ] Dropdown blink plays double-blink then closes menu
- [ ] Button spinner (tug-petals) continues working unchanged
- [ ] TugSkeleton shimmer is visible in gallery, synchronized across elements
- [ ] Gallery petals/pole animations are untouched (CSS, continuous)
- [ ] Radix enter/exit animations are untouched (CSS @keyframes)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 8c: Wire TugSkeleton into Tugcard with skeleton-to-content crossfade via TugAnimator
- [ ] Phase 8c: Per-card skeleton shapes (each card type defines its own skeleton structure)
- [ ] Phase 7c: Startup continuity — three-layer flash elimination

| Checkpoint | Verification |
|------------|--------------|
| Flash migration | `grep "animationend" card-frame.tsx` = 0 matches |
| Blink migration | `grep "setTimeout" tug-dropdown.tsx` = 0 matches |
| Dead keyframes removed | `grep "@keyframes tug-button-spin\|set-flash-fade\|tug-dropdown-blink" tugdeck/` = 0 |
| Skeleton component | `bun test tug-skeleton.test.tsx` passes |
| Full suite | `cd tugdeck && bun test` passes |
