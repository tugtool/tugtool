<!-- tugplan-skeleton v2 -->

## Recipe Simplification {#recipe-simplification}

**Purpose:** Replace the 7 vague parameter sliders with 6 direct controls (canvas tone/intensity, frame tone/intensity, accent tone/intensity), enforce contrast algorithmically so illegible combinations cannot happen, simplify compileRecipe, update the UI, and clean up dead code.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-20 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current 7-parameter slider system (Surface Depth, Text Hierarchy, Control Weight, Border Definition, Shadow Depth, Signal Strength, Atmosphere) is vague, opaque, and largely useless for design iteration. Each slider secretly controls dozens of formula fields through interpolation. The names do not match what the sliders do. The user cannot reach the specific values they care about.

Meanwhile, contrast enforcement is incomplete. The engine has `enforceContrastFloor()` machinery inside `evaluateRules()`, but it does not cover all element-on-surface pairings in `ELEMENT_SURFACE_PAIRING_MAP`. Illegible combinations like light-on-light badges still ship.

#### Strategy {#strategy}

- Phase 1: Expand `enforceContrastFloor` coverage inside `evaluateRules()` to iterate every pairing in `ELEMENT_SURFACE_PAIRING_MAP`. After this phase, illegible text is structurally impossible.
- Phase 2: Rewrite `compileRecipe()` internals with new algorithmic derivation logic (contrast-first text tones, offset-based borders, mode-constant shadows) while keeping the existing 7-field `RecipeParameters` interface so the rewrite can be verified in isolation before the interface swap.
- Phase 3: Swap `RecipeParameters` from 7 fields to 6 direct controls, update `PARAMETER_METADATA`, `defaultParameters()`, all test files, and `EXAMPLE_RECIPES`. Delete `FormulaExpansionPanel`, `RecipeDiffView`, and `endpoint-contrast.test.ts` which depend on the old interface.
- Phase 4: Delete the `formulas` escape hatch from `ThemeRecipe`, update `resolveHueSlots()` default parameter, remove all formulas state management from `gallery-theme-generator-content.tsx`, and remove `DARK_FORMULAS`/`LIGHT_FORMULAS` imports.
- Phase 5: Update `validateRecipeJson` and export/import for the new 6-field parameter format.
- Phase 6: Delete dead code — `formula-constants.ts`, old endpoint IIFEs, dead tests and comments.
- Strategy phases map to execution steps as follows: Phase 1 = Step 1, Phase 2 = Step 2, Phase 3 = Steps 3-4 (split + checkpoint), Phase 4 = Step 5, Phase 5 = Step 6, Phase 6 = Step 7, Final verification = Step 8.
- Each phase ships independently with full `bun run generate:tokens` and `bun run audit:tokens` verification.
- Retain tunable formulas per recipe so different theme recipes can produce different values from the same control inputs (the derivation is algorithmic but recipe-specific).

#### Success Criteria (Measurable) {#success-criteria}

- Every slider in the Theme Generator moves exactly one visible thing on screen (manual verification: drag each slider, observe one visual dimension changes)
- `bun run audit:tokens` passes with zero contrast failures for both brio and harmony recipes
- `ELEMENT_SURFACE_PAIRING_MAP` is 100% covered by `enforceContrastFloor` during derivation (verified by contrast dashboard showing zero failures)
- `ThemeRecipe.formulas` field is deleted — no escape hatch (grep confirms zero references)
- `RecipeDiffView`, `FormulaExpansionPanel`, `formula-constants.ts`, and `endpoint-contrast.test.ts` are deleted (file absence check)
- `RecipeParameters` has exactly 6 fields: `canvasTone`, `canvasIntensity`, `frameTone`, `frameIntensity`, `accentTone`, `accentIntensity` (type check)
- All existing tests pass: `cd tugdeck && bun test`

#### Scope {#scope}

1. Expand contrast enforcement to cover all `ELEMENT_SURFACE_PAIRING_MAP` pairings
2. Replace 7 abstract parameters with 6 direct controls
3. Rewrite `compileRecipe()` to derive formulas algorithmically
4. Update Theme Generator UI (sliders, panels, export/import)
5. Delete dead code and update `EXAMPLE_RECIPES`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the RULES table or token naming in `derivation-rules.ts`
- Changing the hue picker UI (`TugHueStrip`)
- Adding new token types
- Changing the contrast threshold values themselves (75/60/60/60/15)
- Backward-compatible migration of old saved recipes (clean break per user decision)

#### Dependencies / Prerequisites {#dependencies}

- `enforceContrastFloor()` binary-search tone clamping function works correctly (verified by existing tests)
- `ELEMENT_SURFACE_PAIRING_MAP` is complete and authoritative (maintained in prior phases)
- `deriveTheme()` four-step pipeline architecture is sound and unchanged

#### Constraints {#constraints}

- Laws of Tug must be followed: appearance changes through CSS and DOM, never React state [L06]
- `bun run generate:tokens` must be run after any engine change (CLAUDE.md requirement)
- `bun run audit:tokens` must pass after every step that touches the derivation pipeline
- React 19.2.4 semantics apply (not React 18)
- No npm usage — bun only

#### Assumptions {#assumptions}

