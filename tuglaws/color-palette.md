# Color Palette

*The TugColor palette is a continuous OKLCH color space. Components consume semantic tokens; the palette provides the colors those tokens resolve to.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md).*

---

## Color Space

TugColor operates in OKLCH — a perceptually uniform color space with three axes:

- **Hue (h):** Angle in degrees around the color wheel (0°–360°).
- **Intensity (i):** 0–100. Controls chroma (saturation). 0 = achromatic, 100 = maximum chroma for the hue.
- **Tone (t):** 0–100. Controls lightness via a piecewise mapping through each hue's canonical lightness.
- **Alpha (a):** 0–100. Opacity. Defaults to 100 (fully opaque).

Two global lightness anchors define the tone endpoints:

```
L_DARK  = 0.15   (tone 0)
L_LIGHT = 0.96   (tone 100)
```

Each hue has a **canonical lightness** — the L value at which it achieves maximum chroma within sRGB gamut. Tone 50 produces canonical lightness. Below 50, L interpolates toward L_DARK. Above 50, L interpolates toward L_LIGHT.

---

## The 48 Chromatic Hues

24 base hues and 24 intermediate hues, evenly distributed around the OKLCH wheel:

| # | Name | Angle | | # | Name | Angle |
|---|------|------:|-|---|------|------:|
| 1 | garnet | 2.5° | | 25 | seafoam | 165° |
| 2 | cherry | 10° | | 26 | teal | 175° |
| 3 | scarlet | 15° | | 27 | aqua | 187.5° |
| 4 | coral | 20° | | 28 | cyan | 200° |
| 5 | crimson | 22.5° | | 29 | azure | 207.5° |
| 6 | red | 25° | | 30 | sky | 215° |
| 7 | vermilion | 30° | | 31 | cerulean | 222.5° |
| 8 | tomato | 35° | | 32 | blue | 230° |
| 9 | ember | 40° | | 33 | sapphire | 240° |
| 10 | flame | 45° | | 34 | cobalt | 250° |
| 11 | tangerine | 50° | | 35 | indigo | 260° |
| 12 | orange | 55° | | 36 | violet | 270° |
| 13 | apricot | 60° | | 37 | iris | 277.5° |
| 14 | amber | 65° | | 38 | purple | 285° |
| 15 | honey | 70° | | 39 | grape | 292.5° |
| 16 | gold | 75° | | 40 | plum | 300° |
| 17 | saffron | 82.5° | | 41 | orchid | 310° |
| 18 | yellow | 90° | | 42 | pink | 320° |
| 19 | chartreuse | 102.5° | | 43 | peony | 327.5° |
| 20 | lime | 115° | | 44 | rose | 335° |
| 21 | grass | 127.5° | | 45 | cerise | 340° |
| 22 | green | 140° | | 46 | magenta | 345° |
| 23 | jade | 147.5° | | 47 | fuchsia | 350° |
| 24 | mint | 155° | | 48 | berry | 355° |

Names are single lowercase words drawn from nature, gemstones, flowers, fruits, spices, and pigments. All hue names are unhyphenated — hyphens are reserved for adjacency syntax.

---

## Hyphenated Adjacency

Any two consecutive hues in the 48-color ring can be combined as `A-B`. The first name dominates:

```
hue(A-B) = (2/3 × angle(A)) + (1/3 × angle(B))
```

This yields **144 expressible chromatic hue points** (~2.5° average spacing). The ring is circular — berry (355°) and garnet (2.5°) are adjacent and wrap correctly across the 360°/0° boundary.

Only adjacent pairs are valid. Non-adjacent combinations (e.g., `yellow-blue`) are hard errors at parse time. No silent fallback.

---

## Named Grays

Nine descriptive names for intermediate achromatic values, ordered dark to light:

| Name | Tone | OKLCH L |
|------|-----:|--------:|
| pitch | 10 | 0.22 |
| ink | 20 | 0.29 |
| charcoal | 30 | 0.36 |
| carbon | 40 | 0.43 |
| graphite | 50 | 0.50 |
| vellum | 60 | 0.592 |
| parchment | 70 | 0.684 |
| linen | 80 | 0.776 |
| paper | 90 | 0.868 |

Plus two endpoints: **black** (L=0) and **white** (L=1).

Named grays have fixed lightness. Supplying intensity or tone parameters produces a warning — if adjustable lightness is needed, use the `gray` pseudo-hue with an explicit tone value.

### Achromatic Adjacency

The 11 achromatic names form a linear (non-wrapping) sequence:

```
black · pitch · ink · charcoal · carbon · graphite · vellum · parchment · linen · paper · white
```

Adjacent pairs use the same 2/3 + 1/3 weighting applied to lightness values:

```
L(A-B) = (2/3 × L(A)) + (1/3 × L(B))
```

Both directions are valid and produce different L values: `pitch-ink` ≠ `ink-pitch`. This yields **31 achromatic names** total (11 base + 20 hyphenated).

### Transparent

`transparent` is a named color expanding to `oklch(0 0 0 / 0)`. It is excluded from all adjacency sequences. Supplying i/t/a arguments produces a warning.

---

## Five Convenience Presets

Every chromatic hue has five presets with fixed i/t values:

| Preset | i | t | Character |
|--------|--:|--:|-----------|
| canonical | 50 | 50 | The crayon color — reference point |
| light | 20 | 85 | Background-safe, airy |
| dark | 50 | 20 | Contrast text, dark surfaces |
| intense | 90 | 50 | Saturated, draws attention |
| muted | 50 | 42 | Subdued, secondary |

Presets are accessed via hyphen: `red-intense`, `blue-light`. Preset names are checked before adjacency during parsing — this disambiguates without lookahead.

Presets and adjacency compose: `cobalt-indigo-intense` resolves the hue first (biased toward cobalt), then applies the intense preset. Explicit i/t/a parameters override preset defaults.

---

## CSS Variables

### Per-Hue Constants (3 per hue × 48 = 144 variables)

```css
--tug-{hue}-h: {angle};
--tug-{hue}-canonical-l: {L};
--tug-{hue}-peak-c: {peakChroma};
```

### Named Gray Variables

```css
--tug-gray-pitch: oklch(0.22 0 0);
--tug-gray-ink: oklch(0.29 0 0);
--tug-gray-charcoal: oklch(0.36 0 0);
--tug-gray-carbon: oklch(0.43 0 0);
--tug-gray-graphite: oklch(0.5 0 0);
--tug-gray-vellum: oklch(0.592 0 0);
--tug-gray-parchment: oklch(0.684 0 0);
--tug-gray-linen: oklch(0.776 0 0);
--tug-gray-paper: oklch(0.868 0 0);
--tug-black: oklch(0 0 0);
--tug-white: oklch(1 0 0);
```

### Global Anchors

```css
--tug-l-dark: 0.15;
--tug-l-light: 0.96;
```

All palette variables are scoped to `body {}`.

---

## The `--tug-color()` Notation

A compact CSS notation that expands to `oklch()` at build time via PostCSS plugin:

```css
--tug-color(red, i: 70, t: 30)          /* chromatic with explicit i/t */
--tug-color(indigo-cobalt, i: 7, t: 16) /* hyphenated adjacency */
--tug-color(blue-intense)                /* preset */
--tug-color(cobalt-indigo-intense, t: 30)/* adjacency + preset + override */
--tug-color(gray, t: 40)                /* gray pseudo-hue with tone */
--tug-color(charcoal)                   /* named gray (fixed L) */
--tug-color(paper-linen, a: 50)         /* achromatic adjacency with alpha */
--tug-color(black, a: 40)              /* black with alpha */
```

The plugin expands these to concrete `oklch(L C h)` values. Zero runtime cost — the built CSS contains only standard `oklch()`.

### `tugColor()` TypeScript Function

Programmatic access using the same math:

```typescript
tugColor(hueName: string, intensity: number, tone: number, canonicalL: number, peakChroma?: number): string
```

Returns an `oklch(L C h)` CSS string. Used for color pickers, data visualization, and dynamic styling.

---

## P3 Gamut

On Display P3 screens, `@media (color-gamut: p3)` overrides `--tug-{hue}-peak-c` with wider chroma caps. Since all formulas reference `peak-c`, colors automatically become richer on P3 displays. No per-preset overrides needed.

Each hue has independently derived sRGB and P3 chroma caps — binary-searched against the gamut boundary, not interpolated from neighbors.

---

## Three-Tier Token Architecture

1. **Palette tier** — `--tug-{hue}-*` per-hue constants and `--tug-gray-*` named grays. Theme-independent.
2. **Base tier** — `--tug-*` semantic tokens (surface and element). Theme-specific chromatic choices live here. [D71, L17]
3. **Component tier** — `--tug-<component>-*` aliases. Resolve to base tier in one hop. [D71, L17]

Components consume base and component tokens. The palette tier provides the raw materials used by authored theme CSS tokens.

---

## Theme Runtime Note

Theme runtime is CSS-first:

- base tokens are authored in `styles/tug-base-generated.css`
- override tokens are authored in `styles/themes/*.css`
- Vite/PostCSS expands `--tug-color(...)` to normal CSS in dev/build

The palette feeds authored theme CSS through `--tug-color(...)` expansion in Vite/PostCSS.
