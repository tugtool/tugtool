## Tugways Phase 5d5a: Palette Engine {#palette-engine}

**Purpose:** Ship a computed OKLCH color palette with 24 hue families and a continuous 0--100 intensity scale, runtime-injectable as 264 CSS custom properties, with an interactive gallery demo for transfer function curve tuning.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5d5a-palette-engine |
| Last updated | 2026-03-06 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current theme system uses fixed color tokens declared per-theme in CSS files (tokens.css, bluenote.css, harmony.css). There is no computed palette -- every color value is hand-picked. This approach does not scale: adding a new accent shade requires editing every theme file, and there is no way to request "orange at 37% intensity" programmatically. Phase 5d5a introduces a computed palette engine that generates colors on demand from 24 named hue families using OKLCH, replacing fixed swatches with a continuous intensity scale.

The palette engine is a standalone module with no coupling to the responder chain, mutation model, or property store. Its only prerequisite is Phase 5a2 (DeckManager store migration), which is already complete. The engine produces CSS custom properties consumed by downstream phases (5d5c Token Architecture, 5d5d Consumer Migration).

#### Strategy {#strategy}

- Build the palette engine as a pure TypeScript module with zero React dependencies -- it computes oklch strings and injects CSS variables into the DOM.
- Use a smoothstep-based transfer function as the starting point, with the interactive gallery demo enabling runtime comparison of smoothstep, cubic bezier, and piecewise alternatives.
- Hardcode per-hue chroma caps as a constant table derived from empirical sRGB gamut checking -- do not compute gamut boundaries at runtime.
- Inject palette CSS from two call sites: `main.tsx` at boot (before React mount) and `TugThemeProvider.setTheme` on theme switch, keeping all injection co-located with theme injection.
- Add the gallery palette tab as a ninth entry in the existing gallery card tab system, following the exact pattern of the eight existing tabs.
- Keep the module self-contained: no exports beyond the public API surface defined in the specification.

#### Success Criteria (Measurable) {#success-criteria}

- `tugPaletteColor(hueName, intensity)` returns a valid `oklch(...)` string for all 24 hue names and intensity values 0--100 (24 x 101 = 2,424 calls, all returning parseable oklch).
- 264 CSS custom properties (24 hues x 11 standard stops) are present on `document.documentElement` after `injectPaletteCSS()` runs, verified by `getComputedStyle` queries.
- All 264 standard stops produce sRGB-gamut-safe colors (verified by converting each oklch value to sRGB and checking 0 <= r,g,b <= 1).
- Named tone aliases (`soft`, `default`, `strong`, `intense`) resolve to the same oklch value as their numeric equivalents (tone-15, tone-50, tone-75, tone-100).
- Palette injection completes in under 1ms on a modern machine (measured via `performance.now()`).
- Theme parameter overrides (hue shifts, L/C anchors) change the computed palette when CSS custom properties are present.
- The gallery palette tab renders all 24 hues across all 11 stops as a visible grid with interactive curve controls.

#### Scope {#scope}

1. `palette-engine.ts` module: hue table, transfer function, `tugPaletteColor()`, `tugPaletteVarName()`, chroma caps, `injectPaletteCSS()`, theme parameter reading.
2. Named tone aliases (soft/default/strong/intense) injected alongside numeric stops.
3. Boot-time and theme-switch injection call sites in `main.tsx` and `theme-provider.tsx`.
4. Gallery palette tab: ninth tab in GALLERY_DEFAULT_TABS, interactive curve tuning controls, side-by-side comparison.
5. Gallery palette CSS styles.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Token architecture migration (`--tug-base-*`, `--tug-comp-*`) -- that is Phase 5d5c.
- Consumer migration from `--td-*`/`--tways-*` tokens -- that is Phase 5d5d.
- Global scale (`--tug-scale`) or timing (`--tug-timing`) systems -- that is Phase 5d5b.
- Dark-theme-specific L/C curves -- deferred to a follow-on. The current proposal uses a single curve for all themes; themes adjust via parameter overrides.
- P3 wide-gamut display optimization -- palette is clamped to sRGB for this phase.

#### Dependencies / Prerequisites {#dependencies}

- Phase 5a2 (DeckManager Store Migration) is complete -- `deck-manager-store.ts`, `useSyncExternalStore` usage, and `IDeckManagerStore` exist in the codebase.
- Existing theme infrastructure: `TugThemeProvider`, `injectThemeCSS()`, `applyInitialTheme()` in `tugdeck/src/contexts/theme-provider.tsx`.
- Gallery card system: `gallery-card.tsx`, `registerGalleryCards()`, `GALLERY_DEFAULT_TABS` with eight existing tabs.

#### Constraints {#constraints}

- All appearance changes go through CSS and DOM, never React state ([D08], [D09]).
- No `root.render()` calls after initial mount ([D40], [D42]).
- Palette injection must be synchronous and complete before the first React render at boot.
- CSS variable names must follow the format `--tug-palette-hue-<angle>-<name>-tone-<intensity>` for forward compatibility with Phase 5d5c token architecture.
- Per-hue chroma caps must prevent sRGB gamut clipping on all standard stops.

