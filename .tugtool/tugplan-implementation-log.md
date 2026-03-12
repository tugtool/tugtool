# Tug Implementation Log

This file documents the implementation progress for this project.

**Format:** Each entry records a completed step with tasks, files, and verification results.

Entries are sorted newest-first.

---

---
step: step-3
date: 2025-03-12T16:21:40Z
---

## step-3: Removed 3 surface-control definitions from tug-base.css, updated all var() call sites across 6 component CSS files, renamed overrides in bluenote.css and harmony.css, resolved duplicate harmony.css entries

**Files changed:**
- .tugtool/tugplan-semantic-token-vocabulary.md

---

---
step: step-2
date: 2025-03-12T16:13:59Z
---

## step-2: Renamed all --tug-base-action-* to --tug-base-control-* across 5 files, deleted redundant action-disabled-* tokens, added ~15 new control tokens (ghost, disabled, icon, selected, highlighted), fixed -fg-rest bug in style-inspector-overlay.ts

**Files changed:**
- .tugtool/tugplan-semantic-token-vocabulary.md

---

---
step: step-1
date: 2025-03-12T16:07:37Z
---

## step-1: Added 20 --tug-base-tone-* custom properties (positive/warning/danger/info × base/bg/fg/border/icon) in new Semantic Tones section C of tug-base.css

**Files changed:**
- .tugtool/tugplan-semantic-token-vocabulary.md

---

---
step: step-3
date: 2025-03-11T19:03:52Z
---

## step-3: Extracted card header into CardHeader component in chrome/. Implemented window-shade collapse with CSS height transition (content stays mounted per D07). Added collapse/menu/close buttons with 2.5D elevation. Wired collapse state through DeckManager.toggleCardCollapse() with serialization persistence. Added gallery-title-bar demo tab. Resize handles hidden when collapsed, drag remains active.

**Files changed:**
- .tugtool/tugplan-tugways-phase-8-radix-redesign.md

---

---
step: step-2
date: 2025-03-11T18:37:19Z
---

## step-2: Defined --tug-base-elevation-* tokens in tug-tokens.css with Brio defaults, Bluenote and Harmony theme overrides. Rewrote tug-button.css with full 2.5D pattern (inset highlight, bottom shadow, hover deepening, active press-down with translateY, disabled flat). Added 2.5D States demo tab to Component Gallery. Documented elevation pattern as Rule 15 in design-system-concepts.md. Resolved Q01 (no gradients).

**Files changed:**
- .tugtool/tugplan-tugways-phase-8-radix-redesign.md

---

---
step: step-1
date: 2025-03-11T18:20:26Z
---

## step-1: Removed all 13 shadcn ui/ components, shadcn-base.css, components.json, and CVA dependency. Rewrote TugButton to use plain <button> + Radix Slot. Rewrote TugDropdown to import @radix-ui/react-dropdown-menu directly. Migrated all --tug-comp-* tokens to --tug-<component>-* naming. Deleted tug-comp-tokens.css. Updated scaffold tests, style inspector, and legacy token checker.

**Files changed:**
- .tugtool/tugplan-tugways-phase-8-radix-redesign.md

---

---
step: step-11
date: 2025-03-11T02:37:41Z
---

## step-11: Final verification step. All automatable success criteria pass: tsc clean, build succeeds (91.66 kB CSS), 1332/1332 tests pass, zero Tailwind references remain across all source files.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-10
date: 2025-03-11T02:34:45Z
---

## step-10: Added Phase 7d section to implementation strategy. Updated What To Keep table for Tailwind removal. Added future-phase guidance for wrapping Radix primitives directly instead of installing shadcn components.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-9
date: 2025-03-11T02:27:02Z
---

## step-9: Added vite:beforeFullReload overlay in css-imports.ts for seamless dark-to-dark reload continuity. Creates fixed div (z-index 99998, #16171a) synchronously before location.reload(). Dev-only, tree-shaken in production.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-8
date: 2025-03-11T02:23:50Z
---

## step-8: Removed @tailwindcss/vite plugin from vite.config.ts, @import tailwindcss and @theme block from globals.css, tailwindcss and @tailwindcss/vite from package.json. CSS bundle shrank 15 kB. 1332/1332 tests pass.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-7
date: 2025-03-11T02:19:44Z
---

## step-7: Verification-only step. Tailwind audit grep confirms zero remaining utilities in components/ui/. 1332/1332 tests pass. TypeScript and build clean.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-6
date: 2025-03-11T02:14:08Z
---

## step-6: Replaced Tailwind utility strings in button cva() with semantic CSS classes. Added CSS rules for base .shadcn-button and all variant/size modifier classes. Updated test assertions. CVA structure retained per D01. 37/37 tests pass.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-5
date: 2025-03-11T02:08:36Z
---

## step-5: Replaced Tailwind utility strings with semantic CSS classes in four animated components. Bound @keyframes to data-state selectors per Spec S03 with correct fill-modes. Dialog centering via static translate coexisting with slide animation. Directional slides via data-side custom properties. Select popper uses margin offsets per Spec S04.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-4
date: 2025-03-11T01:55:25Z
---

## step-4: Replaced Tailwind utility strings with semantic CSS classes in three interactive components. Added CSS rules with data-state variants, switch thumb translate transition, and scroll-area orientation variants. Dropped peer class from checkbox and switch.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-3
date: 2025-03-11T01:48:05Z
---

