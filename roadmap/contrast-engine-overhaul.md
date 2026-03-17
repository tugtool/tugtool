# Contrast Engine Overhaul

Four connected improvements to the theme contrast system: replace the third-party
contrast algorithm with our own OKLab-based metric, purge all third-party terminology,
de-duplicate formula constants, and make the derivation engine produce
contrast-compliant tokens by construction (eliminating auto-fix).

---

## Context: Theme Families and Contrast

The theme derivation engine takes a `ThemeRecipe` — 14 core color inputs (7 structural
hues + 7 role hues) plus mode (dark/light) and mood knobs — and generates a complete
264-token theme. The goal is to produce **families of themes** from a single color
palette: dark, light, dark+stark, light+stark, and potentially more profiles. This is
proven in practice — a single color input (blue) already generates four distinct,
coherent themes in the iOS word game.

Contrast is not a bolt-on check — it is a structural requirement of the derivation
engine. Every theme variant must produce legible text on every surface, across both
polarities (dark-on-light and light-on-dark), at every level of the visual hierarchy.
The engine must guarantee this by construction, not repair it after the fact.

### Element categories for contrast

Drawing from WCAG 3.0's outcome-based model and our own token system, the contrast
engine recognizes these element categories:

| Category | Threshold | Examples |
|----------|----------:|---------|
| body-text | 75 | fg-default, fg-link, field labels |
| large-text | 60 | button labels, headings |
| subdued-text | 45 | fg-muted, fg-placeholder, tab-fg-rest |
| ui-component | 30 | borders, icons, badges, accents |
| decorative | 15 | disabled states, dividers |

These categories map to the element/surface pairing map — each token is paired against
all surfaces it can appear on, and must meet the threshold for its category.

Dark mode support is a first-class requirement. The WCAG 2.x contrast ratio formula
(relative luminance ratio) is known to perform poorly for dark themes — it overstates
contrast for low-luminance colors. Our contrast metric must handle both polarities
correctly.

---

## Part 1: Replace the Contrast Algorithm

### Problem

The `computeLcContrast` function in `theme-accessibility.ts` is a direct
implementation of the APCA algorithm, using its specific constants (0.56, 0.57, 0.62,
0.65, 1.14, 0.027), its exponent (2.4), and its soft-clip logic. The constants are
explicitly labeled "APCA-W3 0.98G-4g". This is the APCA algorithm by any reasonable
assessment.

The APCA license restricts use of the algorithm, its constants, and associated
terminology. We have no interest in compliance games, trademark disputes, or
licensing obligations. We want legible text with good contrast.

### Solution: OKLab L with polarity correction

Replace the third-party algorithm with our own perceptual contrast function built
entirely from unencumbered color science.

**Foundation: OKLab perceptual lightness (Björn Ottosson, 2020, public domain)**

OKLab L is the most perceptually uniform lightness channel available in a simple color
space — Ottosson reports 0.20 RMSE on lightness prediction vs 1.70 for CIELAB L*.
We already compute OKLab L for every token in the palette engine (`oklchToLinearSRGB`).
The L channel is the natural input for our contrast metric.

**Polarity correction (published vision science)**

The raw OKLab ΔL is symmetric — it treats dark-on-light and light-on-dark identically.
But human vision is not symmetric. Published research establishes a ~15-20% legibility
disadvantage for light text on dark backgrounds at the same measured contrast:

- Piepenbrock, Mayr, Mund & Buchner (2013). "Positive display polarity is advantageous
  for both younger and older adults." Ergonomics, 56(7), 1116-1124.
- Piepenbrock, Mayr & Buchner (2014). Pupil constriction on bright backgrounds yields
  sharper retinal image.
- Whittle (1986). "Increments and decrements: Luminance discrimination." Vision
  Research, 26(10), 1677-1691.

The mechanism is well understood: bright backgrounds constrict the pupil, reducing
optical aberrations and sharpening the retinal image. This is foundational
psychophysics, not proprietary research.

**The algorithm:**