#### Assumptions {#assumptions}

- The 24 hue name-to-angle table from the theme overhaul proposal is used as-is (cherry=10 through berry=355).
- The smoothstep transfer function anchors (L_MAX=0.96, L_MIN=0.42, C_MIN=0.01, C_MAX=0.22) are the starting point; the implementer adjusts after gamut-checking all 24 hues.
- Named tone aliases map to fixed intensities: soft=15, default=50, strong=75, intense=100.
- Per-hue chroma caps are hardcoded as a TypeScript constant table, not derived dynamically.
- Theme parameter CSS properties are read via `getComputedStyle(document.body)` with fallbacks when absent.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

See skeleton for full conventions. This plan uses `step-N` anchors for execution steps, `dNN-slug` anchors for design decisions, `sNN-slug` anchors for specs, `tNN-slug` anchors for tables, and `lNN-slug` anchors for lists.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Dark theme L/C curve (OPEN) {#q01-dark-theme-curve}

**Question:** Should dark themes use a different (possibly inverted) L/C curve so that intensity-0 is dark and intensity-100 is light?

**Why it matters:** If dark themes share the same curve, low-intensity palette colors may have poor contrast against dark backgrounds.

**Options (if known):**
- Invert the L curve for dark themes (L_MIN and L_MAX swap).
- Use theme parameter overrides to narrow the L range without inverting.
- Defer and let themes adjust via per-theme parameter overrides.

**Plan to resolve:** Defer to Phase 5d5c when the token architecture integrates palette variables with theme-specific semantic tokens. The parameter override mechanism built in this phase supports either approach.

**Resolution:** DEFERRED (the palette engine supports per-theme L/C parameter overrides; the specific dark-theme curve will be determined when Bluenote and Harmony adopt palette tokens in Phase 5d5c)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| OKLCH gamut clipping at high chroma | med | high | Per-hue chroma cap table | Any standard stop fails sRGB gamut check |
| Transfer function produces perceptual dead zones | med | med | Interactive gallery demo for curve comparison | Designer feedback during tuning |
| 264-variable injection causes style recalc jank | low | low | Batch into single `<style>` element; measure < 1ms | Perf measurement exceeds threshold |

**Risk R01: OKLCH gamut clipping** {#r01-gamut-clipping}

- **Risk:** OKLCH can produce out-of-sRGB-gamut colors at high chroma, especially for yellows and greens.
- **Mitigation:** Hardcode a `MAX_CHROMA` table with empirically validated per-hue caps. The implementer must gamut-check all 24 hues at all 11 standard stops before closing this step.
- **Residual risk:** Edge-case intensities between standard stops could still clip if chroma interpolation overshoots. The `tugPaletteColor()` function must apply the same cap for arbitrary intensities.

**Risk R02: Transfer function quality** {#r02-transfer-function}

- **Risk:** The smoothstep curve may produce dead zones (ranges where intensity changes produce no visible color difference) or jumps (abrupt color shifts between adjacent stops).
- **Mitigation:** The interactive gallery demo supports comparing smoothstep, cubic bezier, and piecewise curves side by side. The implementer tunes the curve using the demo before closing the phase.
- **Residual risk:** Subjective quality depends on viewing conditions and individual perception. The curve is tunable via theme parameters for post-ship adjustment.

---

### Design Decisions {#design-decisions}

#### [D01] Smoothstep transfer function as default curve (DECIDED) {#d01-smoothstep-default}

**Decision:** The default transfer function uses a smoothstep ease (`t * t * (3 - 2 * t)`) mapping intensity 0--100 to OKLCH L and C, with configurable anchor points.

**Rationale:**
- Smoothstep compresses the extremes and expands the midrange (30--70), matching how designers typically work.
- The function is simple, cheap to compute, and well-understood.
- Alternative curves (bezier, piecewise) are available via the gallery demo for comparison but are not the default.

**Implications:**
- The transfer function signature takes `(intensity: number, params: LCParams) => { L: number; C: number }` so alternative curves can be swapped in.
- Theme parameters can shift the anchor points (L_MAX, L_MIN, C_MAX, C_MIN) without changing the curve shape.

#### [D02] Per-hue chroma caps as static constant table (DECIDED) {#d02-static-chroma-caps}

**Decision:** Per-hue maximum chroma values are hardcoded in a `MAX_CHROMA_FOR_HUE` TypeScript constant table, not computed at runtime.

**Rationale:**
- Runtime gamut computation would require an OKLCH-to-sRGB conversion loop on every injection, adding latency.
- The chroma caps are stable: they depend on the sRGB gamut boundary in OKLCH space, which does not change.
- A static table is simpler to audit, test, and override per-theme.

**Implications:**
- The implementer must empirically determine each hue's max chroma at L_MIN (the most constrained lightness) and store it in the table.
- `tugPaletteColor()` clamps chroma to `min(computedC, MAX_CHROMA_FOR_HUE[hue])` before returning the oklch string.

#### [D03] Palette injection via dedicated style element (DECIDED) {#d03-style-element-injection}

**Decision:** Palette CSS variables are injected into a `<style id="tug-palette">` element appended to `<head>`, separate from the theme override element.

**Rationale:**
- Keeping palette injection separate from theme injection (`<style id="tug-theme-override">`) allows each to be updated independently.
- The palette element is always present (never removed), unlike the theme override which is removed when reverting to Brio.
- Appending to `<head>` ensures correct cascade ordering.

**Implications:**
- `injectPaletteCSS()` creates or replaces the element's `textContent` with all 264+24 CSS variable declarations.
- Theme switch calls `injectPaletteCSS(themeName)` after `injectThemeCSS()` to pick up any theme parameter overrides.

#### [D04] Two injection call sites: boot and theme switch (DECIDED) {#d04-injection-call-sites}

**Decision:** Palette injection is called from two places: (1) `main.tsx` calls `injectPaletteCSS(currentTheme)` immediately after `applyInitialTheme()`, and (2) `TugThemeProvider.setTheme()` calls `injectPaletteCSS(newTheme)` immediately after `injectThemeCSS()`.

**Rationale:**
- Boot-time injection ensures palette variables are available before React mounts, preventing FOUC.
- Theme-switch injection ensures palette variables update to reflect theme parameter overrides.
- Placing both calls adjacent to existing theme injection keeps all injection logic co-located.

**Implications:**
- `injectPaletteCSS()` must be a pure function of theme name: it reads theme parameters from the DOM (via `getComputedStyle`) and computes palette variables accordingly.
- The boot call must happen after `applyInitialTheme()` so that theme parameter CSS properties are in the DOM when `getComputedStyle` reads them.

#### [D05] Named tone aliases as additional CSS variables (DECIDED) {#d05-tone-aliases}

**Decision:** Named tones (soft=15, default=50, strong=75, intense=100) are injected as CSS variable aliases pointing to the same oklch value as the corresponding numeric stop.

**Rationale:**
- Aliases make code more readable: `var(--tug-palette-hue-25-red-soft)` vs `var(--tug-palette-hue-25-red-tone-15)`.
- Aliases are zero-cost: they are additional lines in the same injected `<style>` element.
- The numeric stops remain the canonical reference; aliases are convenience.

**Implications:**
- Each hue gets 4 alias variables in addition to the 11 numeric stops, for a total of 15 variables per hue (360 total = 264 numeric + 96 aliases).
- Alias variable names follow the pattern `--tug-palette-hue-<angle>-<name>-<alias>` (e.g., `--tug-palette-hue-25-red-soft`).

#### [D06] Gallery palette tab follows existing gallery card pattern (DECIDED) {#d06-gallery-tab-pattern}

**Decision:** The palette gallery demo is added as a ninth tab entry in `GALLERY_DEFAULT_TABS` with a corresponding `registerCard()` call in `registerGalleryCards()`, following the exact pattern of the eight existing tabs.

**Rationale:**
- The gallery card system is well-established with a consistent registration pattern.
- Adding a ninth tab requires only a new content component, a new entry in `GALLERY_DEFAULT_TABS`, and a new `registerCard()` block.

**Implications:**
- A new `GalleryPaletteContent` component is created (either in `gallery-card.tsx` or in a separate file imported by it).
- The content component uses local `useState` for interactive controls (curve type, anchor sliders) -- this is local component state, not external store state.

---

### Deep Dives (Optional) {#deep-dives}

#### Transfer Function Design {#transfer-function-design}

The transfer function maps intensity (0--100) to OKLCH lightness (L) and chroma (C). The default smoothstep curve uses four anchor points:

| Anchor | Default Value | CSS Override Property |
|--------|--------------|----------------------|
| L_MAX (intensity 0) | 0.96 | `--tug-theme-lc-l-max` |
| L_MIN (intensity 100) | 0.42 | `--tug-theme-lc-l-min` |
| C_MIN (intensity 0) | 0.01 | `--tug-theme-lc-c-min` |
| C_MAX (intensity 100) | 0.22 | `--tug-theme-lc-c-max` |

At intensity 0, the color is a near-white wash (high L, near-zero C). At intensity 50, it is a balanced midtone (L approximately 0.70, C approximately 0.11). At intensity 100, it is deep and saturated (low L, high C).

The smoothstep compresses the extremes and expands the midrange. For the gallery demo, two alternative curves are also implemented for comparison:

1. **Cubic bezier**: a single cubic with configurable control points, giving more shape freedom.
2. **Piecewise linear**: two segments with a breakpoint, giving sharp control over where the transition changes character.

#### Theme Parameter Protocol {#theme-parameter-protocol}

Themes can override palette behavior by declaring CSS custom properties consumed by the palette engine at injection time:

- `--tug-theme-lc-l-max`, `--tug-theme-lc-l-min`: L anchor overrides.
- `--tug-theme-lc-c-max`, `--tug-theme-lc-c-min`: C anchor overrides.
- `--tug-theme-hue-<name>` (e.g., `--tug-theme-hue-red`): per-hue angle overrides.

The palette engine reads these from `getComputedStyle(document.body)` after the theme stylesheet has been injected. If a property is absent, the engine falls back to the hardcoded default. This allows themes to shift hue angles (e.g., Bluenote shifts "orange" warmer) or adjust contrast (e.g., Harmony narrows the L range).

---

### Specification {#specification}

#### Public API Surface {#public-api}

**Spec S01: Core palette functions** {#s01-core-functions}

```typescript
/** 24 hue family names mapped to OKLCH hue angles. */
export const HUE_FAMILIES: Record<string, number>;

/** Per-hue maximum chroma for sRGB gamut safety. */
export const MAX_CHROMA_FOR_HUE: Record<string, number>;

/** Transfer function anchor parameters. */
export interface LCParams {
  lMax: number;  // L at intensity 0
  lMin: number;  // L at intensity 100
  cMin: number;  // C at intensity 0
  cMax: number;  // C at intensity 100
}

/** Default anchor parameters. */
export const DEFAULT_LC_PARAMS: LCParams;

/** Named tone alias mappings. */
export const TONE_ALIASES: Record<string, number>;
// { soft: 15, default: 50, strong: 75, intense: 100 }

/**
 * Compute an oklch() CSS color string for a given hue and intensity.
 * Clamps intensity to [0, 100]. Applies per-hue chroma cap.
 * Uses the default smoothstep transfer function internally.
 */
export function tugPaletteColor(hueName: string, intensity: number, params?: LCParams): string;

/**
 * Build a clamped oklch() CSS string from raw L, C, and hue angle.
 * Clamps C to the per-hue maximum from MAX_CHROMA_FOR_HUE.
 * Composable helper: callers supply their own L/C values (e.g., from
 * an alternative transfer function) and get chroma capping + string
 * formatting without reimplementing either.
 */
export function clampedOklchString(hueName: string, L: number, C: number): string;

/**
 * Return the CSS custom property name for a palette color.
 * Format: --tug-palette-hue-<angle>-<name>-tone-<intensity>
 */
export function tugPaletteVarName(hueName: string, intensity: number): string;

/**
 * Inject all 264 standard-stop CSS variables plus 96 named tone aliases
 * into a <style id="tug-palette"> element on <head>.
 * Reads theme parameter overrides from getComputedStyle if available.
 */
export function injectPaletteCSS(themeName: string): void;
```

**Spec S02: CSS variable naming format** {#s02-css-naming}

Numeric stops: `--tug-palette-hue-<angle>-<name>-tone-<intensity>`

Named aliases: `--tug-palette-hue-<angle>-<name>-<alias>`

Examples:
- `--tug-palette-hue-25-red-tone-0` (numeric stop)
- `--tug-palette-hue-25-red-tone-50` (numeric stop)
- `--tug-palette-hue-25-red-soft` (alias for tone-15)
- `--tug-palette-hue-55-orange-default` (alias for tone-50)

**Spec S03: Standard intensity stops** {#s03-standard-stops}

The 11 standard stops are: 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100.

Each of the 24 hues gets 11 numeric stop variables and 4 named alias variables, for 15 variables per hue, 360 variables total.

**Spec S04: Gallery palette tab registration** {#s04-gallery-palette-tab}

The palette demo is registered as `componentId: "gallery-palette"` in the `"developer"` family. It is the ninth entry in `GALLERY_DEFAULT_TABS` with title "Palette Engine".

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/palette-engine.ts` | Core palette engine: hue table, transfer function, chroma caps, injection |
| `tugdeck/src/__tests__/palette-engine.test.ts` | Unit and integration tests for palette engine (bun test, happy-dom via setup-rtl) |
| `tugdeck/src/components/tugways/cards/gallery-palette-content.tsx` | Interactive palette gallery demo content component |
| `tugdeck/src/components/tugways/cards/gallery-palette-content.css` | Styles for the palette gallery demo |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `HUE_FAMILIES` | const | `palette-engine.ts` | Record mapping 24 hue names to OKLCH angles |
| `MAX_CHROMA_FOR_HUE` | const | `palette-engine.ts` | Per-hue chroma cap table |
| `LCParams` | interface | `palette-engine.ts` | Transfer function anchor parameters |
| `DEFAULT_LC_PARAMS` | const | `palette-engine.ts` | Default L/C anchors |
| `TONE_ALIASES` | const | `palette-engine.ts` | Named tone to intensity mapping |
| `oklchToLinearSRGB` | fn (private) | `palette-engine.ts` | OKLCH to linear sRGB conversion for gamut validation (not exported) |
| `tugPaletteColor` | fn | `palette-engine.ts` | Compute oklch string for hue + intensity (uses smoothstep internally) |
| `clampedOklchString` | fn | `palette-engine.ts` | Build clamped oklch string from raw L/C values (composable helper for alternative curves) |
| `tugPaletteVarName` | fn | `palette-engine.ts` | Return CSS variable name |
| `injectPaletteCSS` | fn | `palette-engine.ts` | Inject all palette CSS variables into DOM |
| `GalleryPaletteContent` | component | `gallery-palette-content.tsx` | Interactive palette demo with curve controls |
| `GALLERY_DEFAULT_TABS` | const (modified) | `gallery-card.tsx` | Add ninth palette tab entry |
| `registerGalleryCards` | fn (modified) | `gallery-card.tsx` | Add gallery-palette registration |
| `applyInitialTheme` (call site) | fn (modified) | `main.tsx` | Add `injectPaletteCSS()` call after theme injection |
| `setTheme` (call site) | fn (modified) | `theme-provider.tsx` | Add `injectPaletteCSS()` call after `injectThemeCSS()` |

---

### Documentation Plan {#documentation-plan}

- [ ] Add JSDoc comments to all exported symbols in `palette-engine.ts`
- [ ] Document the hue table and transfer function in module-level comment
- [ ] Add inline comments explaining chroma cap derivation methodology

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test transfer function math, chroma capping, CSS variable name generation | Core palette-engine.ts logic |
| **Integration** | Test CSS injection, theme parameter override reading, gallery rendering | DOM-dependent behavior |
| **Golden / Contract** | Verify all 264 standard stop oklch values against known-good snapshot | Regression protection for palette output |
| **Drift Prevention** | Verify CSS variable naming format stays consistent | API stability for downstream consumers |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Core palette engine module {#step-1}

**Commit:** `feat(palette): add palette-engine.ts with hue table, transfer function, and chroma caps`

**References:** [D01] smoothstep transfer function, [D02] static chroma caps, Spec S01, Spec S02, Spec S03, (#public-api, #transfer-function-design, #context, #strategy)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/palette-engine.ts`
- New file: `tugdeck/src/__tests__/palette-engine.test.ts` (unit and integration tests; imports `./setup-rtl` first, then `bun:test`, following the project convention for tests that need DOM globals)

**Tasks:**
- [ ] Create `palette-engine.ts` with `HUE_FAMILIES` constant mapping all 24 hue names to OKLCH angles (cherry=10 through berry=355)
- [ ] Implement `DEFAULT_LC_PARAMS` with starting anchors: L_MAX=0.96, L_MIN=0.42, C_MIN=0.01, C_MAX=0.22
- [ ] Implement `smoothstep(t)` helper: `t * t * (3 - 2 * t)`
- [ ] Implement `intensityToLC(intensity, params?)` returning `{ L, C }` using smoothstep curve
- [ ] Implement a private `oklchToLinearSRGB(L, C, h)` helper in `palette-engine.ts` for gamut validation. The conversion follows the standard three-step pipeline: (1) OKLCH polar to OKLab Cartesian (`a = C * cos(h)`, `b = C * sin(h)`), (2) OKLab to linear RGB via the published 3x3 matrix transform (OKLab -> LMS via inverse matrix, cube each component, LMS -> linear sRGB via second matrix), (3) check that all three linear RGB components are in [0, 1]. Use the matrix coefficients from Bjorn Ottosson's canonical OKLab specification (https://bottosson.github.io/posts/oklab/). This helper is not exported -- it is used internally for chroma cap derivation and by tests for gamut safety assertions
- [ ] Implement `MAX_CHROMA_FOR_HUE` constant table with empirically determined per-hue chroma caps for sRGB safety. Derive each cap by using `oklchToLinearSRGB` to find the maximum chroma at L_MIN (the most constrained lightness) for each hue angle where all three sRGB channels remain in [0, 1]
- [ ] Implement `clampedOklchString(hueName, L, C)` that applies `min(C, MAX_CHROMA_FOR_HUE[hueName])` and returns the formatted `oklch(L C hueAngle)` string. This is the composable helper that `tugPaletteColor` delegates to, and that the gallery demo uses directly for alternative curve types
- [ ] Implement `tugPaletteColor(hueName, intensity, params?)` that calls `intensityToLC` with the smoothstep curve, then delegates to `clampedOklchString` for capping and formatting
- [ ] Implement `tugPaletteVarName(hueName, intensity)` returning `--tug-palette-hue-<angle>-<name>-tone-<intensity>`
- [ ] Implement `TONE_ALIASES` constant: `{ soft: 15, default: 50, strong: 75, intense: 100 }`
- [ ] Gamut-check all 24 hues at all 11 standard stops using `oklchToLinearSRGB`: verify 0 <= r,g,b <= 1 for each stop; adjust chroma caps as needed

**Tests:**
- [ ] `tugPaletteColor('red', 0)` returns oklch string with L near 0.96 and C near 0.01
- [ ] `tugPaletteColor('red', 100)` returns oklch string with L near 0.42 and C capped by MAX_CHROMA_FOR_HUE['red']
- [ ] `tugPaletteColor('yellow', 100)` has lower chroma than `tugPaletteColor('blue', 100)` due to per-hue caps
- [ ] `tugPaletteVarName('red', 50)` returns `--tug-palette-hue-25-red-tone-50`
- [ ] Intensity values outside 0--100 are clamped (negative becomes 0, over 100 becomes 100)
- [ ] All 24 hues x 11 stops produce valid sRGB-safe oklch values

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no type errors
- [ ] `cd tugdeck && bun test src/__tests__/palette-engine.test.ts` -- unit tests for `tugPaletteColor`, `tugPaletteVarName`, and chroma capping all pass

---

#### Step 2: CSS injection function {#step-2}

**Depends on:** #step-1

**Commit:** `feat(palette): add injectPaletteCSS with 360 CSS variable injection`

**References:** [D03] style element injection, [D05] tone aliases, Spec S01, Spec S02, Spec S03, (#theme-parameter-protocol, #public-api)

**Artifacts:**
- Modified file: `tugdeck/src/components/tugways/palette-engine.ts` (add `injectPaletteCSS`)

**Tasks:**
- [ ] Implement `readThemeParams(themeName)` helper that reads `--tug-theme-lc-l-max`, `--tug-theme-lc-l-min`, `--tug-theme-lc-c-max`, `--tug-theme-lc-c-min`, and `--tug-theme-hue-<name>` from `getComputedStyle(document.body)`, falling back to defaults when properties are absent
- [ ] Implement `injectPaletteCSS(themeName)` that:
  - Reads theme parameter overrides via `readThemeParams()`
  - Computes all 264 standard-stop oklch values (24 hues x 11 stops)
  - Computes 96 named tone alias values (24 hues x 4 aliases)
  - Builds a CSS string with `:root { ... }` containing all 360 variable declarations
  - Creates or replaces `<style id="tug-palette">` element appended to `<head>`
- [ ] Ensure `injectPaletteCSS` is idempotent: calling it multiple times replaces content, does not create duplicate elements

**Tests:**
- [ ] After `injectPaletteCSS('brio')`, `document.getElementById('tug-palette')!.textContent` contains `--tug-palette-hue-25-red-tone-50:` with an oklch value (happy-dom does not compute cascade from injected `<style>` elements, so verify via textContent string matching rather than `getComputedStyle`)
- [ ] After injection, the style element textContent contains all 264 numeric stop variable declarations (spot-check first and last hue at stops 0, 50, 100)
- [ ] After injection, the style element textContent contains `--tug-palette-hue-25-red-soft:` with the same oklch value as `--tug-palette-hue-25-red-tone-15:`
- [ ] Calling `injectPaletteCSS` twice does not create two `<style id="tug-palette">` elements (only one exists in `document.head`)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test src/__tests__/palette-engine.test.ts` -- integration tests for injection and variable presence pass

---

#### Step 3: Boot-time and theme-switch integration {#step-3}

**Depends on:** #step-2

**Commit:** `feat(palette): wire injectPaletteCSS into main.tsx and TugThemeProvider.setTheme`

**References:** [D04] injection call sites, (#context, #strategy, #dependencies)

**Artifacts:**
- Modified file: `tugdeck/src/main.tsx` (add `injectPaletteCSS` call after `applyInitialTheme`)
- Modified file: `tugdeck/src/contexts/theme-provider.tsx` (add `injectPaletteCSS` call inside `setTheme`)

**Tasks:**
- [ ] In `main.tsx`, import `injectPaletteCSS` from `palette-engine.ts` and call it inside the async IIFE, between `applyInitialTheme(initialTheme)` and `sendCanvasColor()` (approximately line 38), passing `initialTheme` as the argument. The call must be inside the IIFE (not at module scope) because it depends on `initialTheme` resolved from server settings
- [ ] In `theme-provider.tsx`, import `injectPaletteCSS` from `palette-engine.ts` and call it inside `setTheme()` immediately after the `injectThemeCSS(newTheme, cssText)` / `removeThemeCSS()` branch, before `setThemeState(newTheme)`, passing `newTheme` as the argument
- [ ] Verify that the boot-time call happens synchronously before React mounts (palette variables available for any component that reads them on first render)

**Tests:**
- [ ] After app boot with default theme, `--tug-palette-hue-55-orange-tone-50` is present in computed styles
- [ ] After switching theme from Brio to Bluenote, palette variables are still present (re-injected)
- [ ] After switching back to Brio, palette variables use default anchors (no stale Bluenote overrides)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] Manual verification: open app, inspect `<style id="tug-palette">` element in dev tools, confirm 360 variables present
- [ ] Manual verification: switch themes, confirm palette element updates
- [ ] Manual verification: measure injection performance in browser console via `performance.now()` before and after `injectPaletteCSS('brio')` -- confirm under 1ms (happy-dom timing is unreliable for this; only real browser measurement is meaningful)

---

#### Step 4: Gallery palette content component {#step-4}

**Depends on:** #step-2

**Commit:** `feat(palette): add GalleryPaletteContent with interactive curve tuning demo`

**References:** [D06] gallery tab pattern, [D01] smoothstep default, Spec S04, Risk R02, (#transfer-function-design, #success-criteria)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/cards/gallery-palette-content.tsx`
- New file: `tugdeck/src/components/tugways/cards/gallery-palette-content.css`

**Tasks:**
- [ ] Create `GalleryPaletteContent` component that renders:
  - A 24-row x 11-column grid showing all standard stops as colored swatches (each swatch's background is the computed oklch value)
  - Hue name labels on the left, intensity stop labels across the top
  - Each swatch displays its CSS variable name on hover (via title attribute)
- [ ] Add interactive controls using local `useState` (local component state, not external store):
  - Sliders for L_MAX, L_MIN, C_MAX, C_MIN anchor values
  - Curve type selector (smoothstep / bezier / piecewise) via `<select>`
  - A "Reset to defaults" button
- [ ] Add side-by-side comparison panel:
  - Two curve configurations displayed simultaneously
  - Left panel uses current slider values; right panel uses the last "locked" configuration
  - A "Lock current" button copies the left configuration to the right
- [ ] Implement the alternative curve functions (bezier and piecewise `intensityToLC` variants) locally in the component for demo comparison only -- these are not exported from palette-engine.ts. For non-smoothstep modes, the component calls its local curve function to get `{ L, C }`, then passes the result to the exported `clampedOklchString(hueName, L, C)` helper for chroma capping and oklch string formatting. This avoids reimplementing chroma capping or string formatting in the component. For smoothstep mode, the component calls `tugPaletteColor` directly
- [ ] Style all controls using existing `cg-*` CSS class patterns from `gallery-card.css`
- [ ] Rules of Tugways compliance: swatch background colors are set via inline `style` attributes computed per-render from `tugPaletteColor()`. This is acceptable because the colors are computed values applied directly to DOM, not stored as React appearance state ([D08], [D09]). Interactive controls use local `useState` for curve parameters -- this is local component state, not external store state, so `useSyncExternalStore` does not apply ([D40])

**Tests:**
- [ ] `GalleryPaletteContent` renders without errors
- [ ] All 24 x 11 = 264 swatch elements are present in the rendered output
- [ ] Changing a slider value updates the displayed swatches (local state triggers re-render, appearance via style attribute)
- [ ] Curve type selector switches between three curve implementations

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] Manual verification: open gallery palette tab, verify all 24 hue rows render with smooth gradients
- [ ] Manual verification: adjust sliders, confirm swatches update in real time
- [ ] Manual verification: lock a configuration, switch curve type, confirm side-by-side shows different gradients

---

#### Step 5: Gallery card registration for palette tab {#step-5}

**Depends on:** #step-4

**Commit:** `feat(palette): register gallery-palette as ninth gallery tab`

**References:** [D06] gallery tab pattern, Spec S04, (#symbol-inventory)

**Artifacts:**
- Modified file: `tugdeck/src/components/tugways/cards/gallery-card.tsx` (add tab entry and registration)
- Modified file: `tugdeck/src/__tests__/gallery-card.test.tsx` (update assertions from 8 to 9 tabs)
- Modified file: `tugdeck/src/__tests__/observable-props-integration.test.tsx` (update tab count assertion from 8 to 9)

**Tasks:**
- [ ] Add `GalleryPaletteContent` import to `gallery-card.tsx` from `./gallery-palette-content`
- [ ] Add ninth entry to `GALLERY_DEFAULT_TABS`: `{ id: "template", componentId: "gallery-palette", title: "Palette Engine", closable: true }`
- [ ] Add `registerCard()` block for `gallery-palette` in `registerGalleryCards()` following the existing pattern:
  - `componentId: "gallery-palette"`
  - `factory` and `contentFactory` render `GalleryPaletteContent`
  - `defaultMeta: { title: "Palette Engine", icon: "Palette", closable: true }`
  - `family: "developer"`, `acceptsFamilies: ["developer"]`
- [ ] In `gallery-card.test.tsx`, update the following test blocks:
  - Line 60: "registers all eight gallery componentIds" -- update describe/it text from "eight" to "nine", add `expect(getRegistration("gallery-palette")).toBeDefined()`
  - Lines 76-85: "each registration has family: 'developer'" -- add `"gallery-palette"` to the `ids` array
  - Lines 96-105: "each registration has acceptsFamilies: ['developer']" -- add `"gallery-palette"` to the `ids` array
  - Line 116: `toBe(8)` to `toBe(9)` for `defaultTabs.length`
  - Lines 127-135: "other seven gallery registrations do NOT have defaultTabs" -- add `"gallery-palette"` to the `others` array, update "seven" to "eight" in describe text
  - Line 150: `toBe(8)` to `toBe(9)` for `GALLERY_DEFAULT_TABS.length`, update "eight" to "nine" in it-text
  - Lines 154-162: add `"gallery-palette"` to expected componentId list
  - Lines 166-174: add `"Palette Engine"` to expected title list
  - Line 188/209 area: update describe text "eight" to "nine" and `toBe(8)` to `toBe(9)` for `card.tabs.length`
  - Lines 5-9 (file header comment): update "eight" references to "nine"
- [ ] In `observable-props-integration.test.tsx`: update `toHaveLength(8)` to `toHaveLength(9)` at line 504; update describe text at line 502 from "eighth tab" to note total is now nine (the observable-props tab remains at index 7)

**Tests:**
- [ ] `GALLERY_DEFAULT_TABS` has 9 entries
- [ ] `registerGalleryCards()` registers 9 card types without errors
- [ ] All existing gallery-card.test.tsx tests pass with updated assertions
- [ ] All existing observable-props-integration.test.tsx tests pass with updated count
- [ ] Opening the Component Gallery card shows the "Palette Engine" tab

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test src/__tests__/gallery-card.test.tsx src/__tests__/observable-props-integration.test.tsx` -- all gallery tests pass with updated assertions
- [ ] Manual verification: open Component Gallery, click "Palette Engine" tab, confirm content renders

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-3, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] smoothstep default, [D02] static chroma caps, [D03] style element injection, [D04] injection call sites, [D05] tone aliases, [D06] gallery tab pattern, Risk R01, (#success-criteria)

**Tasks:**
- [ ] Verify all success criteria are met end-to-end:
  - `tugPaletteColor` works for all 24 hues x arbitrary intensities
  - 360 CSS variables (264 stops + 96 aliases) are present after boot
  - Named aliases resolve to the same values as their numeric equivalents
  - All standard stops are sRGB-gamut-safe
  - Injection completes in under 1ms
  - Gallery palette tab renders and interactive controls work
- [ ] Verify theme switching works end-to-end: switch Brio -> Bluenote -> Harmony -> Brio, confirm palette re-injects each time
- [ ] Verify no console errors or warnings during normal operation

**Tests:**
- [ ] Full suite of palette-engine unit tests passes
- [ ] Full suite of integration tests passes

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no errors
- [ ] `cd tugdeck && bun test` -- all tests pass (palette-engine, gallery-card, observable-props-integration)
- [ ] Manual full walkthrough: boot app, verify palette variables, switch themes, open gallery palette tab, adjust controls, lock comparison

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A computed OKLCH palette engine producing 360 CSS custom properties (24 hues x 11 standard stops + 24 x 4 named aliases) with per-hue chroma capping, theme parameter overrides, and an interactive gallery demo for transfer function curve tuning.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `palette-engine.ts` exports `HUE_FAMILIES`, `MAX_CHROMA_FOR_HUE`, `tugPaletteColor`, `clampedOklchString`, `tugPaletteVarName`, `injectPaletteCSS`, `TONE_ALIASES`, `DEFAULT_LC_PARAMS`, and `LCParams`
- [ ] 360 CSS variables are present on `document.documentElement` after boot
- [ ] All 264 standard stop oklch values are sRGB-gamut-safe
- [ ] Named tone aliases resolve to correct values
- [ ] `injectPaletteCSS` runs in under 1ms
- [ ] Theme switching re-injects palette with correct parameters
- [ ] Gallery palette tab renders with interactive curve tuning controls and side-by-side comparison

**Acceptance tests:**
- [ ] `tugPaletteColor('red', 50)` returns a valid oklch string
- [ ] `getComputedStyle(document.body).getPropertyValue('--tug-palette-hue-25-red-tone-50')` is non-empty after boot
- [ ] `--tug-palette-hue-25-red-soft` equals `--tug-palette-hue-25-red-tone-15` in computed styles
- [ ] Switching to Bluenote and back to Brio leaves palette variables with Brio defaults

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Dark-theme-specific L/C curves (deferred to Phase 5d5c / [Q01])
- [ ] P3 wide-gamut chroma caps for displays that support Display P3
- [ ] Final transfer function selection (smoothstep vs bezier vs piecewise) based on designer feedback
- [ ] Wire `--tug-base-accent-*` semantic tokens to palette variables (Phase 5d5c)

| Checkpoint | Verification |
|------------|--------------|
| Palette engine compiles | `cd tugdeck && bunx tsc --noEmit` |
| CSS variables injected | Dev tools inspect `<style id="tug-palette">` |
| Gamut safety | Unit tests verify all stops are sRGB-safe |
| Gallery demo functional | Manual: open Palette Engine tab, adjust controls |
| Theme switching works | Manual: cycle through all three themes |
