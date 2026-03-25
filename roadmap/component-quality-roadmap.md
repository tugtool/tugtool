# Component Quality Roadmap

*Bring every tugways component to world-class quality before scaling to new components.*

---

## Current State

### Audit Results (against component-authoring.md checklist)

| # | Component | Score | Module Doc | Props @selector | forwardRef+data-slot | @tug-pairings | @tug-renders-on | Token Colors | State Order |
|---|-----------|:-----:|:----------:|:---------------:|:-------------------:|:-------------:|:---------------:|:------------:|:-----------:|
| 1A | tug-checkbox | 7/7 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1B | tug-switch | 7/7 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1C | tug-input | 5/7 | ✅ | ⚠️ | ❌ | ✅ | ✅ | ✅ | ✅ |
| 2A | tug-button | 6/7 | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 2B | tug-badge | 4/7 | ✅ | ⚠️ | ❌ | ✅ | ❌ | ✅ | N/A |
| 3A | tug-label | 5/7 | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | ⚠️ |
| 3B | tug-skeleton | 3/7 | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | ✅ | N/A |
| 3C | tug-marquee | 4/7 | ✅ | ⚠️ | ✅ | ✅ | ❌ | ✅ | N/A |
| 4A | tug-card | 6/7 | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 4B | tug-tab-bar | 6/7 | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 4C | tug-popup-button | — | ✅ | ✅ | N/A | N/A | N/A | N/A | N/A |
| 4D | tug-popup-menu | 5/7 | ✅ | ✅ | ⚠️ | ? | ? | ✅ | ✅ |

### Key Findings

**Reference implementations:** tug-checkbox and tug-switch score 7/7. Every checklist item satisfied. These are the gold standard for what compliance looks like.

**Common gaps across components:**
- **`@tug-renders-on` annotations** missing from badge, skeleton, marquee
- **`@selector` annotations** incomplete on most components outside checkbox/switch/button
- **`data-slot`** missing or inconsistent, especially on Radix-wrapped roots
- **`forwardRef`** not applied to badge, skeleton, input

**Compositional pattern undocumented:** tug-popup-button has no CSS — it composes TugButton and TugPopupMenu. The authoring guide doesn't address this delegation pattern.

---

## Phase 1: Token-to-Component Contract

*Formalize the rules that checkbox and switch already follow, so every component has the same yardstick.*

### Goal

Update `tuglaws/component-authoring.md` to codify the token-to-component contract. No code changes — pure documentation.

### What to Formalize

**1. Every component declares its token vocabulary via `@tug-pairings`.**

This convention exists — checkbox and switch do it perfectly. The gap is enforcement: badge, skeleton, and marquee are loose. The authoring guide should state that `@tug-pairings` is mandatory and define what a compliant table looks like, using checkbox as the canonical example.

**2. Compositional components declare delegation, not pairings.**

tug-popup-button has no CSS. It composes TugButton and TugPopupMenu. The authoring guide should explicitly address this: a compositional component documents which child components it delegates styling to, rather than declaring its own pairings. A new `@tug-delegates` annotation or a documented pattern in the CSS file header.

**3. Effect plane tokens get their own declaration pattern.**

Card overlay tokens (`--tug-effect-card-*`) don't participate in contrast pairing but still need to be declared. The pairings table could have an `effect` section, or effect tokens could use a separate `@tug-effects` annotation.

**4. Strengthen the `@selector` requirement.**

Every prop that produces a CSS-targetable state change must have a `@selector` annotation. This is the bridge between the TSX API and the CSS — it tells a coding agent exactly which selector to use when styling a prop's visual effect.

### Deliverable

Updated `tuglaws/component-authoring.md` with these four rules formalized.

---

## Phase 2: Component-by-Component Audit

*Interactive, one at a time. Edit each component to full compliance with the updated authoring guide.*

### Approach

Step through each component in batch order. For each one:

1. Review against the authoring guide checklist
2. Edit the `.tsx` and `.css` to close all gaps
3. Verify: `bun run build`, `bun run audit:tokens lint`
4. Confirm visually in the Component Gallery
5. Move to the next component

### Work Items

#### Batch 1: Selection/Field Controls

| # | Component | Score | Primary Gaps |
|---|-----------|:-----:|-------------|
| 1A | tug-checkbox | 7/7 | None — validate as reference, move on fast |
| 1B | tug-switch | 7/7 | None — validate as reference, move on fast |
| 1C | tug-input | 5/7 | Missing `data-slot`, incomplete `@selector` annotations |

#### Batch 2: Emphasis x Role Pattern

| # | Component | Score | Primary Gaps |
|---|-----------|:-----:|-------------|
| 2A | tug-button | 6/7 | `data-slot` on Radix Slot-wrapped root |
| 2B | tug-badge | 4/7 | No `forwardRef`, missing `@tug-renders-on`, incomplete `@selector` |

#### Batch 3: Simpler Display Components

| # | Component | Score | Primary Gaps |
|---|-----------|:-----:|-------------|
| 3A | tug-label | 5/7 | Incomplete `@selector`, missing `data-slot`, limited state coverage |
| 3B | tug-skeleton | 3/7 | No `forwardRef`, no formal pairings table, no `@tug-renders-on`, incomplete `@selector` |
| 3C | tug-marquee | 4/7 | Missing `@tug-renders-on`, incomplete `@selector` |

#### Batch 4: Structural/Composition Components

| # | Component | Score | Primary Gaps |
|---|-----------|:-----:|-------------|
| 4A | tug-card | 6/7 | `forwardRef` on main component |
| 4B | tug-tab-bar | 6/7 | `forwardRef` on main component |
| 4C | tug-popup-button | — | Compositional; needs delegation documentation |
| 4D | tug-popup-menu | 5/7 | `forwardRef`, CSS audit needed |

### Deferred

- **tug-hue-strip, tug-color-strip** — theme generator internals, will be redone in a later phase
- **Step 4 interactive build guide components** — new components built after the existing ones are at full quality
- **Phase 8 Radix redesign** — broader architectural work that depends on the component library being solid

---

## Phase 3: Follow-on Planning

*Take stock after the audit is complete, then plan the next wave.*

Deferred until Phase 2 is done. At that point we will know:

- Which patterns emerged during the audit that should feed back into the authoring guide
- Whether the step-4 interactive build guide needs revision given lessons learned
- What the phase-8 Radix redesign scope looks like now that the foundation is solid
- Whether any new laws or design decisions are needed for patterns we discovered
