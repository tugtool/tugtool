<!-- tugplan-skeleton v2 -->

## Phase 4 Plan 1: Recipe Parameter Engine {#recipe-parameter-engine}

**Purpose:** Build `compileRecipe()` that takes 7 design parameters (0-100) and a mode (dark/light) and produces a `DerivationFormulas` object. Replace the 3 mood knobs with 7 parameters. Remove warmth entirely. Wire into `deriveTheme`. Update `EXAMPLE_RECIPES`. Pure TypeScript, no UI.

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

The theme derivation engine currently exposes three "mood knobs" (`surfaceContrast`, `signalIntensity`, `warmth`) that modulate a fraction of the 200-field `DerivationFormulas` wall. These knobs are vague — `warmth` only rotates hue angles on achromatic-adjacent hues by up to 12 degrees, `surfaceContrast` controls tone spreads for surface tiers, and `signalIntensity` is passed through as a raw value. They don't provide meaningful recipe authoring control.

Phase 4 of the theme-system-overhaul roadmap replaces these three knobs with seven design parameters that together cover 134 of the ~201 formula fields (129 from roadmap tables plus 5 signal-tone fields assigned to P6 that the roadmap omitted). Each parameter controls a coherent visual dimension. Plan 1 (this plan) delivers the pure TypeScript compilation pipeline. Plan 2 (separate) delivers the UI.

#### Strategy {#strategy}

- Define `RecipeParameters` interface with 7 numeric fields (0-100, default 50).
- Build mode-specific endpoint bundles (low=0, high=100) for each parameter. Use placeholder offsets initially; visual calibration deferred to Plan 2.
- Implement `compileRecipe(mode, parameters)` that interpolates between endpoints to produce a complete `DerivationFormulas`.
- Remove `warmth` entirely: delete `applyWarmthBias`, `ACHROMATIC_ADJACENT_HUES`, and the warmth parameter from `resolveHueSlots`. Hue angles from the palette are used verbatim.
- Remove `surfaceContrast` and `signalIntensity` mood knobs from `ThemeRecipe`. Fold their effects into the parameter compilation pipeline.
- Update `EXAMPLE_RECIPES` to use `parameters` instead of `formulas`.
- This is a clean break. No backward-compatibility strategy. With placeholder offsets (low = ref * 0.5, high = ref * 1.5), V=50 mathematically reproduces the current reference values. Visual calibration in Plan 2 may change endpoints, so exact identity is not guaranteed long-term.

#### Success Criteria (Measurable) {#success-criteria}

- `compileRecipe("dark", defaultParameters())` produces a `DerivationFormulas` object where all 200 fields are populated (`bun test` — unit test).
- `compileRecipe("light", defaultParameters())` produces a valid `DerivationFormulas` for light mode (`bun test` — unit test).
- `deriveTheme(EXAMPLE_RECIPES.brio)` succeeds and produces 374 tokens (`bun test` — existing integration test).
- `deriveTheme(EXAMPLE_RECIPES.harmony)` succeeds and produces 374 tokens (`bun test` — existing integration test).
- `warmth`, `surfaceContrast`, `signalIntensity` fields no longer exist on `ThemeRecipe` (`bun run check` — type check). `signalIntensity` is retained on `ComputedTones` (derived from `formulas.signalIntensityValue`).
- `applyWarmthBias` and `ACHROMATIC_ADJACENT_HUES` are deleted from the codebase (`grep` verification).
- `bun run check` exits 0.
- `bun test` exits 0.
- `bun run audit:tokens lint` exits 0.

#### Scope {#scope}

1. `RecipeParameters` interface (7 fields)
2. `compileRecipe()` function with endpoint bundles for dark and light modes
3. `ThemeRecipe` interface changes: replace mood knobs with `parameters?: RecipeParameters`
4. `deriveTheme()` wiring: call `compileRecipe()` when parameters present
5. Remove warmth system: `applyWarmthBias`, `ACHROMATIC_ADJACENT_HUES`, warmth parameter in `resolveHueSlots`
6. Fold `surfaceContrast` and `signalIntensity` modulation from `computeTones()` into parameter endpoint values
7. Update `EXAMPLE_RECIPES` (brio, harmony) to use parameters
8. Update gallery UI component to remove 3 mood sliders (minimal — just remove, not replace)
9. Update tests
10. Update theme export/import serialization

#### Non-goals (Explicitly out of scope) {#non-goals}

- Recipe authoring UI (7 sliders) — deferred to Plan 2
- Visual calibration of endpoint bundles — deferred to Plan 2
- Exact numeric reproduction of current `DARK_FORMULAS`/`LIGHT_FORMULAS` at parameter=50
- New recipes (dark/stark, light/stark) — deferred to Plan 2+
- Formula expansion panel, recipe diff view — deferred to Plan 2

#### Dependencies / Prerequisites {#dependencies}

- Phase 3 (independent recipes) is complete — `DARK_FORMULAS` and `LIGHT_FORMULAS` are standalone 200-field objects.
- Phase 3.5B (design vocabulary) is complete — `ThemeRecipe` uses nested `surface`/`element`/`role` structure.
- Phase 3.5C (formula field rename) is complete — formula fields use spelled-out names.

#### Constraints {#constraints}

- No UI changes beyond removing the 3 mood sliders from the gallery theme generator.
- The theme derivation pipeline (3-layer architecture) is preserved. `compileRecipe()` runs before Layer 1; it produces the `DerivationFormulas` that the existing pipeline consumes.
- `bun run audit:tokens lint` must pass — no changes to CSS tokens or pairing map.

#### Assumptions {#assumptions}

