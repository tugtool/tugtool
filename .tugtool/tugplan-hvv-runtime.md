## HueVibVal Runtime System {#hvv-runtime}

**Purpose:** Replace the anchor-based palette injection with the HueVibVal CSS variable system, wire hvvColor into the runtime, add P3 display support, and remove all legacy anchor/smoothstep palette code — shipping a complete three-layer color API (semantic presets, per-hue constants, JS function) for the tugdeck palette.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-06 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugdeck palette engine currently uses two transfer functions (smoothstep and anchor-based interpolation) to map intensity values to OKLCH colors. The HueVibVal system, prototyped in gallery-palette-content.tsx, replaces this with a simpler model based on three axes: Hue (24 named colors), Vibrancy (chroma scaling 0-100), and Value (lightness scaling 0-100). Each named color has a canonical form at vib=50, val=50.

The gallery editor already has a working `hvvColor()` function and `DEFAULT_CANONICAL_L` table. This phase promotes those into palette-engine.ts as the authoritative runtime, builds the CSS variable injection system around them, adds P3 wide-gamut support, and removes all legacy anchor/smoothstep code.

#### Strategy {#strategy}

- Promote hvvColor and canonical constants from gallery-palette-content.tsx into palette-engine.ts as the authoritative source, establishing the core computation layer first.
- Build the CSS variable injection function (injectHvvCSS) that emits three layers: semantic presets, per-hue constants, and the JS API function.
- Add P3 display support via oklchToLinearP3, a MAX_P3_CHROMA_FOR_HUE static table, and a @media (color-gamut: p3) block with wider-gamut presets.
- Wire injectHvvCSS into main.tsx and theme-provider.tsx, replacing injectPaletteCSS calls.
- Add new HVV tests incrementally: Steps 1-3 each add new test blocks to palette-engine.test.ts alongside the existing legacy tests (which still compile and pass at those steps since the legacy code is not yet removed).
- Remove all legacy code in a clean break: anchor types, smoothstep, TONE_ALIASES, theme-anchors.ts, and all related exports — removing legacy test blocks from palette-engine.test.ts and deleting theme-anchors.test.ts atomically in the same step to avoid build-breaking intermediate states. The new HVV test blocks added in Steps 1-3 are kept.
- Update gallery-palette-content.tsx to import hvvColor from palette-engine.ts instead of defining it locally (done in the same step as promotion to ensure test continuity).

#### Success Criteria (Measurable) {#success-criteria}

- `injectHvvCSS('brio')` produces a `<style id="tug-palette">` element containing 168 semantic preset variables (7 presets x 24 hues), 74 per-hue constant variables, and a P3 media block (verified by test)
- All 24 hues x 7 presets produce valid oklch() strings (verified by unit test)
- `@media (color-gamut: p3)` block is present with wider chroma values than the sRGB block (verified by test)
- No references to `injectPaletteCSS`, `tugAnchoredColor`, `tugPaletteColor`, `smoothstep`, `TONE_ALIASES`, `AnchorPoint`, `HueAnchors`, `ThemeHueAnchors`, `ThemeAnchorData`, `interpolateAnchors`, or `theme-anchors.ts` remain in production code (verified by grep)
- `bun test` passes with zero failures
- Gallery editor renders correctly using hvvColor imported from palette-engine.ts

#### Scope {#scope}

1. Promote hvvColor, DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE to palette-engine.ts
2. Implement injectHvvCSS with Layer 1 (semantic presets) and Layer 2 (per-hue constants)
3. Add P3 gamut support: oklchToLinearP3, isInP3Gamut, MAX_P3_CHROMA_FOR_HUE, @media block
4. Wire injectHvvCSS into main.tsx and theme-provider.tsx
5. Remove legacy code and rewrite test suites atomically: smoothstep, anchor types, theme-anchors.ts, TONE_ALIASES, readThemeParams, and their tests in a single step
6. Update gallery-palette-content.tsx imports (done in Step 1 alongside promotion)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Per-theme canonical L tables (all themes share the same tuning for now)
- Preset preview section in the gallery editor (follow-on work)
- Custom user-defined presets beyond the 7 built-in ones
- Runtime recalculation of MAX_CHROMA or MAX_P3_CHROMA tables

#### Dependencies / Prerequisites {#dependencies}

- Tugways Phase 5d5a palette engine must be complete (merged on main)
- gallery-palette-content.tsx hvvColor prototype must be working (confirmed in codebase)

#### Constraints {#constraints}

- Rules of Tugways: injectHvvCSS must use pure DOM manipulation (createElement/textContent), never React state [D08, D09, D40, D42]
- Existing `<style id="tug-palette">` idempotency pattern must be preserved
- CSS variable names use short form: `--tug-{hue}`, not `--tug-hvv-{hue}` or `--tug-palette-hue-*`
- All canonical L values must stay above 0.555 (piecewise min() constraint)

#### Assumptions {#assumptions}

