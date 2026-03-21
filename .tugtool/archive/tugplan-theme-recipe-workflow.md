<!-- tugplan-skeleton v2 -->

## Theme Recipe Workflow {#theme-recipe-workflow}

**Purpose:** Replace the current bag-of-constants theme system with recipe functions that express design relationships via rules and `contrastSearch`, simplify the Theme Generator card to recipe picker + direct controls, and clean up legacy parameter/formula infrastructure.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | theme-recipe-workflow |
| Last updated | 2026-03-22 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current theme system has ~200 hardcoded constants per mode (DARK_FORMULAS / LIGHT_FORMULAS) with no actual formulas expressing design relationships. The light theme is defined relative to dark rather than standing on its own. Seven abstract sliders interpolate between endpoint bundles — a mechanism that obscures what is being controlled and prevents meaningful user adjustment. Contrast enforcement covers most but not all element-on-surface pairings.

The roadmap at `roadmap/theme-recipe-workflow.md` describes a two-part workflow: (1) author theme recipes as TypeScript functions that express relationships via rules and `contrastSearch`, reducing ~200 constants to ~20-30 rules + ~50 constants, and (2) create themes from recipes with a simplified Theme Generator card.

#### Strategy {#strategy}

- Build dark recipe function first as the proof of concept, establishing `RecipeControls`, `contrastSearch`, and the recipe registry pattern.
- Build light recipe function independently — not derived from dark — so the light theme stands on its own with its own rules.
- Complete contrast enforcement coverage before wiring into the UI, so the safety net is solid.
- Wire into the Theme Generator as a replacement for the old slider system, using a TugButton dark|light toggle and direct controls.
- Clean up last: delete old parameter system, old components, and propagate renames only after everything new is working.
- Run `bun run generate:tokens` after every step that touches the engine or formula output.
- Run `bun run audit:tokens` subcommands in every step's checkpoints to verify token correctness.

#### Success Criteria (Measurable) {#success-criteria}

- `darkRecipe(defaultDarkControls)` produces a `DerivationFormulas` where all element-on-surface pairings pass their contrast role thresholds (verified by `bun run audit:tokens verify`)
- `lightRecipe(defaultLightControls)` produces a `DerivationFormulas` where all element-on-surface pairings pass their contrast role thresholds (verified by `bun run audit:tokens verify`)
- Every pairing in `ELEMENT_SURFACE_PAIRING_MAP` is covered by `enforceContrastFloor` in `evaluateRules` (verified by `bun run audit:tokens pairings` showing zero uncovered pairings)
- Theme Generator card shows dark|light TugButton toggle and direct `RecipeControls` sliders — no old parameter sliders remain
- `recipe-parameters.ts`, `formula-constants.ts`, `FormulaExpansionPanel`, `RecipeDiffView`, and `ParameterSlider` are deleted (source and test files)
- `theme-derivation-engine.ts` is renamed to `theme-engine.ts` with all imports updated
- `ThemeRecipe.mode` is renamed to `ThemeRecipe.recipe` throughout, including `ThemeOutput.mode` and settings API (`fetchGeneratorMode`/`putGeneratorMode`)

#### Scope {#scope}

1. Create `recipe-functions.ts` with `RecipeControls`, `contrastSearch`, `darkRecipe()`, `lightRecipe()`, default controls, and built-in registry
2. Complete contrast enforcement in `evaluateRules` for all pairings in `ELEMENT_SURFACE_PAIRING_MAP`
3. Replace Theme Generator sliders with recipe picker (TugButton toggle) and direct controls
4. Delete old parameter system (`recipe-parameters.ts`, `formula-constants.ts`, `FormulaExpansionPanel`, `RecipeDiffView`, `ParameterSlider`) and their test files
5. Rename `theme-derivation-engine.ts` to `theme-engine.ts` and `ThemeRecipe.mode` to `ThemeRecipe.recipe`; update `generate-tug-tokens.ts` and `theme-accessibility.ts` import paths
6. Update `Expr` type signature, `surface()` builder, `evaluateRules()` signature, and all `derivation-rules.ts` expressions to remove `MoodKnobs`/`ComputedTones` parameters; extend `DerivationFormulas` with `ComputedTones` fields
7. Update `EXAMPLE_RECIPES` entries to use new recipe/controls shape

#### Non-goals (Explicitly out of scope) {#non-goals}

- Stark recipe variants (dark/stark, light/stark) — only dark and light are built
- Visual recipe editor UI (Part 1 panel in the roadmap) — recipes are authored in code for now
- Changing the color palette, hue picker, or token naming system
- Changing contrast threshold values (content 75, control 60, display 60, informational 60, decorative 15)
- Changing the RULES table structure in `derivation-rules.ts` (beyond updating Expr signatures)
- Adding new token types
- Replicating or updating `theme-derivation-engine.test.ts` — its exact-value testing approach is an anti-pattern

#### Dependencies / Prerequisites {#dependencies}

- Existing `enforceContrastFloor` binary-search implementation in `theme-derivation-engine.ts`
- Existing `ELEMENT_SURFACE_PAIRING_MAP` in `element-surface-pairing-map.ts`
- `bun run audit:tokens` tooling (lint, verify, pairings subcommands)
- `bun run generate:tokens` for token regeneration
- OKLCH perceptual contrast math already in `theme-accessibility.ts` (toneToL, computePerceptualContrast)

#### Constraints {#constraints}

- L06: Appearance changes go through CSS and DOM, never React state — live preview uses direct `setThemeOutput(deriveTheme(...))` calls
- L15: Six-slot token convention unchanged — full names throughout (e.g., `shadowMediumAlpha`, not `shadowMdAlpha`)
- L16: Every color-setting rule declares its rendering surface via `@tug-renders-on`
- L17: Component alias tokens resolve in one hop via `COMPONENT_ALIASES`
- L18: Element/surface as canonical vocabulary for rules and contrast enforcement
- D70: OKLCH color palette — recipe rules operate in tone/intensity space
- D80: `--tug-color()` notation — recipes produce numeric inputs for `--tug-color()`
- D81: Machine-auditable pairings — every pairing is contrast-enforced during derivation
- D83: Five contrast roles with fixed thresholds