- Placeholder endpoint offsets (approximately +/-50% per field, clamped to valid ranges) are acceptable for Plan 1. Visual calibration happens in Plan 2 with the UI.
- The `formulas` escape hatch on `ThemeRecipe` is retained for expert overrides.
- Structural/routing fields (~71 fields: hue-slot-dispatch, hue-name-dispatch, sentinel-hue-dispatch, selection-mode flag, computed-tone-override) are copied from mode templates, not interpolated.
- `computeTones()` surface-contrast scaling (e.g., `surfaceAppTone + ((sc - 50) / 50) * 8`) is absorbed into the endpoint bundles — the endpoints at 0 and 100 encode the extremes that `surfaceContrast` used to modulate. At compile time, the parameter interpolation produces the final tone values. `computeTones()` will use these values directly, with scale factors set to 0.
- `signalIntensity` remains on `ComputedTones` but is no longer passed through from `MoodKnobs`. Instead, `computeTones()` derives it from the compiled formula field `signalIntensityValue` (a P6: Signal Strength field). The 18+ rule expressions in `derivation-rules.ts` that read `computed.signalIntensity` are unchanged.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] ComputedTones surfaceContrast scaling after removal (DECIDED) {#q01-computed-tones-scaling}

**Question:** `computeTones()` applies `surfaceContrast`-based scaling to surface tones (e.g., `surfaceAppTone + ((sc - 50) / 50) * 8`). With `surfaceContrast` removed, how do these computed tones work?

**Why it matters:** If not handled, surface tones become static and lose their parametric variability.

**Resolution:** DECIDED (see [D04]). The `surfaceContrast` scaling is absorbed into the P1: Surface Depth endpoint bundles. The endpoint low (0) and high (100) values for surface tone fields encode the full range that `surfaceContrast` used to provide. After compilation, the formula fields contain the final tone values. `computeTones()` is simplified: the `surfaceCanvasToneScale` and similar scale fields are set to 0 in the compiled output, and `surfaceCanvasToneCenter` is set to 50, making the scaling formulas pass through the base values unchanged.

#### [Q02] How should computed.signalIntensity be provided to the 18+ rule expressions (DECIDED) {#q02-signal-intensity-source}

**Question:** `derivation-rules.ts` has 18+ rule expressions that read `computed.signalIntensity` as a single shared intensity value (e.g., in `borderRampSignal`, `semanticTone`, `signalRamp`, `signalRampAlpha` helpers). With `signalIntensity` removed from `MoodKnobs`, where does this value come from?

**Why it matters:** Removing `computed.signalIntensity` would require rewriting all 18+ rule expressions — a large, error-prone change.

**Resolution:** DECIDED (see [D04]). Keep `signalIntensity` on `ComputedTones`. Add a `signalIntensityValue` formula field to `DerivationFormulas` that P6: Signal Strength compiles. `computeTones()` reads `formulas.signalIntensityValue` and exposes it as `computed.signalIntensity`. All 18+ rule expressions in `derivation-rules.ts` are unchanged.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Visual regression in brio/harmony | med | med | Accept approximate visual equivalence; defer calibration to Plan 2 | Users report obvious problems |
| Endpoint offsets produce invalid formulas | high | low | Clamp all interpolated values to valid ranges; test boundary conditions | Test failures at parameter extremes |
| Gallery component breaks | med | low | Minimal change — just remove sliders, keep everything else | `bun test` gallery tests fail |

**Risk R01: Visual regression in default themes** {#r01-visual-regression}

- **Risk:** Brio and harmony may look slightly different after migration because exact numeric identity with current formulas is not required.
- **Mitigation:** Verify both recipes produce visually reasonable results by running `bun run generate:tokens` and inspecting the generated CSS. Contrast engine validates all pairings. Defer fine-tuning to Plan 2 UI work.
- **Residual risk:** Subtle visual differences remain until Plan 2 calibration.

**Risk R02: Endpoint interpolation produces out-of-range values** {#r02-interpolation-range}

- **Risk:** Linear interpolation between endpoints could produce tone values outside 0-100 or negative intensity/alpha values.
- **Mitigation:** Clamp all interpolated formula values: tones to 0-100, intensities to 0-100, alphas to 0-100. Add boundary tests at parameter values 0 and 100.
- **Residual risk:** Clamping may flatten the response curve at extremes — acceptable for placeholder offsets.

---

### Design Decisions {#design-decisions}

#### [D01] Seven design parameters replace three mood knobs (DECIDED) {#d01-seven-parameters}

**Decision:** Replace `surfaceContrast`, `signalIntensity`, and `warmth` with seven design parameters: Surface Depth, Text Hierarchy, Control Weight, Border Definition, Shadow Depth, Signal Strength, and Atmosphere.

**Rationale:**
- The three mood knobs control a fraction of formula fields and don't map to meaningful design dimensions.
- Seven parameters cover 129 of 200 formula fields across all semantic groups.
- Each parameter maps to a coherent visual dimension that a recipe author can reason about.

**Implications:**
- `ThemeRecipe.surfaceContrast`, `.signalIntensity`, `.warmth` are removed.
- `ThemeRecipe.parameters?: RecipeParameters` is added.
- `MoodKnobs` interface is removed.
- Theme export/import format changes.

#### [D02] Warmth is removed entirely (DECIDED) {#d02-remove-warmth}

**Decision:** Remove `applyWarmthBias()`, `ACHROMATIC_ADJACENT_HUES`, and the warmth parameter from `resolveHueSlots()`. Hue angles from the palette are used verbatim with no runtime rotation.

**Rationale:**
- Warmth only rotated achromatic-adjacent hue angles by up to 12 degrees — a subtle effect that confused more than it helped.
- The new P7: Atmosphere parameter controls chromatic character of neutral surfaces via intensity fields, which is more meaningful than hue rotation.
- Removing warmth simplifies Layer 1 of the derivation pipeline.

**Implications:**
- `resolveHueSlots()` drops the `warmth` parameter and all `applyWarmthBias()` calls.
- `ResolvedHueSlot.angle` is the raw palette angle.
- The `resolveSlot()` inner function simplifies to direct hue resolution.
- `resolveSemanticSlot()` becomes identical to `resolveSlot()` after warmth removal (the only difference was that `resolveSemanticSlot` skipped warmth bias). Merge them into a single `resolveSlot()` function.
- Existing themes may shift by up to 12 degrees on achromatic-adjacent hues (the warmth bias that was previously applied at default 50). In practice, warmth=50 produces a bias of 0, so removing it changes nothing for default themes.

#### [D03] Linear interpolation between curated endpoints (DECIDED) {#d03-linear-interpolation}

**Decision:** Each parameter at value `V` (0-100) produces formula field values by: `fieldValue = low[field] + (V / 100) * (high[field] - low[field])` where `low` and `high` are curated endpoint bundles per mode per parameter.

**Rationale:**
- Simple, predictable, easy to debug.
- At V=50, the interpolation formula produces `low + 0.5 * (high - low)` which is the arithmetic mean of the endpoints. With placeholder offsets (low = ref * 0.5, high = ref * 1.5), V=50 produces `ref * 0.5 + 0.5 * ref = ref`, reproducing the reference value. Visual calibration in Plan 2 may change the endpoints, at which point V=50 will produce the mean of the new endpoints, not necessarily the original reference value.
- Endpoint bundles are the design artifacts; the interpolation is mechanical.

**Implications:**
- 7 parameters x 2 modes = 14 endpoint pairs to define.
- Placeholder offsets used initially; calibration deferred to Plan 2.
- All interpolated values are clamped to valid ranges.

#### [D04] surfaceContrast scaling absorbed into endpoint bundles (DECIDED) {#d04-absorb-surface-contrast}

**Decision:** The `surfaceContrast`-based tone scaling in `computeTones()` (e.g., `surfaceAppTone + ((sc - 50) / 50) * 8`) is absorbed into the P1: Surface Depth endpoint bundles. After `compileRecipe()` runs, the formula fields contain the final tone values and `computeTones()` passes them through unchanged.

**Rationale:**
- The `surfaceContrast` knob was doing exactly what P1: Surface Depth does — modulating surface tone spread. Absorbing it avoids double-modulation.
- `computeTones()` remains in the pipeline but its surface tone formulas become identity operations (scale=0), keeping the pipeline architecture intact.

**Neutralization mechanism:** `computeTones()` has two kinds of `surfaceContrast`-dependent expressions: (1) hardcoded scaling expressions like `surfaceAppTone + ((sc - 50) / 50) * 8` — these are zeroed by passing `sc=50` (since `(50-50)/50 = 0`), leaving only the base formula value; (2) formula-based scale fields like `surfaceCanvasToneScale` that multiply `(sc - 50)` — these require explicit zeroing in the compiled output (set to 0) so the multiplication term vanishes regardless of sc.

**Implications:**
- Compiled formulas set `surfaceCanvasToneScale: 0`, `surfaceCanvasToneCenter: 50`, and `disabledSurfaceToneScale: 0` to zero out formula-based scaling.
- `MoodKnobs.surfaceContrast` is fixed at 50 to zero out hardcoded scaling expressions.
- Together, these two mechanisms ensure `computeTones()` surface tone outputs equal the compiled formula values.
- `signalIntensity` remains on `ComputedTones` but is derived from the compiled formula field `signalIntensityValue` (a P6: Signal Strength field) instead of being passed through from `MoodKnobs`. The 18+ rule expressions in `derivation-rules.ts` that read `computed.signalIntensity` are unchanged.

#### [D05] Structural fields from mode templates, not interpolated (DECIDED) {#d05-structural-templates}

**Decision:** The ~71 structural formula fields (hue-slot-dispatch, hue-name-dispatch, sentinel-hue-dispatch, `selectionInactiveSemanticMode`, and remaining computed-tone-override fields) are copied from a mode template (`DARK_TEMPLATE` or `LIGHT_TEMPLATE`), not interpolated by parameters.

**Rationale:**
- These fields are routing decisions (which hue a token uses) not visual tuning (how bright/saturated).
- They are mode-specific but not slider-controlled.
- Copying from a template keeps them stable regardless of parameter values.

**Implications:**
- `DARK_TEMPLATE` and `LIGHT_TEMPLATE` are extracted from current `DARK_FORMULAS` and `LIGHT_FORMULAS` containing only structural fields.
- `compileRecipe()` starts with the template, then overlays interpolated slider fields.

#### [D06] formulas escape hatch retained (DECIDED) {#d06-formulas-escape-hatch}

**Decision:** `ThemeRecipe.formulas?: DerivationFormulas` remains. If provided, it takes precedence over compiled parameters. If neither `parameters` nor `formulas` is provided, mode defaults apply (all parameters at 50).

**Rationale:**
- Expert authors may need to set individual formula fields that the parameter system doesn't expose.
- Backward compatibility for any code that already constructs recipes with explicit formulas.

**Implications:**
- `deriveTheme()` checks `recipe.formulas` first, then `recipe.parameters`, then defaults.
- The precedence chain is: `formulas` > `compileRecipe(mode, parameters)` > `compileRecipe(mode, defaultParameters())`.

#### [D07] Clean break, no backward compatibility (DECIDED) {#d07-clean-break}

**Decision:** This is a clean break. Brio and harmony should still look right but exact numeric identity with `DARK_FORMULAS`/`LIGHT_FORMULAS` is not required. No backward-compatibility strategy.

**Rationale:**
- Requiring exact midpoint reproduction constrains endpoint design and complicates the implementation.
- The goal is visually equivalent results, validated by the contrast engine.
- Plan 2 UI work will calibrate endpoints to make themes look right.

**Implications:**
- `DARK_FORMULAS` and `LIGHT_FORMULAS` constants may be removed or retained as reference fixtures.
- Tests check that compiled formulas are valid and produce passing themes, not that they match old values exactly.

---

### Specification {#specification}

#### RecipeParameters Interface {#recipe-parameters-interface}

**Spec S01: RecipeParameters** {#s01-recipe-parameters}

```typescript
export interface RecipeParameters {
  /** P1: Surface Depth — tonal separation between surface layers. 0=flat, 100=deep. */
  surfaceDepth: number;       // 0-100, default 50
  /** P2: Text Hierarchy — spread between text levels. 0=democratic, 100=strong order. */
  textHierarchy: number;      // 0-100, default 50
  /** P3: Control Weight — visual heaviness of controls. 0=light, 100=bold. */
  controlWeight: number;      // 0-100, default 50
  /** P4: Border Definition — visibility of structural boundaries. 0=minimal, 100=strong. */
  borderDefinition: number;   // 0-100, default 50
  /** P5: Shadow Depth — elevation prominence. 0=flat, 100=deep. */
  shadowDepth: number;        // 0-100, default 50
  /** P6: Signal Strength — semantic color vividness. 0=muted, 100=vivid. */
  signalStrength: number;     // 0-100, default 50
  /** P7: Atmosphere — chromatic character of neutral surfaces. 0=achromatic, 100=tinted. */
  atmosphere: number;         // 0-100, default 50
}
```

**Spec S02: defaultParameters()** {#s02-default-parameters}

```typescript
export function defaultParameters(): RecipeParameters {
  return {
    surfaceDepth: 50,
    textHierarchy: 50,
    controlWeight: 50,
    borderDefinition: 50,
    shadowDepth: 50,
    signalStrength: 50,
    atmosphere: 50,
  };
}
```

#### compileRecipe Function {#compile-recipe-function}

**Spec S03: compileRecipe()** {#s03-compile-recipe}

```typescript
export function compileRecipe(
  mode: "dark" | "light",
  parameters: RecipeParameters,
): DerivationFormulas
```

**Behavior:**

1. Select mode template: `DARK_STRUCTURAL_TEMPLATE` or `LIGHT_STRUCTURAL_TEMPLATE`.
2. Start with template (structural/routing fields).
3. For each parameter P1-P7, select the mode-specific endpoint pair (`DARK_ENDPOINTS[paramKey]` or `LIGHT_ENDPOINTS[paramKey]`).
4. For each field in the endpoint pair, interpolate: `value = low + (paramValue / 100) * (high - low)`.
5. Clamp numeric results: tones to [0, 100], intensities to [0, 100], alphas to [0, 100].
6. Overlay interpolated fields onto the template.
7. Set `surfaceCanvasToneScale: 0`, `surfaceCanvasToneCenter: 50`, `disabledSurfaceToneScale: 0` to neutralize `computeTones()` scaling. Set `signalIntensityValue` from P6 interpolation — `computeTones()` reads this to populate `computed.signalIntensity`.
8. Return the complete `DerivationFormulas`.

**Table T01: Parameter-to-field mapping summary** {#t01-parameter-field-mapping}

| Parameter | Field count | Key semantic groups |
|-----------|------------|---------------------|
| P1: Surface Depth | 19 | canvas-darkness, surface-layering, surface-coloring |
| P2: Text Hierarchy | 11 | text-brightness, text-hierarchy, text-coloring |
| P3: Control Weight | 33 | filled-control-prominence, outlined-control-style, ghost-control-style |
| P4: Border Definition | 16 | border-visibility, card-frame-style, field-style |
| P5: Shadow Depth | 8 | shadow-depth |
| P6: Signal Strength | 34 | badge-style, icon-style, tab-style, toggle-style, sentinel-alpha, selection-mode, signal-tone |
| P7: Atmosphere | 13 | surface-coloring, text-coloring, field-style |
| **Total slider-controlled** | **135** | |

**Fields added to P6 beyond roadmap tables:** The following 5 formula fields are assigned to P6: Signal Strength because they belong to signal-tone semantics but were not listed in any P1-P7 roadmap table:
- `borderSignalTone` — tone for signal-colored borders (used by `borderRampSignal` helper)
- `semanticSignalTone` — tone for semantic signal tokens (used by `semanticTone` helper)
- `accentSubtleTone` — tone for accent-subtle tokens
- `cautionSurfaceTone` — tone for caution surface backgrounds
- `signalIntensityValue` — the compiled signal intensity value that `computeTones()` reads to populate `computed.signalIntensity` for the 18+ rule expressions in `derivation-rules.ts`

The primary field-to-parameter mapping is defined in the Phase 4 section of `roadmap/theme-system-overhaul.md` under each parameter heading (P1-P7). However, the roadmap tables are known to be incomplete for some groups (e.g., P3's outlined-control-style and ghost-control-style groups may be missing fields). The implementation must cross-reference the roadmap tables against the actual `DerivationFormulas` interface in `theme-derivation-engine.ts` to find any formula fields in the same semantic group that the roadmap omitted. When a field belongs to a semantic group claimed by a parameter but is missing from the roadmap table, include it in that parameter's endpoint bundle.

#### Endpoint Bundle Structure {#endpoint-bundle-structure}

**Spec S04: Endpoint bundles** {#s04-endpoint-bundles}

```typescript
/** Low (0) and high (100) field values for one parameter in one mode. */
interface ParameterEndpoints {
  low: Record<string, number>;   // field values at parameter = 0
  high: Record<string, number>;  // field values at parameter = 100
}

/** All 7 endpoint pairs for one mode. */
type ModeEndpoints = Record<keyof RecipeParameters, ParameterEndpoints>;

/** Both modes. */
const DARK_ENDPOINTS: ModeEndpoints;
const LIGHT_ENDPOINTS: ModeEndpoints;
```

**Endpoint derivation for Plan 1 (placeholder):** For each field controlled by a parameter, the current `DARK_FORMULAS`/`LIGHT_FORMULAS` value is the reference point. The low endpoint uses `referenceValue * 0.5` (clamped) and the high endpoint uses `min(referenceValue * 1.5, maxValid)`. These are intentionally crude — Plan 2 calibrates visually.

#### Updated ThemeRecipe {#updated-theme-recipe}

**Spec S05: ThemeRecipe changes** {#s05-theme-recipe-changes}

Fields removed: `surfaceContrast`, `signalIntensity`, `warmth`.

Field added: `parameters?: RecipeParameters`.

Field retained: `formulas?: DerivationFormulas` (escape hatch per [D06]).

Precedence in `deriveTheme()`: `recipe.formulas` > `compileRecipe(recipe.mode, recipe.parameters)` > `compileRecipe(recipe.mode, defaultParameters())`.

#### Updated deriveTheme Pipeline {#updated-derive-theme}

**Spec S06: deriveTheme() changes** {#s06-derive-theme-changes}

```
deriveTheme(recipe):
  1. formulas = recipe.formulas ?? compileRecipe(recipe.mode, recipe.parameters ?? defaultParameters())
  2. resolvedSlots = resolveHueSlots(recipe, formulas)   // warmth parameter removed
  3. knobs = { surfaceContrast: 50 }                     // fixed default, scaling neutralized
  4. computedTones = computeTones(formulas, knobs)        // derives signalIntensity from formulas.signalIntensityValue
  5. evaluateRules(...)                                   // unchanged — reads computed.signalIntensity as before
```

Note: `MoodKnobs` is retained as an internal interface with only `surfaceContrast` (fixed at 50). The `warmth` and `signalIntensity` fields are removed from `MoodKnobs`. `computeTones()` derives `signalIntensity` for its return value from `formulas.signalIntensityValue` — a new P6: Signal Strength formula field that `compileRecipe()` interpolates. This preserves the `computeTones()` function signature while ensuring the 18+ rule expressions in `derivation-rules.ts` that read `computed.signalIntensity` continue to work. A future cleanup could inline the fixed surfaceContrast and remove `MoodKnobs` entirely, but that is out of scope for this plan.

#### Warmth Removal Details {#warmth-removal-details}

**Spec S07: Warmth removal** {#s07-warmth-removal}

Delete:
- `applyWarmthBias()` function
- `ACHROMATIC_ADJACENT_HUES` constant
- `warmth` parameter from `resolveHueSlots()` signature
- `warmthBias` computation and all its references inside `resolveHueSlots()`
- `warmth` field from `MoodKnobs` interface
- `warmth` field from `ThemeRecipe` interface

Simplify:
- `resolveSlot()` inner function: `resolveHueAngle(hueName)` directly, no bias application.
- All warmth-biased hue resolution paths in `resolveHueSlots()` become direct angle lookups.
- Merge `resolveSemanticSlot()` into `resolveSlot()` — after warmth removal they are identical.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/recipe-parameters.ts` | `RecipeParameters` interface, `defaultParameters()`, `compileRecipe()`, endpoint bundles, structural templates |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `RecipeParameters` | interface | `recipe-parameters.ts` | 7 numeric fields (0-100) |
| `defaultParameters` | fn | `recipe-parameters.ts` | Returns all-50 defaults |
| `compileRecipe` | fn | `recipe-parameters.ts` | `(mode, params) -> DerivationFormulas` |
| `DARK_STRUCTURAL_TEMPLATE` | const | `recipe-parameters.ts` | ~71 structural fields from DARK_FORMULAS |
| `LIGHT_STRUCTURAL_TEMPLATE` | const | `recipe-parameters.ts` | ~71 structural fields from LIGHT_FORMULAS |
| `DARK_ENDPOINTS` | const | `recipe-parameters.ts` | 7 endpoint pairs for dark mode |
| `LIGHT_ENDPOINTS` | const | `recipe-parameters.ts` | 7 endpoint pairs for light mode |
| `ParameterEndpoints` | interface | `recipe-parameters.ts` | `{ low, high }` field value maps |
| `ThemeRecipe.parameters` | field | `theme-derivation-engine.ts` | `RecipeParameters \| undefined` — replaces mood knobs |
| `ThemeRecipe.surfaceContrast` | field | `theme-derivation-engine.ts` | **Removed** |
| `ThemeRecipe.signalIntensity` | field | `theme-derivation-engine.ts` | **Removed** |
| `ThemeRecipe.warmth` | field | `theme-derivation-engine.ts` | **Removed** |
| `MoodKnobs.warmth` | field | `theme-derivation-engine.ts` | **Removed** |
| `applyWarmthBias` | fn | `theme-derivation-engine.ts` | **Deleted** |
| `ACHROMATIC_ADJACENT_HUES` | const | `theme-derivation-engine.ts` | **Deleted** |
| `resolveSemanticSlot` | fn (inner) | `theme-derivation-engine.ts` | **Deleted** — merged into `resolveSlot()` after warmth removal makes them identical |
| `ComputedTones.signalIntensity` | field | `theme-derivation-engine.ts` | **Retained** — derived from `formulas.signalIntensityValue` instead of `MoodKnobs` passthrough |
| `signalIntensityValue` | field | `DerivationFormulas` in `theme-derivation-engine.ts` | **Added** — P6 formula field; `compileRecipe()` interpolates it; `computeTones()` reads it to populate `computed.signalIntensity` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `compileRecipe()` output, `defaultParameters()`, endpoint interpolation, clamping | Core compilation logic |
| **Integration** | Test `deriveTheme()` with parameter-based recipes produces valid 374-token output | End-to-end pipeline |
| **Boundary** | Test `compileRecipe()` at parameter extremes (0 and 100) for all 7 parameters | Edge cases, clamping |
| **Regression** | Test that `EXAMPLE_RECIPES` still produce contrast-passing themes | Backward visual adequacy |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers — add an anchor instead.

#### Step 1: Create RecipeParameters and compileRecipe scaffold {#step-1}

**Commit:** `feat(theme): add RecipeParameters interface and compileRecipe() scaffold`

**References:** [D01] Seven design parameters replace three mood knobs, [D03] Linear interpolation between curated endpoints, [D05] Structural fields from mode templates, Spec S01, Spec S02, Spec S03, Spec S04, Table T01, (#recipe-parameters-interface, #compile-recipe-function, #endpoint-bundle-structure)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/recipe-parameters.ts`
- `RecipeParameters` interface with 7 fields
- `defaultParameters()` function
- `DARK_STRUCTURAL_TEMPLATE` and `LIGHT_STRUCTURAL_TEMPLATE` extracted from current formulas
- `DARK_ENDPOINTS` and `LIGHT_ENDPOINTS` with placeholder offsets
- `compileRecipe()` implementation: template + interpolation + clamping

**Tasks:**
- [ ] Create `recipe-parameters.ts` with `RecipeParameters` interface matching Spec S01
- [ ] Implement `defaultParameters()` matching Spec S02
- [ ] Extract structural fields from `DARK_FORMULAS` into `DARK_STRUCTURAL_TEMPLATE` (hue-slot-dispatch, hue-name-dispatch, sentinel-hue-dispatch, `selectionInactiveSemanticMode`, computed-tone-override routing fields)
- [ ] Extract structural fields from `LIGHT_FORMULAS` into `LIGHT_STRUCTURAL_TEMPLATE`
- [ ] Build `DARK_ENDPOINTS` for all 7 parameters using current `DARK_FORMULAS` values as reference point with placeholder offsets (low = reference * 0.5 clamped, high = reference * 1.5 clamped)
- [ ] Build `LIGHT_ENDPOINTS` for all 7 parameters using current `LIGHT_FORMULAS` values as reference point with same offset strategy
- [ ] Implement `compileRecipe()` per Spec S03: select template, interpolate each parameter's fields, clamp, set scale-neutralizing overrides, return complete `DerivationFormulas`
- [ ] Add `signalIntensityValue` field to `DerivationFormulas` interface — P6 formula field that `computeTones()` reads to populate `computed.signalIntensity`
- [ ] Add `signalIntensityValue: 50` to `DARK_FORMULAS` and `LIGHT_FORMULAS` object literals so the new interface field is satisfied and `bun run check` passes (these constants are still referenced until Step 4 migrates EXAMPLE_RECIPES to parameters)
- [ ] Include `signalIntensityValue` in P6 endpoint bundles (low=0 endpoint: muted, high=100 endpoint: vivid)
- [ ] Include `borderSignalTone`, `semanticSignalTone`, `accentSubtleTone`, `cautionSurfaceTone` in P6 endpoint bundles (these are signal-tone fields omitted from roadmap tables)
- [ ] Ensure all `DerivationFormulas` fields are set (no `undefined` — TypeScript strict mode enforces this)

**Tests:**
- [ ] T1.1: `compileRecipe("dark", defaultParameters())` returns an object satisfying `DerivationFormulas` (all 200 fields populated)
- [ ] T1.2: `compileRecipe("light", defaultParameters())` returns a valid `DerivationFormulas`
- [ ] T1.3: At parameter=0 and parameter=100, all fields are within valid ranges (tones 0-100, intensities 0-100, alphas 0-100)
- [ ] T1.4: `compileRecipe` with partial parameters (some at 0, some at 100) produces valid formulas
- [ ] T1.5: Structural fields in compiled output match the mode template (hue-slot-dispatch fields unchanged by parameters)

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` exits 0
- [ ] `cd tugdeck && bun test src/__tests__/recipe-parameters.test.ts` exits 0

---

#### Step 2: Remove warmth system {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(theme): remove warmth bias system — hue angles used verbatim`

**References:** [D02] Warmth is removed entirely, Spec S07, (#warmth-removal-details)

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/theme-derivation-engine.ts`
  - Delete `applyWarmthBias()` function
  - Delete `ACHROMATIC_ADJACENT_HUES` constant
  - Remove `warmth` parameter from `resolveHueSlots()` signature
  - Remove `warmthBias` computation and all warmth-biased angle calculations
  - Simplify `resolveSlot()` to direct angle resolution
  - Delete `resolveSemanticSlot()` — merge into `resolveSlot()` (identical after warmth removal)
  - Note: `warmth` field on `MoodKnobs` is NOT removed in this step — it stays until Step 3 where MoodKnobs is overhauled. `deriveTheme()` still constructs `MoodKnobs` with `warmth` but the value is unused after `resolveHueSlots()` no longer reads it.

**Tasks:**
- [ ] Delete `applyWarmthBias()` function body and export
- [ ] Delete `ACHROMATIC_ADJACENT_HUES` constant and export
- [ ] Remove `warmth: number` parameter from `resolveHueSlots()` signature
- [ ] Remove `const warmthBias = ((warmth - 50) / 50) * 12;` line
- [ ] Replace all `applyWarmthBias(hueName, rawAngle, warmthBias)` calls with direct `rawAngle` usage inside `resolveHueSlots()`
- [ ] Simplify `resolveSlot()`: `const angle = resolveHueAngle(hueName);` (no bias)
- [ ] Update `surfBareBase` resolution to use direct angle
- [ ] Update `surfScreen` resolution to use direct angle
- [ ] Update `fgMuted`, `fgSubtle`, `fgDisabled`, `fgInverse` resolution to use direct angles
- [ ] Update `selectionInactive` false-branch IIFE: replace `applyWarmthBias(atmHue, (atmBaseAngle - 20 + 360) % 360, warmthBias)` call with direct `slotFromAngle((atmBaseAngle - 20 + 360) % 360)` — the IIFE at line ~2015 wraps both the angle computation and the warmth bias call
- [ ] Update `borderTintBareBase` and `borderStrong` to use direct angles
- [ ] Update all `resolveHueSlots()` call sites (in `deriveTheme()`) to remove warmth argument — but keep `const warmth = recipe.warmth ?? 50;` and `warmth` in `MoodKnobs` construction (removed in Step 3)
- [ ] Update test helper `runCoreRules()` in `theme-derivation-engine.test.ts`: remove `warmth` argument from `resolveHueSlots(recipe, warmth)` call — but keep `warmth` in `MoodKnobs` construction (removed in Step 3)
- [ ] Update test helper `runAllRules()` in `theme-derivation-engine.test.ts`: same — remove `warmth` from `resolveHueSlots()` call but keep in `MoodKnobs`
- [ ] Merge `resolveSlot()` and `resolveSemanticSlot()` into a single `resolveSlot()` function — after warmth removal they are functionally identical (both call `resolveHueAngle()`, `closestHueName()`, `formatHueRef()`). Remove `resolveSemanticSlot()` and replace all call sites (`interactive`, `active`, `accent`, `destructive`, `success`, `caution`, `agent`, `data`, `selectionInactive` true-branch) with `resolveSlot()`
- [ ] Update JSDoc comments referencing warmth bias (not warmth on MoodKnobs); remove "no warmth bias" distinction from `resolveSemanticSlot` comments since the distinction no longer exists

**Tests:**
- [ ] T2.1: `resolveHueSlots` succeeds with warmth parameter removed (2-argument signature: recipe, formulas)
- [ ] T2.2: Resolved hue angles equal raw palette angles (no bias applied)
- [ ] T2.3: Existing hue resolution tests pass (updated to not expect warmth bias)
- [ ] T2.4: All call sites that previously used `resolveSemanticSlot()` now use `resolveSlot()` and produce identical results

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` exits 0
- [ ] `cd tugdeck && bun test` exits 0
- [ ] `grep -r "applyWarmthBias\|ACHROMATIC_ADJACENT_HUES\|resolveSemanticSlot" tugdeck/src/` returns no matches

---

#### Step 3: Update ThemeRecipe and deriveTheme to use parameters {#step-3}

**Depends on:** #step-2

**Commit:** `feat(theme): wire compileRecipe into deriveTheme — parameters replace mood knobs`

**References:** [D01] Seven design parameters replace three mood knobs, [D04] surfaceContrast scaling absorbed, [D06] formulas escape hatch retained, [D07] Clean break, Spec S05, Spec S06, (#updated-theme-recipe, #updated-derive-theme)

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/theme-derivation-engine.ts`
  - `ThemeRecipe`: remove `surfaceContrast`, `signalIntensity`, `warmth`; add `parameters?: RecipeParameters`
  - `deriveTheme()`: new formula resolution: `recipe.formulas ?? compileRecipe(recipe.mode, recipe.parameters ?? defaultParameters())`
  - `MoodKnobs`: remove `warmth` and `signalIntensity` fields; fixed value `{ surfaceContrast: 50 }`
  - Remove `const warmth = recipe.warmth ?? 50;` line from `deriveTheme()` (warmth was kept in Step 2 for MoodKnobs compatibility; now MoodKnobs drops it)
  - `computeTones()` derives `signalIntensity` from `formulas.signalIntensityValue` instead of `knobs.signalIntensity`
  - `ComputedTones.signalIntensity` retained — 18+ rule expressions in `derivation-rules.ts` read it unchanged

**Tasks:**
- [ ] Remove `surfaceContrast?: number`, `signalIntensity?: number`, `warmth?: number` from `ThemeRecipe` interface
- [ ] Add `parameters?: RecipeParameters` to `ThemeRecipe` interface
- [ ] Add import of `RecipeParameters`, `defaultParameters`, `compileRecipe` from `recipe-parameters.ts`
- [ ] Update `deriveTheme()` formula resolution: `const formulas = recipe.formulas ?? compileRecipe(recipe.mode, recipe.parameters ?? defaultParameters());`
- [ ] Remove `warmth` field from `MoodKnobs` interface (deferred from Step 2 to here so `deriveTheme()` knobs construction stays valid until this step overhauls it)
- [ ] Remove `signalIntensity` field from `MoodKnobs` interface
- [ ] Update `deriveTheme()` mood knob section: `const knobs: MoodKnobs = { surfaceContrast: 50 };` (fixed value; `warmth` and `signalIntensity` both removed from `MoodKnobs`)
- [ ] Remove `const warmth = recipe.warmth ?? 50;` line from `deriveTheme()` (no longer needed — warmth argument to `resolveHueSlots()` was already removed in Step 2, and `MoodKnobs` no longer has warmth)
- [ ] Remove `const signalIntensity = recipe.signalIntensity ?? 50;` line from `deriveTheme()`
- [ ] Update `computeTones()` to derive `signalIntensity` from `formulas.signalIntensityValue` instead of `knobs.signalIntensity`: `signalIntensity: Math.round(formulas.signalIntensityValue)`
- [ ] Verify that `ComputedTones.signalIntensity` is retained — the 18+ rule expressions in `derivation-rules.ts` read it unchanged
- [ ] Update test helper `runCoreRules()` in `theme-derivation-engine.test.ts`: remove `warmth` and `signalIntensity` from `MoodKnobs` construction (now only `{ surfaceContrast: 50 }`), update `recipeFormulas` resolution to use `compileRecipe()` instead of `recipe.formulas ?? DARK_FORMULAS`
- [ ] Update test helper `runAllRules()` in `theme-derivation-engine.test.ts`: same changes — remove `warmth` and `signalIntensity` from `MoodKnobs`, use compiled formulas
- [ ] Update standalone `computeTones` test constants `DARK_KNOBS_50` and `LIGHT_KNOBS_50` (currently `{ surfaceContrast: 50, signalIntensity: 50, warmth: 50 }`) to match the new `MoodKnobs` shape (`{ surfaceContrast: 50 }` — warmth and signalIntensity removed). Update all `computeTones()` call sites in the test that inline `MoodKnobs` objects (e.g., `{ surfaceContrast: 0, signalIntensity: 50, warmth: 50 }` becomes `{ surfaceContrast: 0 }`)
- [ ] Rewrite T-TONES-SC signal intensity extremes test: currently tests `MoodKnobs.signalIntensity` pass-through (`signalIntensity: 0` -> `computed.signalIntensity == 0`). After migration, `computed.signalIntensity` is derived from `formulas.signalIntensityValue`. Rewrite to construct `DerivationFormulas` with `signalIntensityValue: 0` and `signalIntensityValue: 100`, call `computeTones()`, and verify `computed.signalIntensity` equals `0` and `100` respectively
- [ ] Update stale comment in `computeTones()` near the `bg-canvas` formula (line ~2169-2171): the comment describes light-mode canvas formula parameters (`surfaceCanvasToneBase=surfaceAppTone, surfaceCanvasToneCenter=50, surfaceCanvasToneScale=8`) which will be inaccurate after `surfaceCanvasToneScale` is set to 0 by compiled formulas. Update the comment to reflect that the scale is neutralized and the formula passes through the compiled tone value directly.
- [ ] Update the header JSDoc comment of the engine to reflect the new pipeline

**Tests:**
- [ ] T3.1: `deriveTheme({ ...minimalRecipe, parameters: defaultParameters() })` produces 374 tokens
- [ ] T3.2: `deriveTheme({ ...minimalRecipe, formulas: DARK_FORMULAS })` still works (escape hatch)
- [ ] T3.3: `deriveTheme({ ...minimalRecipe })` (no parameters, no formulas) uses compiled defaults

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` exits 0
- [ ] `cd tugdeck && bun test` exits 0

---

#### Step 4: Update EXAMPLE_RECIPES and gallery component {#step-4}

**Depends on:** #step-3

**Commit:** `feat(theme): migrate EXAMPLE_RECIPES to parameters, remove mood sliders from gallery`

**References:** [D01] Seven design parameters replace three mood knobs, [D07] Clean break, Spec S05, (#updated-theme-recipe)

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/theme-derivation-engine.ts`
  - `EXAMPLE_RECIPES.brio`: replace `formulas: DARK_FORMULAS` with `parameters: defaultParameters()`
  - `EXAMPLE_RECIPES.harmony`: replace `formulas: LIGHT_FORMULAS` with `parameters: defaultParameters()`
- Modified: `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx`
  - Remove `surfaceContrast`, `signalIntensity`, `warmth` state variables
  - Remove the 3 `MoodSlider` components from JSX
  - Remove mood slider references from `handleSliderChange`, `runDerive`, `buildRecipe`
  - Keep `formulas` state for expert override path
- Verified: `tugdeck/src/components/tugways/derivation-rules.ts` — 18+ `computed.signalIntensity` references unchanged (value now derived from P6 formula field)

**Tasks:**
- [ ] Update `EXAMPLE_RECIPES.brio`: remove `formulas: DARK_FORMULAS`, add `parameters: defaultParameters()`
- [ ] Update `EXAMPLE_RECIPES.harmony`: remove `formulas: LIGHT_FORMULAS`, add `parameters: defaultParameters()`
- [ ] Optionally retain `DARK_FORMULAS` and `LIGHT_FORMULAS` as exported test fixtures (not referenced from recipes)
- [ ] In `gallery-theme-generator-content.tsx`: remove `surfaceContrast`, `signalIntensity`, `warmth` state
- [ ] Remove the 3 `MoodSlider` components and the mood panel `<div>` from the JSX
- [ ] Remove `sc` (surfaceContrast), `sv` (signalIntensity), `w` (warmth) parameters from `runDerive()` — currently takes ~20 positional params; remove these 3 and update all internal references. **Verification:** after editing, count positional params in `runDerive` signature and confirm they match the call sites (search all `runDerive(` invocations and verify argument count matches the new signature)
- [ ] Remove `sc`, `sv`, `w` parameters from `handleSliderChange()` — currently takes ~22 positional params; remove these 3 and update the debounced `runDerive()` call inside. **Verification:** same approach — count params in signature and confirm all `handleSliderChange(` call sites match
- [ ] Update the `useEffect` that calls `runDerive()` directly: remove `surfaceContrast`, `signalIntensity`, `warmth` from the argument list and the dependency array
- [ ] Update `currentRecipe` `useMemo`: remove `surfaceContrast`, `signalIntensity`, `warmth` from the constructed object and the dependency array
- [ ] Remove `surfaceContrast`, `signalIntensity`, `warmth` state variables and their `useState` declarations and setters (`setSurfaceContrast`, `setSignalIntensity`, `setWarmth`)
- [ ] Verify `derivation-rules.ts` references to `computed.signalIntensity` still work — these are unchanged since `ComputedTones.signalIntensity` is retained and derived from `formulas.signalIntensityValue`
- [ ] Remove `setSurfaceContrast(r.surfaceContrast ?? 50)`, `setSignalIntensity(r.signalIntensity ?? 50)`, `setWarmth(r.warmth ?? 50)` calls from `loadPreset()`
- [ ] Remove `setSurfaceContrast(r.surfaceContrast ?? 50)`, `setSignalIntensity(r.signalIntensity ?? 50)`, `setWarmth(r.warmth ?? 50)` calls from `handleRecipeImported()`
- [ ] Update `loadPreset()` to handle `r.formulas` vs `r.parameters` — if recipe has parameters, no longer set formulas from `r.formulas ?? DARK_FORMULAS`
- [ ] Handle formulas/parameters state transition in `loadPreset()`: when loading a parameter-based preset (`r.parameters` present, `r.formulas` absent), set `formulas` state to `null` so `runDerive` builds the recipe without an explicit formulas override. In `runDerive`, conditionally include `formulas` in the recipe object only when the formulas state is non-null (i.e., user explicitly set formulas via the expert override path). This prevents stale formulas state from a previous expert-override session from taking precedence over the newly loaded parameters.

**Tests:**
- [ ] T4.1: `deriveTheme(EXAMPLE_RECIPES.brio)` produces 374 tokens and passes contrast validation
- [ ] T4.2: `deriveTheme(EXAMPLE_RECIPES.harmony)` produces 374 tokens and passes contrast validation
- [ ] T4.3: Gallery component renders without errors (existing gallery tests)

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` exits 0
- [ ] `cd tugdeck && bun test` exits 0
- [ ] `bun run audit:tokens lint` exits 0

---

#### Step 5: Update theme export/import and remaining references {#step-5}

**Depends on:** #step-4

**Commit:** `fix(theme): update export/import serialization for parameter-based recipes`

**References:** [D01] Seven design parameters replace three mood knobs, Spec S01, Spec S05, (#updated-theme-recipe)

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` — export/import logic
- Modified: `tugdeck/src/__tests__/theme-export-import.test.tsx` — update test expectations
- Modified: `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — update mood knob references
- Modified: `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` — update gallery test expectations

**Tasks:**
- [ ] Update theme JSON export to serialize `parameters` field instead of `surfaceContrast`/`signalIntensity`/`warmth`
- [ ] Update theme JSON import to read `parameters` field; handle legacy format (old files with `surfaceContrast` etc.) by ignoring those fields
- [ ] Update `theme-export-import.test.tsx` to test parameter-based export/import round-trip
- [ ] Update `theme-derivation-engine.test.ts`: remove/update tests referencing `MoodKnobs.warmth`, `surfaceContrast` scaling, `applyWarmthBias`, `ACHROMATIC_ADJACENT_HUES`
- [ ] Update `validateRecipeJson()` to validate the optional `parameters` field (if present, each of the 7 keys must be a number 0-100); handle legacy mood knob fields (`surfaceContrast`, `signalIntensity`, `warmth`) gracefully — ignore them instead of rejecting
- [ ] Update `gallery-theme-generator-content.test.tsx`: remove tests for mood slider interactions
- [ ] Update `theme-export-import.test.tsx` `validateRecipeJson` tests: remove/update tests that assert `surfaceContrast`-as-string and `signalIntensity`-as-string and `warmth`-as-boolean rejection (these fields are now ignored); add test that `validateRecipeJson` accepts a recipe with valid `parameters` field
- [ ] Search for any remaining references to `surfaceContrast`, `signalIntensity`, `warmth` as ThemeRecipe fields and update them

**Tests:**
- [ ] T5.1: Export a parameter-based recipe to JSON, import it back — round-trip matches
- [ ] T5.2: Import a legacy recipe JSON (with old mood knob fields) — no crash, fields ignored
- [ ] T5.3: Gallery test assertions that check `EXAMPLE_RECIPES.harmony.formulas` (e.g., "Harmony recipe includes formulas field", "Harmony formulas match LIGHT_FORMULAS") are updated to check `parameters` instead, or removed if no longer applicable
- [ ] T5.4: All existing test files compile and pass

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` exits 0
- [ ] `cd tugdeck && bun test` exits 0

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Seven design parameters replace three mood knobs, [D02] Warmth is removed entirely, [D07] Clean break, Spec S05, Spec S06, (#success-criteria)

**Tasks:**
- [ ] Verify `compileRecipe()` produces valid formulas for both modes at all parameter extremes
- [ ] Verify `deriveTheme(EXAMPLE_RECIPES.brio)` produces 374 tokens
- [ ] Verify `deriveTheme(EXAMPLE_RECIPES.harmony)` produces 374 tokens
- [ ] Verify warmth system is fully removed
- [ ] Verify mood knob fields are fully removed from ThemeRecipe
- [ ] Verify `EXAMPLE_RECIPES` use parameters, not formulas

**Tests:**
- [ ] All existing accessibility/contrast tests pass for both recipes
- [ ] `bun test` exits 0 with no skipped tests

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` exits 0
- [ ] `cd tugdeck && bun test` exits 0
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun run generate:tokens` exits 0 (tokens regenerate successfully)
- [ ] `grep -r "applyWarmthBias\|ACHROMATIC_ADJACENT_HUES\|resolveSemanticSlot" tugdeck/src/` returns no matches
- [ ] `grep -r "signalIntensity" tugdeck/src/components/tugways/theme-derivation-engine.ts` returns only `ComputedTones.signalIntensity` (derived from `signalIntensityValue`), `signalIntensityValue` formula field, and `DerivationFormulas` references — not `ThemeRecipe` or `MoodKnobs` fields
- [ ] `grep -r "surfaceContrast" tugdeck/src/components/tugways/theme-derivation-engine.ts` returns only internal `MoodKnobs` usage (fixed value), not `ThemeRecipe` fields

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A `compileRecipe()` function that takes 7 design parameters and a mode and produces a complete `DerivationFormulas`, fully wired into the theme derivation pipeline, with warmth and mood knobs removed.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `compileRecipe()` exists and produces valid `DerivationFormulas` for dark and light modes (`bun test`)
- [ ] `ThemeRecipe` has `parameters?: RecipeParameters` and no mood knob fields (`tsc --noEmit`)
- [ ] `EXAMPLE_RECIPES` use `parameters: defaultParameters()` instead of `formulas: DARK_FORMULAS` / `LIGHT_FORMULAS`
- [ ] Warmth system deleted: `applyWarmthBias`, `ACHROMATIC_ADJACENT_HUES` removed (`grep`)
- [ ] 3 mood sliders removed from gallery UI
- [ ] Theme export/import handles parameter-based recipes
- [ ] `bun run check` exits 0
- [ ] `bun test` exits 0
- [ ] `bun run audit:tokens lint` exits 0

**Acceptance tests:**
- [ ] T-ACC-1: `compileRecipe("dark", defaultParameters())` returns 200-field `DerivationFormulas`
- [ ] T-ACC-2: `compileRecipe("light", defaultParameters())` returns 200-field `DerivationFormulas`
- [ ] T-ACC-3: `deriveTheme(EXAMPLE_RECIPES.brio)` produces 374 tokens, passes contrast validation
- [ ] T-ACC-4: `deriveTheme(EXAMPLE_RECIPES.harmony)` produces 374 tokens, passes contrast validation
- [ ] T-ACC-5: Parameter-based recipe export/import round-trips correctly

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Plan 2: Recipe authoring UI — 7 parameter sliders, formula expansion panel, recipe diff view
- [ ] Plan 2: Visual calibration of endpoint bundles using the authoring UI
- [ ] Dark/stark and light/stark recipes using parameter defaults
- [ ] Remove `MoodKnobs` internal interface entirely (inline fixed values)
- [ ] Consider non-linear interpolation curves for parameters where perceptual response is non-linear

| Checkpoint | Verification |
|------------|--------------|
| `compileRecipe` produces valid formulas | `bun test src/__tests__/recipe-parameters.test.ts` |
| Pipeline integration | `bun test src/__tests__/theme-derivation-engine.test.ts` |
| Warmth removed | `grep -r "applyWarmthBias\|resolveSemanticSlot" tugdeck/src/` returns nothing |
| Full test suite | `bun test` exits 0 |
| Type check | `cd tugdeck && bun run check` exits 0 |
| Token audit | `bun run audit:tokens lint` exits 0 |
