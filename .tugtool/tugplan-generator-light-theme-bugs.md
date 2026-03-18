<!-- tugplan-skeleton v2 -->

## Fix Theme Generator Light Theme Bugs {#generator-light-theme-bugs}

**Purpose:** Fix three bugs that cause the Theme Generator card to produce incorrect output when using Harmony (light mode): missing formulas state, potential title bar illegibility, and hardcoded mid-tone borders/semantics that glow on light backgrounds.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Theme Generator gallery card lets users interactively derive complete themes from a compact ThemeRecipe. The derivation engine supports both dark and light modes via separate formula sets (DARK_FORMULAS and LIGHT_FORMULAS/LIGHT_OVERRIDES). However, the generator component does not track formulas as part of its local state. When runDerive() assembles a ThemeRecipe, it omits the formulas field, causing deriveTheme() to fall back to DARK_FORMULAS regardless of the selected mode. This means selecting "Light" mode in the generator still derives with dark-mode formulas, producing broken output.

A secondary issue is that borderRamp() and semanticTone() in derivation-rules.ts hardcode `lit(50)` for tone, which is mid-tone. On dark backgrounds this is fine (bright signal on dark ground), but on light backgrounds mid-tone borders and semantic tokens create a glowing neon effect instead of the expected subdued appearance.

#### Strategy {#strategy}

- Fix the root cause first: add `formulas` as a useState field in the generator with a `setFormulasAndRef` wrapper that synchronously updates both state and ref. Wire it through all four mutation sites (loadPreset, handleRecipeImported, Dark mode onClick, Light mode onClick).
- Add two new formula fields (`borderSignalTone`, `semanticSignalTone`) to DerivationFormulas so border and semantic tone can be mode-aware.
- Update derivation-rules.ts to read the new fields instead of hardcoded lit(50).
- Verify Bug 2 (card title bar illegibility) is resolved by Bug 1 fix; calibrate cardFrameActiveTone in LIGHT_OVERRIDES only if needed.
- Preserve all 373 tokens and existing test behavior for dark mode (Brio).
- Regenerate tokens after engine changes.

#### Success Criteria (Measurable) {#success-criteria}

- Loading Harmony preset in the generator produces identical output to `deriveTheme(EXAMPLE_RECIPES.harmony)` called directly (verify token-for-token match).
- Dark/Light mode toggle switches formulas between DARK_FORMULAS and LIGHT_FORMULAS.
- Exported recipe JSON includes the formulas field and re-imports correctly.
- borderRamp() and semanticTone() read their tone from formulas, not hardcoded lit(50).
- `bun run generate:tokens` produces unchanged output (Brio dark is the token source).
- All existing tests pass: `cd tugdeck && bun test`.

#### Scope {#scope}

1. Add `formulas` useState field to gallery-theme-generator-content.tsx.
2. Wire formulas through loadPreset, handleRecipeImported, runDerive, currentRecipe, mode toggle, handleSliderChange.
3. Add `borderSignalTone` and `semanticSignalTone` fields to DerivationFormulas interface.
4. Set defaults in DARK_FORMULAS (both 50, preserving current behavior) and override in LIGHT_OVERRIDES.
5. Update borderRamp() and semanticTone() in derivation-rules.ts to use formula fields.
6. Verify card title bar legibility after fix; calibrate if needed.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Refactoring the generator's state management pattern (e.g., consolidating 18+ fields into a single state object).
- Adding new presets or recipes beyond the existing Brio/Harmony set.
- Changing any token semantics for dark mode.

#### Dependencies / Prerequisites {#dependencies}

- Current codebase on main branch with the contrast engine overhaul landed.
- LIGHT_OVERRIDES and LIGHT_FORMULAS already exist in theme-derivation-engine.ts.
- EXAMPLE_RECIPES.harmony already includes `formulas: { ...BASE_FORMULAS, ...LIGHT_OVERRIDES }`.

#### Constraints {#constraints}

- Must comply with Rules of Tugways: local component state via useState, appearance through CSS custom properties via liveTokenStyle, no root.render() after mount.
- Token count (373) must be preserved exactly.
- Brio (dark) token generation output must not change.

#### Assumptions {#assumptions}

- loadPreset() will use `r.formulas ?? DARK_FORMULAS` to handle presets that lack an explicit formulas field.
- handleRecipeImported() will use `r.formulas ?? DARK_FORMULAS` for imported recipes without formulas.
- The mode toggle updates formulas: switching to light sets LIGHT_FORMULAS, switching to dark sets DARK_FORMULAS.
- The numbering skip (Bug 1 to Bug 2 to Bug 4) is intentional; Bug 1 and Bug 3 share the same root cause and are addressed together.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors on all headings and artifacts that are referenced by execution steps. See the skeleton for full conventions.

