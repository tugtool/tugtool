# HVV Palette System Refinements

## Core Principle

The palette system has two layers: **presets** (named vib/val pairs defined in CSS,
covering common UI needs) and **`hvvColor()`** (JS function for arbitrary combinations).
The calc()+clamp() piecewise formula is the shared math, written once in `tug-palette.css`
and once in `palette-engine.ts`. Components never see the formula — they consume
`var(--tug-red-muted)` or call `hvvColor('red', 30, 70)`.

---

## 1. Rename `accent` → `intense`

The canonical color is the accent color in most UI contexts. `intense` sits on a clear
vibrancy axis:

```
faint ← subtle ← muted ← soft ← canonical → intense
```

All references to `-accent` preset names in tug-palette.css, tug-tokens.css, theme files,
and palette-engine.ts get renamed to `-intense`.

---

## 2. Preset definitions as (vib, val) pairs

Each preset is defined as two CSS custom properties — vibrancy and value — with plain,
readable numbers. The confusing coefficient knobs (`--tug-preset-accent-l: 0.55`, etc.)
are eliminated entirely.

```css
body {
  /* Preset definitions */
  --tug-preset-canonical-vib: 50;  --tug-preset-canonical-val: 50;
  --tug-preset-intense-vib: 80;    --tug-preset-intense-val: 55;
  --tug-preset-soft-vib: 35;       --tug-preset-soft-val: 65;
  --tug-preset-muted-vib: 25;      --tug-preset-muted-val: 55;
  --tug-preset-light-vib: 30;      --tug-preset-light-val: 82;
  --tug-preset-subtle-vib: 15;     --tug-preset-subtle-val: 92;
  --tug-preset-faint-vib: 8;       --tug-preset-faint-val: 95;
  --tug-preset-dark-vib: 50;       --tug-preset-dark-val: 25;
  --tug-preset-deep-vib: 70;       --tug-preset-deep-val: 15;
}
```

When you look at this, you know what you're getting. Vibrancy 25, value 55 — that's a
muted color. No mental model translation needed.

---

## 3. Nine presets

| Preset    | Vib | Val | Use case                                                  |
|-----------|-----|-----|-----------------------------------------------------------|
| deep      | 70  | 15  | Very dark, rich — dark UI accents, deep backgrounds       |
| dark      | 50  | 25  | Dark foreground — text on light backgrounds                |
| canonical | 50  | 50  | The crayon color — the reference point                     |
| intense   | 80  | 55  | High-energy — primary buttons, active indicators           |
| soft      | 35  | 65  | Gentle emphasis — hover states, secondary emphasis         |
| muted     | 25  | 55  | Low-key — readable but subdued, borders, secondary text    |
| light     | 30  | 82  | Pale tint — light backgrounds with visible color           |
| subtle    | 15  | 92  | Background wash — section tinting, selected rows           |
| faint     | 8   | 95  | Barely visible — zebra stripes, whisper of color           |

---

## 4. The formula (written once, hidden from consumers)

Each hue × preset combination in `tug-palette.css` uses the same calc()+clamp() piecewise
formula. The formula lives in one place and is an implementation detail.

**Per-hue constants** (3 vars per hue, 24 hues = 72 vars):

```css
--tug-red-h: 25;
--tug-red-canonical-l: 0.62;
--tug-red-peak-c: 0.44;
```

**Global lightness anchors:**

```css
--tug-l-dark: 0.15;
--tug-l-light: 0.96;
```

**Preset × hue formula** (example for `--tug-red-muted`):

```css
--tug-red-muted: oklch(
  calc(
    var(--tug-l-dark)
    + clamp(0, var(--tug-preset-muted-val), 50)
      * (var(--tug-red-canonical-l) - var(--tug-l-dark)) / 50
    + (clamp(50, var(--tug-preset-muted-val), 100) - 50)
      * (var(--tug-l-light) - var(--tug-red-canonical-l)) / 50
  )
  calc(var(--tug-preset-muted-vib) / 100 * var(--tug-red-peak-c))
  var(--tug-red-h)
);
```

**How the piecewise clamp() math works:**

The HVV value-to-lightness mapping has two segments:

```
val 0→50:   L goes from L_DARK to canonical-l
val 50→100: L goes from canonical-l to L_LIGHT
```

`clamp(low, x, high)` acts as a gate. If x is outside the range, it pins to the boundary
and that segment contributes zero slope.

Walk through with val=30 (lower segment active):

```
Segment 1: clamp(0, 30, 50) = 30   → 30 * (can-l - L_DARK) / 50   ← contributes
Segment 2: clamp(50, 30, 100) - 50 = 0  → 0 * ...                  ← contributes nothing
Result: L = L_DARK + 30/50 * (can-l - L_DARK)
```

