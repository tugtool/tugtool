<!-- tugplan-skeleton v2 -->

## Fully-Specified Theme Colors {#fully-specified-theme-colors}

**Purpose:** Replace hue-only theme recipe picks with fully-specified color picks (hue + tone + intensity), giving designers direct control over surface lightness, text chromaticity, and role vividness without touching recipe function internals.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | fully-specified-theme-colors |
| Last updated | 2026-03-21 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The 15 hue picks in a theme recipe are hue-only strings. Tone and intensity are hardcoded constants inside `darkRecipe()` and `lightRecipe()`. The designer picks "blue" but has no control over how vivid or how light that blue is — those decisions are buried in 400-line recipe functions. Multiple attempts to add slider-based controls for tone/intensity failed because the sliders controlled broad categories (`roleTone` affecting all 7 roles at once) rather than individual color slots.

The theme engine pipeline (resolveHueSlots -> evaluateRules -> tokens) is sound. The problem is purely in the input layer: ThemeRecipe lacks structured color specifications, and recipe functions hardcode values that should come from designer picks.

#### Strategy {#strategy}

- Define a `ThemeColorSpec` type (hue + tone + intensity) and restructure `ThemeRecipe` to use it for surfaces, add a text pick with hue + intensity, and add shared tone + intensity to the role group.
- Update recipe function signatures to accept `ThemeRecipe` so they can read tone/intensity from the recipe instead of hardcoded constants.
- Update `resolveHueSlots` to read from the new structure, removing the `element` group entirely.
- Build compact color picker components (tone strip, intensity strip) using CSS `oklch()` gradients alongside the existing `TugHueStrip`.
- Wire the new pickers into the Theme Generator, replacing `CompactHuePicker` instances with appropriately-configured pickers for each pick type.
- Wire the canvas grid pick into grid line rendering, replacing the sentinel highlight token.
- Maintain legacy recipe migration so saved themes in the old format load correctly.

#### Success Criteria (Measurable) {#success-criteria}

- `bun run generate:tokens` produces valid tokens from updated EXAMPLE_RECIPES (zero build errors)
- `bun run audit:tokens verify` passes with no regressions
- Legacy recipe JSON (old format with string hues and `element` group) loads successfully through `validateRecipeJson` and produces a valid theme
- All existing tests pass: `bun run test` exits 0
- Theme Generator UI exposes tone and intensity controls for surface picks, intensity for text, and shared tone/intensity for roles
- Canvas grid color is controlled by `recipe.surface.grid` pick

#### Scope {#scope}

1. `ThemeColorSpec` type and updated `ThemeRecipe` interface
2. Updated `EXAMPLE_RECIPES` (brio, harmony) with tone/intensity values
3. Legacy migration in `validateRecipeJson`
4. Recipe function signature change: `() => DerivationFormulas` to `(recipe: ThemeRecipe) => DerivationFormulas`
5. `resolveHueSlots` updated to read from new structure; `element` group removed
6. Compact color picker component with tone and intensity CSS gradient strips
7. Theme Generator UI wiring for all pick types
8. Canvas grid pick wired to grid line rendering

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the 48-hue palette or OKLCH color math
- Changing the token naming system
- Changing the RULES table in evaluateRules
- Changing contrast enforcement or thresholds
- Building the full inspector TugColorPicker (opacity, hex/RGB, swatch history)
- Gamut-clamping in the picker — CSS handles it
- Adding new token types
- Per-role tone/intensity (roles share a single tone and intensity)
- Connecting `recipe.role.intensity` to filled button vividness (requires rule entry changes)

#### Dependencies / Prerequisites {#dependencies}

- Current theme engine pipeline is stable (resolveHueSlots -> evaluateRules -> tokens)
- `TugHueStrip` component exists and is reused as-is for hue selection
- `bun run generate:tokens` and `bun run audit:tokens verify` are available as validation commands

#### Constraints {#constraints}

- L06: Appearance changes go through CSS and DOM, never React state
- Theme Generator state uses `useState` for local UI state — new tone/intensity fields added individually to match current pattern
- No broad-category theme control sliders (per project memory: sliders that controlled entire categories like "all role tones" failed after 4-5 attempts). The new per-pick tone/intensity gradient strips are distinct — they control individual color specs, not broad categories.
- `bun run generate:tokens` must be run after engine changes
- `bun run audit:tokens` must be in execution step checkpoints

#### Assumptions {#assumptions}