---

### Design Decisions {#design-decisions}

#### [D01] Formulas tracked as local useState field with synchronous ref wrapper (DECIDED) {#d01-formulas-state}

**Decision:** Add `formulas` as a `useState<DerivationFormulas>` field alongside the existing 18 state fields, plus a `useRef` that mirrors it. A plain function `setFormulasAndRef(f)` calls `setFormulas(f)` and `formulasRef.current = f` synchronously, ensuring the ref is always up to date without any useEffect. All four call sites that mutate formulas (loadPreset, handleRecipeImported, Dark mode onClick, Light mode onClick) call `setFormulasAndRef` instead of `setFormulas`. runDerive() reads formulas from the ref rather than accepting it as an additional positional parameter, avoiding changes to the already-large parameter list and all slider call sites.

**Rationale:**
- The generator already uses useState for every other recipe parameter; formulas is the missing piece.
- Compliant with Rules of Tugways: local component state, not external store [D40]; handlers access current state through refs [Rule 5].
- Using a ref avoids threading formulas through runDerive's 18-parameter signature and the 3 MoodSlider handleSliderChange call sites, reducing off-by-one risk.
- The `setFormulasAndRef` wrapper updates the ref synchronously at every call site. No useEffect is used to copy state to the ref. This avoids fragile effect-ordering dependencies and conforms to the Rules of Tugways (no useEffect for state-to-ref sync).

**Implications:**
- runDerive() reads `formulasRef.current` instead of accepting a formulas parameter.
- handleSliderChange() and its call sites remain unchanged.
- currentRecipe memo must include the formulas field for correct round-trip export/import.
- The mode toggle buttons must call `setFormulasAndRef` when switching modes.
- All four mutation sites (loadPreset, handleRecipeImported, Dark onClick, Light onClick) must use `setFormulasAndRef`, not `setFormulas` directly.

#### [D02] Mode toggle switches formulas (DECIDED) {#d02-mode-toggle-formulas}

**Decision:** The Dark/Light toggle buttons update both the `mode` state and the `formulas` state. Dark sets DARK_FORMULAS, Light sets LIGHT_FORMULAS.

**Rationale:**
- Mode and formulas are logically coupled: a light-mode recipe must use light formulas to produce correct tones.
- The existing useEffect on mode change will trigger re-derivation automatically.

**Known limitation:** If a user imports a custom recipe with non-stock formulas and then toggles mode, the custom formulas are replaced with stock DARK_FORMULAS or LIGHT_FORMULAS. This is acceptable because: (a) mode-switching inherently requires a different formula set, (b) the imported recipe can be re-imported to restore custom values, and (c) smarter per-field override merging is out of scope for this bugfix.

**Implications:**
- The onClick handlers for the mode buttons must call both setMode() and setFormulasAndRef().

#### [D03] Two new formula fields for border and semantic tone (DECIDED) {#d03-signal-tone-fields}

**Decision:** Add `borderSignalTone` and `semanticSignalTone` as separate fields in DerivationFormulas. borderRamp() reads `borderSignalTone`, semanticTone() reads `semanticSignalTone`.

**Rationale:**
- User explicitly chose two separate fields over a single shared field.
- Separate fields allow independent tuning of border vs semantic tone for each mode.
- Default both to 50 in DARK_FORMULAS to preserve existing dark behavior exactly.

**Implications:**
- LIGHT_OVERRIDES must set both fields to light-appropriate values (implementer tunes visually).
- borderRamp() changes from `toneExpr: lit(50)` to `toneExpr: (f) => f.borderSignalTone`.
- semanticTone() changes from `toneExpr: lit(50)` to `toneExpr: (f) => f.semanticSignalTone`.

#### [D04] Bug 2 verified after Bug 1 fix (DECIDED) {#d04-title-bar-verification}

**Decision:** Card title bar illegibility (Bug 2) is likely caused by dark formulas being used for light mode. Verify after Bug 1 fix; only calibrate cardFrameActiveTone in LIGHT_OVERRIDES if the issue persists.

**Rationale:**
- LIGHT_OVERRIDES already sets cardFrameActiveTone to 88 (appropriate for light mode). The bug is that the generator never uses LIGHT_OVERRIDES because formulas are not in state.
- Fixing Bug 1 should fix Bug 2 automatically. Calibrating prematurely could introduce a regression.

