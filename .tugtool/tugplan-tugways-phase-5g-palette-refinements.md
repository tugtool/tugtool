<!-- tugplan-skeleton v2 -->

## Tugways Phase 5g: TugColor Palette Refinements {#phase-5g-palette-refinements}

**Purpose:** Reshape the TugColor palette from a fixed-preset coefficient system to a continuous color space with five convenience presets per hue, replacing coefficient knobs with calc()+clamp() formulas, renaming accent to intense, and enhancing the gallery editor with interactive i/t exploration.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5g-palette-refinements |
| Last updated | 2026-03-09 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current TugColor palette system defines 7 presets per hue (canonical, accent, muted, light, subtle, dark, deep) using coefficient knobs (`--tug-preset-{name}-l`, `--tug-preset-{name}-c`). These knobs are indirection without benefit -- the presets are fixed values pretending to be tunable. The system also exposes 168 CSS variables (24 hues x 7 presets) when only 120 (24 x 5) are needed, since "subtle" and "deep" presets are unused by any component or theme.

The palette-refinements design (documented in `roadmap/palette-refinements.md`) proposes reshaping the system into a continuous color space where five convenience presets serve as labeled reference points. The new calc()+clamp() piecewise formula makes the i/t mapping explicit in the CSS itself, and theme files gain the ability to define chromatic semantic tokens using inline TugColor formulas with arbitrary i/t values.

#### Strategy {#strategy}

- Rewrite tug-palette.css first: replace coefficient knobs and old formula structure with the new five-preset calc()+clamp() system. This is the foundation everything else depends on.
- Rename accent to intense across palette files, then do simple substitution in tug-tokens.css per user direction.
- Update palette-engine.ts to match the new CSS formula exactly, with the new five-preset TUG_COLOR_PRESETS.
- Update tests to assert five presets (120 = 24 x 5) instead of seven (168 = 24 x 7).
- Update theme files minimally -- only fix tokens broken by the preset rename; leave passing tokens as-is per user direction.
- Enhance gallery editor last -- it depends on the rewritten palette-engine.ts.
- Audit all consumers for references to removed presets (subtle, deep) and renamed preset (accent to intense).

#### Success Criteria (Measurable) {#success-criteria}

- tug-palette.css contains exactly 120 chromatic preset variables (24 hues x 5 presets: canonical, light, dark, intense, muted) plus 5 neutral presets plus black/white (verify by regex count)
- All references to `--tug-preset-*-l` and `--tug-preset-*-c` coefficient knobs are removed from tug-palette.css (verify by grep)
- No file in the codebase references `--tug-{hue}-accent` as a palette preset variable (verify by grep; semantic `--tug-base-accent-*` tokens are unaffected)
- No file references `--tug-{hue}-subtle` or `--tug-{hue}-deep` as palette preset variables (verify by grep)
- TUG_COLOR_PRESETS in palette-engine.ts has exactly 5 entries with correct i/t values (verify by test)
- All existing tests pass with updated assertions (`bun test` in tugdeck)
- Gallery editor renders interactive i/t picker with drag, preset overlay, and CSS formula export (verify by visual inspection and test)

#### Scope {#scope}

1. Rewrite tug-palette.css: remove coefficient knobs, replace 7-preset formula block with 5-preset calc()+clamp() formulas, update neutral ramp, update file header comments
2. Rename accent to intense in palette variable names across all files
3. Remove subtle and deep presets from palette
4. Rewrite palette-engine.ts: update TUG_COLOR_PRESETS to 5 entries, rewrite tugColor() to use clamp()-based piecewise formula
5. Update tug-tokens.css: simple substitution of `var(--tug-{hue}-accent)` to `var(--tug-{hue}-intense)`
6. Minimal theme file updates: fix only tokens broken by preset rename
7. Update palette-engine.test.ts: adjust all assertions from 7 presets/168 vars to 5 presets/120 vars
8. Consumer audit: search all files for removed/renamed preset references and update
9. Gallery editor enhancement: interactive i/t picker with drag, preset overlay, CSS formula export

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full theme chromatic rewrite using inline TugColor formulas (only minimal rename-driven fixes)
- Per-theme canonical-l tuning
- Changing per-hue constants (h, canonical-l, peak-c) or global anchors (l-dark, l-light)
- Modifying P3 @media block structure
- Visual parity with the old coefficient-based formula outputs

#### Dependencies / Prerequisites {#dependencies}

