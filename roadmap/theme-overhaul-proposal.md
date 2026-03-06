# Tugways Theme Token Overhaul Proposal

This proposal replaces the current theme/token naming with a researched,
code-grounded model that is large enough to support the actual scope of
`design-system-concepts.md` and `tugways-implementation-strategy.md`.

This revision corrects a flaw in the earlier draft: the semantic set was too
small, too generic, and did not account for the current code's heavy use of the
accent system, chart tokens, syntax tokens, shadcn bridge aliases, workspace
chrome, and the roadmap's much larger component inventory.

The intent here is not a cosmetic rename. The intent is to:

- Replace `--tways-*` and `--td-*` with a clearer long-term structure.
- Remove all legacy aliases.
- Preserve and improve the accent concept instead of deleting it.
- Define a large, explicit `--tug-base-*` semantic contract.
- Make future component styling additive and controlled rather than ad hoc.
- Add computed color palettes with a 0–100 intensity scale across 24 hue
  families, using OKLCH for perceptual uniformity.
- Add a global scale system: one root number controls all dimensions in the UI.
- Add a global timing system: one root number controls all animation durations.
- Add a dev-mode `Ctrl+Option + hover` cascade inspector for direct style
  introspection.

---

## Proposal Status

This is a research-backed proposal document, not yet an implementation plan.

If approved, the next document should be a concrete implementation tugplan with:

- File-by-file migration order.
- Temporary compatibility shims.
- Search-based enforcement checks.
- Theme parity verification across Brio, Bluenote, and Harmony.

---

## Inputs Used

This proposal is based on four inputs:

1. Current code in `tugdeck/`.
2. `roadmap/design-system-concepts.md`.
3. `roadmap/tugways-implementation-strategy.md`.
4. Public token-system references with permissive or compatible licensing.

### Current Code Reviewed

The current token consumers and declarations were reviewed in:

- `tugdeck/styles/tokens.css`
- `tugdeck/styles/chrome.css`
- `tugdeck/src/globals.css`
- `tugdeck/src/components/tugways/*.css`
- `tugdeck/src/components/ui/*.tsx`

### Roadmap Scope Reviewed

The roadmap review included the current and planned styling needs for:

- Canvas and chrome.
- Tugcard, tab bar, dock, snapping, flashing, selection, shadows.
- Form controls.
- Overlays and feedback components.
- Data display and visualization.
- Inspector panels and mutation-preview tooling.
- Rebuilt cards including terminal, code/conversation, git, files, stats,
  settings, developer, about, and the gallery card.

---

## External Research

The following systems were used as naming-structure references only. No code,
token values, or proprietary assets are being copied.

### 1. Primer Primitives (MIT)

References:

- [Primitives](https://primer.style/product/primitives)
- [Token names](https://primer.style/product/primitives/token-names)
- [primer/design](https://github.com/primer/design)

Relevant takeaways:

- Primer explicitly separates `base`, `functional`, and `component/pattern`
  token categories.
- Primer requires a property block in token names and uses reusable pattern
  names such as `control`, not just component names.
- Primer's documented examples are directly useful for tugways naming:
  `bgColor-inset`, `borderColor-default`, `control-danger-borderColor-rest`,
  `button-primary-bgColor-hover`.
- Primer's color modifiers `default`, `muted`, and `emphasis` are especially
  useful for the tugways semantic layer.

### 2. Spectrum Design Data (Apache-2.0)

References:

- [Spectrum tokens](https://opensource.adobe.com/spectrum-design-data/tokens/)
- [spectrum-design-data](https://github.com/adobe/spectrum-design-data)

Relevant takeaways:

- Spectrum separates raw palette, semantic aliases, component color tokens,
  layout primitives, layout component tokens, and icon tokens.
- This is strong evidence that tugways should not stop at generic color tokens;
  it should explicitly model icon, layout, overlay, and component-family needs.
- Spectrum's separation between semantic aliases and component tokens matches
  the direction tugways needs.

### 3. Open Props (MIT)

References:

- [Open Props](https://open-props.style/)
- [argyleink/open-props](https://github.com/argyleink/open-props)

Relevant takeaways:

- Open Props demonstrates the usefulness of consistent size/radius/shadow/motion
  scales and surface ladders such as `--surface-1` through `--surface-4`.
- Tugways should adopt the discipline of named scale families, but with
  tugways-specific semantics rather than generic raw scales in the public layer.
- Open Props also reinforces the value of explicit motion and shadow scales.

### 4. Carbon Design System (Apache-2.0)

References:

- [Carbon color tokens](https://carbondesignsystem.com/elements/color/tokens/)
- [carbon-design-system/carbon](https://github.com/carbon-design-system/carbon)

Relevant takeaways:

- Carbon is particularly strong on role + state naming: `background-hover`,
  `background-active`, `layer-01`, `field-01`, `border-subtle-01`,
  `layer-accent-01`, etc.
- Carbon shows that a serious semantic layer must model state transitions across
  multiple surfaces, not just define one neutral background and one border.
- Carbon's `background`, `layer`, `field`, `border`, `support`, `focus`, and
  `icon` domains map cleanly to tugways needs.

### 5. Chakra UI Semantic Tokens

References:

- [Semantic tokens](https://chakra-ui.com/docs/theming/semantic-tokens)

Relevant takeaways:

- Chakra's simple nested semantic groups are a good readability model: `bg`,
  `fg`, `border`, `focusRing`.
- Tugways should use a similarly readable domain hierarchy even though our
  implementation is plain CSS custom properties.

### 6. OKLCH Guidance and Modern CSS Palette Practice

References:

- [OKLCH FYI](https://www.oklch.fyi/)
- [Tailwind color customization](https://tailwindcss.com/docs/customizing-colors)

Relevant takeaways:

- OKLCH is perceptually uniform, which makes fixed lightness and chroma ramps
  behave more consistently across named hues.
- Equal lightness values across different hues are far more trustworthy in OKLCH
  than in HSL or ad hoc hex picking.
- Modern CSS token systems increasingly use `oklch()` directly for theme-token
  authoring, which fits tugways well.

### 7. Adobe Color Naming Guidance

References:

- [Naming colors in design systems](https://adobe.design/stories/design-for-scale/naming-colors-in-design-systems)

Relevant takeaways:

- Common-language hue names such as `red`, `blue`, and `purple` are clearer
  than poetic or highly branded color names.
- A stable `name + value` system scales better than one-off descriptive names.
- This strongly supports the named hue families proposed for the tugways palette
  layer.

### Licensing Note

These references are used for naming-pattern inspiration only. This proposal
does not copy theme values, CSS, component code, or artwork from any external
system. The external sources are standards, MIT-licensed projects, or
Apache-2.0-licensed projects, which are all compatible with using the ideas and
naming structures as references in an MIT-licensed codebase.

---

## What Current Code Actually Uses

The current code is more specific and more ambitious than the earlier draft
acknowledged.

### 1. Accent Is Not Optional

Accent usage is already widespread in live code:

- `tug-button.css`: `--td-accent-2` for primary button fill, `--td-accent` for
  state dots.
- `tug-tab-bar.css`: `--td-accent` for active tab underline, overflow badge
  background, insert indicator, and drag-drop target highlights.
- `chrome.css`: `--td-accent-cool` for snap guides, `--td-accent` for perimeter
  flash.
- `tugcard.css`: `--td-selection-bg` and `--td-selection-text`.
- `gallery-card.css`: `--td-accent` and `--td-accent-cool` in the mutation demo.

Conclusion:

- The accent concept must be preserved.
- The accent system needs to become clearer, not smaller.
- The numbered accent scale must be replaced by descriptive names, not removed
  without replacement.

### 2. The Code Already Implies More Domains Than the Old Draft Covered

Current declared or consumed domains include:

- Surface and canvas.
- Text and inverse text.
- Accent and status.
- Chart.
- Syntax.
- Border and selection.
- Header and icon states.
- Active and inactive card shadow.
- Dim overlays.
- Spacing, radius, typography, line height.
- Motion tokens.
- Grid lines, drag/drop indicators, flash overlays.

### 3. There Are Existing Gaps

The current system already has holes that a better semantic layer should fix:

- `hello-card.tsx` consumes `--td-text-muted`, but that token is not declared.
- Drag ghost, badge, banner, and flash semantics are partly ad hoc.
- Many component states still rely on local styling choices rather than named
  cross-component semantics.
- The legacy alias layer obscures what is actually canonical.

### 4. The Shadcn Bridge Is a Real Migration Problem

`globals.css` and `components/ui/*.tsx` still depend on variables such as:

- `--background`, `--foreground`, `--primary`, `--accent`, `--destructive`,
  `--ring`.

This means the proposal must include an explicit bridge strategy. We cannot just
declare legacy aliases dead without describing how the shadcn/Tailwind bridge is
replaced.

---

## What the Roadmap Requires

The roadmap requires a token system that can credibly support all of the
following, not just today's small CSS footprint.

### Workspace Chrome

Canvas grid, Tugcard chrome, title bar active/inactive states, tabs and overflow
tabs, tab drag indicators, dock rail and buttons, resize handles, snap guides,
set shadows, perimeter flash, selection containment visuals.

### Controls and Inputs

Buttons, input, textarea, select, checkbox, radio, switch, slider,
label/helper/required states, validation and error states, grouped control
seams, loading and disabled states.

### Overlay and Feedback Components

Alert, sheet, confirm popover, toast, tooltip, dropdown menu, context menu,
dialog, badges, status indicators, progress, skeleton, spinner, separator, kbd,
avatar, disconnect and warning banners.

### Data Display and Visualization

Tables, stat cards, sparklines, linear gauges, arc gauges, chart series,
threshold and trend states.

### Inspector / Dev Tools

Color picker, font picker, coordinate inspector, inspector panel, mutation
preview vs commit vs cancel states, cascade/source display, hovered-target
highlighting.

### Card Domain Surfaces

Terminal, code/conversation, git/files, stats, settings/developer, about,
gallery.

Conclusion: `--tug-base-*` must be large enough to cover workspace chrome,
generic controls, feedback, data display, visualization, inspector tooling, and
domain-specific surfaces such as syntax and terminal presentation.

---

## Core Decisions

### 1. `--tways-*` and `--td-*` Are Transitional, Not Permanent

Both current prefixes should become migration smells.

Long-term target:

- Theme/palette primitives: `--tug-palette-*`
- Canonical semantics: `--tug-base-*`
- Component/pattern tokens: `--tug-comp-*`

This intentionally makes any future `--tways-*` or `--td-*` usage a sign that
old code or migration debris remains.

### 2. `--tug-base-*` Is the Public Contract

Everything components use should resolve directly or indirectly from
`--tug-base-*`.

That means:

- Components consume `--tug-base-*` or `--tug-comp-*`.
- `--tug-comp-*` must resolve from `--tug-base-*`.
- Palette/theme primitives never leak into component CSS.

### 3. Accent Survives as a First-Class System

The current accent system is doing several jobs at once:

- Primary action color.
- Cool/secondary interactive accent.
- Chart series colors.
- Syntax color sources.
- Status tone sources.
- Visual instrumentation color.

These jobs should be separated, but the accent concept absolutely remains.

### 4. Computed Color Palettes Replace Fixed Swatches

The earlier draft proposed 12 hue families with 4 fixed tones (soft, default,
strong, intense) for 48 total palette entries. This is too rigid.

The revised design uses **24 hue families** (one every 15 degrees around the
OKLCH hue wheel) with a **0–100 continuous intensity scale**. This produces a
rich, computable palette where any combination of hue and intensity can be
generated on demand.

See [Computed Color Palette System](#computed-color-palette-system) for the full
design.

### 5. One Global Scale Controls All Dimensions

A single `--tug-scale` value (default: `1`) multiplies every font size,
spacing value, radius, icon size, and dimension in the system. Changing it
resizes the entire UI — a major accessibility win. Each `Tug*` component also
has its own component-level scale for fine-tuning relative proportions.

See [Global Scale System](#global-scale-system) for the full design.

### 6. One Global Timing Controls All Motion

A single `--tug-timing` value (default: `1`) multiplies every animation
duration and transition in the system. Setting it to `5` gives slow-motion
for debugging. Setting it to `0.001` effectively disables motion. A
`prefers-reduced-motion` media query sets it to `0.001` automatically.

See [Global Timing System](#global-timing-system) for the full design.

### 7. Size Tokens Use a Uniform Adjectival Scale

Standard size ladder: `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`.

This scale should be used consistently across spacing, radius, typography, icon
size, stroke width, and elevation tiers where appropriate.

---

## Computed Color Palette System

### The Problem with Fixed Swatches

A fixed 4-tone system (soft/default/strong/intense) forces designers into
exactly four choices per hue. Real design work needs intermediate values: a
slightly desaturated accent for a subtle background, a nearly-full-intensity
color for a critical alert, or a very soft wash for a hover state. Hardcoding
all possible combinations is infeasible.

### Design: 24 Hue Families x 0–100 Intensity

**Hue families.** 24 named hues, one every 15 degrees around the OKLCH hue
wheel:

| Hue Name | OKLCH Hue Angle |
|----------|-----------------|
| `cherry` | 10 |
| `red` | 25 |
| `coral` | 35 |
| `scarlet` | 40 |
| `orange` | 55 |
| `amber` | 70 |
| `gold` | 85 |
| `yellow` | 100 |
| `chartreuse` | 115 |
| `lime` | 130 |
| `green` | 145 |
| `spring` | 150 |
| `emerald` | 160 |
| `teal` | 175 |
| `cyan` | 190 |
| `sky` | 210 |
| `azure` | 225 |
| `blue` | 240 |
| `indigo` | 260 |
| `violet` | 280 |
| `purple` | 295 |
| `magenta` | 315 |
| `rose` | 340 |
| `crimson` | 355 |

Note: The 24 hues are distributed to cover the full OKLCH gamut with human-
meaningful names. The spacing is approximately 15 degrees but adjusted slightly
so that names land on perceptually distinct, recognizable colors. Themes may
shift individual hue angles for artistic effect without renaming.

**Token naming format.** Palette tokens encode both the hue angle and the human
name, making them self-documenting and searchable:

`--tug-palette-hue-<angle>-<name>-tone-<intensity>`

Examples:

- `--tug-palette-hue-25-red-tone-0`
- `--tug-palette-hue-25-red-tone-50`
- `--tug-palette-hue-280-violet-tone-50`
- `--tug-palette-hue-190-cyan-tone-100`
- `--tug-palette-hue-55-orange-tone-75`

This format has several advantages:

- **Self-documenting**: reading the token name tells you both the color and its
  position on the wheel. No need to consult a lookup table.
- **Searchable**: grep for `hue-280` to find all violet usage, or `tone-50` to
  find all default-intensity colors.
- **Sortable**: tokens sort by hue angle, which matches the visual color wheel.
- **Extensible**: if a theme needs an intermediate hue at 33 degrees, it
  naturally slots in as `hue-33-<name>` without disrupting existing tokens.

**Intensity scale.** A continuous 0–100 number:

- **0**: Near-neutral wash. Very high lightness, very low chroma. Useful for
  subtle tinted backgrounds.
- **25**: Gentle tint. High lightness, modest chroma. Good for hover states and
  soft badges.
- **50**: The "excellent default." A balanced, versatile color suitable for most
  UI purposes — readable on both light and dark backgrounds in many contexts.
- **75**: Rich and saturated. Lower lightness, higher chroma. Good for primary
  actions and emphasized elements.
- **100**: Maximum intensity. Deep, highly chromatic. Good for alerts, critical
  states, and data visualization where high contrast matters.

### The Transfer Function

The intensity number maps to OKLCH lightness (L) and chroma (C) through a
non-linear transfer function. The function is designed so that the middle range
(roughly 30–70) offers fine-grained control — this is where designers spend most
of their time — while the extremes move more aggressively.

```typescript
/**
 * Attempt at a mapping function from intensity (0–100) to OKLCH lightness
 * and chroma. The curve is tuned so the 30–70 range is the sweet spot for
 * everyday UI work: smooth gradations, good contrast, readable text.
 *
 * At intensity 0: L ≈ 0.96, C ≈ 0.01 (near-white wash)
 * At intensity 50: L ≈ 0.70, C ≈ 0.11 (balanced, versatile)
 * At intensity 100: L ≈ 0.42, C ≈ 0.22 (deep, saturated)
 *
 * The function uses a smoothstep-like ease so the midrange expands and
 * the extremes compress. This makes the scale feel linear to a designer's
 * eye even though the underlying math is not.
 */

// Attempt at OKLCH lightness/chroma anchors
const L_MIN = 0.42;   // intensity 100
const L_MAX = 0.96;   // intensity 0
const C_MIN = 0.01;   // intensity 0
const C_MAX = 0.22;   // intensity 100

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function intensityToLC(intensity: number): { L: number; C: number } {
  const t = Math.max(0, Math.min(1, intensity / 100));
  const s = smoothstep(t);
  return {
    L: L_MAX - s * (L_MAX - L_MIN),
    C: C_MIN + s * (C_MAX - C_MIN),
  };
}

function tugPaletteColor(hueName: string, intensity: number): string {
  const hueAngle = HUE_ANGLES[hueName]; // lookup from the 24-hue table
  const { L, C } = intensityToLC(intensity);
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${hueAngle})`;
}

// CSS variable name for a palette color
function tugPaletteVarName(hueName: string, intensity: number): string {
  const hueAngle = HUE_ANGLES[hueName];
  return `--tug-palette-hue-${hueAngle}-${hueName}-tone-${intensity}`;
}
```

**Important caveats on the transfer function:** The L/C anchors and curve shape
above are a starting point, not final values. Before implementation closes:

- Each hue family should be gamut-checked against sRGB (OKLCH can produce
  out-of-gamut colors at high chroma for certain hues, particularly yellows and
  greens).
- The smoothstep may need to be replaced with a more nuanced curve — for
  example, a bezier or piecewise function — if testing reveals dead zones or
  jumps in the perceptual gradient.
- Dark themes may need a separate L/C curve or offset, since the "balanced
  default" at intensity 50 should look good against both light and dark
  backgrounds.
- Per-hue chroma clamping may be necessary: yellows can reach much higher chroma
  in OKLCH than blues at the same lightness. A `maxChromaForHue(hueAngle)`
  guard prevents clipping.

### Runtime Architecture

Since we cannot hardcode 2,400 CSS custom properties (24 hues x 101 intensity
levels), the palette is computed at runtime.

**Standard stops.** At app startup and theme switch, the palette engine
generates CSS custom properties for 11 standard intensity stops per hue (0, 10,
20, ..., 100). This produces 264 pre-computed variables:

```css
--tug-palette-hue-25-red-tone-0: oklch(0.960 0.010 25);
--tug-palette-hue-25-red-tone-10: oklch(0.935 0.025 25);
--tug-palette-hue-25-red-tone-20: oklch(0.900 0.045 25);
/* ... */
--tug-palette-hue-25-red-tone-50: oklch(0.700 0.110 25);
/* ... */
--tug-palette-hue-25-red-tone-100: oklch(0.420 0.220 25);
```

These are injected into a `<style id="tug-palette">` element, just like theme
overrides. Components that need a standard stop use
`var(--tug-palette-hue-25-red-tone-50)`.

**Arbitrary intensities.** For non-standard values (e.g., intensity 37), a
TypeScript utility function `tugPaletteColor('red', 37)` returns the raw
`oklch(...)` string. This is used in:

- Inline styles set by the mutation/appearance zone (zero re-renders).
- Inspector panels and color pickers that need continuous color ramps.
- Data visualization where chart series colors may be interpolated.

**Theme influence.** Themes can customize the palette engine by overriding:

- Per-hue angle adjustments (shift the "red" hue 5 degrees warmer).
- L/C curve parameters (a theme with lower contrast uses a narrower L range).
- Per-hue chroma caps (prevent gamut clipping for that theme's display target).

These overrides live in the theme file as structured comment metadata or as a
small set of CSS custom properties consumed by the palette engine at load time:

```css
/* In bluenote.css */
:root {
  --tug-theme-lc-l-max: 0.93;
  --tug-theme-lc-l-min: 0.40;
  --tug-theme-lc-c-max: 0.20;
  --tug-theme-hue-red: 28;   /* slightly warmer red for Bluenote */
}
```

### Backward Compatibility with Named Tones

For convenience in the semantic layer and for readability, the old tone names
map to specific intensities:

| Tone Name | Intensity | Use Case |
|-----------|-----------|----------|
| `soft` | 15 | Subtle backgrounds, tinted washes |
| `default` | 50 | General-purpose, the workhorse value |
| `strong` | 75 | Emphasized elements, primary actions |
| `intense` | 100 | Alerts, critical states, maximum impact |

These are aliases, not separate tokens. `--tug-palette-hue-25-red-soft` resolves
to `--tug-palette-hue-25-red-tone-15`. Components should prefer the numeric
form for clarity, but the named aliases exist for readability in the semantic
layer.

---

## Global Scale System

### The Problem

Resizing a design system today requires touching dozens of token definitions:
every font size, every spacing value, every radius, every icon dimension. This
makes accessibility-driven scaling (larger UI for low vision) or density-driven
scaling (compact mode for power users) a massive coordination effort.

### Design: One Root Scale, Per-Component Overrides

**Root scale.** A single CSS custom property controls all dimensions:

```css
:root {
  --tug-scale: 1;
}
```

Every size-related token in the system includes `--tug-scale` as a factor:

```css
:root {
  --tug-base-font-size-md: calc(14px * var(--tug-scale));
  --tug-base-font-size-sm: calc(12px * var(--tug-scale));
  --tug-base-font-size-lg: calc(16px * var(--tug-scale));
  --tug-base-space-md: calc(8px * var(--tug-scale));
  --tug-base-space-lg: calc(12px * var(--tug-scale));
  --tug-base-radius-md: calc(6px * var(--tug-scale));
  --tug-base-icon-size-md: calc(16px * var(--tug-scale));
  --tug-base-stroke-thin: calc(1px * var(--tug-scale));
  /* ... every dimension token follows this pattern */
}
```

Setting `--tug-scale: 1.25` makes the entire UI 25% larger. Setting
`--tug-scale: 0.85` produces a compact mode. The relationship between all
elements is preserved because every dimension scales by the same factor.

**Component-level scale.** Each `Tug*` component family has an optional
component scale that multiplies on top of the root scale:

```css
.tug-button {
  --tug-comp-scale: var(--tug-comp-button-scale, 1);
  font-size: calc(var(--tug-base-font-size-md) * var(--tug-comp-scale));
  padding: calc(var(--tug-base-space-xs) * var(--tug-comp-scale))
           calc(var(--tug-base-space-sm) * var(--tug-comp-scale));
  border-radius: calc(var(--tug-base-radius-sm) * var(--tug-comp-scale));
}
```

The component scale defaults to `1`, meaning it inherits the global scale
unchanged. A designer can set `--tug-comp-button-scale: 0.9` to make buttons
slightly more compact than the rest of the UI, or `--tug-comp-tab-scale: 1.1`
to make the tab bar slightly more spacious.

**What scales and what doesn't.** The global scale affects:

- Font sizes (all tiers).
- Spacing tokens (all tiers).
- Border radii.
- Icon sizes.
- Stroke widths (with a floor: strokes below 1px clamp to 1px).
- Component internal dimensions (padding, gaps, min-heights).

The global scale does **not** affect:

- Border widths (kept at 1px for crispness — a 2x scale should not produce
  2px borders).
- Shadow offsets and blur radii (these are perceptual, not dimensional).
- Opacity values.
- Color values.
- Z-index values.
- Animation timing (that is the timing system's job).

**Implementation note:** The `calc()` multiplication means CSS custom properties
must be registered with `@property` as `<number>` or `<length>` for the
multiplication to work correctly in all contexts. Alternatively, the palette
engine can pre-compute scaled values at startup — the same injection pattern
used for computed colors.

### Accessibility Use Cases

| `--tug-scale` | Use Case |
|---------------|----------|
| `0.85` | Compact/dense mode for power users |
| `1.0` | Default |
| `1.25` | Large text mode |
| `1.5` | Low-vision accessible mode |
| `2.0` | Extreme magnification / demo mode |

The scale value can be exposed in the Settings card as a slider, persisted in
tugbank (`dev.tugtool.app` domain, key `scale`), and restored on reload.

---

## Global Timing System

### The Problem

The current system has `--td-duration-scalar` that multiplies animation
durations, plus a `prefers-reduced-motion` media query that sets it to `0.001`.
This is the right idea but it needs to be formalized as a first-class system
feature and extended to cover all timing in the system, not just the four
named duration tokens.

### Design: One Root Timing, Universal Application

**Root timing.** A single CSS custom property controls all temporal values:

```css
:root {
  --tug-timing: 1;
}
```

Every duration and delay in the system includes `--tug-timing` as a factor:

```css
:root {
  --tug-base-motion-duration-instant: calc(0ms * var(--tug-timing));
  --tug-base-motion-duration-fast: calc(100ms * var(--tug-timing));
  --tug-base-motion-duration-moderate: calc(200ms * var(--tug-timing));
  --tug-base-motion-duration-slow: calc(350ms * var(--tug-timing));
  --tug-base-motion-duration-glacial: calc(500ms * var(--tug-timing));
}
```

**The `--tug-motion` on/off switch.** Separate from timing speed, motion can be
turned off entirely. This is a discrete toggle, not a continuous value:

```css
:root {
  --tug-motion: 1; /* 1 = motion enabled, 0 = motion disabled */
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --tug-motion: 0;
  }
}
```

When `--tug-motion` is `0`, all animations and transitions are disabled. This is
implemented by components checking the value and conditionally applying
animation classes, or by a global rule:

```css
[data-tug-motion="off"] *,
[data-tug-motion="off"] *::before,
[data-tug-motion="off"] *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
}
```

The `data-tug-motion` attribute is set on `<body>` by the theme engine based on
the `--tug-motion` value. This gives CSS a discrete hook to work with, since
`calc()` inside `animation-duration` has browser support limitations.

**Why two controls?** The timing scalar and the motion toggle serve different
purposes:

- `--tug-timing: 5` = slow motion for debugging. Animations play at 5x normal
  duration. Invaluable for tuning easing curves and transition choreography.
- `--tug-timing: 0.5` = snappy mode. Everything feels faster.
- `--tug-motion: 0` = no motion at all. Accessibility requirement for users
  who experience motion sickness or vestibular disorders. This is categorically
  different from "very fast motion" — it means no visual movement whatsoever.

**Component-level timing is not proposed.** Unlike scale (where different
components may need different densities), there is no clear use case for
per-component timing overrides. All motion in the system should feel unified.
If a specific animation needs a unique duration, it should define a named token
in `--tug-base-motion-*`, not a component-level multiplier.

### Easing tokens remain as-is

Easing curves are not affected by the timing scalar. They describe the shape of
motion, not its duration:

```css
:root {
  --tug-base-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
  --tug-base-motion-easing-enter: cubic-bezier(0, 0, 0, 1);
  --tug-base-motion-easing-exit: cubic-bezier(0.2, 0, 1, 1);
}
```

### JavaScript Integration

For animations driven by JavaScript (e.g., RAF-based drag, spring physics,
inspector scrub), the timing value must be readable from JS:

```typescript
function getTugTiming(): number {
  const raw = getComputedStyle(document.body)
    .getPropertyValue('--tug-timing').trim();
  return parseFloat(raw) || 1;
}

function isTugMotionEnabled(): boolean {
  return document.body.dataset.tugMotion !== 'off';
}
```

The `MutationTransaction` preview animations and `SelectionGuard` RAF-based
autoscroll should both respect these values.

### Debug and Accessibility Use Cases

| `--tug-timing` | `--tug-motion` | Effect |
|----------------|----------------|--------|
| `1` | `1` | Normal (default) |
| `5` | `1` | Slow motion — debug animations |
| `10` | `1` | Very slow — inspect individual frames |
| `0.5` | `1` | Snappy — everything faster |
| `any` | `0` | No motion — accessibility mode |

Both values can be exposed in the Settings card and persisted in tugbank.

---

## Proposed Naming Grammar

External research suggests a useful combined model:

- Primer contributes `base / functional / component` layering and
  `pattern-property-state` naming.
- Chakra contributes the clarity of `bg / fg / border / focusRing`.
- Carbon contributes role + state families like `hover / active / selected`.
- Spectrum contributes the explicit distinction between aliases and component
  tokens.

### Recommended Grammar

For canonical semantic tokens:

`--tug-base-<domain>-<role>[-<emphasis>][-<state>]`

Examples:

- `--tug-base-fg-default`
- `--tug-base-fg-muted`
- `--tug-base-border-default`
- `--tug-base-border-accent-hover`
- `--tug-base-surface-control-active`
- `--tug-base-tab-underline-active`
- `--tug-base-focus-ring-default`
- `--tug-base-banner-warning-bg`

For component or pattern tokens:

`--tug-comp-<pattern>-<role>[-<state>]`

Examples:

- `--tug-comp-control-border-rest`
- `--tug-comp-button-primary-bg-hover`
- `--tug-comp-menu-item-bg-hover`
- `--tug-comp-table-row-bg-selected`

The important distinction:

- `--tug-base-*` is the shared semantic language.
- `--tug-comp-*` is where a component family binds itself to that shared
  language.

---

## Proposed Token Architecture

### Layer 0: Theme / Palette Primitives (`--tug-palette-*`)

Purpose:

- Raw values only.
- Theme files own this layer.
- No component or app-role meaning.

Examples:

- `--tug-palette-neutral-0` through `--tug-palette-neutral-9`
- `--tug-palette-hue-25-red-tone-0` through `--tug-palette-hue-25-red-tone-100`
  (standard stops at 0, 10, 20, ..., 100)
- `--tug-palette-hue-55-orange-tone-50`
- `--tug-palette-hue-190-cyan-tone-75`
- `--tug-palette-shadow-soft`
- `--tug-palette-shadow-strong`
- `--tug-palette-grid-line`
- `--tug-palette-screen-bg`
- `--tug-palette-screen-fg`

Rules:

- Themes only.
- No direct component usage.
- Chromatic tokens are computed at runtime by the palette engine.
- Themes may customize the palette engine parameters (hue shifts, L/C curve,
  chroma caps) but the hue family names remain stable across themes.
- Neutral scale tokens are declared statically per theme (not computed).

### Layer 0.5: Global Multipliers

These are not palette values but system-level factors that affect how every
other token is consumed.

```css
:root {
  --tug-scale: 1;    /* multiplies all dimensions */
  --tug-timing: 1;   /* multiplies all durations */
  --tug-motion: 1;   /* 1 = motion on, 0 = motion off */
}
```

Rules:

- Set at the `:root` level.
- Persisted in tugbank (`dev.tugtool.app` domain).
- Overridable by user preferences, accessibility settings, or debug controls.
- Every size token in Layer 1 includes `var(--tug-scale)` as a factor.
- Every duration token in Layer 1 includes `var(--tug-timing)` as a factor.

### Layer 1: Canonical Semantics (`--tug-base-*`)

Purpose:

- The stable, readable contract for app and component styling.
- All public semantics live here.

Rules:

- All component styling eventually resolves from this layer.
- No raw palette values in component CSS.
- No `--td-*`, `--tways-*`, or legacy aliases after migration.
- All size tokens include `calc(... * var(--tug-scale))`.
- All duration tokens include `calc(... * var(--tug-timing))`.

### Layer 2: Component / Pattern Tokens (`--tug-comp-*`)

Purpose:

- Bind a component or component family to shared semantics.
- Allow family-specific tuning without inventing new raw values.

Examples:

- `--tug-comp-button-primary-bg-rest: var(--tug-base-action-primary-bg-rest);`
- `--tug-comp-tab-badge-bg: var(--tug-base-badge-accent-bg);`
- `--tug-comp-card-header-bg-active: var(--tug-base-card-header-bg-active);`
- `--tug-comp-button-scale: 1;` (component-level scale override)

Rules:

- May exist only when base semantics are too generic.
- Must resolve entirely from `--tug-base-*`.
- Should prefer family names like `control`, `button`, `field`, `menu`, `tab`,
  `card`, `table`, `inspector` over one-off widget names whenever possible.
- Each component family may declare a `--tug-comp-<family>-scale` property
  (default `1`) that its internal dimensions multiply by.

---

## Revised `--tug-base-*` Semantic Taxonomy

This is the part the earlier draft undershot. The taxonomy below is
intentionally large because the roadmap is large.

### A. Foundation Domains

#### Surfaces

- `--tug-base-bg-app`
- `--tug-base-bg-canvas`
- `--tug-base-surface-sunken`
- `--tug-base-surface-default`
- `--tug-base-surface-raised`
- `--tug-base-surface-overlay`
- `--tug-base-surface-inset`
- `--tug-base-surface-control`
- `--tug-base-surface-control-hover`
- `--tug-base-surface-control-active`
- `--tug-base-surface-content`
- `--tug-base-surface-screen`

#### Foreground / Text

- `--tug-base-fg-default`
- `--tug-base-fg-muted`
- `--tug-base-fg-subtle`
- `--tug-base-fg-disabled`
- `--tug-base-fg-inverse`
- `--tug-base-fg-placeholder`
- `--tug-base-fg-link`
- `--tug-base-fg-link-hover`
- `--tug-base-fg-onAccent`
- `--tug-base-fg-onDanger`
- `--tug-base-fg-onWarning`
- `--tug-base-fg-onSuccess`

#### Icon

- `--tug-base-icon-default`
- `--tug-base-icon-muted`
- `--tug-base-icon-disabled`
- `--tug-base-icon-active`
- `--tug-base-icon-onAccent`

#### Borders / Dividers / Focus

- `--tug-base-border-default`
- `--tug-base-border-muted`
- `--tug-base-border-strong`
- `--tug-base-border-inverse`
- `--tug-base-border-accent`
- `--tug-base-border-danger`
- `--tug-base-divider-default`
- `--tug-base-divider-muted`
- `--tug-base-focus-ring-default`
- `--tug-base-focus-ring-danger`
- `--tug-base-focus-ring-offset`

#### Elevation / Overlay

- `--tug-base-shadow-xs`
- `--tug-base-shadow-sm`
- `--tug-base-shadow-md`
- `--tug-base-shadow-lg`
- `--tug-base-shadow-xl`
- `--tug-base-shadow-card-active`
- `--tug-base-shadow-card-inactive`
- `--tug-base-shadow-overlay`
- `--tug-base-overlay-dim`
- `--tug-base-overlay-scrim`
- `--tug-base-overlay-highlight`

#### Typography (scaled)

All font size and line height tokens include `var(--tug-scale)`:

- `--tug-base-font-family-sans`
- `--tug-base-font-family-mono`
- `--tug-base-font-size-2xs` = `calc(10px * var(--tug-scale))`
- `--tug-base-font-size-xs` = `calc(11px * var(--tug-scale))`
- `--tug-base-font-size-sm` = `calc(12px * var(--tug-scale))`
- `--tug-base-font-size-md` = `calc(14px * var(--tug-scale))`
- `--tug-base-font-size-lg` = `calc(16px * var(--tug-scale))`
- `--tug-base-font-size-xl` = `calc(20px * var(--tug-scale))`
- `--tug-base-font-size-2xl` = `calc(24px * var(--tug-scale))`
- `--tug-base-line-height-2xs` = `calc(14px * var(--tug-scale))`
- `--tug-base-line-height-xs` = `calc(16px * var(--tug-scale))`
- `--tug-base-line-height-sm` = `calc(18px * var(--tug-scale))`
- `--tug-base-line-height-md` = `calc(20px * var(--tug-scale))`
- `--tug-base-line-height-lg` = `calc(24px * var(--tug-scale))`
- `--tug-base-line-height-xl` = `calc(28px * var(--tug-scale))`
- `--tug-base-line-height-2xl` = `calc(32px * var(--tug-scale))`

#### Spacing (scaled)

- `--tug-base-space-2xs` = `calc(2px * var(--tug-scale))`
- `--tug-base-space-xs` = `calc(4px * var(--tug-scale))`
- `--tug-base-space-sm` = `calc(6px * var(--tug-scale))`
- `--tug-base-space-md` = `calc(8px * var(--tug-scale))`
- `--tug-base-space-lg` = `calc(12px * var(--tug-scale))`
- `--tug-base-space-xl` = `calc(16px * var(--tug-scale))`
- `--tug-base-space-2xl` = `calc(24px * var(--tug-scale))`

#### Radius (scaled)

- `--tug-base-radius-2xs` = `calc(1px * var(--tug-scale))`
- `--tug-base-radius-xs` = `calc(2px * var(--tug-scale))`
- `--tug-base-radius-sm` = `calc(4px * var(--tug-scale))`
- `--tug-base-radius-md` = `calc(6px * var(--tug-scale))`
- `--tug-base-radius-lg` = `calc(8px * var(--tug-scale))`
- `--tug-base-radius-xl` = `calc(12px * var(--tug-scale))`
- `--tug-base-radius-2xl` = `calc(16px * var(--tug-scale))`

#### Stroke (scaled with floor)

- `--tug-base-stroke-hairline` = `max(1px, calc(0.5px * var(--tug-scale)))`
- `--tug-base-stroke-thin` = `max(1px, calc(1px * var(--tug-scale)))`
- `--tug-base-stroke-medium` = `calc(1.5px * var(--tug-scale))`
- `--tug-base-stroke-thick` = `calc(2px * var(--tug-scale))`

#### Icon Size (scaled)

- `--tug-base-icon-size-2xs` = `calc(10px * var(--tug-scale))`
- `--tug-base-icon-size-xs` = `calc(12px * var(--tug-scale))`
- `--tug-base-icon-size-sm` = `calc(14px * var(--tug-scale))`
- `--tug-base-icon-size-md` = `calc(16px * var(--tug-scale))`
- `--tug-base-icon-size-lg` = `calc(20px * var(--tug-scale))`
- `--tug-base-icon-size-xl` = `calc(24px * var(--tug-scale))`

#### Motion (timed)

All durations include `var(--tug-timing)`:

- `--tug-base-motion-duration-instant` = `calc(0ms * var(--tug-timing))`
- `--tug-base-motion-duration-fast` = `calc(100ms * var(--tug-timing))`
- `--tug-base-motion-duration-moderate` = `calc(200ms * var(--tug-timing))`
- `--tug-base-motion-duration-slow` = `calc(350ms * var(--tug-timing))`
- `--tug-base-motion-duration-glacial` = `calc(500ms * var(--tug-timing))`
- `--tug-base-motion-easing-standard` = `cubic-bezier(0.2, 0, 0, 1)`
- `--tug-base-motion-easing-enter` = `cubic-bezier(0, 0, 0, 1)`
- `--tug-base-motion-easing-exit` = `cubic-bezier(0.2, 0, 1, 1)`

#### Shared Motion Patterns

- `--tug-base-motion-pattern-fade-enter`
- `--tug-base-motion-pattern-fade-exit`
- `--tug-base-motion-pattern-overlay-enter`
- `--tug-base-motion-pattern-overlay-exit`
- `--tug-base-motion-pattern-collapse`
- `--tug-base-motion-pattern-expand`
- `--tug-base-motion-pattern-crossfade`
- `--tug-base-motion-pattern-startup-reveal`

### B. Accent System

This is a first-class domain, not a side note.

#### Palette Foundation

The accent system derives from the computed palette. Semantic accent tokens
reference specific hue + intensity combinations:

```css
--tug-base-accent-default: var(--tug-palette-hue-55-orange-tone-50);
--tug-base-accent-strong: var(--tug-palette-hue-55-orange-tone-75);
--tug-base-accent-muted: var(--tug-palette-hue-55-orange-tone-25);
--tug-base-accent-emphasis: var(--tug-palette-hue-55-orange-tone-90);
--tug-base-accent-cool-default: var(--tug-palette-hue-190-cyan-tone-50);
--tug-base-accent-info: var(--tug-palette-hue-190-cyan-tone-70);
--tug-base-accent-positive: var(--tug-palette-hue-145-green-tone-70);
--tug-base-accent-warning: var(--tug-palette-hue-100-yellow-tone-70);
--tug-base-accent-danger: var(--tug-palette-hue-25-red-tone-70);
```

Because these resolve from the computed palette, a theme that shifts the orange
hue angle 5 degrees warmer automatically shifts the accent with it. A theme that
adjusts the L/C curve automatically adjusts the accent's lightness/chroma
relationship.

#### Accent-Derived Interaction Tokens

- `--tug-base-accent-bg-subtle`
- `--tug-base-accent-bg-emphasis`
- `--tug-base-accent-border`
- `--tug-base-accent-border-hover`
- `--tug-base-accent-underline-active`
- `--tug-base-accent-guide`
- `--tug-base-accent-flash`

### C. Selection / Highlight / Preview

- `--tug-base-selection-bg`
- `--tug-base-selection-fg`
- `--tug-base-highlight-hover`
- `--tug-base-highlight-dropTarget`
- `--tug-base-highlight-preview`
- `--tug-base-highlight-inspectorTarget`
- `--tug-base-highlight-snapGuide`
- `--tug-base-highlight-flash`

### D. Workspace Chrome

#### Card

- `--tug-base-card-bg`
- `--tug-base-card-border`
- `--tug-base-card-shadow-active`
- `--tug-base-card-shadow-inactive`
- `--tug-base-card-dim-overlay`

#### Card Header

- `--tug-base-card-header-bg-active`
- `--tug-base-card-header-bg-inactive`
- `--tug-base-card-header-bg-collapsed`
- `--tug-base-card-header-fg`
- `--tug-base-card-header-icon-active`
- `--tug-base-card-header-icon-inactive`
- `--tug-base-card-header-divider`
- `--tug-base-card-header-button-bg-hover`
- `--tug-base-card-header-button-bg-active`
- `--tug-base-card-header-button-fg`
- `--tug-base-card-header-button-fg-danger`
- `--tug-base-card-header-button-fg-danger-hover`
- `--tug-base-card-accessory-bg`
- `--tug-base-card-accessory-border`
- `--tug-base-card-findbar-bg`
- `--tug-base-card-findbar-border`
- `--tug-base-card-findbar-match`
- `--tug-base-card-findbar-match-active`

#### Tab Bar

- `--tug-base-tab-bar-bg`
- `--tug-base-tab-bg-rest`
- `--tug-base-tab-bg-hover`
- `--tug-base-tab-bg-active`
- `--tug-base-tab-bg-compact`
- `--tug-base-tab-fg-rest`
- `--tug-base-tab-fg-active`
- `--tug-base-tab-fg-compact`
- `--tug-base-tab-close-bg-hover`
- `--tug-base-tab-close-fg-hover`
- `--tug-base-tab-underline-active`
- `--tug-base-tab-dropTarget-bg`
- `--tug-base-tab-dropTarget-border`
- `--tug-base-tab-badge-bg`
- `--tug-base-tab-badge-fg`
- `--tug-base-tab-ghost-bg`
- `--tug-base-tab-ghost-border`
- `--tug-base-tab-insertIndicator`
- `--tug-base-tab-overflow-trigger-bg`
- `--tug-base-tab-overflow-trigger-fg`
- `--tug-base-tab-add-bg-hover`
- `--tug-base-tab-add-fg`
- `--tug-base-tab-typePicker-bg`
- `--tug-base-tab-typePicker-fg`

#### Dock / Canvas / Snap

- `--tug-base-dock-bg`
- `--tug-base-dock-border`
- `--tug-base-dock-indicator`
- `--tug-base-dock-menu-caret`
- `--tug-base-dock-button-bg-hover`
- `--tug-base-dock-button-bg-active`
- `--tug-base-dock-button-fg`
- `--tug-base-dock-button-fg-active`
- `--tug-base-dock-button-fg-attention`
- `--tug-base-dock-button-badge-bg`
- `--tug-base-dock-button-badge-fg`
- `--tug-base-dock-button-insertIndicator`
- `--tug-base-canvas-grid-line`
- `--tug-base-canvas-grid-emphasis`
- `--tug-base-snap-guide`
- `--tug-base-sash-hover`
- `--tug-base-flash-perimeter`

#### Snap Sets

- `--tug-base-set-member-border-collapsed`
- `--tug-base-set-member-corner-squared`
- `--tug-base-set-focused-outline`
- `--tug-base-set-hull-flash`
- `--tug-base-set-breakout-flash`
- `--tug-base-set-dropTarget`

### E. Actions and Generic Controls

This follows Primer's useful idea of generic `control` patterns, not just
component-by-component naming.

#### Cross-Control Disabled Contract

Disabled controls should be treated as a first-class system state, not as an
afterthought handled ad hoc by opacity alone.

Every interactive control family should be able to derive its disabled
presentation from a shared base contract, with component-specific overrides
only when necessary.

Core disabled-control tokens:

- `--tug-base-control-disabled-bg`
- `--tug-base-control-disabled-fg`
- `--tug-base-control-disabled-border`
- `--tug-base-control-disabled-icon`
- `--tug-base-control-disabled-opacity`
- `--tug-base-control-disabled-shadow`

These are the cross-control defaults for disabled presentation. More specific
control families may override them through the action, field, toggle, range, or
menu-item domains below, but they should not invent unrelated disabled styling
rules.

#### Generic Action Tokens

- `--tug-base-action-primary-bg-rest`
- `--tug-base-action-primary-bg-hover`
- `--tug-base-action-primary-bg-active`
- `--tug-base-action-primary-fg`
- `--tug-base-action-primary-border`
- `--tug-base-action-secondary-bg-rest`
- `--tug-base-action-secondary-bg-hover`
- `--tug-base-action-secondary-bg-active`
- `--tug-base-action-secondary-fg`
- `--tug-base-action-secondary-border`
- `--tug-base-action-ghost-bg-hover`
- `--tug-base-action-ghost-fg`
- `--tug-base-action-destructive-bg-rest`
- `--tug-base-action-destructive-bg-hover`
- `--tug-base-action-destructive-bg-active`
- `--tug-base-action-destructive-fg`
- `--tug-base-action-destructive-border`
- `--tug-base-action-disabled-bg`
- `--tug-base-action-disabled-fg`
- `--tug-base-action-disabled-border`

#### Generic Field Tokens

- `--tug-base-field-bg-rest`
- `--tug-base-field-bg-hover`
- `--tug-base-field-bg-focus`
- `--tug-base-field-bg-disabled`
- `--tug-base-field-bg-readOnly`
- `--tug-base-field-fg`
- `--tug-base-field-fg-disabled`
- `--tug-base-field-fg-readOnly`
- `--tug-base-field-placeholder`
- `--tug-base-field-border-rest`
- `--tug-base-field-border-hover`
- `--tug-base-field-border-focus`
- `--tug-base-field-border-invalid`
- `--tug-base-field-border-valid`
- `--tug-base-field-border-disabled`
- `--tug-base-field-border-readOnly`
- `--tug-base-field-helper`
- `--tug-base-field-label`
- `--tug-base-field-required`
- `--tug-base-field-meta`
- `--tug-base-field-counter`
- `--tug-base-field-limit`
- `--tug-base-field-dirty`
- `--tug-base-field-readOnly`
- `--tug-base-field-error`
- `--tug-base-field-warning`
- `--tug-base-field-success`

#### Toggle / Range Tokens

- `--tug-base-toggle-track-off`
- `--tug-base-toggle-track-on`
- `--tug-base-toggle-track-disabled`
- `--tug-base-toggle-track-mixed`
- `--tug-base-toggle-thumb`
- `--tug-base-toggle-thumb-disabled`
- `--tug-base-toggle-icon-disabled`
- `--tug-base-toggle-icon-mixed`
- `--tug-base-checkmark`
- `--tug-base-checkmark-mixed`
- `--tug-base-radio-dot`
- `--tug-base-range-track`
- `--tug-base-range-fill`
- `--tug-base-range-thumb`
- `--tug-base-range-thumb-disabled`
- `--tug-base-range-tick`
- `--tug-base-range-scrub-active`
- `--tug-base-range-label`
- `--tug-base-range-annotation`
- `--tug-base-range-value`

### F. Menus, Overlays, Modalities, Feedback

#### Menu / Popover / Tooltip

- `--tug-base-menu-bg`
- `--tug-base-menu-fg`
- `--tug-base-menu-border`
- `--tug-base-menu-shadow`
- `--tug-base-menu-item-bg-hover`
- `--tug-base-menu-item-bg-selected`
- `--tug-base-menu-item-fg`
- `--tug-base-menu-item-fg-disabled`
- `--tug-base-menu-item-fg-danger`
- `--tug-base-menu-item-meta`
- `--tug-base-menu-item-shortcut`
- `--tug-base-menu-item-icon`
- `--tug-base-menu-item-icon-danger`
- `--tug-base-menu-item-chevron`
- `--tug-base-popover-bg`
- `--tug-base-popover-fg`
- `--tug-base-popover-border`
- `--tug-base-tooltip-bg`
- `--tug-base-tooltip-fg`
- `--tug-base-tooltip-border`

#### Dialog / Sheet / Toast / Alert

- `--tug-base-dialog-bg`
- `--tug-base-dialog-fg`
- `--tug-base-dialog-border`
- `--tug-base-sheet-bg`
- `--tug-base-sheet-fg`
- `--tug-base-sheet-border`
- `--tug-base-toast-info-bg`
- `--tug-base-toast-info-fg`
- `--tug-base-toast-success-bg`
- `--tug-base-toast-success-fg`
- `--tug-base-toast-warning-bg`
- `--tug-base-toast-warning-fg`
- `--tug-base-toast-danger-bg`
- `--tug-base-toast-danger-fg`
- `--tug-base-alert-bg`
- `--tug-base-alert-fg`

#### Status / Badge / Progress / Skeleton / Banner

- `--tug-base-badge-neutral-bg`
- `--tug-base-badge-neutral-fg`
- `--tug-base-badge-accent-bg`
- `--tug-base-badge-accent-fg`
- `--tug-base-badge-success-bg`
- `--tug-base-badge-success-fg`
- `--tug-base-badge-warning-bg`
- `--tug-base-badge-warning-fg`
- `--tug-base-badge-danger-bg`
- `--tug-base-badge-danger-fg`
- `--tug-base-status-success`
- `--tug-base-status-warning`
- `--tug-base-status-danger`
- `--tug-base-status-info`
- `--tug-base-progress-track`
- `--tug-base-progress-fill`
- `--tug-base-spinner`
- `--tug-base-skeleton-base`
- `--tug-base-skeleton-highlight`
- `--tug-base-emptyState-fg`
- `--tug-base-emptyState-icon`
- `--tug-base-banner-info-bg`
- `--tug-base-banner-info-fg`
- `--tug-base-banner-warning-bg`
- `--tug-base-banner-warning-fg`
- `--tug-base-banner-danger-bg`
- `--tug-base-banner-danger-fg`
- `--tug-base-kbd-bg`
- `--tug-base-kbd-fg`
- `--tug-base-kbd-border`

#### Scroll Area / Separator / Avatar

- `--tug-base-scrollbar-track`
- `--tug-base-scrollbar-thumb`
- `--tug-base-scrollbar-thumb-hover`
- `--tug-base-separator`
- `--tug-base-avatar-bg`
- `--tug-base-avatar-fg`
- `--tug-base-avatar-ring`

### G. Tables, Lists, Stats, Visualization

#### Table / List

- `--tug-base-table-header-bg`
- `--tug-base-table-header-fg`
- `--tug-base-table-row-bg`
- `--tug-base-table-row-bg-striped`
- `--tug-base-table-row-bg-hover`
- `--tug-base-table-row-bg-selected`
- `--tug-base-table-row-border`
- `--tug-base-table-cell-divider`
- `--tug-base-table-sortIndicator`
- `--tug-base-list-row-hover`
- `--tug-base-list-row-selected`

#### Stat / Trend

- `--tug-base-stat-label`
- `--tug-base-stat-value`
- `--tug-base-stat-trend-positive`
- `--tug-base-stat-trend-negative`
- `--tug-base-stat-trend-neutral`

#### Chart / Gauge

Chart series colors reference the computed palette directly:

- `--tug-base-chart-series-warm` = `var(--tug-palette-hue-55-orange-tone-60)`
- `--tug-base-chart-series-cool` = `var(--tug-palette-hue-190-cyan-tone-60)`
- `--tug-base-chart-series-violet` = `var(--tug-palette-hue-280-violet-tone-60)`
- `--tug-base-chart-series-rose` = `var(--tug-palette-hue-340-rose-tone-60)`
- `--tug-base-chart-series-verdant` = `var(--tug-palette-hue-145-green-tone-60)`
- `--tug-base-chart-series-golden` = `var(--tug-palette-hue-85-gold-tone-60)`
- `--tug-base-chart-series-orchid` = `var(--tug-palette-hue-295-purple-tone-60)`
- `--tug-base-chart-series-coral` = `var(--tug-palette-hue-35-coral-tone-50)`

Gauge and chart infrastructure tokens:

- `--tug-base-chart-grid`
- `--tug-base-chart-axis`
- `--tug-base-chart-tick`
- `--tug-base-chart-threshold-warning`
- `--tug-base-chart-threshold-danger`
- `--tug-base-gauge-track`
- `--tug-base-gauge-fill`
- `--tug-base-gauge-needle`
- `--tug-base-gauge-tick-major`
- `--tug-base-gauge-tick-minor`
- `--tug-base-gauge-readout`
- `--tug-base-gauge-threshold-warning`
- `--tug-base-gauge-threshold-danger`
- `--tug-base-gauge-unit`
- `--tug-base-gauge-annotation`

### H. Syntax, Terminal, Code-Oriented Domains

The existing code already declares syntax and chart families. Those should not
be treated as optional extras.

#### Syntax

- `--tug-base-syntax-keyword`
- `--tug-base-syntax-string`
- `--tug-base-syntax-number`
- `--tug-base-syntax-function`
- `--tug-base-syntax-type`
- `--tug-base-syntax-variable`
- `--tug-base-syntax-comment`
- `--tug-base-syntax-operator`
- `--tug-base-syntax-punctuation`
- `--tug-base-syntax-constant`
- `--tug-base-syntax-decorator`
- `--tug-base-syntax-tag`
- `--tug-base-syntax-attribute`

#### Terminal

- `--tug-base-terminal-bg`
- `--tug-base-terminal-fg`
- `--tug-base-terminal-fg-muted`
- `--tug-base-terminal-cursor`
- `--tug-base-terminal-selection-bg`
- `--tug-base-terminal-border`
- `--tug-base-terminal-ansi-black`
- `--tug-base-terminal-ansi-red`
- `--tug-base-terminal-ansi-green`
- `--tug-base-terminal-ansi-yellow`
- `--tug-base-terminal-ansi-blue`
- `--tug-base-terminal-ansi-magenta`
- `--tug-base-terminal-ansi-cyan`
- `--tug-base-terminal-ansi-white`

#### Conversation / Chat / Code Block

- `--tug-base-chat-transcript-bg`
- `--tug-base-chat-message-user-bg`
- `--tug-base-chat-message-assistant-bg`
- `--tug-base-chat-message-system-bg`
- `--tug-base-chat-message-border`
- `--tug-base-chat-composer-bg`
- `--tug-base-chat-composer-border`
- `--tug-base-chat-attachment-bg`
- `--tug-base-chat-attachment-border`
- `--tug-base-chat-attachment-fg`
- `--tug-base-codeBlock-bg`
- `--tug-base-codeBlock-border`
- `--tug-base-codeBlock-header-bg`
- `--tug-base-codeBlock-header-fg`

#### Files / Git / Tree

- `--tug-base-tree-row-bg-hover`
- `--tug-base-tree-row-bg-selected`
- `--tug-base-tree-row-bg-current`
- `--tug-base-tree-row-fg`
- `--tug-base-tree-chevron`
- `--tug-base-file-status-added`
- `--tug-base-file-status-modified`
- `--tug-base-file-status-deleted`
- `--tug-base-file-status-renamed`
- `--tug-base-diff-addition-bg`
- `--tug-base-diff-addition-fg`
- `--tug-base-diff-deletion-bg`
- `--tug-base-diff-deletion-fg`

#### Workflow / Feed Progress

- `--tug-base-feed-bg`
- `--tug-base-feed-border`
- `--tug-base-feed-step-bg`
- `--tug-base-feed-step-fg`
- `--tug-base-feed-step-active`
- `--tug-base-feed-step-complete`
- `--tug-base-feed-step-error`
- `--tug-base-feed-stream-cursor`
- `--tug-base-feed-handoff`

### I. Inspector / Dev Tooling

This category is required by the roadmap and by the requested hover inspector.

- `--tug-base-inspector-panel-bg`
- `--tug-base-inspector-panel-border`
- `--tug-base-inspector-panel-bg-pinned`
- `--tug-base-inspector-section-bg`
- `--tug-base-inspector-field-bg`
- `--tug-base-inspector-field-border`
- `--tug-base-inspector-field-readOnly`
- `--tug-base-inspector-field-inherited`
- `--tug-base-inspector-field-default`
- `--tug-base-inspector-field-preview`
- `--tug-base-inspector-field-cancelled`
- `--tug-base-inspector-target-outline`
- `--tug-base-inspector-preview-outline`
- `--tug-base-inspector-source-token`
- `--tug-base-inspector-source-class`
- `--tug-base-inspector-source-inline`
- `--tug-base-inspector-source-preview`
- `--tug-base-inspector-emptyState-fg`
- `--tug-base-inspector-emptyState-icon`
- `--tug-base-inspector-swatch-border`
- `--tug-base-inspector-scrub-track`
- `--tug-base-inspector-scrub-thumb`
- `--tug-base-inspector-scrub-active`
- `--tug-base-dev-overlay-bg`
- `--tug-base-dev-overlay-fg`
- `--tug-base-dev-overlay-border`
- `--tug-base-dev-overlay-targetHighlight`
- `--tug-base-dev-overlay-targetDim`

### J. Required Component Token Families

Some of the roadmap gaps are not solved by base semantics alone. These
component-token families should be treated as expected parts of the system.

- Dock and titlebar controls:
  - `--tug-comp-dock-button-*`
  - `--tug-comp-titlebar-button-*`
  - `--tug-comp-titlebar-accessory-*`
- Tab overflow and type picker:
  - `--tug-comp-tab-overflow-*`
  - `--tug-comp-tab-add-*`
  - `--tug-comp-tab-typePicker-*`
- Field metadata and range controls:
  - `--tug-comp-field-meta-*`
  - `--tug-comp-slider-annotation-*`
  - `--tug-comp-slider-value-*`
- Menu metadata:
  - `--tug-comp-menu-shortcut-*`
  - `--tug-comp-menu-icon-*`
  - `--tug-comp-menu-chevron-*`
- Visualization:
  - `--tug-comp-gauge-annotation-*`
  - `--tug-comp-gauge-threshold-*`
- Domain surfaces:
  - `--tug-comp-chat-*`
  - `--tug-comp-codeBlock-*`
  - `--tug-comp-tree-*`
  - `--tug-comp-feed-*`
  - `--tug-comp-sectionPanel-*`
- Tooling:
  - `--tug-comp-inspector-property-*`
  - `--tug-comp-devOverlay-*`
  - `--tug-comp-keybindingEditor-*`
- Scale overrides:
  - `--tug-comp-button-scale`
  - `--tug-comp-tab-scale`
  - `--tug-comp-dock-scale`
  - `--tug-comp-card-header-scale`
  - `--tug-comp-field-scale`
  - `--tug-comp-menu-scale`
  - `--tug-comp-badge-scale`
  - `--tug-comp-tooltip-scale`
  - `--tug-comp-gauge-scale`

---

## Accent Migration Map

The current accent contract needs a direct mapping so the migration is explicit.

### Current -> Proposed

| Current | Proposed |
|---------|----------|
| `--td-accent` | `--tug-base-accent-default` |
| `--td-accent-strong` | `--tug-base-accent-strong` |
| `--td-accent-cool` | `--tug-base-accent-cool-default` |
| `--td-accent-1` | `--tug-palette-hue-55-orange-tone-50` |
| `--td-accent-2` | `--tug-palette-hue-190-cyan-tone-50` |
| `--td-accent-3` | `--tug-palette-hue-280-violet-tone-50` |
| `--td-accent-4` | `--tug-palette-hue-25-red-tone-50` |
| `--td-accent-5` | `--tug-palette-hue-145-green-tone-50` |
| `--td-accent-6` | `--tug-palette-hue-100-yellow-tone-50` |
| `--td-accent-7` | `--tug-palette-hue-315-magenta-tone-50` |
| `--td-accent-8` | `--tug-palette-hue-35-coral-tone-30` |

### Derived Semantic Roles

| Current | Proposed |
|---------|----------|
| `--td-success` (accent 5) | `--tug-base-accent-positive` = `var(--tug-palette-hue-145-green-tone-70)` |
| `--td-warning` (accent 6) | `--tug-base-accent-warning` = `var(--tug-palette-hue-100-yellow-tone-70)` |
| `--td-danger` (accent 4) | `--tug-base-accent-danger` = `var(--tug-palette-hue-25-red-tone-70)` |
| `--td-info` (accent 2) | `--tug-base-accent-info` = `var(--tug-palette-hue-190-cyan-tone-70)` |

### Why This Is Better

- Chart, syntax, and multi-series visualization still get a stable expressive
  palette — now with continuous intensity control instead of fixed steps.
- Component authors no longer consume meaningless ordinals.
- Semantic roles such as info/warning/danger stop depending on "knowing" what
  accent number means what.
- Any hue at any intensity is available on demand via `tugPaletteColor()`.

---

## Legacy Removal Policy

The following are scheduled for full removal:

- `--td-*`
- `--tways-*`
- All legacy alias variables: `--background`, `--foreground`, `--card`,
  `--primary`, `--accent`, `--destructive`, `--chart-*`, `--syntax-*`.

### But the Bridge Must Be Deliberate

Because shadcn/Tailwind still relies on those names, migration must happen in
three passes:

1. Introduce `--tug-base-*` and `--tug-comp-*`.
2. Repoint the Tailwind/shadcn bridge from legacy aliases to new tokens.
3. Remove legacy alias declarations after all consumers are migrated.

This proposal rejects permanent legacy aliases. It does not reject temporary
migration shims.

---

## Dev-Mode `Ctrl+Option + Hover` Cascade Inspector

### Interaction Model

- Only available in dev mode.
- Hold `Ctrl+Option`.
- Hover any inspectable component or widget.
- A floating overlay appears near the cursor or pinned panel edge.

The overlay should show:

- Component or pattern identity.
- DOM path and class list.
- Selected computed properties: background, foreground, border, shadow, radius,
  typography.
- Full resolution chain for each inspected property:
  - Computed value.
  - Source CSS rule.
  - `--tug-comp-*` token if present.
  - `--tug-base-*` token it resolves from.
  - `--tug-palette-*` value beneath that (including the hue name and intensity
    number for computed palette colors).
- Current `--tug-scale` and `--tug-timing` values and their effect on the
  inspected element's dimensions and transitions.

### Technical Direction

This should build on the roadmap's existing inspector architecture:

- `StyleCascadeReader`.
- Mutation transactions.
- Property store.
- Responder-chain-aware inspector panels.

Recommended implementation:

1. Add a dev-only `StyleInspectorOverlay` singleton.
2. Track global modifier state for `Ctrl+Option`.
3. On pointer move with modifiers active:
   - Locate target with `elementFromPoint`.
   - Walk up to the nearest inspect root.
   - Read computed style.
   - Resolve token chain using a cascade reader utility.
4. Highlight the target element with a dev-only overlay token.
5. Allow pin/unpin so the user can stop live-hover and inspect in place.
6. `Escape` closes the overlay.

### Why This Belongs in the Theme Machinery

Because the point is not generic DOM inspection. The point is to expose the
tugways style contract:

- Which `--tug-comp-*` token applied.
- Which `--tug-base-*` semantic is responsible.
- Which theme primitive supplied the value.
- For computed palette colors: which hue family and intensity produced the
  value.
- What multiplier effects `--tug-scale` and `--tug-timing` have on the
  element.

This makes the style system navigable instead of mystical.

---

## Migration Strategy

### Phase A: Inventory and Rename Spec

1. Freeze new additions under old prefixes.
2. Produce a definitive token mapping table.
3. Inventory all consumers in:
   - `tugdeck/styles/*.css`
   - `tugdeck/src/components/tugways/**/*.css`
   - `tugdeck/src/components/ui/**/*.tsx`
   - Runtime style token readers/writers in TS.

### Phase B: Introduce New Layers

1. Implement the palette engine (TypeScript utility + startup injection).
2. Add `--tug-palette-*` computed variables.
3. Add `--tug-scale`, `--tug-timing`, `--tug-motion` global multipliers.
4. Add `--tug-base-*` with scaled dimensions and timed durations.
5. Add `--tug-comp-*` where needed, including component-level scale overrides.
6. Keep temporary aliases from old tokens to new tokens.

### Phase C: Migrate Consumers

1. Move tugways component CSS first.
2. Move chrome CSS.
3. Move globals/Tailwind bridge.
4. Move shadcn wrapper assumptions.
5. Move chart/syntax consumers.

### Phase D: Remove Migration Debris

1. Remove `--td-*`.
2. Remove `--tways-*`.
3. Remove legacy aliases.
4. Add search-based enforcement checks.

### Phase E: Add Dev Inspector

1. Implement `Ctrl+Option + hover` live inspector.
2. Add gallery demo coverage.
3. Add dev-only documentation and verification checklist.

---

## Risks

### 1. Visual Drift During Rename

Mitigation: keep a temporary old-to-new mapping layer. Verify Brio/Bluenote/
Harmony parity after each migration slice.

### 2. Hidden Dependence on Legacy Aliases

Mitigation: static search in CSS and TS, explicit audit of `components/ui/*`,
targeted runtime checks where `getComputedStyle` is involved.

### 3. Token Explosion

Mitigation: use the grammar above, prefer shared pattern domains (`control`,
`field`, `menu`, `table`) before inventing one-off component tokens, require
that every new `--tug-comp-*` resolves from existing `--tug-base-*`.

### 4. Computed Palette Performance

Mitigation: pre-compute standard stops (264 variables for 24 hues x 11 stops)
at startup. This is a one-time cost of < 1ms. Arbitrary intensities are
computed on demand via the TypeScript utility, which is pure math with no DOM
access.

### 5. OKLCH Gamut Clipping

Mitigation: the palette engine includes per-hue chroma capping. Before
implementation closes, run a gamut check across all 24 hues at all standard
stops for sRGB and P3 displays. Adjust chroma caps where needed.

### 6. `calc()` with `var()` Browser Compatibility

Mitigation: `calc(14px * var(--tug-scale))` works in all modern browsers. For
older WebKit versions that don't support `calc()` in custom properties, the
palette engine can pre-compute scaled values — the same injection mechanism used
for computed colors. Since tugdeck targets a known WebView (WKWebView on macOS),
browser compatibility is controlled.

### 7. Inspector Performance Overhead

Mitigation: dev-mode only, throttle pointer processing, cache cascade-resolution
results per element while hovered.

---

## Definition of Done

1. No `--td-*` tokens remain in source.
2. No `--tways-*` tokens remain in source.
3. No legacy alias tokens remain in source.
4. All current accent use cases have explicit replacements.
5. Chart and syntax token families are preserved under the new contract.
6. Tugways component CSS consumes `--tug-base-*` and `--tug-comp-*` only.
7. Theme files own only `--tug-palette-*` primitives (plus engine parameters).
8. The Tailwind/shadcn bridge points at the new canonical layer.
9. The palette engine computes 264 standard-stop CSS variables at startup.
10. `--tug-scale` resizes the entire UI when changed. Verified at 0.85, 1.0,
    1.25, and 1.5.
11. `--tug-timing` scales all animation durations when changed. Verified at 0.5,
    1.0, and 5.0.
12. `--tug-motion: 0` disables all motion. Verified with `prefers-reduced-motion`
    and manual toggle.
13. Dev-mode `Ctrl+Option + hover` inspector can show full cascade resolution
    for hovered components, including palette hue/intensity provenance.

---

## Recommended Next Steps

If this proposal is approved, it should be implemented across five sub-phases:

1. **Phase 5d5a: Palette Engine** — TypeScript palette computation, 24 hue
   families with `hue-<angle>-<name>-tone-<intensity>` naming, transfer function
   with interactive gallery demo for curve tuning, runtime CSS injection.

2. **Phase 5d5b: Global Scale & Timing** — `--tug-scale`, `--tug-timing`,
   `--tug-motion`, per-component scale overrides, `calc()` wiring for all
   dimension and duration tokens, JS integration helpers.

3. **Phase 5d5c: Token Architecture** — Introduce `--tug-base-*` and
   `--tug-comp-*` layers, define the full semantic taxonomy, temporary aliases
   from old tokens to new tokens.

4. **Phase 5d5d: Consumer Migration** — Migrate all CSS and TS consumers from
   `--td-*`/`--tways-*` to new tokens, shadcn bridge cutover, remove legacy
   aliases, search-based enforcement.

5. **Phase 5d5e: Cascade Inspector** — Dev-mode `Ctrl+Option + hover` overlay,
   palette provenance display (hue/intensity), scale/timing readout.

Each sub-phase has its own tugplan. See `tugways-implementation-strategy.md` for
the full phase descriptions and dependency map.