Walk through with val=70 (upper segment active):

```
Segment 1: clamp(0, 70, 50) = 50   → maxed out, contributes (can-l - L_DARK)
Segment 2: clamp(50, 70, 100) - 50 = 20  → 20 * (L_LIGHT - can-l) / 50  ← contributes
Result: L = L_DARK + (can-l - L_DARK) + 20/50 * (L_LIGHT - can-l)
       = can-l + 0.4 * (L_LIGHT - can-l)
```

Walk through with val=50 (the hinge — produces canonical lightness):

```
Segment 1: maxes out → contributes (can-l - L_DARK)
Segment 2: clamp(50, 50, 100) - 50 = 0 → contributes nothing
Result: L = L_DARK + (can-l - L_DARK) = can-l
```

This is fully dynamic. Change `--tug-preset-muted-vib` and all 24 hues' muted variants
update. Change `--tug-red-canonical-l` and all of red's presets update. The browser does
the math at runtime.

**Total CSS vars for the chromatic palette:**

- 18 preset knobs (9 presets × 2)
- 72 per-hue constants (24 × 3)
- 216 preset colors (24 hues × 9 presets)
- 2 global anchors
- Neutrals + black/white (~11)
- ≈ 319 CSS vars, all pure calc()/oklch(), no JS injection

---

## 5. Consumer API

**Components use preset vars. That's it.**

```css
.my-button {
  background: var(--tug-orange-intense);
  color: var(--tug-base-fg-onAccent);
}

.sidebar {
  background: var(--tug-cyan-faint);
}
```

**Semantic tokens reference preset vars:**

```css
--tug-base-accent-default: var(--tug-orange);
--tug-base-accent-strong: var(--tug-orange-intense);
--tug-base-accent-muted: var(--tug-orange-muted);
--tug-base-status-danger: var(--tug-red);
--tug-base-syntax-keyword: var(--tug-cyan);
```

**For transparency**, `color-mix()` with preset vars (this is the one acceptable use of
color-mix — opacity adjustment, not color computation):

```css
--tug-base-accent-subtle: color-mix(in oklch, var(--tug-orange) 15%, transparent);
```

**For arbitrary vib/val beyond presets**, JS only:

```typescript
import { hvvColor } from './palette-engine';
element.style.backgroundColor = hvvColor('red', 30, 70);
```

---

## 6. `hvvColor()` JS function

The TypeScript function uses the same piecewise math as the CSS formulas. It takes a hue
name (or raw angle), vibrancy, and value, and returns an `oklch()` string. Used for:

- Color pickers and the gallery editor
- Data visualization with dynamic color ranges
- Any one-off color that no preset covers

The function already exists in `palette-engine.ts` — it needs to be updated to match the
new preset names and kept in sync with the CSS formula.

---

## 7. Theme overrides

Themes override non-chromatic tokens (surfaces, grays, shadows) with literal hex values.
For chromatic adjustments, themes can:

- Override preset knobs to shift all colors at once (e.g., Harmony could set
  `--tug-preset-muted-vib: 30` for slightly more vivid muted colors on light backgrounds)
- Override per-hue canonical-l values for contrast adjustments (e.g., Harmony bumps
  `--tug-red-canonical-l` higher so red is readable on light surfaces)
- Override individual semantic tokens to point to different presets (e.g.,
  `--tug-base-accent-muted: var(--tug-orange-dark)` in Harmony for contrast)

---

## 8. P3 gamut handling

The `@media (color-gamut: p3)` block overrides `--tug-{hue}-peak-c` with wider values.
Since all preset formulas reference `peak-c`, they automatically produce richer colors on
P3 displays. No per-preset overrides needed.

---

## 9. Comment policy

All comments describe the code as it is. No phase numbers, no "replaced X", no
"introduced in Y". The palette file header explains the HVV model, the three axes, the
piecewise formula, and the preset system.

---

## 10. What changes, what stays

**Changes:**

- `accent` → `intense` everywhere (palette, tokens, themes, TS)
- 13 coefficient knobs → 18 (vib, val) pair knobs
- Preset formulas rewritten to use calc()+clamp() with vib/val inputs
- Two new presets: `soft`, `faint` (adds 48 new CSS vars: 24 hues × 2)
- Historical comments stripped
- `HVV_PRESETS` in palette-engine.ts updated to match

**Stays the same:**

- Per-hue constants (h, canonical-l, peak-c)
- Global anchors (l-dark, l-light)
- Neutral ramp + black/white
- P3 media query overrides
- `hvvColor()` function (updated to match)
- Three-layer token architecture (palette → base → component)
- Theme override strategy
- Gallery editor / LCurveEditor