```typescript
/**
 * Compute perceptual contrast between an element and a surface.
 *
 * Returns a signed contrast score:
 *   - Positive: dark element on light surface (positive polarity)
 *   - Negative: light element on dark surface (negative polarity)
 *
 * Built from unencumbered color science:
 *   - OKLab L for perceptual lightness (Ottosson 2020, public domain)
 *   - Polarity correction from published vision research
 *     (Piepenbrock 2013, Whittle 1986)
 *
 * The polarity factor reduces the effective contrast score for negative
 * polarity (light-on-dark), reflecting the ~15-20% legibility disadvantage
 * established in the literature. This means light-on-dark text needs a
 * larger ΔL to achieve the same effective contrast as dark-on-light text.
 */
function computePerceptualContrast(elementHex: string, surfaceHex: string): number {
  const elementL = hexToOkLabL(elementHex);
  const surfaceL = hexToOkLabL(surfaceHex);

  const deltaL = surfaceL - elementL;

  if (surfaceL > elementL) {
    // Positive polarity: dark element on light surface
    return deltaL * CONTRAST_SCALE;
  } else {
    // Negative polarity: light element on dark surface
    // Apply polarity factor — light-on-dark needs more ΔL for same legibility
    return deltaL * CONTRAST_SCALE * POLARITY_FACTOR;
  }
}
```

**Constants to calibrate:**

| Constant | Role | Calibration method |
|----------|------|--------------------|
| `CONTRAST_SCALE` | Maps OKLab ΔL (0-1 range) to a 0-100 contrast score | Set so that the current Brio fg-default/bg-app pair produces a score near the body-text threshold |
| `POLARITY_FACTOR` | Reduces score for light-on-dark polarity | Start at 0.85 (reflecting ~15% published disadvantage), tune against the full Brio token set |
| `CONTRAST_MIN_DELTA` | Below this ΔL, contrast rounds to 0 | Engineering constant to avoid noise near zero |

**Calibration approach:**

1. Run the old metric and the new metric on every token pair in the Brio dark theme
2. Find `CONTRAST_SCALE` that makes the new score for fg-default ≈ old score
3. Find `POLARITY_FACTOR` that preserves the current pass/fail boundary for negative
   polarity pairs
4. Verify that the rank ordering of all pairs is preserved (no pair that currently
   passes should fail, no pair that currently fails should pass)
5. Set thresholds (75, 60, 45, 30, 15) based on the calibrated scale

This is a one-time calibration. The result is our own metric with our own constants,
built on public-domain foundations.

**Why this works for dark mode:**

The polarity factor is the key. In dark themes, most text is light-on-dark (negative
polarity). The factor reduces the effective contrast score, meaning the derivation
engine must push foreground tones further from the surface to achieve the same
threshold. This naturally produces higher ΔL for dark-mode text — exactly the
behavior needed for dark-mode legibility.

**Why not just WCAG 2.x ratio?**

The WCAG 2.x formula `(L1 + 0.05) / (L2 + 0.05)` is symmetric — it reports the same
ratio regardless of polarity. This is why dark themes routinely have legibility
problems despite "passing" WCAG: the formula doesn't account for the polarity
disadvantage. We keep WCAG ratio as informational display data but do not use it as
a gate.

### Files changed

| File | Change |
|------|--------|
| `theme-accessibility.ts` | Replace algorithm internals, remove old constants, add OKLab L conversion |

---

## Part 2: Purge Third-Party Terminology

### Problem

The codebase references APCA, SAPC, SACAM, SA98G, and "Lc" (as a branded metric
name) throughout source code, tests, plans, and roadmap docs. These terms are
trademarked and their use is restricted by license. We need zero association.

### Scope of removal

**Source files (5 files):**
- `theme-accessibility.ts` — constants, function names (`apcaGamma`, `apcaY`),
  comments (~30 references)
- `element-surface-pairing-map.ts` — comments (~3 references)
- `theme-derivation-engine.ts` — comments (~3 references)
- `gallery-theme-generator-content.tsx` — `data-testid="gtg-dash-apca-lc"`, UI
  labels (~8 references)
- `gallery-theme-generator-content.css` — comment (~1 reference)

**Test files (3 files):**
- `theme-accessibility.test.ts` — module docstring, suite name (~3 references)
- `theme-derivation-engine.test.ts` — comments (~40+ references)
- `gallery-theme-generator-content.test.tsx` — comment (~1 reference)

