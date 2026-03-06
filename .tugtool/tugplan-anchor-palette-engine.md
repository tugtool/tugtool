## Tugways Phase 5d5b: Anchor-Based Palette Engine {#anchor-palette-engine}

**Purpose:** Replace the uniform smoothstep transfer curve in palette-engine.ts with per-hue, per-theme anchor colors so that each hue family has hand-tuned L and C values at key intensity stops, enabling perceptually accurate palettes that serve both dark and light themes. Ship an enhanced gallery tuning tool with per-hue anchor editing, export/import JSON, and theme switching.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5d5b-anchor-palette-engine |
| Last updated | 2026-03-06 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current palette engine (Phase 5d5a) uses a single global smoothstep transfer curve to map intensity 0--100 to OKLCH L and C values uniformly across all 24 hues. While this produces mathematically smooth gradients, it fails to match human perceptual expectations: yellow looks canonical at very high lightness (~0.90), blue at medium lightness (~0.55), and red at medium-high lightness (~0.65). A single curve cannot account for these differences. Furthermore, the existing system uses one curve for all themes, but dark themes need lighter, more vivid mid-tones while light themes need darker, more muted ones.

This phase replaces the global curve with per-hue anchor colors at configurable intensity stops. Each hue gets hand-picked L and C values at key stops (minimally at 0, 50, and 100, but any stop can serve as an anchor). Non-anchor stops are linearly interpolated between surrounding anchors. Each theme (brio, harmony, bluenote) defines its own complete set of anchors, passed directly as a TypeScript object to `injectPaletteCSS()`.

#### Strategy {#strategy}

- Define anchor data structures in palette-engine.ts as pure TypeScript types with no React dependencies.
- Add a new `tugAnchoredColor()` function for the anchor-based computation, keeping `tugPaletteColor()` backward-compatible with its existing `LCParams` signature.
- Replace the CSS variable indirection for theme parameters with a direct JS object argument to `injectPaletteCSS()`, passing per-theme anchor data.
- Seed initial anchor values programmatically from the current smoothstep curve output, then provide research-informed canonical starting points per hue.
- Enhance GalleryPaletteContent to support per-hue anchor editing with click-to-edit swatches, theme switching, and JSON export/import.
- Keep existing curve modes (smoothstep, bezier, piecewise) as comparison references in the gallery, with anchors as the new primary mode.
- Retain the `MAX_CHROMA_FOR_HUE` table as a safety net; the gallery editor warns when hand-picked C exceeds the cap.

#### Success Criteria (Measurable) {#success-criteria}

- `tugAnchoredColor(hueName, intensity, anchors)` returns a valid `oklch(...)` string for all 24 hue names and intensity values 0--100, using per-hue anchor interpolation (24 x 101 = 2,424 calls).
- All 264 standard stops (24 hues x 11 stops) remain sRGB-gamut-safe after switching to anchor-based computation (verified by converting each oklch value to sRGB and checking 0 <= r,g,b <= 1).
- `injectPaletteCSS(themeName, anchorData)` accepts a direct JS object of per-theme anchors and produces 360 CSS variables (264 stops + 96 aliases).
- Each theme (brio, bluenote, harmony) defines its own complete anchor set, and switching themes produces visibly different palettes.
- The gallery anchor editor allows clicking any swatch to edit its L and C values, with changes reflected immediately in the swatch grid.
- Export produces valid JSON matching the Spec S04 schema `{ version: 1, themes: { brio: { red: { anchors: [...] }, ... }, bluenote: { ... }, harmony: { ... } } }` and import restores the full configuration.
- `tugPaletteColor()` remains backward-compatible: existing call sites with `LCParams` continue to work without changes.
- The gallery displays a gamut warning indicator when a hand-picked anchor C value exceeds `MAX_CHROMA_FOR_HUE` for that hue.

#### Scope {#scope}

1. Anchor data types and `tugAnchoredColor()` function in `palette-engine.ts`.
2. Per-theme anchor data objects (brio, bluenote, harmony default anchors).
3. Modified `injectPaletteCSS()` signature accepting direct anchor data instead of reading CSS variable overrides.
4. Research-informed initial anchor values seeded per hue for all three themes.
5. Enhanced `GalleryPaletteContent` with per-hue anchor editor, theme switcher, JSON export/import.
6. Updated tests covering anchor interpolation, per-theme injection, and backward compatibility.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Token architecture migration (`--tug-base-*`, `--tug-comp-*`) -- that is Phase 5d5c.
- Consumer migration from `--td-*`/`--tways-*` tokens -- that is Phase 5d5d.
- P3 wide-gamut display optimization -- palette is clamped to sRGB for this phase.
- Automated perceptual optimization algorithms -- anchor values are hand-tuned using the gallery tool.
- Changing the 24 hue family names or their OKLCH angle assignments.

#### Dependencies / Prerequisites {#dependencies}

- Phase 5d5a (Palette Engine) is complete -- `palette-engine.ts`, `GalleryPaletteContent`, gallery palette tab registration, boot-time and theme-switch injection call sites all exist in the codebase.
- Existing theme infrastructure: `TugThemeProvider`, `injectThemeCSS()`, `applyInitialTheme()`, `injectPaletteCSS()` call sites in `main.tsx` and `theme-provider.tsx`.

#### Constraints {#constraints}

- `palette-engine.ts` must remain a pure TypeScript module with no React dependencies.
- All 24 hues x 11 standard stops must remain sRGB-gamut-safe (`MAX_CHROMA_FOR_HUE` enforcement continues).
- The CSS variable naming convention (`--tug-palette-hue-<angle>-<name>-tone-<intensity>`) is unchanged.
- `injectPaletteCSS()` call sites (`main.tsx` and `theme-provider.tsx`) must continue to work with the new signature.
- The gallery component uses local React state for interactive controls (Rules of Tugways compliance: [D08], [D09], [D40]).
- `tugPaletteColor()` keeps its existing `LCParams` signature for backward compatibility.

