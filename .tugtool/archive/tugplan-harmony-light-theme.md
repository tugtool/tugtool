## Create the Harmony Light Theme {#harmony-light-theme}

**Purpose:** Ship a fully integrated light theme (Harmony) as a peer of Brio, proving the semantic formula architecture can produce a complete, contrast-compliant, hot-swappable theme from a set of light-polarity formula overrides.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | harmony-light-theme |
| Last updated | 2026-03-17 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Parts 1-4 of the semantic formula architecture are merged. The derivation engine now has named formula builders, semantic annotations on all ~198 `DerivationFormulas` fields organized into ~23 decision groups, and fully annotated `DARK_FORMULAS` with design rationale. `BASE_FORMULAS` is defined as an alias of `DARK_FORMULAS`, and `DARK_OVERRIDES` is empty — ready for a light recipe to override only the fields that differ.

The engine already supports `mode: "light"` in recipes and has light-mode formula fields (e.g., `outlinedFgRestToneLight`, `ghostFgRestToneLight`), but no production light recipe exists. The existing light-mode test (T4.2) uses `LIGHT_MODE_PAIR_EXCEPTIONS` to document known surface-derivation constraints that occur when toggling mode without light-specific formulas. The whole point of `LIGHT_OVERRIDES` is to eliminate those failures.

#### Strategy {#strategy}

- Define `LIGHT_OVERRIDES` by walking every semantic decision group and inverting the dark-mode polarity using the annotated rationale in `DARK_FORMULAS` as a guide.
- Create `EXAMPLE_RECIPES.harmony` as a peer of `EXAMPLE_RECIPES.brio` — same cobalt/violet/indigo palette, `mode: "light"`, formulas composed as `{ ...BASE_FORMULAS, ...LIGHT_OVERRIDES }`.
- Update `generate-tug-tokens.ts` to write a standalone `styles/themes/harmony.css` override file served at `/styles/themes/harmony.css`.
- Widen `ThemeName` to `"brio" | "harmony"`, add harmony to `themeCSSMap` and `canvas-color.ts`, and support `applyInitialTheme("harmony")`.
- Validate all 373 harmony tokens pass contrast with zero exceptions — eliminate `LIGHT_MODE_PAIR_EXCEPTIONS` entirely.
- Verify harmony appears as a preset in the Theme Generator card (automatic from `Object.keys(EXAMPLE_RECIPES)` iteration) and is hot-swappable from the theme menu.

#### Success Criteria (Measurable) {#success-criteria}

- `deriveTheme(EXAMPLE_RECIPES.harmony)` produces exactly 373 tokens (same count as brio).
- All 373 harmony tokens pass contrast validation with zero unexpected failures — `LIGHT_MODE_PAIR_EXCEPTIONS` is empty or removed.
- `bun run generate:tokens` produces both `styles/tug-base-generated.css` (brio) and `styles/themes/harmony.css` (harmony) without errors.
- `ThemeName` includes `"harmony"` and `applyInitialTheme("harmony")` injects the override stylesheet.
- The theme generator card renders a "Harmony" preset button and clicking it loads the harmony recipe into the preview.
- All existing tests pass (`bun test`); no regressions in brio contrast validation.

#### Scope {#scope}

1. `LIGHT_OVERRIDES` and `LIGHT_FORMULAS` with annotated design rationale for all ~23 semantic decision groups.
2. `EXAMPLE_RECIPES.harmony` — light recipe with cobalt/violet/indigo palette.
3. `generate-tug-tokens.ts` updated to produce `styles/themes/harmony.css` as a standalone override file.
4. `ThemeName` widened; `themeCSSMap` and `canvas-color.ts` updated for harmony.
5. Contrast validation: zero exceptions for harmony tokens.
6. Theme Generator preset button integration (automatic from `EXAMPLE_RECIPES` iteration).
7. Hot-swap support from theme menu (via `setTheme("harmony")` / `applyInitialTheme("harmony")`).

#### Non-goals (Explicitly out of scope) {#non-goals}

- LLM-generated recipe flow (prompt-to-recipe) — future work.
- Additional themes beyond harmony (e.g., high-contrast, warm, cool).
- Modifying the derivation rule table (`derivation-rules.ts`) — light-mode differences are expressed entirely through formula overrides.
- Changing brio's token output or visual appearance.
- Implementing the Bluenote theme (menu item exists in `AppDelegate.swift` but has no recipe or formulas — future work).

#### Dependencies / Prerequisites {#dependencies}

