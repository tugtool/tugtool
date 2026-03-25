# Theme System Simplification

Strip the theme system down to its essentials. Remove the entire ThemeSpec/recipe/formula/generation pipeline. Keep the color palette, token naming, pairings, and hand-editable CSS files.

## Context

The theme derivation pipeline (ThemeSpec → Recipe → 300+ formulas → RULES evaluation → token values) is the source of all complexity and bugs. It tries to derive 400+ tokens from 15 color choices, but the derivation logic is opaque, tightly coupled, and impossible to debug.

What actually matters at runtime:

1. A default set of tokens (`tug-base-generated.css`)
2. Optional theme override CSS files (`styles/themes/harmony.css`)

Everything else is infrastructure to produce those files. The infrastructure has become more complex than the output.

## What Gets Removed

### Generation pipeline

| File | What it is |
|------|-----------|
| `src/components/tugways/theme-engine.ts` | ThemeSpec, DerivationFormulas, RULES table, deriveTheme (~1500 lines) |
| `src/components/tugways/recipes/dark.ts` | Dark recipe function |
| `src/components/tugways/recipes/light.ts` | Light recipe function |
| `scripts/generate-theme-override.ts` | Subprocess for generating override CSS |
| `scripts/generate-tug-tokens.ts` | Base token generator |
| `src/theme-css-generator.ts` | Generates CSS from ThemeSpec |
| `themes/brio.json` | ThemeSpec JSON |
| `themes/harmony.json` | ThemeSpec JSON |
| `themes/bluenote.json` | ThemeSpec JSON (delete entirely) |

### Theme Generator card

Gut `gallery-theme-generator-content.tsx`. Remove all color pickers, controls section, and generation logic. Rename to Theme Accessibility. Keep only the Contrast Dashboard, CVD Preview, and Contrast Diagnostics.

### Tests

Delete all theme-related test files: `theme-middleware.test.ts`, `gallery-theme-generator-content.test.tsx` (or gut to match the renamed card), and any formula/recipe/theme-engine tests. These tests exist only as a maintenance burden without catching real issues.

### vite.config.ts simplification

`activateThemeOverride` becomes trivial: read `styles/themes/<name>.css`, write it to `tug-theme-override.css`. One read, one write. No subprocess, no `require()`, no formula cache. `controlTokenHotReload` simplifies to watching `styles/themes/` for changes and re-copying the active theme's CSS file. Remove `handleFormulasGet`, FormulasCache, formula-related endpoints, and all `require()` calls for theme-engine.

## What Gets Kept

### Color palette

`palette-engine.ts` — the OKLCH color model with hue/tone/intensity/alpha. Excellent. No changes.

### Default tokens

`tug-base-generated.css` — snapshot as the permanent base. Remove the `@generated:tokens:begin/end` markers since it's no longer generated. This file becomes hand-editable. It IS the brio default.

### Theme override

`styles/themes/harmony.css` — the one override theme. Hand-maintained. Defines only the tokens that differ from the base.

### Pairings and audit

`@tug-pairings` annotations in component CSS and the `audit:tokens` script. No changes needed.

### Token naming

The seven-slot `--tug-{surface|element}-{scope}-{category}-{variant}-{emphasis}-{state}` convention. No changes.

### HMR

Vite natively hot-reloads CSS files. Editing `tug-base-generated.css` or `harmony.css` delivers changes live. The override copy into `tug-theme-override.css` triggers Vite's CSS HMR.

### Theme switching

The Swift menu reads `.css` files from the `styles/themes/` directory. The `set-theme` action calls the simplified activate endpoint. `putTheme`/`fetchThemeWithRetry` in settings-api.ts remembers the active theme.

## Workflow After Simplification

**Edit base tokens:** Open `tug-base-generated.css`, change a token value, save. HMR delivers the change live.

**Edit harmony:** Open `styles/themes/harmony.css`, change a token override, save. HMR delivers the change live.

**Add a new theme:** Create a new `.css` file in `styles/themes/`. Override whichever tokens differ from the base. Restart app for the Swift menu to pick it up.

**Check accessibility:** Use the Theme Accessibility card (contrast dashboard, CVD preview, diagnostics).

## Tuglaws Updates

After the code changes, revise these documents:

- `tuglaws/theme-engine.md` — rewrite to reflect the simplified system (no more ThemeSpec, recipes, formulas, RULES table)
- `tuglaws/color-palette.md` — probably fine as-is
- `tuglaws/token-naming.md` — probably fine as-is
- `tuglaws/component-authoring.md` — add the token-to-component contract (Phase 2: no ad-hoc color picking, components must use declared tokens via `@tug-pairings`)

## Notes

The `formula-reverse-map.ts` and style inspector formula display code can be removed too — they depend on the formula pipeline. The style inspector's token chain display (bg/fg/border) can stay if it's useful, but the formula section goes away.

`theme-pairings.ts` and `theme-accessibility.test.ts` should be evaluated — keep if they support the pairings/contrast tools, remove if they depend on the formula pipeline.

The `canvasParams` / `sendCanvasColor` mechanism for the Swift title bar color needs to be preserved. With the simplified system, canvas params can be read directly from the theme CSS file or hardcoded per theme.