## step-3: Replaced Tailwind utility strings with semantic CSS classes in five simple components. Added CSS rules to shadcn-base.css with --tug-base-* tokens, Spec S02 focus rings, and Table T03 media queries.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-2
date: 2025-03-11T01:38:05Z
---

## step-2: Simplified cn() utility from clsx+tailwind-merge to plain clsx. Removed tailwind-merge dependency from package.json. JS bundle shrank ~26 kB.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-1
date: 2025-03-11T01:34:39Z
---

## step-1: Created shadcn-base.css with minimal CSS reset (~27 lines per D05), six animation @keyframes matching Spec S03, and stub sections for 13 components. Added import to css-imports.ts.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7d-glitch-reduction.md

---

---
step: step-4
date: 2025-03-10T22:58:06Z
---

## step-4: Verification-only step. All automated exit criteria pass: inline body styles, startup overlay, CSS HMR boundary, TypeScript compilation clean. Visual scenarios deferred to manual testing.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7c-startup-continuity.md

---

---
step: step-3
date: 2025-03-10T22:55:12Z
---

## step-3: Created css-imports.ts consolidating all CSS side-effect imports with import.meta.hot.accept() self-accept. Updated main.tsx to import css-imports instead of individual CSS files.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7c-startup-continuity.md

---

---
step: step-2
date: 2025-03-10T22:51:50Z
---

## step-2: Added deck-startup-overlay div to index.html with fixed positioning and #16171a background. Added useLayoutEffect in DeckCanvas to fade out overlay using TugAnimator animate(). Updated hook order comments in deck-canvas.tsx.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7c-startup-continuity.md

---

---
step: step-1
date: 2025-03-10T22:46:47Z
---

## step-1: Added inline styles to <body> tag in index.html (margin:0, padding:0, overflow:hidden, background-color:#16171a) to eliminate white flash on page load. Updated plan file to reflect verified Brio canvas color #16171a.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7c-startup-continuity.md

---

---
step: step-10
date: 2025-03-10T21:16:39Z
---

## step-10: Final verification: all animations in correct lanes per Table T01; 1332 tests pass; all phase exit criteria met

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-9
date: 2025-03-10T21:12:37Z
---

## step-9: Created gallery-skeleton-content.tsx with 5 demo sections; registered as 13th gallery tab; updated 3 test files for new tab count

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-8
date: 2025-03-10T21:05:40Z
---

## step-8: Created TugSkeleton and TugSkeletonGroup components with CSS @keyframes td-shimmer, background-attachment: fixed; 15 tests in tug-skeleton.test.tsx

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-7
date: 2025-03-10T21:00:37Z
---

## step-7: Added --tug-base-skeleton-base and --tug-base-skeleton-highlight to bluenote.css; all three themes now have skeleton tokens

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-6
date: 2025-03-10T20:56:49Z
---

## step-6: Verification-only step: confirmed all dead keyframes removed, no animationend/setTimeout remain, tug-petals untouched; 1317 tests pass

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-5
date: 2025-03-10T20:53:47Z
---

## step-5: Rewrote handleItemSelect to use animate().finished; removed setTimeout, @keyframes tug-dropdown-blink, .tug-dropdown-item-selected; created tug-dropdown.test.tsx with 5 tests

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-4
date: 2025-03-10T20:46:09Z
---

## step-4: Removed @keyframes set-flash-fade and cleaned up stale comment references; zero matches for set-flash-fade across tugdeck/

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-3
date: 2025-03-10T20:42:23Z
---

## step-3: Rewrote flashSetPerimeter to use animate().finished for SVG cleanup; removed animation: from .set-flash-svg CSS; updated JSDoc; zero animationend refs remain in card-frame.tsx

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-2
date: 2025-03-10T20:38:43Z
---

## step-2: Rewrote flashCardPerimeter to use animate().finished for DOM cleanup; removed animation: from .card-flash-overlay CSS; kept @keyframes set-flash-fade for step-3/4

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-1
date: 2025-03-10T20:33:33Z
---

## step-1: Removed dead @keyframes tug-button-spin and .tug-button-spinner CSS class from tug-button.css; live .tug-button-spinner-overlay preserved

**Files changed:**
- .tugtool/tugplan-tugways-phase-7b-managed-animations.md

---

---
step: step-6
date: 2025-03-10T18:45:12Z
---

## step-6: Integration checkpoint: 52 TugAnimator tests pass, TypeScript type-checking clean, full suite 1312 tests pass with zero regressions. All 9 symbols verified, no circular dependencies.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7a-tug-animator.md

---

---
step: step-5
date: 2025-03-10T18:40:58Z
---

## step-5: Refined reduced-motion logic to strip spatial properties while preserving non-spatial (e.g. opacity). Handles both Keyframe[] and PropertyIndexedKeyframes formats. Added 6 tests.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7a-tug-animator.md

---

---
step: step-4
date: 2025-03-10T18:35:41Z
---

## step-4: Added animation group tests verifying Promise.all semantics, group.cancel propagation, per-animation overrides, and empty group behavior. Added .catch() guard for superseded finishedPromise.

**Files changed:**
- .tugtool/tugplan-tugways-phase-7a-tug-animator.md

---