- Parts 1-4 of semantic-formula-architecture merged (named formula builders, semantic annotations, interface restructure, dark recipe annotation).
- `BASE_FORMULAS` and `DARK_OVERRIDES` exported from `theme-derivation-engine.ts`.
- `styles/themes/` directory exists with `.gitkeep`.

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` in `.cargo/config.toml`).
- Always use `bun` (never npm) for JavaScript/TypeScript operations.
- Token generation must remain deterministic — same inputs always produce same outputs.
- The harmony CSS file must be a complete override file (all 373 tokens) so it works as a standalone stylesheet injection.

#### Assumptions {#assumptions}

- `LIGHT_OVERRIDES` will cover all ~23 semantic decision groups with full annotated rationale comments, mirroring the structure of `DARK_FORMULAS` annotations from Part 4.
- `EXAMPLE_RECIPES.harmony` uses the same hue palette as brio (cobalt for text, indigo-violet for cardBg/canvas/borderTint, indigo for cardFrame, cyan for link).
- The contrast validation target of zero exceptions applies to the engine's built-in contrast floor enforcement — `KNOWN_PAIR_EXCEPTIONS` in the test suite will be reviewed.
- `selectionInactiveSemanticMode` will be set to `false` in `LIGHT_OVERRIDES` to enable the atm-offset path for inactive selection in light mode.
- The harmony canvas color for `canvas-color.ts` will be indigo-violet at approximately intensity 3, tone 95 (the light-mode inverse of brio's tone 5).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan skeleton. All headings that will be cited use explicit `{#anchor-name}` anchors. Steps cite decisions, specs, tables, and anchors via `**References:**` lines.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Light formula values don't achieve contrast targets | high | med | Iterative calibration against contrast validator; use dark rationale as guide | Any harmony token fails contrast after initial calibration |
| Harmony CSS file not served correctly in dev/prod | med | low | Test both Vite dev middleware and static file serving | 404 on `/styles/themes/harmony.css` |
| Theme switch causes flash of unstyled content | med | low | `applyInitialTheme()` runs before React mount; same pattern as brio | Visual flash on page load with harmony saved |

**Risk R01: Light formula calibration difficulty** {#r01-formula-calibration}

- **Risk:** Some semantic decision groups may require multiple iterations to find values that pass all contrast pairings on light surfaces.
- **Mitigation:** Start from the polarity-inversion table in the roadmap. Use the contrast validator in a tight feedback loop. The ~23 decision groups are independent — calibrate each group separately.
- **Residual risk:** Edge cases in shadow/overlay alpha values may need empirical tuning beyond theoretical inversion.

---

### Design Decisions {#design-decisions}

#### [D01] Standalone override file for harmony tokens (DECIDED) {#d01-standalone-override}

**Decision:** `generate-tug-tokens.ts` writes `styles/themes/harmony.css` as a full override file containing all 373 tokens in a `body {}` block, served at `/styles/themes/harmony.css`.

**Rationale:**
- Brio tokens live in `tug-base-generated.css` (imported by `tug-base.css`) and serve as the default.
- Harmony overrides all 373 tokens via CSS cascade — the injected `<style>` element from `injectThemeCSS()` wins over `tug-base.css` defaults.
- A standalone file is simpler than scoped selectors and matches the existing `setDynamicTheme()` fetch pattern.

**Implications:**
- `generate-tug-tokens.ts` must iterate all `EXAMPLE_RECIPES` entries and write per-theme files for non-default themes.
- The harmony CSS file is generated, not hand-authored — regenerated by `bun run generate:tokens`.

#### [D02] First-class static ThemeName for harmony (DECIDED) {#d02-static-theme-name}

**Decision:** Widen `ThemeName` to `"brio" | "harmony"`. Add harmony to `themeCSSMap` and `canvas-color.ts`. Support `applyInitialTheme("harmony")`.

**Rationale:**
- Harmony is a permanent, built-in theme — not a user-created dynamic theme.
- Static typing ensures all theme-dependent code paths handle harmony.
- `themeCSSMap` stores the CSS string for harmony (pre-fetched in `main.tsx` IIFE via `registerThemeCSS()`).

**Implications:**
- `canvas-color.ts` needs a harmony entry with light-mode canvas TugColor params — updated in the same commit to avoid type errors from `Record<ThemeName, ...>`.
- `sendCanvasColor("harmony")` must return the correct hex for the Swift bridge.
- `setTheme("harmony")` reads pre-fetched CSS from `themeCSSMap` and injects the override stylesheet; `setTheme("brio")` removes it (brio is the default).

#### [D03] Preset buttons are preview-only (DECIDED) {#d03-preset-preview}

**Decision:** Preset buttons in the Theme Generator card only load the recipe into the generator preview — they do not trigger an app-level theme switch.

**Rationale:**
- This is the current behavior for the brio preset button.
- The Theme Generator is a design tool; app-level theme switching happens via the theme menu.
- No code change needed — the `loadPreset()` callback already works this way.

**Implications:**
- The harmony preset button appears automatically from `Object.keys(EXAMPLE_RECIPES)` iteration.
- No changes to `gallery-theme-generator-content.tsx` beyond what `EXAMPLE_RECIPES.harmony` provides.

#### [D04] LIGHT_OVERRIDES covers all 23 semantic groups (DECIDED) {#d04-light-overrides-scope}

**Decision:** `LIGHT_OVERRIDES` explicitly sets every formula field that differs from `BASE_FORMULAS` (the dark defaults), covering all 23 semantic decision groups. Each field has an inline comment explaining the light-mode design rationale.

**Rationale:**
- The semantic formula architecture requires that a recipe is a complete, intentional set of positions on every design decision.
- Omitting a field means accepting the dark default, which is only correct if the value is mode-independent (e.g., hue slot dispatch, sentinel dispatch).
- Annotated rationale makes the light recipe as self-documenting as the dark recipe.

**Implications:**
- `LIGHT_OVERRIDES` will be a substantial `Partial<DerivationFormulas>` object — likely 100+ fields that differ from `BASE_FORMULAS`.
- `LIGHT_FORMULAS = { ...BASE_FORMULAS, ...LIGHT_OVERRIDES }` is the complete light recipe.
- Fields that are mode-independent (same in dark and light) are intentionally omitted from `LIGHT_OVERRIDES`.

#### [D05] Harmony canvas color is indigo-violet I:3 T:95 (DECIDED) {#d05-canvas-color}

**Decision:** The harmony canvas color in `canvas-color.ts` uses indigo-violet at intensity 3, tone 95 — the light-mode inverse of brio's indigo-violet I:2 T:5.

**Rationale:**
- Same hue family as brio (indigo-violet) maintains palette identity.
- Slightly higher intensity (3 vs 2) because light surfaces benefit from a touch more chroma to avoid looking washed out.
- Tone 95 is the near-white inverse of brio's tone 5 (near-black).

**Implications:**
- `CANVAS_COLORS.harmony = { hue: "indigo-violet", intensity: 3, tone: 95 }`.
- The Swift bridge receives the correct light-mode hex on theme switch.

#### [D06] selectionInactiveSemanticMode false for light recipe (DECIDED) {#d06-selection-mode}

**Decision:** `selectionInactiveSemanticMode` is set to `false` in `LIGHT_OVERRIDES`, enabling the atm-offset path (`atmBaseAngle - 20deg` with warmth bias) for inactive selection in light mode.

**Rationale:**
- In dark mode, the semantic mode uses a named yellow hue for inactive selection — distinct and visible on dark surfaces.
- In light mode, the atm-offset path produces a more natural, desaturated selection that blends with the light canvas.
- The test suite already tests this path (`selectionInactiveSemanticMode: false` in the hue-slot-dispatch test).

**Implications:**
- `LIGHT_OVERRIDES` includes `selectionInactiveSemanticMode: false`.
- `selectionBgInactiveI`, `selectionBgInactiveTone`, and `selectionBgInactiveAlpha` need light-calibrated values.

#### [D07] Pre-fetch harmony CSS in main.tsx async IIFE (DECIDED) {#d07-theme-css-loading}

**Decision:** Harmony CSS is pre-fetched in `main.tsx`'s existing async IIFE (alongside layout/theme/deck-state fetches in `Promise.all`). The fetched CSS string is stored in `themeCSSMap` before `applyInitialTheme()` is called. `setTheme()` remains synchronous — it reads from the already-populated `themeCSSMap`.

**Rationale:**
- `main.tsx` already uses an async IIFE with `Promise.all` to fetch layout, theme, and deck state before React mounts. Adding a harmony CSS fetch to this parallel batch adds negligible latency.
- Keeping `setTheme()` synchronous avoids flash-of-unstyled-content and preserves the existing API contract.
- `applyInitialTheme()` stays synchronous — it reads from `themeCSSMap` which is populated before the call.

**Implications:**
- `themeCSSMap` needs a setter (e.g., `registerThemeCSS(name, css)`) so `main.tsx` can populate it before `applyInitialTheme()`.
- The harmony CSS fetch runs in parallel with other settings fetches — no serial dependency.
- `setTheme("harmony")` reads the pre-fetched CSS from `themeCSSMap` and calls `injectThemeCSS()`.
- If the fetch fails (e.g., 404), `themeCSSMap.harmony` stays `null` and brio defaults remain active.

#### [D08] Filter built-in themes from saved-themes list (DECIDED) {#d08-filter-builtins}

**Decision:** The `handleThemesList` middleware (or the `loadSavedThemes` consumer) filters out built-in theme names so that `harmony.css` in `styles/themes/` does not appear as both a built-in preset and a user-saved theme.

**Rationale:**
- `generate-tug-tokens.ts` writes `harmony.css` to `styles/themes/`, the same directory that `handleThemesList` reads for user-saved themes.
- Without filtering, harmony would appear in the saved-themes dropdown as well as the built-in preset row.
- Filtering at the consumer (`loadSavedThemes()` or `GalleryThemeGeneratorContent`) is simplest because it doesn't require the middleware to know about built-in theme names.

**Implications:**
- `GalleryThemeGeneratorContent` or `loadSavedThemes()` filters `EXAMPLE_RECIPES` keys from the saved-themes list.
- Future built-in themes are automatically filtered as long as they are in `EXAMPLE_RECIPES`.

---

### Specification {#specification}

#### Token Output Contract {#token-output-contract}

**Spec S01: Harmony CSS File Format** {#s01-harmony-css-format}

The generated `styles/themes/harmony.css` file follows this structure:

```css
/* Generated by generate-tug-tokens.ts — do not edit. */
/* Regenerate: bun run generate:tokens                  */
body {
  /* Background */
  --tug-base-bg-app: <value>;
  --tug-base-bg-canvas: <value>;
  /* ... all 373 tokens in the same group order as tug-base-generated.css */
}
```

All 373 tokens are present. The file is a complete override — when injected as a `<style>` element after `tug-base.css`, every brio default is overridden.

#### Theme Integration Contract {#theme-integration-contract}

**Spec S02: ThemeName and themeCSSMap** {#s02-theme-name}

```typescript
export type ThemeName = "brio" | "harmony";

const themeCSSMap: Record<ThemeName, string | null> = {
  brio: null,      // default — tug-base.css body {} rules
  harmony: null,   // pre-fetched in main.tsx IIFE, populated via registerThemeCSS()
};

/** Populate a built-in theme's CSS before applyInitialTheme(). */
export function registerThemeCSS(name: ThemeName, css: string): void {
  themeCSSMap[name] = css;
}
```

In `main.tsx`, the harmony CSS is fetched in the existing `Promise.all`:

```typescript
const [layout, theme, focusedCardId, harmonyCSS] = await Promise.all([
  fetchLayoutWithRetry(),
  fetchThemeWithRetry(),
  fetchDeckStateWithRetry(),
  fetch("/styles/themes/harmony.css").then(r => r.ok ? r.text() : null).catch(() => null),
]);
if (harmonyCSS) registerThemeCSS("harmony", harmonyCSS);
applyInitialTheme(initialTheme);
```

**Spec S03: Canvas Color Map** {#s03-canvas-color}

```typescript
const CANVAS_COLORS: Record<ThemeName, TugColorParams> = {
  brio:    { hue: "indigo-violet", intensity: 2, tone: 5 },
  harmony: { hue: "indigo-violet", intensity: 3, tone: 95 },
};
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/styles/themes/harmony.css` | Generated harmony token override file (373 tokens) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `LIGHT_OVERRIDES` | const | `theme-derivation-engine.ts` | `Partial<DerivationFormulas>` with all light-polarity fields |
| `LIGHT_FORMULAS` | const | `theme-derivation-engine.ts` | `{ ...BASE_FORMULAS, ...LIGHT_OVERRIDES }` |
| `EXAMPLE_RECIPES.harmony` | object entry | `theme-derivation-engine.ts` | Light recipe with cobalt/violet/indigo palette |
| `ThemeName` | type | `theme-provider.tsx` | Widen to `"brio" \| "harmony"` |
| `themeCSSMap.harmony` | entry | `theme-provider.tsx` | `null` (pre-fetched via `registerThemeCSS`) |
| `registerThemeCSS` | fn | `theme-provider.tsx` | Populates `themeCSSMap` entry before `applyInitialTheme()` |
| `CANVAS_COLORS.harmony` | entry | `canvas-color.ts` | `{ hue: "indigo-violet", intensity: 3, tone: 95 }` |
| `set-theme` handler | action | `action-dispatch.ts` | Widen validation to accept `"harmony"` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify LIGHT_FORMULAS composition, token count, canvas color hex | Core formula logic |
| **Integration** | Contrast validation across all 373 harmony tokens | Full pipeline: recipe -> derive -> validate |
| **Drift Prevention** | Ensure brio output unchanged after harmony addition | Regression guard |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Define LIGHT_OVERRIDES and LIGHT_FORMULAS {#step-1}

**Commit:** `feat(theme): define LIGHT_OVERRIDES and LIGHT_FORMULAS with annotated design rationale`

**References:** [D04] LIGHT_OVERRIDES covers all 23 semantic groups, [D06] selectionInactiveSemanticMode false, (#context, #assumptions, #strategy)

**Artifacts:**
- `LIGHT_OVERRIDES: Partial<DerivationFormulas>` in `theme-derivation-engine.ts`
- `LIGHT_FORMULAS: DerivationFormulas` in `theme-derivation-engine.ts`

**Tasks:**
- [ ] Define `LIGHT_OVERRIDES` by walking every semantic decision group in `DARK_FORMULAS` and determining the light-polarity value for each field. For each field, write an inline comment explaining the design rationale (mirroring the dark recipe annotation style). Note: these are initial best-estimate values; Step 3 will refine them through contrast validation feedback.
- [ ] Key polarity inversions to apply (per roadmap table and assumptions):
  - Canvas darkness: bgAppTone 95, bgCanvasTone 95 (near-white).
  - Surface layering: 85-95 range (light steps, inverted visual order).
  - Text brightness: fgDefaultTone 8 (near-black), fgInverseTone 94 (near-white).
  - Text hierarchy: ascending from 8: muted ~34, subtle ~52, disabled ~68, placeholder ~60.
  - Surface coloring: slightly more chroma than dark (I 3-8).
  - Text coloring: slightly more chroma (I 3-8).
  - Border visibility: crisp borders (I 8-10, higher on light backgrounds).
  - Card frame: bright tones 85-92.
  - Shadow depth: lighter alphas (10-40%).
  - Filled control prominence: same vivid approach (mid-tone bg, white fg).
  - Outlined/ghost control style: use light-mode tone fields.
  - Badge style: adjusted for light backgrounds.
  - Selection mode: `selectionInactiveSemanticMode: false`.
- [ ] Define `LIGHT_FORMULAS = { ...BASE_FORMULAS, ...LIGHT_OVERRIDES }`.
- [ ] Export both constants.

**Tests:**
- [ ] Verify `LIGHT_FORMULAS` has all required keys of `DerivationFormulas` (TypeScript compilation check).
- [ ] Verify `deriveTheme({ ...EXAMPLE_RECIPES.brio, mode: "light", formulas: LIGHT_FORMULAS })` produces 373 tokens without runtime errors.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no errors.
- [ ] Quick manual verification: the derived token count equals 373.

---

#### Step 2: Create EXAMPLE_RECIPES.harmony {#step-2}

**Depends on:** #step-1

**Commit:** `feat(theme): add EXAMPLE_RECIPES.harmony light recipe`

**References:** [D04] LIGHT_OVERRIDES scope, [D03] Preset preview-only, (#strategy, #scope)

**Artifacts:**
- `EXAMPLE_RECIPES.harmony` entry in `theme-derivation-engine.ts`

**Tasks:**
- [ ] Add `harmony` to `EXAMPLE_RECIPES` as a peer of `brio`:
  ```typescript
  harmony: {
    name: "harmony",
    mode: "light",
    description: "Bright, open canvas with crisp surfaces. Dark text for maximum readability with clear hierarchy. Filled controls use vivid accent backgrounds with white text. Borders are crisp and visible. Shadows are light. Industrial warmth with muted chassis and vivid signals — the same palette as Brio, seen in daylight.",
    cardBg: { hue: "indigo-violet" },
    text: { hue: "cobalt" },
    link: "cyan",
    canvas: "indigo-violet",
    cardFrame: "indigo",
    borderTint: "indigo-violet",
    formulas: { ...BASE_FORMULAS, ...LIGHT_OVERRIDES },
  }
  ```
- [ ] Verify the harmony entry uses the same hue palette fields as brio (same palette, different recipe).

**Tests:**
- [ ] `deriveTheme(EXAMPLE_RECIPES.harmony)` returns 373 tokens.
- [ ] `deriveTheme(EXAMPLE_RECIPES.brio)` still returns 373 tokens (no regression).

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes.
- [ ] Both `deriveTheme(EXAMPLE_RECIPES.brio)` and `deriveTheme(EXAMPLE_RECIPES.harmony)` produce 373 tokens (verified via test run or script).

---

#### Step 3: Contrast validation — calibrate light formulas to zero exceptions {#step-3}

**Depends on:** #step-2

**Commit:** `feat(theme): calibrate LIGHT_OVERRIDES for zero-exception contrast validation`

**References:** [D04] LIGHT_OVERRIDES scope, (#success-criteria, #r01-formula-calibration)

**Artifacts:**
- Refined values in `LIGHT_OVERRIDES` that pass all contrast pairings.
- Updated `LIGHT_MODE_PAIR_EXCEPTIONS` (target: empty set or removed).
- Updated `KNOWN_PAIR_EXCEPTIONS` in test files if harmony eliminates previously-known light-mode issues.

**Tasks:**
- [ ] Run the contrast validation suite against `EXAMPLE_RECIPES.harmony` and collect all failures.
- [ ] For each failure, identify the semantic decision group responsible and adjust the relevant `LIGHT_OVERRIDES` field(s).
- [ ] Iterate until all 373 tokens pass with zero unexpected failures.
- [ ] Review `LIGHT_MODE_PAIR_EXCEPTIONS` in `src/__tests__/theme-derivation-engine.test.ts` (near line 711) — if all pairs now pass, remove the exception set or reduce it.
- [ ] Review `KNOWN_PAIR_EXCEPTIONS` in `src/__tests__/theme-derivation-engine.test.ts` (near line 570) — verify dark-mode exceptions are unchanged and no new light-mode entries are needed.
- [ ] Review `KNOWN_PAIR_EXCEPTIONS` in `src/__tests__/gallery-theme-generator-content.test.tsx` (near line 160) — remove any light-mode entries that are no longer needed now that `LIGHT_OVERRIDES` provides proper calibration.
- [ ] Ensure brio contrast validation is unchanged (no regressions).

**Tests:**
- [ ] Harmony contrast validation: zero unexpected failures across all contrast roles (body-text, ui-component, decorative, focus-indicator).
- [ ] Brio contrast validation: same results as before (existing exceptions unchanged).

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all contrast tests pass.
- [ ] Harmony has zero entries in any `LIGHT_MODE_PAIR_EXCEPTIONS` set.

---

#### Step 4: Update generate-tug-tokens.ts for harmony output {#step-4}

**Depends on:** #step-2

**Commit:** `feat(theme): generate harmony.css alongside brio tokens`

**References:** [D01] Standalone override file, Spec S01, (#scope)

**Artifacts:**
- Modified `tugdeck/scripts/generate-tug-tokens.ts`
- Generated `tugdeck/styles/themes/harmony.css`

**Tasks:**
- [ ] After generating brio tokens (existing logic), iterate over non-brio entries in `EXAMPLE_RECIPES`.
- [ ] For each non-brio recipe, call `deriveTheme()` and write a standalone CSS file to `styles/themes/<name>.css`.
- [ ] Reuse the existing token grouping and formatting logic (extract into a shared function if needed).
- [ ] The harmony CSS file must have the same `body {}` wrapper and group ordering as `tug-base-generated.css`.
- [ ] Log the token count and output path for each generated file.

**Tests:**
- [ ] Run `bun run generate:tokens` and verify `styles/themes/harmony.css` is created.
- [ ] Verify the harmony CSS file contains exactly 373 token declarations.
- [ ] Verify `styles/tug-base-generated.css` is unchanged (brio output not affected).

**Checkpoint:**
- [ ] `cd tugdeck && bun run generate:tokens` succeeds and reports both files.
- [ ] `wc -l styles/themes/harmony.css` shows a reasonable line count (similar to `tug-base-generated.css`).

---

#### Step 5: Widen ThemeName, update theme-provider.tsx, canvas-color.ts, and main.tsx {#step-5}

**Depends on:** #step-4

**Commit:** `feat(theme): widen ThemeName to include harmony, pre-fetch CSS, update canvas color`

**References:** [D02] First-class static ThemeName, [D05] Harmony canvas color, [D07] Pre-fetch in main.tsx IIFE, [D08] Filter built-ins, Spec S02, Spec S03, (#scope)

**Artifacts:**
- Modified `tugdeck/src/contexts/theme-provider.tsx`
- Modified `tugdeck/src/canvas-color.ts`
- Modified `tugdeck/src/main.tsx`
- Modified `tugdeck/src/action-dispatch.ts`

**Tasks:**
- [ ] Widen `ThemeName` type to `"brio" | "harmony"` in `theme-provider.tsx`.
- [ ] Add `harmony: null` to `themeCSSMap`.
- [ ] Export `registerThemeCSS(name: ThemeName, css: string)` so `main.tsx` can populate `themeCSSMap` before `applyInitialTheme()`.
- [ ] `setTheme()` remains synchronous: for non-brio themes, read from `themeCSSMap[newTheme]`; if non-null, call `injectThemeCSS()`; if null, remove override (graceful fallback to brio).
- [ ] `setTheme()` must also clear dynamic theme state when switching to a built-in theme: call `setDynamicThemeName(null)` and remove `td-dynamic-theme` from localStorage. This prevents a stale dynamic theme from overriding the user's built-in theme selection on next page load (the mount-time check reads `td-dynamic-theme` first). Note: React 19 automatically batches the `setDynamicThemeName(null)` and `setThemeState(newTheme)` updates into a single render — no manual batching needed.
- [ ] `applyInitialTheme()` remains synchronous: read from `themeCSSMap[newTheme]` and inject if non-null.
- [ ] Update `revertToBuiltIn()` to re-apply the current built-in theme's CSS instead of unconditionally removing all overrides. The current implementation has an empty `useCallback` dependency array and no access to the `theme` state. Fix: add `theme` to the dependency array so the callback reads the active built-in theme. When the active built-in is harmony, clear the dynamic theme state and then re-inject harmony's CSS from `themeCSSMap` via `injectThemeCSS()`. When the active built-in is brio, call `removeThemeCSS()` as before. React 19 batches the `setDynamicThemeName(null)` state update with any parent re-renders, so no intermediate flash occurs.
- [ ] In `main.tsx`, add harmony CSS fetch to the existing `Promise.all` batch:
  ```typescript
  const [layout, theme, focusedCardId, harmonyCSS] = await Promise.all([
    fetchLayoutWithRetry(),
    fetchThemeWithRetry(),
    fetchDeckStateWithRetry(),
    fetch("/styles/themes/harmony.css").then(r => r.ok ? r.text() : null).catch(() => null),
  ]);
  if (harmonyCSS) registerThemeCSS("harmony", harmonyCSS);
  ```
- [ ] Update the `set-theme` action handler in `action-dispatch.ts` (line 173): change the validation from hardcoded `["brio"]` to `["brio", "harmony"]`, or derive valid theme names from the `ThemeName` type. The Swift app already has a Harmony menu item (`AppDelegate.swift` line 311) that sends `set-theme` with `theme: "harmony"` — without this fix, harmony selection from the Mac menu would silently fail.
- [ ] Add `harmony: { hue: "indigo-violet", intensity: 3, tone: 95 }` to `CANVAS_COLORS` in `canvas-color.ts`.
- [ ] Update module JSDoc in `canvas-color.ts` to document the harmony canvas color params.
- [ ] In `gallery-theme-generator-content.tsx` or `loadSavedThemes()`, filter `Object.keys(EXAMPLE_RECIPES)` from the saved-themes list so harmony does not appear as both a built-in preset and a user-saved theme. Note: the saved-themes dropdown has a hardcoded "Brio (default)" option; adding harmony as a second built-in option in that dropdown is out of scope — document as a follow-on.
- [ ] Accepted limitation: `handleSelectBuiltIn()` in `gallery-theme-generator-content.tsx` hardcodes `loadPreset("brio")`. This means the "Revert to Built-In" action in the Theme Generator always loads the brio recipe into the preview, even when the app-level built-in theme is harmony. This is acceptable because the Theme Generator preview is independent of the app-level theme — the preset buttons already let the user load harmony's recipe explicitly. Fixing this to be context-aware is a follow-on.
- [ ] Update JSDoc comments in `theme-provider.tsx` to reflect that harmony is a supported built-in theme.

**Tests:**
- [ ] TypeScript compilation passes with `ThemeName = "brio" | "harmony"` — no type errors in `canvas-color.ts`, `theme-provider.tsx`, `main.tsx`, or `action-dispatch.ts`.
- [ ] `canvasColorHex("harmony")` returns a hex string that represents a near-white color.
- [ ] `canvasColorHex("brio")` returns the same value as before (no regression).
- [ ] `setTheme("harmony")` reads pre-fetched CSS, injects the override stylesheet, and clears dynamic theme state.
- [ ] `setTheme("brio")` removes the override stylesheet and clears dynamic theme state (existing behavior preserved).
- [ ] `applyInitialTheme("harmony")` correctly injects harmony CSS when `themeCSSMap.harmony` is populated.
- [ ] `revertToBuiltIn()` when active built-in is harmony: re-injects harmony CSS (does not fall back to brio).
- [ ] `set-theme` action handler accepts `"harmony"` and routes it to `setTheme("harmony")`.

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with zero errors.
- [ ] `cd tugdeck && bun test` passes (theme-provider and canvas-color tests).

---

#### Step 6: Integration Checkpoint — Full Pipeline Verification {#step-6}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Standalone override file, [D02] Static ThemeName, [D04] LIGHT_OVERRIDES scope, [D05] Canvas color, [D07] Pre-fetch CSS, [D08] Filter built-ins, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify the full pipeline: `LIGHT_OVERRIDES` -> `LIGHT_FORMULAS` -> `EXAMPLE_RECIPES.harmony` -> `deriveTheme()` -> 373 tokens -> contrast validation passes.
- [ ] Verify `bun run generate:tokens` produces both output files.
- [ ] Verify `ThemeName` type includes harmony and all type-dependent code compiles.
- [ ] Verify `canvasColorHex("harmony")` returns a valid light-mode hex.
- [ ] Verify the Theme Generator card renders a "Harmony" preset button (from `Object.keys(EXAMPLE_RECIPES)` iteration — no code change needed).
- [ ] Verify `setTheme("harmony")` injects the override stylesheet, clears dynamic theme state, and `setTheme("brio")` reverts.
- [ ] Verify `revertToBuiltIn()` correctly re-applies harmony CSS when harmony is the active built-in theme.
- [ ] Verify the Mac menu's Harmony item works end-to-end: `set-theme` action handler accepts `"harmony"`.
- [ ] Verify harmony does not appear in the saved-themes dropdown (filtered by [D08]).

**Tests:**
- [ ] Full test suite passes: `cd tugdeck && bun test`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — zero failures.
- [ ] `cd tugdeck && bun run generate:tokens` — both files generated.
- [ ] `cd tugdeck && bunx tsc --noEmit` — zero type errors.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A working Harmony light theme that is a full peer of Brio — `LIGHT_FORMULAS` / `LIGHT_OVERRIDES` defined with annotated design rationale, 373 tokens produced with zero contrast exceptions, hot-swappable from the theme menu, and appearing as a preset in the Theme Generator card.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `LIGHT_OVERRIDES` and `LIGHT_FORMULAS` are exported from `theme-derivation-engine.ts` with full annotated rationale.
- [ ] `EXAMPLE_RECIPES.harmony` exists as a peer of `EXAMPLE_RECIPES.brio` with `mode: "light"`.
- [ ] `bun run generate:tokens` produces `styles/themes/harmony.css` with 373 tokens.
- [ ] All 373 harmony tokens pass contrast validation with zero unexpected failures (`bun test`).
- [ ] `ThemeName` includes `"harmony"`; `themeCSSMap`, `canvas-color.ts`, and `action-dispatch.ts` are updated.
- [ ] Theme Generator card shows a "Harmony" preset button.
- [ ] Harmony is hot-swappable via `setTheme("harmony")` / `applyInitialTheme("harmony")` and from the Mac menu.
- [ ] `setTheme()` clears dynamic theme state; `revertToBuiltIn()` correctly re-applies the active built-in theme.
- [ ] All existing brio tests pass without regression.

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` — all tests pass, including contrast validation for both brio and harmony.
- [ ] `cd tugdeck && bun run generate:tokens` — produces both brio and harmony token files.
- [ ] `cd tugdeck && bunx tsc --noEmit` — zero type errors.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] LLM-generated recipe flow: prompt -> semantic decisions -> `Partial<DerivationFormulas>` -> complete theme.
- [ ] Additional theme variants: high-contrast dark, high-contrast light, warm, cool.
- [ ] Theme preview thumbnails in the theme menu.
- [ ] Saved-themes dropdown: add harmony as a second built-in option alongside "Brio (default)" in ExportImportPanel.
- [ ] `handleSelectBuiltIn()` in Theme Generator: make context-aware so it loads the active built-in recipe, not hardcoded brio.

| Checkpoint | Verification |
|------------|--------------|
| Light formulas defined | `LIGHT_OVERRIDES` and `LIGHT_FORMULAS` exported, TypeScript compiles |
| Harmony recipe created | `EXAMPLE_RECIPES.harmony` exists, `deriveTheme()` produces 373 tokens |
| Contrast validation | All harmony tokens pass with zero unexpected failures |
| Token generation | `bun run generate:tokens` produces `styles/themes/harmony.css` |
| Theme integration | `ThemeName` includes harmony, `canvas-color.ts` updated, pre-fetch works, hot-swap works |
| Full suite green | `bun test` passes with no regressions |
