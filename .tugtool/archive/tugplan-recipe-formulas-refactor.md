## Eliminate ModePreset: Recipe as Single Source of Truth {#recipe-formulas-refactor}

**Purpose:** Refactor the theme derivation engine to delete `ModePreset`, `DARK_PRESET`, and `LIGHT_PRESET`, moving all ~170 formula constants onto `ThemeRecipe.formulas` so that each recipe is self-contained and carries both its color hues and its derivation formulas.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-16 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The theme derivation engine currently has a wrong abstraction: `ModePreset` (~170 fields) sits between the recipe and the engine as a detached parameter blob. It was meant to absorb dark/light differences, but it is the wrong concept. A recipe IS the formulas — dark and light are different recipes, not parameterizations of one recipe. The only two `ModePreset` instances (`DARK_PRESET`, `LIGHT_PRESET`) are selected by `recipe.mode` inside `deriveTheme()`, which means the recipe already implicitly determines the preset. Making this explicit by putting the formulas on the recipe itself eliminates the indirection and makes the architecture clean for future recipe variants (light, stark, etc.).

Additionally, `resolveHueSlots()` contains ~10 `isLight` branches and `computeTones()` has ~7 more, while derivation-rules.ts has ~35 `preset.isLight` branches. All of these can be eliminated by adding explicit data fields to the formulas object, making every code path branch-free.

#### Strategy {#strategy}

- Define a `DerivationFormulas` interface that captures the ~170 constants from `ModePreset` (renaming `isLight` to data fields)
- Add `formulas: DerivationFormulas` to `ThemeRecipe` and populate `EXAMPLE_RECIPES.brio` with the current `DARK_PRESET` values
- Add explicit hue-name fields to `DerivationFormulas` for the ~10 derived hue slots that currently use `isLight` branches in `resolveHueSlots()`
- Add explicit computed-tone fields to `DerivationFormulas` for the ~7 `isLight` branches in `computeTones()`
- Refactor `computeTones()`, `resolveHueSlots()`, and `evaluateRules()` to read from `formulas` instead of `preset`/`isLight`, eliminating all runtime mode branches
- Replace the `Expr` type signature `(preset, knobs, computed) => number` with `(formulas, knobs, computed) => number`
- Delete `ModePreset` interface, `DARK_PRESET`, `LIGHT_PRESET`, and all `isLight` references
- Update tests to use `EXAMPLE_RECIPES.brio` access patterns instead of direct preset references
- Verify byte-identical token output throughout

#### Success Criteria (Measurable) {#success-criteria}

- Zero occurrences of `ModePreset`, `DARK_PRESET`, `LIGHT_PRESET`, or `isLight` in the codebase (`grep` returns 0 matches)
- `bun run generate:tokens` produces byte-identical output to the pre-refactor baseline (diff returns empty)
- All 1817 tests pass (`bun test` exits 0)
- Zero `preset.isLight` branches in derivation-rules.ts (`grep` returns 0 matches)
- Zero `isLight` branches in `resolveHueSlots()` and `computeTones()`
- `ThemeRecipe` includes an optional `formulas` field typed as `DerivationFormulas`
- `BRIO_DARK_FORMULAS` exported const contains exactly the values from the former `DARK_PRESET`
- `EXAMPLE_RECIPES.brio.formulas` references `BRIO_DARK_FORMULAS`

#### Scope {#scope}

1. Define `DerivationFormulas` interface (replaces `ModePreset`)
2. Extend `ThemeRecipe` with optional `formulas?: DerivationFormulas`
3. Add hue-name fields to `DerivationFormulas` for `resolveHueSlots()` branch elimination
4. Add computed-tone fields to `DerivationFormulas` for `computeTones()` branch elimination
5. Populate `EXAMPLE_RECIPES.brio.formulas` with current `DARK_PRESET` values plus new hue/tone fields
6. Refactor all three engine layers to consume `formulas` instead of `preset`
7. Delete `ModePreset`, `DARK_PRESET`, `LIGHT_PRESET`
8. Delete `LIGHT_PRESET` data entirely (no light recipe exists yet)
9. Update `Expr` type to `(formulas, knobs, computed) => number`
10. Update all tests and imports

#### Non-goals (Explicitly out of scope) {#non-goals}

- Creating a light-mode recipe (foundation only; the light recipe is a future task)
- Changing the `deriveTheme()` public signature (it still takes `ThemeRecipe` and returns `ThemeOutput`)
- Changing any token output values (zero behavioral change)
- Modifying palette-engine.ts or theme-accessibility.ts

#### Dependencies / Prerequisites {#dependencies}

- Current `DARK_PRESET` values are the ground truth for Brio dark
- `bun run generate:tokens` must work before and after the refactor
- All existing tests must continue to pass

#### Constraints {#constraints}

- Never use npm — always use bun
- Run `bun run generate:tokens` after engine changes
- Warnings are errors
- Generated tokens must be byte-identical to current output

#### Assumptions {#assumptions}

- `deriveTheme(EXAMPLE_RECIPES.brio)` remains the single call site for token generation; its signature does not change
- The `LIGHT_PRESET` data is deleted entirely — the light recipe does not yet exist, so those constants are removed with no replacement
- The `Expr` type signature changes from `(preset: ModePreset, ...) => number` to `(formulas: DerivationFormulas, ...) => number`; all rule expressions in derivation-rules.ts are updated accordingly
- The ~10 `isLight` branches in `resolveHueSlots()` become data lookups on new fields in `DerivationFormulas`
- The ~7 `isLight` branches in `computeTones()` become data lookups on new fields in `DerivationFormulas`

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

All headings use explicit `{#anchor}` anchors. Steps reference decisions and specs by stable ID. See skeleton for full rules.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token output drift during refactor | high | medium | Capture baseline before changes; diff after each step | Any `generate:tokens` diff |
| Test breakage from deleted exports | medium | high | Update all imports in same step as deletion | Test failures |
| Derivation-rules.ts expressions break with new type | high | medium | Mechanical rename of `preset` to `formulas` with type checker | TypeScript compilation errors |

