# Fully-Specified Theme Colors

## The problem

The 15 hue picks in a theme recipe are hue-only strings. Tone and intensity are hardcoded constants inside `darkRecipe()` and `lightRecipe()`. The designer picks "blue" but has no control over how vivid or how light that blue is — those decisions are buried in 400-line recipe functions. Multiple attempts to add slider-based controls for tone/intensity failed because the sliders controlled broad categories (`roleTone` affecting all 7 roles at once) rather than individual color slots.

## The goal

The minimum information a human designer needs to specify to produce a good-looking, fully legible theme. Everything else is derived by the engine.

---

## 11 designer picks

A theme is defined by 11 color picks. Each pick is a hue plus the values the designer actually controls for that slot. The engine derives everything else — surface layer offsets, text contrast tones, control state variations, shadows, borders.

### Surface picks (3) — hue + tone + intensity

These define the physical surfaces. Tone is a real designer choice because it determines the fundamental character (how dark, how contrasty).

| # | Pick | What it controls | Designer chooses |
|---|------|------------------|------------------|
| 1 | **Canvas** | App background, baseline for all surface offsets | hue, tone, intensity |
| 2 | **Canvas grid** | Grid lines on the canvas background | hue, tone, intensity |
| 3 | **Card frame** | Card title bar | hue, tone, intensity |

Canvas tone is the dark/light decision. Card frame tone determines title bar prominence against the canvas. The card *body* surface remains a structural offset from canvas (the engine handles this).

**Canvas grid implementation note:** The grid already exists. `--tug-canvas-grid-line` is set in `tug-dock.css` (line 35) to `--tug-base-surface-highlight-primary-normal-hover-rest`, which is a sentinel token (`highlightHover` slot, intensity 0, tone 100, alpha from `formulas.highlightHoverAlpha`). The grid lines are rendered via CSS `linear-gradient` in `globals.css` and `gallery-theme-generator-content.css`. With a grid pick, the grid line color would come from `recipe.surface.grid` instead of the sentinel token — allowing the designer to control grid color directly. This means either: (a) the grid lines switch to a non-sentinel token whose hue/tone/intensity come from the grid pick, or (b) the sentinel alpha is derived from the grid pick's tone and the sentinel hue is set to the grid pick's hue.

### Text pick (1) — hue + intensity

| # | Pick | What it controls | Designer chooses |
|---|------|------------------|------------------|
| 4 | **Text** | Body text, labels, metadata | hue, intensity |

Text tone is *always* derived via `contrastSearch` against the canvas surface — the designer never picks it. Muted, subtle, disabled text are offsets from the primary text tone. The designer controls color family (cobalt vs neutral vs warm) and how chromatic the text is.

**Text intensity mapping:** `recipe.text.intensity` maps to `contentTextIntensity` in DerivationFormulas. The muted and subtle text intensities are offsets: `mutedTextIntensity = text.intensity + 2`, `subtleTextIntensity = text.intensity + 4`. This preserves the current relationship (dark: 3/5/7, light: 4/6/8) while letting the designer control the base chromatic level.

### Role picks (7) — hue + tone + intensity

| # | Pick | What it controls | Designer chooses |
|---|------|------------------|------------------|
| 5 | **Accent** | Primary brand color, vivid fills | hue, tone, intensity |
| 6 | **Action** | Links, interactive highlights | hue, tone, intensity |
| 7 | **Agent** | AI/agent indicators | hue, tone, intensity |
| 8 | **Data** | Data visualization | hue, tone, intensity |
| 9 | **Success** | Positive/success signals | hue, tone, intensity |
| 10 | **Caution** | Warning signals | hue, tone, intensity |
| 11 | **Danger** | Error/destructive signals | hue, tone, intensity |