- The formulas escape-hatch path (`ThemeRecipe.formulas`) is unaffected — when formulas is provided directly, the recipe function is never called and tone/intensity from recipe specs are not used.
- The existing `TugHueStrip` component is reused as-is for hue selection in the new pickers; only the tone and intensity strips are new.
- The new picker components go in `tugdeck/src/components/tugways/` alongside `tug-hue-strip.tsx`.
- The theme-export-import tests, theme-derivation-engine tests, and theme-middleware tests will all need updates as the ThemeRecipe shape changes.
- The legacy migration in `validateRecipeJson` handles the element group removal and adds default tone/intensity values based on mode (dark or light defaults from the roadmap's migration spec).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit, named anchors and rich `References:` lines in execution steps per the skeleton contract.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token output drift after recipe function changes | high | med | Run `bun run generate:tokens` and `bun run audit:tokens verify` at Step 2 checkpoints | Audit failures |
| Legacy migration misses edge cases | med | med | Test with both brio/harmony old-format JSON and a minimally-valid recipe | Import test failures |
| Grid pick wiring breaks existing grid rendering | med | low | Verify grid visibility in both dark and light themes at Step 6 | Visual regression in grid lines |

**Risk R01: Token output drift** {#r01-token-drift}

- **Risk:** Changing recipe function signatures and resolveHueSlots could silently alter token output.
- **Mitigation:**
  - Run `bun run generate:tokens` and `bun run audit:tokens verify` as checkpoints at every engine step.
  - EXAMPLE_RECIPES values are tuned to produce good visual results, not exact parity with current output — the roadmap explicitly expects brighter role fills.
- **Residual risk:** Visual appearance will change for role fills (intentionally brighter in light mode).

**Risk R02: Legacy migration gaps** {#r02-legacy-migration}

- **Risk:** Saved themes in the old format may not load correctly if migration misses a field combination.
- **Mitigation:**
  - Test migration with old-format brio and harmony JSON.
  - Test with minimal valid old-format recipe (only required fields).
- **Residual risk:** Very old or hand-edited recipes with unusual field combinations may need manual correction.

---

### Design Decisions {#design-decisions}

#### [D01] ThemeColorSpec is a structured type with hue, tone, and intensity (DECIDED) {#d01-theme-color-spec}

**Decision:** Surface picks use `ThemeColorSpec { hue: string; tone: number; intensity: number }`. Text uses `{ hue: string; intensity: number }` (tone derived via contrastSearch). Role group has shared `tone` and `intensity` fields plus 7 hue strings.

**Rationale:**
- Surfaces need all three values because tone determines the fundamental character (how dark/light).
- Text tone must be derived via contrastSearch against the canvas — never designer-specified — to guarantee legibility.
- Role colors share a single tone/intensity because the palette's canonical L values ensure perceptual uniformity across hues at the same tone.

**Implications:**
- `ThemeRecipe.surface.canvas`, `.grid`, `.card` become `ThemeColorSpec` objects instead of strings.
- `ThemeRecipe.element` group is removed entirely; its routing becomes engine defaults in resolveHueSlots.
- `ThemeRecipe.text` is a new field replacing `element.content`.
- `ThemeRecipe.role` gains `tone` and `intensity` fields.

#### [D02] Recipe functions accept ThemeRecipe parameter (DECIDED) {#d02-recipe-fn-signature}

**Decision:** `darkRecipe(recipe: ThemeRecipe)` and `lightRecipe(recipe: ThemeRecipe)` read tone/intensity from recipe specs instead of hardcoded constants. `RECIPE_REGISTRY` type changes to `{ fn: (recipe: ThemeRecipe) => DerivationFormulas }`. `deriveTheme` passes the recipe to the registry function.

**Rationale:**
- Recipe functions currently hardcode values like `canvasTone = 5` and `roleIntensity = 50` that should come from designer picks.
- Passing the recipe lets the function compute offsets relative to the designer's chosen base values.

**Implications:**
- `darkRecipe()` call sites become `darkRecipe(recipe)`.
- `deriveTheme` changes from `registryEntry.fn()` to `registryEntry.fn(recipe)`.
- The `formulas` escape hatch is unaffected: when `recipe.formulas` is provided, the recipe function is never called.

#### [D03] Hover/active tones use current formula structure with recipe.role.tone as base (DECIDED) {#d03-hover-active-tones}

**Decision:** Keep the current formula structure for hover and active states but replace the hardcoded base tone with `recipe.role.tone`. Hover and active offsets remain as deltas from the rest tone, with clamping to 0-100.

**Rationale:**
- The current offset-based approach (hover = rest + delta, active = rest + 2*delta) produces consistent state transitions.
- Replacing only the base with recipe.role.tone is the minimal change that gives designers control.
- Clamping is necessary because extreme tone values (e.g., `role.tone = 90`) would push hover/active offsets beyond the 0-100 range.

**Exact formulas:**
- Dark mode: `restTone = recipe.role.tone`, `hoverTone = clamp(restTone + 5, 0, 100)`, `activeTone = clamp(restTone + 10, 0, 100)`.
- Light mode: `restTone = recipe.role.tone`, `hoverTone = clamp(restTone - 5, 0, 100)`, `activeTone = clamp(restTone - 10, 0, 100)`. (Light mode darkens on hover/active, so offsets are negative.)
- Clamping: `Math.max(0, Math.min(100, value))` — applied to all computed tone values.
- **Note:** The +5/+10 offsets are intentionally smaller than the current hardcoded +20/+30 offsets. The higher base tone (50 vs 20) means smaller deltas produce sufficient visual contrast for hover/active states. This was explicitly confirmed as the desired behavior.

**Implications:**
- `filledSurfaceRestTone` is set to `recipe.role.tone` instead of `c + 15` (dark) or `20` (light).
- `filledSurfaceHoverTone` and `filledSurfaceActiveTone` are computed as clamped offsets from `recipe.role.tone`.
- At extreme tone values, hover and active states may compress (e.g., tone 98 produces rest=98, hover=100, active=100 in dark mode) — this is acceptable because extreme tones are uncommon for role fills.

#### [D04] Element group removed; hue routing becomes engine defaults (DECIDED) {#d04-element-group-removed}

**Decision:** The `ThemeRecipe.element` group (content, control, display, informational, border, decorative) is removed. `resolveHueSlots` derives these slots from the new structure: content/control/display default to `recipe.text.hue`, informational/border default to `recipe.surface.canvas.hue`, decorative is always "gray". Display and border are available as optional overrides (`recipe.display`, `recipe.border`).

**Rationale:**
- The element group exposed 6 hue picks that designers rarely changed from defaults — it was complexity without value.
- The new routing preserves the same defaults while removing the explicit picks.

**Implications:**
- `resolveHueSlots` reads `recipe.text.hue` instead of `recipe.element.content`.
- `recipe.display?.hue` and `recipe.border?.hue` are optional overrides.
- All `recipe.element.*` reads are removed from resolveHueSlots.

#### [D05] Theme Generator state: individual useState fields for new values (DECIDED) {#d05-state-management}

**Decision:** Add new tone/intensity state fields individually to match the current `useState` pattern in the Theme Generator. No refactor to a reducer or state object.

**Rationale:**
- The current pattern uses individual `useState` hooks for each recipe field. Adding tone/intensity fields individually is the minimal refactor risk approach.
- A state management refactor would be orthogonal to this feature.

**Implications:**
- New `useState` hooks for: `canvasTone`, `canvasIntensity`, `gridTone`, `gridIntensity`, `cardTone`, `cardIntensity`, `textIntensity`, `roleTone`, `roleIntensity`.
- Each fires `onChange` which triggers debounced `deriveTheme()`.

#### [D06] Canvas grid pick replaces sentinel highlight token (DECIDED) {#d06-grid-pick}

**Decision:** The grid line CSS variable `--tug-canvas-grid-line` switches from the sentinel highlight token (`--tug-base-surface-highlight-primary-normal-hover-rest`) to a value derived from `recipe.surface.grid`. Three paths set this value:
1. **Theme Generator preview:** computed `oklch()` value set on the preview container element via `style.setProperty` (same as existing `liveTokenStyle` pattern).
2. **Built-in themes (theme provider):** after `injectThemeCSS` injects the token stylesheet, the theme provider sets `--tug-canvas-grid-line` on `document.body` via `style.setProperty` using `themeColorSpecToOklch` with `EXAMPLE_RECIPES[theme].surface.grid`.
3. **Dynamic/saved themes (CSS export):** `--tug-canvas-grid-line` is embedded in the saved CSS at export time via `themeColorSpecToOklch(recipe.surface.grid)`. This way, `setDynamicTheme` — which only fetches CSS, not recipe JSON — gets the grid line color without needing a separate fetch.

**Rationale:**
- The sentinel token approach ties grid color to highlight semantics, which is conceptually wrong — grid is a surface concern.
- Computing an `oklch()` value from the grid pick is straightforward and requires no changes to the token/rule system.
- The imperative setter approach (`style.setProperty`) is the simplest production path — it avoids adding grid color to the token pipeline (no new tokens, no RULES table changes) while ensuring the variable is available wherever themes are applied.

**Implications:**
- `tug-dock.css` changes `--tug-canvas-grid-line` default from `var(--tug-base-surface-highlight-primary-normal-hover-rest)` to a fallback value (e.g., `oklch(0.15 0.01 280)` for dark default). The imperative setter overrides this when themes are applied.
- The Theme Generator computes the grid color from `recipe.surface.grid` and sets it as a CSS custom property on the preview container.
- The theme provider (`theme-provider.tsx`) sets `--tug-canvas-grid-line` on `document.body` after injecting the theme stylesheet for built-in themes, using `themeColorSpecToOklch` with `EXAMPLE_RECIPES[theme].surface.grid`.
- The CSS export function embeds `--tug-canvas-grid-line` in the saved CSS, so `setDynamicTheme` gets it automatically without needing recipe JSON.
- `globals.css` and `gallery-theme-generator-content.css` continue to reference `var(--tug-canvas-grid-line)` unchanged.

#### [D07] Text intensity maps to contentTextIntensity with offset hierarchy (DECIDED) {#d07-text-intensity}

**Decision:** `recipe.text.intensity` maps to `contentTextIntensity` in DerivationFormulas. Muted text intensity = `text.intensity + 2`, subtle text intensity = `text.intensity + 4`. This preserves the current relationship (dark: 3/5/7, light: 4/6/8) while letting the designer control the base chromatic level.

**Rationale:**
- The existing offset relationship between content/muted/subtle text intensity is well-tuned and should be preserved.
- Exposing only the base value keeps the picker simple while maintaining hierarchy.

**Implications:**
- Recipe functions read `recipe.text.intensity` and compute `mutedTextIntensity` and `subtleTextIntensity` as offsets.

---

### Specification {#specification}

#### ThemeColorSpec Type {#theme-color-spec}

**Spec S01: ThemeColorSpec interface** {#s01-theme-color-spec}

```ts
interface ThemeColorSpec {
  hue: string;        // Named hue: "blue", "indigo-violet", etc.
  tone: number;       // 0-100, lightness
  intensity: number;  // 0-100, chroma/saturation
}
```

#### Updated ThemeRecipe Interface {#updated-recipe-interface}

**Spec S02: ThemeRecipe interface (new shape)** {#s02-theme-recipe}

```ts
interface ThemeRecipe {
  name: string;
  description: string;
  recipe: "dark" | "light";

  surface: {
    canvas: ThemeColorSpec;   // App background
    grid: ThemeColorSpec;     // Grid lines on canvas
    card: ThemeColorSpec;     // Card title bar
  };

  text: {
    hue: string;              // Body text hue
    intensity: number;        // Body text chromaticity (0-100)
  };

  role: {
    tone: number;             // Shared tone for all role fills (0-100)
    intensity: number;        // Shared intensity for all role colors (0-100)
    accent: string;           // Hue names below
    action: string;
    agent: string;
    data: string;
    success: string;
    caution: string;
    danger: string;
  };

  // Optional overrides (engine defaults when absent)
  display?: { hue: string; intensity: number };
  border?: { hue: string; intensity: number };

  formulas?: DerivationFormulas;  // Escape hatch — unchanged
}
```

#### resolveHueSlots Mapping {#resolve-hue-slots-mapping}

**Table T01: resolveHueSlots mapping (old to new)** {#t01-hue-slot-mapping}

| Resolved slot | Currently from | After |
|---|---|---|
| `canvas` | `recipe.surface.canvas` (string) | `recipe.surface.canvas.hue` |
| `atm` | `recipe.surface.card` (string) | `recipe.surface.card.hue` |
| `txt` | `recipe.element.content` (string) | `recipe.text.hue` |
| `control` | `recipe.element.control` (string) | `recipe.text.hue` (default to text) |
| `display` | `recipe.element.display` (string) | `recipe.display?.hue ?? recipe.text.hue` |
| `informational` | `recipe.element.informational` (string) | `recipe.surface.canvas.hue` |
| `borderTint` | `recipe.element.border` (string) | `recipe.border?.hue ?? recipe.surface.canvas.hue` |
| `cardFrame` | `recipe.element.border` (string) | `recipe.surface.card.hue` |
| `decorative` | `recipe.element.decorative` (string) | `"gray"` (hardcoded) |
| `interactive` | `recipe.role.action` (string) | `recipe.role.action` (unchanged — still a string) |
| `active` | `recipe.role.action` (string) | `recipe.role.action` (unchanged) |
| `accent` | `recipe.role.accent` (string) | `recipe.role.accent` (unchanged) |
| `destructive` | `recipe.role.danger` (string) | `recipe.role.danger` (unchanged) |
| `success` | `recipe.role.success` (string) | `recipe.role.success` (unchanged) |
| `caution` | `recipe.role.caution` (string) | `recipe.role.caution` (unchanged) |
| `agent` | `recipe.role.agent` (string) | `recipe.role.agent` (unchanged) |
| `data` | `recipe.role.data` (string) | `recipe.role.data` (unchanged) |

Per-tier derived slots (`fgMuted`, `fgSubtle`, `surfBareBase`, etc.) continue to use formula hue-expression fields, unchanged.

#### EXAMPLE_RECIPES Values {#example-recipes-values}

**Spec S03: EXAMPLE_RECIPES (brio)** {#s03-brio-recipe}

```ts
brio: {
  name: "brio",
  description: "...",
  recipe: "dark",
  surface: {
    canvas: { hue: "indigo-violet", tone: 5, intensity: 5 },
    grid:   { hue: "indigo-violet", tone: 12, intensity: 4 },
    card:   { hue: "indigo-violet", tone: 16, intensity: 12 },
  },
  text: { hue: "cobalt", intensity: 3 },
  role: {
    tone: 50, intensity: 50,
    accent: "orange", action: "blue", agent: "violet", data: "teal",
    success: "green", caution: "yellow", danger: "red",
  },
  display: { hue: "indigo", intensity: 3 },
}
```

**Spec S04: EXAMPLE_RECIPES (harmony)** {#s04-harmony-recipe}

```ts
harmony: {
  name: "harmony",
  description: "...",
  recipe: "light",
  surface: {
    canvas: { hue: "indigo-violet", tone: 95, intensity: 6 },
    grid:   { hue: "indigo-violet", tone: 88, intensity: 5 },
    card:   { hue: "indigo-violet", tone: 85, intensity: 35 },
  },
  text: { hue: "cobalt", intensity: 4 },
  role: {
    tone: 55, intensity: 60,
    accent: "orange", action: "blue", agent: "violet", data: "teal",
    success: "green", caution: "yellow", danger: "red",
  },
  display: { hue: "indigo", intensity: 4 },
}
```

#### Legacy Migration Rules {#legacy-migration-rules}

**Spec S05: Legacy recipe migration** {#s05-legacy-migration}

When `validateRecipeJson` encounters an old-format recipe (string surface hues, `element` group present, no `text` field):

1. **String hue to ThemeColorSpec:** Extract hue from string, apply mode-dependent defaults:
   - Dark: canvas tone 5, intensity 5; card tone 16, intensity 12
   - Light: canvas tone 95, intensity 6; card tone 85, intensity 35
2. **Missing `text` field:** Derive from `element.content` hue with default intensity (dark: 3, light: 4).
3. **Missing `grid` field:** Derive from `surface.canvas` hue with grid-appropriate defaults (dark: tone 12, intensity 4; light: tone 88, intensity 5).
4. **`element` group mapping:** `element.content` -> `text.hue`; `element.display` -> `display` override if different from content; other element fields ignored (they default).
5. **Missing `role.tone`/`role.intensity`:** Default to dark: tone 50, intensity 50; light: tone 55, intensity 60.
6. **Legacy `controls` field:** If the recipe has a `controls` object with `canvasTone`, `canvasIntensity`, `frameTone`, `frameIntensity`, `roleTone`, `roleIntensity` values, map them into the new structure: `controls.canvasTone` -> `surface.canvas.tone`, `controls.canvasIntensity` -> `surface.canvas.intensity`, `controls.frameTone` -> `surface.card.tone`, `controls.frameIntensity` -> `surface.card.intensity`, `controls.roleTone` -> `role.tone`, `controls.roleIntensity` -> `role.intensity`. If both new-format fields and `controls` are present, new-format fields win. The `controls` field is then dropped from the migrated recipe.

#### Color Picker Design {#color-picker-design}

**Spec S06: Compact color picker component** {#s06-color-picker}

The tone and intensity strips are CSS `linear-gradient` backgrounds with ~10 computed color stops using `oklch()`. The browser handles gamut mapping (out-of-gamut stops are clamped).

- **Tone strip:** Horizontal gradient from dark (tone 0) to light (tone 100) at the current hue and intensity. Click/drag to set tone.
- **Intensity strip:** Horizontal gradient from achromatic (intensity 0) to vivid (intensity 100) at the current hue and tone. Click/drag to set intensity.
- Each strip fires `onChange` on every drag frame. The Theme Generator debounces `deriveTheme()` at 150ms per L06.

**Picker configurations by pick type:**

| Pick type | Hue strip | Tone strip | Intensity strip |
|-----------|-----------|------------|-----------------|
| Surface (canvas, grid, card) | Yes | Yes | Yes |
| Text | Yes | No (tone derived) | Yes |
| Role (shared) | No | Yes | Yes |
| Role (per-hue) | Yes (existing TugHueStrip) | No | No |

---

### Compatibility / Migration / Rollout (Optional) {#rollout}

- **Compatibility policy:** Legacy recipe JSON is auto-migrated on import. No version field needed — detection is structural (presence of `element` group or string surface values).
- **Migration plan:**
  - Old-format recipes with string hues and `element` group are migrated to new format in `validateRecipeJson`.
  - `EXAMPLE_RECIPES` are updated in-place (no old-format recipes remain in code).
  - Saved themes in localStorage or exported JSON are migrated on next load.
- **Rollout plan:** Ship all changes together. No feature gate needed — the migration handles old recipes transparently.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tug-color-strip.tsx` | Tone and intensity strip components |
| `tugdeck/src/components/tugways/tug-color-strip.css` | Styles for tone/intensity strips |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ThemeColorSpec` | interface | `theme-engine.ts` | New type: `{ hue, tone, intensity }` |
| `ThemeRecipe` | interface | `theme-engine.ts` | Modified: surface becomes ThemeColorSpec objects, element removed, text/grid added |
| `EXAMPLE_RECIPES` | const | `theme-engine.ts` | Modified: brio/harmony gain tone/intensity values |
| `darkRecipe` | function | `recipe-functions.ts` | Modified: signature `(recipe: ThemeRecipe) => DerivationFormulas` |
| `lightRecipe` | function | `recipe-functions.ts` | Modified: signature `(recipe: ThemeRecipe) => DerivationFormulas` |
| `RECIPE_REGISTRY` | const | `recipe-functions.ts` | Modified: type `{ fn: (recipe: ThemeRecipe) => DerivationFormulas }` |
| `resolveHueSlots` | function | `theme-engine.ts` | Modified: reads from new ThemeRecipe structure |
| `deriveTheme` | function | `theme-engine.ts` | Modified: passes recipe to registry function |
| `validateRecipeJson` | function | `gallery-theme-generator-content.tsx` | Modified: adds legacy migration |
| `themeColorSpecToOklch` | function | `theme-engine.ts` | New: converts ThemeColorSpec to `oklch()` CSS string; extracts primary color name via `primaryColorName(spec.hue)` for lookup table access (exported) |
| `setTheme` | function | `theme-provider.tsx` | Modified: sets `--tug-canvas-grid-line` via `style.setProperty` after theme injection |
| `applyInitialTheme` | function | `theme-provider.tsx` | Modified: sets `--tug-canvas-grid-line` via `style.setProperty` after initial injection |
| `TugToneStrip` | component | `tug-color-strip.tsx` | New: CSS oklch() gradient strip for tone |
| `TugIntensityStrip` | component | `tug-color-strip.tsx` | New: CSS oklch() gradient strip for intensity |

---

### Documentation Plan {#documentation-plan}

- [ ] Update roadmap doc at `roadmap/fully-specified-theme-colors.md` with "completed" status after implementation
- [ ] Update `theme-engine.ts` module doc comment to reflect new ThemeRecipe structure

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test ThemeColorSpec validation, legacy migration logic, recipe function output | Steps 1-2 |
| **Integration** | Test deriveTheme end-to-end with new recipe format, test export/import round-trip | Steps 2, 4 |
| **Golden / Contract** | Token output from EXAMPLE_RECIPES via generate:tokens and audit:tokens | Step 2 |
| **Drift Prevention** | Legacy recipe migration produces valid themes | Step 1 |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add ThemeColorSpec type and update ThemeRecipe interface {#step-1}

<!-- Step 1 has no dependencies (it is the root) -->

**Commit:** `feat: add ThemeColorSpec type and restructure ThemeRecipe interface`

**References:** [D01] ThemeColorSpec is a structured type, [D04] Element group removed, Spec S01, Spec S02, Spec S03, Spec S04, Spec S05, Table T01, (#theme-color-spec, #updated-recipe-interface, #example-recipes-values, #legacy-migration-rules, #resolve-hue-slots-mapping)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-engine.ts`: `ThemeColorSpec` interface, updated `ThemeRecipe` interface (surface becomes ThemeColorSpec objects, `element` removed, `text` and `grid` added, `role` gains tone/intensity, optional `display`/`border` overrides), updated `EXAMPLE_RECIPES`, updated `resolveHueSlots` to read from new structure per Table T01
- Modified `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx`: legacy migration in `validateRecipeJson`

**Tasks:**
- [ ] Define `ThemeColorSpec` interface in `theme-engine.ts` (exported)
- [ ] Update `ThemeRecipe` interface: replace `surface.canvas: string` and `surface.card: string` with `ThemeColorSpec`; add `surface.grid: ThemeColorSpec`; remove `element` group entirely; add `text: { hue: string; intensity: number }`; add `tone: number` and `intensity: number` to `role`; add optional `display?: { hue: string; intensity: number }` and `border?: { hue: string; intensity: number }`
- [ ] Update `EXAMPLE_RECIPES.brio` per Spec S03
- [ ] Update `EXAMPLE_RECIPES.harmony` per Spec S04
- [ ] Update `validateRecipeJson` in `gallery-theme-generator-content.tsx` to detect old-format recipes and migrate per Spec S05. The function should first detect whether the incoming recipe is old-format (string surface values, presence of `element` group) or new-format (ThemeColorSpec surface objects, `text`/`role` structure) and branch accordingly — new-format recipes pass through with minimal validation, while old-format recipes are migrated: string hues -> ThemeColorSpec with mode defaults, element group -> text/display/border mappings, missing grid -> derived from canvas, legacy `controls` field values mapped into new structure per Spec S05 rule 6 (new-format fields take precedence if both present, then `controls` is dropped)
- [ ] Update `resolveHueSlots` to read from the new ThemeRecipe structure per Table T01. This must be done in the same step as the interface change to avoid compile failures:
  - `atmHue = recipe.surface.card` -> `recipe.surface.card.hue`
  - `txtHue = recipe.element.content` -> `recipe.text.hue`
  - `canvasHue = recipe.surface.canvas` -> `recipe.surface.canvas.hue`
  - `cardFrameHue = recipe.element.border` -> `recipe.surface.card.hue`
  - `borderTintHue = recipe.element.border` -> `recipe.border?.hue ?? recipe.surface.canvas.hue`
  - `interactiveHue = recipe.role.action` -> unchanged (still a string)
  - `activeHue = recipe.role.action` -> unchanged
  - `accentHue = recipe.role.accent` -> unchanged
  - Element slot resolution: `control` -> `recipe.text.hue`, `display` -> `recipe.display?.hue ?? recipe.text.hue`, `informational` -> `recipe.surface.canvas.hue`, `decorative` -> `"gray"` (hardcoded)
  - Remove all `recipe.element.*` reads from `resolveHueSlots`
  - Update `resolveHueSlots` doc comment to reflect new field mapping
- [ ] Update the `resolveHueSlots` default parameter: `recipe.formulas ?? darkRecipe()` must become a body-level fallback since `darkRecipe` will require a `recipe` parameter after Step 2. For now, keep `darkRecipe()` as the default (it still compiles with no args at this step). Step 2 will update this to `darkRecipe(recipe)`.
- [ ] Fix all TypeScript compilation errors caused by the interface change in the Theme Generator component (`gallery-theme-generator-content.tsx`). The generator has ~15 `useState` hooks that read old ThemeRecipe fields (`DEFAULT_RECIPE.surface.card` as string, `DEFAULT_RECIPE.element.content`, etc.). Apply this temporary adapter pattern at **all six ThemeRecipe assembly/read sites**: (a) update surface `useState` reads to use `.hue` (e.g., `DEFAULT_RECIPE.surface.card.hue`), (b) replace all `DEFAULT_RECIPE.element.*` reads with the new routing — `element.content` -> `DEFAULT_RECIPE.text.hue`, `element.control` -> `DEFAULT_RECIPE.text.hue`, `element.display` -> `DEFAULT_RECIPE.display?.hue ?? DEFAULT_RECIPE.text.hue`, `element.informational` -> `DEFAULT_RECIPE.surface.canvas.hue`, `element.border` -> `DEFAULT_RECIPE.surface.canvas.hue`, `element.decorative` -> `"gray"`. (c) Update `loadPreset` and `handleRecipeImported` to read from the new structure the same way. (d) Update `currentRecipe` useMemo (~line 1572) which constructs a ThemeRecipe with old-format `surface` and `element` fields — change to new structure with ThemeColorSpec surfaces and `text`/`role` fields instead of `element`. Use mode-dependent defaults from EXAMPLE_RECIPES for temporary tone/intensity values: for dark mode use brio's values (canvas tone=5 intensity=5, grid tone=12 intensity=4, card tone=16 intensity=12, text intensity=3, role tone=50 intensity=50), for light mode use harmony's values (canvas tone=95 intensity=6, grid tone=88 intensity=5, card tone=85 intensity=35, text intensity=4, role tone=55 intensity=60). (e) Update `runDerive` callback (~line 1502) which builds a ThemeRecipe inline — same adapter: replace `element` group with `text`/`role` structure and surface strings with ThemeColorSpec objects, using the same mode-dependent EXAMPLE_RECIPES defaults. (f) Update the two dark/light mode onClick handlers (~lines 1708, 1729) which each construct inline ThemeRecipe objects with old-format `element` and string `surface` fields — apply the same adapter pattern with the corresponding mode defaults (dark handler uses brio values, light handler uses harmony values). Step 4 will add the new tone/intensity state fields and pickers properly.

**Tests:**
- [ ] Update theme-export-import tests to use new ThemeRecipe format. Note: ~36 inline old-format ThemeRecipe objects across test files (`theme-derivation-engine.test.ts`, `gallery-theme-generator-content.test.tsx`, `theme-export-import.test.tsx`) need updating to the new structure — primarily changing `surface.canvas`/`surface.card` from strings to `ThemeColorSpec` objects, removing `element` group, and adding `text`/`role.tone`/`role.intensity` fields.
- [ ] Add legacy migration test: old-format brio JSON -> validates and produces correct new-format recipe
- [ ] Add legacy migration test: minimal old-format recipe -> validates with correct defaults
- [ ] Add `validateRecipeJson` test cases: (a) new-format recipe passes through unchanged, (b) old-format recipe with `element` group migrates correctly, (c) hybrid recipe (partially new) is handled gracefully, (d) malformed recipe (missing required fields) is rejected, (e) old-format recipe with `controls` field maps values into new structure per Spec S05 rule 6
- [ ] Verify hue slot resolution produces correct angles for brio recipe (compare canvas, atm, txt, control, display, informational, borderTint, cardFrame, decorative slots)
- [ ] Verify optional display/border overrides work when provided and when absent

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` exits 0 (TypeScript compiles)
- [ ] `cd tugdeck && bun run test` exits 0

---

#### Step 2: Update recipe function signatures and deriveTheme {#step-2}

**Depends on:** #step-1

**Commit:** `feat: recipe functions accept ThemeRecipe, read tone/intensity from specs`

**References:** [D02] Recipe functions accept ThemeRecipe, [D03] Hover/active tones use recipe.role.tone, [D07] Text intensity maps to contentTextIntensity, (#updated-recipe-interface, #example-recipes-values)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/recipe-functions.ts`: `darkRecipe(recipe: ThemeRecipe)`, `lightRecipe(recipe: ThemeRecipe)`, `RECIPE_REGISTRY` type update
- Modified `tugdeck/src/components/tugways/theme-engine.ts`: `deriveTheme` passes recipe to registry function; `resolveHueSlots` default parameter updated to `darkRecipe(recipe)`
- Modified `tugdeck/src/__tests__/theme-derivation-engine.test.ts`: update 4 `darkRecipeFn()`/`lightRecipeFn()` call sites to pass a recipe argument
- Modified `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx`: update 2 `darkRecipeFn()`/`lightRecipeFn()` call sites to pass a recipe argument

**Tasks:**
- [ ] Change `darkRecipe()` signature to `darkRecipe(recipe: ThemeRecipe)`. Replace hardcoded `c = 5` with `recipe.surface.canvas.tone`, `canvasIntensity = 5` with `recipe.surface.canvas.intensity`, `frameTone = 16` with `recipe.surface.card.tone`. Replace `filledSurfaceRestTone: c + 15` with `recipe.role.tone`. Compute hover/active as clamped offsets from `recipe.role.tone` per D03: `hoverTone = Math.max(0, Math.min(100, recipe.role.tone + 5))`, `activeTone = Math.max(0, Math.min(100, recipe.role.tone + 10))`. Replace `contentTextIntensity` with `recipe.text.intensity`, `mutedTextIntensity` with `recipe.text.intensity + 2`, `subtleTextIntensity` with `recipe.text.intensity + 4`. Replace `signalIntensityValue: roleIntensity` with `recipe.role.intensity` and `signalIntensity: Math.round(roleIntensity)` with `Math.round(recipe.role.intensity)`.
- [ ] Change `lightRecipe()` signature to `lightRecipe(recipe: ThemeRecipe)`. Same pattern: read tone/intensity from recipe specs. Replace `filledSurfaceRestTone: 20` with `recipe.role.tone`. Compute hover/active as clamped offsets per D03: `hoverTone = Math.max(0, Math.min(100, recipe.role.tone - 5))`, `activeTone = Math.max(0, Math.min(100, recipe.role.tone - 10))`. Replace `contentTextIntensity` with `recipe.text.intensity`. Replace `signalIntensityValue: roleIntensity` with `recipe.role.intensity` and `signalIntensity: Math.round(roleIntensity)` with `Math.round(recipe.role.intensity)`.
- [ ] Update `RECIPE_REGISTRY` type to `Record<string, { fn: (recipe: ThemeRecipe) => DerivationFormulas }>`.
- [ ] In `deriveTheme`, change both `registryEntry.fn()` to `registryEntry.fn(recipe)` AND the fallback `darkRecipe()` to `darkRecipe(recipe)` on the same line (~line 2253: `formulas = registryEntry ? registryEntry.fn(recipe) : darkRecipe(recipe)`).
- [ ] In `resolveHueSlots`, update the default formulas fallback: `recipe.formulas ?? darkRecipe(recipe)` (since darkRecipe now requires a parameter).
- [ ] Import `ThemeRecipe` type in `recipe-functions.ts`.

**Tests:**
- [ ] Update `theme-derivation-engine.test.ts`: change `darkRecipeFn()` calls (lines ~87, ~964, ~1149) to `darkRecipeFn(EXAMPLE_RECIPES.brio)` and `lightRecipeFn()` (line ~90) to `lightRecipeFn(EXAMPLE_RECIPES.harmony)` — 4 call sites total
- [ ] Update `gallery-theme-generator-content.test.tsx`: change `darkRecipeFn()` (line ~44) to `darkRecipeFn(EXAMPLE_RECIPES.brio)` and `lightRecipeFn()` (line ~45) to `lightRecipeFn(EXAMPLE_RECIPES.harmony)` — 2 call sites total
- [ ] Verify EXAMPLE_RECIPES produce valid token output

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` exits 0
- [ ] `cd tugdeck && bun run generate:tokens` produces tokens without errors
- [ ] `cd tugdeck && bun run audit:tokens verify` passes
- [ ] `cd tugdeck && bun run test` exits 0

---

#### Step 3: Build compact color picker component {#step-3}

**Depends on:** #step-1

**Commit:** `feat: add TugToneStrip and TugIntensityStrip color picker components`

**References:** [D01] ThemeColorSpec, Spec S06, (#color-picker-design)

**Artifacts:**
- New `tugdeck/src/components/tugways/tug-color-strip.tsx`: `TugToneStrip` and `TugIntensityStrip` components
- New `tugdeck/src/components/tugways/tug-color-strip.css`: styles for the strip components

**Tasks:**
- [ ] Create `TugToneStrip` component: accepts `hue: string`, `intensity: number`, `value: number`, `onChange: (tone: number) => void`. Renders a horizontal CSS gradient strip with ~10 `oklch()` color stops from tone 0 to tone 100 at the given hue and intensity. Click and drag to set tone value. Shows a thumb indicator at current value position.
- [ ] Create `TugIntensityStrip` component: accepts `hue: string`, `tone: number`, `value: number`, `onChange: (intensity: number) => void`. Renders a horizontal CSS gradient strip from intensity 0 (achromatic) to intensity 100 (vivid) at the given hue and tone. Click and drag to set intensity value.
- [ ] Implement pointer event handling: `onPointerDown` captures pointer, `onPointerMove` updates value, `onPointerUp` releases. Compute value from pointer X position relative to strip bounds.
- [ ] Style strips: consistent height with TugHueStrip, rounded corners, thumb indicator. Use CSS-only gradients (no canvas rendering).
- [ ] Verify gamut clamping: out-of-gamut `oklch()` stops are handled by the browser automatically.

**Tests:**
- [ ] Unit test: TugToneStrip renders with correct gradient stops for a given hue/intensity
- [ ] Unit test: TugIntensityStrip renders with correct gradient stops for a given hue/tone
- [ ] Unit test: pointer events compute correct value from position

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` exits 0
- [ ] `cd tugdeck && bun run test` exits 0

---

#### Step 4: Replace CompactHuePicker in Theme Generator with new pickers {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat: Theme Generator uses fully-specified color pickers`

**References:** [D01] ThemeColorSpec, [D05] State management individual fields, Spec S02, Spec S06, (#color-picker-design, #updated-recipe-interface)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx`: replace CompactHuePicker instances, add new state fields
- Modified `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css`: layout adjustments for new pickers

**Tasks:**
- [ ] Add new `useState` hooks for tone/intensity fields: `canvasTone`, `canvasIntensity`, `gridHue`, `gridTone`, `gridIntensity`, `cardTone`, `cardIntensity`, `textIntensity`, `roleTone`, `roleIntensity`. Initialize from `DEFAULT_RECIPE`.
- [ ] Replace surface `CompactHuePicker` instances with three-part pickers: `TugHueStrip` (existing) + `TugToneStrip` + `TugIntensityStrip` for canvas, grid, and card.
- [ ] Replace text `CompactHuePicker` with two-part picker: `TugHueStrip` + `TugIntensityStrip` (no tone strip — tone is derived).
- [ ] Replace role section: add shared `TugToneStrip` + `TugIntensityStrip` at top of role section, keep 7 `TugHueStrip` pickers (existing) for individual role hues.
- [ ] Update recipe construction in the derive callback: build `ThemeRecipe` from individual state fields using new structure (surface ThemeColorSpec objects, text pick, role with shared tone/intensity).
- [ ] Ensure `deriveTheme()` debounce at 150ms is maintained per L06.
- [ ] Update preset loading (`loadPreset`): when a preset is selected, set all new state fields from the preset's recipe values.
- [ ] Update recipe export: `generateCssExport` / JSON export produces new-format recipe.
- [ ] Update recipe import: `handleRecipeImported` reads new-format recipe and sets all state fields. Legacy format is handled by `validateRecipeJson` migration from Step 1.
- [ ] Remove dead element-group `useState` hooks and their setters (`controlHue`/`setControlHue`, `displayHue`/`setDisplayHue`, `informationalHue`/`setInformationalHue`, `borderHue`/`setBorderHue`, `decorativeHue`/`setDecorativeHue`). After the conversion to the new ThemeRecipe structure, these hooks no longer flow into the recipe and are dead state. Remove them and any JSX that references them.

**Tests:**
- [ ] Update gallery-theme-generator-content tests for new state fields and picker interactions
- [ ] Update theme-export-import tests for new recipe format in export/import

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` exits 0
- [ ] `cd tugdeck && bun run test` exits 0

---

#### Step 5: Wire canvas grid pick into grid line rendering {#step-5}

**Depends on:** #step-4

**Commit:** `feat: canvas grid color driven by recipe.surface.grid pick`

**References:** [D06] Canvas grid pick replaces sentinel, Spec S02, (#color-picker-design)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-engine.ts`: new `themeColorSpecToOklch` helper function (exported)
- Modified `tugdeck/src/components/tugways/tug-dock.css`: `--tug-canvas-grid-line` default value change
- Modified `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx`: compute grid color from recipe and set CSS property on preview container; embed `--tug-canvas-grid-line` in CSS export
- Modified `tugdeck/src/contexts/theme-provider.tsx`: set `--tug-canvas-grid-line` on `document.body` for built-in themes after theme injection

**Tasks:**
- [ ] Add a `themeColorSpecToOklch(spec: ThemeColorSpec): string` helper in `theme-engine.ts` (exported) that converts a `ThemeColorSpec` to an `oklch(L C H)` CSS string. The conversion reuses existing palette-engine utilities: (a) resolve hue name to angle via `HUE_FAMILIES`, (b) extract the primary color name using `primaryColorName(spec.hue)` — this existing utility handles compound hue names like "indigo-violet" by extracting the primary name "indigo" for `DEFAULT_CANONICAL_L` and `MAX_CHROMA_FOR_HUE` lookups, (c) convert tone to L using `toneToL(spec.tone, primaryName)` from `theme-accessibility.ts` (must use `primaryName` from step (b), not `spec.hue`, because `toneToL` indexes `DEFAULT_CANONICAL_L` by single-word hue name), (d) convert intensity to chroma using `(MAX_CHROMA_FOR_HUE[primaryName] ?? MAX_CHROMA_FOR_HUE[spec.hue] ?? 0.022) * PEAK_C_SCALE * (spec.intensity / 100)` from `palette-engine.ts`, (e) return `oklch(${L} ${C} ${angle})`.
- [ ] In the Theme Generator, compute grid line color using `themeColorSpecToOklch(recipe.surface.grid)`. Set `--tug-canvas-grid-line` on the preview container element via direct DOM style manipulation (L06 compliant).
- [ ] In `tug-dock.css`, change `--tug-canvas-grid-line` from `var(--tug-base-surface-highlight-primary-normal-hover-rest)` to a static fallback value (e.g., `oklch(0.15 0.01 280)` for the dark default). This fallback is overridden by the imperative setter in the theme provider.
- [ ] In `theme-provider.tsx`, add a `setGridLineColor` helper that calls `document.body.style.setProperty("--tug-canvas-grid-line", themeColorSpecToOklch(recipe.surface.grid))`. Call this helper in two places: (a) `setTheme` — after `injectThemeCSS` or `removeThemeCSS`, compute grid color from `EXAMPLE_RECIPES[newTheme].surface.grid`; (b) `applyInitialTheme` — after injecting initial CSS. Import `themeColorSpecToOklch` and `EXAMPLE_RECIPES` from `theme-engine.ts`. For `setDynamicTheme`, the grid line value is already embedded in the saved CSS (see export task below), so no additional computation is needed.
- [ ] Update the CSS export function (`generateCssExport` or equivalent) to embed `--tug-canvas-grid-line: <oklch value>` in the saved theme CSS. Compute the value via `themeColorSpecToOklch(recipe.surface.grid)` and append it to the exported CSS text. This ensures that `setDynamicTheme` — which only fetches CSS, not recipe JSON — gets the grid line color without needing a separate recipe fetch.
- [ ] Verify grid lines appear correctly in both the Theme Generator preview and the main app canvas.
- [ ] Verify grid lines work in both dark (brio) and light (harmony) modes.

**Tests:**
- [ ] Unit test: `themeColorSpecToOklch` produces correct `oklch()` string for a simple hue name (e.g., "blue")
- [ ] Unit test: `themeColorSpecToOklch` produces correct `oklch()` string for a compound hue name (e.g., "indigo-violet") — verifies primary name extraction via `primaryColorName`
- [ ] Verify `--tug-canvas-grid-line` is set correctly for brio grid spec (indigo-violet, tone 12, intensity 4)
- [ ] Verify `--tug-canvas-grid-line` is set correctly for harmony grid spec (indigo-violet, tone 88, intensity 5)
- [ ] Verify `--tug-canvas-grid-line` is embedded in exported CSS for dynamic themes

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` exits 0
- [ ] `cd tugdeck && bun run test` exits 0
- [ ] Visual verification: grid lines visible on canvas in both dark and light themes

---

#### Step 6: Final Integration Checkpoint {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] ThemeColorSpec, [D02] Recipe functions accept ThemeRecipe, [D04] Element group removed, [D05] State management, [D06] Canvas grid pick, (#success-criteria, #exit-criteria)

**Artifacts:** None (verification only)

**Tasks:**
- [ ] Verify full end-to-end flow: launch Theme Generator, change surface tone/intensity, see live preview update
- [ ] Verify text picker: change text hue and intensity, confirm text chromaticity changes while contrast is maintained
- [ ] Verify role section: change shared tone/intensity, confirm all role fills update together
- [ ] Verify preset loading: switch between brio and harmony, confirm all state fields update
- [ ] Verify export/import: export theme, import it back, confirm round-trip fidelity
- [ ] Verify legacy import: import an old-format recipe, confirm migration and correct rendering
- [ ] Verify grid lines: change grid pick, confirm grid color updates in preview

**Tests:**
- [ ] Run full test suite

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` exits 0
- [ ] `cd tugdeck && bun run generate:tokens` exits 0
- [ ] `cd tugdeck && bun run audit:tokens verify` exits 0
- [ ] `cd tugdeck && bun run test` exits 0

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Theme recipes use fully-specified color picks (hue + tone + intensity) for surfaces, text, and roles, with corresponding UI controls in the Theme Generator and legacy migration for old-format recipes.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `ThemeColorSpec` type exists and `ThemeRecipe` uses structured picks (build passes)
- [ ] `EXAMPLE_RECIPES` brio and harmony have explicit tone/intensity values
- [ ] Recipe functions read tone/intensity from recipe specs (no hardcoded constants for designer-controlled values)
- [ ] `resolveHueSlots` reads from new structure; `element` group is gone
- [ ] Legacy recipes auto-migrate in `validateRecipeJson`
- [ ] Theme Generator exposes tone/intensity controls for surfaces, intensity for text, shared tone/intensity for roles
- [ ] Canvas grid color is controlled by `recipe.surface.grid` pick
- [ ] `bun run generate:tokens` and `bun run audit:tokens verify` pass
- [ ] All tests pass

**Acceptance tests:**
- [ ] `cd tugdeck && bun run build` exits 0
- [ ] `cd tugdeck && bun run generate:tokens` exits 0
- [ ] `cd tugdeck && bun run audit:tokens verify` exits 0
- [ ] `cd tugdeck && bun run test` exits 0

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Expose optional display/border overrides in the Theme Generator UI behind an "Advanced" toggle
- [ ] Connect `recipe.role.intensity` to filled button vividness (requires rule entry changes)
- [ ] Build the full inspector TugColorPicker (opacity, hex/RGB, swatch history)
- [ ] Consider inferring `recipe: "dark" | "light"` from canvas.tone (< 50 = dark, >= 50 = light)

| Checkpoint | Verification |
|------------|--------------|
| Engine compiles with new ThemeRecipe | `bun run build` exits 0 |
| Tokens generated correctly | `bun run generate:tokens` exits 0 |
| Token audit passes | `bun run audit:tokens verify` exits 0 |
| All tests pass | `bun run test` exits 0 |
| Legacy migration works | Old-format recipe imports successfully |
| Grid pick wired | Grid lines reflect recipe.surface.grid color |
