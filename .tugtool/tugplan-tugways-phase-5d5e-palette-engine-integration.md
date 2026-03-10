## Palette Engine Integration — Pure CSS, Neutrals, Phase 5d5e {#phase-5d5e}

**Purpose:** Wire the CITA palette engine to the semantic token layer by replacing JS-injected oklch() strings with pure CSS formulas in a static `tug-palette.css`, adding the neutral ramp, and rewiring all chromatic `--tug-base-*` tokens to resolve from `var(--tug-{hue}[-preset])` palette references.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-07 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 5d5a through 5d5d established the CITA palette engine (24 hues, 7 presets, P3 support), the semantic token architecture (`--tug-base-*`, `--tug-comp-*`), and migrated all CSS consumers to the new token names. However, a critical gap remains: the `--tug-base-*` chromatic tokens in `tug-tokens.css` contain ~120 hardcoded hex color values instead of resolving from the palette engine's `--tug-{hue}[-preset]` variables. The palette engine currently injects its 242 CSS variables at runtime via `injectCITACSS()` in JavaScript -- but nothing in the semantic layer consumes them.

Phase 5d5e closes this gap. It converts the palette from JS-injected oklch() strings to pure CSS `calc()` + `oklch()` formulas in a static stylesheet, adds the `--tug-neutral-*` achromatic ramp per [D75], and rewires every chromatic `--tug-base-*` token to a `var(--tug-{hue}[-preset])` reference. After this phase, the entire color system is inspectable, debuggable, and composable in standard CSS with no JavaScript injection.

#### Strategy {#strategy}

- Create `tug-palette.css` with per-hue constants and preset formulas as pure CSS, eliminating runtime JS injection
- Use the `body` selector (matching `tug-tokens.css` scope) so theme files can override per-hue constants
- Add the neutral ramp and black/white anchors as static oklch() literals (C=0, no calc needed)
- Override only `--tug-{hue}-peak-c` in the P3 media query block; preset formulas auto-produce richer colors
- Rewire all chromatic `--tug-base-*` tokens to palette `var()` references in a single pass
- Replace `rgba()` accent-derived tokens with `color-mix()` per [D75]
- Remove `injectCITACSS()` and its call sites; retain `citaColor()` for programmatic JS use

#### Success Criteria (Measurable) {#success-criteria}

- All chromatic `--tug-base-*` tokens in `tug-tokens.css` resolve through `var(--tug-{hue}[-preset])` palette references -- zero hardcoded hex values for chromatic tokens (grep verification)
- `tug-palette.css` contains exactly 72 per-hue constants (24 hues x 3), 2 global constants, 168 chromatic preset variables, 9 neutral variables (7 presets + black + white), and 24 P3 `--tug-{hue}-peak-c` overrides -- 275 total variable declarations
- No `injectCITACSS` import or call exists anywhere in the codebase (grep verification)
- All three themes (Brio, Bluenote, Harmony) render correctly with palette-derived colors (`bun test` passes)
- Theme override files contain no hardcoded hex values for chromatic tokens that have palette equivalents

#### Scope {#scope}

1. Static `tug-palette.css` with per-hue constants, preset formulas (pure CSS calc/oklch), neutral ramp, P3 overrides
2. Rewire all chromatic `--tug-base-*` tokens in `tug-tokens.css` to `var(--tug-{hue}[-preset])` references
3. Update theme override files (`bluenote.css`, `harmony.css`) -- remove hex overrides for chromatic tokens, let palette resolve
4. Remove `injectCITACSS()` from `palette-engine.ts`, `main.tsx`, and `theme-provider.tsx`
5. Update `globals.css` import order to include `tug-palette.css` before `tug-tokens.css`
6. Update tests: delete `injectCITACSS()` tests, add `tug-palette.css` correctness tests

#### Non-goals (Explicitly out of scope) {#non-goals}

- Cross-hue reassignment in theme files (e.g., Bluenote accent = blue instead of orange) -- future phase
- Per-theme canonical L tuning -- all themes share the same palette constants in 5d5e
- Cascade inspector (Phase 5d5f)
- Removing `citaColor()` or other palette-engine.ts exports -- they are retained for programmatic use

#### Dependencies / Prerequisites {#dependencies}

- Phase 5d5d (Consumer Migration) must be complete -- all consumers reference `--tug-base-*` tokens
- Phase 5d5a (Palette Engine) must be complete -- `palette-engine.ts` exports HUE_FAMILIES, DEFAULT_CANONICAL_L, MAX_CHROMA_FOR_HUE, MAX_P3_CHROMA_FOR_HUE, PEAK_C_SCALE (the authoritative source for all per-hue constants; `tug-cita-canonical.json` is a reference artifact but not directly consumed)

#### Constraints {#constraints}

- Pure CSS formulas only -- no JavaScript injection for palette variables
- Must use `body` selector to match `tug-tokens.css` scope
- Rules of Tugways: no React state for appearance changes [D08, D09, D40, D42]
- CSS `oklch()` natively accepts `calc()` expressions
- Semi-transparent variants use `color-mix()` at the point of use per [D75], not precomputed alpha

#### Assumptions {#assumptions}