**Role tone mapping:** `recipe.role.X.tone` feeds into the **filled button/badge surface tone** for that role — `filledSurfaceRestTone`, `semanticSignalTone`, `borderSignalTone`, and the per-role tone fields in the badge/button system. Currently, filled surface tones are *not* connected to `roleTone` — `filledSurfaceRestTone` is hardcoded as `c + 15` (dark) or `20` (light), independent of any role value. This is why role colors look muddy in light mode: the filled surface tone is 20 regardless of what the designer might want. With per-role tone, `recipe.role.accent.tone = 60` would directly set the filled accent button surface to tone 60 — bright and vivid on a light canvas. Hover and active states are offsets from the rest tone (+5, +10 or similar).

**Role intensity mapping:** `recipe.role.X.intensity` feeds into `signalIntensityValue` and per-role intensity fields. Currently all roles share one `signalIntensityValue`. With per-role intensity, each role gets its own vividness.

On dark themes, mid-tone (~50) works because fills pop against the dark canvas. On light themes, role fills need higher tone (~55-65) so they read as bright pops of color rather than dark muddy blobs.

### What the engine derives

- Surface layer tones — sunken, default, raised, overlay as offsets from canvas tone
- Card body tone — offset from canvas tone
- Text tone — contrastSearch against canvas
- Text hierarchy — muted, subtle, disabled as offsets from primary text tone
- Border/divider tones — derived from surface relationships
- Control state variations — hover, active, disabled as offsets from rest
- Shadow depths — mode-dependent constants
- Element hue routing — control text defaults to text hue, informational defaults to canvas hue, display defaults to text hue (overridable later), border defaults to canvas hue, decorative is always gray

### Optional overrides (not in the default UI)

- **Display** hue + intensity — if titles should differ from body text (brio uses indigo for display vs cobalt for content)
- **Border** hue + intensity — if borders should differ from canvas atmosphere

These live as optional fields on ThemeRecipe (e.g., `display?: { hue: string; intensity: number }`). When absent, the engine defaults them. The Theme Generator UI can expose them behind an "Advanced" toggle later.

---

## What changes

### ThemeColorSpec type

```ts
interface ThemeColorSpec {
  hue: string;        // "blue", "indigo-violet", etc.
  tone: number;       // 0-100
  intensity: number;  // 0-100
}
```

### ThemeRecipe interface

Surface picks and role picks become `ThemeColorSpec` (hue + tone + intensity). Text pick is `{ hue, intensity }` (tone derived). Add canvas grid to surface.

```ts
interface ThemeRecipe {
  name: string;
  description: string;
  recipe: "dark" | "light";

  surface: {
    canvas: ThemeColorSpec;
    grid: ThemeColorSpec;
    card: ThemeColorSpec;
  };

  text: {
    hue: string;
    intensity: number;
  };

  role: {
    accent: ThemeColorSpec;
    action: ThemeColorSpec;
    agent: ThemeColorSpec;
    data: ThemeColorSpec;
    success: ThemeColorSpec;
    caution: ThemeColorSpec;
    danger: ThemeColorSpec;
  };

  // Optional overrides (defaulted by engine when absent)
  display?: { hue: string; intensity: number };
  border?: { hue: string; intensity: number };

  formulas?: DerivationFormulas; // escape hatch — unchanged
}
```

All 11 picks use the same three-part color picker (hue + tone + intensity). Text is the one exception — tone is hidden/derived, so it gets a two-part picker (hue + intensity).

The current `element` group (content, control, display, informational, border, decorative) goes away as explicit picks. Those hue routings become engine defaults: content/control/display use the text hue, informational/border use canvas hue, decorative is gray. Display and border are available as optional overrides.

**The `recipe: "dark" | "light"` field stays.** It determines offset direction (dark: surfaces lighter than canvas, light: surfaces darker) and contrastSearch direction. Could theoretically be inferred from canvas.tone (< 50 = dark, >= 50 = light), but keeping it explicit is simpler and avoids edge cases.

### Recipe functions

`darkRecipe(recipe: ThemeRecipe)` and `lightRecipe(recipe: ThemeRecipe)` read tone and intensity from the recipe's color specs instead of hardcoded constants.