#### Assumptions {#assumptions}

- `recipe-functions.ts` is placed in `tugdeck/src/components/tugways/` alongside `theme-derivation-engine.ts`
- `contrastSearch` works in tone space (0-100) using the same OKLCH perceptual contrast math already in `enforceContrastFloor` — no new color math library is needed
- The debounced handler pattern for live preview updates carries forward unchanged for the new recipe controls (L06 compliance)
- `bun run generate:tokens` is run after every step that touches the theme engine or formula output

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit, named anchors and rich `References:` lines per the skeleton contract. See the skeleton for full conventions.

---

### Design Decisions {#design-decisions}

#### [D01] Recipe functions replace constant bags (DECIDED) {#d01-recipe-functions}

**Decision:** Each theme recipe is a TypeScript function (`darkRecipe`, `lightRecipe`) that takes `RecipeControls` and returns a complete `DerivationFormulas`. Rules are expressed as code (offsets, `contrastSearch` calls), not as declarative objects or a DSL.

**Rationale:**
- TypeScript functions are debuggable, type-checked, and require no interpreter
- Every relationship is visible: `contentTone = contrastSearch(canvasTone, 75)` is self-documenting
- Overrides work naturally: spread `defaultDarkControls` with user changes, call the function

**Implications:**
- `recipe-functions.ts` must export `darkRecipe`, `lightRecipe`, `defaultDarkControls`, `defaultLightControls`, and the registry
- `compileRecipe()` and endpoint interpolation are deleted in cleanup

#### [D02] contrastSearch is a clean implementation (DECIDED) {#d02-contrast-search}

**Decision:** `contrastSearch` is a new function in `recipe-functions.ts` that binary-searches in tone space (0-100) for a tone meeting a perceptual contrast threshold against a given surface tone. It is not a wrapper around `enforceContrastFloor`.

**Rationale:**
- `enforceContrastFloor` is tightly coupled to `evaluateRules` (takes surfaceL, element hue name, polarity) — recipe functions work in tone space only
- Clean separation: `contrastSearch` is for recipe authoring; `enforceContrastFloor` is the safety net in `evaluateRules`
- Both use the same underlying OKLCH perceptual contrast math (`toneToL`, `computePerceptualContrast`)

**Implications:**
- `contrastSearch` needs access to `toneToL` from `theme-accessibility.ts` (or a re-implementation using `DEFAULT_CANONICAL_L`)
- `enforceContrastFloor` stays as the safety net in `evaluateRules` until cleanup verifies all pairings pass without it

#### [D03] Light recipe is independent (DECIDED) {#d03-light-independent}

**Decision:** `lightRecipe()` is a standalone function with its own rules and constants, not derived from `darkRecipe()` by inverting parameters.

**Rationale:**
- Light themes have fundamentally different tone dynamics (surfaces descend from ~95, text ascends from near-0)
- `contrastSearch` searches in the opposite direction (darker for light, lighter for dark)
- Independent functions are easier to reason about and tune

**Implications:**
- `lightRecipe` and `darkRecipe` share `RecipeControls` interface but have separate default values
- No mode branching in the recipe functions — polarity is implicit in the function body

#### [D04] Pipeline simplification — delete computeTones and MoodKnobs (DECIDED) {#d04-pipeline-simplification}

**Decision:** `computeTones` and `MoodKnobs` are deleted. The pipeline becomes: recipe function -> `resolveHueSlots` -> `evaluateRules` -> tokens. The recipe function produces surface tones directly.

**Rationale:**
- `computeTones` was a shim that scaled formula tones by `surfaceContrast` — the recipe function handles this directly
- `MoodKnobs` carried `surfaceContrast` and `signalIntensity` — both are now in `RecipeControls` or computed by the recipe

**Implications:**
- `evaluateRules` no longer receives `ComputedTones` — Expr signature changes from `(formulas, knobs, computed) => number` to `(formulas) => number`
- All `toneExpr`/`intensityExpr`/`alphaExpr` in `derivation-rules.ts` must be updated to use the new signature
- This is done in Step 6 (pipeline simplification) per user decision

#### [D05] Theme Generator uses TugButton toggles (DECIDED) {#d05-recipe-picker}

**Decision:** The recipe picker is a pair of TugButton toggles (dark | light) inline in the Theme Generator card, not a dropdown or radio group.

**Rationale:**
- Consistent with existing TugButton usage in the UI
- Only two options (dark, light) — a toggle pair is the most compact presentation
- Inline placement keeps the card layout simple

**Implications:**
- Clicking a toggle calls the selected recipe function with current controls and refreshes the preview
- The old parameter sliders and their debounced handlers are removed

#### [D06] Mode rename propagated everywhere (DECIDED) {#d06-mode-rename}

**Decision:** `ThemeRecipe.mode` is renamed to `ThemeRecipe.recipe` throughout, including `ThemeOutput.mode`, and the settings API (`fetchGeneratorMode`/`putGeneratorMode` become `fetchGeneratorRecipe`/`putGeneratorRecipe`). Done in Step 5 (deletion and renames).

**Rationale:**
- "Mode" is confusing — "dark" and "light" are recipe names, not modes
- Clean rename avoids ongoing terminology confusion in the codebase

**Implications:**
- The REST endpoint path `/api/defaults/dev.tugtool.app/generator-mode` stays unchanged (no migration needed for persisted values); only the TypeScript function names change, with a code comment explaining the legacy path
- All imports and references to `ThemeOutput.mode` must be updated