**Risk R01: Token Output Drift** {#r01-token-drift}

- **Risk:** Refactoring the engine layers could subtly change computed values, producing different CSS tokens
- **Mitigation:**
  - Capture byte-level baseline of generated tokens before any code changes
  - Diff generated tokens after every step
  - Run full test suite including T-BRIO-MATCH after every step
- **Residual risk:** Floating-point evaluation order differences (extremely unlikely since formulas are identical)

**Risk R02: Incomplete isLight Branch Elimination** {#r02-incomplete-branch-elimination}

- **Risk:** Some `isLight` branches may be missed, leaving dead mode-switching code
- **Mitigation:**
  - Systematic grep for `isLight` after each refactoring step
  - Final verification step with comprehensive grep across all engine files
- **Residual risk:** None — grep is exhaustive

---

### Design Decisions {#design-decisions}

#### [D01] DerivationFormulas replaces ModePreset (DECIDED) {#d01-formulas-replace-preset}

**Decision:** Create a `DerivationFormulas` interface that contains all ~170 constants from `ModePreset` (minus `isLight`) plus new fields for hue-name and computed-tone data that currently live in `isLight` branches. The formulas object lives on `recipe.formulas`.

**Rationale:**
- A recipe IS its formulas — dark and light are different recipes, not parameterizations
- Eliminates the preset lookup indirection in `deriveTheme()`
- Makes the recipe self-contained: colors + formulas = complete derivation input

**Implications:**
- `ModePreset` interface is deleted
- `DARK_PRESET` and `LIGHT_PRESET` constants are deleted
- `deriveTheme()` reads `recipe.formulas ?? BRIO_DARK_FORMULAS` instead of selecting a preset by mode
- The `Expr` type changes its first parameter from `ModePreset` to `DerivationFormulas`
- `BRIO_DARK_FORMULAS` is an exported module-level constant used as the default fallback

#### [D02] Formulas field is optional with default fallback (DECIDED) {#d02-formulas-naming}

**Decision:** The formula constants live on `recipe.formulas` as an optional nested object typed `DerivationFormulas`. The field is named `formulas` per user direction. When `formulas` is undefined, `deriveTheme()` falls back to `BRIO_DARK_FORMULAS` (a module-level constant holding the Brio dark formula values).

**Rationale:**
- Clear, descriptive name that communicates the field's purpose
- User explicitly chose this name
- Optional field preserves backward compatibility: gallery-theme-generator-content.tsx constructs `ThemeRecipe` objects dynamically without formulas, and imported JSON recipes will not carry formulas either
- The fallback to `BRIO_DARK_FORMULAS` is safe because the only recipe in production is Brio dark; future recipes that need different formulas will set the field explicitly

**Implications:**
- `ThemeRecipe.formulas` is typed `formulas?: DerivationFormulas` (optional)
- `deriveTheme()` resolves formulas via `const formulas = recipe.formulas ?? BRIO_DARK_FORMULAS;` — silent fallback with no console warning, since the only production recipe is Brio dark and a warning would be noise for every gallery-constructed recipe
- `BRIO_DARK_FORMULAS` is an exported const containing all dark-mode formula values (also referenced by `EXAMPLE_RECIPES.brio.formulas`)
- No changes needed to gallery-theme-generator-content.tsx or any external ThemeRecipe construction sites

#### [D03] Hue-name fields on formulas eliminate resolveHueSlots branches (DECIDED) {#d03-hue-name-fields}

**Decision:** Add explicit hue-name string fields to `DerivationFormulas` for each derived hue slot that currently uses an `isLight` branch in `resolveHueSlots()`. These fields specify the hue name to resolve for each derived slot (e.g., `surfScreenHue: "indigo"` for dark, `surfScreenHue: txtHue` for light).

**Rationale:**
- Converts runtime branches to data — the recipe declares which hue each slot should use
- Makes `resolveHueSlots()` a pure data-driven resolution with zero conditional logic
- Future recipes can choose any hue for any slot without code changes

**Implications:**
- ~10 new string fields on `DerivationFormulas` (one per derived hue slot that branches on mode)
- `resolveHueSlots()` reads these fields instead of checking `isLight`
- The hue-name fields use the same hue name format as recipe hues (e.g., "indigo", "cobalt", "indigo-cobalt")

#### [D04] Computed-tone fields on formulas eliminate computeTones branches (DECIDED) {#d04-computed-tone-fields}

**Decision:** Add explicit numeric fields to `DerivationFormulas` for each computed tone that currently uses an `isLight` branch in `computeTones()`. These are the ~7 values like `dividerDefaultDark: 17`, `disabledFgTone: 38`, `outlinedBgRestFlat: 51`, etc.

**Rationale:**
- Same principle as [D03] — branches become data
- Makes `computeTones()` branch-free
- Future recipes define their own computed-tone anchors

**Implications:**
- 9 new fields on `DerivationFormulas` (8 `number | null` override fields + 1 always-number field)
- `computeTones()` reads these fields using `formulas.field ?? derivedExpression` pattern — zero isLight branches

#### [D05] RULES table stays shared, zero branches (DECIDED) {#d05-shared-rules-zero-branches}

**Decision:** The RULES table in derivation-rules.ts remains a single shared table. All ~35 `preset.isLight` branches in rule expressions are replaced by reading data fields from the formulas object. Zero runtime branches remain.

**Rationale:**
- User explicitly chose shared rules with zero branches
- The isLight branches in RULES all follow the pattern `preset.isLight ? preset.lightValue : preset.darkValue` — these can be unified to a single field that already holds the correct value for the recipe's mode
- Dark recipe formulas hold the dark value; future light recipe formulas would hold the light value

**Implications:**
- Every `preset.isLight ? A : B` expression in RULES becomes `formulas.unifiedField`
- Some ModePreset fields that had separate dark/light variants (e.g., `outlinedFgTone` vs `outlinedActionFgRestToneLight`) are unified into single fields per use case
- The `Expr` type parameter name changes from `preset` to `formulas`

#### [D06] LIGHT_PRESET deleted entirely — clean break (DECIDED) {#d06-delete-light-preset}

**Decision:** `LIGHT_PRESET` is deleted with no replacement. The ~280 lines of light-mode constants are removed from the codebase. When a light recipe is needed in the future, it will be defined as a new `ThemeRecipe` with its own `formulas` values.

**Rationale:**
- No light recipe exists yet — carrying dead data is technical debt
- User explicitly chose a clean break
- The light-mode values are preserved in git history if ever needed

**Implications:**
- Tests that reference `LIGHT_PRESET` are deleted (T-TONES-LIGHT in Step 6, T-RULES-LIGHT-MATCH in Step 9)
- No light-mode testing until a light recipe is created

#### [D07] Tests updated — delete old exports, access via EXAMPLE_RECIPES.brio (DECIDED) {#d07-test-updates}

**Decision:** Tests are updated to delete imports of `DARK_PRESET`, `LIGHT_PRESET`, and `ModePreset`. Tests that need formula values access them via `EXAMPLE_RECIPES.brio.formulas`. This is a clean break, not a deprecation.

**Rationale:**
- User explicitly chose a clean break with access via `EXAMPLE_RECIPES.brio`
- Old exports no longer exist, so tests must be updated

**Implications:**
- Test imports change from `DARK_PRESET` to `EXAMPLE_RECIPES.brio.formulas`
- Tests that tested light-mode derivation using `LIGHT_PRESET` are deleted: T-TONES-LIGHT (Step 6) and T-RULES-LIGHT-MATCH (Step 9)
- The `ModePreset` type import is replaced with `DerivationFormulas`

---

### Specification {#specification}

#### DerivationFormulas Interface {#derivation-formulas-spec}

**Spec S01: DerivationFormulas type** {#s01-derivation-formulas}

The `DerivationFormulas` interface contains all fields from `ModePreset` except `isLight`, plus new fields for branch elimination. It is organized into these groups:

1. **Surface tone anchors** — `bgAppTone`, `bgCanvasTone`, `surfaceSunkenTone`, etc. (same as ModePreset)
2. **Surface intensities** — `atmI`, `surfaceOverlayI`, `surfaceScreenI`, per-tier overrides (same as ModePreset)
3. **Foreground tone anchors** — `fgDefaultTone`, `fgMutedTone`, etc. (same as ModePreset)
4. **Text intensities** — `txtI`, `txtISubtle`, `fgMutedI`, `atmIBorder` (same as ModePreset)
5. **Border parameters** — all border/divider tones and intensities (same as ModePreset)
6. **Shadow/overlay alphas** — all alpha values (same as ModePreset)
7. **Control emphasis parameters** — filled/outlined/ghost per-state values (same as ModePreset, but unified — see [D05])
8. **Hue slot fields** — all `*HueSlot` string fields (same as ModePreset)
9. **Sentinel hue slot fields** — `outlinedBgHoverHueSlot`, etc. (same as ModePreset)
10. **Alpha values for sentinel tokens** — `tabBgHoverAlpha`, etc. (same as ModePreset)
11. **Formula parameter fields** — `bgCanvasToneBase`, `disabledBgBase`, etc. (same as ModePreset)
12. **Badge tinted parameters** — (same as ModePreset)
13. **NEW: Derived hue name fields** — for `resolveHueSlots()` branch elimination (see [D03])
14. **NEW: Computed tone anchor fields** — for `computeTones()` branch elimination (see [D04])

**Spec S02: New hue-name fields for resolveHueSlots branch elimination** {#s02-hue-name-fields}

These string fields are added to `DerivationFormulas` to replace the `isLight` branches in `resolveHueSlots()`:

| Field | Dark (Brio) value | Purpose |
|-------|-------------------|---------|
| `surfScreenHue` | `"indigo"` | Hue name for the `surfScreen` derived slot |
| `fgMutedHueExpr` | `"__bare_primary"` | `"__bare_primary"` = bare primary of txtHue; any other value = literal hue name |
| `fgSubtleHue` | `"indigo-cobalt"` | Hue name for `fgSubtle` derived slot |
| `fgDisabledHue` | `"indigo-cobalt"` | Hue name for `fgDisabled` derived slot |
| `fgInverseHue` | `"sapphire-cobalt"` | Hue name for `fgInverse` derived slot |
| `fgPlaceholderSource` | `"fgMuted"` | `"fgMuted"` = copy from fgMuted slot; `"atm"` = copy from atm slot |
| `selectionInactiveHue` | `"yellow"` | `"yellow"` = fixed semantic; `"__atm_offset"` = atmBaseAngle - 20 |
| `selectionInactiveSemanticMode` | `true` | `true` = no warmth bias (semantic); `false` = apply warmth bias |

**Spec S03: New computed-tone fields for computeTones branch elimination** {#s03-computed-tone-fields}

These fields are added to `DerivationFormulas` to replace the `isLight` branches in `computeTones()`. Each field uses the `number | null` convention: a `number` means "use this flat value"; `null` means "derive from the formula" (the derivation expression is documented in the Purpose column). This halves the field count versus a paired flat/derived-boolean design.

| Field | Type | Dark (Brio) value | Purpose / derivation when `null` |
|-------|------|-------------------|----------------------------------|
| `dividerDefaultToneOverride` | `number \| null` | `17` | `null` = `Math.round(surfaceOverlay - 2)` |
| `dividerMutedToneOverride` | `number \| null` | `15` | `null` = `Math.round(surfaceOverlay)` |
| `disabledFgToneValue` | `number` | `38` | Always flat (dark: 38; future light: use `fgDisabledTone`) |
| `disabledBorderToneOverride` | `number \| null` | `28` | `null` = `Math.round(dividerTone)` |
| `outlinedBgRestToneOverride` | `number \| null` | `null` | `null` = `Math.round(surfaceInset + 2)` |
| `outlinedBgHoverToneOverride` | `number \| null` | `null` | `null` = `Math.round(surfaceRaised + 1)` |
| `outlinedBgActiveToneOverride` | `number \| null` | `null` | `null` = `Math.round(surfaceOverlay)` |
| `toggleTrackOffToneOverride` | `number \| null` | `28` | `null` = `Math.round(dividerTone)` |
| `toggleDisabledToneOverride` | `number \| null` | `22` | `null` = `Math.round(surfaceOverlay)` |

Usage pattern in `computeTones()`:
```typescript
const dividerDefault = formulas.dividerDefaultToneOverride ?? Math.round(surfaceOverlay - 2);
```

For Brio dark, the `??` fallback is never reached (the override is a number). A future light recipe would set the field to `null` to activate the derived formula.

**Spec S04: Unified control emphasis fields** {#s04-unified-control-fields}

The `isLight` branches in derivation-rules.ts for control emphasis (outlined/ghost fg/icon per-state) follow this pattern:

```typescript
// Before (in rules):
intensityExpr: (preset) => preset.isLight ? preset.ghostActionFgRestILight : preset.ghostActionFgI
```

After [D05], each rule expression reads a single field that already holds the correct value for the recipe:

```typescript
// After (in rules):
intensityExpr: (formulas) => formulas.ghostActionFgRestI
```

The dark recipe's `ghostActionFgRestI` = `ghostActionFgI` (2, the dark-mode uniform value). A future light recipe's `ghostActionFgRestI` = `ghostActionFgRestILight` (the light-mode per-state value).

This means the `*Light` suffixed fields and the uniform dark fields are merged into single per-use fields. The naming convention drops the `Light` suffix and uses the most specific name.

**Table T01: Unified control emphasis field mapping** {#t01-unified-fields}

All ~35 `isLight` branches in derivation-rules.ts are replaced by unified fields. Each row shows the old dark-mode source, the old light-mode source, the new unified field name, and the Brio dark value. Future light recipes will set these fields to their light-mode values.

**Outlined-action fg (3 states x tone + intensity = 6 fields):**

| Old dark field | Old light field | New unified field | Dark value |
|---------------|----------------|-------------------|------------|
| `outlinedFgTone` | `outlinedActionFgRestToneLight` | `outlinedActionFgRestTone` | 100 |
| `outlinedFgTone` | `outlinedActionFgHoverToneLight` | `outlinedActionFgHoverTone` | 100 |
| `outlinedFgTone` | `outlinedActionFgActiveToneLight` | `outlinedActionFgActiveTone` | 100 |
| `outlinedFgI` | `txtI` | `outlinedActionFgRestI` | 2 |
| `outlinedFgI` | `txtI` | `outlinedActionFgHoverI` | 2 |
| `outlinedFgI` | `txtI` | `outlinedActionFgActiveI` | 2 |

**Outlined-action icon (3 states x tone + intensity = 6 fields):**

| Old dark field | Old light field | New unified field | Dark value |
|---------------|----------------|-------------------|------------|
| `outlinedFgTone` | `outlinedActionIconRestToneLight` | `outlinedActionIconRestTone` | 100 |
| `outlinedFgTone` | `outlinedActionIconHoverToneLight` | `outlinedActionIconHoverTone` | 100 |
| `outlinedFgTone` | `outlinedActionIconActiveToneLight` | `outlinedActionIconActiveTone` | 100 |
| `outlinedFgI` | `txtISubtle` | `outlinedActionIconRestI` | 2 |
| `outlinedFgI` | `txtISubtle` | `outlinedActionIconHoverI` | 2 |
| `outlinedFgI` | `txtISubtle` | `outlinedActionIconActiveI` | 2 |

**Outlined-agent fg/icon (same pattern, 12 fields):**

| New unified field | Dark value |
|-------------------|------------|
| `outlinedAgentFgRestTone` | 100 |
| `outlinedAgentFgHoverTone` | 100 |
| `outlinedAgentFgActiveTone` | 100 |
| `outlinedAgentFgRestI` | 2 |
| `outlinedAgentFgHoverI` | 2 |
| `outlinedAgentFgActiveI` | 2 |
| `outlinedAgentIconRestTone` | 100 |
| `outlinedAgentIconHoverTone` | 100 |
| `outlinedAgentIconActiveTone` | 100 |
| `outlinedAgentIconRestI` | 2 |
| `outlinedAgentIconHoverI` | 2 |
| `outlinedAgentIconActiveI` | 2 |

**Outlined-option fg/icon (same pattern, 12 fields):**

| New unified field | Dark value |
|-------------------|------------|
| `outlinedOptionFgRestTone` | 100 |
| `outlinedOptionFgHoverTone` | 100 |
| `outlinedOptionFgActiveTone` | 100 |
| `outlinedOptionFgRestI` | 2 |
| `outlinedOptionFgHoverI` | 2 |
| `outlinedOptionFgActiveI` | 2 |
| `outlinedOptionIconRestTone` | 100 |
| `outlinedOptionIconHoverTone` | 100 |
| `outlinedOptionIconActiveTone` | 100 |
| `outlinedOptionIconRestI` | 2 |
| `outlinedOptionIconHoverI` | 2 |
| `outlinedOptionIconActiveI` | 2 |

**Ghost-action fg (3 states x tone + intensity = 6 fields):**

| Old dark field | Old light field | New unified field | Dark value |
|---------------|----------------|-------------------|------------|
| `ghostActionFgTone` | `ghostActionFgRestToneLight` | `ghostActionFgRestTone` | 100 |
| `ghostActionFgTone` | `ghostActionFgHoverToneLight` | `ghostActionFgHoverTone` | 100 |
| `ghostActionFgTone` | `ghostActionFgActiveToneLight` | `ghostActionFgActiveTone` | 100 |
| `ghostActionFgI` | `ghostActionFgRestILight` | `ghostActionFgRestI` | 2 |
| `ghostActionFgI` | `ghostActionFgHoverILight` | `ghostActionFgHoverI` | 2 |
| `ghostActionFgI` | `ghostActionFgActiveILight` | `ghostActionFgActiveI` | 2 |

**Ghost-action icon (3 states x tone + intensity = 6 fields):**

| Old dark field | Old light field | New unified field | Dark value |
|---------------|----------------|-------------------|------------|
| `ghostActionFgTone` | `ghostActionIconRestToneLight` | `ghostActionIconRestTone` | 100 |
| `ghostActionFgTone` | `ghostActionIconHoverToneLight` | `ghostActionIconHoverTone` | 100 |
| `ghostActionFgTone` | `ghostActionIconActiveToneLight` | `ghostActionIconActiveTone` | 100 |
| `ghostActionFgI` | `txtISubtle` | `ghostActionIconRestI` | 2 |
| `ghostActionFgI` | `txtISubtle` | `ghostActionIconHoverI` | 2 |
| `ghostActionFgI` | `ghostActionIconActiveILight` | `ghostActionIconActiveI` | 2 |

**Ghost-option fg/icon (same pattern as ghost-action, 12 fields):**

| New unified field | Dark value |
|-------------------|------------|
| `ghostOptionFgRestTone` | 100 |
| `ghostOptionFgHoverTone` | 100 |
| `ghostOptionFgActiveTone` | 100 |
| `ghostOptionFgRestI` | 2 |
| `ghostOptionFgHoverI` | 2 |
| `ghostOptionFgActiveI` | 2 |
| `ghostOptionIconRestTone` | 100 |
| `ghostOptionIconHoverTone` | 100 |
| `ghostOptionIconActiveTone` | 100 |
| `ghostOptionIconRestI` | 2 |
| `ghostOptionIconHoverI` | 2 |
| `ghostOptionIconActiveI` | 2 |

**Non-control isLight branch fields (7 fields):**

| Old dark source | Old light source | New unified field | Dark value |
|----------------|-----------------|-------------------|------------|
| `bgAppI` | `atmI` | `bgAppSurfaceI` | 2 |
| `fgSubtleTone` | `borderStrongTone` | `borderStrongToneValue` | 37 |
| `0` (highlight sentinel, no i) | `4` (chromatic) | `outlinedBgHoverI` | 0 |
| `outlinedBgHoverAlpha` | `100` (chromatic, opaque) | `outlinedBgHoverAlphaValue` | 10 |
| `0` (highlight sentinel, no i) | `6` (chromatic) | `outlinedBgActiveI` | 0 |
| `outlinedBgActiveAlpha` | `100` (chromatic, opaque) | `outlinedBgActiveAlphaValue` | 20 |
| `0` | `8` | `selectionBgInactiveI` | 0 |
| `30` | `24` | `selectionBgInactiveTone` | 30 |
| `25` | `20` | `selectionBgInactiveAlpha` | 25 |

**Total: ~75 new unified fields** replacing the old split dark/light per-state fields and the ~35 `isLight` branch expressions.

#### Expr Type Change {#expr-type-change}

**Spec S05: Expr type signature** {#s05-expr-type}

```typescript
// Before:
export type Expr = (preset: ModePreset, knobs: MoodKnobs, computed: ComputedTones) => number;

// After:
export type Expr = (formulas: DerivationFormulas, knobs: MoodKnobs, computed: ComputedTones) => number;
```

All rule expressions in derivation-rules.ts change parameter name from `preset` to `formulas`. The `evaluateRules()` function signature changes accordingly. The `StructuralRule` interface also changes both `valueExpr` and `resolvedExpr` parameter types from `ModePreset` to `DerivationFormulas`.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| (none — all changes are in existing files) | |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DerivationFormulas` | interface | `theme-derivation-engine.ts` | Replaces `ModePreset`; adds hue-name and computed-tone fields |
| `ThemeRecipe.formulas` | field | `theme-derivation-engine.ts` | New optional field on `ThemeRecipe` (`formulas?: DerivationFormulas`) |
| `BRIO_DARK_FORMULAS` | const | `theme-derivation-engine.ts` | Exported const with all Brio dark formula values; default fallback in `deriveTheme()` |
| `EXAMPLE_RECIPES.brio.formulas` | const | `theme-derivation-engine.ts` | Set to `BRIO_DARK_FORMULAS` |
| `ModePreset` | interface | `theme-derivation-engine.ts` | **DELETED** |
| `DARK_PRESET` | const | `theme-derivation-engine.ts` | **DELETED** |
| `LIGHT_PRESET` | const | `theme-derivation-engine.ts` | **DELETED** |
| `Expr` | type | `theme-derivation-engine.ts` | First parameter changes from `ModePreset` to `DerivationFormulas` |
| `StructuralRule` | interface | `theme-derivation-engine.ts` | `valueExpr` and `resolvedExpr` parameter types change from `ModePreset` to `DerivationFormulas` |
| `computeTones` | function | `theme-derivation-engine.ts` | Signature changes: `(formulas: DerivationFormulas, knobs)` |
| `evaluateRules` | function | `theme-derivation-engine.ts` | Signature changes: takes `formulas` instead of `preset` |
| `resolveHueSlots` | function | `theme-derivation-engine.ts` | Reads hue-name fields from formulas parameter |
| `deriveTheme` | function | `theme-derivation-engine.ts` | Reads `recipe.formulas` instead of selecting preset by mode |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Golden / Contract** | Byte-identical token output before and after refactor | Every step — `bun run generate:tokens` diff |
| **Unit** | Individual function signatures and behavior | After each function refactor |
| **Integration** | Full pipeline: `deriveTheme(EXAMPLE_RECIPES.brio)` | After each step |
| **Drift Prevention** | T-BRIO-MATCH test: engine output matches fixture | After each step |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers — add an anchor instead.

#### Step 1: Capture Token Baseline {#step-1}

**Commit:** `chore: capture pre-refactor token baseline for byte-identical verification`

**References:** Risk R01 (#r01-token-drift), (#success-criteria)

**Artifacts:**
- Baseline snapshot of generated tokens saved for comparison

**Tasks:**
- [ ] Run `cd tugdeck && bun run generate:tokens` to regenerate `tugdeck/styles/tug-base.css`
- [ ] Save a copy of the full `tugdeck/styles/tug-base.css` file as `.tugtool/baseline-tokens.txt` for byte-level diffing (the entire file, not just the generated block, since the markers and surrounding declarations must also be stable)
- [ ] Run full test suite to confirm green baseline

**Tests:**
- [ ] All 1817 existing tests pass (green baseline confirmation)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all 1817 tests pass
- [ ] Baseline file exists and is non-empty

---

#### Step 2: Define DerivationFormulas Interface and Add to ThemeRecipe {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(engine): define DerivationFormulas interface, add formulas field to ThemeRecipe`

**References:** [D01] DerivationFormulas replaces ModePreset (#d01-formulas-replace-preset), [D02] Formulas naming (#d02-formulas-naming), Spec S01 (#s01-derivation-formulas)

**Artifacts:**
- `DerivationFormulas` interface in `theme-derivation-engine.ts`
- `formulas` optional field added to `ThemeRecipe` interface
- `BRIO_DARK_FORMULAS` exported const in `theme-derivation-engine.ts`

**Tasks:**
- [ ] Define `DerivationFormulas` interface containing all `ModePreset` fields except `isLight`
- [ ] Add `formulas?: DerivationFormulas` as an optional field on `ThemeRecipe`
- [ ] Define `BRIO_DARK_FORMULAS` as an exported const containing exactly the `DARK_PRESET` values (excluding `isLight`)
- [ ] Keep `ModePreset`, `DARK_PRESET`, `LIGHT_PRESET` in place (not yet deleted — dual-path for safety)
- [ ] Set `EXAMPLE_RECIPES.brio.formulas = BRIO_DARK_FORMULAS`
- [ ] In `deriveTheme()`, add `const formulas = recipe.formulas ?? BRIO_DARK_FORMULAS;` (the old `preset` variable remains for now, removed in Step 9)
- [ ] Verify TypeScript compiles cleanly — no changes needed to gallery-theme-generator-content.tsx or other ThemeRecipe construction sites since the field is optional

**Tests:**
- [ ] TypeScript compilation passes with no errors
- [ ] Existing tests still pass (DARK_PRESET still exists at this point)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens && diff <(cat styles/tug-base.css) <(cat ../.tugtool/baseline-tokens.txt)` — empty diff

---

#### Step 3: Add Hue-Name Fields to DerivationFormulas {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(engine): add hue-name fields to DerivationFormulas for resolveHueSlots branch elimination`

**References:** [D03] Hue-name fields (#d03-hue-name-fields), Spec S02 (#s02-hue-name-fields)

**Artifacts:**
- New hue-name string fields on `DerivationFormulas`
- `EXAMPLE_RECIPES.brio.formulas` populated with dark-mode hue-name values

**Tasks:**
- [ ] Add hue-name fields to `DerivationFormulas` per Spec S02: `surfScreenHue`, `fgMutedHueExpr`, `fgSubtleHue`, `fgDisabledHue`, `fgInverseHue`, `fgPlaceholderSource`, `selectionInactiveHue`, `selectionInactiveSemanticMode`
- [ ] Set Brio dark values: `surfScreenHue: "indigo"`, `fgMutedHueExpr: "__bare_primary"`, `fgSubtleHue: "indigo-cobalt"`, `fgDisabledHue: "indigo-cobalt"`, `fgInverseHue: "sapphire-cobalt"`, `fgPlaceholderSource: "fgMuted"`, `selectionInactiveHue: "yellow"`, `selectionInactiveSemanticMode: true`

**Tests:**
- [ ] TypeScript compilation passes
- [ ] Existing tests still pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — byte-identical to baseline

---

#### Step 4: Add Computed-Tone Fields to DerivationFormulas {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(engine): add computed-tone fields to DerivationFormulas for computeTones branch elimination`

**References:** [D04] Computed-tone fields (#d04-computed-tone-fields), Spec S03 (#s03-computed-tone-fields)

**Artifacts:**
- New computed-tone fields on `DerivationFormulas`
- `EXAMPLE_RECIPES.brio.formulas` populated with dark-mode tone values

**Tasks:**
- [ ] Add computed-tone fields to `DerivationFormulas` per Spec S03: `dividerDefaultToneOverride`, `dividerMutedToneOverride`, `disabledFgToneValue`, `disabledBorderToneOverride`, `outlinedBgRestToneOverride`, `outlinedBgHoverToneOverride`, `outlinedBgActiveToneOverride`, `toggleTrackOffToneOverride`, `toggleDisabledToneOverride` (all `number | null` except `disabledFgToneValue` which is always `number`)
- [ ] Set Brio dark values per Spec S03 table

**Tests:**
- [ ] TypeScript compilation passes
- [ ] Existing tests still pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — byte-identical to baseline

---

#### Step 5: Refactor resolveHueSlots to Read Formulas {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(engine): eliminate isLight branches from resolveHueSlots using formulas hue-name fields`

**References:** [D03] Hue-name fields (#d03-hue-name-fields), Spec S02 (#s02-hue-name-fields), (#strategy)

**Artifacts:**
- `resolveHueSlots()` refactored to accept `formulas` parameter and read hue-name fields
- Zero `isLight` references in `resolveHueSlots()`

**Tasks:**
- [ ] Add `formulas: DerivationFormulas` parameter to `resolveHueSlots()` (or pass via recipe)
- [ ] Replace `surfScreen` isLight branch: read `formulas.surfScreenHue` — if it equals the recipe's txt hue name, use txt slot; otherwise resolve it as a named hue
- [ ] Replace `fgMuted` isLight branch: if `formulas.fgMutedHueExpr === "__bare_primary"`, use bare primary of txtHue; otherwise use the literal hue name
- [ ] Replace `fgSubtle` branch: read `formulas.fgSubtleHue`
- [ ] Replace `fgDisabled` branch: read `formulas.fgDisabledHue`
- [ ] Replace `fgInverse` branch: read `formulas.fgInverseHue`
- [ ] Replace `fgPlaceholder` branch: read `formulas.fgPlaceholderSource` — `"fgMuted"` copies fgMuted, `"atm"` copies atm
- [ ] Replace `selectionInactive` branch: if `formulas.selectionInactiveSemanticMode`, use `resolveSemanticSlot(formulas.selectionInactiveHue)`; otherwise compute atm offset
- [ ] Remove `const isLight = recipe.mode === "light";` line
- [ ] Update `deriveTheme()` call site to pass formulas to `resolveHueSlots()`
- [ ] Verify zero `isLight` occurrences in `resolveHueSlots()`

**Tests:**
- [ ] All existing hue slot tests pass
- [ ] T-BRIO-MATCH passes (token output unchanged)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — byte-identical to baseline
- [ ] `grep -n 'isLight' tugdeck/src/components/tugways/theme-derivation-engine.ts` — zero matches in resolveHueSlots function body

---

#### Step 6: Refactor computeTones to Read Formulas {#step-6}

**Depends on:** #step-5

**Commit:** `refactor(engine): eliminate isLight branches from computeTones using formulas computed-tone fields`

**References:** [D04] Computed-tone fields (#d04-computed-tone-fields), Spec S03 (#s03-computed-tone-fields), Spec S05 (#s05-expr-type)

**Artifacts:**
- `computeTones()` signature changes from `(preset: ModePreset, knobs)` to `(formulas: DerivationFormulas, knobs)`
- Zero `isLight` references in `computeTones()`

**Tasks:**
- [ ] Change `computeTones()` signature: first parameter from `preset: ModePreset` to `formulas: DerivationFormulas`
- [ ] Rename all `preset.` references to `formulas.` within the function body
- [ ] Replace divider default/muted isLight branches using `formulas.dividerDefaultToneOverride ?? Math.round(surfaceOverlay - 2)` pattern per Spec S03
- [ ] Replace disabled fg/border isLight branches: `formulas.disabledFgToneValue` and `formulas.disabledBorderToneOverride ?? Math.round(dividerTone)`
- [ ] Replace outlined bg rest/hover/active isLight branches: `formulas.outlinedBgRestToneOverride ?? Math.round(surfaceInset + 2)` etc.
- [ ] Replace toggle track off and disabled isLight branches: `formulas.toggleTrackOffToneOverride ?? Math.round(dividerTone)` etc.
- [ ] Update `deriveTheme()` to call `computeTones(formulas, knobs)` instead of `computeTones(preset, knobs)`
- [ ] Update test call sites in `theme-derivation-engine.test.ts`: replace all `computeTones(DARK_PRESET, ...)` with `computeTones(BRIO_DARK_FORMULAS, ...)` (6 call sites in T-TONES-DARK, T-TONES-SC, T-TONES-INTERFACE tests)
- [ ] Delete the T-TONES-LIGHT test entirely — it calls `computeTones(LIGHT_PRESET, ...)` which no longer type-checks after the signature change, and there is no light recipe with light formulas to replace it; no adaptation, just deletion
- [ ] Update the two test helper functions (`runCoreVisualRules`, `runAllRules`) that call `computeTones(preset, ...)` — replace `preset` with `BRIO_DARK_FORMULAS` or `recipe.formulas ?? BRIO_DARK_FORMULAS`
- [ ] Verify zero `preset.isLight` occurrences in `computeTones()`

**Tests:**
- [ ] All existing computeTones tests pass (except T-TONES-LIGHT if removed)
- [ ] T-BRIO-MATCH passes

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — byte-identical to baseline

---

#### Step 7: Add Unified Control Emphasis Fields to DerivationFormulas {#step-7}

**Depends on:** #step-6

**Commit:** `refactor(engine): add unified control emphasis fields to DerivationFormulas for rules branch elimination`

**References:** [D05] Shared rules zero branches (#d05-shared-rules-zero-branches), Spec S04 (#s04-unified-control-fields), Table T01 (#t01-unified-fields)

**Artifacts:**
- Unified per-state control emphasis fields on `DerivationFormulas`
- `EXAMPLE_RECIPES.brio.formulas` populated with dark-mode unified values

**Tasks:**
- [ ] Add unified fields per Table T01: `outlinedActionFgRestTone`, `outlinedActionFgHoverTone`, ..., `ghostActionFgRestI`, `ghostActionFgRestTone`, etc.
- [ ] Set Brio dark values: all fg tones = 100 (filledFgTone), all fg intensities = 2 (outlinedFgI), etc.
- [ ] Add `bgAppSurfaceI` field for the bg-app intensity rule branch (dark: 2 = bgAppI)
- [ ] Add `borderStrongToneValue` field (dark: fgSubtleTone = 37)
- [ ] Add `selectionBgInactiveI` (dark: 0), `selectionBgInactiveTone` (dark: 30), `selectionBgInactiveAlpha` (dark: 25) for the selection-bg-inactive isLight branches
- [ ] Add `outlinedBgHoverI` (dark: 0), `outlinedBgHoverAlphaValue` (dark: 10), `outlinedBgActiveI` (dark: 0), `outlinedBgActiveAlphaValue` (dark: 20) for the outlined bg hover/active isLight branches

**Tests:**
- [ ] TypeScript compilation passes
- [ ] Existing tests still pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — byte-identical to baseline

---

#### Step 8: Refactor Expr Type and derivation-rules.ts {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(engine): change Expr type to DerivationFormulas, eliminate all isLight branches in rules`

**References:** [D05] Shared rules zero branches (#d05-shared-rules-zero-branches), Spec S04 (#s04-unified-control-fields), Spec S05 (#s05-expr-type), Table T01 (#t01-unified-fields)

**Artifacts:**
- `Expr` type updated: `(formulas: DerivationFormulas, knobs, computed) => number`
- `evaluateRules()` signature updated: takes `formulas` instead of `preset`
- Zero `preset.isLight` in derivation-rules.ts
- Zero `preset` references anywhere (all renamed to `formulas`)

**Tasks:**
- [ ] Change `Expr` type: `(formulas: DerivationFormulas, knobs: MoodKnobs, computed: ComputedTones) => number`
- [ ] Update `StructuralRule` interface: change both `valueExpr` and `resolvedExpr` parameter types from `preset: ModePreset` to `formulas: DerivationFormulas`; also rename `preset` parameter to `formulas` in all structural rule lambdas in derivation-rules.ts
- [ ] Update `evaluateRules()` signature to take `formulas: DerivationFormulas` instead of `preset: ModePreset`
- [ ] In `evaluateRules()` body, rename all `preset` references to `formulas`
- [ ] In derivation-rules.ts, mechanically rename `preset` parameter to `formulas` in ALL rule expression lambdas (~100+ `preset.` references across ~35 isLight-branched expressions and ~65+ non-branched field reads)
- [ ] Replace all `formulas.isLight ? A : B` expressions (~35 occurrences) with the unified field from Table T01 / Spec S04
- [ ] Refactor the `outlinedFgRules` factory function in derivation-rules.ts: its inner helpers `fgToneExpr`, `fgIExpr`, `iconToneExpr`, `iconIExpr` use dynamic `keyof ModePreset` casts to build field names like `` `outlined${capitalRole}Fg${state}ToneLight` ``. Rewrite these to build the unified field name (e.g., `` `outlined${capitalRole}Fg${state}Tone` ``) and read `formulas[field]` directly with `keyof DerivationFormulas` cast — no isLight branch needed since the unified field already holds the correct per-state value
- [ ] For the bg-app intensity rule: replace `preset.isLight ? preset.atmI : preset.bgAppI` with `formulas.bgAppSurfaceI`
- [ ] For the selection-bg-inactive rule: replace `preset.isLight ? 8 : 0` with `formulas.selectionBgInactiveI`, `preset.isLight ? 24 : 30` with `formulas.selectionBgInactiveTone`, `preset.isLight ? 20 : 25` with `formulas.selectionBgInactiveAlpha`
- [ ] For the outlined bg-hover rule: replace `preset.isLight ? 4 : 0` with `formulas.outlinedBgHoverI`, `preset.isLight ? 100 : preset.outlinedBgHoverAlpha` with `formulas.outlinedBgHoverAlphaValue`
- [ ] For the outlined bg-active rule: replace `preset.isLight ? 6 : 0` with `formulas.outlinedBgActiveI`, `preset.isLight ? 100 : preset.outlinedBgActiveAlpha` with `formulas.outlinedBgActiveAlphaValue`
- [ ] For borderStrong tone rule: replace with `formulas.borderStrongToneValue`
- [ ] Update `deriveTheme()` to pass `formulas` to `evaluateRules()` instead of `preset`
- [ ] Verify zero `isLight` in derivation-rules.ts
- [ ] Update the `keyof ModePreset` type assertion in `evaluateRules()` (used for hueSlot field lookup) to `keyof DerivationFormulas`
- [ ] Update derivation-rules.ts top-level import: `DerivationFormulas` instead of `ModePreset`
- [ ] Update inline `keyof import("./theme-derivation-engine").ModePreset` type casts in the `outlinedFgRules` factory helpers to `keyof import("./theme-derivation-engine").DerivationFormulas`
- [ ] Update test helper functions (`runCoreVisualRules`, `runAllRules`) in `theme-derivation-engine.test.ts`: pass `formulas` (via `recipe.formulas ?? BRIO_DARK_FORMULAS`) to `evaluateRules()` instead of `preset` (2 call sites)
- [ ] Remove the `const preset = isLight ? LIGHT_PRESET : DARK_PRESET;` lines in test helpers (replaced by formulas lookup)

**Tests:**
- [ ] All existing rule evaluation tests pass
- [ ] T-BRIO-MATCH passes

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — byte-identical to baseline
- [ ] `grep -c 'isLight' tugdeck/src/components/tugways/derivation-rules.ts` — returns 0

---

#### Step 9: Delete ModePreset, DARK_PRESET, LIGHT_PRESET and Update Tests {#step-9}

**Depends on:** #step-8

**Commit:** `refactor(engine): delete ModePreset/DARK_PRESET/LIGHT_PRESET, update all imports to DerivationFormulas`

**References:** [D01] DerivationFormulas replaces ModePreset (#d01-formulas-replace-preset), [D06] Delete LIGHT_PRESET (#d06-delete-light-preset), [D07] Test updates (#d07-test-updates), (#success-criteria)

**Artifacts:**
- `ModePreset` interface deleted from engine
- `DARK_PRESET` constant deleted from engine
- `LIGHT_PRESET` constant deleted from engine
- `const preset = recipe.mode === "light" ? LIGHT_PRESET : DARK_PRESET;` line in `deriveTheme()` deleted
- `theme-derivation-engine.test.ts` updated: imports changed, LIGHT_PRESET references removed

**Tasks:**
- [ ] Delete the `ModePreset` interface definition (~330 lines)
- [ ] Delete the `DARK_PRESET` constant (~280 lines)
- [ ] Delete the `LIGHT_PRESET` constant (~280 lines)
- [ ] Remove the preset selection line in `deriveTheme()`
- [ ] Remove any remaining `ModePreset` type references in the engine file
- [ ] Remove `DARK_PRESET`, `LIGHT_PRESET`, `ModePreset` from test imports in `theme-derivation-engine.test.ts`
- [ ] Add `DerivationFormulas` to test imports (if type is needed)
- [ ] Replace all `DARK_PRESET` references in tests with `EXAMPLE_RECIPES.brio.formulas`
- [ ] Delete the T-RULES-LIGHT-MATCH test entirely — it constructs a light recipe and calls `runAllRules()` which formerly selected `LIGHT_PRESET`; there is no light recipe with light formulas to replace it, so delete rather than adapt
- [ ] Rewrite the T-PRESET-EXPORTS test: it directly instantiates `ModePreset`/`DARK_PRESET`/`LIGHT_PRESET`. Replace with a T-FORMULAS-EXPORTS test that verifies `BRIO_DARK_FORMULAS` satisfies `DerivationFormulas` and spot-checks key field values (e.g., `bgAppTone === 5`, `fgDefaultTone === 94`, `txtI === 3`)
- [ ] Remove any other tests that used `LIGHT_PRESET` directly (no light recipe exists)
- [ ] Ensure `computeTones` test calls pass `EXAMPLE_RECIPES.brio.formulas` instead of `DARK_PRESET`
- [ ] Verify TypeScript compiles cleanly and all test files pass

**Tests:**
- [ ] All 1817 tests pass
- [ ] No TypeScript compilation errors

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — byte-identical to baseline
- [ ] `grep -rn 'DARK_PRESET\|LIGHT_PRESET\|ModePreset' tugdeck/src/` — returns 0 matches

---

#### Step 10: Final Verification and Cleanup {#step-10}

**Depends on:** #step-9

**Commit:** `chore: final verification — zero isLight branches, byte-identical tokens, all tests green`

**References:** (#success-criteria), Risk R01 (#r01-token-drift), Risk R02 (#r02-incomplete-branch-elimination)

**Artifacts:**
- Baseline diff file removed (temporary artifact)
- Clean codebase with zero mode-branching in engine

**Tasks:**
- [ ] Run comprehensive grep for any remaining `isLight`, `ModePreset`, `DARK_PRESET`, `LIGHT_PRESET` across all engine files
- [ ] Run `bun run generate:tokens` and diff against baseline — must be byte-identical
- [ ] Run full test suite
- [ ] Remove `.tugtool/baseline-tokens.txt` (temporary baseline file)
- [ ] Review `deriveTheme()` to confirm it reads `recipe.formulas ?? BRIO_DARK_FORMULAS` with no preset indirection
- [ ] Verify the engine file comment header accurately describes the new architecture

**Tests:**
- [ ] All 1817 tests pass
- [ ] T-BRIO-MATCH passes
- [ ] Zero grep matches for deleted symbols

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens && diff <(cat styles/tug-base.css) <(cat ../.tugtool/baseline-tokens.txt)` — empty diff (before removing baseline)
- [ ] `grep -rn 'isLight\|ModePreset\|DARK_PRESET\|LIGHT_PRESET' tugdeck/src/components/tugways/theme-derivation-engine.ts tugdeck/src/components/tugways/derivation-rules.ts tugdeck/src/__tests__/theme-derivation-engine.test.ts` — returns 0 matches

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** Theme derivation engine refactored to use `ThemeRecipe.formulas` as the single source of truth for all derivation constants, with `ModePreset`, `DARK_PRESET`, and `LIGHT_PRESET` fully deleted and zero `isLight` branches remaining.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `ModePreset`, `DARK_PRESET`, `LIGHT_PRESET` do not exist in the codebase (grep returns 0)
- [ ] Zero `isLight` references in engine files (grep returns 0)
- [ ] `ThemeRecipe` has a `formulas?: DerivationFormulas` optional field
- [ ] `BRIO_DARK_FORMULAS` exported const contains all derivation constants
- [ ] `EXAMPLE_RECIPES.brio.formulas` references `BRIO_DARK_FORMULAS`
- [ ] `bun run generate:tokens` produces byte-identical output to pre-refactor baseline
- [ ] All 1817 tests pass

**Acceptance tests:**
- [ ] `grep -rn 'ModePreset\|DARK_PRESET\|LIGHT_PRESET\|isLight' tugdeck/src/` returns 0 matches
- [ ] `cd tugdeck && bun test` exits 0
- [ ] `cd tugdeck && bun run generate:tokens` produces no diff against saved baseline

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Define a light-mode `ThemeRecipe` with its own `formulas` values
- [ ] Define stark variants (dark/stark, light/stark) as separate recipes
- [ ] Consider whether `DerivationFormulas` should be split into logical sub-objects (surface, foreground, control, etc.)
- [ ] Explore recipe inheritance/composition for shared values across recipe families

| Checkpoint | Verification |
|------------|--------------|
| Token output unchanged | `bun run generate:tokens` + diff against baseline |
| All tests pass | `cd tugdeck && bun test` exits 0 |
| No deleted symbols remain | `grep -rn 'ModePreset\|DARK_PRESET\|LIGHT_PRESET' tugdeck/src/` returns 0 |
| No isLight branches remain | `grep -rn 'isLight' tugdeck/src/components/tugways/` returns 0 |