#### Assumptions {#assumptions}

- The 24 hue families and their OKLCH angle assignments (cherry=10 through crimson=355) remain unchanged.
- The CSS variable naming convention and named aliases (soft/default/strong/intense) are unchanged.
- The gallery tuning UI will use local React `useState` for all anchor editing state, consistent with Rules of Tugways compliance.
- The existing smoothstep, bezier, and piecewise curve modes remain available in the gallery as comparison references, not as the primary production mode.
- All 11 standard stops (0, 10, ..., 100) continue to be injected as CSS variables regardless of how many anchors are hand-picked.
- Initial anchor values will be seeded programmatically from the current smoothstep curve output as a starting point, then adjusted by hand using the gallery tuning tool.
- Any stop can itself be an anchor; non-anchor stops are linearly interpolated between their two surrounding anchors.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

See skeleton for full conventions. This plan uses `step-N` anchors for execution steps, `dNN-slug` anchors for design decisions, `sNN-slug` anchors for specs, `tNN-slug` anchors for tables, `lNN-slug` anchors for lists, and `qNN-slug` anchors for open questions.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Optimal anchor stop count per hue (OPEN) {#q01-anchor-stop-count}

**Question:** Should the default anchor set use 3 anchors (stops 0, 50, 100) or more (e.g., 5 anchors at 0, 25, 50, 75, 100) for better perceptual control?

**Why it matters:** More anchors give finer control over the gradient shape but increase the manual tuning burden. Too few anchors may produce linear segments that look flat compared to the smoothstep curve.

**Options (if known):**
- 3 anchors (0, 50, 100): minimal, quick to tune, but limited shape control.
- 5 anchors (0, 25, 50, 75, 100): good balance of control and simplicity.
- Per-hue variable count: some hues may need more anchors than others.

**Plan to resolve:** Start with 3 anchors per hue. The gallery editor allows adding more anchors at any stop. After initial tuning, the exported JSON captures whatever stops were used as anchors. The system supports any configuration.

**Resolution:** DECIDED -- start with 3 anchors (0, 50, 100) as the default seed. The anchor system supports any stop as an anchor; additional anchors can be added per-hue via the gallery editor. The flexible-anchor-count design ([D01]) accommodates any final configuration.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Per-hue anchors exceed sRGB gamut | med | high | MAX_CHROMA_FOR_HUE cap table enforced as safety net; gallery warns on violation | Any anchor's C exceeds cap |
| Linear interpolation between anchors produces visible banding | med | med | Gallery comparison mode shows anchor-based vs smoothstep side-by-side; add more anchors if needed | Visible banding in gallery demo |
| Per-theme anchor data increases bundle size | low | low | Anchor data is compact (~24 hues x 3 stops x 2 values = ~144 numbers per theme) | Bundle analysis shows significant increase |
| Breaking change to injectPaletteCSS signature | med | low | Update both call sites atomically in the same step; keep old signature as optional overload | TypeScript compiler errors |

**Risk R01: Anchor gamut clipping** {#r01-anchor-gamut-clipping}

- **Risk:** Hand-picked anchor C values may exceed the sRGB gamut boundary for specific hues at their anchor L value.
- **Mitigation:** `MAX_CHROMA_FOR_HUE` remains as a static safety net. `tugAnchoredColor()` clamps C using the same `clampedOklchString()` helper. The gallery editor performs a live gamut check and shows a warning indicator when C exceeds the cap.
- **Residual risk:** Interpolated stops between anchors could produce L/C combinations that clip despite individual anchors being safe. The existing per-hue cap applies to all stops. Note: the static cap table was derived for the smoothstep curve's L range and may be overly conservative for some anchor L values (e.g., yellow at L=0.90 can safely hold more chroma than the cap at L=0.42). This is acceptable -- the cap is a safety floor, not a quality ceiling. If specific hues need higher caps at anchor L values, the cap table can be regenerated in a follow-on.

**Risk R02: Linear interpolation quality** {#r02-interpolation-quality}

- **Risk:** Linear interpolation between anchors may produce flat-looking segments compared to the smoothstep curve, especially across wide stop ranges.
- **Mitigation:** The gallery comparison mode shows anchor-based and smoothstep palettes side by side. If banding is visible, the user adds more anchors at intermediate stops to improve the gradient. The system supports any number of anchors per hue.
- **Residual risk:** Some hues may need more anchors than others to look smooth, increasing per-hue complexity.

---

### Design Decisions {#design-decisions}

#### [D01] Per-hue anchor colors with flexible stop positions (DECIDED) {#d01-per-hue-anchors}

**Decision:** Each of the 24 hues defines anchor L and C values at specific intensity stops. Any stop (0, 10, 20, ..., 100) can be an anchor. Non-anchor stops are computed by linear interpolation between surrounding anchors. At minimum, anchors at stops 0, 50, and 100 are required (stop 50 is the "canonical" color for that hue).

**Rationale:**
- Different hues have different perceptual characteristics: yellow is canonical at high L (~0.90), blue at medium L (~0.55), red at medium-high L (~0.65). A global curve cannot accommodate these differences.
- Flexible anchor positions allow adding control points only where needed, keeping the data compact for simple hues while allowing fine-grained control for problematic ones.
- Linear interpolation between anchors is simple, predictable, and computationally cheap.

**Implications:**
- The anchor data structure stores an array of `{ stop, L, C }` tuples sorted by stop value.
- `tugAnchoredColor()` performs a binary search or linear scan to find the two surrounding anchors, then linearly interpolates L and C independently.
- The minimum required anchors are stops 0, 50, and 100 for every hue.

#### [D02] Per-theme anchor data as direct JS object (DECIDED) {#d02-direct-js-anchors}

**Decision:** Per-theme anchor data is passed directly as a TypeScript/JavaScript object argument to `injectPaletteCSS()`, replacing the CSS variable indirection (`--tug-theme-lc-*` properties read via `getComputedStyle`).

**Rationale:**
- CSS variable indirection limited theme differentiation to four global L/C parameters. Per-hue anchors would require hundreds of CSS variables to express, making the indirection impractical.
- A direct JS object is type-safe, validated at compile time, and eliminates the runtime `getComputedStyle` call for palette parameters.
- The anchor data is static per theme (not dynamic), so CSS-variable reactivity is unnecessary.

**Implications:**
- `injectPaletteCSS(themeName, anchorData?)` gains an optional second argument. When provided, it uses anchor-based computation. When omitted, it falls back to the existing smoothstep behavior for backward compatibility.
- `readThemeParams()` remains in the codebase for the backward-compatible fallback path (when anchor data is not provided). `readHueOverrides()` is removed entirely as dead code (no CSS in the codebase ever sets `--tug-theme-hue-*` variables).
- Each theme defines a complete `ThemeAnchorData` object exported from a theme-anchors module or embedded in palette-engine.ts.

#### [D03] Backward-compatible API with new tugAnchoredColor function (DECIDED) {#d03-backward-compat-api}

**Decision:** `tugPaletteColor()` retains its existing `(hueName, intensity, params?: LCParams)` signature unchanged. A new `tugAnchoredColor(hueName, intensity, hueAnchors)` function provides the anchor-based computation.

**Rationale:**
- Existing consumers of `tugPaletteColor()` (including the gallery comparison mode for smoothstep/bezier/piecewise) must continue to work without modification.
- A separate function makes the distinction between curve-based and anchor-based computation explicit.
- Both functions delegate to `clampedOklchString()` for chroma capping and formatting, sharing the gamut safety logic.

**Implications:**
- `injectPaletteCSS()` internally calls `tugAnchoredColor()` when anchor data is provided, or `tugPaletteColor()` when it is not.
- The gallery anchor editor calls `tugAnchoredColor()` directly for live preview.
- Tests for `tugPaletteColor()` remain unchanged; new tests cover `tugAnchoredColor()`.

#### [D04] Theme-keyed JSON export format (DECIDED) {#d04-json-export-format}

**Decision:** The gallery export produces a single JSON file containing all themes' anchor data in the structure `{ brio: { red: { anchors: [...] }, ... }, bluenote: { ... }, harmony: { ... } }`. Import loads the full file and restores all themes.

**Rationale:**
- A single file keeps all theme variants together, preventing drift between separate per-theme files.
- The JSON structure maps directly to the `ThemeAnchorData` TypeScript type, enabling direct copy-paste from export to production source code.
- JSON is human-readable and diffable in version control.

**Implications:**
- The gallery export button serializes the current anchor state for all three themes into a JSON blob, offered as a download.
- The gallery import button accepts a JSON file, validates its structure, and loads the anchor data into the editor state.
- The production bake-in workflow: tune in gallery, export JSON, copy the JSON object literal into the theme-anchors constant in source code.

#### [D05] Research-informed initial anchor seeds (DECIDED) {#d05-initial-anchor-seeds}

**Decision:** Initial anchor L values are seeded based on hue-specific perceptual research, not simply from the smoothstep curve output. The stop-50 anchor for each hue targets the L value where that hue looks most "canonical" (recognizable and vivid).

**Rationale:**
- Material Design 3 tonal palettes, Apple system colors, and Tailwind color scales all show that canonical hue recognition depends heavily on lightness. Yellow is canonical at very high L (~0.88--0.92), blue at medium L (~0.50--0.58), red at medium-high L (~0.60--0.68).
- Starting from these research-informed values reduces the amount of manual tuning needed in the gallery.
- The smoothstep curve produces L ~0.69 for all hues at stop 50, which is wrong for most hues.

**Implications:**
- A `DEFAULT_ANCHOR_DATA` constant provides research-informed seeds for all 24 hues across all three themes.
- Stop-0 anchors are uniformly high L (~0.96) and near-zero C (~0.01) for all hues (near-white wash).
- Stop-100 anchors use per-hue L values near the existing `L_MIN` (0.42) with C near each hue's `MAX_CHROMA_FOR_HUE` cap.
- Stop-50 anchors use per-hue canonical L values with moderate C.

#### [D06] MAX_CHROMA_FOR_HUE as safety net for anchor editing (DECIDED) {#d06-chroma-safety-net}

**Decision:** The existing static `MAX_CHROMA_FOR_HUE` cap table remains as a runtime safety net. `tugAnchoredColor()` clamps C through `clampedOklchString()` just as `tugPaletteColor()` does. The gallery editor additionally shows a visual warning when a hand-picked C value exceeds the cap for that hue.

**Rationale:**
- Gamut safety must be guaranteed regardless of what anchor values the user picks.
- The cap table is already validated and trusted; reusing it for anchor-based computation ensures consistency.
- The gallery warning helps the user understand why their chosen C was clamped, enabling informed adjustment.

**Implications:**
- `tugAnchoredColor()` delegates to `clampedOklchString()` which applies `min(C, MAX_CHROMA_FOR_HUE[hue])`.
- The gallery swatch shows a red border or warning icon when the user's input C exceeds the cap.
- The exported JSON stores the user's intended C values (pre-clamping), but runtime always clamps.
- The static cap table was derived for the smoothstep curve's L range (L_MIN=0.42) and may be overly conservative at higher L values used by anchors. This is a safe default; the cap table can be regenerated for anchor-specific L ranges in a follow-on if needed.

---

### Deep Dives (Optional) {#deep-dives}

#### Anchor Interpolation Algorithm {#anchor-interpolation}

Given an array of anchors `[{ stop: 0, L: 0.96, C: 0.01 }, { stop: 50, L: 0.65, C: 0.12 }, { stop: 100, L: 0.42, C: 0.17 }]` and a requested intensity of 30:

1. Find the two surrounding anchors: `{ stop: 0, L: 0.96, C: 0.01 }` and `{ stop: 50, L: 0.65, C: 0.12 }`.
2. Compute interpolation factor: `t = (30 - 0) / (50 - 0) = 0.6`.
3. Interpolate L: `0.96 + 0.6 * (0.65 - 0.96) = 0.774`.
4. Interpolate C: `0.01 + 0.6 * (0.12 - 0.01) = 0.076`.
5. Pass to `clampedOklchString(hueName, 0.774, 0.076)` for gamut capping and formatting.

Edge cases:
- Intensity exactly at an anchor stop: return that anchor's L and C directly.
- Intensity below the first anchor (should not happen if stop 0 is always present): clamp to first anchor.
- Intensity above the last anchor (should not happen if stop 100 is always present): clamp to last anchor.

#### Per-Hue Canonical Lightness Reference {#canonical-lightness}

**Table T01: Research-informed canonical L values at stop 50** {#t01-canonical-lightness}

| Hue | Angle | Canonical L (stop 50) | Reference |
|-----|-------|-----------------------|-----------|
| cherry | 10 | 0.62 | Similar to red, slightly deeper |
| red | 25 | 0.65 | Material red 500, Apple systemRed |
| tomato | 35 | 0.67 | Between red and orange |
| flame | 45 | 0.70 | Warm orange-red |
| orange | 55 | 0.73 | Material orange 500, Apple systemOrange |
| amber | 65 | 0.78 | Between orange and yellow |
| gold | 75 | 0.83 | Warm yellow |
| yellow | 90 | 0.90 | Material yellow 500, Apple systemYellow, Tailwind yellow-400 |
| lime | 115 | 0.82 | Yellow-green, high lightness |
| green | 140 | 0.68 | Material green 500, Apple systemGreen |
| mint | 155 | 0.72 | Light green-cyan |
| teal | 175 | 0.65 | Material teal 500, Apple systemTeal |
| cyan | 200 | 0.68 | Material cyan 500 |
| sky | 215 | 0.62 | Light blue |
| blue | 230 | 0.55 | Material blue 500, Apple systemBlue |
| indigo | 250 | 0.50 | Material indigo 500, Apple systemIndigo |
| violet | 270 | 0.55 | Material purple 500 |
| purple | 285 | 0.55 | Apple systemPurple |
| plum | 300 | 0.58 | Deep purple-pink |
| pink | 320 | 0.68 | Material pink 500, Apple systemPink |
| rose | 335 | 0.65 | Warm pink |
| magenta | 345 | 0.62 | Deep pink-red |
| crimson | 355 | 0.60 | Deep red |
| coral | 20 | 0.68 | Warm red-orange |

These values are starting points. Final values are determined by gallery tuning and exported as JSON.

#### Production Bake-In Workflow {#bake-in-workflow}

1. Open the gallery Palette Engine tab and switch to "Anchors" mode.
2. Select a theme (brio, bluenote, or harmony) from the theme switcher.
3. Click any swatch to edit its L and C values. Add anchors at additional stops if needed.
4. Compare the anchor-based palette against the smoothstep reference using the side-by-side view.
5. Repeat for all three themes.
6. Click "Export JSON" to download the complete anchor configuration.
7. Copy the JSON object into the `DEFAULT_ANCHOR_DATA` constant in `palette-engine.ts` (or a separate `theme-anchors.ts` module).
8. The next build uses the baked-in anchors as the production palette.

---

### Specification {#specification}

#### Anchor Data Types {#anchor-data-types}

**Spec S01: Anchor data structures** {#s01-anchor-data-structures}

```typescript
/** A single anchor point: L and C values at a specific intensity stop. */
export interface AnchorPoint {
  stop: number;   // 0, 10, 20, ..., 100
  L: number;      // OKLCH lightness [0, 1]
  C: number;      // OKLCH chroma [0, ~0.4]
}

/** Anchor set for a single hue: sorted array of AnchorPoints. */
export interface HueAnchors {
  anchors: AnchorPoint[];  // sorted by stop ascending, minimum 3 (0, 50, 100)
}

/** Complete anchor data for all 24 hues within a single theme. */
export type ThemeHueAnchors = Record<string, HueAnchors>;

/** Complete anchor data for all themes. */
export interface ThemeAnchorData {
  brio: ThemeHueAnchors;
  bluenote: ThemeHueAnchors;
  harmony: ThemeHueAnchors;
}
```

**Spec S02: tugAnchoredColor function** {#s02-anchored-color-fn}

```typescript
/**
 * Compute an oklch() CSS color string using per-hue anchor interpolation.
 * Finds the two surrounding anchors for the given intensity, linearly
 * interpolates L and C, then delegates to clampedOklchString() for
 * gamut capping and formatting.
 */
export function tugAnchoredColor(
  hueName: string,
  intensity: number,
  hueAnchors: HueAnchors,
): string;
```

**Spec S03: Updated injectPaletteCSS signature** {#s03-updated-inject}

```typescript
/**
 * Inject all 264 standard-stop CSS variables plus 96 named tone aliases.
 *
 * When anchorData is provided, uses per-hue anchor interpolation
 * (tugAnchoredColor) for each stop. When omitted, falls back to the
 * existing smoothstep-based computation (tugPaletteColor) for backward
 * compatibility.
 */
export function injectPaletteCSS(
  themeName: string,
  anchorData?: ThemeHueAnchors,
): void;
```

**Spec S04: JSON export/import schema** {#s04-json-schema}

```json
{
  "version": 1,
  "themes": {
    "brio": {
      "red": { "anchors": [{ "stop": 0, "L": 0.96, "C": 0.01 }, { "stop": 50, "L": 0.65, "C": 0.12 }, { "stop": 100, "L": 0.42, "C": 0.169 }] },
      "blue": { "anchors": [{ "stop": 0, "L": 0.96, "C": 0.01 }, { "stop": 50, "L": 0.55, "C": 0.06 }, { "stop": 100, "L": 0.42, "C": 0.083 }] }
    },
    "bluenote": { },
    "harmony": { }
  }
}
```

**Spec S05: Gallery anchor editor interactions** {#s05-gallery-anchor-editor}

- **Mode selector:** A top-level toggle switches between "Anchors" (primary) and "Curves" (reference comparison) modes.
- **Theme switcher:** A `<select>` chooses which theme's anchors to edit (brio, bluenote, harmony).
- **Swatch click to edit:** Clicking a swatch in anchor mode opens an inline L/C editor (two number inputs or sliders) for that hue at that stop. Editing updates the swatch immediately.
- **Anchor toggle:** Each stop for each hue can be toggled between "anchor" (hand-picked) and "interpolated" (computed). Toggling a stop to anchor freezes its current L/C; toggling back to interpolated removes it from the anchor array.
- **Gamut warning:** Swatches whose input C exceeds `MAX_CHROMA_FOR_HUE[hue]` display a visual warning (red border).
- **Export button:** Downloads the full `ThemeAnchorData` as a JSON file.
- **Import button:** Accepts a JSON file, validates it, and loads the anchor data for all themes.

---

### Compatibility / Migration / Rollout (Optional) {#rollout}

- **Compatibility policy:** `tugPaletteColor()` signature is unchanged; existing call sites are unaffected. `injectPaletteCSS()` gains an optional second parameter; existing call sites passing only `themeName` continue to work using smoothstep fallback.
- **Migration plan:**
  - Step 1: Add anchor types and `tugAnchoredColor()` (no call-site changes).
  - Step 2: Update `injectPaletteCSS()` to accept optional anchor data.
  - Step 3: Update `main.tsx` and `theme-provider.tsx` call sites to pass anchor data.
  - Step 4: Once anchor data is baked in and validated, the smoothstep fallback path can be removed in a future phase (not this phase).
- **Rollout plan:**
  - Anchors become the production mode when call sites pass anchor data.
  - The smoothstep fallback remains for any call site that does not provide anchors.
  - No feature flag needed; the optional parameter is the implicit opt-in.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/theme-anchors.ts` | Default anchor data for all three themes (brio, bluenote, harmony) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `AnchorPoint` | interface | `palette-engine.ts` | `{ stop, L, C }` tuple |
| `HueAnchors` | interface | `palette-engine.ts` | `{ anchors: AnchorPoint[] }` for one hue |
| `ThemeHueAnchors` | type | `palette-engine.ts` | `Record<string, HueAnchors>` for all 24 hues |
| `ThemeAnchorData` | interface | `palette-engine.ts` | `{ brio, bluenote, harmony }` complete anchor set |
| `tugAnchoredColor` | fn | `palette-engine.ts` | Anchor-interpolated oklch string computation |
| `interpolateAnchors` | fn (private) | `palette-engine.ts` | Linear interpolation between surrounding anchors |
| `injectPaletteCSS` | fn (modified) | `palette-engine.ts` | Add optional `anchorData?: ThemeHueAnchors` parameter; refactor makeOklch; remove readHueOverrides |
| `readHueOverrides` | fn (removed) | `palette-engine.ts` | Dead code: no CSS sets `--tug-theme-hue-*` variables |
| `DEFAULT_ANCHOR_DATA` | const | `theme-anchors.ts` | Research-informed seed anchors for all themes |
| `BRIO_ANCHORS` | const | `theme-anchors.ts` | Brio theme anchors |
| `BLUENOTE_ANCHORS` | const | `theme-anchors.ts` | Bluenote theme anchors |
| `HARMONY_ANCHORS` | const | `theme-anchors.ts` | Harmony theme anchors |
| `GalleryPaletteContent` | component (modified) | `gallery-palette-content.tsx` | Add anchor editor mode, theme switcher, export/import |
| `injectPaletteCSS` call site | fn (modified) | `main.tsx` | Pass anchor data as second argument |
| `injectPaletteCSS` call site | fn (modified) | `theme-provider.tsx` | Pass anchor data as second argument |

---

### Documentation Plan {#documentation-plan}

- [ ] Add JSDoc comments to all new exported symbols (`AnchorPoint`, `HueAnchors`, `ThemeHueAnchors`, `ThemeAnchorData`, `tugAnchoredColor`)
- [ ] Update module-level comment in `palette-engine.ts` to describe anchor-based computation alongside smoothstep
- [ ] Document the JSON export/import schema in a module-level comment in `theme-anchors.ts`
- [ ] Document the gallery anchor editor workflow in `gallery-palette-content.tsx` module comment

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test anchor interpolation math, `tugAnchoredColor` correctness, anchor data validation | Core anchor logic |
| **Integration** | Test anchor-based CSS injection, per-theme switching, call-site wiring | DOM-dependent behavior |
| **Golden / Contract** | Verify all 264 standard stop oklch values with default anchors against known-good snapshot | Regression protection |
| **Drift Prevention** | Verify `tugPaletteColor` backward compatibility (no change from Phase 5d5a) | API stability |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Anchor data types and interpolation function {#step-1}

**Commit:** `feat(palette): add anchor data types and tugAnchoredColor with linear interpolation`

**References:** [D01] per-hue anchors, [D03] backward-compatible API, [D06] chroma safety net, Spec S01, Spec S02, (#anchor-interpolation, #anchor-data-types, #context)

**Artifacts:**
- Modified file: `tugdeck/src/components/tugways/palette-engine.ts` (add types and `tugAnchoredColor`)
- Modified file: `tugdeck/src/__tests__/palette-engine.test.ts` (add anchor interpolation tests)

**Tasks:**
- [ ] Add `AnchorPoint`, `HueAnchors`, `ThemeHueAnchors`, and `ThemeAnchorData` interface/type exports to `palette-engine.ts`
- [ ] Implement private `interpolateAnchors(intensity: number, anchors: AnchorPoint[]): { L: number; C: number }` that:
  - Clamps intensity to [0, 100]
  - Finds the two surrounding anchors by scanning the sorted array
  - Linearly interpolates L and C between them
  - Returns the anchor's L/C directly when intensity matches an anchor stop exactly
- [ ] Implement exported `tugAnchoredColor(hueName: string, intensity: number, hueAnchors: HueAnchors): string` that calls `interpolateAnchors` then delegates to `clampedOklchString` for gamut capping and formatting
- [ ] Verify that `tugPaletteColor` is completely unchanged (no modifications to existing function)

**Tests:**
- [ ] `tugAnchoredColor('red', 0, { anchors: [{ stop: 0, L: 0.96, C: 0.01 }, { stop: 50, L: 0.65, C: 0.12 }, { stop: 100, L: 0.42, C: 0.17 }] })` returns oklch with L=0.96, C=0.01
- [ ] `tugAnchoredColor('red', 50, ...)` returns oklch with L=0.65, C=0.12
- [ ] `tugAnchoredColor('red', 25, ...)` returns oklch with L interpolated between 0.96 and 0.65 (L=0.805)
- [ ] `tugAnchoredColor('red', 100, ...)` returns oklch with L=0.42
- [ ] Intensity values outside 0--100 are clamped
- [ ] Chroma is clamped by `MAX_CHROMA_FOR_HUE` (pass a C value exceeding the cap, verify output C is capped)
- [ ] All existing `tugPaletteColor` tests still pass without modification (backward compatibility)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no type errors
- [ ] `cd tugdeck && bun test src/__tests__/palette-engine.test.ts` -- all existing and new tests pass

---

#### Step 2: Default theme anchor data {#step-2}

**Depends on:** #step-1

**Commit:** `feat(palette): add theme-anchors.ts with research-informed default anchors for all themes`

**References:** [D05] research-informed seeds, [D01] per-hue anchors, Table T01, (#canonical-lightness, #bake-in-workflow)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/theme-anchors.ts`
- New file: `tugdeck/src/__tests__/theme-anchors.test.ts`

**Tasks:**
- [ ] Create `theme-anchors.ts` exporting `DEFAULT_ANCHOR_DATA: ThemeAnchorData` with complete anchor sets for brio, bluenote, and harmony
- [ ] For brio (light theme): use the canonical L values from Table T01 at stop 50, with stop-0 anchors at L=0.96/C=0.01 and stop-100 anchors at per-hue L values near 0.35--0.45 with C near MAX_CHROMA_FOR_HUE caps
- [ ] For bluenote (dark theme): adjust stop-50 anchors to lighter L values (+0.05--0.10 vs brio) and higher C values for more vivid mid-tones against dark backgrounds
- [ ] For harmony (balanced theme): use intermediate values between brio and bluenote
- [ ] Export individual theme constants: `BRIO_ANCHORS`, `BLUENOTE_ANCHORS`, `HARMONY_ANCHORS`
- [ ] Validate that every hue in every theme has anchors at stops 0, 50, and 100 at minimum
- [ ] Validate that all anchor C values are at or below `MAX_CHROMA_FOR_HUE` for the respective hue

**Tests:**
- [ ] `DEFAULT_ANCHOR_DATA.brio` has entries for all 24 hue names
- [ ] `DEFAULT_ANCHOR_DATA.bluenote` has entries for all 24 hue names
- [ ] `DEFAULT_ANCHOR_DATA.harmony` has entries for all 24 hue names
- [ ] Every hue in every theme has at least 3 anchors (stops 0, 50, 100)
- [ ] All anchor C values are <= MAX_CHROMA_FOR_HUE for that hue
- [ ] Brio stop-50 L for "yellow" is approximately 0.90 (Table T01 canonical value)
- [ ] Brio stop-50 L for "blue" is approximately 0.55 (Table T01 canonical value)
- [ ] Bluenote stop-50 L for "blue" is higher than brio stop-50 L for "blue" (darker theme needs lighter mid-tones)
- [ ] All 24 hues x 11 stops produce sRGB-safe oklch values when computed via `tugAnchoredColor` with brio anchors

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test src/__tests__/theme-anchors.test.ts` -- all validation tests pass
- [ ] `cd tugdeck && bun test src/__tests__/palette-engine.test.ts` -- existing tests unaffected

---

#### Step 3: Update injectPaletteCSS to accept anchor data {#step-3}

**Depends on:** #step-1

**Commit:** `feat(palette): update injectPaletteCSS to accept optional anchor data`

**References:** [D02] direct JS anchors, [D03] backward-compatible API, Spec S03, (#rollout, #strategy)

**Artifacts:**
- Modified file: `tugdeck/src/components/tugways/palette-engine.ts` (update `injectPaletteCSS` signature)
- Modified file: `tugdeck/src/__tests__/palette-engine.test.ts` (add anchor-based injection tests)

**Tasks:**
- [ ] Update `injectPaletteCSS(themeName: string, anchorData?: ThemeHueAnchors)` to accept an optional second argument
- [ ] Refactor the local `makeOklch` closure inside `injectPaletteCSS`: the current closure duplicates `clampedOklchString` and `tugPaletteColor` logic. Replace it so the fallback path (no anchors) calls `tugPaletteColor(hueName, stop, params)` directly and the anchor path calls `tugAnchoredColor(hueName, stop, anchorData[hueName])`. This eliminates the duplicated chroma capping and formatting code
- [ ] When `anchorData` is provided: for each hue, use `tugAnchoredColor(hueName, stop, anchorData[hueName])` instead of the smoothstep `intensityToLC` call
- [ ] When `anchorData` is omitted: keep existing smoothstep behavior unchanged (backward compatibility), using `tugPaletteColor` in the refactored path
- [ ] Ensure named tone aliases (soft=15, default=50, strong=75, intense=100) also use anchor interpolation when `anchorData` is provided
- [ ] Remove `readHueOverrides()` entirely: no code in the codebase ever sets `--tug-theme-hue-*` CSS variables, making it dead code. The hue angles come from the static `HUE_FAMILIES` constant. Also remove the `readHueOverrides` call from `injectPaletteCSS` and use `HUE_FAMILIES` directly
- [ ] When `anchorData` is provided, skip the `readThemeParams()` call (anchor data replaces L/C parameters). When `anchorData` is omitted, keep `readThemeParams()` for backward compatibility

**Tests:**
Note: `testAnchors` below refers to a locally-constructed test fixture (inline anchor data for all 24 hues with 3 anchors each), not the imported `BRIO_ANCHORS` from `theme-anchors.ts` (which is built in Step 2). This keeps Step 3 independently testable.
- [ ] `injectPaletteCSS('brio')` without anchor data produces the same CSS output as before (exact match, verifying the `makeOklch` refactoring is behavior-preserving)
- [ ] `injectPaletteCSS('brio', testAnchors)` produces CSS with 264 numeric stop + 96 alias variables
- [ ] Anchor-based injection: `--tug-palette-hue-25-red-tone-50` contains an oklch value matching `tugAnchoredColor('red', 50, testAnchors.red)`
- [ ] Anchor-based soft alias `--tug-palette-hue-25-red-soft` matches `tugAnchoredColor('red', 15, testAnchors.red)`
- [ ] Calling `injectPaletteCSS` twice (once with anchors, once without) still produces only one `<style id="tug-palette">` element

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test src/__tests__/palette-engine.test.ts` -- all existing and new tests pass

---

#### Step 4: Wire anchor data into call sites {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat(palette): wire per-theme anchor data into main.tsx and theme-provider.tsx`

**References:** [D02] direct JS anchors, Spec S03, (#rollout, #dependencies)

**Artifacts:**
- Modified file: `tugdeck/src/main.tsx` (pass anchor data to `injectPaletteCSS`)
- Modified file: `tugdeck/src/contexts/theme-provider.tsx` (pass anchor data to `injectPaletteCSS`)

**Tasks:**
- [ ] In `main.tsx`, import `DEFAULT_ANCHOR_DATA` from `theme-anchors.ts`. Update the `injectPaletteCSS(initialTheme)` call to `injectPaletteCSS(initialTheme, DEFAULT_ANCHOR_DATA[initialTheme])`. No type narrowing is needed: `ThemeName` and `keyof ThemeAnchorData` are the same union type (`"brio" | "bluenote" | "harmony"`)
- [ ] In `theme-provider.tsx`, import `DEFAULT_ANCHOR_DATA` from `theme-anchors.ts`. Update the `injectPaletteCSS(newTheme)` call inside `setTheme()` to `injectPaletteCSS(newTheme, DEFAULT_ANCHOR_DATA[newTheme])`
- [ ] Verify boot-time injection still happens synchronously before React mounts

**Tests:**
- [ ] After app boot with brio, `<style id="tug-palette">` contains anchor-based palette values (spot-check red tone-50 matches `tugAnchoredColor`)
- [ ] After switching brio -> bluenote, palette re-injects with bluenote's anchor data (different L/C values at stop 50 vs brio)
- [ ] After switching bluenote -> brio, palette restores brio anchors (no stale bluenote values)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test src/__tests__/palette-engine.test.ts src/__tests__/theme-anchors.test.ts` -- all tests pass (including backward-compat `tugPaletteColor` tests)
- [ ] Manual verification: open app, inspect `<style id="tug-palette">`, confirm anchor-based values present
- [ ] Manual verification: switch themes (brio -> bluenote -> harmony -> brio), confirm palette element updates with different values per theme and no console errors

---

#### Step 5: Gallery anchor editor mode {#step-5}

**Depends on:** #step-2

**Commit:** `feat(palette): add anchor editor mode to GalleryPaletteContent with per-hue editing`

**References:** [D01] per-hue anchors, [D06] chroma safety net, Spec S05, (#bake-in-workflow, #success-criteria)

**Artifacts:**
- Modified file: `tugdeck/src/components/tugways/cards/gallery-palette-content.tsx` (add anchor editor UI)
- Modified file: `tugdeck/src/components/tugways/cards/gallery-palette-content.css` (add anchor editor styles)
- Modified file: `tugdeck/src/__tests__/gallery-palette-content.test.tsx` (add anchor mode tests; existing Curves-mode tests remain unchanged because the mode toggle preserves the existing Curves rendering path -- selecting "Curves" mode renders the identical SwatchGrid and CurveControls components as before)

**Tasks:**
- [ ] Add a top-level mode toggle: "Anchors" (primary, new) vs "Curves" (existing comparison). Default to "Anchors"
- [ ] In Anchors mode, render the 24x11 swatch grid using `tugAnchoredColor` with the current theme's anchor data from local state
- [ ] Add a theme selector `<select>` (brio, bluenote, harmony) that switches which theme's anchors are displayed and edited. Use local `useState` for the selected theme
- [ ] Initialize anchor editing state from `DEFAULT_ANCHOR_DATA` imported from `theme-anchors.ts`
- [ ] Implement click-to-edit: clicking a swatch opens an inline editor below the grid showing:
  - The hue name, stop number, current L and C values
  - Two sliders or number inputs for L (range 0.1--1.0) and C (range 0.0--0.3)
  - An "anchor" checkbox: when checked, this stop is an anchor; when unchecked, it is interpolated
  - A gamut warning indicator (red text) when the input C exceeds `MAX_CHROMA_FOR_HUE[hue]`
- [ ] When the user edits L/C for an anchor, update the local state immediately; the swatch grid re-renders with the new values
- [ ] When the user toggles a stop from interpolated to anchor, freeze its current computed L/C as the anchor value
- [ ] When the user toggles a stop from anchor to interpolated, remove it from the anchors array (recompute from surrounding anchors)
- [ ] Highlight anchor stops visually (e.g., thicker border or dot indicator) to distinguish them from interpolated stops
- [ ] Rules of Tugways compliance: all editing state is local `useState`; swatch colors are inline `style` attributes

**Tests:**
- [ ] GalleryPaletteContent in Anchors mode renders all 24x11 swatches
- [ ] Clicking a swatch opens the inline L/C editor
- [ ] Editing an anchor L value updates the swatch color immediately
- [ ] The gamut warning appears when C exceeds MAX_CHROMA_FOR_HUE for that hue
- [ ] Theme selector switches the displayed anchor data
- [ ] All existing Curves-mode tests in `gallery-palette-content.test.tsx` continue to pass without modification (mode toggle preserves the existing rendering path)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test src/__tests__/gallery-palette-content.test.tsx` -- all existing Curves-mode tests and new Anchors-mode tests pass
- [ ] Manual verification: open gallery palette tab, switch to Anchors mode, click a swatch, edit L/C, verify swatch updates
- [ ] Manual verification: switch theme selector, confirm different anchor values displayed

---

#### Step 6: Gallery JSON export/import {#step-6}

**Depends on:** #step-5

**Commit:** `feat(palette): add JSON export/import to gallery anchor editor`

**References:** [D04] JSON export format, Spec S04, Spec S05, (#bake-in-workflow)

**Artifacts:**
- Modified file: `tugdeck/src/components/tugways/cards/gallery-palette-content.tsx` (add export/import buttons)

**Tasks:**
- [ ] Add an "Export JSON" button that:
  - Serializes the current anchor state for all three themes into the Spec S04 JSON format
  - Creates a Blob and triggers a browser download as `tug-palette-anchors.json`
  - Includes `"version": 1` in the JSON for future schema evolution
- [ ] Add an "Import JSON" button that:
  - Opens a file picker (hidden `<input type="file">`)
  - Reads the selected JSON file
  - Validates the structure: must have `version`, `themes` with `brio`/`bluenote`/`harmony`, each hue has `anchors` array with valid `stop`/`L`/`C` values
  - On valid import: updates local state for all three themes with the imported data
  - On invalid import: shows an error message (using local state, not alert())
- [ ] Rules of Tugways compliance: file picker and download are imperative DOM operations, not React state-driven appearance changes

**Tests:**
- [ ] Export button produces a valid JSON file matching Spec S04 schema
- [ ] Import of a valid JSON file restores the anchor state
- [ ] Import of an invalid JSON file shows an error message without crashing
- [ ] Round-trip: export then import produces identical anchor state

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] Manual verification: export anchors, modify some values, import the file, verify restored state

---

#### Step 7: Gallery integration checkpoint {#step-7}

**Depends on:** #step-4, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] per-hue anchors, [D02] direct JS anchors, [D04] JSON export format, [D06] chroma safety net, Spec S05, Risk R01, Risk R02, (#success-criteria)

**Tasks:**
- [ ] Verify the complete gallery workflow end-to-end:
  - Switch to Anchors mode
  - Edit anchors for multiple hues across all three themes
  - Compare anchor-based palette against smoothstep reference (Curves mode)
  - Export the configuration as JSON
  - Reload the page, import the JSON, verify anchors restored
- [ ] Verify gamut warnings appear for hues with tight chroma caps (yellow, teal, cyan)
- [ ] Verify anchor-based injection works end-to-end with call-site wiring (boot and theme switch)
- [ ] Verify no console errors or warnings during gallery operation

**Tests:**
- [ ] Full test suite passes (palette-engine, theme-anchors, gallery-palette-content)
- [ ] Gallery palette content renders in both Anchors and Curves modes

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` passes
- [ ] `cd tugdeck && bun test` -- all tests pass
- [ ] Manual full walkthrough: anchor editing, theme switching, export/import, side-by-side comparison

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A per-hue, per-theme anchor-based palette engine with research-informed default anchors, an interactive gallery editor supporting per-hue L/C editing with gamut warnings, and JSON export/import for the production bake-in workflow.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugAnchoredColor()` correctly interpolates between per-hue anchors for all 24 hues and all intensities 0--100
- [ ] `injectPaletteCSS(themeName, anchorData)` produces 360 CSS variables using anchor-based computation
- [ ] All three themes (brio, bluenote, harmony) have complete default anchor sets with per-hue canonical L values
- [ ] All 264 standard stops across all themes are sRGB-gamut-safe
- [ ] `tugPaletteColor()` remains backward-compatible (existing call sites unchanged)
- [ ] Gallery anchor editor supports per-hue L/C editing, theme switching, anchor/interpolated toggle, and gamut warnings
- [ ] JSON export/import works end-to-end for all three themes
- [ ] Boot-time and theme-switch injection use anchor data from `DEFAULT_ANCHOR_DATA`

**Acceptance tests:**
- [ ] `tugAnchoredColor('red', 50, brioAnchors.red)` returns an oklch string with L near 0.65 (Table T01)
- [ ] `tugAnchoredColor('yellow', 50, brioAnchors.yellow)` returns an oklch string with L near 0.90 (Table T01)
- [ ] `tugAnchoredColor('blue', 50, bluenoteAnchors.blue)` returns an oklch string with higher L than brio's blue stop-50
- [ ] After boot, `<style id="tug-palette">` contains anchor-interpolated values
- [ ] Exported JSON round-trips: export, import, re-export produces identical JSON

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Remove smoothstep fallback path once all consumers migrate to anchor-based computation
- [ ] Add more than 3 anchors per hue for hues that need finer control (discoverable during gallery tuning)
- [ ] P3 wide-gamut anchor data for displays that support Display P3
- [ ] Wire `--tug-base-accent-*` semantic tokens to anchor-based palette variables (Phase 5d5c)
- [ ] Automated anchor optimization: given a target perceptual metric, auto-suggest anchor adjustments

| Checkpoint | Verification |
|------------|--------------|
| Anchor types compile | `cd tugdeck && bunx tsc --noEmit` |
| Anchor interpolation correct | Unit tests for `tugAnchoredColor` |
| Theme anchors complete | Unit tests for `theme-anchors.ts` |
| Anchor-based injection works | Integration tests for `injectPaletteCSS` with anchors |
| Call sites wired | Manual: boot app, inspect palette variables |
| Gallery editor functional | Manual: open Palette Engine tab, edit anchors |
| Export/import works | Manual: export, modify, import, verify |
| Gamut safety maintained | Unit tests verify all stops sRGB-safe |