- DEFAULT_CANONICAL_L values from gallery-palette-content.tsx (cherry:0.619 through yellow:0.901) are the authoritative canonical L table
- The P3 @media block reuses the same style element id 'tug-palette' (single style element, sRGB block + P3 override block)
- L_DARK=0.15, L_LIGHT=0.96, PEAK_C_SCALE=2 from gallery-palette-content.tsx become canonical constants
- No production CSS currently references the old `--tug-palette-hue-*` variable names (clean break is safe)
- All three themes (brio, bluenote, harmony) share the same canonical L values for now

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors on all headings and stable labels for design decisions, specs, tables, and lists. See the skeleton for full conventions.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Third breakpoint in piecewise L mapping (DECIDED) {#q01-third-breakpoint}

**Question:** The current hvvColor uses a two-segment piecewise linear for val-to-L (through canonical L at val=50). The gallery editor already added a third breakpoint. Should the runtime match?

**Why it matters:** Mismatched transfer functions between gallery preview and runtime CSS would produce visually different colors.

**Options (if known):**
- Two-segment piecewise (current hvvColor in gallery)
- Three-segment piecewise (matching the gallery editor's latest commit)

**Plan to resolve:** Check the gallery editor code and the latest commit message.

**Resolution:** DECIDED — The latest commit (e82b57a) adds a third breakpoint to the gallery palette. However, the runtime hvvColor function in gallery-palette-content.tsx still uses two-segment piecewise. The CSS pure-piecewise uses min() for two segments. We proceed with two-segment piecewise for this phase; the third breakpoint can be added as a follow-on if the gallery editor ships it to the hvvColor function.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Old CSS variable names referenced somewhere | med | low | Grep for `--tug-palette-hue-` before removing | Any visual regression after step 5 |
| P3 chroma table computation is wrong | med | low | Unit test compares a few known hue angles against manual calculation | Colors look wrong on P3 displays |
| Gallery editor breaks after import change | low | low | Gallery tests verify rendering before and after | Gallery card fails to render |

**Risk R01: Stale CSS variable references** {#r01-stale-refs}

- **Risk:** Some CSS file or JS code may reference old `--tug-palette-hue-*` variable names, causing colors to disappear.
- **Mitigation:** Step 5 includes a comprehensive grep for all old variable patterns before deleting the code. Any references found must be updated before proceeding.
- **Residual risk:** Dynamic string construction could hide references from static grep.

**Risk R02: P3 gamut boundary accuracy** {#r02-p3-gamut}

- **Risk:** The binary-search approach for MAX_P3_CHROMA_FOR_HUE may produce inaccurate values if the OKLCH-to-P3 matrix has precision issues.
- **Mitigation:** Unit tests verify that colors at MAX_P3_CHROMA are inside P3 gamut and colors slightly above are outside. Same validation approach used for sRGB table.
- **Residual risk:** Floating point edge cases at extreme hue angles.

---

### Design Decisions {#design-decisions}

#### [D01] Three-layer CSS variable architecture (DECIDED) {#d01-three-layers}

**Decision:** The HVV system emits CSS variables in three layers: Layer 1 semantic presets (168 vars), Layer 2 per-hue constants (74 vars), and Layer 3 is the JS hvvColor() function for programmatic use.

**Rationale:**
- Presets cover the common use cases without requiring JS
- Per-hue constants enable CSS-only custom derivations via calc()
- JS API covers dynamic/programmatic needs

**Implications:**
- injectHvvCSS must emit both Layer 1 and Layer 2 in a single :root block
- Total variable count: 168 + 74 = 242 CSS variables (plus P3 overrides)

#### [D02] Short-form CSS variable naming (DECIDED) {#d02-short-names}

**Decision:** CSS variables use `--tug-{hue}` for canonical, `--tug-{hue}-{preset}` for presets, and `--tug-{hue}-h`, `--tug-{hue}-canonical-l`, `--tug-{hue}-peak-c` for per-hue constants. Global constants: `--tug-l-dark`, `--tug-l-light`.

**Rationale:**
- Short names are easier to type and read in CSS
- The `--tug-` prefix is sufficient namespace; no need for `--tug-hvv-` or `--tug-palette-hue-`
- Matches the approved proposal naming scheme

**Implications:**
- Complete break from old `--tug-palette-hue-<angle>-<name>-tone-<intensity>` naming
- No backward compatibility layer needed (no production CSS uses old names)

#### [D03] Seven semantic presets per hue (DECIDED) {#d03-seven-presets}

**Decision:** Each hue gets 7 presets with fixed vib/val mappings: canonical(50/50), accent(80/50), muted(25/55), light(30/82), subtle(15/92), dark(50/25), deep(70/15).

**Rationale:**
- Covers the most common UI color needs (primary, accent, muted text, backgrounds, dark themes)
- Fixed mappings mean presets are predictable and consistent across hues
- 7 presets x 24 hues = 168 variables is manageable

**Implications:**
- Preset variable format: `--tug-{hue}` (canonical) and `--tug-{hue}-{preset}` for the other six
- Each sRGB preset computes via `hvvColor(hue, vib, val, canonicalL)` (default peak chroma)
- Each P3 preset computes via `hvvColor(hue, vib, val, canonicalL, p3PeakChroma)` using the optional `peakChroma` parameter

#### [D04] Pure CSS piecewise mapping via min() trick (DECIDED) {#d04-piecewise-min}

**Decision:** The val-to-L mapping uses a two-segment piecewise linear through canonical L at val=50. The CSS representation uses min(segment1, segment2) because all canonical L values are above 0.555. The vib-to-C mapping is linear: calc(var(--vib) / 100 * var(--tug-{hue}-peak-c)).

**Rationale:**
- All canonical L values in DEFAULT_CANONICAL_L are well above 0.555 (minimum is cherry at 0.619)
- min() of two linear segments produces the correct piecewise curve when the breakpoint L > midpoint of L_DARK and L_LIGHT
- Linear C mapping is simple and correct

**Implications:**
- Gallery editor must enforce canonical L floor of 0.555
- Per-hue constants (canonical-l, peak-c) enable CSS-only color derivation

#### [D05] P3 support via @media block (DECIDED) {#d05-p3-media}

**Decision:** Add oklchToLinearP3() and isInP3Gamut() to palette-engine.ts, compute a static MAX_P3_CHROMA_FOR_HUE table using the same binary-search method as sRGB, and emit a `@media (color-gamut: p3)` block with wider-gamut presets and constants. P3 peak chroma = MAX_P3_CHROMA_FOR_HUE * PEAK_C_SCALE (same 2x scale).

**Rationale:**
- P3 displays can show more saturated colors; the system should take advantage of this
- Same binary-search/static-table approach as sRGB means consistent methodology
- @media block means sRGB displays are unaffected

**Implications:**
- Two sets of presets in the CSS: sRGB defaults and P3 overrides
- MAX_P3_CHROMA_FOR_HUE values will be larger than MAX_CHROMA_FOR_HUE for most hues
- P3 peak-c constants are emitted inside the @media block

#### [D06] Clean break from legacy code (DECIDED) {#d06-clean-break}

**Decision:** Remove all anchor-based palette code in a single step: injectPaletteCSS, tugPaletteColor, tugAnchoredColor, smoothstep, intensityToLC, TONE_ALIASES, readThemeParams, clampedOklchString, AnchorPoint, HueAnchors, ThemeHueAnchors, ThemeAnchorData, interpolateAnchors, STANDARD_STOPS, tugPaletteVarName. Delete theme-anchors.ts entirely (DEFAULT_ANCHOR_DATA, STOP_50_L, buildSharedAnchors, BRIO/BLUENOTE/HARMONY_ANCHORS).

**Rationale:**
- No production CSS references the old variable names
- Leaving dead code creates confusion and maintenance burden
- The HVV system is a complete replacement, not an incremental addition

**Implications:**
- palette-engine.test.ts and theme-anchors.test.ts must be rewritten atomically alongside code removal (single step) to avoid a build-breaking intermediate state
- main.tsx and theme-provider.tsx import statements change
- Keep: HUE_FAMILIES, MAX_CHROMA_FOR_HUE, findMaxChroma, oklchToLinearSRGB, isInSRGBGamut, _deriveChromaCaps, LCParams, DEFAULT_LC_PARAMS

#### [D08] Re-derive chroma tables for HVV L range (DECIDED) {#d08-rederive-chroma}

**Decision:** Both MAX_CHROMA_FOR_HUE (sRGB) and MAX_P3_CHROMA_FOR_HUE (P3) are re-derived using L sample points from the HVV system's actual L range (L_DARK=0.15, per-hue canonical L from Table T02, L_LIGHT=0.96) instead of the legacy smoothstep range (L_MIN=0.42, L_MID=0.69). The existing _deriveChromaCaps helper is refactored to accept L sample points, an optional chroma cap, and a gamut checker as parameters. For sRGB, the chroma cap (DEFAULT_LC_PARAMS.cMax=0.22) is retained. For P3, no chroma cap is applied — the binary search result is used directly (with the standard 2% safety margin).

**Rationale:**
- The legacy _deriveChromaCaps samples at L=0.42 (smoothstep lMin) and L=0.69 (midpoint) — neither of which is the darkest L in HVV (L_DARK=0.15) or the per-hue canonical L
- HVV presets span L_DARK=0.15 (deep preset, val=15) through L_LIGHT=0.96, so the chroma cap must be safe across this wider L range
- The P3 gamut is strictly larger than sRGB; capping P3 chroma at 0.22 (sRGB cMax) would negate the purpose of P3 support
- The L sample points for derivation should be: L_DARK (0.15), the per-hue canonical L (from Table T02), and L_LIGHT (0.96); the minimum safe chroma across all three points becomes the cap for that hue

**Implications:**
- MAX_CHROMA_FOR_HUE values will change from the current hardcoded table (some values may decrease due to the wider L range sampling at L=0.15)
- _deriveChromaCaps becomes a parameterized helper: `_deriveChromaCaps(lSamples, gamutCheck, maxCap?)`
- _deriveP3ChromaCaps calls the same helper with isInP3Gamut and no maxCap
- Tests that assert specific MAX_CHROMA_FOR_HUE values must be updated with the new values

#### [D07] injectHvvCSS replaces injectPaletteCSS (DECIDED) {#d07-inject-hvv}

**Decision:** New function `injectHvvCSS(themeName: string)` replaces `injectPaletteCSS`. Called from main.tsx at boot and theme-provider.tsx on theme switch. Reuses the same `<style id="tug-palette">` element and idempotency pattern.

**Rationale:**
- Same injection pattern means no changes to the DOM lifecycle
- Theme name parameter allows future per-theme canonical L tables
- Simpler signature: no anchor data parameter needed

**Implications:**
- main.tsx call changes from `injectPaletteCSS(theme, DEFAULT_ANCHOR_DATA[theme])` to `injectHvvCSS(theme)`
- theme-provider.tsx call changes similarly
- DEFAULT_ANCHOR_DATA import is removed from both files

---

### Specification {#specification}

#### Terminology and Naming {#terminology}

**Table T01: HVV Terminology** {#t01-terminology}

| Term | Definition |
|------|-----------|
| Hue | One of 24 named color families (cherry through berry), mapped to OKLCH hue angles |
| Vibrancy (vib) | Chroma axis scaled 0-100. At vib=50, chroma equals the sRGB-safe max. Above 50 pushes into P3 |
| Value (val) | Lightness axis scaled 0-100. val=50 produces the canonical lightness for the hue |
| Canonical color | The reference color for a hue at vib=50, val=50 |
| Canonical L | The OKLCH lightness of a hue's canonical color. Per-hue, tunable, must be > 0.555 |
| Preset | A named vib/val combination (e.g., accent=vib:80/val:50) |
| Peak chroma | The maximum chroma at vib=100. Defaults to MAX_CHROMA_FOR_HUE * PEAK_C_SCALE (sRGB). For P3, MAX_P3_CHROMA_FOR_HUE * PEAK_C_SCALE |

#### CSS Variable Specification {#css-vars}

**Spec S01: Layer 1 — Semantic Presets (168 vars)** {#s01-semantic-presets}

7 presets per hue, 24 hues = 168 variables.

| Preset | CSS Variable | Vib | Val |
|--------|-------------|-----|-----|
| canonical | `--tug-{hue}` | 50 | 50 |
| accent | `--tug-{hue}-accent` | 80 | 50 |
| muted | `--tug-{hue}-muted` | 25 | 55 |
| light | `--tug-{hue}-light` | 30 | 82 |
| subtle | `--tug-{hue}-subtle` | 15 | 92 |
| dark | `--tug-{hue}-dark` | 50 | 25 |
| deep | `--tug-{hue}-deep` | 70 | 15 |

**Spec S02: Layer 2 — Per-Hue Constants (74 vars)** {#s02-per-hue-constants}

3 constants per hue (72 vars) + 2 global constants = 74 variables.

| Variable | Description |
|----------|-------------|
| `--tug-{hue}-h` | OKLCH hue angle (degrees) |
| `--tug-{hue}-canonical-l` | Canonical lightness for this hue |
| `--tug-{hue}-peak-c` | Peak chroma for this hue (MAX_CHROMA_FOR_HUE * PEAK_C_SCALE) |
| `--tug-l-dark` | Global dark lightness (0.15) |
| `--tug-l-light` | Global light lightness (0.96) |

**Spec S03: P3 @media block** {#s03-p3-media}

Inside `@media (color-gamut: p3) { :root { ... } }`, emit:

- All 168 presets recomputed with P3 peak chroma (MAX_P3_CHROMA_FOR_HUE * PEAK_C_SCALE)
- Per-hue `--tug-{hue}-peak-c` overridden with P3 peak chroma values

The sRGB per-hue constants (`-h` and `-canonical-l`) are not overridden since they are gamut-independent.

The `oklchToLinearP3` conversion uses the same OKLab pipeline as `oklchToLinearSRGB` (steps 1-3 are identical) but substitutes the LMS-to-linear-Display-P3 matrix in step 4. Matrix coefficients are derived from the Display P3 primaries and D65 white point per the CSS Color 4 specification: https://www.w3.org/TR/css-color-4/#color-conversion-code

**Spec S04: hvvColor function signature** {#s04-hvv-color}

```typescript
export function hvvColor(
  hueName: string,
  vib: number,
  val: number,
  canonicalL: number,
  peakChroma?: number,
): string
```

Returns an `oklch(L C h)` CSS string. val-to-L is piecewise linear through canonicalL at val=50 (L_DARK at val=0, L_LIGHT at val=100). vib-to-C is linear from 0 to peakC.

The optional `peakChroma` parameter overrides the default peak chroma (`MAX_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE`). When omitted, the sRGB-derived default is used. When provided, the caller supplies the peak chroma directly (e.g., `MAX_P3_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE` for P3 presets). This enables `injectHvvCSS` to compute both sRGB and P3 preset values through the same function without duplicating color logic.

**Spec S05: injectHvvCSS function signature** {#s05-inject-hvv}

```typescript
export function injectHvvCSS(themeName: string): void
```

Creates or replaces a `<style id="tug-palette">` element. Emits:
1. `:root { }` block with Layer 1 presets (168 vars) and Layer 2 constants (74 vars) using sRGB chroma
2. `@media (color-gamut: p3) { :root { } }` block with P3-overridden presets and peak-c constants

**Spec S06: Chroma cap derivation helper** {#s06-derive-chroma-caps}

```typescript
function _deriveChromaCaps(
  lSamples: (hue: string) => number[],
  gamutCheck: (L: number, C: number, h: number, epsilon?: number) => boolean,
  maxCap?: number,
): Record<string, number>
```

For each hue, binary-searches the maximum safe chroma at each L sample point (via `findMaxChroma` with the provided `gamutCheck`), takes the minimum across all sample points, applies the 2% safety margin, and optionally caps at `maxCap`.

**sRGB derivation:** `_deriveChromaCaps(hvvLSamples, isInSRGBGamut, DEFAULT_LC_PARAMS.cMax)` where `hvvLSamples(hue)` returns `[L_DARK, DEFAULT_CANONICAL_L[hue], L_LIGHT]`.

**P3 derivation:** `_deriveChromaCaps(hvvLSamples, isInP3Gamut)` — no `maxCap` parameter, allowing P3 chroma to exceed 0.22.

#### Canonical L Table {#canonical-l-table}

**Table T02: DEFAULT_CANONICAL_L** {#t02-canonical-l}

| Hue | Canonical L |
|-----|-------------|
| cherry | 0.619 |
| red | 0.659 |
| tomato | 0.704 |
| flame | 0.740 |
| orange | 0.780 |
| amber | 0.821 |
| gold | 0.852 |
| yellow | 0.901 |
| lime | 0.861 |
| green | 0.821 |
| mint | 0.807 |
| teal | 0.803 |
| cyan | 0.803 |
| sky | 0.807 |
| blue | 0.771 |
| cobalt | 0.744 |
| violet | 0.708 |
| purple | 0.686 |
| plum | 0.731 |
| pink | 0.794 |
| rose | 0.758 |
| magenta | 0.726 |
| berry | 0.668 |
| coral | 0.632 |

**List L01: Symbols to keep in palette-engine.ts** {#l01-keep-symbols}

- HUE_FAMILIES
- MAX_CHROMA_FOR_HUE
- findMaxChroma
- oklchToLinearSRGB (exported: used by _deriveChromaCaps, findMaxChroma, and tests for gamut safety verification)
- isInSRGBGamut (exported: used as default gamut checker by _deriveChromaCaps and findMaxChroma, and by tests)
- _deriveChromaCaps
- LCParams
- DEFAULT_LC_PARAMS (used by findMaxChroma)

**List L02: Symbols to remove from palette-engine.ts** {#l02-remove-symbols}

- injectPaletteCSS
- tugPaletteColor
- tugAnchoredColor
- smoothstep
- intensityToLC
- TONE_ALIASES
- readThemeParams
- clampedOklchString
- tugPaletteVarName
- STANDARD_STOPS
- AnchorPoint (interface)
- HueAnchors (interface)
- ThemeHueAnchors (type)
- ThemeAnchorData (type)
- interpolateAnchors

**List L03: Symbols to remove — theme-anchors.ts (delete entire file)** {#l03-remove-theme-anchors}

- DEFAULT_ANCHOR_DATA
- STOP_50_L
- buildSharedAnchors
- BRIO_ANCHORS
- BLUENOTE_ANCHORS
- HARMONY_ANCHORS

**List L04: Preset definitions** {#l04-presets}

| Preset Name | Vib | Val |
|-------------|-----|-----|
| canonical | 50 | 50 |
| accent | 80 | 50 |
| muted | 25 | 55 |
| light | 30 | 82 |
| subtle | 15 | 92 |
| dark | 50 | 25 |
| deep | 70 | 15 |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| (none — all changes are to existing files) | |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DEFAULT_CANONICAL_L` | const | `palette-engine.ts` | Promoted from gallery-palette-content.tsx, Table T02 |
| `L_DARK` | const | `palette-engine.ts` | 0.15, promoted from gallery-palette-content.tsx |
| `L_LIGHT` | const | `palette-engine.ts` | 0.96, promoted from gallery-palette-content.tsx |
| `PEAK_C_SCALE` | const | `palette-engine.ts` | 2, promoted from gallery-palette-content.tsx |
| `HVV_PRESETS` | const | `palette-engine.ts` | Map of preset name to {vib, val}, List L04 |
| `hvvColor` | fn | `palette-engine.ts` | Promoted from gallery-palette-content.tsx, Spec S04 |
| `injectHvvCSS` | fn | `palette-engine.ts` | New, replaces injectPaletteCSS, Spec S05 |
| `findMaxChroma` | fn (modified) | `palette-engine.ts` | Add optional `gamutCheck` parameter, defaults to isInSRGBGamut |
| `oklchToLinearP3` | fn | `palette-engine.ts` | New, OKLCH to linear P3 conversion |
| `isInP3Gamut` | fn | `palette-engine.ts` | New, P3 gamut check |
| `_deriveChromaCaps` | fn (modified) | `palette-engine.ts` | Refactored to accept lSamples, gamutCheck, maxCap? per Spec S06 |
| `MAX_CHROMA_FOR_HUE` | const (re-derived) | `palette-engine.ts` | Re-derived with HVV L sample points per [D08] |
| `MAX_P3_CHROMA_FOR_HUE` | const | `palette-engine.ts` | New, derived via _deriveChromaCaps with isInP3Gamut, no maxCap |
| `_deriveP3ChromaCaps` | fn | `palette-engine.ts` | New, calls _deriveChromaCaps with P3 gamut checker and no cap |

---

### Documentation Plan {#documentation-plan}

- [ ] Update palette-engine.ts module JSDoc header to describe HVV system
- [ ] Add JSDoc to all new exported symbols
- [ ] Update gallery-palette-content.tsx module header to note hvvColor is imported from palette-engine

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test hvvColor, preset computation, P3 gamut checks | Core color math, edge cases |
| **Integration** | Test injectHvvCSS output (DOM element content) | CSS variable injection, variable counts |
| **Contract** | Verify CSS variable names match naming spec | Spec S01, S02, S03 compliance |
| **Drift Prevention** | Verify legacy symbols are gone | Grep-based removal verification |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Promote hvvColor and canonical constants to palette-engine.ts {#step-1}

**Commit:** `feat(palette): promote hvvColor and canonical constants from gallery to palette-engine`

**References:** [D01] Three-layer CSS variable architecture, [D06] Clean break from legacy code, [D08] Re-derive chroma tables for HVV L range, Table T02, List L01, Spec S04, Spec S06, (#canonical-l-table, #terminology)

**Artifacts:**
- palette-engine.ts: add DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE, HVV_PRESETS, hvvColor; refactor _deriveChromaCaps to accept parameters; re-derive and update MAX_CHROMA_FOR_HUE
- gallery-palette-content.tsx: remove local definitions of DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE, hvvColor; import hvvColor, DEFAULT_CANONICAL_L, L_DARK, L_LIGHT from palette-engine.ts (PEAK_C_SCALE is not imported — only used internally by hvvColor)

**Tasks:**
- [ ] Add `DEFAULT_CANONICAL_L` constant to palette-engine.ts with values from Table T02
- [ ] Add `L_DARK = 0.15`, `L_LIGHT = 0.96`, `PEAK_C_SCALE = 2` as exported constants
- [ ] Add `HVV_PRESETS` constant mapping preset names to {vib, val} per List L04
- [ ] Move `hvvColor` function to palette-engine.ts with an added optional `peakChroma?: number` fifth parameter per Spec S04. When omitted, defaults to `MAX_CHROMA_FOR_HUE[hueName] * PEAK_C_SCALE` (preserving existing behavior). When provided, uses the caller-supplied value directly. This enables P3 preset computation in Step 3.
- [ ] Export hvvColor, DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE, HVV_PRESETS from palette-engine.ts
- [ ] Refactor `_deriveChromaCaps` to accept parameters per Spec S06: `_deriveChromaCaps(lSamples, gamutCheck, maxCap?)`. The existing behavior (legacy L sample points, sRGB gamut check, cMax cap) becomes the specific sRGB invocation.
- [ ] Re-derive `MAX_CHROMA_FOR_HUE` using HVV L sample points: for each hue, sample at `[L_DARK (0.15), DEFAULT_CANONICAL_L[hue], L_LIGHT (0.96)]`, binary-search max chroma at each L via `findMaxChroma`, take the minimum, apply 2% safety margin, cap at DEFAULT_LC_PARAMS.cMax (0.22). Run `_deriveChromaCaps(hvvLSamples, isInSRGBGamut, DEFAULT_LC_PARAMS.cMax)` and paste the new values into the hardcoded table. Values will likely decrease for some hues due to the wider L range (especially L_DARK=0.15).
- [ ] Update any tests that assert specific MAX_CHROMA_FOR_HUE values to match the new re-derived table
- [ ] In gallery-palette-content.tsx: remove local DEFAULT_CANONICAL_L, L_DARK, L_LIGHT, PEAK_C_SCALE, hvvColor definitions (PEAK_C_SCALE local const is removed but not re-imported since hvvColor now handles it internally)
- [ ] In gallery-palette-content.tsx: import hvvColor, DEFAULT_CANONICAL_L, L_DARK, L_LIGHT from palette-engine.ts (do NOT import PEAK_C_SCALE — it is only used internally by hvvColor in palette-engine.ts and is not referenced anywhere else in gallery-palette-content.tsx; importing it would trigger an unused-import lint warning, which is a build failure under warnings-are-errors policy)
- [ ] Verify gallery-palette-content.tsx still uses HVV_PRESETS-compatible vib/val values in its UI (VIB_STEPS, VAL_STEPS remain local as they are UI-only)
- [ ] Verify buildExportPayload in gallery-palette-content.tsx still works correctly — it references L_DARK and L_LIGHT which are now imported from palette-engine.ts rather than defined locally. Confirm the import covers both constants and the export payload round-trip test passes.
- [ ] Update gallery-palette-content.test.tsx: change `hvvColor` import from `gallery-palette-content` to `palette-engine` (hvvColor is no longer exported from gallery-palette-content.tsx after this step)

**Tests:** (new tests added to palette-engine.test.ts alongside existing legacy tests, which still compile at this step)
- [ ] Unit test: hvvColor('red', 50, 50, 0.659) returns valid oklch string with L=0.659
- [ ] Unit test: hvvColor('red', 0, 50, 0.659) returns oklch with C=0 (zero vibrancy)
- [ ] Unit test: hvvColor('red', 50, 0, 0.659) returns oklch with L=0.15 (val=0 gives L_DARK)
- [ ] Unit test: hvvColor('red', 50, 100, 0.659) returns oklch with L=0.96 (val=100 gives L_LIGHT)
- [ ] Unit test: hvvColor('red', 100, 50, 0.659) returns oklch with C = MAX_CHROMA_FOR_HUE['red'] * 2 (default peak chroma)
- [ ] Unit test: hvvColor('red', 100, 50, 0.659, 0.5) returns oklch with C = 0.5 (explicit peakChroma overrides default)
- [ ] Unit test: hvvColor('red', 50, 50, 0.659) with no peakChroma matches hvvColor('red', 50, 50, 0.659, MAX_CHROMA_FOR_HUE['red'] * PEAK_C_SCALE) — explicit default equivalence
- [ ] Unit test: all 24 hue names produce valid oklch strings at canonical (50/50)
- [ ] Unit test: HVV_PRESETS has exactly 7 entries with correct vib/val per List L04
- [ ] Unit test: MAX_CHROMA_FOR_HUE values match re-derived table (spot-check a few hues against _deriveChromaCaps output with HVV L sample points)
- [ ] Existing gallery-palette-content tests continue to pass (with updated hvvColor import path)
- [ ] Existing `buildExportPayload -> parseImportPayload` round-trip test in gallery-palette-content.test.tsx passes (this existing test already verifies L_DARK/L_LIGHT are correct; no new test needed)

**Checkpoint:**
- [ ] `bun test` passes
- [ ] gallery-palette-content.tsx has no local hvvColor definition (grep confirms)
- [ ] gallery-palette-content.test.tsx imports hvvColor from palette-engine, not gallery-palette-content

---

#### Step 2: Implement injectHvvCSS with sRGB presets and per-hue constants {#step-2}

**Depends on:** #step-1

**Commit:** `feat(palette): implement injectHvvCSS with Layer 1 presets and Layer 2 constants`

**References:** [D01] Three-layer CSS variable architecture, [D02] Short-form CSS variable naming, [D03] Seven semantic presets, [D07] injectHvvCSS replaces injectPaletteCSS, Spec S01, Spec S02, Spec S05, List L04, (#css-vars)

**Artifacts:**
- palette-engine.ts: add injectHvvCSS function

**Tasks:**
- [ ] Implement `injectHvvCSS(themeName: string)` in palette-engine.ts
- [ ] Emit `:root { }` block containing:
  - Layer 1: 168 semantic preset variables (7 presets x 24 hues) per Spec S01
  - Layer 2: 74 per-hue constants per Spec S02 (72 per-hue + 2 global)
- [ ] Use hvvColor to compute each preset's oklch value with DEFAULT_CANONICAL_L
- [ ] Reuse existing PALETTE_STYLE_ID ('tug-palette') and idempotency pattern
- [ ] Export injectHvvCSS from palette-engine.ts
- [ ] Variable naming per [D02]: `--tug-{hue}` for canonical, `--tug-{hue}-{preset}` for others, `--tug-{hue}-h/canonical-l/peak-c` for constants

**Tests:** (new tests added to palette-engine.test.ts alongside existing legacy tests, which still compile at this step)
- [ ] Integration test: injectHvvCSS('brio') creates `<style id="tug-palette">` element
- [ ] Integration test: CSS contains `--tug-red:` with oklch value (canonical preset)
- [ ] Integration test: CSS contains `--tug-red-accent:` with oklch value
- [ ] Integration test: CSS contains all 7 preset names for red (canonical, accent, muted, light, subtle, dark, deep)
- [ ] Integration test: total preset variable count is 168 (regex count of `--tug-{hue}` patterns)
- [ ] Integration test: CSS contains `--tug-red-h: 25` (per-hue constant)
- [ ] Integration test: CSS contains `--tug-red-canonical-l:` with value
- [ ] Integration test: CSS contains `--tug-red-peak-c:` with value
- [ ] Integration test: CSS contains `--tug-l-dark: 0.15` and `--tug-l-light: 0.96`
- [ ] Integration test: total constant variable count is 74
- [ ] Integration test: idempotent — calling twice creates only one style element

**Checkpoint:**
- [ ] `bun test` passes
- [ ] Manual inspection: injectHvvCSS output has correct variable names and counts

---

#### Step 3: Add P3 gamut support {#step-3}

**Depends on:** #step-2

**Commit:** `feat(palette): add P3 display support with oklchToLinearP3, MAX_P3_CHROMA_FOR_HUE, and @media block`

**References:** [D05] P3 support via @media block, [D08] Re-derive chroma tables for HVV L range, Spec S03, Spec S06, Risk R02, (#css-vars)

**Artifacts:**
- palette-engine.ts: add oklchToLinearP3, isInP3Gamut, _deriveP3ChromaCaps, MAX_P3_CHROMA_FOR_HUE
- palette-engine.ts: update injectHvvCSS to emit @media (color-gamut: p3) block

**Tasks:**
- [ ] Implement `oklchToLinearP3(L, C, h)` — same pipeline as oklchToLinearSRGB but with the LMS-to-linear-Display-P3 matrix in step 4 (instead of the LMS-to-linear-sRGB matrix). Steps 1-3 are identical (OKLCH polar to OKLab Cartesian, OKLab to LMS via inverse OKLab M1 matrix, cube-root undo). The LMS-to-linear-P3 matrix coefficients are derived from the Display P3 primaries and D65 white point; source: https://www.w3.org/TR/css-color-4/#color-conversion-code (see "LMS to Display P3" in the CSS Color 4 reference code). An alternative derivation is available at https://bottosson.github.io/posts/oklab/ by composing the OKLab LMS matrix with the XYZ-to-Display-P3 matrix from the CSS Color 4 spec.
- [ ] Implement `isInP3Gamut(L, C, h, epsilon)` — same pattern as isInSRGBGamut but using oklchToLinearP3
- [ ] Add optional `gamutCheck` parameter to `findMaxChroma`: `findMaxChroma(L, h, maxSearch?, steps?, gamutCheck?)` where `gamutCheck` defaults to `isInSRGBGamut`. This allows reuse for P3: `findMaxChroma(L, h, 0.4, 32, isInP3Gamut)`.
- [ ] Implement `_deriveP3ChromaCaps()` by calling the parameterized `_deriveChromaCaps(hvvLSamples, isInP3Gamut)` with NO `maxCap` parameter. This is critical: the legacy `_deriveChromaCaps` included `Math.min(..., DEFAULT_LC_PARAMS.cMax)` which would silently clamp all P3 chroma to 0.22 (the sRGB ceiling). P3 chroma values must be allowed to exceed 0.22 — that is the entire point of P3 support. The HVV L sample points (L_DARK, per-hue canonical L, L_LIGHT) are used, same as the sRGB re-derivation in Step 1.
- [ ] Add `MAX_P3_CHROMA_FOR_HUE` static table (computed once via _deriveP3ChromaCaps, hardcoded like the sRGB table). Values will be larger than MAX_CHROMA_FOR_HUE for all 24 hues.
- [ ] Update `injectHvvCSS` to append `@media (color-gamut: p3) { :root { ... } }` block with:
  - P3-recomputed presets by calling `hvvColor(hue, vib, val, canonicalL, MAX_P3_CHROMA_FOR_HUE[hue] * PEAK_C_SCALE)` — the optional `peakChroma` parameter (Spec S04) overrides the default sRGB peak chroma with the wider P3 value
  - P3 `--tug-{hue}-peak-c` overrides with `MAX_P3_CHROMA_FOR_HUE[hue] * PEAK_C_SCALE` values
- [ ] Verify that P3 chroma values are larger than sRGB chroma values for all hues (the P3 gamut is strictly wider)

**Tests:** (new tests added to palette-engine.test.ts alongside existing legacy tests, which still compile at this step)
- [ ] Unit test: oklchToLinearP3 returns {r, g, b} for a known OKLCH color
- [ ] Unit test: isInP3Gamut returns true for a color inside P3 gamut
- [ ] Unit test: isInP3Gamut returns false for a color outside P3 gamut
- [ ] Unit test: MAX_P3_CHROMA_FOR_HUE has 24 entries, all > corresponding MAX_CHROMA_FOR_HUE entries
- [ ] Integration test: injectHvvCSS output contains `@media (color-gamut: p3)`
- [ ] Integration test: P3 block contains `--tug-red:` with wider chroma than sRGB block
- [ ] Integration test: P3 block contains `--tug-red-peak-c:` with value > sRGB peak-c

**Checkpoint:**
- [ ] `bun test` passes
- [ ] P3 chroma values are all strictly greater than sRGB values (verified in test)

---

#### Step 4: Wire injectHvvCSS into main.tsx and theme-provider.tsx {#step-4}

**Depends on:** #step-3

**Commit:** `feat(palette): wire injectHvvCSS into boot and theme-switch paths`

**References:** [D07] injectHvvCSS replaces injectPaletteCSS, [D06] Clean break from legacy code, (#context, #strategy)

**Artifacts:**
- main.tsx: replace injectPaletteCSS call with injectHvvCSS
- theme-provider.tsx: replace injectPaletteCSS call with injectHvvCSS
- Both files: remove DEFAULT_ANCHOR_DATA import from theme-anchors.ts

**Tasks:**
- [ ] In main.tsx (line 45): replace `injectPaletteCSS(initialTheme, DEFAULT_ANCHOR_DATA[initialTheme])` with `injectHvvCSS(initialTheme)`
- [ ] In main.tsx: update import — remove `injectPaletteCSS` from palette-engine import, add `injectHvvCSS`
- [ ] In main.tsx: remove `DEFAULT_ANCHOR_DATA` import from theme-anchors.ts
- [ ] In theme-provider.tsx (line 183): replace `injectPaletteCSS(newTheme, DEFAULT_ANCHOR_DATA[newTheme])` with `injectHvvCSS(newTheme)`
- [ ] In theme-provider.tsx: update import — remove `injectPaletteCSS` from palette-engine import, add `injectHvvCSS`
- [ ] In theme-provider.tsx: remove `DEFAULT_ANCHOR_DATA` import from theme-anchors.ts
- [ ] Verify no other files import from theme-anchors.ts (grep check)

**Tests:**
- [ ] Existing theme integration tests still pass
- [ ] Grep confirms no remaining imports of `injectPaletteCSS` or `DEFAULT_ANCHOR_DATA` in main.tsx or theme-provider.tsx

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `grep -r "injectPaletteCSS" src/main.tsx src/contexts/theme-provider.tsx` returns no matches
- [ ] `grep -r "DEFAULT_ANCHOR_DATA" src/main.tsx src/contexts/theme-provider.tsx` returns no matches

---

#### Step 5: Remove legacy code, delete theme-anchors.ts, and rewrite test suites {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(palette): remove legacy anchor/smoothstep code, delete theme-anchors.ts, rewrite tests for HVV`

**References:** [D01] Three-layer CSS variable architecture, [D02] Short-form CSS variable naming, [D05] P3 support via @media block, [D06] Clean break from legacy code, List L02, List L03, Risk R01, Spec S01, Spec S02, Spec S03, Spec S04, (#strategy, #test-plan-concepts, #css-vars)

**Artifacts:**
- palette-engine.ts: remove symbols per List L02, update module JSDoc header
- theme-anchors.ts: delete entire file per List L03
- palette-engine.test.ts: rewritten to test HVV API (hvvColor, injectHvvCSS, P3 support)
- theme-anchors.test.ts: deleted

**Tasks:**
- [ ] Grep for `--tug-palette-hue-` in all .ts, .tsx, .css files — verify no production references (Risk R01 mitigation)
- [ ] Remove from palette-engine.ts all symbols in List L02: injectPaletteCSS, tugPaletteColor, tugAnchoredColor, smoothstep, intensityToLC, TONE_ALIASES, readThemeParams, clampedOklchString, tugPaletteVarName, STANDARD_STOPS, AnchorPoint, HueAnchors, ThemeHueAnchors, ThemeAnchorData, interpolateAnchors
- [ ] Keep oklchToLinearSRGB and isInSRGBGamut as exported functions. They are consumed by: (a) the parameterized `_deriveChromaCaps` helper which passes `isInSRGBGamut` as the default gamut checker, (b) `findMaxChroma` which calls the gamut checker internally, and (c) tests that verify gamut safety of generated colors. They were previously private but are now part of the public API surface to support these use cases.
- [ ] Delete theme-anchors.ts entirely
- [ ] Update palette-engine.ts module JSDoc to describe HVV system (remove references to smoothstep, anchor-based interpolation, old CSS variable format)
- [ ] Verify List L01 symbols are all still present: HUE_FAMILIES, MAX_CHROMA_FOR_HUE, findMaxChroma, oklchToLinearSRGB, isInSRGBGamut, _deriveChromaCaps, LCParams, DEFAULT_LC_PARAMS
- [ ] Delete theme-anchors.test.ts entirely
- [ ] Clean up palette-engine.test.ts atomically with the code removal:
  - Remove all legacy test blocks and imports for deleted symbols (tugPaletteColor, clampedOklchString, tugPaletteVarName, TONE_ALIASES, tugAnchoredColor, injectPaletteCSS, all theme-anchor imports)
  - Keep HUE_FAMILIES and MAX_CHROMA_FOR_HUE tests (unchanged)
  - Keep all new HVV test blocks added incrementally in Steps 1-3 (hvvColor, HVV_PRESETS, injectHvvCSS, P3 gamut tests)
  - Add gamut safety tests: all 24 hues x 7 presets produce valid oklch strings
- [ ] Verify total test count is reasonable (old suite had ~50 tests; new suite should have similar coverage)

**Tests:**
- [ ] Grep: no .ts/.tsx/.css files reference `tugAnchoredColor`, `tugPaletteColor`, `injectPaletteCSS`, `TONE_ALIASES`, `ThemeAnchorData`, `AnchorPoint`, `HueAnchors`, `ThemeHueAnchors`, `interpolateAnchors`, `theme-anchors`
- [ ] All new palette-engine tests pass
- [ ] All gallery-palette-content tests pass
- [ ] No test files import from theme-anchors.ts

**Checkpoint:**
- [ ] `bun test` passes with zero failures
- [ ] `grep -r "theme-anchors" src/ --include='*.ts' --include='*.tsx'` returns no matches
- [ ] `grep -r "tugAnchoredColor\|tugPaletteColor\|injectPaletteCSS\|TONE_ALIASES" src/ --include='*.ts' --include='*.tsx'` returns no matches

---

#### Step 6: Final Integration Checkpoint {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Three-layer CSS variable architecture, [D04] Pure CSS piecewise mapping via min() trick, [D06] Clean break from legacy code, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all success criteria are met
- [ ] Verify no references to old API remain anywhere in src/
- [ ] Verify CSS variable counts: 168 presets + 74 constants in sRGB block, P3 overrides in @media block
- [ ] Verify gallery editor renders correctly
- [ ] Verify all canonical L values in DEFAULT_CANONICAL_L are above 0.555 ([D04] constraint)

**Tests:**
- [ ] `bun test` passes with zero failures (aggregate verification of all prior steps)

**Checkpoint:**
- [ ] `bun test` passes with zero failures
- [ ] `grep -r "injectPaletteCSS\|tugPaletteColor\|tugAnchoredColor\|TONE_ALIASES\|theme-anchors" src/ --include='*.ts' --include='*.tsx'` returns no matches
- [ ] `grep -r "\-\-tug-palette-hue-" src/ --include='*.ts' --include='*.tsx' --include='*.css'` returns no matches

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A complete HueVibVal CSS variable system in palette-engine.ts with P3 support, wired into the tugdeck runtime, replacing all legacy anchor/smoothstep palette code.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `injectHvvCSS('brio')` produces 242 CSS variables (168 presets + 74 constants) in a `:root` block and P3 overrides in a `@media (color-gamut: p3)` block (`bun test` verification)
- [ ] `hvvColor` is the sole color computation function, exported from palette-engine.ts (`grep` verification)
- [ ] No references to `injectPaletteCSS`, `tugAnchoredColor`, `tugPaletteColor`, `theme-anchors.ts`, or `--tug-palette-hue-*` remain in src/ (`grep` verification)
- [ ] `bun test` passes with zero failures
- [ ] Gallery palette editor renders and computes colors using hvvColor from palette-engine.ts

**Acceptance tests:**
- [ ] `bun test` — all tests pass
- [ ] Grep for legacy symbols returns no matches in production code

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Per-theme canonical L tables (different themes could have different canonical L values)
- [ ] Preset preview section in the gallery editor
- [ ] Third-breakpoint piecewise transfer function (if gallery editor ships it)
- [ ] Custom user-defined presets

| Checkpoint | Verification |
|------------|--------------|
| HVV core computation | `bun test` — hvvColor unit tests pass |
| CSS injection | `bun test` — injectHvvCSS integration tests pass, variable counts verified |
| P3 support | `bun test` — P3 gamut tests pass, @media block present |
| Runtime wiring | `bun test` — main.tsx and theme-provider.tsx use injectHvvCSS |
| Legacy removal | `grep` — no old symbols or variable names in src/ |
| Full suite | `bun test` — zero failures |