- The 72 per-hue constants (plus 2 globals) are derived directly from existing values in `palette-engine.ts` (HUE_FAMILIES, DEFAULT_CANONICAL_L, MAX_CHROMA_FOR_HUE, PEAK_C_SCALE) -- no new computation
- Neutral ramp uses static oklch() literals with C=0 as specified in [D75]
- `citaColor()` and all other palette-engine.ts exports are retained unchanged
- P3 block overrides only `--tug-{hue}-peak-c` (24 overrides); preset formulas auto-produce richer colors
- Accent tokens currently using `rgba()` will use `color-mix()` once rewired to palette references per [D75]
- Theme files keep non-chromatic overrides (surfaces, grays, borders, shadows, etc.) unchanged
- Harmony (light theme) preserves contrast-critical chromatic fg overrides where palette presets would produce insufficient contrast on light backgrounds per [D06]

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Neutral canonical L value for t=50 (DECIDED) {#q01-neutral-canonical-l}

**Question:** What lightness value should `--tug-neutral` (t=50) use?

**Why it matters:** The neutral ramp needs a canonical L that feels visually balanced as a mid-gray.

**Resolution:** DECIDED -- Use 0.555 as specified in the [D75] example in design-system-concepts.md. The neutral ramp uses static oklch() literals, so no per-hue constant is needed.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Visual regression from hex-to-oklch conversion | med | med | Compare screenshots before/after; oklch values were computed from same CITA parameters | Colors look noticeably different in any theme |
| CSS calc() precision differences across browsers | low | low | Use sufficient decimal precision (4 digits); oklch is well-supported in modern browsers | Visible banding or color shifts in specific browsers |
| Theme override cascade issues with new import order | med | low | Verify theme injection appends after tug-palette.css + tug-tokens.css in cascade | Theme colors don't override palette defaults |

**Risk R01: Visual regression from color space conversion** {#r01-visual-regression}

- **Risk:** Converting from hardcoded hex (sRGB) to oklch() formulas may produce slightly different rendered colors
- **Mitigation:**
  - The hex values in tug-tokens.css were originally hand-picked, not derived from the CITA engine, so some visual shift is expected and intentional
  - The CITA palette produces perceptually uniform colors by design
  - Visual verification across all three themes in the checkpoint steps
- **Residual risk:** Some tokens may need manual tuning if the CITA-derived color is noticeably different from the hand-picked hex

---

### Design Decisions {#design-decisions}

#### [D01] Pure CSS formulas replace JS injection (DECIDED) {#d01-pure-css}

**Decision:** The CITA palette is expressed entirely in CSS `calc()` + `oklch()` formulas in a static stylesheet, replacing the runtime `injectCITACSS()` JavaScript injection.

**Rationale:**
- CSS `oklch()` natively accepts `calc()` expressions, making the entire CITA transfer function expressible in CSS
- Static CSS is inspectable, debuggable, and composable without JavaScript
- Eliminates a runtime dependency and potential flash-of-unstyled-content from late injection

**Implications:**
- `injectCITACSS()` is removed from exports and all call sites
- `tug-palette.css` must be imported before `tug-tokens.css` in `globals.css`
- Theme files can override per-hue constants to tune colors

#### [D02] Body selector scope (DECIDED) {#d02-body-selector}

**Decision:** `tug-palette.css` uses the `body` selector, matching `tug-tokens.css` scope.

**Rationale:**
- Consistency with the existing token architecture
- Theme override files already use `body` and can override per-hue constants

**Implications:**
- All palette variables are scoped to body, not `:root`
- Theme injection must cascade after `tug-palette.css`

#### [D03] Color-mix for semi-transparent variants (DECIDED) {#d03-color-mix}

**Decision:** Accent-derived tokens that currently use `rgba()` (e.g., `--tug-base-accent-bg-subtle`) are rewired to use `color-mix(in oklch, var(--tug-orange) <percentage>, transparent)` per [D75]. Existing `color-mix(in srgb, ...)` tokens (e.g., `--tug-base-selection-bg`) are intentionally changed to `color-mix(in oklch, ...)` for consistency with the oklch palette.

**Rationale:**
- `color-mix()` works with any color value including `var()` references to oklch colors
- Using `oklch` as the blending space is intentional: it produces perceptually uniform blending consistent with the palette's oklch color model. The switch from `srgb` to `oklch` blending may produce slightly different intermediate tones, but this is the desired behavior for a perceptually uniform system
- Keeps the palette layer clean -- transparency is applied at the point of use
- Follows the [D75] specification for opacity handling

**Implications:**
- No precomputed alpha variants in `tug-palette.css`
- Semi-transparent tokens in `tug-tokens.css` use `color-mix(in oklch, ...)` referencing palette presets
- Any existing `color-mix(in srgb, ...)` tokens are migrated to `color-mix(in oklch, ...)` as part of this phase

#### [D04] Piecewise L formula as CSS min() (DECIDED) {#d04-piecewise-l}

**Decision:** The CITA tone-to-L piecewise linear mapping is expressed in CSS using `calc()` with the two linear segments. For t=50 presets, L equals the per-hue canonical L directly. For t!=50 presets, L is computed from the appropriate segment of the piecewise function.

**Rationale:**
- The 7 presets have fixed tone values, so each preset's L can be a single `calc()` expression using the appropriate segment (t<=50 or t>50)
- No need for CSS `min()` since each preset knows which segment applies at authoring time
- Keeps formulas simple and readable

**Implications:**
- Each preset formula is a straightforward `oklch(calc(...) calc(...) var(--tug-{hue}-h))` expression
- The per-hue constants (`--tug-{hue}-canonical-l`, `--tug-{hue}-peak-c`, `--tug-{hue}-h`) plus globals (`--tug-l-dark`, `--tug-l-light`) are sufficient

#### [D05] No cross-hue reassignment in 5d5e (DECIDED) {#d05-no-cross-hue}

**Decision:** Theme files do not reassign hues in this phase. All three themes share the same palette constants. Brio and Bluenote (both dark themes) remove chromatic hex overrides and let the palette resolve. Harmony (light theme) requires special handling per [D06].

**Rationale:**
- Keeps the scope of 5d5e focused on the palette integration mechanics
- Cross-hue reassignment (e.g., Bluenote accent = blue) is a distinct design decision for a future phase

**Implications:**
- Theme files retain non-chromatic overrides (surfaces, grays, borders, shadows)
- Brio and Bluenote chromatic hex overrides are removed -- palette provides the colors
- Harmony retains contrast-critical fg overrides per [D06]

#### [D06] Harmony preserves contrast-critical chromatic fg overrides (DECIDED) {#d06-harmony-contrast}

**Decision:** Harmony (light theme) keeps chromatic foreground hex overrides where the Brio palette preset would have insufficient contrast on light backgrounds. Decorative and background chromatic tokens (bg-subtle, bg-emphasis, series colors used as fills) are removed and resolve from palette. Foreground-role tokens that need darker/more saturated variants for readability on light surfaces are preserved as hex overrides until per-theme canonical L tuning is implemented.

**Rationale:**
- The CITA palette presets (canonical, accent, muted, etc.) are tuned for dark backgrounds (Brio). On Harmony's light surfaces (e.g., surface-default #f4f1ea), high-L palette presets like `--tug-yellow` (L=0.901) produce text that is nearly invisible
- Harmony uses intentionally darker variants: e.g., `--tug-base-toast-warning-fg: #b89000` (dark gold), `--tug-base-banner-warning-fg: #8a7200`, `--tug-base-syntax-function: #8a7200`, `--tug-base-badge-warning-fg: #8a7200`
- Removing these overrides would cause contrast/accessibility failures, not merely a visual preference change
- Per-theme canonical L tuning (listed in Non-goals) will eventually allow Harmony to resolve all chromatic tokens from palette with appropriate lightness

**Implications:**
- Harmony retains hex overrides for: syntax-function, badge-warning-fg, toast-warning-fg, banner-info-fg, banner-warning-fg, terminal-ansi-yellow, file-status-modified, inspector-source-inline, and any other fg token where the palette preset L is too high for Harmony's light backgrounds
- Harmony removes hex overrides for: decorative/bg tokens (chart-series, accent-bg-subtle, badge-*-bg, toast-*-bg, banner-*-bg, highlight-*, set-*, diff-*-bg) and opaque chromatic tokens that remain readable on light backgrounds (accent-default, accent-strong, status-danger, status-success, etc.)
- The implementer must verify each Harmony chromatic override against its background: if the palette-derived color has a WCAG contrast ratio below 3:1 against the typical Harmony background, the override is preserved

---

### Specification {#specification}

#### Per-Hue Constants {#per-hue-constants}

**Table T01: Per-hue constant variables (72 per-hue + 2 globals = 74 total)** {#t01-per-hue-constants}

Each hue gets three constants derived from `palette-engine.ts` (72 = 24 hues x 3):

| Variable | Source | Example (orange) |
|----------|--------|-----------------|
| `--tug-{hue}-h` | `HUE_FAMILIES[hue]` | `--tug-orange-h: 55` |
| `--tug-{hue}-canonical-l` | `DEFAULT_CANONICAL_L[hue]` | `--tug-orange-canonical-l: 0.780` |
| `--tug-{hue}-peak-c` | `MAX_CHROMA_FOR_HUE[hue] * PEAK_C_SCALE` | `--tug-orange-peak-c: 0.292` |

Global constants (2):

| Variable | Source | Value |
|----------|--------|-------|
| `--tug-l-dark` | `L_DARK` | `0.15` |
| `--tug-l-light` | `L_LIGHT` | `0.96` |

#### Preset Formulas {#preset-formulas}

**Table T02: Chromatic preset formulas (168 = 24 hues x 7 presets)** {#t02-preset-formulas}

Each preset has fixed `i` and `t` values from `CITA_PRESETS`. The CSS formula computes L and C:

| Preset | i | t | L formula | C formula |
|--------|-----|-----|-----------|-----------|
| canonical | 50 | 50 | `var(--tug-{hue}-canonical-l)` | `calc(0.5 * var(--tug-{hue}-peak-c))` |
| accent | 80 | 50 | `var(--tug-{hue}-canonical-l)` | `calc(0.8 * var(--tug-{hue}-peak-c))` |
| muted | 25 | 55 | `calc(var(--tug-{hue}-canonical-l) + (55 - 50) / 50 * (var(--tug-l-light) - var(--tug-{hue}-canonical-l)))` | `calc(0.25 * var(--tug-{hue}-peak-c))` |
| light | 30 | 82 | `calc(var(--tug-{hue}-canonical-l) + (82 - 50) / 50 * (var(--tug-l-light) - var(--tug-{hue}-canonical-l)))` | `calc(0.3 * var(--tug-{hue}-peak-c))` |
| subtle | 15 | 92 | `calc(var(--tug-{hue}-canonical-l) + (92 - 50) / 50 * (var(--tug-l-light) - var(--tug-{hue}-canonical-l)))` | `calc(0.15 * var(--tug-{hue}-peak-c))` |
| dark | 50 | 25 | `calc(var(--tug-l-dark) + 25 / 50 * (var(--tug-{hue}-canonical-l) - var(--tug-l-dark)))` | `calc(0.5 * var(--tug-{hue}-peak-c))` |
| deep | 70 | 15 | `calc(var(--tug-l-dark) + 15 / 50 * (var(--tug-{hue}-canonical-l) - var(--tug-l-dark)))` | `calc(0.7 * var(--tug-{hue}-peak-c))` |

CSS output pattern:
```css
--tug-orange: oklch(var(--tug-orange-canonical-l) calc(0.5 * var(--tug-orange-peak-c)) var(--tug-orange-h));
--tug-orange-accent: oklch(var(--tug-orange-canonical-l) calc(0.8 * var(--tug-orange-peak-c)) var(--tug-orange-h));
```

#### Neutral Ramp {#neutral-ramp}

**Table T03: Neutral ramp variables (9 total)** {#t03-neutral-ramp}

Static oklch() literals with C=0, using the same tone-to-L mapping as chromatic presets but with a fixed canonical L of 0.555 per [D75]:

| Variable | t | L | CSS |
|----------|-----|---|-----|
| `--tug-neutral` | 50 | 0.555 | `oklch(0.555 0 0)` |
| `--tug-neutral-accent` | 50 | 0.555 | `oklch(0.555 0 0)` |
| `--tug-neutral-muted` | 55 | 0.595 | `oklch(0.595 0 0)` |
| `--tug-neutral-light` | 82 | 0.812 | `oklch(0.812 0 0)` |
| `--tug-neutral-subtle` | 92 | 0.907 | `oklch(0.907 0 0)` |
| `--tug-neutral-dark` | 25 | 0.352 | `oklch(0.352 0 0)` |
| `--tug-neutral-deep` | 15 | 0.211 | `oklch(0.211 0 0)` |
| `--tug-black` | -- | 0 | `oklch(0 0 0)` |
| `--tug-white` | -- | 1 | `oklch(1 0 0)` |

Neutral ramp L values match the [D75] specification examples exactly. `--tug-black` and `--tug-white` are true black/white per [D75] (not CITA endpoints), serving as absolute anchors independent of the tone-to-L mapping.

#### P3 Overrides {#p3-overrides}

**Table T04: P3 peak-c overrides (24 total)** {#t04-p3-overrides}

The `@media (color-gamut: p3)` block overrides only `--tug-{hue}-peak-c` with P3-derived values:

| Variable | Source | Example |
|----------|--------|---------|
| `--tug-{hue}-peak-c` | `MAX_P3_CHROMA_FOR_HUE[hue] * PEAK_C_SCALE` | `--tug-orange-peak-c: 0.37` |

Preset formulas reference `peak-c` and automatically produce richer colors on P3 displays.

#### Accent Migration Map {#accent-migration-map}

**Table T05: Chromatic token rewiring map** {#t05-token-rewiring}

Key `--tug-base-*` chromatic tokens and their palette references (from `theme-overhaul-proposal.md`):

| Token | Palette Reference |
|-------|------------------|
| `--tug-base-accent-default` | `var(--tug-orange)` |
| `--tug-base-accent-strong` | `var(--tug-orange-accent)` |
| `--tug-base-accent-muted` | `var(--tug-orange-muted)` |
| `--tug-base-accent-subtle` | `color-mix(in oklch, var(--tug-orange) 15%, transparent)` |
| `--tug-base-accent-cool-default` | `var(--tug-cyan)` |
| `--tug-base-accent-positive` | `var(--tug-green-accent)` |
| `--tug-base-accent-warning` | `var(--tug-yellow-accent)` |
| `--tug-base-accent-danger` | `var(--tug-red-accent)` |
| `--tug-base-accent-info` | `var(--tug-cyan-accent)` |
| `--tug-base-accent-bg-subtle` | `color-mix(in oklch, var(--tug-orange) 12%, transparent)` |
| `--tug-base-accent-bg-emphasis` | `color-mix(in oklch, var(--tug-orange) 24%, transparent)` |
| `--tug-base-accent-border` | `var(--tug-orange)` |
| `--tug-base-accent-border-hover` | `var(--tug-orange-accent)` |
| `--tug-base-accent-underline-active` | `var(--tug-orange)` |
| `--tug-base-accent-guide` | `color-mix(in oklch, var(--tug-orange) 50%, transparent)` |
| `--tug-base-accent-flash` | `color-mix(in oklch, var(--tug-orange) 40%, transparent)` |
| `--tug-base-chart-series-warm` | `var(--tug-orange)` |
| `--tug-base-chart-series-cool` | `var(--tug-cyan)` |
| `--tug-base-chart-series-violet` | `var(--tug-violet)` |
| `--tug-base-chart-series-rose` | `var(--tug-red)` |
| `--tug-base-chart-series-verdant` | `var(--tug-green)` |
| `--tug-base-chart-series-golden` | `var(--tug-yellow)` |
| `--tug-base-chart-series-orchid` | `var(--tug-pink)` |
| `--tug-base-chart-series-coral` | `var(--tug-coral-muted)` |
| `--tug-base-syntax-keyword` | `var(--tug-cyan)` |
| `--tug-base-syntax-string` | `var(--tug-coral-muted)` |
| `--tug-base-syntax-number` | `var(--tug-green)` |
| `--tug-base-syntax-function` | `var(--tug-yellow)` |
| `--tug-base-syntax-type` | `var(--tug-green)` |
| `--tug-base-syntax-variable` | `var(--tug-cyan)` |
| `--tug-base-syntax-constant` | `var(--tug-cyan)` |
| `--tug-base-syntax-decorator` | `var(--tug-violet)` |
| `--tug-base-syntax-tag` | `var(--tug-cyan)` |
| `--tug-base-syntax-attribute` | `var(--tug-cyan)` |
| `--tug-base-status-success` | `var(--tug-green)` |
| `--tug-base-status-warning` | `var(--tug-yellow)` |
| `--tug-base-status-danger` | `var(--tug-red)` |
| `--tug-base-status-info` | `var(--tug-cyan)` |
| `--tug-base-badge-accent-bg` | `color-mix(in oklch, var(--tug-orange) 20%, transparent)` |
| `--tug-base-badge-accent-fg` | `var(--tug-orange)` |
| `--tug-base-badge-success-bg` | `color-mix(in oklch, var(--tug-green) 20%, transparent)` |
| `--tug-base-badge-success-fg` | `var(--tug-green)` |
| `--tug-base-badge-warning-bg` | `color-mix(in oklch, var(--tug-yellow) 15%, transparent)` |
| `--tug-base-badge-warning-fg` | `var(--tug-yellow)` |
| `--tug-base-badge-danger-bg` | `color-mix(in oklch, var(--tug-red) 20%, transparent)` |
| `--tug-base-badge-danger-fg` | `var(--tug-red)` |
| `--tug-base-terminal-cursor` | `var(--tug-orange)` |
| `--tug-base-terminal-selection-bg` | `color-mix(in oklch, var(--tug-cyan) 30%, transparent)` |
| `--tug-base-terminal-ansi-red` | `var(--tug-red)` |
| `--tug-base-terminal-ansi-green` | `var(--tug-green)` |
| `--tug-base-terminal-ansi-yellow` | `var(--tug-yellow)` |
| `--tug-base-terminal-ansi-blue` | `var(--tug-cyan)` |
| `--tug-base-terminal-ansi-magenta` | `var(--tug-violet)` |
| `--tug-base-terminal-ansi-cyan` | `var(--tug-cyan)` |
| `--tug-base-feed-step-active` | `var(--tug-orange)` |
| `--tug-base-feed-step-complete` | `var(--tug-green)` |
| `--tug-base-feed-step-error` | `var(--tug-red)` |
| `--tug-base-feed-stream-cursor` | `var(--tug-orange)` |
| `--tug-base-feed-handoff` | `var(--tug-cyan)` |
| `--tug-base-fg-link` | `var(--tug-cyan)` |
| `--tug-base-fg-link-hover` | `var(--tug-cyan-light)` |
| `--tug-base-icon-active` | `var(--tug-cyan)` |
| `--tug-base-border-accent` | `var(--tug-orange)` |
| `--tug-base-border-danger` | `var(--tug-red)` |
| `--tug-base-focus-ring-default` | `var(--tug-cyan)` |
| `--tug-base-focus-ring-danger` | `var(--tug-red)` |
| `--tug-base-selection-bg` | `color-mix(in oklch, var(--tug-cyan) 40%, transparent)` |
| `--tug-base-card-header-icon-active` | `var(--tug-cyan)` |
| `--tug-base-card-header-button-fg-danger` | `var(--tug-red)` |
| `--tug-base-card-header-button-fg-danger-hover` | `var(--tug-red-light)` |
| `--tug-base-tab-underline-active` | `var(--tug-orange)` |
| `--tug-base-tab-dropTarget-border` | `var(--tug-cyan)` |
| `--tug-base-tab-badge-bg` | `var(--tug-orange)` |
| `--tug-base-tab-insertIndicator` | `var(--tug-orange)` |
| `--tug-base-dock-indicator` | `var(--tug-orange)` |
| `--tug-base-dock-button-fg-active` | `var(--tug-orange)` |
| `--tug-base-dock-button-fg-attention` | `var(--tug-yellow)` |
| `--tug-base-dock-button-badge-bg` | `var(--tug-red)` |
| `--tug-base-dock-button-insertIndicator` | `var(--tug-cyan)` |
| `--tug-base-set-member-corner-squared` | `var(--tug-cyan)` |
| `--tug-base-action-primary-bg-rest` | `var(--tug-orange)` |
| `--tug-base-action-primary-bg-hover` | `var(--tug-orange-accent)` |
| `--tug-base-action-primary-bg-active` | `var(--tug-orange-dark)` |
| `--tug-base-action-destructive-bg-rest` | `var(--tug-red)` |
| `--tug-base-action-destructive-bg-hover` | `var(--tug-red-accent)` |
| `--tug-base-action-destructive-bg-active` | `var(--tug-red-dark)` |
| `--tug-base-field-border-focus` | `var(--tug-cyan)` |
| `--tug-base-field-border-invalid` | `var(--tug-red)` |
| `--tug-base-field-border-valid` | `var(--tug-green)` |
| `--tug-base-field-required` | `var(--tug-red)` |
| `--tug-base-field-limit` | `var(--tug-red)` |
| `--tug-base-field-dirty` | `var(--tug-yellow)` |
| `--tug-base-field-error` | `var(--tug-red)` |
| `--tug-base-field-warning` | `var(--tug-yellow)` |
| `--tug-base-field-success` | `var(--tug-green)` |
| `--tug-base-toggle-track-on` | `var(--tug-orange)` |
| `--tug-base-range-fill` | `var(--tug-orange)` |
| `--tug-base-progress-fill` | `var(--tug-orange)` |
| `--tug-base-spinner` | `var(--tug-orange)` |
| `--tug-base-menu-item-fg-danger` | `var(--tug-red)` |
| `--tug-base-menu-item-icon-danger` | `var(--tug-red)` |
| `--tug-base-toast-success-fg` | `var(--tug-green)` |
| `--tug-base-toast-warning-fg` | `var(--tug-yellow)` |
| `--tug-base-toast-danger-fg` | `var(--tug-red)` |
| `--tug-base-banner-info-fg` | `var(--tug-cyan)` |
| `--tug-base-banner-warning-fg` | `var(--tug-yellow)` |
| `--tug-base-banner-danger-fg` | `var(--tug-red)` |
| `--tug-base-chart-threshold-warning` | `var(--tug-yellow)` |
| `--tug-base-chart-threshold-danger` | `var(--tug-red)` |
| `--tug-base-gauge-fill` | `var(--tug-orange)` |
| `--tug-base-gauge-threshold-warning` | `var(--tug-yellow)` |
| `--tug-base-gauge-threshold-danger` | `var(--tug-red)` |
| `--tug-base-stat-trend-positive` | `var(--tug-green)` |
| `--tug-base-stat-trend-negative` | `var(--tug-red)` |
| `--tug-base-file-status-added` | `var(--tug-green)` |
| `--tug-base-file-status-modified` | `var(--tug-yellow)` |
| `--tug-base-file-status-deleted` | `var(--tug-red)` |
| `--tug-base-file-status-renamed` | `var(--tug-cyan)` |
| `--tug-base-diff-addition-fg` | `var(--tug-green)` |
| `--tug-base-diff-deletion-fg` | `var(--tug-red)` |
| `--tug-base-inspector-target-outline` | `var(--tug-cyan)` |
| `--tug-base-inspector-preview-outline` | `var(--tug-orange)` |
| `--tug-base-inspector-source-token` | `var(--tug-violet)` |
| `--tug-base-inspector-source-class` | `var(--tug-green)` |
| `--tug-base-inspector-source-inline` | `var(--tug-yellow)` |
| `--tug-base-inspector-source-preview` | `var(--tug-coral-muted)` |
| `--tug-base-inspector-scrub-active` | `var(--tug-orange)` |

**Table T06: Semi-transparent chromatic rgba() tokens to convert to color-mix()** {#t06-rgba-to-color-mix}

These tokens currently use inline `rgba(R, G, B, alpha)` with chromatic hex-equivalent RGB values. They are converted to `color-mix(in oklch, var(--tug-{hue}[-preset]) <percentage>, transparent)` so they resolve from the palette:

| Token | Current rgba() | Palette Reference |
|-------|---------------|------------------|
| `--tug-base-highlight-dropTarget` | `rgba(53, 188, 255, 0.18)` | `color-mix(in oklch, var(--tug-cyan) 18%, transparent)` |
| `--tug-base-highlight-preview` | `rgba(53, 188, 255, 0.12)` | `color-mix(in oklch, var(--tug-cyan) 12%, transparent)` |
| `--tug-base-highlight-inspectorTarget` | `rgba(53, 188, 255, 0.22)` | `color-mix(in oklch, var(--tug-cyan) 22%, transparent)` |
| `--tug-base-highlight-snapGuide` | `rgba(53, 188, 255, 0.5)` | `color-mix(in oklch, var(--tug-cyan) 50%, transparent)` |
| `--tug-base-highlight-flash` | `rgba(255, 138, 56, 0.35)` | `color-mix(in oklch, var(--tug-orange) 35%, transparent)` |
| `--tug-base-set-member-border-collapsed` | `rgba(53, 188, 255, 0.3)` | `color-mix(in oklch, var(--tug-cyan) 30%, transparent)` |
| `--tug-base-set-focused-outline` | `rgba(53, 188, 255, 0.5)` | `color-mix(in oklch, var(--tug-cyan) 50%, transparent)` |
| `--tug-base-set-hull-flash` | `rgba(53, 188, 255, 0.25)` | `color-mix(in oklch, var(--tug-cyan) 25%, transparent)` |
| `--tug-base-set-breakout-flash` | `rgba(255, 138, 56, 0.35)` | `color-mix(in oklch, var(--tug-orange) 35%, transparent)` |
| `--tug-base-set-dropTarget` | `rgba(53, 188, 255, 0.18)` | `color-mix(in oklch, var(--tug-cyan) 18%, transparent)` |
| `--tug-base-snap-guide` | `rgba(53, 188, 255, 0.6)` | `color-mix(in oklch, var(--tug-cyan) 60%, transparent)` |
| `--tug-base-sash-hover` | `rgba(255, 138, 56, 0.4)` | `color-mix(in oklch, var(--tug-orange) 40%, transparent)` |
| `--tug-base-flash-perimeter` | `rgba(53, 188, 255, 0.7)` | `color-mix(in oklch, var(--tug-cyan) 70%, transparent)` |
| `--tug-base-card-findbar-match` | `rgba(255, 232, 107, 0.3)` | `color-mix(in oklch, var(--tug-yellow) 30%, transparent)` |
| `--tug-base-card-findbar-match-active` | `rgba(255, 138, 56, 0.5)` | `color-mix(in oklch, var(--tug-orange) 50%, transparent)` |
| `--tug-base-tab-dropTarget-bg` | `rgba(53, 188, 255, 0.12)` | `color-mix(in oklch, var(--tug-cyan) 12%, transparent)` |
| `--tug-base-menu-item-bg-selected` | `rgba(255, 138, 56, 0.15)` | `color-mix(in oklch, var(--tug-orange) 15%, transparent)` |
| `--tug-base-range-scrub-active` | `rgba(255, 138, 56, 0.3)` | `color-mix(in oklch, var(--tug-orange) 30%, transparent)` |
| `--tug-base-toast-success-bg` | `rgba(114, 206, 143, 0.15)` | `color-mix(in oklch, var(--tug-green) 15%, transparent)` |
| `--tug-base-toast-warning-bg` | `rgba(255, 232, 107, 0.12)` | `color-mix(in oklch, var(--tug-yellow) 12%, transparent)` |
| `--tug-base-toast-danger-bg` | `rgba(255, 90, 114, 0.15)` | `color-mix(in oklch, var(--tug-red) 15%, transparent)` |
| `--tug-base-banner-info-bg` | `rgba(53, 188, 255, 0.12)` | `color-mix(in oklch, var(--tug-cyan) 12%, transparent)` |
| `--tug-base-banner-warning-bg` | `rgba(255, 232, 107, 0.12)` | `color-mix(in oklch, var(--tug-yellow) 12%, transparent)` |
| `--tug-base-banner-danger-bg` | `rgba(255, 90, 114, 0.12)` | `color-mix(in oklch, var(--tug-red) 12%, transparent)` |
| `--tug-base-diff-addition-bg` | `rgba(114, 206, 143, 0.12)` | `color-mix(in oklch, var(--tug-green) 12%, transparent)` |
| `--tug-base-diff-deletion-bg` | `rgba(255, 90, 114, 0.12)` | `color-mix(in oklch, var(--tug-red) 12%, transparent)` |
| `--tug-base-table-row-bg-selected` | `rgba(255, 138, 56, 0.1)` | `color-mix(in oklch, var(--tug-orange) 10%, transparent)` |
| `--tug-base-list-row-selected` | `rgba(255, 138, 56, 0.1)` | `color-mix(in oklch, var(--tug-orange) 10%, transparent)` |
| `--tug-base-tree-row-bg-selected` | `rgba(255, 138, 56, 0.1)` | `color-mix(in oklch, var(--tug-orange) 10%, transparent)` |
| `--tug-base-tree-row-bg-current` | `rgba(53, 188, 255, 0.1)` | `color-mix(in oklch, var(--tug-cyan) 10%, transparent)` |
| `--tug-base-chat-message-system-bg` | `rgba(53, 188, 255, 0.07)` | `color-mix(in oklch, var(--tug-cyan) 7%, transparent)` |
| `--tug-base-inspector-field-inherited` | `rgba(53, 188, 255, 0.08)` | `color-mix(in oklch, var(--tug-cyan) 8%, transparent)` |
| `--tug-base-inspector-field-preview` | `rgba(255, 138, 56, 0.1)` | `color-mix(in oklch, var(--tug-orange) 10%, transparent)` |
| `--tug-base-inspector-field-cancelled` | `rgba(255, 90, 114, 0.1)` | `color-mix(in oklch, var(--tug-red) 10%, transparent)` |
| `--tug-base-dev-overlay-targetHighlight` | `rgba(53, 188, 255, 0.3)` | `color-mix(in oklch, var(--tug-cyan) 30%, transparent)` |

Note: `rgba(0, 0, 0, ...)` and `rgba(255, 255, 255, ...)` tokens (shadows, overlays, hover states, grid lines) are achromatic and NOT converted -- they remain as literal rgba() values since they are black/white transparency, not chromatic.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/styles/tug-palette.css` | Static CITA palette: per-hue constants, preset formulas, neutral ramp, P3 overrides |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `injectCITACSS` | fn (removed) | `tugdeck/src/components/tugways/palette-engine.ts` | Delete function and PALETTE_STYLE_ID constant |
| `injectCITACSS` import | import (removed) | `tugdeck/src/main.tsx` | Remove import and call |
| `injectCITACSS` import | import (removed) | `tugdeck/src/contexts/theme-provider.tsx` | Remove import and call in setTheme |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `palette-engine.ts` module docstring to remove references to `injectCITACSS`
- [ ] Update `tug-tokens.css` file header to reference palette integration (Phase 5d5e) instead of "deferred to Phase 5d5d"

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify tug-palette.css contains correct variable names and formula patterns | Palette structure correctness |
| **Integration** | Verify all three themes render without errors after palette rewiring | Theme parity, no regression |
| **Drift Prevention** | Grep-based checks for leftover hex values in chromatic tokens, leftover injectCITACSS references | Prevent regression to hardcoded colors |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Create tug-palette.css with per-hue constants and global constants {#step-1}

**Commit:** `feat(palette): add tug-palette.css with per-hue constants and globals`

**References:** [D01] Pure CSS formulas, [D02] Body selector scope, Table T01, (#per-hue-constants, #context)

**Artifacts:**
- `tugdeck/styles/tug-palette.css` -- new file with per-hue constants and global constants only (presets added in next step)

**Tasks:**
- [ ] Create `tugdeck/styles/tug-palette.css` with `body { }` selector
- [ ] For each of the 24 hues in HUE_FAMILIES, emit three constants: `--tug-{hue}-h` (hue angle), `--tug-{hue}-canonical-l` (canonical L), `--tug-{hue}-peak-c` (MAX_CHROMA_FOR_HUE * PEAK_C_SCALE)
- [ ] Emit global constants: `--tug-l-dark: 0.15` and `--tug-l-light: 0.96`
- [ ] Add file header comment documenting the purpose and import order

**Tests:**
- [ ] Manually verify all 72 per-hue constant values plus 2 globals match palette-engine.ts source data

**Checkpoint:**
- [ ] `grep -c "peak-c" tugdeck/styles/tug-palette.css` returns 24 (one per hue)
- [ ] `grep -c "canonical-l" tugdeck/styles/tug-palette.css` returns 24
- [ ] `grep -cE '\-\-tug-\w+-h:\s' tugdeck/styles/tug-palette.css` returns 24

---

#### Step 2: Add chromatic preset formulas to tug-palette.css {#step-2}

**Depends on:** #step-1

**Commit:** `feat(palette): add 168 chromatic preset formulas as pure CSS oklch+calc`

**References:** [D01] Pure CSS formulas, [D04] Piecewise L formula, Table T02, (#preset-formulas, #strategy)

**Artifacts:**
- `tugdeck/styles/tug-palette.css` -- add 168 preset variables (7 presets x 24 hues)

**Tasks:**
- [ ] For each hue and preset, generate the CSS formula using the appropriate L and C expressions from Table T02
- [ ] For t=50 presets (canonical, accent): L = `var(--tug-{hue}-canonical-l)` directly
- [ ] For t>50 presets (muted t=55, light t=82, subtle t=92): L via upper segment calc
- [ ] For t<50 presets (dark t=25, deep t=15): L via lower segment calc
- [ ] C formula for all presets: `calc(i/100 * var(--tug-{hue}-peak-c))`
- [ ] Use `--tug-{hue}` for canonical preset, `--tug-{hue}-{preset}` for others

**Tests:**
- [ ] Verify formula pattern for each preset type by inspecting representative hues (orange, cyan, violet)

**Checkpoint:**
- [ ] `grep -c "oklch(" tugdeck/styles/tug-palette.css` returns at least 168 (presets)
- [ ] `grep "tug-orange:" tugdeck/styles/tug-palette.css` shows oklch formula with canonical-l and peak-c references
- [ ] `grep "tug-orange-accent:" tugdeck/styles/tug-palette.css` shows oklch formula with 0.8 * peak-c

---

#### Step 3: Add neutral ramp and black/white anchors {#step-3}

**Depends on:** #step-2

**Commit:** `feat(palette): add neutral ramp and black/white anchors per D75`

**References:** [D03] Color-mix for semi-transparent variants, Table T03, (#neutral-ramp, #assumptions)

**Artifacts:**
- `tugdeck/styles/tug-palette.css` -- add 9 neutral variables

**Tasks:**
- [ ] Add `--tug-neutral` through `--tug-neutral-deep` as static oklch() literals with C=0 per Table T03
- [ ] Add `--tug-black: oklch(0 0 0)` and `--tug-white: oklch(1 0 0)` as true black/white anchors per [D75]
- [ ] Use neutral L values from the [D75] specification (Table T03)

**Tests:**
- [ ] Verify all 9 neutral variables are present with correct L values

**Checkpoint:**
- [ ] `grep -c "tug-neutral" tugdeck/styles/tug-palette.css` returns at least 7
- [ ] `grep "tug-black" tugdeck/styles/tug-palette.css` shows `oklch(0 0 0)`
- [ ] `grep "tug-white" tugdeck/styles/tug-palette.css` shows `oklch(1 0 0)`

---

#### Step 4: Add P3 media query block {#step-4}

**Depends on:** #step-2

**Commit:** `feat(palette): add P3 color-gamut media query with wider peak-c overrides`

**References:** [D01] Pure CSS formulas, Table T04, (#p3-overrides, #strategy)

**Artifacts:**
- `tugdeck/styles/tug-palette.css` -- add `@media (color-gamut: p3)` block

**Tasks:**
- [ ] Add `@media (color-gamut: p3) { body { } }` block at the end of tug-palette.css
- [ ] For each of the 24 hues, override `--tug-{hue}-peak-c` with `MAX_P3_CHROMA_FOR_HUE[hue] * PEAK_C_SCALE`
- [ ] Do NOT override `-h` or `-canonical-l` constants (they are gamut-independent)
- [ ] Do NOT redefine preset formulas (they reference `peak-c` and auto-produce richer colors)

**Tests:**
- [ ] Verify P3 block contains exactly 24 peak-c overrides
- [ ] Verify all P3 peak-c values are greater than their sRGB counterparts

**Checkpoint:**
- [ ] `grep -c "color-gamut: p3" tugdeck/styles/tug-palette.css` returns 1
- [ ] `grep -c "peak-c" tugdeck/styles/tug-palette.css` returns 48 (24 sRGB + 24 P3)

---

#### Step 5: Palette CSS Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Pure CSS formulas, [D02] Body selector, Tables T01-T04, (#success-criteria)

**Tasks:**
- [ ] Verify tug-palette.css contains: 72 per-hue constants + 2 globals + 168 chromatic presets + 9 neutrals + 24 P3 overrides = 275 total variable declarations
- [ ] Verify file uses `body` selector for main block and `@media (color-gamut: p3) { body { } }` for P3

**Tests:**
- [ ] Count total `--tug-` variable declarations in tug-palette.css and verify equals 275

**Checkpoint:**
- [ ] Total `--tug-` variable declarations in tug-palette.css equals 275
- [ ] File structure: body block, then @media P3 block

---

#### Step 6: Update globals.css import order {#step-6}

**Depends on:** #step-5

**Commit:** `feat(palette): import tug-palette.css before tug-tokens.css in globals.css`

**References:** [D01] Pure CSS formulas, [D02] Body selector, (#dependencies, #constraints)

**Artifacts:**
- `tugdeck/src/globals.css` -- add `@import "../styles/tug-palette.css"` before `tug-tokens.css`

**Tasks:**
- [ ] Add `@import "../styles/tug-palette.css";` after `tokens.css` and before `tug-tokens.css` in globals.css
- [ ] Import order must be: tailwindcss, tokens.css, tug-palette.css, tug-tokens.css, tug-comp-tokens.css

**Tests:**
- [ ] Verify import order is correct by reading globals.css

**Checkpoint:**
- [ ] `grep -n "import" tugdeck/src/globals.css` shows tug-palette.css before tug-tokens.css

---

#### Step 7: Rewire chromatic tokens in tug-tokens.css {#step-7}

**Depends on:** #step-6

**Commit:** `feat(palette): rewire all chromatic --tug-base-* tokens to palette var() references`

**References:** [D03] Color-mix for semi-transparent variants, [D05] No cross-hue reassignment, Tables T05-T06, (#accent-migration-map, #scope)

**Artifacts:**
- `tugdeck/styles/tug-tokens.css` -- replace all hex/rgba chromatic token values with `var(--tug-{hue}[-preset])` or `color-mix()` references

**Tasks:**
- [ ] Replace all accent tokens per Table T05 mapping (accent-default, accent-strong, accent-muted, accent-subtle, accent-cool, accent-positive/warning/danger/info, accent-bg-subtle/emphasis, accent-border, accent-guide, accent-flash)
- [ ] Replace chart series tokens with palette references (warm, cool, violet, rose, verdant, golden, orchid, coral)
- [ ] Replace chart threshold tokens (threshold-warning, threshold-danger)
- [ ] Replace syntax highlighting tokens with palette references (keyword, string, number, function, type, variable, constant, decorator, tag, attribute)
- [ ] Replace status tokens with palette references (success, warning, danger, info)
- [ ] Replace badge tokens (bg variants use color-mix, fg variants use direct var)
- [ ] Replace terminal tokens: cursor, selection-bg (color-mix), ANSI colors
- [ ] Replace feed tokens with palette references (step-active, step-complete, step-error, stream-cursor, handoff)
- [ ] Replace link, icon-active, border-accent, border-danger, focus-ring tokens
- [ ] Replace selection-bg with color-mix reference
- [ ] Replace card-header-icon-active, card-header-button-fg-danger tokens
- [ ] Replace tab tokens: underline-active, dropTarget-border, badge-bg, insertIndicator
- [ ] Replace dock tokens: indicator, button-fg-active, button-fg-attention, button-badge-bg, button-insertIndicator
- [ ] Replace set-member-corner-squared
- [ ] Replace action-primary-bg-rest/hover/active and action-destructive-bg-rest/hover/active
- [ ] Replace field chromatic tokens: border-focus, border-invalid, border-valid, required, limit, dirty, error, warning, success
- [ ] Replace toggle-track-on, range-fill, progress-fill, spinner
- [ ] Replace menu-item-fg-danger, menu-item-icon-danger
- [ ] Replace toast/banner fg tokens (success, warning, danger, info)
- [ ] Replace gauge-fill, gauge-threshold-warning, gauge-threshold-danger
- [ ] Replace stat-trend-positive, stat-trend-negative
- [ ] Replace file-status-added/modified/deleted/renamed, diff-addition-fg, diff-deletion-fg
- [ ] Replace inspector chromatic tokens: target-outline, preview-outline, source-token/class/inline/preview, scrub-active
- [ ] Convert all semi-transparent chromatic rgba() tokens per Table T06 to color-mix() references: highlight-dropTarget/preview/inspectorTarget/snapGuide/flash, set-member-border-collapsed/focused-outline/hull-flash/breakout-flash/dropTarget, snap-guide, sash-hover, flash-perimeter, card-findbar-match/match-active, tab-dropTarget-bg, menu-item-bg-selected, range-scrub-active, toast-success/warning/danger-bg, banner-info/warning/danger-bg, diff-addition/deletion-bg, table/list/tree-row-bg-selected, tree-row-bg-current, chat-message-system-bg, inspector-field-inherited/preview/cancelled, dev-overlay-targetHighlight
- [ ] Update file header comment to reflect Phase 5d5e palette integration
- [ ] Ensure non-chromatic tokens (surfaces, grays, non-chromatic borders, shadows, typography, spacing) and achromatic rgba(0,0,0,...)/rgba(255,255,255,...) tokens are untouched

**Tests:**
- [ ] Grep for remaining hex color values in all chromatic token lines (accent, chart, syntax, status, badge, terminal, feed, action, toggle, range, progress, spinner, dock, tab, field, inspector, diff, file-status, stat, gauge, toast, banner, menu-danger) -- should find zero
- [ ] Grep for remaining chromatic `rgba(` tokens (those with non-zero/non-255 RGB channels) in tug-tokens.css -- should find zero (all converted to color-mix)

**Checkpoint:**
- [ ] `grep -E "accent-default|accent-strong|accent-muted" tugdeck/styles/tug-tokens.css | grep -c "#"` returns 0
- [ ] `grep -E "chart-series" tugdeck/styles/tug-tokens.css | grep -c "#"` returns 0
- [ ] `grep -E "syntax-keyword|syntax-string|syntax-number" tugdeck/styles/tug-tokens.css | grep -c "#"` returns 0
- [ ] `grep -E "action-primary-bg|action-destructive-bg" tugdeck/styles/tug-tokens.css | grep -c "#"` returns 0
- [ ] `grep -E "toggle-track-on|range-fill|progress-fill|spinner" tugdeck/styles/tug-tokens.css | grep -c "#"` returns 0
- [ ] `grep -E "dock-indicator|dock-button-fg-active" tugdeck/styles/tug-tokens.css | grep -c "#"` returns 0
- [ ] `grep -E "highlight-dropTarget|set-member-border|snap-guide|sash-hover|flash-perimeter" tugdeck/styles/tug-tokens.css | grep -c "rgba"` returns 0
- [ ] `grep -E "toast-(success|warning|danger)-bg|banner-(info|warning|danger)-bg" tugdeck/styles/tug-tokens.css | grep -c "rgba"` returns 0
- [ ] `grep -c "color-mix" tugdeck/styles/tug-tokens.css` is at least 40 (for all rgba-to-color-mix conversions)

---

#### Step 8: Update theme override files {#step-8}

**Depends on:** #step-7

**Commit:** `feat(palette): remove hex chromatic overrides from theme files`

**References:** [D05] No cross-hue reassignment, [D06] Harmony contrast preservation, Tables T05-T06, (#scope, #non-goals)

**Artifacts:**
- `tugdeck/styles/bluenote.css` -- remove all chromatic hex and rgba() overrides (dark theme, palette contrast is sufficient)
- `tugdeck/styles/harmony.css` -- remove decorative/bg chromatic overrides; preserve contrast-critical fg overrides per [D06]

**Tasks:**
- [ ] In `bluenote.css`: remove all chromatic hex overrides for tokens that now resolve from the palette, including: `--tug-base-accent-*`, `--tug-base-chart-series-*`, `--tug-base-syntax-*`, `--tug-base-status-*`, `--tug-base-badge-*-bg/fg`, `--tug-base-terminal-ansi-*` and `--tug-base-terminal-cursor`, `--tug-base-feed-*` chromatic tokens, `--tug-base-fg-link/link-hover`, `--tug-base-icon-active`, `--tug-base-border-accent/danger`, `--tug-base-focus-ring-default/danger`, `--tug-base-selection-bg`, `--tug-base-card-header-icon-active/button-fg-danger`, `--tug-base-tab-underline-active/badge-bg/insertIndicator/dropTarget-border`, `--tug-base-dock-indicator/button-fg-active`, `--tug-base-set-member-corner-squared`, `--tug-base-action-primary-bg-*/destructive-bg-*`, `--tug-base-file-status-*`, `--tug-base-diff-*-fg`
- [ ] In `bluenote.css`: also remove chromatic rgba() overrides that now resolve from palette color-mix() in tug-tokens.css: `--tug-base-highlight-*` (dropTarget, preview, inspectorTarget, snapGuide, flash), `--tug-base-set-member-border-collapsed/focused-outline/hull-flash/dropTarget`, `--tug-base-terminal-selection-bg`, `--tug-base-diff-addition-bg/deletion-bg`
- [ ] In `harmony.css`: remove decorative and bg chromatic overrides that are safe to resolve from palette: `--tug-base-chart-series-*`, `--tug-base-badge-*-bg` (rgba-based, will resolve from palette color-mix), `--tug-base-toast-*-bg`, `--tug-base-banner-*-bg`, `--tug-base-diff-addition-bg/deletion-bg`, `--tug-base-highlight-*` (dropTarget, preview, inspectorTarget, snapGuide, flash), `--tug-base-set-*` rgba overrides, `--tug-base-table/list/tree-row-bg-selected`, `--tug-base-tree-row-bg-current`, `--tug-base-chat-message-system-bg`, `--tug-base-sash-hover`, `--tug-base-snap-guide`, `--tug-base-flash-perimeter`, `--tug-base-dev-overlay-targetHighlight`, `--tug-base-inspector-field-inherited/preview/cancelled`
- [ ] In `harmony.css`: remove opaque chromatic overrides where palette contrast is sufficient on light backgrounds (accent-default, accent-strong, accent-cool-default, accent-positive, accent-danger, accent-info, status-success, status-danger, status-info, action-primary/destructive bg tokens, toggle-track-on, range-fill, progress-fill, spinner, gauge-fill, dock-indicator, dock-button-fg-active, dock-button-badge-bg, tab-underline-active, tab-badge-bg, tab-insertIndicator, accent-border/border-hover, border-accent, border-danger, focus-ring-default/danger, fg-link/link-hover, icon-active, card-header-icon-active, card-header-button-fg-danger, tab-dropTarget-border, dock-button-insertIndicator, set-member-corner-squared, field-border-focus/invalid/valid, field-required, field-error, field-success, menu-item-fg-danger, menu-item-icon-danger, stat-trend-positive, stat-trend-negative, file-status-added/deleted/renamed, diff-addition-fg, diff-deletion-fg, terminal-cursor, terminal-ansi-red/green/blue/magenta/cyan, feed-step-active/complete/error, feed-stream-cursor, feed-handoff, inspector-target-outline, inspector-preview-outline, inspector-source-token, inspector-source-class, inspector-source-preview, inspector-scrub-active, accent-bg-subtle/emphasis, accent-guide, accent-flash, accent-underline-active, selection-bg, terminal-selection-bg, badge-accent-fg, badge-success-fg, badge-danger-fg, status-warning, chart-threshold-warning/danger, gauge-threshold-warning/danger, toast-success-fg, toast-danger-fg, banner-danger-fg, syntax-keyword, syntax-string, syntax-number, syntax-type, syntax-variable, syntax-constant, syntax-decorator, syntax-tag, syntax-attribute)
- [ ] In `harmony.css`: PRESERVE contrast-critical fg overrides per [D06] -- these are tokens where the palette preset has insufficient contrast on Harmony's light backgrounds: `--tug-base-syntax-function` (#8a7200 -- dark gold, palette --tug-yellow has L=0.901), `--tug-base-badge-warning-fg` (#8a7200), `--tug-base-toast-warning-fg` (#b89000), `--tug-base-banner-info-fg` (#2898c8 -- darker cyan), `--tug-base-banner-warning-fg` (#8a7200), `--tug-base-terminal-ansi-yellow` (#8a7200), `--tug-base-terminal-ansi-white` (#f4f7f8 -- kept as Harmony-specific near-white), `--tug-base-file-status-modified` (#8a7200), `--tug-base-inspector-source-inline` (#8a7200), `--tug-base-accent-muted` (#c46020 -- darker orange for muted on light bg), `--tug-base-accent-subtle` (rgba with Harmony-specific opacity), `--tug-base-dock-button-fg-attention` (#ffe15a retained if palette equivalent has poor contrast). The implementer must verify each candidate override against its typical Harmony background surface; if the palette-derived color has a contrast ratio below 3:1, preserve the override
- [ ] Retain all non-chromatic overrides (surfaces, grays, non-chromatic borders, shadows, elevation, typography) and achromatic rgba(0,0,0,...)/rgba(255,255,255,...) overrides
- [ ] Verify theme files still have valid CSS structure after removals

**Tests:**
- [ ] Grep bluenote.css for remaining hex values in chromatic token lines -- should find zero (all removed)
- [ ] Grep harmony.css for chromatic overrides -- verify only contrast-critical fg overrides per [D06] remain
- [ ] For each preserved Harmony override, verify the palette-derived alternative has contrast ratio below 3:1 against the relevant Harmony background

**Checkpoint:**
- [ ] `grep -E "accent-default|chart-series|syntax-keyword|action-primary-bg|toggle-track-on|dock-indicator" tugdeck/styles/bluenote.css | grep -c "#"` returns 0
- [ ] `grep -E "chart-series|action-primary-bg|toggle-track-on|dock-indicator" tugdeck/styles/harmony.css | grep -c "#"` returns 0
- [ ] `grep -E "highlight-dropTarget|highlight-preview|set-member-border-collapsed" tugdeck/styles/bluenote.css | grep -c "rgba"` returns 0
- [ ] `grep -E "highlight-dropTarget|highlight-preview|set-member-border-collapsed|toast-(success|warning|danger)-bg|banner-(info|warning|danger)-bg" tugdeck/styles/harmony.css | grep -c "rgba"` returns 0
- [ ] Harmony contrast-critical overrides are preserved: `grep -c "syntax-function\|badge-warning-fg\|toast-warning-fg\|banner-warning-fg\|terminal-ansi-yellow\|file-status-modified" tugdeck/styles/harmony.css` returns at least 6

---

#### Step 9: Remove injectCITACSS from palette-engine.ts {#step-9}

**Depends on:** #step-6

**Commit:** `refactor(palette): remove injectCITACSS from palette-engine.ts`

**References:** [D01] Pure CSS formulas, (#strategy, #scope)

**Artifacts:**
- `tugdeck/src/components/tugways/palette-engine.ts` -- remove `injectCITACSS` function and `PALETTE_STYLE_ID` constant

**Tasks:**
- [ ] Delete the `injectCITACSS` function definition (the `export function injectCITACSS` block and its JSDoc)
- [ ] Delete the `PALETTE_STYLE_ID` constant declaration
- [ ] Delete the section comment block (`// injectCITACSS — CSS variable injection`)
- [ ] Update the module docstring to remove references to CSS variable injection and `injectCITACSS`
- [ ] Retain all other exports: `citaColor`, `HUE_FAMILIES`, `DEFAULT_CANONICAL_L`, `MAX_CHROMA_FOR_HUE`, `MAX_P3_CHROMA_FOR_HUE`, `PEAK_C_SCALE`, `L_DARK`, `L_LIGHT`, `CITA_PRESETS`, `DEFAULT_LC_PARAMS`, `oklchToLinearSRGB`, `isInSRGBGamut`, `findMaxChroma`, `oklchToLinearP3`, `isInP3Gamut`, `_deriveChromaCaps`, `_deriveP3ChromaCaps`

**Tests:**
- [ ] Verify `injectCITACSS` is no longer exported from palette-engine.ts

**Checkpoint:**
- [ ] `grep "injectCITACSS" tugdeck/src/components/tugways/palette-engine.ts` returns no matches
- [ ] `grep "PALETTE_STYLE_ID" tugdeck/src/components/tugways/palette-engine.ts` returns no matches

---

#### Step 10: Remove injectCITACSS calls from main.tsx and theme-provider.tsx {#step-10}

**Depends on:** #step-9

**Commit:** `refactor(palette): remove injectCITACSS call sites from main.tsx and theme-provider.tsx`

**References:** [D01] Pure CSS formulas, (#scope, #strategy)

**Artifacts:**
- `tugdeck/src/main.tsx` -- remove `injectCITACSS` import and call
- `tugdeck/src/contexts/theme-provider.tsx` -- remove `injectCITACSS` import and call in `setTheme`

**Tasks:**
- [ ] In `main.tsx`: remove the `import { injectCITACSS }` line and the `injectCITACSS(initialTheme)` call (line ~43) and its preceding comment
- [ ] In `theme-provider.tsx`: remove the `import { injectCITACSS }` line and the `injectCITACSS(newTheme)` call inside `setTheme` (line ~181) and its preceding comment

**Tests:**
- [ ] Verify no file in the codebase imports `injectCITACSS`

**Checkpoint:**
- [ ] `grep -r "injectCITACSS" tugdeck/src/ --include="*.ts" --include="*.tsx" | grep -v "__tests__" | grep -v "node_modules"` returns no matches
- [ ] TypeScript compiles without errors: `cd tugdeck && bunx tsc --noEmit`

---

#### Step 11: Update tests {#step-11}

**Depends on:** #step-9, #step-10

**Commit:** `test(palette): replace injectCITACSS tests with tug-palette.css verification tests`

**References:** [D01] Pure CSS formulas, Tables T01-T04, (#test-plan-concepts)

**Artifacts:**
- `tugdeck/src/__tests__/palette-engine.test.ts` -- delete injectCITACSS test sections, add tug-palette.css tests

**Tasks:**
- [ ] Delete the `describe("injectCITACSS() -- Layer 1 and Layer 2")` test block
- [ ] Delete the `describe("injectCITACSS() -- P3 @media block")` test block
- [ ] Remove `injectCITACSS` from the import statement
- [ ] Add new test file or section: read `tug-palette.css` as text and verify:
  - Contains all 24 `--tug-{hue}-h` variables with correct hue angles
  - Contains all 24 `--tug-{hue}-canonical-l` variables with correct L values
  - Contains all 24 `--tug-{hue}-peak-c` variables with correct peak-c values
  - Contains all 168 preset variables (7 per hue, correct naming)
  - Contains `--tug-neutral` through `--tug-neutral-deep` plus `--tug-black` and `--tug-white`
  - Contains `@media (color-gamut: p3)` block with 24 peak-c overrides
  - Preset formulas use `oklch(` and `calc(` patterns

**Tests:**
- [ ] All new tug-palette.css verification tests pass
- [ ] All remaining palette-engine tests continue to pass (citaColor, gamut checks, etc.)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes with no failures in palette-engine tests
- [ ] `grep "injectCITACSS" tugdeck/src/__tests__/palette-engine.test.ts` returns no matches

---

#### Step 12: Final Integration Checkpoint {#step-12}

**Depends on:** #step-7, #step-8, #step-10, #step-11

**Commit:** `N/A (verification only)`

**References:** [D01] Pure CSS formulas, [D03] Color-mix, [D05] No cross-hue, Tables T01-T05, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify no `injectCITACSS` references remain anywhere in the codebase
- [ ] Verify no hardcoded hex values remain in chromatic `--tug-base-*` token lines in tug-tokens.css
- [ ] Verify tug-palette.css import order is correct in globals.css
- [ ] Verify all three themes render correctly (visual inspection)
- [ ] Verify theme files have no chromatic hex overrides

**Tests:**
- [ ] `cd tugdeck && bun test` passes with all palette and theme tests green
- [ ] `cd tugdeck && bunx tsc --noEmit` compiles without TypeScript errors

**Checkpoint:**
- [ ] `grep -r "injectCITACSS" tugdeck/src/ --include="*.ts" --include="*.tsx"` returns no matches
- [ ] `cd tugdeck && bun test` passes
- [ ] `cd tugdeck && bunx tsc --noEmit` compiles without errors
- [ ] `grep -E "accent-default|accent-strong|chart-series|syntax-keyword|status-success|action-primary-bg|toggle-track-on|dock-indicator" tugdeck/styles/tug-tokens.css | grep -c "#[0-9a-fA-F]"` returns 0

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The CITA palette engine is fully connected to the semantic token layer via pure CSS formulas, with neutral ramp, P3 support, and no JavaScript injection.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tug-palette.css` exists with 275 variable declarations (72 per-hue constants + 2 globals + 168 presets + 9 neutrals + 24 P3 overrides)
- [ ] All chromatic `--tug-base-*` tokens in `tug-tokens.css` resolve through `var(--tug-{hue}[-preset])` or `color-mix()` references
- [ ] No `injectCITACSS` import or call exists anywhere in the codebase
- [ ] All three themes render correctly with palette-derived colors
- [ ] `bun test` passes with no failures
- [ ] TypeScript compiles without errors

**Acceptance tests:**
- [ ] `grep -r "injectCITACSS" tugdeck/src/ --include="*.ts" --include="*.tsx"` returns no matches
- [ ] `grep -E "(accent-default|chart-series-warm|syntax-keyword|terminal-ansi-red|action-primary-bg|toggle-track-on|dock-indicator|progress-fill)" tugdeck/styles/tug-tokens.css | grep -v "var(--tug-" | grep -v "color-mix" | grep -c "#"` returns 0
- [ ] `cd tugdeck && bun test` passes
- [ ] `cd tugdeck && bunx tsc --noEmit` compiles cleanly

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5d5f: Cascade Inspector -- dev-mode `Ctrl+Option + hover` shows token resolution chain
- [ ] Cross-hue reassignment in theme files (Bluenote accent = blue, etc.)
- [ ] Per-theme canonical L tuning
- [ ] Remove `citaColor()` if no programmatic consumers remain after cascade inspector is built

| Checkpoint | Verification |
|------------|--------------|
| tug-palette.css completeness | 275 total variable declarations |
| Chromatic token rewiring | Zero hex values in chromatic --tug-base-* lines |
| injectCITACSS removal | Zero grep matches across codebase |
| Test suite | `bun test` passes |
| TypeScript | `bunx tsc --noEmit` compiles cleanly |