**Implications:**
- Step 4 includes explicit verification of title bar contrast after the formulas fix.

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**New DerivationFormulas fields:**

**Table T01: New formula fields** {#t01-new-formula-fields}

| Field | Type | DARK_FORMULAS default | LIGHT_OVERRIDES value | Consumer |
|-------|------|----------------------|----------------------|----------|
| `borderSignalTone` | `number` | 50 | Implementer tunes (initial estimate: 40) | `borderRamp()` in derivation-rules.ts |
| `semanticSignalTone` | `number` | 50 | Implementer tunes (initial estimate: 35) | `semanticTone()` in derivation-rules.ts |

**Generator state field:**

**Table T02: New generator state** {#t02-generator-state}

| Field | Type | Default | Source |
|-------|------|---------|--------|
| `formulas` | `useState<DerivationFormulas>` | `DARK_FORMULAS` | `DEFAULT_RECIPE.formulas ?? DARK_FORMULAS` |
| `formulasRef` | `useRef<DerivationFormulas>` | (mirrors `formulas` state) | Updated synchronously via `setFormulasAndRef` wrapper; read by runDerive |

#### Affected Functions {#affected-functions}

**List L01: Functions modified in gallery-theme-generator-content.tsx** {#l01-generator-functions}

- `setFormulasAndRef()` — new plain function wrapper: calls `setFormulas(f)` and `formulasRef.current = f` synchronously
- `loadPreset()` — call `setFormulasAndRef(r.formulas ?? DARK_FORMULAS)` to set formulas from preset
- `handleRecipeImported()` — call `setFormulasAndRef(r.formulas ?? DARK_FORMULAS)` to extract formulas from imported recipe
- `runDerive()` — read `formulasRef.current` and include in assembled ThemeRecipe (no signature change)
- `currentRecipe` memo — include `formulas` in assembled recipe
- `useEffect` (mode/hue change) — add `formulas` to dependency array (runDerive reads from ref)
- Mode toggle onClick handlers — call `setFormulasAndRef()` alongside setMode()
- (handleSliderChange unchanged — runDerive reads formulas from ref)

**List L02: Functions modified in derivation-rules.ts** {#l02-derivation-rules-functions}

- `borderRamp()` — change `toneExpr: lit(50)` to `toneExpr: (f) => f.borderSignalTone`
- `semanticTone()` — change `toneExpr: lit(50)` to `toneExpr: (f) => f.semanticSignalTone`

---

### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `borderSignalTone` | field | `theme-derivation-engine.ts` (DerivationFormulas) | New formula field, default 50 |
| `semanticSignalTone` | field | `theme-derivation-engine.ts` (DerivationFormulas) | New formula field, default 50 |
| `formulas` (state) | useState | `gallery-theme-generator-content.tsx` | New state field tracking DerivationFormulas |
| `formulasRef` | useRef | `gallery-theme-generator-content.tsx` | Mirrors formulas state via setFormulasAndRef wrapper; read by runDerive to avoid parameter threading |
| `setFormulasAndRef` | function | `gallery-theme-generator-content.tsx` | Wrapper: calls setFormulas(f) + formulasRef.current = f synchronously |

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Light tone values produce poor contrast | med | med | Implementer tunes visually; verify with contrast dashboard | Contrast dashboard shows failures after tuning |
| runDerive parameter list grows unwieldy | low | high | Accept it for now; state consolidation is a non-goal | If more fields are added in future |

**Risk R01: Light tone initial estimates need tuning** {#r01-tone-tuning}

- **Risk:** The initial borderSignalTone and semanticSignalTone values for LIGHT_OVERRIDES may not be optimal.
- **Mitigation:** The implementer loads the Harmony preset in the generator, visually inspects borders and semantic tokens, and adjusts values until they look correct. The contrast dashboard provides quantitative feedback.
- **Residual risk:** Subjective visual tuning may not cover all edge cases across all hue families.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify new formula fields are present and have correct defaults | DARK_FORMULAS, LIGHT_FORMULAS construction |
| **Integration** | Verify generator produces correct output for Harmony preset | End-to-end derivation with light formulas |
| **Drift Prevention** | Brio (dark) output must not change | Existing token generation tests |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add borderSignalTone and semanticSignalTone to DerivationFormulas {#step-1}

**Commit:** `fix(engine): add borderSignalTone and semanticSignalTone formula fields`

**References:** [D03] Two new formula fields for border and semantic tone, Table T01 (#t01-new-formula-fields), (#inputs-outputs, #constraints)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` — DerivationFormulas interface, DARK_FORMULAS, LIGHT_OVERRIDES, LIGHT_FORMULAS

**Tasks:**
- [ ] Add `borderSignalTone: number` field to the DerivationFormulas interface with `@semantic signal-tone` JSDoc comment
- [ ] Add `semanticSignalTone: number` field to the DerivationFormulas interface with `@semantic signal-tone` JSDoc comment
- [ ] Set `borderSignalTone: 50` in DARK_FORMULAS (preserves existing behavior)
- [ ] Set `semanticSignalTone: 50` in DARK_FORMULAS (preserves existing behavior)
- [ ] Set `borderSignalTone` in LIGHT_OVERRIDES to initial estimate (40) with rationale comment
- [ ] Set `semanticSignalTone` in LIGHT_OVERRIDES to initial estimate (35) with rationale comment

**Tests:**
- [ ] Verify DARK_FORMULAS.borderSignalTone === 50
- [ ] Verify DARK_FORMULAS.semanticSignalTone === 50
- [ ] Verify LIGHT_FORMULAS includes the overridden values (spread from LIGHT_OVERRIDES)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` — TypeScript compiles with no errors
- [ ] `cd tugdeck && bun test` — all existing tests pass
- [ ] `bun run generate:tokens` — output unchanged (Brio dark uses 50, same as before)

---

#### Step 2: Wire borderSignalTone and semanticSignalTone into derivation rules {#step-2}

**Depends on:** #step-1

**Commit:** `fix(engine): use formula fields for border and semantic signal tone`

**References:** [D03] Two new formula fields for border and semantic tone, List L02 (#l02-derivation-rules-functions), (#affected-functions)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/derivation-rules.ts` — borderRamp() and semanticTone() functions

**Tasks:**
- [ ] In `borderRamp()`, change `toneExpr: lit(50)` to `toneExpr: (f: F) => f.borderSignalTone`
- [ ] In `semanticTone()`, change `toneExpr: lit(50)` to `toneExpr: (f: F) => f.semanticSignalTone`

**Tests:**
- [ ] Verify that deriveTheme(EXAMPLE_RECIPES.brio) produces identical output to before (borderSignalTone defaults to 50)
- [ ] Verify that deriveTheme(EXAMPLE_RECIPES.harmony) produces different border/semantic tone values than before (now reads from LIGHT_OVERRIDES)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` — TypeScript compiles
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run generate:tokens` — output unchanged (Brio dark still uses 50)

---

#### Step 3: Add formulas useState field and wire through generator {#step-3}

**Depends on:** #step-2

**Commit:** `fix(generator): track formulas in component state for correct light-mode derivation`

**References:** [D01] Formulas tracked as local useState field, [D02] Mode toggle switches formulas, Table T02 (#t02-generator-state), List L01 (#l01-generator-functions), (#strategy, #assumptions)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` — new state field, setFormulasAndRef wrapper, updated runDerive, loadPreset, handleRecipeImported, currentRecipe, mode toggle onClick handlers

**Tasks:**
- [ ] Import `DARK_FORMULAS`, `LIGHT_FORMULAS`, and `DerivationFormulas` type from theme-derivation-engine
- [ ] Add `const [formulas, setFormulas] = useState<DerivationFormulas>(DEFAULT_RECIPE.formulas ?? DARK_FORMULAS)` after the existing state declarations
- [ ] Add `const formulasRef = useRef<DerivationFormulas>(formulas)` after the useState declaration
- [ ] Define `setFormulasAndRef` as a plain function: `function setFormulasAndRef(f: DerivationFormulas) { setFormulas(f); formulasRef.current = f; }` — this synchronously updates both state and ref at every call site, with no useEffect
- [ ] Update `loadPreset()`: call `setFormulasAndRef(r.formulas ?? DARK_FORMULAS)` to set formulas from preset
- [ ] Update `handleRecipeImported()`: call `setFormulasAndRef(r.formulas ?? DARK_FORMULAS)` to extract formulas from imported recipe
- [ ] Update `runDerive()`: read `formulasRef.current` inside the callback body and include it as `formulas` in the assembled ThemeRecipe object (no signature change needed)
- [ ] Update the `useEffect` that calls runDerive on mode/hue changes: add `formulas` to the dependency array so toggling mode triggers re-derivation with the new formulas
- [ ] Update `currentRecipe` useMemo: include `formulas` in the assembled recipe object and in the dependency array
- [ ] Update Dark mode button onClick: `() => { setMode("dark"); setFormulasAndRef(DARK_FORMULAS); }`
- [ ] Update Light mode button onClick: `() => { setMode("light"); setFormulasAndRef(LIGHT_FORMULAS); }`
- [ ] (handleSliderChange and its 3 MoodSlider call sites remain unchanged — runDerive reads formulas from ref)

**Tests:**
- [ ] Loading the Harmony preset produces output matching `deriveTheme(EXAMPLE_RECIPES.harmony)`
- [ ] Toggling from Dark to Light switches formulas and re-derives correctly
- [ ] Toggling from Light back to Dark restores DARK_FORMULAS
- [ ] Exported recipe JSON includes the formulas field
- [ ] Importing a recipe with formulas restores them; importing one without formulas falls back to DARK_FORMULAS

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` — TypeScript compiles
- [ ] `cd tugdeck && bun test` — all tests pass

---

#### Step 4: Verify title bar legibility and validate light tone values {#step-4}

**Depends on:** #step-3

**Commit:** `fix(engine): tune light-mode borderSignalTone and semanticSignalTone values`

**References:** [D04] Bug 2 verified after Bug 1 fix, Risk R01 (#r01-tone-tuning), (#success-criteria)

**Artifacts:**
- Potentially modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` — LIGHT_OVERRIDES tone values
- Potentially modified cardFrameActiveTone in LIGHT_OVERRIDES if title bar is still illegible

**Tasks:**
- [ ] Derive Harmony theme and verify that cardFrameActiveTone from LIGHT_OVERRIDES (88) is now used (confirms Bug 2 fix). If the resolved tab-bg-active tone differs from 88, investigate
- [ ] If title bar remains illegible after confirming correct formulas, adjust cardFrameActiveTone in LIGHT_OVERRIDES
- [ ] Verify borderSignalTone and semanticSignalTone LIGHT_OVERRIDES values (initial estimates 40/35) produce border and semantic tokens with tone values below 50 in the resolved output
- [ ] Run validateThemeContrast() on the Harmony-derived output and confirm no new FAIL results compared to Brio baseline
- [ ] If contrast failures appear for light-mode borders or semantics, adjust borderSignalTone/semanticSignalTone values and re-run

**Note:** The initial tone estimates (40/35) are best-guesses. A human will tune these visually post-implementation if needed. The automated checks here ensure the values are in the right ballpark.

**Tests:**
- [ ] Brio (dark) output unchanged after any LIGHT_OVERRIDES tuning
- [ ] Harmony (light) contrast validation produces no new FAIL results vs Brio baseline

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` — TypeScript compiles
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run generate:tokens` — output unchanged

---

#### Step 5: Final Integration Checkpoint {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Formulas tracked as local useState field, [D02] Mode toggle switches formulas, [D03] Two new formula fields for border and semantic tone, [D04] Bug 2 verified after Bug 1 fix, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify end-to-end: load Brio preset, toggle to Light, toggle back to Dark — output matches original Brio
- [ ] Verify end-to-end: load Harmony preset — output matches `deriveTheme(EXAMPLE_RECIPES.harmony)` token-for-token
- [ ] Verify export/import round-trip preserves formulas
- [ ] Verify token count is exactly 373

**Tests:**
- [ ] Harmony preset in generator produces token-for-token match with `deriveTheme(EXAMPLE_RECIPES.harmony)`
- [ ] Brio preset output unchanged from baseline

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bun test`
- [ ] `bun run generate:tokens` — output unchanged

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Theme Generator correctly derives light-mode themes using LIGHT_FORMULAS, with mode-aware border and semantic signal tones.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Harmony preset in generator produces identical output to direct `deriveTheme(EXAMPLE_RECIPES.harmony)` call
- [ ] Dark/Light toggle switches formulas correctly
- [ ] Border and semantic tokens are not neon/glowing on light backgrounds
- [ ] Card title bar is legible in light mode
- [ ] All existing tests pass
- [ ] Token generation output unchanged

**Acceptance tests:**
- [ ] Load Harmony preset, verify all tokens match direct engine call
- [ ] Toggle Dark/Light/Dark, verify correct formulas at each step
- [ ] Export Harmony recipe, re-import, verify formulas preserved

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Consolidate generator's 19+ useState fields into a single state object or useReducer
- [ ] Add automated visual regression tests for light mode tokens

| Checkpoint | Verification |
|------------|--------------|
| TypeScript compiles | `cd tugdeck && bunx tsc --noEmit` |
| Tests pass | `cd tugdeck && bun test` |
| Tokens unchanged | `bun run generate:tokens` |
| Harmony output correct | Manual: load preset, compare with direct engine call |