- `enforceContrastFloor` in `evaluateRules` already iterates `ELEMENT_SURFACE_PAIRING_MAP` for chromatic tokens — Phase 1 expands this to cover all pairings
- The 6-phase order from the strategy (contrast enforcement, compileRecipe rewrite, interface swap, formulas removal, UI/validation, cleanup) is the implementation sequence
- `EXAMPLE_RECIPES` brio and harmony will be updated to use the 6 new control fields with sensible midpoint defaults
- `ParameterSlider` component is reused — only `PARAMETER_METADATA` and the `RecipeParameters` type change
- `FormulaExpansionPanel` is deleted entirely
- Old recipes with the old `parameters` field load with new defaults (clean break, no migration shims)

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per the skeleton contract. All anchors are kebab-case, no phase numbers. Design decisions, steps, and specs all carry explicit anchors for stable cross-referencing.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Baseline values for new compileRecipe (DECIDED) {#q01-baseline-values}

**Question:** Should the new `compileRecipe` use DARK_FORMULAS/LIGHT_FORMULAS values as baseline reference (midpoint defaults) or use hardcoded constants?

**Why it matters:** If `compileRecipe` references `formula-constants.ts` at runtime, that file cannot be deleted in the cleanup phase. If values are inlined, the file is dead immediately after Step 2.

**Options (if known):**
- Hardcoded constants in new `compileRecipe` — `formula-constants.ts` becomes dead after Step 2
- Retain `formula-constants.ts` as runtime import in new `compileRecipe`

**Plan to resolve:** Author decision based on codebase analysis.

**Resolution:** DECIDED — Inline the baseline values directly in the new `compileRecipe`. The ~140 formula field values from DARK_FORMULAS/LIGHT_FORMULAS are used as reference during implementation but not imported at runtime. This means `formula-constants.ts` is not imported by `recipe-parameters.ts` after Step 2, but `theme-derivation-engine.ts` still imports it until Step 5 updates `resolveHueSlots()`. The file becomes fully dead after Step 5 and is deleted in Step 7. The `theme-derivation-engine.test.ts` tests that import DARK_FORMULAS for unit testing are updated in Step 3 to use `compileRecipe(mode, defaultParameters())` instead.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Contrast clamping changes token values visibly | med | med | Run `bun run generate:tokens` and visually inspect before/after | Token output diffs show unexpected shifts |
| Algorithmic derivation produces worse defaults than hand-tuned endpoints | high | low | Start from existing DARK_FORMULAS/LIGHT_FORMULAS reference values; verify brio/harmony look identical at midpoint defaults | Visual regression in brio or harmony |
| Deleting formulas escape hatch blocks future customization | low | low | The 6 controls + recipe-specific derivation curves provide sufficient range | User requests direct formula override |

**Risk R01: Contrast clamping visual regression** {#r01-contrast-visual-regression}

- **Risk:** Expanding `enforceContrastFloor` to all pairings may shift tone values that users have come to expect, producing a visible change in brio/harmony appearance.
- **Mitigation:**
  - Run `bun run generate:tokens` before and after Phase 1 and diff the output
  - If any token values change, verify the change improves contrast (not just different)
  - Existing passing pairings should not be affected (floor only clamps failures)
- **Residual risk:** Some edge-case tokens may shift by 1-2 tone units, which is acceptable.

**Risk R02: Algorithmic derivation quality** {#r02-derivation-quality}

- **Risk:** Replacing hand-tuned endpoint bundles with algorithmic derivation could produce worse-looking themes at extreme slider positions.
- **Mitigation:**
  - Use existing DARK_FORMULAS/LIGHT_FORMULAS as the baseline for midpoint (50) values
  - Test at 0, 25, 50, 75, 100 positions for each control
  - Contrast enforcement guarantees legibility regardless of derivation quality
- **Residual risk:** Extreme combinations (e.g., canvasTone=0 + accentTone=0) may produce aesthetically poor but technically correct themes.

---

### Design Decisions {#design-decisions}

#### [D01] Six direct controls replace seven abstract parameters (DECIDED) {#d01-six-direct-controls}

**Decision:** Replace `RecipeParameters` (surfaceDepth, textHierarchy, controlWeight, borderDefinition, shadowDepth, signalStrength, atmosphere) with six direct fields: `canvasTone`, `canvasIntensity`, `frameTone`, `frameIntensity`, `accentTone`, `accentIntensity`. All values 0-100. Tone controls use mode-relative offset semantics (50 = mode reference, 0 = darker, 100 = lighter).

**Rationale:**
- Each control maps to one visible dimension — canvas lightness, canvas saturation, frame lightness, frame saturation, accent lightness, accent saturation
- Mode-relative semantics mean `defaultParameters()` is mode-agnostic (all 50s) and slider labels ("Darker"/"Lighter") make sense in both dark and light modes
- Eliminates hidden side effects where one slider moves dozens of unrelated formula fields
- A theme recipe becomes describable in words: "indigo on light, vivid accents, subtle frame"

**Implications:**
- `RecipeParameters` interface changes from 7 fields to 6 fields
- `PARAMETER_METADATA` array changes from 7 entries to 6 entries
- `compileRecipe()` signature and implementation completely rewritten
- `EXAMPLE_RECIPES` updated to use new control fields
- `defaultParameters()` returns 6 fields at midpoint values

#### [D02] Algorithmic derivation with recipe-specific tuning (DECIDED) {#d02-algorithmic-derivation}

**Decision:** `compileRecipe()` derives all ~140 remaining `DerivationFormulas` fields from the 6 controls + mode using contrast-first derivation. Text tones are found by searching for the minimum tone that satisfies contrast against the surface they render on. Border/divider tones use fixed offsets from their parent surface tone (contrast-checked). Shadow alphas are per-mode constants from current DARK_FORMULAS/LIGHT_FORMULAS reference values. All non-control fields (hue dispatch, sentinel dispatch, structural routing, intensity fields not driven by controls) are hardcoded at reference values from DARK_FORMULAS/LIGHT_FORMULAS. Baseline values are inlined directly — `formula-constants.ts` is not imported at runtime.

**Rationale:**
- Eliminates the 14 endpoint bundles and linear interpolation machinery
- Contrast-first derivation: text tones satisfy contrast structurally, not as an afterthought
- Non-control fields use proven reference values, avoiding quality regressions
- Keeps the system extensible — new recipes can tune the derivation curves without an escape hatch
- Inlining baseline values means `formula-constants.ts` becomes dead code immediately, simplifying the dependency chain

**Implications:**
- `DARK_ENDPOINTS`, `LIGHT_ENDPOINTS`, `DARK_STRUCTURAL_TEMPLATE`, `LIGHT_STRUCTURAL_TEMPLATE` are deleted
- `formula-constants.ts` (`DARK_FORMULAS`/`LIGHT_FORMULAS`) becomes dead code and is deleted in cleanup
- The endpoint IIFE system and interpolation code in `recipe-parameters.ts` are deleted
- Tests that import `DARK_FORMULAS` are updated to use `compileRecipe()` output instead

#### [D03] Delete formulas escape hatch (DECIDED) {#d03-delete-formulas-escape-hatch}

**Decision:** Remove the `formulas` field from `ThemeRecipe` entirely. No direct formula override.

**Rationale:**
- Clean break — the 6 controls + algorithmic derivation provide sufficient expressiveness
- The escape hatch was a migration aid, not a design feature
- Removing it simplifies `deriveTheme()` (no formulas-vs-parameters branching)

**Implications:**
- `ThemeRecipe.formulas` field deleted
- `deriveTheme()` always calls `compileRecipe()` — no bypass path
- `EXAMPLE_RECIPES` brio/harmony no longer carry `formulas` fields
- `resolveHueSlots()` default parameter `recipe.formulas ?? DARK_FORMULAS` must be changed to use `compileRecipe()` output

#### [D04] Delete RecipeDiffView entirely (DECIDED) {#d04-delete-recipe-diff-view}

**Decision:** Remove `RecipeDiffView` component and all references. The new 6-control model does not need a parameter diff visualization — each slider already shows what it does.

**Rationale:**
- The diff view compared interpolated formula fields against a baseline, which was useful when sliders had hidden side effects
- With direct controls, the slider position itself is the diff
- Reduces UI complexity

**Implications:**
- `recipe-diff-view.tsx`, `recipe-diff-view.css`, `recipe-diff-view.test.tsx` deleted
- All imports/references in `src/components/tugways/cards/gallery-theme-generator-content.tsx` removed

#### [D05] Clean break for old recipes (DECIDED) {#d05-clean-break-migration}

**Decision:** Old recipes with the old `parameters` field load with new defaults. No backward-compatibility shims, no migration code.

**Rationale:**
- The old parameters do not map meaningfully to the new controls (7 abstract dimensions vs 6 direct dimensions)
- Clean break avoids code complexity for a rarely-used feature
- TugBank saved themes can be re-authored with the new controls quickly

**Implications:**
- `compileRecipe()` does not detect or handle old-format parameters
- Old saved themes in TugBank will silently use default control values when loaded
- No migration code to maintain or eventually delete

#### [D06] Full ELEMENT_SURFACE_PAIRING_MAP contrast enforcement (DECIDED) {#d06-full-contrast-enforcement}

**Decision:** Expand `enforceContrastFloor` inside `evaluateRules()` to iterate every pairing in `ELEMENT_SURFACE_PAIRING_MAP`, not just chromatic tokens. After this change, every element token is guaranteed to meet its role's contrast threshold against every surface it renders on.

**Rationale:**
- The existing contrast enforcement only covers a subset of pairings
- Illegible text (e.g., light-on-light badges) must be structurally impossible
- Once enforcement is universal, post-hoc contrast tests become verification, not discovery

**Implications:**
- `evaluateRules()` loop must check every pairing after emitting each token
- Some token tone values may shift to meet contrast floors (acceptable — correctness over aesthetics)
- `endpoint-contrast.test.ts` becomes redundant and is deleted in cleanup phase

---

### Specification {#specification}

#### New RecipeParameters Interface {#new-recipe-parameters}

**Spec S01: RecipeParameters (new)** {#s01-recipe-parameters-new}

All tone controls use **mode-relative offset** semantics: 50 = the reference tone for the current mode (dark mode reference ~tone 5, light mode reference ~tone 92). 0 = darker than reference, 100 = lighter than reference. This means `defaultParameters()` returns all-50s regardless of mode, and the labels read "Darker" / "Lighter" rather than "Dark" / "Light".

```typescript
export interface RecipeParameters {
  /** Canvas background lightness (mode-relative). 50 = mode reference, 0 = darker, 100 = lighter. */
  canvasTone: number;     // 0-100
  /** Canvas background color saturation. 0 = achromatic, 100 = vivid. */
  canvasIntensity: number; // 0-100
  /** Card title bar lightness (mode-relative). 50 = mode reference, 0 = darker, 100 = lighter. */
  frameTone: number;      // 0-100
  /** Card title bar color saturation. */
  frameIntensity: number;  // 0-100
  /** Accent/role color lightness (mode-relative). 50 = mode reference, 0 = darker, 100 = lighter. */
  accentTone: number;     // 0-100
  /** Accent/role color saturation. */
  accentIntensity: number; // 0-100
}
```

**Spec S02: Control-to-formula mapping** {#s02-control-formula-mapping}

| Control | Formula fields it drives | Derivation approach |
|---------|------------------------|---------------------|
| `canvasTone` | `surfaceAppTone`, `surfaceCanvasTone`, `surfaceSunkenTone`, `surfaceDefaultTone`, `surfaceRaisedTone`, `surfaceOverlayTone`, `surfaceInsetTone`, `surfaceContentTone`, `surfaceScreenTone` | Mode-relative offset: 50 = mode reference (dark ~tone 5, light ~tone 92). Slider sweeps +-range around reference. Small offsets for layering tiers. |
| `canvasIntensity` | `surfaceAppIntensity`, `surfaceCanvasIntensity`, `surfaceDefaultIntensity`, `surfaceRaisedIntensity`, `surfaceOverlayIntensity`, `surfaceScreenIntensity`, `surfaceInsetIntensity`, `surfaceContentIntensity`, `surfaceAppBaseIntensity`, `atmosphereIntensity` | Direct set with proportional scaling for tiers |
| `frameTone` | `cardFrameActiveTone`, `cardFrameInactiveTone` | Mode-relative offset (same semantics as canvasTone); inactive offset from active |
| `frameIntensity` | `cardFrameActiveIntensity`, `cardFrameInactiveIntensity` | Direct set; inactive proportional to active |
| `accentTone` | `filledSurfaceRestTone`, `filledSurfaceHoverTone`, `filledSurfaceActiveTone`, `badgeTintedSurfaceTone`, `badgeTintedTextTone` | Mode-relative offset (same semantics as canvasTone); hover/active offsets from rest |
| `accentIntensity` | `filledSurfaceRestIntensity` (via chroma), `badgeTintedSurfaceIntensity`, `badgeTintedTextIntensity` | Direct set with proportional scaling |

The remaining ~100+ fields are derived as follows:

**Spec S02a: Derivation strategies for non-control fields** {#s02a-derivation-strategies}

| Field group | Fields (examples) | Derivation strategy |
|------------|-------------------|---------------------|
| **Text tones** | `contentTextTone`, `mutedTextTone`, `subtleTextTone`, `disabledTextTone`, `placeholderTextTone`, `inverseTextTone` | Contrast-first: find minimum tone satisfying contrast threshold against the canvas surface (dark mode: search upward from reference; light mode: search downward). Hierarchy offsets between primary/muted/subtle/disabled are fixed deltas from `contentTextTone`. Reference values from DARK_FORMULAS/LIGHT_FORMULAS used as starting points. |
| **Text intensities** | `contentTextIntensity`, `mutedTextIntensity`, `subtleTextIntensity`, `inverseTextIntensity`, `onCautionTextIntensity`, `onSuccessTextIntensity` | Hardcoded at reference values from DARK_FORMULAS/LIGHT_FORMULAS (chroma of text is not user-controlled). |
| **Border/divider tones** | `borderDefaultTone`, `borderSubtleTone`, `borderStrongTone`, `dividerDefaultTone`, `dividerStrongTone`, `atmosphereBorderTone` | Fixed offset from `canvasTone`: dark mode `+6..+12`, light mode `-6..-12` depending on strength tier. Contrast-checked against canvas surface. Reference offsets extracted from DARK_FORMULAS. |
| **Border/divider intensities** | `borderDefaultIntensity`, `borderSubtleIntensity`, `dividerDefaultIntensity`, `atmosphereBorderIntensity` | Hardcoded at reference values from DARK_FORMULAS/LIGHT_FORMULAS. |
| **Shadow alphas** | `shadowAmbientAlpha`, `shadowDirectAlpha`, `shadowKeyAlpha` | Per-mode constants from reference values (dark = heavier, light = lighter). Not slider-controlled. |
| **Control state tones** | `filledSurfaceHoverTone`, `filledSurfaceActiveTone`, `subtleSurfaceRestTone`, `subtleSurfaceHoverTone`, `subtleSurfaceActiveTone`, `outlineRestTone`, `ghostHoverTone`, `ghostActiveTone` | Fixed offsets from `accentTone` (filled) or `canvasTone` (subtle/ghost): hover = rest +/- 4, active = rest +/- 8. Direction depends on mode. |
| **Control state intensities** | `filledSurfaceHoverIntensity`, `filledSurfaceActiveIntensity`, `subtleSurfaceRestIntensity`, etc. | Proportional to `accentIntensity` or `canvasIntensity` with fixed scaling factors from reference values. |
| **Disabled states** | `disabledSurfaceTone`, `disabledTextTone`, `disabledBorderTone` | Fixed per-mode reference values. Not slider-controlled. |
| **Focus/selection** | `focusRingTone`, `focusRingIntensity`, `selectionTone`, `selectionIntensity` | Hardcoded at reference values. Not slider-controlled. |
| **Hue slot dispatch** | `hueSlot*`, `sentinelDispatch*`, `computedToneOverride*` | Structural routing fields. Copied directly from mode-specific reference values. Never slider-controlled. |
| **Signal intensity** | `signalIntensityValue` | Driven by `accentIntensity` (direct passthrough: value = accentIntensity). Used by `computeTones()` to derive signal-role chroma. Hardcoded at 50 in reference formulas. |
| **Scale/center neutralization** | `surfaceCanvasToneScale`, `surfaceCanvasToneCenter`, `disabledSurfaceToneScale` | Always 0/50/0 respectively. Neutralization overrides per [D04] from prior phases. |

**Spec S03: compileRecipe signature** {#s03-compile-recipe-signature}

```typescript
export function compileRecipe(
  mode: "dark" | "light",
  parameters: RecipeParameters,
): DerivationFormulas
```

The function:
1. Converts mode-relative `canvasTone` (50 = mode reference) to absolute tone (dark reference ~5, light reference ~92) and sets canvas surface tones (with small offsets for layering: sunken, default, raised, overlay)
2. Sets canvas intensities from `canvasIntensity`
3. Sets frame tones/intensities from `frameTone`/`frameIntensity`
4. Sets accent tones/intensities from `accentTone`/`accentIntensity`
5. Derives text tones algorithmically to satisfy contrast against the surfaces
6. Derives border/divider tones from surface tones (fixed offset, contrast-checked)
7. Derives shadow alphas from mode (dark = heavier, light = lighter) — no slider needed
8. Copies structural fields (hue slot dispatch, sentinel dispatch, etc.) from mode-specific defaults inlined in the function body (not imported from `formula-constants.ts`)

**Spec S04: PARAMETER_METADATA (new)** {#s04-parameter-metadata-new}

```typescript
export const PARAMETER_METADATA: ParameterMetadataEntry[] = [
  { paramKey: "canvasTone",      label: "Canvas Tone",      lowLabel: "Darker",  highLabel: "Lighter" },
  { paramKey: "canvasIntensity", label: "Canvas Intensity",  lowLabel: "Neutral", highLabel: "Vivid" },
  { paramKey: "frameTone",       label: "Frame Tone",        lowLabel: "Darker",  highLabel: "Lighter" },
  { paramKey: "frameIntensity",  label: "Frame Intensity",   lowLabel: "Neutral", highLabel: "Vivid" },
  { paramKey: "accentTone",      label: "Accent Tone",       lowLabel: "Darker",  highLabel: "Lighter" },
  { paramKey: "accentIntensity", label: "Accent Intensity",  lowLabel: "Muted",   highLabel: "Vivid" },
];
```

**Spec S05: Affected test files** {#s05-affected-test-files}

**Table T01: Test files requiring updates** {#t01-affected-test-files}

| Test file | What references old code | Updated in step |
|-----------|------------------------|-----------------|
| `src/__tests__/theme-export-import.test.tsx` | Old 7-field parameter keys in test recipes, `validateRecipeJson` tests | #step-5, #step-6 |
| `src/__tests__/gallery-theme-generator-content.test.tsx` | `DARK_FORMULAS`/`LIGHT_FORMULAS` imports, old parameter keys (`surfaceDepth` etc.), formulas escape-hatch tests | #step-3, #step-5 |
| `src/__tests__/theme-derivation-engine.test.ts` | `DARK_FORMULAS` import, formulas-based test recipes, `resolveHueSlots` default parameter tests | #step-3, #step-5 |
| `src/__tests__/parameter-slider.test.tsx` | Old parameter keys (`surfaceDepth`, `textHierarchy`, `controlWeight`), old metadata labels | #step-3 |
| `src/__tests__/recipe-parameters.test.ts` | `getParameterFields()` import, old 7-field `RecipeParameters` keys (`surfaceDepth`, etc.) | #step-3 |
| `src/__tests__/contrast-exceptions.ts` | `LIGHT_FORMULAS` comments (non-functional, but references become stale) | #step-7 |

#### Files to Delete {#files-to-delete}

**List L01: Files to delete** {#l01-files-to-delete}

| File | Reason | Deleted in |
|------|--------|------------|
| `src/components/tugways/formula-constants.ts` | DARK_FORMULAS/LIGHT_FORMULAS replaced by algorithmic derivation | #step-7 |
| `src/components/tugways/formula-expansion-panel.tsx` | UI component depends on deleted `getParameterFields()` | #step-3 |
| `src/components/tugways/formula-expansion-panel.css` | Styles for deleted component | #step-3 |
| `src/components/tugways/recipe-diff-view.tsx` | UI component deleted per [D04], depends on old `RecipeParameters` | #step-3 |
| `src/components/tugways/recipe-diff-view.css` | Styles for deleted component | #step-3 |
| `src/__tests__/endpoint-contrast.test.ts` | Contrast is enforced algorithmically, not tested after the fact | #step-3 |
| `src/__tests__/formula-expansion-panel.test.tsx` | Tests for deleted component | #step-3 |
| `src/__tests__/recipe-diff-view.test.tsx` | Tests for deleted component | #step-3 |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `compileRecipe()` produces correct formula fields for known inputs | Each control at 0, 50, 100 |
| **Integration** | Test `deriveTheme()` end-to-end with new parameters produces valid tokens | Every step that changes the engine |
| **Contract** | `bun run audit:tokens` verifies all contrast pairings pass | Every step that changes derivation |
| **Drift Prevention** | `bun run generate:tokens` output compared before/after | Phase 1 contrast expansion |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Expand contrast enforcement to all pairings {#step-1}

**Commit:** `feat(engine): enforce contrast floor for all ELEMENT_SURFACE_PAIRING_MAP pairings` (or `chore(engine): audit and confirm full contrast enforcement coverage` if coverage is already complete)

**References:** [D06] Full contrast enforcement, Risk R01, (#context, #strategy)

**Artifacts:**
- Modified `theme-derivation-engine.ts` — `evaluateRules()` loop expanded to check every pairing
- Modified tests to verify full coverage

**Tasks:**
- [ ] Audit `evaluateRules()` in `theme-derivation-engine.ts` to identify which `ELEMENT_SURFACE_PAIRING_MAP` entries are currently skipped during contrast enforcement. Determine whether pass 1 (fully-opaque) and pass 2 (composited) already cover all pairings. Skipped cases that are by design (semi-transparent surfaces, composite-dependent tokens) count as covered.
- [ ] **Contingency:** If the audit finds that coverage is already complete (all pairings are either enforced or intentionally skipped by design), this step produces an audit-confirmation commit only — document the coverage findings in a code comment and proceed.
- [ ] If gaps are found: expand the `enforceContrastFloor` call site inside `evaluateRules()` to iterate every entry in `ELEMENT_SURFACE_PAIRING_MAP` for every emitted token, applying the role's contrast threshold
- [ ] Run `bun run generate:tokens` and diff the output to identify any token value changes
- [ ] Update or add tests verifying that all pairings pass contrast after derivation

**Tests:**
- [ ] T-FULL-COVERAGE: After `deriveTheme(EXAMPLE_RECIPES.brio)`, every pairing in `ELEMENT_SURFACE_PAIRING_MAP` passes its role's contrast threshold
- [ ] T-FULL-COVERAGE-HARMONY: Same test for harmony recipe
- [ ] T-FLOOR-IDEMPOTENT: Tokens that already pass contrast are unchanged by the expanded enforcement

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens`
- [ ] `cd tugdeck && bun run audit:tokens`

---

#### Step 2: Rewrite compileRecipe with algorithmic derivation (keep old 7-field interface) {#step-2}

**Depends on:** #step-1

**Commit:** `feat(engine): rewrite compileRecipe with algorithmic derivation`

**References:** [D02] Algorithmic derivation, Spec S02, Spec S02a, Spec S03, [Q01] Baseline values, (#s02-control-formula-mapping, #s02a-derivation-strategies)

**Artifacts:**
- Modified `recipe-parameters.ts` — `compileRecipe()` internals rewritten with algorithmic derivation; old 7-field `RecipeParameters` interface retained temporarily; endpoint bundles and interpolation code deleted; baseline values inlined
- Modified `recipe-parameters.test.ts` — tests for new `compileRecipe()` verifying output against DARK_FORMULAS/LIGHT_FORMULAS reference at midpoint

**Tasks:**
- [ ] Rewrite `compileRecipe()` internals per Spec S03 and Spec S02a: the function still accepts the existing 7-field `RecipeParameters` but internally maps from the old fields to the new derivation logic using the following temporary mapping (all 7 old fields accounted for):
  - `surfaceDepth` (0-100) -> `canvasTone` logic (mode-relative canvas background lightness)
  - `atmosphere` (0-100) -> `canvasIntensity` logic (canvas background saturation)
  - `controlWeight` (0-100) -> `frameTone` logic (mode-relative frame lightness)
  - `borderDefinition` (0-100) -> `frameIntensity` logic (frame saturation)
  - `signalStrength` (0-100) -> `accentTone` logic (mode-relative accent lightness)
  - `textHierarchy` (0-100) -> `accentIntensity` logic (accent saturation)
  - `shadowDepth` (0-100) -> ignored (shadows are now per-mode constants, not slider-controlled)
  This temporary mapping allows verifying derivation correctness before the interface swap in Step 3.
- [ ] Implement contrast-first text tone derivation: `contentTextTone` found by searching for min tone satisfying contrast threshold against `surfaceCanvasTone`. Hierarchy tones (`mutedTextTone`, `subtleTextTone`, `disabledTextTone`, `placeholderTextTone`) as fixed deltas from `contentTextTone`. Reference values from DARK_FORMULAS/LIGHT_FORMULAS as starting points per Spec S02a.
- [ ] Implement border/divider tone derivation: fixed offsets from canvas tone per Spec S02a (dark: `+6..+12`, light: `-6..-12`), contrast-checked against canvas surface.
- [ ] Implement shadow alpha derivation: per-mode constants from DARK_FORMULAS/LIGHT_FORMULAS reference values per Spec S02a.
- [ ] Implement control state tone derivation: filled states as offsets from accent tone (hover +/-4, active +/-8), subtle/ghost as offsets from canvas tone per Spec S02a.
- [ ] Copy structural fields (hue slot dispatch, sentinel dispatch, computed-tone-override, scale/center neutralization) from mode-specific defaults inlined in the function body per Spec S02a.
- [ ] Hardcode all non-control intensity fields at reference values from DARK_FORMULAS/LIGHT_FORMULAS per Spec S02a.
- [ ] Delete `DARK_ENDPOINTS`, `LIGHT_ENDPOINTS`, `DARK_STRUCTURAL_TEMPLATE`, `LIGHT_STRUCTURAL_TEMPLATE` and all interpolation code.
- [ ] Remove the `import { DARK_FORMULAS, LIGHT_FORMULAS } from "./formula-constants"` import from `recipe-parameters.ts` — the new algorithmic derivation inlines all baseline values and does not reference `formula-constants.ts` at runtime.
- [ ] Verify midpoint output: `compileRecipe("dark", defaultParameters())` should produce values close to DARK_FORMULAS for canvas/frame/accent fields. Add a reference comparison test.

**Tests:**
- [ ] T-COMPILE-MIDPOINT: `compileRecipe("dark", defaultParameters())` produces formula values close to current DARK_FORMULAS reference for canvas/frame/accent fields (within +/-5 tone units)
- [ ] T-COMPILE-LIGHT-MIDPOINT: `compileRecipe("light", defaultParameters())` produces formula values close to current LIGHT_FORMULAS reference
- [ ] T-COMPILE-EXTREMES: All 7 parameters at 0 and 100 produce valid (in-range) formula values
- [ ] T-DERIVE-ROUNDTRIP: `deriveTheme()` with default parameters produces tokens that pass `bun run audit:tokens`

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` (zero type errors)
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens`
- [ ] `cd tugdeck && bun run audit:tokens`

---

#### Step 3: Swap RecipeParameters to 6 direct controls and update all consumers {#step-3}

**Depends on:** #step-2

**Commit:** `feat(engine): replace 7 abstract parameters with 6 direct controls`

**References:** [D01] Six direct controls, Spec S01, Spec S04, [D04] Delete RecipeDiffView, Table T01, List L01, (#new-recipe-parameters, #s04-parameter-metadata-new)

**Artifacts:**
- Modified `recipe-parameters.ts` — `RecipeParameters` interface changed to 6 fields, `defaultParameters()` updated, `compileRecipe()` internal mapping removed (now takes 6 fields directly)
- Modified `parameter-slider.tsx` — `PARAMETER_METADATA` updated to 6 entries per Spec S04
- Modified `src/__tests__/parameter-slider.test.tsx` — updated parameter keys and metadata labels
- Modified `src/__tests__/gallery-theme-generator-content.test.tsx` — updated parameter key references, replaced `DARK_FORMULAS` usage with `compileRecipe()` output
- Modified `src/__tests__/recipe-parameters.test.ts` — removed `getParameterFields()` tests; updated `RecipeParameters` construction from old 7-field keys to new 6-field keys (`canvasTone`, `canvasIntensity`, etc.)
- Modified `src/__tests__/theme-derivation-engine.test.ts` — replaced `DARK_FORMULAS` import with `compileRecipe("dark", defaultParameters())`; updated `resolveHueSlots` tests
- Deleted `formula-expansion-panel.tsx`, `formula-expansion-panel.css`, `formula-expansion-panel.test.tsx` — depend on deleted `getParameterFields()` and old `RecipeParameters`
- Deleted `recipe-diff-view.tsx`, `recipe-diff-view.css`, `recipe-diff-view.test.tsx` — depend on old `RecipeParameters` fields
- Deleted `endpoint-contrast.test.ts` — contrast is now enforced algorithmically per [D06]
- Modified `src/components/tugways/cards/gallery-theme-generator-content.tsx` — removed imports/usage of `FormulaExpansionPanel` and `RecipeDiffView`

**Tasks:**
- [ ] Replace `RecipeParameters` interface in `recipe-parameters.ts` with the 6-field version per Spec S01
- [ ] Update `defaultParameters()` to return `{ canvasTone: 50, canvasIntensity: 50, frameTone: 50, frameIntensity: 50, accentTone: 50, accentIntensity: 50 }`
- [ ] Remove the temporary 7-to-new mapping inside `compileRecipe()` — it now directly reads `parameters.canvasTone`, `parameters.canvasIntensity`, etc.
- [ ] Delete `getParameterFields()` export (used only by deleted FormulaExpansionPanel)
- [ ] Update `PARAMETER_METADATA` in `parameter-slider.tsx` to the 6-entry version per Spec S04
- [ ] Update `ParameterMetadataEntry.paramKey` type to `keyof RecipeParameters` (already correct if interface changes)
- [ ] Update `src/__tests__/parameter-slider.test.tsx`: replace old parameter keys (`surfaceDepth`, `textHierarchy`, `controlWeight`, etc.) with new keys (`canvasTone`, `canvasIntensity`, etc.), update metadata label/lowLabel/highLabel assertions per Spec S04
- [ ] Update `src/__tests__/gallery-theme-generator-content.test.tsx`: replace `DARK_FORMULAS`/`LIGHT_FORMULAS` import with `compileRecipe("dark", defaultParameters())`/`compileRecipe("light", defaultParameters())`; update old parameter key references (`surfaceDepth` -> `canvasTone`, etc.); update data-testid references (`ps-range-surfaceDepth` -> `ps-range-canvasTone`)
- [ ] Update `src/__tests__/recipe-parameters.test.ts`: remove tests for deleted `getParameterFields()` export; update all `RecipeParameters` construction to use new 6-field keys (`canvasTone`, `canvasIntensity`, `frameTone`, `frameIntensity`, `accentTone`, `accentIntensity`) instead of old 7-field keys (`surfaceDepth`, `textHierarchy`, `controlWeight`, `borderDefinition`, `shadowDepth`, `signalStrength`, `atmosphere`); update `compileRecipe()` call sites to pass new-format parameter objects
- [ ] Update `src/__tests__/theme-derivation-engine.test.ts`: replace `DARK_FORMULAS` import with `compileRecipe("dark", defaultParameters())`; update all test sites that pass `DARK_FORMULAS` as argument to `resolveHueSlots()` or `computeTones()` to use `compileRecipe()` output; update formulas-based recipe construction in tests
- [ ] Delete `formula-expansion-panel.tsx`, `formula-expansion-panel.css` — depend on deleted `getParameterFields()` and old `RecipeParameters` interface
- [ ] Delete `formula-expansion-panel.test.tsx` — tests for deleted component
- [ ] Delete `recipe-diff-view.tsx`, `recipe-diff-view.css` — depend on old `RecipeParameters` fields per [D04]
- [ ] Delete `recipe-diff-view.test.tsx` — tests for deleted component
- [ ] Delete `endpoint-contrast.test.ts` — contrast is enforced algorithmically per [D06], this test depends on old infrastructure
- [ ] Remove all imports and usages of `FormulaExpansionPanel` and `RecipeDiffView` from `gallery-theme-generator-content.tsx`
- [ ] Fix all remaining TypeScript compilation errors caused by the interface change across the codebase

> **Note:** This step has a large scope (interface swap + file deletions + test updates). Run `bunx tsc --noEmit` iteratively after each sub-group of changes (interface change, then test updates, then file deletions) to catch type errors early rather than accumulating them.

**Tests:**
- [ ] T-PARAM-INTERFACE: `defaultParameters()` returns an object with exactly 6 keys matching the new interface
- [ ] T-METADATA-COUNT: `PARAMETER_METADATA` has exactly 6 entries
- [ ] T-COMPILE-MIDPOINT-6: `compileRecipe("dark", defaultParameters())` still produces formula values close to DARK_FORMULAS reference (verifying the interface swap did not break derivation)
- [ ] T-COMPILE-EXTREMES-6: All 6 new parameters at 0 and 100 produce valid (in-range) formula values -- verifies the new interface handles extremes correctly
- [ ] T-DERIVE-ROUNDTRIP-6: `deriveTheme()` with new 6-field default parameters produces tokens that pass `bun run audit:tokens`
- [ ] T-UI-NO-FORMULA-PANEL: `FormulaExpansionPanel` files do not exist
- [ ] T-UI-NO-DIFF-VIEW: `RecipeDiffView` files do not exist
- [ ] T-NO-ENDPOINT-CONTRAST: `endpoint-contrast.test.ts` does not exist

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` (zero type errors)
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens`
- [ ] `cd tugdeck && bun run audit:tokens`

---

#### Step 4: Interface swap integration checkpoint {#step-4}

> **Note:** This is a lightweight verification-only step. If Step 3's checkpoint already provides sufficient confidence, the implementer may fold these checks into Step 3 and skip this step.

**Depends on:** #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [D01] Six direct controls, [D02] Algorithmic derivation, Spec S01, Spec S02a, (#success-criteria)

**Tasks:**
- [ ] Verify steps 2 and 3 work together: algorithmic derivation (Step 2) produces correct output through the new 6-field interface (Step 3)
- [ ] Verify `deriveTheme(EXAMPLE_RECIPES.brio)` and `deriveTheme(EXAMPLE_RECIPES.harmony)` produce valid themes with zero contrast failures
- [ ] Verify all deleted files from List L01 that were scheduled for Step 3 are gone

**Tests:**
- [ ] T-INTEGRATION-BRIO: `deriveTheme(EXAMPLE_RECIPES.brio)` produces valid output with zero contrast failures through new 6-field interface
- [ ] T-INTEGRATION-HARMONY: `deriveTheme(EXAMPLE_RECIPES.harmony)` produces valid output with zero contrast failures through new 6-field interface

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens`
- [ ] `cd tugdeck && bun run audit:tokens`

---

#### Step 5: Delete formulas escape hatch and remove formulas state management {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(engine): remove formulas escape hatch from ThemeRecipe and all formulas state`

**References:** [D03] Delete formulas escape hatch, Table T01, (#design-decisions)

**Artifacts:**
- Modified `theme-derivation-engine.ts` — `ThemeRecipe.formulas` field removed; `resolveHueSlots()` default parameter changed from `recipe.formulas ?? DARK_FORMULAS` to `compileRecipe(recipe.mode, recipe.parameters ?? defaultParameters())`; removed `DARK_FORMULAS`/`LIGHT_FORMULAS` import from `formula-constants.ts`
- Modified `deriveTheme()` — always calls `compileRecipe()`, no bypass path
- Modified `EXAMPLE_RECIPES` — `formulas` field removed from brio and harmony
- Modified `src/components/tugways/cards/gallery-theme-generator-content.tsx` — removed all formulas state management and `DARK_FORMULAS`/`LIGHT_FORMULAS` import:
  - Deleted `useState<DerivationFormulas | null>(...)` (`formulas` state)
  - Deleted `formulasRef` useRef
  - Deleted `setFormulasAndRef()` helper function
  - Updated `currentRecipe` useMemo to always use `{ parameters }` (never `{ formulas }`)
  - Updated `compiledFormulas` useMemo to always call `compileRecipe(mode, parameters)` (removed `formulas ??` prefix)
  - Updated `runDerive` useEffect dependency array: removed `formulas`
  - Updated recipe assembly inside `runDerive()` and its debounced handler: removed `formulasRef.current !== null ? { formulas: formulasRef.current } :` ternary
  - Updated `loadPreset()`: removed `setFormulasAndRef(r.formulas ?? null)` call
  - Updated `handleRecipeImported()`: removed `setFormulasAndRef(r.formulas ?? null)` call
- Modified `src/__tests__/gallery-theme-generator-content.test.tsx` — removed formulas escape-hatch tests, updated recipe construction to use `parameters` only
- Modified `src/__tests__/theme-derivation-engine.test.ts` — removed formulas-based recipe tests, updated `resolveHueSlots` calls
- Modified `src/__tests__/theme-export-import.test.tsx` — removed formulas round-trip tests

**Tasks:**
- [ ] Remove the `formulas?: DerivationFormulas` field from the `ThemeRecipe` interface
- [ ] Update `deriveTheme()` to always call `compileRecipe(recipe.mode, recipe.parameters ?? defaultParameters())` — remove the `recipe.formulas ??` bypass
- [ ] Update `resolveHueSlots()` default parameter: change `formulas: DerivationFormulas = recipe.formulas ?? DARK_FORMULAS` to `formulas: DerivationFormulas = compileRecipe(recipe.mode, recipe.parameters ?? defaultParameters())`
- [ ] Remove the `import { DARK_FORMULAS, LIGHT_FORMULAS } from "./formula-constants"` import from `theme-derivation-engine.ts` — no longer needed after `resolveHueSlots()` default parameter is updated
- [ ] Verify `EXAMPLE_RECIPES.brio` and `EXAMPLE_RECIPES.harmony` already use `parameters: defaultParameters()` and do not have a `formulas` field (they already do — this is a verification step, not a code change)
- [ ] In `gallery-theme-generator-content.tsx`, delete the `formulas` useState declaration and initial value
- [ ] Delete the `formulasRef` useRef declaration
- [ ] Delete the `setFormulasAndRef()` helper function
- [ ] Update `currentRecipe` useMemo: remove the `formulas !== null ? { formulas } :` ternary, always spread `{ parameters }`; remove `formulas` from dependency array
- [ ] Update `compiledFormulas` useMemo: change `formulas ?? compileRecipe(mode, parameters)` to `compileRecipe(mode, parameters)`; remove `formulas` from dependency array
- [ ] Update `runDerive` useEffect dependency array: remove `formulas`
- [ ] Update recipe assembly inside `runDerive()` and its debounced handler: remove `formulasRef.current !== null ? { formulas: formulasRef.current } :` ternary, always use `{ parameters: parametersRef.current }`
- [ ] Update `loadPreset()`: remove `setFormulasAndRef(r.formulas ?? null)` call
- [ ] Update `handleRecipeImported()`: remove `setFormulasAndRef(r.formulas ?? null)` call, always use `parameters` path
- [ ] Remove the `import { DARK_FORMULAS, LIGHT_FORMULAS } from "@/components/tugways/formula-constants"` import from `gallery-theme-generator-content.tsx` — no longer needed after formulas state is deleted
- [ ] Update `src/__tests__/gallery-theme-generator-content.test.tsx`: remove formulas-based recipe tests (formulas escape-hatch, DARK_FORMULAS round-trip, etc.)
- [ ] Update `src/__tests__/theme-derivation-engine.test.ts`: remove formulas-based recipe construction in tests, update `resolveHueSlots` calls. **Important distinction:** tests that call `resolveHueSlots(recipe)` with no second arg (relying on the default) need no change beyond removing the `formulas` field from the recipe. Tests that construct custom hue-dispatch formulas (e.g., T-RESOLVE-LIGHT's `lightFormulas` with custom `*HueExpression` fields) must continue to pass them as the explicit second argument to `resolveHueSlots(recipe, customFormulas)` — these custom formulas test hue-dispatch routing and cannot be replaced with `compileRecipe()` output. Only tests that used `DARK_FORMULAS` as a passthrough default should be updated to use `compileRecipe("dark", defaultParameters())` instead.
- [ ] Update `src/__tests__/theme-export-import.test.tsx`: remove formulas round-trip preservation test
- [ ] Fix all TypeScript compilation errors from the removed field

**Tests:**
- [ ] T-NO-FORMULAS: `ThemeRecipe` interface has no `formulas` field (compile-time check — code that references it fails)
- [ ] T-BRIO-DERIVE: `deriveTheme(EXAMPLE_RECIPES.brio)` produces valid output with zero contrast failures
- [ ] T-HARMONY-DERIVE: `deriveTheme(EXAMPLE_RECIPES.harmony)` produces valid output with zero contrast failures
- [ ] T-NO-FORMULAS-STATE: grep for `setFormulas\b` in `gallery-theme-generator-content.tsx` returns zero matches

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens`
- [ ] `cd tugdeck && bun run audit:tokens`

---

#### Step 6: Update Theme Generator UI — update validateRecipeJson and export/import {#step-6}

**Depends on:** #step-5

**Commit:** `feat(ui): update validateRecipeJson and export/import for 6 direct controls`

**References:** [D01] Six direct controls, Spec S04, Table T01, (#new-recipe-parameters)

**Artifacts:**
- Modified `src/components/tugways/cards/gallery-theme-generator-content.tsx` — updated `validateRecipeJson` parameter keys, updated export/import serialization
- Modified `src/__tests__/theme-export-import.test.tsx` — updated test recipe parameter keys from old 7-field to new 6-field format, updated `validateRecipeJson` tests

**Tasks:**
- [ ] Update `validateRecipeJson()` in `gallery-theme-generator-content.tsx`: change the `paramKeys` array from `["surfaceDepth", "textHierarchy", "controlWeight", "borderDefinition", "shadowDepth", "signalStrength", "atmosphere"]` to `["canvasTone", "canvasIntensity", "frameTone", "frameIntensity", "accentTone", "accentIntensity"]`
- [ ] Preserve `parameters`-optional behavior per [D05] clean break: if `parameters` is missing or contains only old keys, `validateRecipeJson` still accepts the recipe (it loads with `defaultParameters()`). Old parameter keys (surfaceDepth, textHierarchy, etc.) are accepted but ignored -- no validation error, no migration.
- [ ] Update export/import panel to serialize/deserialize the new 6-field `parameters` object (not the old 7-field version)
- [ ] Update `src/__tests__/theme-export-import.test.tsx`: change test recipe parameter objects from 7 old keys to 6 new keys; update `validateRecipeJson` test cases to use new parameter names; update round-trip tests to assert new parameter keys (e.g., `parsed.parameters.canvasTone` instead of `parsed.parameters.surfaceDepth`)

**Tests:**
- [ ] T-UI-EXPORT: Exported recipe JSON contains `parameters` with 6 fields
- [ ] T-VALIDATE-NEW-KEYS: `validateRecipeJson` accepts a recipe with the 6 new parameter keys
- [ ] T-VALIDATE-PARAMS-OPTIONAL: `validateRecipeJson` accepts a recipe with no `parameters` field (loads with defaults per [D05])
- [ ] T-VALIDATE-OLD-KEYS-IGNORED: `validateRecipeJson` accepts a recipe with old parameter keys (surfaceDepth, etc.) without error -- old keys are accepted but ignored

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bun test`

---

#### Step 7: Delete dead code and update stale references {#step-7}

**Depends on:** #step-6

**Commit:** `chore: delete dead code from recipe simplification`

**References:** [D02] Algorithmic derivation, [D05] Clean break migration, List L01, Table T01, (#files-to-delete)

**Artifacts:**
- Deleted `formula-constants.ts` (DARK_FORMULAS/LIGHT_FORMULAS) — fully dead after Step 5 removed the last imports from `theme-derivation-engine.ts` and `gallery-theme-generator-content.tsx`
- Cleaned up dead imports, dead comments, dead test references
- Updated `src/__tests__/contrast-exceptions.ts` — removed stale LIGHT_FORMULAS comments

**Tasks:**
- [ ] Delete `src/components/tugways/formula-constants.ts`
- [ ] Remove any remaining imports of `DARK_FORMULAS` and `LIGHT_FORMULAS` across the codebase (grep and fix each reference)
- [ ] Remove any remaining imports of `getParameterFields` if any survive
- [ ] Remove any remaining imports of `formula-constants` from `recipe-parameters.ts` and `theme-derivation-engine.ts` (explicit check)
- [ ] Remove dead comments referencing old parameter names (surfaceDepth, textHierarchy, controlWeight, borderDefinition, shadowDepth, signalStrength, atmosphere)
- [ ] Grep for any legacy `signalVividity` references and remove if found (migration shim from prior phases)
- [ ] Update module-level doc comments in `theme-derivation-engine.ts` to describe the new 6-control system instead of the old 7-parameter system
- [ ] Verify `EXAMPLE_RECIPES.brio` and `EXAMPLE_RECIPES.harmony` have correct `parameters` fields and no `formulas` fields
- [ ] Update `src/__tests__/contrast-exceptions.ts`: remove or update stale comments referencing `LIGHT_FORMULAS.cardFrameActiveTone` and similar old-system references. Also update ~60 comment references to old parameter names (`controlWeight`, `borderDefinition`, `textHierarchy`, `surfaceDepth`, `signalStrength`) — replace with the corresponding new control names (`accentTone`, `frameIntensity`/`frameTone`, `accentIntensity`, `canvasTone`, `accentTone`) and update endpoint-constraint annotations to reflect the new algorithmic derivation model (e.g., "at controlWeight=100" becomes "at accentTone=100")
- [ ] Evaluate whether contrast-exceptions entries tagged `[endpoint-constraint]` can be removed now that full contrast enforcement (Step 1) and algorithmic derivation (Step 2) eliminate the endpoint interpolation edge cases that originally caused these failures. Run `bun run audit:tokens` with the exceptions removed to test; if pairings now pass, delete the entries. If some still fail under the new derivation, re-annotate them with the new root cause.

**Tests:**
- [ ] T-NO-DEAD-IMPORTS: `bunx tsc --noEmit` passes with zero errors (no broken imports)
- [ ] T-NO-FORMULA-CONSTANTS: `formula-constants.ts` does not exist

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens`
- [ ] `cd tugdeck && bun run audit:tokens`

---

#### Step 8: Final integration checkpoint {#step-8}

**Depends on:** #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Six direct controls, [D02] Algorithmic derivation, [D03] Delete formulas escape hatch, [D04] Delete RecipeDiffView, [D05] Clean break migration, [D06] Full contrast enforcement, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all success criteria are met
- [ ] Verify all files in List L01 are deleted
- [ ] Verify `RecipeParameters` has exactly 6 fields
- [ ] Verify `ThemeRecipe` has no `formulas` field
- [ ] Verify every `ELEMENT_SURFACE_PAIRING_MAP` pairing passes contrast for brio and harmony

**Tests:**
- [ ] T-FINAL-TOKENS: `bun run generate:tokens && bun run audit:tokens` succeeds end-to-end
- [ ] T-FINAL-TESTS: `bun test` passes with zero failures
- [ ] T-FINAL-TYPES: `bunx tsc --noEmit` passes with zero errors

**Checkpoint:**
- [ ] `cd tugdeck && bun test` (all tests pass)
- [ ] `cd tugdeck && bun run generate:tokens` (tokens generate successfully)
- [ ] `cd tugdeck && bun run audit:tokens` (zero contrast failures)
- [ ] `cd tugdeck && grep -rn "FormulaExpansionPanel\|RecipeDiffView\|formula-constants\|DARK_FORMULAS\|LIGHT_FORMULAS" src/` returns no matches

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A recipe system with 6 direct control sliders (canvas tone/intensity, frame tone/intensity, accent tone/intensity), universal algorithmic contrast enforcement, and no dead code from the old 7-parameter system.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `RecipeParameters` has exactly 6 fields: `canvasTone`, `canvasIntensity`, `frameTone`, `frameIntensity`, `accentTone`, `accentIntensity` (type inspection)
- [ ] `ThemeRecipe` has no `formulas` field (grep verification)
- [ ] Theme Generator renders exactly 6 sliders (UI inspection)
- [ ] `FormulaExpansionPanel`, `RecipeDiffView`, `formula-constants.ts`, `endpoint-contrast.test.ts` do not exist (file absence check)
- [ ] `bun run audit:tokens` passes with zero contrast failures for brio and harmony
- [ ] `bun test` passes with zero failures
- [ ] Each slider moves exactly one visible dimension (manual verification)

**Acceptance tests:**
- [ ] T-EXIT-TOKENS: `bun run generate:tokens && bun run audit:tokens` succeeds
- [ ] T-EXIT-TESTS: `bun test` passes
- [ ] T-EXIT-TYPES: `bunx tsc --noEmit` passes
- [ ] T-EXIT-NO-DEAD-CODE: grep for deleted symbols returns zero matches

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add per-recipe derivation curves (different offset/scaling functions for different recipe styles)
- [ ] Add canvas/frame/accent preview swatches next to each slider
- [ ] Consider exposing shadow depth as a 7th optional control if users request it
- [ ] Performance optimization: memoize `compileRecipe()` output when parameters have not changed

| Checkpoint | Verification |
|------------|--------------|
| All contrast pairings pass | `bun run audit:tokens` |
| All tests pass | `bun test` |
| Type safety | `bunx tsc --noEmit` |
| No dead code | grep for deleted symbols |
| Tokens generate correctly | `bun run generate:tokens` |