**Plans and roadmap (5 files):**
- `.tugtool/tugplan-theme-generator.md` (~20+ references)
- `.tugtool/tugplan-perceptual-contrast-conformance.md` (~30+ references)
- `roadmap/theme-generator-proposal.md` (~15+ references)
- `archive/implementation-log-2025-03-14-153354.md` (~1 reference)

### Replacement terminology

| Old term | New term |
|----------|----------|
| APCA | (remove, do not replace with another branded term) |
| SA98G | (remove) |
| SAPC / SACAM | (remove) |
| Lc (as metric name) | "contrast" or "perceptual contrast" |
| `computeLcContrast` | `computePerceptualContrast` |
| `LC_THRESHOLDS` | `CONTRAST_THRESHOLDS` |
| `LC_MARGINAL_DELTA` | `CONTRAST_MARGINAL_DELTA` |
| `lcPass` | `contrastPass` |
| `lc` (field on ContrastResult) | `contrast` |
| `data-testid="gtg-dash-apca-lc"` | `data-testid="gtg-dash-contrast"` |
| "pairs pass Lc contrast" (UI) | "pairs pass contrast" |

---

## Part 3: De-duplicate Formula Constants

### Problem

The `DerivationFormulas` interface has ~60 fields. Currently there is only one recipe
(`BRIO_DARK_FORMULAS`), but the system is designed for multiple recipes — different
modes (dark/light), different design profiles (standard/stark), different color
palettes. The formula system must support theme families where a single color palette
generates multiple coherent themes.

Three duplication problems:

1. **Inline constants duplicate formula fields.** Hardcoded values in `deriveTheme()`,
   `computeTones()`, and `resolveHueSlots()` duplicate what's in `DerivationFormulas`.
   When a value appears both in the formulas object and as an inline constant, they
   drift apart silently.

2. **No default mechanism.** Every new recipe must specify all ~60 fields. A dark/stark
   variant that only changes 5 values from the dark base still needs to declare all 60.
   There is no "base formula set" that recipes extend with overrides.

3. **Computed values recalculated in multiple places.** Values like "divider tone =
   surface overlay tone" appear as both a formula field AND inline computation.

### Solution: Formula defaults + override pattern

```typescript
/** Base formula defaults — shared across all recipes. */
const BASE_FORMULAS: DerivationFormulas = {
  bgAppTone: 5,
  bgCanvasTone: 5,
  // ... all ~60 fields with sensible defaults
};

/** Brio dark: only the fields that differ from base. */
const BRIO_DARK_OVERRIDES: Partial<DerivationFormulas> = {
  bgAppI: 2,
  bgCanvasI: 2,
};

/** Brio dark/stark: extends dark with higher contrast values. */
const BRIO_DARK_STARK_OVERRIDES: Partial<DerivationFormulas> = {
  ...BRIO_DARK_OVERRIDES,
  fgDefaultTone: 98,     // push primary text lighter for more contrast
  fgSubtleTone: 45,      // raise subtle text floor
};

export const BRIO_DARK_FORMULAS: DerivationFormulas = {
  ...BASE_FORMULAS,
  ...BRIO_DARK_OVERRIDES,
};

export const BRIO_DARK_STARK_FORMULAS: DerivationFormulas = {
  ...BASE_FORMULAS,
  ...BRIO_DARK_STARK_OVERRIDES,
};
```

New recipes only specify their overrides. The base provides all defaults. When a
default changes, it changes everywhere.

Additionally: audit all inline constants in `deriveTheme()` and friends. Every numeric
constant must either:
- Be in `DerivationFormulas` (if recipe-dependent), or
- Be a named constant with a JSDoc comment explaining why it's fixed

No magic numbers in the derivation pipeline.

---

## Part 4: Contrast-Aware Derivation (Eliminate Auto-Fix)

### Problem

`autoAdjustContrast` is a post-hoc iterative fixer that tries to repair contrast
failures after derivation. It reports 33 failures and 31 "unfixable" on Brio.
Three bugs make it structurally broken:

**Bug A: Ignores parentSurface compositing.** The validation pass composites
semi-transparent surfaces correctly, but auto-fix measures contrast without
compositing. It gets the wrong number, computes the wrong bump direction, and
oscillates. Affects ~24 pairings.