**Signature change:** Currently `darkRecipe(): DerivationFormulas`. Becomes `darkRecipe(recipe: ThemeRecipe): DerivationFormulas`. The recipe function uses `recipe.surface.canvas.tone`, `recipe.role.accent.tone`, etc. — it reads design intent from the recipe input. It still computes offsets (surfaceSunkenTone = canvas.tone + 6), contrastSearch for text, and structural constants (shadows, alphas).

**RECIPE_REGISTRY change:** Currently `{ fn: () => DerivationFormulas }`. Becomes `{ fn: (recipe: ThemeRecipe) => DerivationFormulas }`.

**deriveTheme change:** Currently `registryEntry.fn()`. Becomes `registryEntry.fn(recipe)`. The recipe object is already available in deriveTheme — it's the function's parameter. The `formulas?: DerivationFormulas` field on ThemeRecipe is not circular: when formulas is provided, the recipe function is never called (the formulas escape hatch takes precedence).

### resolveHueSlots

Currently reads `recipe.element.content`, `recipe.element.border`, etc. for hue routing. After the element group is removed, resolveHueSlots needs to derive these slots from the new structure:

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
| `decorative` | `recipe.element.decorative` (string) | `"gray"` |
| `interactive` | `recipe.role.action` (string) | `recipe.role.action.hue` |
| `active` | `recipe.role.action` (string) | `recipe.role.action.hue` |
| `accent` | `recipe.role.accent` (string) | `recipe.role.accent.hue` |
| `destructive` | `recipe.role.danger` (string) | `recipe.role.danger.hue` |
| `success` | `recipe.role.success` (string) | `recipe.role.success.hue` |
| `caution` | `recipe.role.caution` (string) | `recipe.role.caution.hue` |
| `agent` | `recipe.role.agent` (string) | `recipe.role.agent.hue` |
| `data` | `recipe.role.data` (string) | `recipe.role.data.hue` |

Derived slots (`fgMuted`, `fgSubtle`, `surfBareBase`, etc.) continue to work as they do now — they use formula hue-expression fields, not recipe fields.

### EXAMPLE_RECIPES

Brio and harmony gain explicit tone and intensity on their picks. Values come from what `darkRecipe()` and `lightRecipe()` currently hardcode. No visual change at this step.

```ts
brio: {
  recipe: "dark",
  surface: {
    canvas: { hue: "indigo-violet", tone: 5, intensity: 5 },
    grid:   { hue: "indigo-violet", tone: 12, intensity: 4 },
    card:   { hue: "indigo-violet", tone: 16, intensity: 12 },
  },
  text: { hue: "cobalt", intensity: 3 },
  role: {
    accent:  { hue: "orange",  tone: 50, intensity: 50 },
    action:  { hue: "blue",    tone: 50, intensity: 50 },
    agent:   { hue: "violet",  tone: 50, intensity: 50 },
    data:    { hue: "teal",    tone: 50, intensity: 50 },
    success: { hue: "green",   tone: 50, intensity: 50 },
    caution: { hue: "yellow",  tone: 50, intensity: 50 },
    danger:  { hue: "red",     tone: 50, intensity: 50 },
  },
  display: { hue: "indigo", intensity: 3 },
}

harmony: {
  recipe: "light",
  surface: {
    canvas: { hue: "indigo-violet", tone: 95, intensity: 6 },
    grid:   { hue: "indigo-violet", tone: 88, intensity: 5 },
    card:   { hue: "indigo-violet", tone: 85, intensity: 35 },
  },
  text: { hue: "cobalt", intensity: 4 },
  role: {
    accent:  { hue: "orange",  tone: 60, intensity: 60 },
    action:  { hue: "blue",    tone: 55, intensity: 60 },
    agent:   { hue: "violet",  tone: 55, intensity: 60 },
    data:    { hue: "teal",    tone: 55, intensity: 60 },
    success: { hue: "green",   tone: 55, intensity: 60 },
    caution: { hue: "yellow",  tone: 60, intensity: 60 },
    danger:  { hue: "red",     tone: 55, intensity: 60 },
  },
  display: { hue: "indigo", intensity: 4 },
}
```

