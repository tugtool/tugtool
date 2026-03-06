# Tugways Theme Token Overhaul Proposal

This proposal replaces the current theme/token naming with a researched,
code-grounded model that is large enough to support the actual scope of
`design-system-concepts.md` and `tugways-implementation-strategy.md`.

This revision corrects a flaw in the earlier draft: the semantic set was too
small, too generic, and did not account for the current code's heavy use of the
accent system, chart tokens, syntax tokens, shadcn bridge aliases, workspace
chrome, and the roadmap's much larger component inventory.

The intent here is not a cosmetic rename. The intent is to:

- replace `--tways-*` and `--td-*` with a clearer long-term structure
- remove all legacy aliases
- preserve and improve the accent concept instead of deleting it
- define a large, explicit `--tug-base-*` semantic contract
- make future component styling additive and controlled rather than ad hoc
- add a dev-mode `Ctrl+Option + hover` cascade inspector for direct style
  introspection

---

## Proposal Status

This is a research-backed proposal document, not yet an implementation plan.

If approved, the next document should be a concrete implementation tugplan with:

- file-by-file migration order
- temporary compatibility shims
- search-based enforcement checks
- theme parity verification across Brio, Bluenote, and Harmony

---

## Inputs Used

This proposal is based on four inputs:

1. Current code in `tugdeck/`
2. `roadmap/design-system-concepts.md`
3. `roadmap/tugways-implementation-strategy.md`
4. Public token-system references with permissive or compatible licensing

### Current Code Reviewed

The current token consumers and declarations were reviewed in:

- `tugdeck/styles/tokens.css`
- `tugdeck/styles/chrome.css`
- `tugdeck/src/globals.css`
- `tugdeck/src/components/tugways/*.css`
- `tugdeck/src/components/ui/*.tsx`

### Roadmap Scope Reviewed

The roadmap review included the current and planned styling needs for:

- canvas and chrome
- Tugcard, tab bar, dock, snapping, flashing, selection, shadows
- form controls
- overlays and feedback components
- data display and visualization
- inspector panels and mutation-preview tooling
- rebuilt cards including terminal, code/conversation, git, files, stats,
  settings, developer, about, and the gallery card

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

- Carbon is particularly strong on role + state naming:
  `background-hover`, `background-active`, `layer-01`, `field-01`,
  `border-subtle-01`, `layer-accent-01`, etc.
- Carbon shows that a serious semantic layer must model state transitions across
  multiple surfaces, not just define one neutral background and one border.
- Carbon's `background`, `layer`, `field`, `border`, `support`, `focus`, and
  `icon` domains map cleanly to tugways needs.

### 5. Chakra UI Semantic Tokens

References:

- [Semantic tokens](https://chakra-ui.com/docs/theming/semantic-tokens)

Relevant takeaways:

- Chakra's simple nested semantic groups are a good readability model:
  `bg`, `fg`, `border`, `focusRing`.
- Tugways should use a similarly readable domain hierarchy even though our
  implementation is plain CSS custom properties.

### 6. OKLCH Guidance And Modern CSS Palette Practice

References:

- [OKLCH FYI](https://www.oklch.fyi/)
- [Tailwind color customization](https://tailwindcss.com/docs/customizing-colors)

Relevant takeaways:

- OKLCH is perceptually uniform, which makes fixed lightness and chroma ramps
  behave more consistently across named hues.
- Equal lightness values across different hues are far more trustworthy in
  OKLCH than in HSL or ad hoc hex picking.
- Modern CSS token systems increasingly use `oklch()` directly for theme-token
  authoring, which fits tugways well.

### 7. Adobe Color Naming Guidance

References:

- [Naming colors in design systems](https://adobe.design/stories/design-for-scale/naming-colors-in-design-systems)

Relevant takeaways:

- Common-language hue names such as `red`, `blue`, and `purple` are clearer than
  poetic or highly branded color names.
- A stable `name + value` system scales better than one-off descriptive names.
- This strongly supports the `12` named hue families proposed for the tugways
  palette layer.

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

- `tug-button.css`
  - `--td-accent-2` for primary button fill
  - `--td-accent` for state dots
- `tug-tab-bar.css`
  - `--td-accent` for active tab underline
  - `--td-accent` for overflow badge background
  - `--td-accent` for insert indicator
  - `--td-accent` for drag-drop target highlights
- `chrome.css`
  - `--td-accent-cool` for snap guides
  - `--td-accent` for perimeter flash
- `tugcard.css`
  - `--td-selection-bg` and `--td-selection-text`
- `gallery-card.css`
  - `--td-accent` and `--td-accent-cool` in the mutation demo

Conclusion:

- the accent concept must be preserved
- the accent system needs to become clearer, not smaller
- the numbered accent scale must be replaced by descriptive names, not removed
  without replacement

### 2. The Code Already Implies More Domains Than the Old Draft Covered

Current declared or consumed domains include:

- surface and canvas
- text and inverse text
- accent and status
- chart
- syntax
- border and selection
- header and icon states
- active and inactive card shadow
- dim overlays
- spacing, radius, typography, line height
- motion tokens
- grid lines, drag/drop indicators, flash overlays

### 3. There Are Existing Gaps

The current system already has holes that a better semantic layer should fix:

- `hello-card.tsx` consumes `--td-text-muted`, but that token is not declared
- drag ghost, badge, banner, and flash semantics are partly ad hoc
- many component states still rely on local styling choices rather than named
  cross-component semantics
- the legacy alias layer obscures what is actually canonical

### 4. The Shadcn Bridge Is a Real Migration Problem

`globals.css` and `components/ui/*.tsx` still depend on variables such as:

- `--background`
- `--foreground`
- `--primary`
- `--accent`
- `--destructive`
- `--ring`

This means the proposal must include an explicit bridge strategy. We cannot just
declare legacy aliases dead without describing how the shadcn/Tailwind bridge is
replaced.

---

## What The Roadmap Requires

The roadmap requires a token system that can credibly support all of the
following, not just today's small CSS footprint.

### Workspace Chrome

- canvas grid
- Tugcard chrome
- title bar active/inactive states
- tabs and overflow tabs
- tab drag indicators
- dock rail and buttons
- resize handles
- snap guides
- set shadows
- perimeter flash
- selection containment visuals

### Controls And Inputs

- buttons
- input, textarea, select
- checkbox, radio, switch, slider
- label/helper/required states
- validation and error states
- grouped control seams
- loading and disabled states

### Overlay And Feedback Components

- alert, sheet, confirm popover, toast
- tooltip, dropdown menu, context menu, dialog
- badges, status indicators, progress, skeleton, spinner, separator, kbd, avatar
- disconnect and warning banners

### Data Display And Visualization

- tables
- stat cards
- sparklines
- linear gauges
- arc gauges
- chart series
- threshold and trend states

### Inspector / Dev Tools

- color picker
- font picker
- coordinate inspector
- inspector panel
- mutation preview vs commit vs cancel states
- cascade/source display
- hovered-target highlighting

### Card Domain Surfaces

- terminal
- code/conversation
- git/files
- stats
- settings/developer
- about
- gallery

Conclusion:

`--tug-base-*` must be large enough to cover workspace chrome, generic controls,
feedback, data display, visualization, inspector tooling, and domain-specific
surfaces such as syntax and terminal presentation.

---

## Core Decisions

### 1. `--tways-*` And `--td-*` Are Transitional, Not Permanent

Both current prefixes should become migration smells.

Long-term target:

- theme/palette primitives: `--tug-palette-*`
- canonical semantics: `--tug-base-*`
- component/pattern tokens: `--tug-comp-*`

This intentionally makes any future `--tways-*` or `--td-*` usage a sign that
old code or migration debris remains.

### 2. `--tug-base-*` Is The Public Contract

Everything components use should resolve directly or indirectly from
`--tug-base-*`.

That means:

- components consume `--tug-base-*` or `--tug-comp-*`
- `--tug-comp-*` must resolve from `--tug-base-*`
- palette/theme primitives never leak into component CSS

### 3. Accent Survives As A First-Class System

The current accent system is doing several jobs at once:

- primary action color
- cool/secondary interactive accent
- chart series colors
- syntax color sources
- status tone sources
- visual instrumentation color

These jobs should be separated, but the accent concept absolutely remains.

### 4. Numbered Accents Become Named Palette Hues

Current:

- `accent-1` through `accent-8`

Proposed foundation:

- a chromatic palette of `48` named colors
- `12` named hues
- `4` named tones per hue
- a separate neutral scale for surfaces, borders, and text

Recommended hue families:

- `red`
- `orange`
- `amber`
- `yellow`
- `lime`
- `green`
- `teal`
- `cyan`
- `blue`
- `indigo`
- `violet`
- `magenta`

Recommended tone names:

- `soft`
- `default`
- `strong`
- `intense`

Example palette tokens:

- `--tug-palette-red-soft`
- `--tug-palette-red-default`
- `--tug-palette-red-strong`
- `--tug-palette-red-intense`
- `--tug-palette-blue-soft`
- `--tug-palette-blue-default`
- `--tug-palette-violet-strong`
- `--tug-palette-green-intense`

Initial reference values should follow published guidance in three ways:

- use common-language hue family names rather than poetic names, following
  Spectrum's color-naming guidance
- use `oklch()` values so equal lightness and chroma steps feel more uniform
  across hues, following OKLCH guidance and modern palette practice
- use a stable name + tone pairing so the palette can expand later without
  renaming, following the same general logic used in systems like Spectrum and
  Tailwind

Initial reference 48-color palette (`12` hues x `4` tones), expressed as OKLCH
anchors:

```css
/* red */
--tug-palette-red-soft: oklch(0.92 0.04 25);
--tug-palette-red-default: oklch(0.80 0.09 25);
--tug-palette-red-strong: oklch(0.68 0.13 25);
--tug-palette-red-intense: oklch(0.56 0.17 25);

/* orange */
--tug-palette-orange-soft: oklch(0.92 0.04 50);
--tug-palette-orange-default: oklch(0.80 0.09 50);
--tug-palette-orange-strong: oklch(0.68 0.13 50);
--tug-palette-orange-intense: oklch(0.56 0.17 50);

/* amber */
--tug-palette-amber-soft: oklch(0.92 0.04 70);
--tug-palette-amber-default: oklch(0.80 0.09 70);
--tug-palette-amber-strong: oklch(0.68 0.13 70);
--tug-palette-amber-intense: oklch(0.56 0.17 70);

/* yellow */
--tug-palette-yellow-soft: oklch(0.92 0.04 95);
--tug-palette-yellow-default: oklch(0.80 0.09 95);
--tug-palette-yellow-strong: oklch(0.68 0.13 95);
--tug-palette-yellow-intense: oklch(0.56 0.17 95);

/* lime */
--tug-palette-lime-soft: oklch(0.92 0.04 125);
--tug-palette-lime-default: oklch(0.80 0.09 125);
--tug-palette-lime-strong: oklch(0.68 0.13 125);
--tug-palette-lime-intense: oklch(0.56 0.17 125);

/* green */
--tug-palette-green-soft: oklch(0.92 0.04 145);
--tug-palette-green-default: oklch(0.80 0.09 145);
--tug-palette-green-strong: oklch(0.68 0.13 145);
--tug-palette-green-intense: oklch(0.56 0.17 145);

/* teal */
--tug-palette-teal-soft: oklch(0.92 0.04 170);
--tug-palette-teal-default: oklch(0.80 0.09 170);
--tug-palette-teal-strong: oklch(0.68 0.13 170);
--tug-palette-teal-intense: oklch(0.56 0.17 170);

/* cyan */
--tug-palette-cyan-soft: oklch(0.92 0.04 200);
--tug-palette-cyan-default: oklch(0.80 0.09 200);
--tug-palette-cyan-strong: oklch(0.68 0.13 200);
--tug-palette-cyan-intense: oklch(0.56 0.17 200);

/* blue */
--tug-palette-blue-soft: oklch(0.92 0.04 240);
--tug-palette-blue-default: oklch(0.80 0.09 240);
--tug-palette-blue-strong: oklch(0.68 0.13 240);
--tug-palette-blue-intense: oklch(0.56 0.17 240);

/* indigo */
--tug-palette-indigo-soft: oklch(0.92 0.04 265);
--tug-palette-indigo-default: oklch(0.80 0.09 265);
--tug-palette-indigo-strong: oklch(0.68 0.13 265);
--tug-palette-indigo-intense: oklch(0.56 0.17 265);

/* violet */
--tug-palette-violet-soft: oklch(0.92 0.04 295);
--tug-palette-violet-default: oklch(0.80 0.09 295);
--tug-palette-violet-strong: oklch(0.68 0.13 295);
--tug-palette-violet-intense: oklch(0.56 0.17 295);

/* magenta */
--tug-palette-magenta-soft: oklch(0.92 0.04 330);
--tug-palette-magenta-default: oklch(0.80 0.09 330);
--tug-palette-magenta-strong: oklch(0.68 0.13 330);
--tug-palette-magenta-intense: oklch(0.56 0.17 330);
```

These should be treated as initial anchors, not untouchable production values.
Before implementation closes, each theme should gamut-check these values, verify
contrast in real UI usage, and make small hue-specific adjustments where needed.

And semantic aliases on top of that:

- `--tug-base-accent-default`
- `--tug-base-accent-strong`
- `--tug-base-accent-muted`
- `--tug-base-accent-emphasis`
- `--tug-base-accent-info`
- `--tug-base-accent-positive`
- `--tug-base-accent-warning`
- `--tug-base-accent-danger`

This preserves a rich color foundation while giving component code intentful
semantic names to consume.

### 5. Size Tokens Use A Uniform Adjectival Scale

Standard size ladder:

- `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`

This scale should be used consistently across:

- spacing
- radius
- typography
- icon size
- stroke width
- elevation tiers where appropriate

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

- `--tug-base-*` is the shared semantic language
- `--tug-comp-*` is where a component family binds itself to that shared language

---

## Proposed Token Architecture

### Layer 0: Theme / Palette Primitives (`--tug-palette-*`)

Purpose:

- raw values only
- theme files own this layer
- no component or app-role meaning

Examples:

- `--tug-palette-neutral-0` through `--tug-palette-neutral-9`
- `--tug-palette-red-soft`
- `--tug-palette-red-default`
- `--tug-palette-red-strong`
- `--tug-palette-red-intense`
- `--tug-palette-orange-soft`
- `--tug-palette-orange-default`
- `--tug-palette-amber-default`
- `--tug-palette-green-strong`
- `--tug-palette-cyan-default`
- `--tug-palette-blue-strong`
- `--tug-palette-violet-default`
- `--tug-palette-magenta-soft`
- `--tug-palette-shadow-soft`
- `--tug-palette-shadow-strong`
- `--tug-palette-grid-line`
- `--tug-palette-screen-bg`
- `--tug-palette-screen-fg`

Rules:

- themes only
- no direct component usage
- okay to be color-system-ish or raw
- the chromatic foundation should be `48` named hue tokens: `12` hue families x
  `4` tones (`soft`, `default`, `strong`, `intense`), plus a neutral scale
- themes may map those hue families to theme-appropriate values, but the hue
  family names remain stable across themes

### Layer 1: Canonical Semantics (`--tug-base-*`)

Purpose:

- the stable, readable contract for app and component styling
- all public semantics live here

Rules:

- all component styling eventually resolves from this layer
- no raw palette values in component CSS
- no `--td-*`, `--tways-*`, or legacy aliases after migration

### Layer 2: Component / Pattern Tokens (`--tug-comp-*`)

Purpose:

- bind a component or component family to shared semantics
- allow family-specific tuning without inventing new raw values

Examples:

- `--tug-comp-button-primary-bg-rest: var(--tug-base-action-primary-bg-rest);`
- `--tug-comp-tab-badge-bg: var(--tug-base-badge-accent-bg);`
- `--tug-comp-card-header-bg-active: var(--tug-base-card-header-bg-active);`

Rules:

- may exist only when base semantics are too generic
- must resolve entirely from `--tug-base-*`
- should prefer family names like `control`, `button`, `field`, `menu`, `tab`,
  `card`, `table`, `inspector` over one-off widget names whenever possible

---

## Revised `--tug-base-*` Semantic Taxonomy

This is the part the earlier draft undershot. The taxonomy below is intentionally
large because the roadmap is large.

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

#### Typography / Space / Radius / Stroke

- `--tug-base-font-family-sans`
- `--tug-base-font-family-mono`
- `--tug-base-font-size-2xs`
- `--tug-base-font-size-xs`
- `--tug-base-font-size-sm`
- `--tug-base-font-size-md`
- `--tug-base-font-size-lg`
- `--tug-base-font-size-xl`
- `--tug-base-font-size-2xl`
- `--tug-base-line-height-2xs`
- `--tug-base-line-height-xs`
- `--tug-base-line-height-sm`
- `--tug-base-line-height-md`
- `--tug-base-line-height-lg`
- `--tug-base-line-height-xl`
- `--tug-base-line-height-2xl`
- `--tug-base-space-2xs`
- `--tug-base-space-xs`
- `--tug-base-space-sm`
- `--tug-base-space-md`
- `--tug-base-space-lg`
- `--tug-base-space-xl`
- `--tug-base-space-2xl`
- `--tug-base-radius-2xs`
- `--tug-base-radius-xs`
- `--tug-base-radius-sm`
- `--tug-base-radius-md`
- `--tug-base-radius-lg`
- `--tug-base-radius-xl`
- `--tug-base-radius-2xl`
- `--tug-base-stroke-hairline`
- `--tug-base-stroke-thin`
- `--tug-base-stroke-medium`
- `--tug-base-stroke-thick`
- `--tug-base-icon-size-2xs`
- `--tug-base-icon-size-xs`
- `--tug-base-icon-size-sm`
- `--tug-base-icon-size-md`
- `--tug-base-icon-size-lg`
- `--tug-base-icon-size-xl`

#### Motion

- `--tug-base-motion-duration-fast`
- `--tug-base-motion-duration-moderate`
- `--tug-base-motion-duration-slow`
- `--tug-base-motion-duration-glacial`
- `--tug-base-motion-easing-standard`
- `--tug-base-motion-easing-enter`
- `--tug-base-motion-easing-exit`
- `--tug-base-motion-duration-scalar`

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

#### 48-Color Palette Foundation

The accent system should derive from a named hue foundation in the palette
layer, not from poetic or ordinal accent names in the semantic layer.

Foundation hue families:

- `red`
- `orange`
- `amber`
- `yellow`
- `lime`
- `green`
- `teal`
- `cyan`
- `blue`
- `indigo`
- `violet`
- `magenta`

Foundation tone names:

- `soft`
- `default`
- `strong`
- `intense`

Example palette tokens feeding accents:

- `--tug-palette-orange-default`
- `--tug-palette-cyan-default`
- `--tug-palette-violet-default`
- `--tug-palette-red-default`
- `--tug-palette-green-default`
- `--tug-palette-yellow-default`
- `--tug-palette-magenta-default`
- `--tug-palette-orange-soft`

#### Semantic Accent Aliases

- `--tug-base-accent-default`
- `--tug-base-accent-strong`
- `--tug-base-accent-muted`
- `--tug-base-accent-emphasis`
- `--tug-base-accent-info`
- `--tug-base-accent-positive`
- `--tug-base-accent-warning`
- `--tug-base-accent-danger`
- `--tug-base-accent-cool-default`

Semantic accents should resolve from the named hue palette, for example:

- `--tug-base-accent-default -> var(--tug-palette-orange-default)`
- `--tug-base-accent-strong -> var(--tug-palette-orange-strong)`
- `--tug-base-accent-cool-default -> var(--tug-palette-cyan-default)`
- `--tug-base-accent-info -> var(--tug-palette-cyan-strong)`
- `--tug-base-accent-positive -> var(--tug-palette-green-strong)`
- `--tug-base-accent-warning -> var(--tug-palette-yellow-strong)`
- `--tug-base-accent-danger -> var(--tug-palette-red-strong)`

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

### E. Actions And Generic Controls

This follows Primer's useful idea of generic `control` patterns, not just
component-by-component naming.

#### Cross-Control Disabled Contract

Disabled controls should be treated as a first-class system state, not as an
afterthought handled ad hoc by opacity alone.

Every interactive control family should be able to derive its disabled
presentation from a shared base contract, with component-specific overrides only
when necessary.

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

- `--tug-base-chart-series-warm`
- `--tug-base-chart-series-cool`
- `--tug-base-chart-series-violet`
- `--tug-base-chart-series-rose`
- `--tug-base-chart-series-verdant`
- `--tug-base-chart-series-golden`
- `--tug-base-chart-series-orchid`
- `--tug-base-chart-series-coral`
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

---

## Accent Migration Map

The current accent contract needs a direct mapping so the migration is explicit.

### Current -> Proposed

- `--td-accent` -> `--tug-base-accent-default`
- `--td-accent-strong` -> `--tug-base-accent-strong`
- `--td-accent-cool` -> `--tug-base-accent-cool-default`
- `--td-accent-1` -> `--tug-palette-orange-default`
- `--td-accent-2` -> `--tug-palette-cyan-default`
- `--td-accent-3` -> `--tug-palette-violet-default`
- `--td-accent-4` -> `--tug-palette-red-default`
- `--td-accent-5` -> `--tug-palette-green-default`
- `--td-accent-6` -> `--tug-palette-yellow-default`
- `--td-accent-7` -> `--tug-palette-magenta-default`
- `--td-accent-8` -> `--tug-palette-orange-soft`

### Derived Semantic Roles

- `--td-success` currently derives from accent 5
  - proposed: `--tug-base-accent-positive -> var(--tug-palette-green-strong)`
- `--td-warning` currently derives from accent 6
  - proposed: `--tug-base-accent-warning -> var(--tug-palette-yellow-strong)`
- `--td-danger` currently derives from accent 4
  - proposed: `--tug-base-accent-danger -> var(--tug-palette-red-strong)`
- `--td-info` currently derives from accent 2
  - proposed: `--tug-base-accent-info -> var(--tug-palette-cyan-strong)`

### Why This Is Better

- chart, syntax, and multi-series visualization still get a stable expressive
  palette
- component authors no longer consume meaningless ordinals
- semantic roles such as info/warning/danger stop depending on "knowing" what
  accent number means what

---

## Legacy Removal Policy

The following are scheduled for full removal:

- `--td-*`
- `--tways-*`
- all legacy alias variables such as:
  - `--background`
  - `--foreground`
  - `--card`
  - `--primary`
  - `--accent`
  - `--destructive`
  - `--chart-*`
  - `--syntax-*`

### But The Bridge Must Be Deliberate

Because shadcn/Tailwind still relies on those names, migration must happen in
three passes:

1. Introduce `--tug-base-*` and `--tug-comp-*`
2. Repoint the Tailwind/shadcn bridge from legacy aliases to new tokens
3. Remove legacy alias declarations after all consumers are migrated

This proposal rejects permanent legacy aliases. It does not reject temporary
migration shims.

---

## Dev-Mode `Ctrl+Option + Hover` Cascade Inspector

### Interaction Model

- Only available in dev mode
- Hold `Ctrl+Option`
- Hover any inspectable component or widget
- A floating overlay appears near the cursor or pinned panel edge

The overlay should show:

- component or pattern identity
- DOM path and class list
- selected computed properties
  - background
  - foreground
  - border
  - shadow
  - radius
  - typography
- full resolution chain for each inspected property:
  - computed value
  - source CSS rule
  - `--tug-comp-*` token if present
  - `--tug-base-*` token it resolves from
  - `--tug-palette-*` value beneath that

### Technical Direction

This should build on the roadmap's existing inspector architecture:

- `StyleCascadeReader`
- mutation transactions
- property store
- responder-chain-aware inspector panels

Recommended implementation:

1. Add a dev-only `StyleInspectorOverlay` singleton
2. Track global modifier state for `Ctrl+Option`
3. On pointer move with modifiers active:
   - locate target with `elementFromPoint`
   - walk up to the nearest inspect root
   - read computed style
   - resolve token chain using a cascade reader utility
4. Highlight the target element with a dev-only overlay token
5. Allow pin/unpin so the user can stop live-hover and inspect in place
6. `Escape` closes the overlay

### Why This Belongs In The Theme Machinery

Because the point is not generic DOM inspection. The point is to expose the
tugways style contract:

- which `--tug-comp-*` token applied
- which `--tug-base-*` semantic is responsible
- which theme primitive supplied the value

This makes the style system navigable instead of mystical.

---

## Migration Strategy

### Phase A: Inventory And Rename Spec

1. Freeze new additions under old prefixes
2. Produce a definitive token mapping table
3. Inventory all consumers in:
   - `tugdeck/styles/*.css`
   - `tugdeck/src/components/tugways/**/*.css`
   - `tugdeck/src/components/ui/**/*.tsx`
   - runtime style token readers/writers in TS

### Phase B: Introduce New Layers

1. Add `--tug-palette-*`
2. Add `--tug-base-*`
3. Add `--tug-comp-*` where needed
4. Keep temporary aliases from old tokens to new tokens

### Phase C: Migrate Consumers

1. Move tugways component CSS first
2. Move chrome CSS
3. Move globals/Tailwind bridge
4. Move shadcn wrapper assumptions
5. Move chart/syntax consumers

### Phase D: Remove Migration Debris

1. Remove `--td-*`
2. Remove `--tways-*`
3. Remove legacy aliases
4. Add search-based enforcement checks

### Phase E: Add Dev Inspector

1. Implement `Ctrl+Option + hover` live inspector
2. Add gallery demo coverage
3. Add dev-only documentation and verification checklist

---

## Risks

### 1. Visual Drift During Rename

Mitigation:

- keep a temporary old-to-new mapping layer
- verify Brio/Bluenote/Harmony parity after each migration slice

### 2. Hidden Dependence On Legacy Aliases

Mitigation:

- static search in CSS and TS
- explicit audit of `components/ui/*`
- targeted runtime checks where `getComputedStyle` is involved

### 3. Token Explosion

Mitigation:

- use the grammar above
- prefer shared pattern domains (`control`, `field`, `menu`, `table`) before
  inventing one-off component tokens
- require that every new `--tug-comp-*` resolves from existing `--tug-base-*`

### 4. Inspector Performance Overhead

Mitigation:

- dev-mode only
- throttle pointer processing
- cache cascade-resolution results per element while hovered

---

## Definition Of Done

1. No `--td-*` tokens remain in source
2. No `--tways-*` tokens remain in source
3. No legacy alias tokens remain in source
4. All current accent use cases have explicit replacements
5. Chart and syntax token families are preserved under the new contract
6. Tugways component CSS consumes `--tug-base-*` and `--tug-comp-*` only
7. Theme files own only `--tug-palette-*` primitives
8. The Tailwind/shadcn bridge points at the new canonical layer
9. Dev-mode `Ctrl+Option + hover` inspector can show full cascade resolution for
   hovered components

---

## Recommended Next Document

If this proposal is approved, the next step should be a concrete execution plan:

- `tugways-phase-theme-token-overhaul`

That plan should include:

- exact token mapping tables
- explicit bridge cutover for `globals.css` and `components/ui/*`
- implementation slices by file group
- verification commands and parity checks
- follow-on cleanup for old roadmap language that still assumes `--td-*`