#### [D07] Offset script is one-off (DECIDED) {#d07-offset-script}

**Decision:** Write a one-off Bun script that reads current DARK_FORMULAS/LIGHT_FORMULAS and prints all offsets (e.g., `surfaceSunkenTone - surfaceAppTone = +6`), then delete it after use.

**Rationale:**
- Mechanical reverse-engineering of offsets is error-prone by hand
- A script provides a verifiable audit trail of how rule offsets were derived
- One-off: no maintenance burden

**Implications:**
- Script output is used to write the initial `darkRecipe` and `lightRecipe` function bodies
- Script is deleted after the recipe functions are verified

---

### Specification {#specification}

#### RecipeControls Interface {#recipe-controls}

**Spec S01: RecipeControls** {#s01-recipe-controls}

```ts
interface RecipeControls {
  canvasTone: number;       // how light/dark the background is (dark ~5, light ~95)
  canvasIntensity: number;  // how chromatic the surfaces are (0-100)
  frameTone: number;        // card title bar lightness
  frameIntensity: number;   // card title bar color saturation
  roleTone: number;         // role-colored fill lightness
  roleIntensity: number;    // role color vividness (maps to signalIntensityValue in the pipeline)
}
```

**Note:** The existing pipeline's `signalIntensityValue` is derived from `roleIntensity`. When the recipe function populates `DerivationFormulas`, it sets `signalIntensityValue = controls.roleIntensity`.

#### contrastSearch Function {#contrast-search-spec}

**Spec S02: contrastSearch** {#s02-contrast-search}

```ts
function contrastSearch(
  surfaceTone: number,
  threshold: number,
  direction?: "lighter" | "darker" | "auto",
  hueName?: string
): number
```

- Searches tone space (0-100) for a tone that achieves `threshold` perceptual contrast against `surfaceTone`
- `direction` defaults to `"auto"`: for dark surfaces (tone < 50) searches lighter; for light surfaces (tone >= 50) searches darker
- `hueName` is optional; when omitted, `toneToL` uses its default fallback (`DEFAULT_CANONICAL_L` value of 0.77, matching the "violet" canonical L). Pass a hue name when the element being searched has a known hue slot for more accurate L conversion. Add a code comment in `contrastSearch` noting the generic fallback and that `enforceContrastFloor` provides exact hue-aware correction downstream.
- Uses `toneToL` with `DEFAULT_CANONICAL_L` for tone-to-OKLab-L conversion
- Returns the found tone, clamped to [0, 100]
- Binary search with precision of 0.5 tone units; final result is rounded to the nearest integer so all `DerivationFormulas` fields remain integer-valued (consistent with `enforceContrastFloor` integer precision)

#### Recipe Registry {#recipe-registry}

**Spec S03: Built-in Registry** {#s03-registry}

```ts
const RECIPE_REGISTRY: Record<string, {
  fn: (controls: RecipeControls) => DerivationFormulas;
  defaults: RecipeControls;
}> = {
  dark: { fn: darkRecipe, defaults: defaultDarkControls },
  light: { fn: lightRecipe, defaults: defaultLightControls },
};
```

#### deriveTheme Integration {#derive-theme-integration}

**Spec S04: deriveTheme Recipe Integration** {#s04-derive-theme-integration}

The `ThemeRecipe` interface is extended with an optional `controls` field:

```ts
interface ThemeRecipe {
  mode: string;              // renamed to `recipe` in Step 5 (deletion/renames)
  formulas?: DerivationFormulas;
  parameters?: RecipeParameters;  // deleted in Step 5 (deletion/renames)
  controls?: RecipeControls;      // NEW: recipe control values
  // ... other existing fields
}
```

**deriveTheme precedence** (updated for recipe functions):

1. If `recipe.formulas` is provided, use it directly (existing behavior, unchanged)
2. If `recipe.controls` is provided, look up `RECIPE_REGISTRY[recipe.mode]` and call `registry.fn(recipe.controls)` to produce `DerivationFormulas`
3. If neither is provided, look up `RECIPE_REGISTRY[recipe.mode]` and call `registry.fn(registry.defaults)` to produce `DerivationFormulas`
4. Fall back to `DARK_FORMULAS` if no registry entry exists (removed in Step 5 deletion/renames)

**EXAMPLE_RECIPES.brio** is updated in Step 1 to carry `controls: defaultDarkControls` instead of relying on `parameters`. In Step 2, `EXAMPLE_RECIPES` light entries are similarly updated. In Step 5 (deletion/renames), the `.parameters` field and `compileRecipe` fallback are deleted.

#### Contrast Thresholds {#contrast-thresholds}

**Table T01: Contrast Role Thresholds** {#t01-contrast-thresholds}

| Contrast Role | Threshold | Token Examples |
|--------------|-----------|----------------|
| content | 75 | prose text, body text |
| control | 60 | button labels, tab labels |
| display | 60 | titles, headers |
| informational | 60 | metadata, captions |
| decorative | 15 | ornamental marks, borders |

These thresholds are unchanged from the existing system (D83).

#### Files to Create, Rename, and Delete {#file-changes}

**Table T02: File Changes** {#t02-file-changes}

| Action | File | Purpose |
|--------|------|---------|
| Create | `tugdeck/src/components/tugways/recipe-functions.ts` | Recipe functions, contrastSearch, controls, registry |
| Create (temp) | `tugdeck/scripts/compute-offsets.ts` | One-off offset computation script |
| Rename | `theme-derivation-engine.ts` -> `theme-engine.ts` | Retire confusing "derivation" name |
| Delete | `recipe-parameters.ts` | Old parameter interpolation system |
| Delete | `formula-constants.ts` | Old DARK_FORMULAS/LIGHT_FORMULAS bags of constants |
| Delete | `formula-expansion-panel.tsx` | Old UI component for formula inspection |
| Delete | `formula-expansion-panel.css` | Styles for deleted component |
| Delete | `recipe-diff-view.tsx` | Old UI component for recipe diff |
| Delete | `recipe-diff-view.css` | Styles for deleted component |
| Delete | `parameter-slider.tsx` | Old UI component for parameter sliders |
| Delete | `parameter-slider.css` | Styles for deleted component |
| Delete | `tugdeck/scripts/compute-offsets.ts` | One-off script, deleted after use |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/recipe-functions.ts` | Recipe functions, contrastSearch, default controls, registry |
| `tugdeck/scripts/compute-offsets.ts` | One-off offset computation script (deleted after use) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `RecipeControls` | interface | `recipe-functions.ts` | 6 numeric control fields |
| `contrastSearch` | fn | `recipe-functions.ts` | Binary search in tone space for contrast threshold |
| `darkRecipe` | fn | `recipe-functions.ts` | Dark recipe function: controls -> DerivationFormulas |
| `lightRecipe` | fn | `recipe-functions.ts` | Light recipe function: controls -> DerivationFormulas |
| `defaultDarkControls` | const | `recipe-functions.ts` | Default RecipeControls for dark recipe |
| `defaultLightControls` | const | `recipe-functions.ts` | Default RecipeControls for light recipe |
| `RECIPE_REGISTRY` | const | `recipe-functions.ts` | Map of recipe name -> {fn, defaults} |
| `ThemeRecipe.mode` | field (modify) | `theme-engine.ts` | Renamed to `ThemeRecipe.recipe` in Step 5 (deletion/renames) |
| `ThemeOutput.mode` | field (modify) | `theme-engine.ts` | Renamed to `ThemeOutput.recipe` in Step 5 (deletion/renames) |
| `Expr` | type (modify) | `theme-engine.ts` | Signature changes from `(formulas, knobs, computed) => number` to `(formulas) => number` in Step 6 (pipeline simplification) |
| `evaluateRules` | fn (modify) | `theme-engine.ts` | Remove `knobs: MoodKnobs` and `computed: ComputedTones` parameters in Step 6 (pipeline simplification) |
| `DerivationFormulas` | interface (modify) | `theme-engine.ts` | Extended with `ComputedTones` fields (surface tones etc.) in Step 6 (pipeline simplification) |
| `surface()` | fn (modify) | `derivation-rules.ts` | `toneKey` changes from `keyof ComputedTones` to `keyof DerivationFormulas` in Step 6 (pipeline simplification) |
| `ThemeRecipe.controls` | field (add) | `theme-engine.ts` | Optional `RecipeControls` field added in Step 1 |
| `fetchGeneratorMode` | fn (modify) | `settings-api.ts` | Renamed to `fetchGeneratorRecipe` in Step 5 (deletion/renames) |
| `putGeneratorMode` | fn (modify) | `settings-api.ts` | Renamed to `putGeneratorRecipe` in Step 5 (deletion/renames) |

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Recipe output diverges visually from current brio theme | high | medium | Verify with `bun run audit:tokens verify`; offset script ensures mechanical parity | Audit fails or visual inspection shows unexpected changes |
| contrastSearch produces different tones than enforceContrastFloor for same inputs | medium | low | Both use same toneToL/perceptual contrast math; cross-check results in Step 1 | Contrast audit shows failures after switching to recipe-produced formulas |
| Rename propagation misses a reference | medium | medium | Use IDE rename + grep to find all occurrences; `bun run build` catches type errors | Build fails after rename step |

**Risk R01: Visual Regression During Recipe Transition** {#r01-visual-regression}

- **Risk:** The recipe function output may differ from hand-tuned DARK_FORMULAS/LIGHT_FORMULAS, causing visible theme changes.
- **Mitigation:**
  - Use the one-off offset script to mechanically derive initial rule offsets from current constants
  - Verify `darkRecipe(defaultDarkControls)` produces values that pass all contrast thresholds
  - Visual inspection of the live preview before committing
- **Residual risk:** Minor tone differences in non-contrast-critical areas (e.g., shadow alphas) are acceptable.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Threshold-based audit** | Verify all element-on-surface pairings pass contrast thresholds | After every recipe change — `bun run audit:tokens verify` |
| **Token lint** | Verify CSS annotations, aliases, pairings are correct | After CSS or token changes — `bun run audit:tokens lint` |
| **Build verification** | Ensure TypeScript compiles with no errors | After every code change — `bun run build` |
| **Token generation** | Verify tokens regenerate cleanly | After engine changes — `bun run generate:tokens` |

Note: Per the roadmap, exact-value testing (as in `theme-derivation-engine.test.ts`) is an anti-pattern. Verification is threshold-based via `bun run audit:tokens`.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers — add an anchor instead.

#### Step 1: Write the dark recipe function {#step-1}

**Commit:** `feat(theme): dark recipe function with contrastSearch and RecipeControls`

**References:** [D01] Recipe functions replace constant bags, [D02] contrastSearch is a clean implementation, [D07] Offset script is one-off, Spec S01, Spec S02, Spec S03, Spec S04, Table T01, Table T02, (#recipe-controls, #contrast-search-spec, #recipe-registry, #derive-theme-integration, #context)

**Artifacts:**
- `tugdeck/src/components/tugways/recipe-functions.ts` — new file with `RecipeControls`, `contrastSearch`, `darkRecipe`, `defaultDarkControls`, and `RECIPE_REGISTRY` (dark entry only)
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — updated `deriveTheme` to support recipe function path per Spec S04
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — updated `EXAMPLE_RECIPES.brio` with `controls: defaultDarkControls`
- `tugdeck/scripts/compute-offsets.ts` — one-off offset computation script

**Tasks:**
- [ ] Write `tugdeck/scripts/compute-offsets.ts`: reads `DARK_FORMULAS` from `formula-constants.ts`, prints every field as an offset from `surfaceAppTone` (canvas tone) or as a constant, grouping by semantic decision group. The script must also print `computeTones`-era fields (`surfaceCanvasToneBase`, `surfaceCanvasToneCenter`, `surfaceCanvasToneScale`, `disabledSurfaceToneBase`, `disabledSurfaceToneScale`, etc.) and their required passthrough values (scale=0, center=50, base=desired tone)
- [ ] Run the offset script: `cd tugdeck && bun run scripts/compute-offsets.ts` — review output to identify which values become rules (offsets from `canvasTone`, `contrastSearch` calls) vs constants
- [ ] Create `recipe-functions.ts` with:
  - `RecipeControls` interface (Spec S01)
  - `contrastSearch` function using `toneToL` from `theme-accessibility.ts` and perceptual contrast math (Spec S02)
  - `darkRecipe(controls: RecipeControls): DerivationFormulas` — rules expressed as offsets from controls + `contrastSearch` calls + constants. Must also populate `computeTones`-era fields with passthrough/neutralizing values (scale=0, center=50, base=desired tone) so the still-existing `computeTones()` pipeline produces correct results
  - `defaultDarkControls: RecipeControls` — values that reproduce current DARK_FORMULAS output
  - `RECIPE_REGISTRY` with `dark` entry (Spec S03)
- [ ] Wire `darkRecipe` into `deriveTheme` per Spec S04: when `recipe.controls` is provided and `RECIPE_REGISTRY[recipe.mode]` exists, call `registry.fn(recipe.controls)` to produce `DerivationFormulas`; fall back to `registry.fn(registry.defaults)` when controls are absent
- [ ] Update `EXAMPLE_RECIPES.brio` to include `controls: defaultDarkControls` so `deriveTheme` uses the recipe function path instead of `compileRecipe`
- [ ] Run `bun run generate:tokens` to regenerate tokens with recipe-produced formulas
- [ ] Delete `tugdeck/scripts/compute-offsets.ts` after verifying recipe output

**Tests:**
- [ ] `bun run audit:tokens verify` — all dark theme element-on-surface pairings pass contrast role thresholds (Table T01)
- [ ] `bun run build` — RecipeControls, contrastSearch, darkRecipe, RECIPE_REGISTRY type-check without errors

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` — no type errors
- [ ] `cd tugdeck && bun run generate:tokens` — tokens regenerate cleanly
- [ ] `cd tugdeck && bun run audit:tokens lint` — no lint errors
- [ ] `cd tugdeck && bun run audit:tokens verify` — all dark theme pairings pass contrast thresholds

---

#### Step 2: Write the light recipe function {#step-2}

**Depends on:** #step-1

**Commit:** `feat(theme): light recipe function — independent from dark`

**References:** [D01] Recipe functions replace constant bags, [D02] contrastSearch is a clean implementation, [D03] Light recipe is independent, [D07] Offset script is one-off, Spec S01, Spec S02, Spec S03, Spec S04, Table T01, (#recipe-controls, #contrast-search-spec, #recipe-registry, #derive-theme-integration)

**Artifacts:**
- `tugdeck/src/components/tugways/recipe-functions.ts` — add `lightRecipe`, `defaultLightControls`, update `RECIPE_REGISTRY` with `light` entry
- `tugdeck/scripts/compute-offsets.ts` — recreate temporarily for LIGHT_FORMULAS offsets

**Tasks:**
- [ ] Recreate `tugdeck/scripts/compute-offsets.ts` to read `LIGHT_FORMULAS` and print offsets (surface tones descend from ~95, text searches darker)
- [ ] Run the offset script for light formulas and review output
- [ ] Add `lightRecipe(controls: RecipeControls): DerivationFormulas` to `recipe-functions.ts` — independent rules with own offsets and `contrastSearch` direction (darker for light surfaces). Must also populate `computeTones`-era fields with passthrough/neutralizing values (scale=0, center=50, base=desired tone) so the still-existing `computeTones()` pipeline produces correct results
- [ ] Add `defaultLightControls: RecipeControls` — values that reproduce current LIGHT_FORMULAS output
- [ ] Add `light` entry to `RECIPE_REGISTRY`
- [ ] Wire `lightRecipe` into `deriveTheme` — the Spec S04 registry path added in Step 1 handles this automatically since `RECIPE_REGISTRY` now has a `light` entry
- [ ] Update any `EXAMPLE_RECIPES` entries with light mode to include `controls: defaultLightControls`
- [ ] Run `bun run generate:tokens` with light recipe
- [ ] Delete offset script after verification

**Tests:**
- [ ] `bun run audit:tokens verify` — all light theme element-on-surface pairings pass contrast role thresholds (Table T01)
- [ ] `bun run build` — lightRecipe, defaultLightControls type-check without errors

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` — no type errors
- [ ] `cd tugdeck && bun run generate:tokens` — tokens regenerate cleanly
- [ ] `cd tugdeck && bun run audit:tokens lint` — no lint errors
- [ ] `cd tugdeck && bun run audit:tokens verify` — all light theme pairings pass contrast thresholds

---

#### Step 3: Complete contrast enforcement {#step-3}

**Depends on:** #step-2

**Commit:** `fix(theme): complete contrast enforcement for all element-surface pairings`

**References:** [D02] contrastSearch is a clean implementation, Table T01, (#contrast-thresholds, #success-criteria, #constraints)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — updated `evaluateRules` to cover all pairings in `ELEMENT_SURFACE_PAIRING_MAP`
- `tugdeck/src/components/tugways/element-surface-pairing-map.ts` — any additions needed for uncovered pairings

**Tasks:**
- [ ] Run `cd tugdeck && bun run audit:tokens pairings` to discover all element-on-surface relationships in component CSS
- [ ] Cross-reference audit output with pairings covered by `enforceContrastFloor` in `evaluateRules` — identify gaps
- [ ] For each uncovered pairing: add the pairing to `ELEMENT_SURFACE_PAIRING_MAP` if missing, and ensure `evaluateRules` applies `enforceContrastFloor` for it
- [ ] Verify both dark and light recipes produce compliant tokens after enforcement changes
- [ ] Run `bun run generate:tokens` to regenerate tokens

**Tests:**
- [ ] `bun run audit:tokens verify` — zero contrast failures for both dark and light themes
- [ ] `bun run audit:tokens pairings` — zero uncovered pairings in ELEMENT_SURFACE_PAIRING_MAP

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` — no type errors
- [ ] `cd tugdeck && bun run generate:tokens` — tokens regenerate cleanly
- [ ] `cd tugdeck && bun run audit:tokens lint` — no lint errors
- [ ] `cd tugdeck && bun run audit:tokens verify` — zero contrast failures for both dark and light
- [ ] `cd tugdeck && bun run audit:tokens pairings` — zero uncovered pairings

---

#### Step 4: Wire into Theme Generator {#step-4}

**Depends on:** #step-3

**Commit:** `feat(theme): recipe picker and direct controls in Theme Generator`

**References:** [D01] Recipe functions replace constant bags, [D04] Pipeline simplification, [D05] Theme Generator uses TugButton toggles, Spec S01, Spec S03, (#recipe-controls, #recipe-registry, #constraints)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` — replaced old parameter sliders with recipe picker toggle and RecipeControls sliders

**Tasks:**
- [ ] Add a pair of TugButton toggles (dark | light) inline in the Theme Generator card header area — selecting a toggle calls the corresponding recipe function from `RECIPE_REGISTRY`
- [ ] Replace the 7 old parameter sliders with `RecipeControls` sliders: canvasTone, canvasIntensity, frameTone, frameIntensity, roleTone, roleIntensity (6 sliders total)
- [ ] Wire slider changes to the existing debounced handler pattern (L06 compliance): immediate ref update for slider tracking, debounced `deriveTheme` with recipe-produced formulas for live preview
- [ ] Ensure recipe toggle also triggers a full preview refresh via `setThemeOutput(deriveTheme(...))`
- [ ] Remove old `RecipeParameters` slider UI and `compileRecipe` call from the Theme Generator
- [ ] Add `@tug-renders-on` annotations to any new CSS for the recipe picker and control sliders (L16 compliance)
- [ ] Run `bun run generate:tokens`

**Tests:**
- [ ] `bun run build` — TugButton toggle and RecipeControls sliders type-check without errors
- [ ] `bun run audit:tokens lint` — new CSS annotations valid
- [ ] `bun run audit:tokens verify` — all pairings pass after UI wiring

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` — no type errors
- [ ] `cd tugdeck && bun run generate:tokens` — tokens regenerate cleanly
- [ ] `cd tugdeck && bun run audit:tokens lint` — no lint errors, new CSS annotations valid
- [ ] `cd tugdeck && bun run audit:tokens verify` — all pairings pass
- [ ] Visual verification: Theme Generator card shows dark|light toggle and 6 RecipeControls sliders, no old parameter sliders

---

#### Step 5: Delete old files, rename engine, update tests {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(theme): delete old parameter system, rename engine file`

**References:** [D06] Mode rename propagated everywhere, Table T02, (#file-changes, #symbols, #success-criteria)

**Artifacts:**
- Deleted source files: `recipe-parameters.ts`, `formula-constants.ts`, `formula-expansion-panel.tsx`, `formula-expansion-panel.css`, `recipe-diff-view.tsx`, `recipe-diff-view.css`, `parameter-slider.tsx`, `parameter-slider.css`
- Deleted test files: `recipe-parameters.test.ts`, `formula-expansion-panel.test.tsx`, `recipe-diff-view.test.tsx`, `parameter-slider.test.tsx`, `endpoint-contrast.test.ts`
- Updated test files: `gallery-theme-generator-content.test.tsx` (remove imports/tests for deleted components)
- Renamed: `theme-derivation-engine.ts` -> `theme-engine.ts`
- Updated all import paths from `theme-derivation-engine` to `theme-engine` across: `generate-tug-tokens.ts`, `theme-accessibility.ts`, test files (`theme-derivation-engine.test.ts`, `theme-export-import.test.tsx`, `cvd-preview-auto-fix.test.tsx`, `debug-contrast.test.ts`, `contrast-dashboard.test.tsx`, `theme-accessibility.test.ts`), `vite.config.ts`, `gallery-theme-generator-content.tsx`, `gallery-card.tsx`
- Renamed: `ThemeRecipe.mode` -> `ThemeRecipe.recipe`, `ThemeOutput.mode` -> `ThemeOutput.recipe`
- Renamed: `fetchGeneratorMode`/`putGeneratorMode` -> `fetchGeneratorRecipe`/`putGeneratorRecipe` in `settings-api.ts`
- Updated: `EXAMPLE_RECIPES` entries — `.mode` to `.recipe`, remove `.parameters` field

**Tasks:**
- [ ] Delete `recipe-parameters.ts` — remove all imports of `RecipeParameters`, `compileRecipe`, `defaultParameters` throughout the codebase
- [ ] Delete `formula-constants.ts` — remove all imports of `DARK_FORMULAS`, `LIGHT_FORMULAS` (recipe functions are now the source of truth)
- [ ] Delete `formula-expansion-panel.tsx`, `formula-expansion-panel.css`, `recipe-diff-view.tsx`, `recipe-diff-view.css`, `parameter-slider.tsx`, `parameter-slider.css` — remove all imports and usages from `gallery-theme-generator-content.tsx`
- [ ] Delete test files for deleted components: `recipe-parameters.test.ts`, `formula-expansion-panel.test.tsx`, `recipe-diff-view.test.tsx`, `parameter-slider.test.tsx`, `endpoint-contrast.test.ts`
- [ ] Update `gallery-theme-generator-content.test.tsx` — remove imports and test blocks referencing `ParameterSlider`, `PARAMETER_METADATA`, `FormulaExpansionPanel`, `RecipeDiffView`, `RecipeParameters`, `compileRecipe`
- [ ] Rename `theme-derivation-engine.ts` to `theme-engine.ts` — update all imports across the codebase (use grep to find all `from "./theme-derivation-engine"` and `from "../theme-derivation-engine"` etc.)
- [ ] Update `tugdeck/vite.config.ts` — change the `controlTokenHotReload` plugin's `file.endsWith("theme-derivation-engine.ts")` check to `file.endsWith("theme-engine.ts")` so hot reload continues to work after the rename
- [ ] Update `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` — change import path from `theme-derivation-engine` to `theme-engine`
- [ ] Update code comment in `tugdeck/src/components/tugways/cards/gallery-card.tsx` (line referencing `theme-derivation-engine`) to say `theme-engine`
- [ ] Update `generate-tug-tokens.ts` — change import path from `theme-derivation-engine` to `theme-engine`
- [ ] Update `theme-accessibility.ts` — change import and re-export from `./theme-derivation-engine` to `./theme-engine`
- [ ] Rename `ThemeRecipe.mode` to `ThemeRecipe.recipe` — update the interface and all usages
- [ ] Rename `ThemeOutput.mode` to `ThemeOutput.recipe` — update the interface and all usages
- [ ] Rename `fetchGeneratorMode`/`putGeneratorMode` to `fetchGeneratorRecipe`/`putGeneratorRecipe` in `settings-api.ts` — update all callers. Keep the REST endpoint path as `/api/defaults/dev.tugtool.app/generator-mode` unchanged (previously persisted values use this path); add a code comment in `settings-api.ts` explaining the legacy endpoint name
- [ ] Update `EXAMPLE_RECIPES` entries: rename `.mode` to `.recipe`, remove `.parameters` field, update any entries that reference `DARK_FORMULAS`/`LIGHT_FORMULAS` to use recipe functions instead
- [ ] Run `bun run generate:tokens`

**Tests:**
- [ ] `bun run build` — all deletions and renames compile cleanly
- [ ] Grep for old names returns zero results: `theme-derivation-engine`, `compileRecipe`, `RecipeParameters`, `DARK_FORMULAS`, `LIGHT_FORMULAS`, `fetchGeneratorMode`, `putGeneratorMode`, `FormulaExpansionPanel`, `RecipeDiffView`, `ParameterSlider`, `PARAMETER_METADATA` (comment-only references in `contrast-exceptions.ts` are acceptable)

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` — no type errors (confirms all deletions, renames, and import updates are complete)
- [ ] `cd tugdeck && bun run generate:tokens` — tokens regenerate cleanly
- [ ] `cd tugdeck && bun run audit:tokens lint` — no lint errors
- [ ] `cd tugdeck && bun run audit:tokens verify` — all pairings pass
- [ ] No references to deleted/renamed names remain: grep for `theme-derivation-engine`, `compileRecipe`, `RecipeParameters`, `DARK_FORMULAS`, `LIGHT_FORMULAS`, `fetchGeneratorMode`, `putGeneratorMode`, `FormulaExpansionPanel`, `RecipeDiffView`, `ParameterSlider`, `PARAMETER_METADATA` — all return zero results (note: comment-only references in `contrast-exceptions.ts` are acceptable and excluded from this check)

---

#### Step 6: Pipeline simplification — Expr migration and ComputedTones removal {#step-6}

**Depends on:** #step-5

**Commit:** `refactor(theme): simplify pipeline — single-param Expr, delete computeTones/MoodKnobs`

**References:** [D04] Pipeline simplification, (#symbols, #success-criteria)

**Artifacts:**
- Updated: `Expr` type signature from `(formulas, knobs, computed) => number` to `(formulas) => number`
- Extended: `DerivationFormulas` with fields previously in `ComputedTones` so that `derivation-rules.ts` expressions can read them from `formulas.*`
- Updated: `recipe-functions.ts` — `darkRecipe`/`lightRecipe` updated to populate the new `ComputedTones` fields on `DerivationFormulas` directly, replacing the old passthrough/neutralizing values (scale=0, center=50, base=desired tone) with direct field assignments
- Updated: `surface()` builder in `derivation-rules.ts` — `toneKey` parameter changes from `keyof ComputedTones` to `keyof DerivationFormulas`; `toneExpr` changes from `(_f, _k, computed) => computed[toneKey]` to `(formulas) => formulas[toneKey]`
- Updated: all other `toneExpr`/`intensityExpr`/`alphaExpr` in `derivation-rules.ts` to use new Expr signature
- Updated: `evaluateRules()` signature — remove `knobs: MoodKnobs` and `computed: ComputedTones` parameters
- Deleted: `computeTones`, `MoodKnobs`, `ComputedTones` from engine
- Updated test files: `theme-engine.test.ts` (formerly `theme-derivation-engine.test.ts`, renamed in Step 5) — remove imports of `MoodKnobs`/`ComputedTones`/`compileRecipe` and associated test blocks

**Tasks:**
- [ ] Delete `computeTones` function and `MoodKnobs`/`ComputedTones` types from the engine
- [ ] Extend `DerivationFormulas` interface with all fields previously in `ComputedTones` (e.g., surface tone fields like `surfaceApp`, `surfaceSunken`, etc.) so recipe functions populate them directly
- [ ] Update `darkRecipe` and `lightRecipe` in `recipe-functions.ts` to populate the new `ComputedTones` fields on `DerivationFormulas` directly (e.g., `formulas.surfaceApp = canvasTone`) — replace the old passthrough/neutralizing values (scale=0, center=50, base=desired tone) that were feeding the now-deleted `computeTones()` pipeline
- [ ] Update `Expr` type from `(formulas: DerivationFormulas, knobs: MoodKnobs, computed: ComputedTones) => number` to `(formulas: DerivationFormulas) => number`
- [ ] Update `surface()` builder in `derivation-rules.ts`: change `toneKey` parameter type from `keyof ComputedTones` to `keyof DerivationFormulas`; update `toneExpr` from `(_f, _k, computed) => computed[toneKey]` to `(formulas) => formulas[toneKey]`
- [ ] Update all remaining `toneExpr`, `intensityExpr`, `alphaExpr` expressions in `derivation-rules.ts` to use the new `(formulas) => number` signature — remove references to `knobs` and `computed` parameters
- [ ] Update `evaluateRules()` signature — remove `knobs: MoodKnobs` and `computed: ComputedTones` parameters; update `deriveTheme` call site accordingly
- [ ] Update `theme-engine.test.ts` (renamed from `theme-derivation-engine.test.ts` in Step 5) — remove imports and test blocks referencing `MoodKnobs`, `ComputedTones`, `compileRecipe`
- [ ] Run `bun run generate:tokens`

**Tests:**
- [ ] `bun run build` — Expr signature `(formulas) => number` type-checks across all derivation-rules.ts expressions; `surface()` builder compiles with `keyof DerivationFormulas`
- [ ] Grep for pipeline-era names returns zero results: `MoodKnobs`, `ComputedTones`, `computeTones`

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` — no type errors (confirms Expr signature migration and pipeline simplification are complete)
- [ ] `cd tugdeck && bun run generate:tokens` — tokens regenerate cleanly
- [ ] `cd tugdeck && bun run audit:tokens lint` — no lint errors
- [ ] `cd tugdeck && bun run audit:tokens verify` — all pairings pass
- [ ] No references to pipeline-era names remain: grep for `MoodKnobs`, `ComputedTones`, `computeTones` — all return zero results

---

#### Step 7: Final Integration Checkpoint {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] Recipe functions replace constant bags, [D03] Light recipe is independent, [D04] Pipeline simplification, [D06] Mode rename propagated everywhere, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify the complete pipeline: recipe function -> resolveHueSlots -> evaluateRules -> tokens
- [ ] Verify dark theme: `darkRecipe(defaultDarkControls)` -> `deriveTheme` -> all pairings pass
- [ ] Verify light theme: `lightRecipe(defaultLightControls)` -> `deriveTheme` -> all pairings pass
- [ ] Verify Theme Generator card: toggle between dark and light, adjust all 6 controls, confirm live preview updates correctly
- [ ] Verify no old infrastructure remains (Steps 5 and 6 cleanup is complete)

**Tests:**
- [ ] `bun run audit:tokens verify` — zero contrast failures across both dark and light with full pipeline
- [ ] `bun run audit:tokens pairings` — zero uncovered pairings end-to-end

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` — clean build, no warnings
- [ ] `cd tugdeck && bun run generate:tokens` — tokens regenerate cleanly
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero errors
- [ ] `cd tugdeck && bun run audit:tokens verify` — zero contrast failures
- [ ] `cd tugdeck && bun run audit:tokens pairings` — zero uncovered pairings

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Theme recipes expressed as TypeScript functions with rules and `contrastSearch`, wired into a simplified Theme Generator card with recipe picker and direct controls, with old parameter/formula infrastructure removed.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `recipe-functions.ts` exports `darkRecipe`, `lightRecipe`, `defaultDarkControls`, `defaultLightControls`, `contrastSearch`, `RECIPE_REGISTRY` — all type-correct (`bun run build`)
- [ ] Both recipes produce themes where all element-on-surface pairings pass contrast thresholds (`bun run audit:tokens verify`)
- [ ] Every pairing in `ELEMENT_SURFACE_PAIRING_MAP` is covered by contrast enforcement (`bun run audit:tokens pairings`)
- [ ] Theme Generator card shows dark|light TugButton toggle and 6 RecipeControls sliders (`visual verification`)
- [ ] Old files deleted: `recipe-parameters.ts`, `formula-constants.ts`, `formula-expansion-panel.tsx/.css`, `recipe-diff-view.tsx/.css`, `parameter-slider.tsx/.css` and their test files
- [ ] Engine renamed: `theme-derivation-engine.ts` -> `theme-engine.ts` with all imports updated
- [ ] Field renamed: `ThemeRecipe.recipe` and `ThemeOutput.recipe` replace `.mode` throughout
- [ ] `Expr` signature updated to `(formulas) => number`; `MoodKnobs`/`ComputedTones` deleted
- [ ] `bun run audit:tokens lint` passes with zero errors

**Acceptance tests:**
- [ ] `cd tugdeck && bun run build` — zero errors
- [ ] `cd tugdeck && bun run generate:tokens` — tokens regenerate cleanly
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero errors
- [ ] `cd tugdeck && bun run audit:tokens verify` — zero contrast failures for both dark and light
- [ ] `cd tugdeck && bun run audit:tokens pairings` — zero uncovered pairings

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Stark recipe variants (dark/stark, light/stark)
- [ ] Visual recipe editor UI (Part 1 panel)
- [ ] Custom recipe import/export
- [ ] Delete `theme-derivation-engine.test.ts` or replace with threshold-based tests
- [ ] Remove `enforceContrastFloor` safety net once recipe `contrastSearch` is proven sufficient

| Checkpoint | Verification |
|------------|--------------|
| Dark recipe contrast compliance | `bun run audit:tokens verify` with dark recipe |
| Light recipe contrast compliance | `bun run audit:tokens verify` with light recipe |
| Full pairing coverage | `bun run audit:tokens pairings` — zero uncovered |
| Clean build | `bun run build` — zero errors |
| Token generation | `bun run generate:tokens` — clean |
| Token lint | `bun run audit:tokens lint` — zero errors |