### Legacy recipe migration

Existing saved themes use the old format: string hue fields, an `element` group, no `text` or `grid` fields. When loading a legacy recipe:

1. String hue → extract `.hue` from the string, default tone/intensity from the current recipe function's hardcoded values for that mode (dark defaults: canvas tone 5, intensity 5; light defaults: canvas tone 95, intensity 6; role tone 50, intensity 50).
2. Missing `text` field → derive from `element.content` hue with default intensity.
3. Missing `grid` field → derive from `surface.canvas` with grid-appropriate tone/intensity defaults.
4. `element` group → map `element.content` to `text.hue`, `element.display` to `display` override (if different from content), ignore the rest (they default).

This migration runs in `validateRecipeJson` / recipe import path. Old-format recipes load and produce the same visual result.

---

## Color picker

Replace `CompactHuePicker` (hue-only) with a compact color picker that can set all the values a pick needs.

### Three-part picker (for 10 of 11 picks)

1. **Hue strip** — the existing `TugHueStrip`. 48 named hues. Click to select.
2. **Tone strip** — horizontal gradient, dark to light, at the current hue and intensity. Click/drag to set tone.
3. **Intensity strip** — horizontal gradient, achromatic to vivid, at the current hue and tone. Click/drag to set intensity.

All surface picks and all role picks get the three-part picker — 10 of 11.

### Two-part picker (for text pick only)

Same as above but without the tone strip. Text tone is derived via contrastSearch, so the designer only picks hue and intensity.

### Implementation

The tone and intensity strips are CSS linear gradients with ~10 computed color stops using `oklch()`. CSS handles gamut mapping — if a stop is out of gamut, the browser clamps it. No gamut math on our side.

Each strip fires `onChange` on every drag frame. The Theme Generator debounces `deriveTheme()` at 150ms per L06.

---

## Execution approach

This is a targeted set of changes, not a rewrite. The engine pipeline (resolveHueSlots → evaluateRules → tokens) stays. The rule system stays. Contrast enforcement stays. What changes is where tone/intensity values originate (recipe input instead of hardcoded constants) and what the designer interacts with (color pickers instead of hue-only dropdowns).

**Step 1:** Add `ThemeColorSpec` type. Update `ThemeRecipe` interface: replace surface/element/role string fields with the new structure (surface specs, text pick, role specs, optional display/border overrides). Update `EXAMPLE_RECIPES`. Add legacy migration in the recipe import/validation path. Verify `bun run build` passes.

**Step 2:** Update recipe function signatures to take `ThemeRecipe`. Update `RECIPE_REGISTRY` type. Update `deriveTheme` to pass the recipe to the registry function. Recipe functions read tone/intensity from recipe specs instead of hardcoded constants. Verify with `bun run generate:tokens` and `bun run audit:tokens verify` that output matches current behavior.

**Step 3:** Update `resolveHueSlots` to read hue names from the new ThemeRecipe structure (see mapping table above). Remove all `recipe.element.*` reads. Verify all hue routing works with `bun run generate:tokens`.

**Step 4:** Build the compact color picker component (hue strip + tone strip + intensity strip). CSS gradient strips with `oklch()` color stops. New component file in `tugways/`.

**Step 5:** Replace `CompactHuePicker` instances in the Theme Generator with the new picker. 10 picks get three-part pickers (3 surface + 7 role), text gets a two-part picker. Update the generator's state management to handle `ThemeColorSpec` values instead of hue strings.

**Step 6:** Wire the canvas grid pick into the grid line rendering. Update `--tug-canvas-grid-line` to use a token driven by `recipe.surface.grid` instead of the sentinel highlight token.

---

## What we're NOT doing

- Changing the 48-hue palette or OKLCH color math
- Changing the token naming system
- Changing the RULES table in evaluateRules
- Changing contrast enforcement or thresholds
- Building the full inspector TugColorPicker (opacity, hex/RGB, swatch history)
- Gamut-clamping in the picker — CSS handles it
- Adding new token types