**Bug B: Tries to bump black/white/alpha tokens.** Shadow/scrim/highlight tokens
are structurally fixed. `parseTugColorToken` parses them but `baseHueName` falls
back to "violet", producing nonsense tone math.

**Bug C: Can only adjust foregrounds, never surfaces.** `fg-onAccent` is white
text on a colored background — the fix needs the background to change, but
auto-fix only touches foreground tokens.

### Solution: Contrast floors in the derivation engine

Instead of deriving tokens and then fixing them, make the derivation engine
contrast-aware. After computing each foreground token's tone, check it against all
paired surfaces and enforce a minimum contrast floor.

The derivation engine already knows all surface tones (it just computed them) and
has access to the pairing map:

```typescript
function enforceContrastFloor(
  elementL: number,
  surfaceL: number,
  threshold: number,
  polarity: "lighter" | "darker",
): number {
  // Binary search for the minimum element L
  // that produces perceptual contrast >= threshold against surfaceL
}
```

For each foreground token, after computing its initial tone:
1. Look up all surfaces it's paired against (from the pairing map)
2. For each surface, compute the minimum tone needed to pass the threshold
3. Take the most restrictive
4. If the initial tone doesn't meet the floor, clamp it

This makes auto-fix unnecessary. The derivation engine produces compliant tokens by
construction. The contrast dashboard still displays results, but with 0 failures
because there is nothing to fix.

### Tokens to skip

Structurally fixed tokens are excluded from contrast floor enforcement:

- `--tug-color(black, ...)` — shadow/scrim overlays
- `--tug-color(white, ...)` — highlight overlays
- `--tug-color(transparent)` — no contrast meaning
- Any token with `alpha < 100` where contrast depends on compositing

### Theme family implications

Contrast-aware derivation is what makes theme families viable. A "stark" profile can
set higher contrast thresholds and the derivation engine will automatically push
foreground tones to meet them. A "soft" profile can relax thresholds for subdued text.
The formulas define the aesthetic intent; the contrast floors guarantee legibility.

This is exactly how the word game themes work: dark, light, dark/stark, and
light/stark are four profiles from one color input, with the "stark" variants
producing higher-contrast, more outlined designs. The derivation engine ensures each
variant meets its own contrast requirements by construction.

### Diagnostic output

Replace the current `unfixable: string[]` with structured diagnostics:

```typescript
interface ContrastDiagnostic {
  token: string;
  reason: "floor-applied" | "structurally-fixed" | "composite-dependent";
  surfaces: string[];
  initialTone: number;
  finalTone: number;
  threshold: number;
}
```

---

## Scientific references

All unencumbered — published academic research and public standards:

| Source | Year | Contribution | Status |
|--------|------|-------------|--------|
| Ottosson, "A perceptual color space for image processing" | 2020 | OKLab/OKLCH perceptual lightness | Public domain / MIT |
| Stevens, "On the psychophysical law" | 1957 | Power-law brightness perception | Public domain |
| Piepenbrock et al., "Positive display polarity is advantageous" | 2013 | Polarity effect quantification | Published research |
| Whittle, "Increments and decrements: Luminance discrimination" | 1986 | Asymmetric contrast perception | Published research |
| ITU-R BT.709 | 1990 | sRGB luminance coefficients | Public standard |
| CIE 1976 L\*a\*b\* | 1976 | Perceptual lightness model | Public standard |
| IEC 61966-2-1 | 1999 | sRGB linearization | Public standard |
| Google Material Color Utilities (HCT) | 2021 | Tone-difference contrast approach | Apache 2.0 |

---

## Execution order

1. **Part 2 first** (purge terminology) — mechanical, no behavioral changes, unblocks
   clean naming for everything else
2. **Part 1 second** (replace algorithm) — removes the third-party code, establishes
   our own OKLab-based metric with polarity correction
3. **Part 3 third** (de-duplicate formulas) — structural cleanup, enables theme families
4. **Part 4 last** (contrast-aware derivation) — the big behavioral change that
   eliminates auto-fix, builds on the clean metric and clean formulas from parts 1-3