- Phase 5f4 (State Preservation Solidified) is complete and merged
- Design docs finalized: `roadmap/palette-refinements.md`, `roadmap/design-system-concepts.md` (D70, D71, D75)

#### Constraints {#constraints}

- Must use `bun` for all JS/TS package management and testing (never npm)
- Rules of Tugways apply to all React code changes (D08, D09, D40, D42)
- No file may reference removed presets (subtle, deep) or old preset name (accent as palette preset) after completion

#### Assumptions {#assumptions}

- The per-hue constants (h, canonical-l, peak-c), global anchors (l-dark, l-light), and P3 @media block in tug-palette.css are unchanged
- The canonical preset formula with i=50, t=50 produces mathematically identical output to the old coefficient-based formula (0.5 * peak-c chroma at canonical-l), so --tug-{hue} (no suffix) swatches remain visually unchanged
- All tests in palette-engine.test.ts that currently assert 7 presets will need to be updated to assert 5 presets (120 = 24 x 5)
- The tug-comp-tokens.css file does not directly reference palette preset names; it only references --tug-base-* tokens, so it requires no changes unless the base tokens it maps are being removed
- Brio defaults live in tug-tokens.css body block -- there is no separate brio.css theme file

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Muted preset formula change (DECIDED) {#q01-muted-formula}

**Question:** The old muted preset uses upper-segment formula (above canonical-l). The new muted preset uses i=20, t=50 which produces canonical-l lightness with reduced chroma. Should we accept the color change in consumers?

**Why it matters:** Muted colors will shift visually -- lighter muted colors become mid-tone muted colors.

**Resolution:** DECIDED -- Clean break. Update muted formula, accept color changes in consumers, audit and fix anything that looks wrong. (See [D03])

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Muted color shift breaks visual harmony | med | med | Visual audit after formula change | Colors look wrong in any theme |
| Consumer references to removed presets missed | high | low | Exhaustive grep-based audit step | Build or runtime CSS resolution failure |
| Gallery drag interaction performance | low | low | Use requestAnimationFrame for drag handler | Visible jank in picker |

**Risk R01: Missed consumer references** {#r01-missed-refs}

- **Risk:** A file references `--tug-{hue}-subtle`, `--tug-{hue}-deep`, or `--tug-{hue}-accent` after the rename/removal and produces a broken CSS resolution (fallback to initial/transparent).
- **Mitigation:**
  - Dedicated consumer audit step with exhaustive grep patterns
  - Test step verifies zero grep hits for old preset names
- **Residual risk:** Dynamic string construction in JS could evade grep (unlikely in this codebase).

---

### Design Decisions {#design-decisions}

#### [D01] Five convenience presets per hue (DECIDED) {#d01-five-presets}

**Decision:** Replace 7 presets (canonical, accent, muted, light, subtle, dark, deep) with 5 presets (canonical, light, dark, intense, muted).

**Rationale:**
- Subtle and deep presets are not referenced by any component or semantic token
- Five presets are easier to remember and cover the essential perceptual range
- Full 100x100 i/t space remains accessible via inline formula or tugColor()

**Implications:**
- All `--tug-{hue}-subtle` and `--tug-{hue}-deep` CSS variables removed
- `--tug-neutral-subtle` and `--tug-neutral-deep` removed from neutral ramp
- TUG_COLOR_PRESETS in palette-engine.ts reduced from 7 to 5 entries
- Tests updated from 168 to 120 expected preset count

#### [D02] Rename accent to intense (DECIDED) {#d02-rename-intense}

**Decision:** Rename the palette preset `accent` to `intense` across all palette files. Semantic tokens using `accent` as a UI role name (e.g., `--tug-base-accent-default`) keep `accent`.

**Rationale:**
- The canonical color IS the accent color in most UI contexts
- "Intense" sits on a clear perceptual scale alongside the other four presets (light/dark/muted/intense)
- Separating the palette preset name from the semantic role name eliminates a confusing overload

**Implications:**
- `--tug-{hue}-accent` becomes `--tug-{hue}-intense` in tug-palette.css
- `--tug-neutral-accent` becomes `--tug-neutral-intense` in neutral ramp
- tug-tokens.css: `var(--tug-orange-accent)` becomes `var(--tug-orange-intense)` (simple substitution per user direction)
- All other files referencing `--tug-{hue}-accent` updated

#### [D03] Clean break for muted formula (DECIDED) {#d03-muted-clean-break}

**Decision:** Update the muted preset formula to use i=20, t=50 (producing canonical-l lightness with reduced chroma), accepting that this changes the visual output from the old muted formula (which used upper-segment lightness).

**Rationale:**
- User direction: clean break, audit and fix anything that looks wrong
- The new muted formula is more intuitive -- "muted" means low intensity at the same lightness, not shifted lightness

**Implications:**
- Visual audit needed after formula change to verify no jarring color shifts in Brio, Bluenote, or Harmony themes

#### [D04] Calc()+clamp() piecewise formula (DECIDED) {#d04-clamp-formula}

**Decision:** Replace coefficient-knob formulas with the calc()+clamp() piecewise formula that uses literal i/t numbers directly in the CSS.

**Rationale:**
- Coefficient knobs (`--tug-preset-{name}-l`, `--tug-preset-{name}-c`) are indirection without benefit since presets are fixed
- Literal numbers make the i/t intent explicit: reading `clamp(0, 20, 50)` tells you t=20
- Same formula works in tug-palette.css presets, theme inline formulas, and tugColor() in TypeScript

**Implications:**
- All 13 `--tug-preset-*` coefficient variables removed from tug-palette.css
- Each preset formula is self-contained (no var() references to coefficients)
- tugColor() rewritten to use same clamp-based piecewise logic

#### [D05] Minimal theme updates (DECIDED) {#d05-minimal-themes}

**Decision:** Only update theme tokens broken by the preset rename (accent to intense) and removal (subtle, deep). Leave existing passing tokens as-is.

**Rationale:**
- User direction: minimal theme scope
- Full theme rewrite with inline TugColor formulas is a separate future effort
- Bluenote and Harmony themes do not currently reference palette preset names directly (they override only `--tug-base-*` semantic tokens)

**Implications:**
- Theme files may need zero changes if they only override semantic tokens
- Any theme token that references `--tug-{hue}-accent` directly must be updated to `--tug-{hue}-intense`

#### [D06] Gallery editor with full interactive features (DECIDED) {#d06-gallery-editor}

**Decision:** Enhance the gallery palette editor with all three features: interactive i/t picker with drag, preset reference overlay, and CSS formula export.

**Rationale:**
- User direction: all three features
- The gallery editor is the primary tool for the theme design workflow
- Interactive exploration of the continuous 100x100 i/t space is the key benefit of the new system

**Implications:**
- New VibValPicker component with pointer drag across 2D space
- Preset dots rendered as labeled overlay on the picker surface
- CSS formula snippet generation and copy-to-clipboard functionality
- Must follow Rules of Tugways (D08, D09 for appearance via inline style/CSS, D40 for local state)

---

### Specification {#specification}

#### Preset Definitions {#preset-definitions}

**Table T01: Five TugColor Presets** {#t01-presets}

| Name      | i | t | Character                         |
|-----------|-----|-----|-----------------------------------|
| canonical | 50  | 50  | The crayon color -- reference point |
| light     | 20  | 85  | Background-safe, airy             |
| dark      | 50  | 20  | Contrast text, dark surfaces      |
| intense   | 90  | 50  | Pops, draws attention             |
| muted     | 20  | 50  | Subdued, secondary                |

#### CSS Formula Template {#formula-template}

**Spec S01: Calc()+clamp() piecewise formula** {#s01-clamp-formula}

For a preset with i=V, t=W applied to hue H:

```css
--tug-H-PRESET: oklch(
  calc(
    var(--tug-l-dark)
    + clamp(0, W, 50)
      * (var(--tug-H-canonical-l) - var(--tug-l-dark)) / 50
    + (clamp(50, W, 100) - 50)
      * (var(--tug-l-light) - var(--tug-H-canonical-l)) / 50
  )
  calc(V / 100 * var(--tug-H-peak-c))
  var(--tug-H-h)
);
```

The canonical preset (i=50, t=50) simplifies to:

```css
--tug-H: oklch(
  var(--tug-H-canonical-l)
  calc(50 / 100 * var(--tug-H-peak-c))
  var(--tug-H-h)
);
```

#### Neutral Ramp {#neutral-ramp}

**Table T02: Five neutral presets** {#t02-neutrals}

| Variable              | oklch value      | Notes                              |
|-----------------------|------------------|------------------------------------|
| --tug-neutral         | oklch(0.555 0 0) | t=50 (canonical)                |
| --tug-neutral-light   | oklch(0.839 0 0) | t=85                            |
| --tug-neutral-dark    | oklch(0.312 0 0) | t=20                            |
| --tug-neutral-intense | oklch(0.555 0 0) | same as canonical (no chroma)     |
| --tug-neutral-muted   | oklch(0.555 0 0) | same as canonical (no chroma)     |
| --tug-black           | oklch(0 0 0)     | absolute anchor                   |
| --tug-white           | oklch(1 0 0)     | absolute anchor                   |

Neutral lightness values are derived from the same tone-to-L piecewise formula (with L_DARK=0.15, L_LIGHT=0.96, canonical-L=0.555) and rounded to 3 decimal places.

#### Token Rename Mapping {#token-rename-mapping}

**Table T03: Palette preset renames in tug-tokens.css** {#t03-token-renames}

| Old reference               | New reference                |
|-----------------------------|------------------------------|
| var(--tug-orange-accent)    | var(--tug-orange-intense)    |
| var(--tug-cobalt-accent)    | var(--tug-cobalt-intense)    |
| var(--tug-green-accent)     | var(--tug-green-intense)     |
| var(--tug-yellow-accent)    | var(--tug-yellow-intense)    |
| var(--tug-red-accent)       | var(--tug-red-intense)       |
| var(--tug-cyan-accent)      | var(--tug-cyan-intense)      |

These appear in the Accent System section (B) and Actions section (E) of tug-tokens.css.

#### tugColor() TypeScript Signature {#citacolor-signature}

**Spec S02: Rewritten tugColor() function** {#s02-hvvcolor}

```typescript
export function tugColor(
  hueName: string,
  i: number,
  t: number,
  canonicalL: number,
  peakChroma?: number,
): string
```

The function signature remains unchanged. The implementation is rewritten to use the clamp-based piecewise formula:

```typescript
// t -> L: piecewise via clamp
const L = L_DARK
  + Math.min(t, 50) * (canonicalL - L_DARK) / 50
  + Math.max(t - 50, 0) * (L_LIGHT - canonicalL) / 50;

// i -> C: linear
const C = (i / 100) * peakC;
```

Note: `Math.min(t, 50)` is the JS equivalent of CSS `clamp(0, t, 50)`, and `Math.max(t - 50, 0)` is the JS equivalent of CSS `(clamp(50, t, 100) - 50)`. The mathematical result is identical to the current if/else implementation -- this is a readability alignment, not a behavioral change.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| *(none)* | All changes are to existing files |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TUG_COLOR_PRESETS` | const | `palette-engine.ts` | 7 entries -> 5 entries (remove accent/subtle/deep, add intense) |
| `tugColor()` | fn | `palette-engine.ts` | Rewrite body to use clamp-based piecewise (signature unchanged) |
| `VibValPicker` | component | `gallery-palette-content.tsx` | New: interactive 2D i/t drag picker |
| `PresetOverlay` | component | `gallery-palette-content.tsx` | New: renders 5 preset dots on the picker surface |
| `CssFormulaExport` | component | `gallery-palette-content.tsx` | New: generates and copies CSS formula snippet |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test TUG_COLOR_PRESETS entries, tugColor() math, formula equivalence | palette-engine.test.ts |
| **Integration** | Test CSS file structure: 120 presets, no coefficient knobs, neutral ramp | palette-engine.test.ts (CSS verification) |
| **Golden / Contract** | Test preset count (120), neutral count (5+2), P3 block structure | palette-engine.test.ts |
| **Drift Prevention** | Grep-based tests for zero hits on removed/renamed preset names | palette-engine.test.ts or dedicated audit test |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Rewrite tug-palette.css formula structure {#step-1}

**Commit:** `refactor(palette): replace coefficient knobs with calc()+clamp() five-preset formulas`

**References:** [D01] Five convenience presets, [D03] Clean break for muted formula, [D04] Calc()+clamp() piecewise formula, Spec S01, Table T01, Table T02, (#preset-definitions, #formula-template, #neutral-ramp)

**Artifacts:**
- `tugdeck/styles/tug-palette.css` rewritten

**Tasks:**
- [ ] Remove all 13 `--tug-preset-*-l` and `--tug-preset-*-c` coefficient variables from the body block
- [ ] Replace the 7-preset formula block per hue (168 formulas) with the 5-preset calc()+clamp() formula block per hue (120 formulas) using literal i/t numbers per Table T01
- [ ] The canonical preset formula for all 24 hues consistently uses `calc(50 / 100 * var(--tug-{hue}-peak-c))` for chroma (matching the general template with V=50, not a simplified `0.5 * peak-c` form) and `var(--tug-{hue}-canonical-l)` for lightness (the t=50 clamp terms cancel to produce canonical-l directly, so no clamp() wrapper is needed in the L component)
- [ ] Each non-canonical preset uses the full calc()+clamp() piecewise formula per Spec S01 with the literal i/t from Table T01
- [ ] The muted preset uses i=20, t=50 per [D03] (clean break from old upper-segment formula)
- [ ] Rename `--tug-{hue}-accent` to `--tug-{hue}-intense` for all 24 hues
- [ ] Remove `--tug-{hue}-subtle` and `--tug-{hue}-deep` for all 24 hues
- [ ] Update the neutral ramp: remove `--tug-neutral-accent`, `--tug-neutral-subtle`, `--tug-neutral-deep`; add `--tug-neutral-intense` and `--tug-neutral-muted` per Table T02
- [ ] Update file header comment: remove references to coefficient knobs and "Phase" tags; describe the TugColor model, three axes, piecewise formula, and preset system
- [ ] Update the chromatic preset section comment: change "168 = 24 hues x 7 presets" to "120 = 24 hues x 5 presets"
- [ ] Verify per-hue constants (72 vars), global anchors, and P3 @media block are unchanged

**Tests:**
- [ ] Verify muted preset for red produces canonical-l lightness with reduced chroma (i=20)
- [ ] Verify canonical preset produces same output as old formula (0.5 * peak-c at canonical-l)
- [ ] Verify intense preset (formerly accent) uses i=90, t=50

**Checkpoint:**
- [ ] Grep: zero hits for `--tug-preset-` in tug-palette.css
- [ ] Grep: zero hits for `--tug-.*-accent:` in tug-palette.css (palette preset definitions only)
- [ ] Grep: zero hits for `--tug-.*-subtle:` in tug-palette.css
- [ ] Grep: zero hits for `--tug-.*-deep:` in tug-palette.css
- [ ] Regex count: exactly 120 chromatic preset oklch() definitions in the sRGB block
- [ ] Regex count: exactly 5 neutral preset definitions (neutral, neutral-light, neutral-dark, neutral-intense, neutral-muted)

---

#### Step 2: Rewrite palette-engine.ts {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(palette): rewrite TUG_COLOR_PRESETS to 5 entries and align tugColor() with clamp formula`

**References:** [D01] Five convenience presets, [D02] Rename accent to intense, [D04] Calc()+clamp() piecewise formula, Spec S02, Table T01, (#citacolor-signature, #preset-definitions)

**Artifacts:**
- `tugdeck/src/components/tugways/palette-engine.ts` modified

**Tasks:**
- [ ] Update TUG_COLOR_PRESETS: remove `accent`, `subtle`, `deep` entries; add `intense` entry with `{ i: 90, t: 50 }`; update `muted` to `{ i: 20, t: 50 }`; update `light` to `{ i: 20, t: 85 }`; update `dark` to `{ i: 50, t: 20 }`; keep `canonical` at `{ i: 50, t: 50 }`
- [ ] Rewrite tugColor() body to use clamp-based piecewise formula per Spec S02 (mathematically equivalent to current if/else but aligned with CSS formula structure)
- [ ] Keep LCParams interface and DEFAULT_LC_PARAMS -- they are used by palette-engine.test.ts and _deriveChromaCaps; update JSDoc only
- [ ] Update module-level JSDoc comment: remove references to "Phase" tags; describe TugColor model and the five presets

**Checkpoint:**
- [ ] `Object.keys(TUG_COLOR_PRESETS).length === 5`
- [ ] `TUG_COLOR_PRESETS` contains keys: canonical, light, dark, intense, muted
- [ ] `tugColor('red', 50, 50, 0.659)` produces same output as before (canonical unchanged)
- [ ] `tugColor('red', 0, 50, 0.659)` produces C=0 (achromatic)
- [ ] `tugColor('red', 50, 0, 0.659)` produces L close to L_DARK (0.15)

**Tests:**
- [ ] Verify TUG_COLOR_PRESETS has exactly 5 entries with correct i/t per Table T01
- [ ] Verify tugColor() produces same result for canonical (i=50, t=50) as before
- [ ] Verify tugColor() boundary conditions: t=0 gives L_DARK, t=100 gives L_LIGHT, i=0 gives C=0

---

#### Step 3: Update tug-tokens.css palette preset references {#step-3}

**Depends on:** #step-1

**Commit:** `refactor(tokens): rename palette accent references to intense in tug-tokens.css`

**References:** [D02] Rename accent to intense, [D05] Minimal theme updates, Table T03, (#token-rename-mapping)

**Artifacts:**
- `tugdeck/styles/tug-tokens.css` modified

**Tasks:**
- [ ] Replace `var(--tug-orange-accent)` with `var(--tug-orange-intense)` (lines 269, 282, 402)
- [ ] Replace `var(--tug-cobalt-accent)` with `var(--tug-cobalt-intense)` (line 272)
- [ ] Replace `var(--tug-green-accent)` with `var(--tug-green-intense)` (line 273)
- [ ] Replace `var(--tug-yellow-accent)` with `var(--tug-yellow-intense)` (line 274)
- [ ] Replace `var(--tug-red-accent)` with `var(--tug-red-intense)` (lines 275, 414)
- [ ] Replace `var(--tug-cyan-accent)` with `var(--tug-cyan-intense)` (line 276)
- [ ] Verify no references to `var(--tug-{hue}-subtle)` or `var(--tug-{hue}-deep)` exist (confirmed: none found)

**Checkpoint:**
- [ ] Grep: zero hits for `var(--tug-\w+-accent)` in tug-tokens.css
- [ ] Grep: all `--tug-base-accent-*` semantic token names are unchanged (accent is a UI role, not a preset)
- [ ] Grep: zero hits for `var(--tug-\w+-subtle)` in tug-tokens.css (excluding `--tug-base-fg-subtle` and `--tug-base-accent-subtle` which are semantic tokens, not palette presets)

**Tests:**
- [ ] Verify each renamed token resolves to a valid var() reference (no dangling references)

---

#### Step 4: Consumer audit and theme file updates {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `fix(palette): update all consumers for accent->intense rename and subtle/deep removal`

**References:** [D02] Rename accent to intense, [D05] Minimal theme updates, Risk R01, (#token-rename-mapping)

**Artifacts:**
- Any file in `tugdeck/` referencing old palette preset names
- `tugdeck/styles/bluenote.css` (if needed)
- `tugdeck/styles/harmony.css` (if needed)
- `tugdeck/src/components/tugways/style-inspector-overlay.ts` (PALETTE_VAR_REGEX update)
- `tugdeck/src/__tests__/style-inspector-overlay.test.ts` (test assertions update)

**Tasks:**
- [ ] Grep entire `tugdeck/` for `--tug-\w+-accent\b` (palette preset, not `--tug-base-accent-*` semantic tokens) and update each hit
- [ ] Grep entire `tugdeck/` for `--tug-\w+-subtle\b` (palette preset, not `--tug-base-*-subtle` semantic tokens) and update or remove each hit
- [ ] Grep entire `tugdeck/` for `--tug-\w+-deep\b` (palette preset) and update or remove each hit
- [ ] Update PALETTE_VAR_REGEX in `style-inspector-overlay.ts` to replace accent/subtle/deep with intense in the preset name alternation
- [ ] Update PALETTE_VAR_REGEX JSDoc comment to list the new preset suffixes (intense, muted, light, dark)
- [ ] Update `style-inspector-overlay.test.ts` across all affected test blocks (~32 lines total):
  - PALETTE_VAR_REGEX match tests (~6 lines): rename `--tug-orange-accent` to `--tug-orange-intense`; remove `--tug-orange-subtle` and `--tug-orange-deep` assertions; add `--tug-orange-intense` match assertion; update `--tug-cobalt-accent` to `--tug-cobalt-intense`
  - resolveTokenChain fixture setup and assertions (~18 lines across 4 test blocks): update `--tug-cobalt-accent` fixtures in afterEach cleanup (line 388), two-hop chain test (lines 406-419), chain termination test using `--tug-orange-accent` (lines 422-428 -- rename to `--tug-orange-intense` in setProperty, resolveTokenChain call, and assertion), two-layer chromatic chain test (lines 610-625), and endsAtPalette test (lines 707-721) to use `--tug-cobalt-intense`
  - extractHvvProvenance tests (~5 lines): update `--tug-cobalt-accent` test case (lines 541-553) to test `--tug-cobalt-intense` and assert `preset: 'intense'`
  - Full chain integration tests (~6 lines): update `--tug-base-accent-cool-default` -> `var(--tug-cobalt-accent)` fixture references to `var(--tug-cobalt-intense)`
- [ ] Check bluenote.css and harmony.css for any direct palette preset references (currently they reference only `--tug-base-*` semantic tokens, so likely no changes needed)
- [ ] If any component CSS references `var(--tug-{hue}-subtle)` or `var(--tug-{hue}-deep)`, replace with the appropriate semantic token or inline formula

**Checkpoint:**
- [ ] Grep: zero hits for `--tug-\w+-accent\b` in any file under `tugdeck/` (excluding `--tug-base-accent-*` semantic tokens)
- [ ] Grep: zero hits for `--tug-\w+-subtle\b` in any file under `tugdeck/` (excluding `--tug-base-*-subtle` semantic tokens)
- [ ] Grep: zero hits for `--tug-\w+-deep\b` in any file under `tugdeck/`

**Tests:**
- [ ] Verify PALETTE_VAR_REGEX matches `--tug-orange-intense` and rejects `--tug-orange-accent`
- [ ] Verify no CSS file contains unresolvable palette preset variable references

---

#### Step 5: Update palette-engine.test.ts {#step-5}

**Depends on:** #step-1, #step-2

**Commit:** `test(palette): update assertions for 5-preset system (120 = 24 x 5)`

**References:** [D01] Five convenience presets, [D02] Rename accent to intense, Table T01, (#test-categories, #preset-definitions)

**Artifacts:**
- `tugdeck/src/__tests__/palette-engine.test.ts` modified

**Tasks:**
- [ ] Update `TUG_COLOR_PRESETS` test block: change "has exactly 7 entries" to "has exactly 5 entries"; remove `accent`, `subtle`, `deep` assertions; add `intense` assertion with `{ i: 90, t: 50 }`; update `muted` assertion to `{ i: 20, t: 50 }`; update `light` to `{ i: 20, t: 85 }`; update `dark` to `{ i: 50, t: 20 }`
- [ ] Update tug-palette.css verification tests: change preset count from 168 to 120 (24 x 5); change preset suffix list from 7 to 5; remove `-subtle` and `-deep` from suffix lists; add `-intense` to suffix list; remove `--tug-red-subtle` and `--tug-red-deep` assertions
- [ ] Update gamut safety tests: change "24 hues x 7 presets" description to "24 hues x 5 presets"; change expected count from 168 to 120
- [ ] Update neutral ramp tests: remove `--tug-neutral-deep` assertion; add `--tug-neutral-intense` assertion if missing; verify neutral count matches 5 presets
- [ ] Verify all other existing assertions still hold (per-hue constants, P3 block, global anchors)

**Tests:**
- [ ] All palette-engine.test.ts tests pass with updated assertions

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/palette-engine.test.ts`

---

#### Step 6: Integration Checkpoint -- palette system complete {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Five convenience presets, [D02] Rename accent to intense, [D04] Calc()+clamp() piecewise formula, (#success-criteria)

**Tasks:**
- [ ] Verify all steps 1-5 artifacts are consistent and work together
- [ ] Run full test suite to verify no regressions

**Tests:**
- [ ] Full test suite passes: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] Grep: zero hits for `--tug-preset-` anywhere in `tugdeck/`
- [ ] Grep: zero hits for old palette preset names (`--tug-\w+-accent\b` excluding semantic, `--tug-\w+-subtle\b` excluding semantic, `--tug-\w+-deep\b`) in `tugdeck/`

---

#### Step 7: Enhance gallery editor with i/t picker {#step-7}

**Depends on:** #step-2

**Commit:** `feat(gallery): add interactive i/t picker with preset overlay and CSS formula export`

**References:** [D06] Gallery editor with full interactive features, Table T01, Spec S01, (#preset-definitions, #formula-template)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-palette-content.tsx` modified
- `tugdeck/src/components/tugways/cards/gallery-palette-content.css` modified (new picker styles)

**Tasks:**
- [ ] Add VibValPicker component: renders a color gradient surface using a CSS grid of divs at 21x21 resolution (i 0-100 by 5, t 0-100 by 5 = 441 cells), each cell colored via inline `backgroundColor` set to `tugColor()` output. This matches the existing VibValGrid pattern and keeps the DOM testable via data-testid/data-color attributes. X axis is intensity (0-100 left to right), Y axis is tone (100 top to 0 bottom). Pointer interaction: on pointerDown, capture the pointer (`setPointerCapture`), compute i/t from pointer position relative to the grid container using `(clientX - rect.left) / rect.width * 100` and `(1 - (clientY - rect.top) / rect.height) * 100`, clamped to [0, 100]. On pointerMove while captured, update i/t state. On pointerUp, release capture. A crosshair indicator (absolutely-positioned div) marks the current i/t position. A large result swatch (data-testid="gp-picker-swatch") below the grid displays the selected color with its oklch() string
- [ ] Add PresetOverlay: renders the 5 preset dots (canonical, light, dark, intense, muted) as absolutely-positioned labeled elements at their fixed i/t coordinates on the picker surface, positioned via percentage left/bottom calculated from their Table T01 i/t values
- [ ] Add CssFormulaExport: when a i/t is selected, generates the CSS inline TugColor formula snippet matching Spec S01 format -- output is a complete `oklch(calc(...) calc(V / 100 * var(--tug-H-peak-c)) var(--tug-H-h))` string with the selected hue's CSS variable names and literal i/t numbers substituted. Provides a copy-to-clipboard button (using `navigator.clipboard.writeText()`) with a "Copied" feedback state
- [ ] Wire VibValPicker into GalleryPaletteContent as a new section that replaces the existing VibValGrid when a hue is selected (the picker is a superset of the grid's functionality -- it shows the same color space interactively)
- [ ] Use inline styles for color display (Rules of Tugways D08, D09)
- [ ] Use local useState for picker state (i, t, copied flag) per D40
- [ ] Add CSS styles for the new picker components in gallery-palette-content.css

**Tests:**
- [ ] VibValPicker renders 441 colored cells (21x21 grid) when a hue is selected (query by data-testid="gp-picker-cell", verify count)
- [ ] VibValPicker responds to pointer drag (use fireEvent.pointerDown + fireEvent.pointerMove to simulate drag; verify updated i/t via data-testid attributes on the swatch element)
- [ ] VibValPicker result swatch (data-testid="gp-picker-swatch") color verified via data-color attribute matching expected tugColor() output for the selected i/t
- [ ] PresetOverlay renders 5 labeled dots at correct positions (query by data-testid="gp-preset-dot")
- [ ] CssFormulaExport generates correct CSS formula for a given hue/i/t (verify output string contains `calc(` and `clamp(` patterns with the correct literal i/t numbers and `var(--tug-{hue}-` references)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/gallery-palette-content.test.tsx`

---

#### Step 8: Final verification {#step-8}

**Depends on:** #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Five convenience presets, [D06] Gallery editor with full interactive features, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run full test suite
- [ ] Verify gallery editor renders correctly with new picker
- [ ] Final grep audit for any remaining old preset references

**Tests:**
- [ ] Full test suite passes: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] Zero grep hits for old preset names across entire `tugdeck/` directory

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** TugColor palette reshaped to continuous color space with five convenience presets per hue, calc()+clamp() formulas, accent-to-intense rename complete, and gallery editor enhanced with interactive i/t exploration.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] tug-palette.css has exactly 120 chromatic preset variables (verify by regex count)
- [ ] No coefficient knob variables remain (`--tug-preset-*`) (verify by grep)
- [ ] No old preset names remain in any file (`--tug-{hue}-accent`, `--tug-{hue}-subtle`, `--tug-{hue}-deep`) (verify by grep)
- [ ] TUG_COLOR_PRESETS has exactly 5 entries (verify by test)
- [ ] All tests pass (`bun test` in tugdeck)
- [ ] Gallery editor has interactive i/t picker with preset overlay and CSS formula export (verify visually)

**Acceptance tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] Grep audit: `grep -rn 'tug-preset-' tugdeck/` returns zero hits
- [ ] Grep audit: `grep -rn '\-accent:' tugdeck/styles/tug-palette.css` returns zero hits

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Full theme chromatic rewrite: define all chromatic semantic tokens using inline TugColor formulas with theme-specific i/t choices
- [ ] Per-theme canonical-l tuning for contrast adjustments
- [ ] Accessibility audit of muted preset color changes across all themes
- [ ] Gallery editor: save/load theme i/t configurations

| Checkpoint | Verification |
|------------|--------------|
| Palette CSS structure | Regex count: 120 chromatic presets, 0 coefficient knobs |
| Preset rename complete | Grep: 0 hits for old preset names |
| Tests pass | `bun test` all green |
| Gallery editor functional | Visual inspection + test pass |
