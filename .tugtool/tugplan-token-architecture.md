<!-- tugplan-skeleton v2 -->

## Token Architecture (Phase 5d5c) {#phase-5d5c}

**Purpose:** Introduce the `--tug-base-*` and `--tug-comp-*` token layers with the full semantic taxonomy, using literal hex values (not HVV palette references) for strict zero-visual-regression, and bridge old tokens to new tokens via backward-compatibility aliases.

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

The tugways design system currently uses a two-tier token scheme: `--tways-*` palette tokens (Tier 1) and `--td-*` semantic tokens (Tier 2), both defined in `tokens.css`. Phase 5d5a delivered the HVV palette engine (242 CSS variables with `--tug-{hue}[-preset]` naming), and Phase 5d5b delivered zoom-based global scale (`--tug-zoom` on body) and timing multipliers. The existing `--td-*` and `--tways-*` naming is legacy -- the long-term target is `--tug-base-*` for canonical semantics and `--tug-comp-*` for component bindings.

This phase introduces the new token layers without migrating any consumers. The `--tug-base-*` tokens become the source of truth immediately, with `--td-*` and `--tways-*` tokens repointed as backward-compatibility aliases. Theme override files (bluenote.css, harmony.css) gain `--tug-base-*` overrides where they currently override `--tways-*` palette values. The result is a fully specified semantic contract that future phases can migrate consumers to, with zero visual regression today.

#### Strategy {#strategy}

- Define the complete `--tug-base-*` taxonomy (~300 tokens) in a new `tug-tokens.css` file with Brio default values, covering all domains from the Revised Semantic Taxonomy in theme-overhaul-proposal.md.
- Use literal hex values for all color tokens -- including accent, chart, syntax, and status tokens -- sourced from the existing `--tways-*` palette per theme. Do NOT wire to HVV palette `var()` references in this phase; the HVV palette computes OKLCH-based colors that are perceptually similar but not identical hex values, which would violate zero-visual-regression. HVV wiring is deferred to Phase 5d5d where visual tuning is expected.
- Use plain values for spacing, radius, typography, and icon-size tokens -- CSS `zoom` on body handles all dimension scaling, so no `calc()` wiring is needed.
- Reference (not redefine) the motion duration tokens already in `tokens.css` from Phase 5d5b.
- Define `--tug-comp-*` tokens for existing component families only (tug-button, tug-tab-bar, tugcard, tug-dropdown) in a separate `tug-comp-tokens.css` file.
- Repoint `--td-*` and `--tways-*` tokens as backward-compatibility aliases pointing to `--tug-base-*`, preserving the existing shadcn bridge chain (`--background` -> `--td-*` -> `--tug-base-*`).
- Add `--tug-base-*` overrides to bluenote.css and harmony.css to match their current `--tways-*` palette overrides.

#### Success Criteria (Measurable) {#success-criteria}

- All ~300 `--tug-base-*` tokens from the Revised Semantic Taxonomy are defined in `tug-tokens.css` (verify: count CSS custom property declarations)
- All `--tug-comp-*` tokens for the four existing component families are defined in `tug-comp-tokens.css` and resolve from `--tug-base-*` (verify: grep for `var(--tug-base-` in tug-comp-tokens.css)
- Zero visual change across all three themes: Brio, Bluenote, Harmony (verify: manual visual inspection of component gallery)
- All existing `--td-*` tokens become aliases that resolve to `--tug-base-*` (verify: grep tokens.css backward-compatibility section)
- `bun run build` succeeds with no errors (verify: build command)

#### Scope {#scope}

1. New file `tugdeck/styles/tug-tokens.css` with complete `--tug-base-*` taxonomy
2. New file `tugdeck/styles/tug-comp-tokens.css` with `--tug-comp-*` tokens for tug-button, tug-tab-bar, tugcard, tug-dropdown
3. Import statements in `globals.css` for both new files
4. Backward-compatibility aliases in `tokens.css` repointing `--td-*` to `--tug-base-*`
5. Theme overrides in `bluenote.css` and `harmony.css` for `--tug-base-*` tokens
6. Brio default values populated from existing `--tways-*` palette values

#### Non-goals (Explicitly out of scope) {#non-goals}

- Consumer migration: no component CSS or TypeScript files change their token references (Phase 5d5d)
- Removal of legacy `--td-*` or `--tways-*` tokens (Phase 5d5d)
- shadcn bridge / Tailwind `@theme` block changes (Phase 5d5d)
- Component-level zoom overrides (`--tug-comp-*-zoom`) beyond declaration (Phase 5d5d)
- Component families beyond the four existing ones (tug-button, tug-tab-bar, tugcard, tug-dropdown)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5d5a (HVV Palette Engine): COMPLETE -- 242 CSS variables with `--tug-{hue}[-preset]` naming available at runtime via `injectHvvCSS()`
- Phase 5d5b (Scale & Timing): COMPLETE -- `--tug-zoom` drives CSS zoom on body; `--tug-base-motion-duration-{fast,moderate,slow,glacial}` defined in `tokens.css`

#### Constraints {#constraints}

- Zero visual regression: every pixel must look identical before and after this change across all three themes
- `tug-tokens.css` must be imported after `tokens.css` in `globals.css` so that HVV palette variables from `injectHvvCSS()` are available
- `tug-comp-tokens.css` must be imported after `tug-tokens.css` so `--tug-base-*` values are available
- The `--tug-base-motion-duration-*` tokens already exist in `tokens.css` -- reference them via `var()` in `tug-tokens.css`, do not redefine with new `calc()` expressions

#### Assumptions {#assumptions}

- The HVV palette CSS variables (`--tug-{hue}[-preset]`) are injected into `:root` at startup by `injectHvvCSS()` and are available to any CSS file loaded after `tokens.css`
- The shadcn bridge tokens (`--background`, `--foreground`, `--primary`, etc.) will continue to chain through `--td-*` -> `--tug-base-*`, so the Tailwind `@theme` block in `globals.css` requires no changes
- Verification of zero visual change is manual (visual inspection of component gallery across all three themes)
- Best-guess derivations from existing `--tways-*` values will be used for domains with no current `--td-*` equivalent (terminal ANSI, chat, inspector, table, badge, stat, gauge)

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses the standard conventions from the skeleton: explicit anchors on all cited headings, kebab-case anchor names, stable labels for decisions/specs/tables/lists/risks.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Best-guess values for domains with no current equivalent (DECIDED) {#q01-best-guess-values}

**Question:** For domains like terminal ANSI, chat, inspector, table, badge, stat, gauge -- what concrete color/spacing values should the new `--tug-base-*` tokens use?

**Why it matters:** Wrong defaults could cause jarring visuals when those components are built.

**Options (if known):**
- Derive from the closest existing `--tways-*`/`--td-*` literal hex values
- Use HVV palette presets where appropriate (rejected per [D08] -- HVV produces different hex values)

**Plan to resolve:** Use best-guess derivations from existing literal hex values per user answer. These are reasonable defaults that will be tuned when each domain's components are actually built.

**Resolution:** DECIDED -- use best-guess derivations from literal hex values per user answer #2 (see [D03], [D08]).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Alias chain introduces visual regression | high | low | Manual visual inspection across all three themes at each step | Any visual diff detected |
| Token count explosion harms dev experience | low | medium | Follow the established taxonomy exactly; no ad-hoc additions | Token grep returns > 350 base tokens |
| HVV palette variables not available at CSS parse time | high | low | Import order ensures `tug-tokens.css` loads after `tokens.css`; HVV injected at startup | Accent tokens show fallback colors |

**Risk R01: Alias chain visual regression** {#r01-alias-regression}

- **Risk:** Repointing `--td-*` through `--tug-base-*` could subtly change resolved values if any intermediate alias is wrong.
- **Mitigation:**
  - Each `--tug-base-*` token's Brio default is sourced directly from the current `--tways-*` value it replaces
  - Each `--td-*` alias is verified to resolve to the same computed value as before
  - Visual inspection checkpoint at each step boundary
- **Residual risk:** Edge cases in CSS variable resolution order across theme injection could produce unexpected values; manual inspection catches these.

**Risk R02: Motion token redefinition conflict** {#r02-motion-redefinition}

- **Risk:** Accidentally redefining `--tug-base-motion-duration-*` tokens that already exist in `tokens.css` could cause double-scaling or value conflicts.
- **Mitigation:** `tug-tokens.css` references the four existing duration tokens (fast/moderate/slow/glacial) via comments but does not redeclare them. The `instant` duration token is newly defined since it was not in Phase 5d5b. Easing and pattern tokens are newly defined since they do not yet exist as `--tug-base-*`.
- **Residual risk:** None if the "reference, not redefine" rule is followed for the four existing tokens.

---

### Design Decisions {#design-decisions}

#### [D01] --tug-base-* is the source of truth immediately (DECIDED) {#d01-base-source-of-truth}

**Decision:** `--tug-base-*` tokens are the authoritative source of truth from this phase forward. Theme files override `--tug-base-*` directly. Legacy `--td-*` and `--tways-*` tokens become backward-compatibility aliases pointing to `--tug-base-*`.

**Rationale:**
- Avoids a prolonged period where two parallel token systems must be kept in sync
- Theme overrides apply at the canonical layer, so theme authors only need to learn one system
- The alias direction (`--td-*` -> `--tug-base-*`) ensures existing consumers resolve correctly through the chain

**Implications:**
- `tug-tokens.css` defines `--tug-base-*` with Brio default values in `body {}`
- `bluenote.css` and `harmony.css` gain `--tug-base-*` overrides matching their current palette
- `tokens.css` Tier 2 section is updated so `--td-*` tokens point to `--tug-base-*` instead of `--tways-*`
- The `--tways-*` Tier 1 palette tokens remain in `tokens.css` for now (removed in Phase 5d5d)

#### [D02] Component tokens limited to existing families (DECIDED) {#d02-comp-scope}

**Decision:** `--tug-comp-*` tokens are defined only for the four existing component families: tug-button, tug-tab-bar, tugcard, and tug-dropdown.

**Rationale:**
- Minimal surface area makes it easier to verify zero visual change
- Components that do not yet exist (dock, inspector, gauge, etc.) do not need comp tokens yet
- Each comp token must resolve from `--tug-base-*` -- this constraint is easier to verify with fewer families

**Implications:**
- `tug-comp-tokens.css` contains four clearly delimited sections
- Future phases add comp token families as the corresponding components are built
- No comp-level zoom overrides are activated in this phase (declared but set to `1` or omitted)

#### [D03] All ~300 taxonomy tokens defined now with best-guess derivations (DECIDED) {#d03-full-taxonomy}

**Decision:** The complete `--tug-base-*` taxonomy from theme-overhaul-proposal.md is defined in this phase, including domains with no current consumer (terminal, chat, inspector, table, badge, stat, gauge). Best-guess values are derived from the closest existing `--tways-*`/`--td-*` literal hex values.

**Rationale:**
- Defining the full taxonomy now means future component phases do not need a token-definition step
- Best-guess values are reasonable starting points that can be tuned when components are built
- The taxonomy is stable and well-specified in theme-overhaul-proposal.md

**Implications:**
- `tug-tokens.css` is a large file (~300+ custom property declarations)
- Theme override files need corresponding overrides only for tokens that differ between themes (primarily color tokens; spacing/radius/typography are theme-invariant)
- Best-guess values for unused domains will be documented with comments

#### [D04] Import order: tokens.css -> tug-tokens.css -> tug-comp-tokens.css (DECIDED) {#d04-import-order}

**Decision:** `globals.css` imports the new files in this order: (1) `tokens.css` (existing), (2) `tug-tokens.css` (new base tokens), (3) `tug-comp-tokens.css` (new comp tokens).

**Rationale:**
- `tokens.css` defines `--tways-*` palette, global multipliers, and motion duration tokens that `tug-tokens.css` references
- HVV palette injection happens at startup before any CSS is evaluated, so `--tug-{hue}[-preset]` variables are available
- `tug-comp-tokens.css` resolves from `--tug-base-*`, so it must load after `tug-tokens.css`

**Implications:**
- Two new `@import` lines in `globals.css` after the existing `tokens.css` import
- CSS specificity is not affected since all tokens are defined on `body {}` (same selector weight)

#### [D05] Backward-compatibility aliases repoint --td-* to --tug-base-* (DECIDED) {#d05-backward-aliases}

**Decision:** The existing `--td-*` semantic tokens in `tokens.css` are updated to resolve from `--tug-base-*` instead of `--tways-*`. The `--tways-*` Tier 1 palette remains but is no longer the intermediary for semantic tokens.

**Rationale:**
- Makes `--tug-base-*` the single source of truth for all downstream consumers
- The alias chain becomes: consumer -> `--td-*` -> `--tug-base-*` -> literal hex value
- shadcn bridge tokens (`--background`, etc.) continue to chain through `--td-*` unchanged

**Implications:**
- Every `--td-*` declaration in `tokens.css` Tier 2 section is updated from `var(--tways-*)` to `var(--tug-base-*)`
- The `--tways-*` Tier 1 palette declarations remain in `tokens.css` body block (they are still used by theme files and will be removed in Phase 5d5d)
- No consumer CSS files change in this phase

#### [D06] Motion duration tokens referenced, not redefined (DECIDED) {#d06-motion-reference}

**Decision:** The four `--tug-base-motion-duration-{fast,moderate,slow,glacial}` tokens already defined in `tokens.css` (Phase 5d5b) are not redefined in `tug-tokens.css`. The missing `--tug-base-motion-duration-instant` token (in the taxonomy but not shipped in 5d5b) is newly defined in `tug-tokens.css`. The easing tokens (`--tug-base-motion-easing-*`) and motion pattern tokens (`--tug-base-motion-pattern-*`) are also newly defined in `tug-tokens.css`.

**Rationale:**
- Redefining the four existing duration tokens would risk double-declaration conflicts
- The `instant` duration token was omitted from Phase 5d5b but is part of the canonical taxonomy and should be defined
- Easing and pattern tokens are new and have no existing definition

**Implications:**
- `tug-tokens.css` motion section defines `--tug-base-motion-duration-instant`, easing tokens, and pattern tokens; it contains a comment referencing the four existing duration tokens in `tokens.css`
- `--td-duration-*` aliases in `tokens.css` continue to point at the existing `--tug-base-motion-duration-*` tokens unchanged

#### [D07] Theme overrides use --tug-base-* directly (DECIDED) {#d07-theme-overrides}

**Decision:** `bluenote.css` and `harmony.css` gain `--tug-base-*` token overrides alongside their existing `--tways-*` palette overrides. Both sets of overrides coexist in this phase.

**Rationale:**
- Since `--tug-base-*` is the source of truth, theme variation must be expressed at this layer
- Keeping `--tways-*` overrides in theme files ensures the legacy alias chain still works for any `--td-*` tokens that still reference `--tways-*` directly
- Both override sets can coexist safely since they target different variable names

**Implications:**
- Theme files grow by ~30-50 lines each (color token overrides only; spacing/radius/typography are theme-invariant)
- The `--tways-*` overrides in theme files will be removed in Phase 5d5d when legacy tokens are deleted

#### [D08] All color tokens use literal hex values, not HVV palette var() references (DECIDED) {#d08-literal-hex}

**Decision:** All `--tug-base-*` color tokens (including accent, status, chart series, syntax, and terminal ANSI) use literal hex values copied from the existing `--tways-*` palette per theme. HVV palette `var(--tug-{hue}[-preset])` references are NOT used in this phase. However, `var()` references to OTHER `--tug-base-*` tokens are permitted where they preserve a semantic link and produce identical computed values (see [D09], [D10]).

**Rationale:**
- The HVV palette engine computes OKLCH-based colors that are perceptually similar but produce different hex values than the existing hardcoded palette. Using `var(--tug-orange)` instead of `#ff8a38` would change the resolved color, violating the zero-visual-regression constraint.
- Each theme (Brio, Bluenote, Harmony) has different accent hex values. The HVV palette is theme-invariant, so wiring accent tokens to HVV would lose theme-specific accent tuning.
- Deferring HVV wiring to Phase 5d5d (consumer migration) keeps this phase strictly additive with zero visual risk.
- Intra-base `var()` references (one `--tug-base-*` token referencing another) are safe because theme override files already override the referenced tokens, so the chain resolves correctly.

**Implications:**
- `tug-tokens.css` accent section uses Brio hex values: `--tug-base-accent-default: #ff8a38` (not `var(--tug-orange)`)
- Theme override files must include accent overrides with their theme-specific hex values
- Chart series tokens use Brio accent hex values (e.g., `--tug-base-chart-series-warm: #ff8a38`)
- Syntax tokens use existing `--tways-accent-*` hex values (except operator/punctuation/comment per [D09])
- The HVV palette remains available for future use; this decision only affects the initial wiring

#### [D09] Text-derived syntax tokens use var(--tug-base-fg-*) references (DECIDED) {#d09-syntax-fg-refs}

**Decision:** Three syntax tokens that currently derive from text colors use `var()` references to `--tug-base-fg-*` tokens instead of literal hex values: `--tug-base-syntax-operator: var(--tug-base-fg-default)`, `--tug-base-syntax-punctuation: var(--tug-base-fg-default)`, `--tug-base-syntax-comment: var(--tug-base-fg-muted)`.

**Rationale:**
- These tokens are semantically "text-colored" -- they resolve from `--td-text` and `--td-text-soft` today
- Using `var(--tug-base-fg-*)` maintains the semantic link and means theme override files do NOT need explicit overrides for these three tokens (they inherit from the fg tokens which are already overridden per theme)
- This is an application of the intra-base `var()` exception in [D08]
- All other syntax tokens (keyword, string, number, function, type, variable, constant, decorator, tag, attribute) use literal hex values per [D08] since they derive from accent palette colors

**Implications:**
- Theme files need accent-derived syntax token overrides but NOT operator/punctuation/comment overrides
- Reduces override burden in theme files by 3 tokens per theme

#### [D10] Compound shadow tokens use var(--tug-base-shadow-sm) to preserve dynamic resolution (DECIDED) {#d10-compound-shadows}

**Decision:** Compound shadow tokens that contain embedded shadow-opacity references use `var(--tug-base-shadow-sm)` (or other `--tug-base-*` shadow tokens) instead of fully expanded literal values. Specifically, `--tug-base-shadow-card-active` (mapped from `--tways-depth-raise`) uses an expression containing `var(--tug-base-shadow-sm)` to preserve dynamic resolution of the theme-specific shadow opacity.

**Rationale:**
- `--tways-depth-raise` is a compound multi-shadow expression containing `var(--tways-shadow-soft)` which resolves to different opacity values per theme: Brio `rgba(0,0,0,0.5)`, Bluenote `rgba(0,0,0,0.44)`, Harmony `rgba(0,0,0,0.24)`
- Flattening this to a fully literal value would require per-theme overrides for a complex compound shadow expression that is easy to get wrong
- Using `var(--tug-base-shadow-sm)` (which maps to the theme-specific shadow-soft value) preserves dynamic resolution and eliminates the need for per-theme overrides of the compound token
- This is an application of the intra-base `var()` exception in [D08]

**Implications:**
- `--tug-base-shadow-card-active` defined as the compound shadow expression with `var(--tug-base-shadow-sm)` replacing the literal shadow-soft value
- Theme override files do NOT need to override `--tug-base-shadow-card-active` -- they only override `--tug-base-shadow-sm` and the compound token resolves correctly
- Similarly, any other compound shadow/depth tokens that embed `var(--tways-shadow-soft)` should use `var(--tug-base-shadow-sm)`

---

### Specification {#specification}

#### Token File Structure {#token-file-structure}

**Spec S01: tug-tokens.css structure** {#s01-tug-tokens-structure}

```
/* tug-tokens.css */
body {
  /* === A. Core Visual === */
  /* Surfaces */
  --tug-base-bg-app: ...;
  --tug-base-bg-canvas: ...;
  --tug-base-surface-*: ...;

  /* Foreground / Text */
  --tug-base-fg-*: ...;

  /* Icon */
  --tug-base-icon-*: ...;

  /* Borders / Dividers / Focus */
  --tug-base-border-*: ...;
  --tug-base-divider-*: ...;
  --tug-base-focus-ring-*: ...;

  /* Elevation / Overlay */
  --tug-base-shadow-*: ...;
  --tug-base-overlay-*: ...;

  /* Typography (plain values) */
  --tug-base-font-family-*: ...;
  --tug-base-font-size-*: ...;
  --tug-base-line-height-*: ...;

  /* Spacing (plain values) */
  --tug-base-space-*: ...;

  /* Radius (plain values) */
  --tug-base-radius-*: ...;

  /* Stroke */
  --tug-base-stroke-*: ...;

  /* Icon Size (plain values) */
  --tug-base-icon-size-*: ...;

  /* Motion (easing and patterns only; durations in tokens.css) */
  --tug-base-motion-easing-*: ...;
  --tug-base-motion-pattern-*: ...;

  /* === B. Accent System (literal hex values; HVV wiring deferred to 5d5d) === */
  --tug-base-accent-*: ...;

  /* === C. Selection / Highlight / Preview === */
  --tug-base-selection-*: ...;
  --tug-base-highlight-*: ...;

  /* === D. Workspace Chrome === */
  /* Card, Card Header, Tab Bar, Dock/Canvas/Snap, Snap Sets */
  --tug-base-card-*: ...;
  --tug-base-tab-*: ...;
  --tug-base-dock-*: ...;
  --tug-base-canvas-*: ...;
  --tug-base-snap-*: ...;
  --tug-base-set-*: ...;

  /* === E. Actions and Generic Controls === */
  --tug-base-control-disabled-*: ...;
  --tug-base-action-*: ...;
  --tug-base-field-*: ...;
  --tug-base-toggle-*: ...;
  --tug-base-range-*: ...;

  /* === F. Menus, Overlays, Modalities, Feedback === */
  --tug-base-menu-*: ...;
  --tug-base-popover-*: ...;
  --tug-base-tooltip-*: ...;
  --tug-base-dialog-*: ...;
  --tug-base-toast-*: ...;
  --tug-base-badge-*: ...;
  --tug-base-status-*: ...;
  --tug-base-progress-*: ...;
  --tug-base-banner-*: ...;
  --tug-base-kbd-*: ...;
  --tug-base-scrollbar-*: ...;

  /* === G. Tables, Lists, Stats, Visualization === */
  --tug-base-table-*: ...;
  --tug-base-stat-*: ...;
  --tug-base-chart-*: ...;
  --tug-base-gauge-*: ...;

  /* === H. Syntax, Terminal, Code-Oriented === */
  --tug-base-syntax-*: ...;
  --tug-base-terminal-*: ...;
  --tug-base-chat-*: ...;
  --tug-base-codeBlock-*: ...;
  --tug-base-tree-*: ...;
  --tug-base-file-status-*: ...;
  --tug-base-diff-*: ...;
  --tug-base-feed-*: ...;

  /* === I. Inspector / Dev Tooling === */
  --tug-base-inspector-*: ...;
  --tug-base-dev-overlay-*: ...;
}
```

**Spec S02: tug-comp-tokens.css structure** {#s02-comp-tokens-structure}

```
/* tug-comp-tokens.css */
body {
  /* === tug-button family === */
  --tug-comp-button-primary-bg-rest: var(--tug-base-action-primary-bg-rest);
  --tug-comp-button-primary-bg-hover: var(--tug-base-action-primary-bg-hover);
  ...

  /* === tug-tab-bar family === */
  --tug-comp-tab-bar-bg: var(--tug-base-tab-bar-bg);
  --tug-comp-tab-bg-rest: var(--tug-base-tab-bg-rest);
  ...

  /* === tugcard family === */
  --tug-comp-card-bg: var(--tug-base-card-bg);
  --tug-comp-card-header-bg-active: var(--tug-base-card-header-bg-active);
  ...

  /* === tug-dropdown family === */
  --tug-comp-dropdown-bg: var(--tug-base-menu-bg);
  --tug-comp-dropdown-item-bg-hover: var(--tug-base-menu-item-bg-hover);
  ...
}
```

**Spec S03: Backward-compatibility alias pattern** {#s03-alias-pattern}

Every existing `--td-*` token in `tokens.css` is updated from:
```css
--td-bg: var(--tways-bg);
```
to:
```css
--td-bg: var(--tug-base-bg-app);
```

The `--tways-*` Tier 1 palette declarations remain unchanged. The shadcn bridge tokens remain unchanged (they reference `--td-*`).

**Spec S04: Theme override pattern** {#s04-theme-override-pattern}

Theme files gain `--tug-base-*` overrides for ALL token domains that differ between themes -- including surfaces, foreground, accents, borders, and workspace chrome. Each theme has different accent hex values, so accent overrides are mandatory. Example for Bluenote:
```css
body {
  /* Existing --tways-* overrides (kept for backward compatibility) */
  --tways-bg: #2a3136;
  --tways-accent: #ff8434;
  ...

  /* New --tug-base-* overrides (surfaces) */
  --tug-base-bg-app: #2a3136;
  --tug-base-bg-canvas: #2a3136;
  --tug-base-surface-default: #3b4348;
  ...

  /* New --tug-base-* overrides (accents -- theme-specific hex values) */
  --tug-base-accent-default: #ff8434;
  --tug-base-accent-cool-default: #4bbde8;
  --tug-base-accent-positive: #73c382;
  --tug-base-accent-warning: #ffe465;
  --tug-base-accent-danger: #ff5162;
  --tug-base-accent-info: #4bbde8;
  ...

  /* New --tug-base-* overrides (workspace chrome -- fallback overrides) */
  --tug-base-card-header-bg-active: #344f5e;
  --tug-base-card-header-bg-inactive: #2a3a44;
  ...
}
```

#### Line-Height Token Note {#line-height-note}

The taxonomy defines `--tug-base-line-height-{2xs..2xl}` with pixel values (14px through 32px). This plan also defines `--tug-base-line-height-tight` (1.2) and `--tug-base-line-height-normal` (1.45), which are NOT in the taxonomy. These extra tokens exist solely for backward compatibility with the existing `--td-line-tight` / `--td-line-normal` / `--tways-line-tight` / `--tways-line-normal` unitless ratio tokens. Both sets are defined; the ratio tokens will be evaluated for removal in Phase 5d5d when consumers can migrate to the size-scale tokens.

#### Alias Chain Flattening Note {#alias-chain-note}

Several existing `--td-*` tokens reference other `--td-*` tokens rather than `--tways-*` tokens (e.g., `--td-selection-bg` uses `var(--td-accent-cool)`, `--td-icon-active` falls back to `var(--td-accent-2)`). After the rewrite in Step 4, these `--td-*` tokens point to `--tug-base-*` tokens that hold literal values rather than chaining through other `--td-*` variables. This is intentional: it makes `--tug-base-*` the single canonical layer, and the per-theme literal values in theme override files ensure correct resolution. The dynamic `var()` chains between `--td-*` tokens were an implementation detail of the old system, not a semantic contract.

#### Token Naming Convention {#token-naming}

**Table T01: Token naming grammar** {#t01-naming-grammar}

| Layer | Pattern | Example |
|-------|---------|---------|
| Base | `--tug-base-<domain>-<role>[-<emphasis>][-<state>]` | `--tug-base-fg-default`, `--tug-base-border-accent-hover` |
| Comp | `--tug-comp-<family>-<role>[-<emphasis>][-<state>]` | `--tug-comp-button-primary-bg-rest` |
| Alias | `--td-<shortname>` | `--td-bg` (alias for `--tug-base-bg-app`) |

#### Alias Mapping {#alias-mapping}

**Table T02: --td-* to --tug-base-* alias map (with Brio default hex values)** {#t02-alias-map}

Note: Brio hex values are shown for color tokens to make the mapping unambiguous. Tokens marked "(fallback)" use a `var(--tways-X, fallback)` pattern in the current `tokens.css` where `--tways-X` is NOT defined in the Brio body block -- the Brio value shown is the fallback that currently resolves. The `--tug-base-*` token must use this fallback value directly as its Brio default.

| Legacy `--td-*` | New `--tug-base-*` | Brio default value |
|---|---|---|
| `--td-bg` | `--tug-base-bg-app` | `#1c1e22` |
| `--td-bg-soft` | `--tug-base-surface-raised` | `#272a30` |
| `--td-card` | `--tug-base-card-bg` | `#2b2e35` (from `--tways-panel`) |
| `--td-card-soft` | `--tug-base-surface-sunken` | `#23262d` (from `--tways-panel-soft`) |
| `--td-surface` | `--tug-base-surface-default` | `#282b32` (from `--tways-surface-1`) |
| `--td-surface-tab` | `--tug-base-tab-bar-bg` | `#23262d` (from `--tways-surface-2`) |
| `--td-surface-control` | `--tug-base-surface-control` | `#1f2228` (from `--tways-surface-3`) |
| `--td-surface-content` | `--tug-base-surface-content` | `#191c22` (from `--tways-surface-4`) |
| `--td-canvas` | `--tug-base-bg-canvas` | `#1c1e22` (fallback: same as `--tways-bg`) |
| `--td-text` | `--tug-base-fg-default` | `#e6eaee` |
| `--td-text-soft` | `--tug-base-fg-muted` | `#bcc3cb` |
| `--td-text-inverse` | `--tug-base-fg-inverse` | `#f2f7fb` |
| `--td-accent` | `--tug-base-accent-default` | `#ff8a38` |
| `--td-accent-cool` | `--tug-base-accent-cool-default` | `#35bcff` |
| `--td-accent-1` through `--td-accent-8` | (unchanged -- direct `--tways-accent-N` refs) | -- |
| `--td-success` | `--tug-base-accent-positive` | `#72ce8f` (from `--tways-accent-5`) |
| `--td-warning` | `--tug-base-accent-warning` | `#ffe86b` (from `--tways-accent-6`) |
| `--td-danger` | `--tug-base-accent-danger` | `#ff5a72` (from `--tways-accent-4`) |
| `--td-info` | `--tug-base-accent-info` | `#35bcff` (from `--tways-accent-2`) |
| `--td-header-active` | `--tug-base-card-header-bg-active` | `#44474C` (fallback) |
| `--td-header-inactive` | `--tug-base-card-header-bg-inactive` | `#34373c` (fallback) |
| `--td-icon-active` | `--tug-base-card-header-icon-active` | `#35bcff` (fallback: `--td-accent-2`) |
| `--td-icon-inactive` | `--tug-base-card-header-icon-inactive` | `#7b828c` (fallback) |
| `--td-grid-color` | `--tug-base-canvas-grid-line` | `rgba(255, 255, 255, 0.05)` (fallback) |
| `--td-card-shadow-active` | `--tug-base-card-shadow-active` | `0 2px 8px rgba(0, 0, 0, 0.4)` (fallback) |
| `--td-card-shadow-inactive` | `--tug-base-card-shadow-inactive` | `0 1px 4px rgba(0, 0, 0, 0.2)` (fallback) |
| `--td-card-dim-overlay` | `--tug-base-card-dim-overlay` | `rgba(0, 0, 0, 0.15)` (fallback) |
| `--td-selection-bg` | `--tug-base-selection-bg` | `color-mix(in srgb, #35bcff 40%, transparent)` |
| `--td-selection-text` | `--tug-base-selection-fg` | `#e6eaee` (same as fg-default) |
| `--td-border` | `--tug-base-border-default` | `#5e656e` |
| `--td-border-soft` | `--tug-base-border-muted` | `#7b828c` |
| `--td-shadow-soft` | `--tug-base-shadow-sm` | `rgba(0, 0, 0, 0.5)` |
| `--td-depth-raise` | `--tug-base-shadow-card-active` | Compound shadow using `var(--tug-base-shadow-sm)` per [D10]; no per-theme override needed |
| `--td-space-1` through `--td-space-6` | `--tug-base-space-2xs` through `--tug-base-space-xl` | `2px`, `4px`, `6px`, `8px`, `12px`, `16px` |
| `--td-radius-xs` through `--td-radius-lg` | `--tug-base-radius-xs` through `--tug-base-radius-lg` | `2px`, `4px`, `6px`, `8px` |
| `--td-font-sans` | `--tug-base-font-family-sans` | `"IBM Plex Sans", ...` |
| `--td-font-mono` | `--tug-base-font-family-mono` | `"Hack", ...` |
| `--td-line-tight` | `--tug-base-line-height-tight` | `1.2` |
| `--td-line-normal` | `--tug-base-line-height-normal` | `1.45` |
| `--td-syntax-*` | `--tug-base-syntax-*` (1:1 mapping) | Accent-derived: hex values from `--tways-accent-*`; text-derived: `--tug-base-syntax-operator`/`-punctuation` use `var(--tug-base-fg-default)`, `-comment` uses `var(--tug-base-fg-muted)` |
| `--td-duration-*` | (unchanged -- already points to `--tug-base-motion-duration-*`) | -- |
| `--td-easing-*` | `--tug-base-motion-easing-*` | (cubic-bezier values) |
| `--td-chart-1` through `--td-chart-5` | (unchanged -- these reference `--td-accent-*` which chains through) | -- |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/styles/tug-tokens.css` | Complete `--tug-base-*` semantic taxonomy (~300 tokens) with Brio defaults |
| `tugdeck/styles/tug-comp-tokens.css` | `--tug-comp-*` tokens for four existing component families |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `--tug-base-*` (~300 tokens) | CSS custom properties | `tug-tokens.css` | Full semantic taxonomy |
| `--tug-comp-button-*` | CSS custom properties | `tug-comp-tokens.css` | Button family comp tokens |
| `--tug-comp-tab-*` | CSS custom properties | `tug-comp-tokens.css` | Tab bar family comp tokens |
| `--tug-comp-card-*` | CSS custom properties | `tug-comp-tokens.css` | Tugcard family comp tokens |
| `--tug-comp-dropdown-*` | CSS custom properties | `tug-comp-tokens.css` | Dropdown family comp tokens |
| `--td-*` (modified) | CSS custom properties | `tokens.css` | Repointed from `--tways-*` to `--tug-base-*` |
| `@import` lines (2 new) | CSS import | `globals.css` | Import tug-tokens.css and tug-comp-tokens.css |
| `--tug-base-*` overrides | CSS custom properties | `bluenote.css` | Bluenote theme overrides |
| `--tug-base-*` overrides | CSS custom properties | `harmony.css` | Harmony theme overrides |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Build verification** | Confirm `bun run build` produces no errors | Every step |
| **Token count audit** | Grep-based verification that all expected tokens are defined | After tug-tokens.css is written |
| **Alias chain verification** | Grep-based check that every `--td-*` resolves to `--tug-base-*` | After alias rewrite |
| **Visual regression** | Manual inspection of component gallery across all three themes | Final checkpoint |
| **Comp resolution check** | Grep that every `--tug-comp-*` resolves from `--tug-base-*` | After tug-comp-tokens.css is written |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Create tug-tokens.css with core visual tokens (A) {#step-1}

**Commit:** `feat: add tug-tokens.css with core visual --tug-base-* tokens (surfaces, fg, icon, border, elevation, typography, spacing, radius, stroke, icon-size)`

**References:** [D01] --tug-base-* source of truth, [D03] full taxonomy, [D04] import order, [D06] motion reference, [D10] compound shadows, Spec S01, Table T01, (#context, #token-naming, #assumptions)

**Artifacts:**
- New file `tugdeck/styles/tug-tokens.css` with sections A (core visual) of the taxonomy
- New `@import` line in `tugdeck/src/globals.css`

**Tasks:**
- [ ] Create `tugdeck/styles/tug-tokens.css` with `body {}` block
- [ ] Define all surface tokens (`--tug-base-bg-app`, `--tug-base-bg-canvas`, `--tug-base-surface-*`) with Brio values sourced from current `--tways-*` palette
- [ ] Define all foreground/text tokens (`--tug-base-fg-*`) with Brio values
- [ ] Define all icon tokens (`--tug-base-icon-default`, `--tug-base-icon-muted`, `--tug-base-icon-disabled`, `--tug-base-icon-active`, `--tug-base-icon-onAccent`)
- [ ] Define all border/divider/focus tokens with Brio values
- [ ] Define all elevation/overlay tokens (shadows, overlays). For `--tug-base-shadow-sm`, use the Brio value `rgba(0, 0, 0, 0.5)` (from `--tways-shadow-soft`). For compound shadow tokens like `--tug-base-shadow-card-active` (mapped from `--tways-depth-raise`), use expressions containing `var(--tug-base-shadow-sm)` per [D10] to preserve dynamic resolution across themes.
- [ ] Define all typography tokens (font families, sizes, line heights) as plain values. This includes TWO sets of line-height tokens: (a) the taxonomy's size-scale tokens `--tug-base-line-height-{2xs..2xl}` with pixel values (14px through 32px) per the Revised Semantic Taxonomy, and (b) backward-compatibility ratio tokens `--tug-base-line-height-tight: 1.2` and `--tug-base-line-height-normal: 1.45` which map to the existing `--tways-line-tight`/`--tways-line-normal` unitless ratio values. The size-scale tokens are the canonical set; the ratio tokens exist solely for backward compatibility with `--td-line-tight`/`--td-line-normal` and will be evaluated for removal in Phase 5d5d.
- [ ] Define all spacing tokens as plain values (2px through 24px)
- [ ] Define all radius tokens as plain values
- [ ] Define all stroke and icon-size tokens as plain values
- [ ] Define `--tug-base-motion-duration-instant: calc(0ms * var(--tug-timing))` -- this token is in the taxonomy but was not included in Phase 5d5b's four duration tokens. Define it in `tug-tokens.css` (not a redefinition since it does not exist in `tokens.css`)
- [ ] Define motion easing tokens (`--tug-base-motion-easing-standard`, `-enter`, `-exit`) -- do NOT redefine the four existing duration tokens (fast/moderate/slow/glacial)
- [ ] Define motion pattern tokens (`--tug-base-motion-pattern-*`) as CSS shorthand values
- [ ] Add comment block referencing existing `--tug-base-motion-duration-{fast,moderate,slow,glacial}` tokens in `tokens.css`
- [ ] Add `@import "../styles/tug-tokens.css";` to `globals.css` after the `tokens.css` import

**Tests:**
- [ ] `bun run build` produces no errors
- [ ] `grep -c "tug-base-" styles/tug-tokens.css` confirms at least 80 core visual tokens

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` succeeds
- [ ] `grep -c "tug-base-" styles/tug-tokens.css` reports at least 80 tokens (core visual subset)

---

#### Step 2: Add accent, selection, workspace chrome tokens (B-D) {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add accent, selection, and workspace chrome --tug-base-* tokens`

**References:** [D01] --tug-base-* source of truth, [D03] full taxonomy, [D08] literal hex values, Spec S01, Table T01, Table T02, (#token-naming, #strategy)

**Artifacts:**
- Extended `tugdeck/styles/tug-tokens.css` with sections B (accent), C (selection/highlight), D (workspace chrome)

**Tasks:**
- [ ] Define accent tokens with literal Brio hex values: `--tug-base-accent-default: #ff8a38` (from `--tways-accent`), `--tug-base-accent-strong: #f17627` (from `--tways-accent-strong`), `--tug-base-accent-cool-default: #35bcff` (from `--tways-accent-cool`). Do NOT use `var(--tug-orange)` or any HVV palette reference per [D08].
- [ ] Define status accent tokens with literal Brio hex values: `--tug-base-accent-positive: #72ce8f` (from `--tways-accent-5`), `--tug-base-accent-warning: #ffe86b` (from `--tways-accent-6`), `--tug-base-accent-danger: #ff5a72` (from `--tways-accent-4`), `--tug-base-accent-info: #35bcff` (from `--tways-accent-2`). Note: `--tways-success`/`--tways-warning`/`--tways-danger` are standalone palette tokens with DIFFERENT hex values -- use the `--tways-accent-N` values that `--td-success`/etc. actually resolve to.
- [ ] Define accent-derived interaction tokens (`--tug-base-accent-bg-subtle`, `-bg-emphasis`, `-border`, `-border-hover`, `-underline-active`, `-guide`, `-flash`) with values derived from the accent hex values
- [ ] Define selection/highlight/preview tokens
- [ ] Define card tokens (`--tug-base-card-bg`: `#2b2e35`, `-border`: `#5e656e`, shadow tokens)
- [ ] Define card header tokens using Brio fallback values where `--tways-*` variables are not defined in Brio body block: `--tug-base-card-header-bg-active: #44474C` (fallback), `--tug-base-card-header-bg-inactive: #34373c` (fallback), `--tug-base-card-header-icon-active: #35bcff` (fallback, same as accent-2), `--tug-base-card-header-icon-inactive: #7b828c` (fallback)
- [ ] Define canvas/grid tokens using Brio fallback values: `--tug-base-canvas-grid-line: rgba(255, 255, 255, 0.05)` (fallback), `--tug-base-card-shadow-active: 0 2px 8px rgba(0, 0, 0, 0.4)` (fallback), `--tug-base-card-shadow-inactive: 0 1px 4px rgba(0, 0, 0, 0.2)` (fallback), `--tug-base-card-dim-overlay: rgba(0, 0, 0, 0.15)` (fallback)
- [ ] Define tab bar tokens (all 25 tab-related tokens from taxonomy) with Brio values
- [ ] Define dock/canvas/snap tokens
- [ ] Define snap set tokens

**Tests:**
- [ ] `bun run build` produces no errors
- [ ] `grep -c "tug-base-" styles/tug-tokens.css` confirms at least 180 tokens (core + accent + chrome)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` succeeds
- [ ] `grep -c "tug-base-" styles/tug-tokens.css` reports at least 180 tokens

---

#### Step 3: Add controls, menus, feedback, data, domain tokens (E-I) {#step-3}

**Depends on:** #step-2

**Commit:** `feat: add controls, menus, feedback, data display, and domain --tug-base-* tokens`

**References:** [D03] full taxonomy, [D08] literal hex values, [D09] text-derived syntax tokens, [Q01] best-guess values, Spec S01, Table T01, (#token-naming, #assumptions)

**Artifacts:**
- Extended `tugdeck/styles/tug-tokens.css` with sections E through I, completing the full taxonomy

**Tasks:**
- [ ] Define disabled-control tokens (`--tug-base-control-disabled-*`)
- [ ] Define generic action tokens (primary, secondary, ghost, destructive variants with bg/fg/border states)
- [ ] Define generic field tokens (bg, fg, border, placeholder, helper, label states)
- [ ] Define toggle/range tokens
- [ ] Define menu/popover/tooltip tokens
- [ ] Define dialog/sheet/toast/alert tokens
- [ ] Define badge/status/progress/skeleton/banner/kbd tokens
- [ ] Define scrollbar/separator/avatar tokens
- [ ] Define table/list tokens with best-guess derivations
- [ ] Define stat/trend tokens with best-guess derivations
- [ ] Define chart series tokens with literal Brio hex values: `--tug-base-chart-series-warm: #ff8a38`, `--tug-base-chart-series-cool: #35bcff`, etc. (matching existing `--tways-accent-*` hex values per [D08])
- [ ] Define gauge tokens with best-guess derivations
- [ ] Define syntax tokens: accent-derived tokens use literal Brio hex values (e.g., `--tug-base-syntax-keyword: #35bcff` from `--tways-accent-2`, `--tug-base-syntax-string: #ffa37a` from `--tways-accent-8`). Three tokens that derive from text colors use `var()` references to maintain the semantic link: `--tug-base-syntax-operator: var(--tug-base-fg-default)`, `--tug-base-syntax-punctuation: var(--tug-base-fg-default)`, `--tug-base-syntax-comment: var(--tug-base-fg-muted)`. This avoids needing per-theme overrides for these three tokens since they inherit from the already-overridden fg tokens.
- [ ] Define terminal tokens (bg, fg, cursor, ANSI colors) with literal hex values derived from existing palette
- [ ] Define chat/codeBlock tokens with best-guess derivations
- [ ] Define tree/file-status/diff tokens
- [ ] Define feed/workflow tokens
- [ ] Define inspector/dev-overlay tokens with best-guess derivations

**Tests:**
- [ ] `bun run build` produces no errors
- [ ] `grep -c "tug-base-" styles/tug-tokens.css` confirms full taxonomy (>= 280 tokens)
- [ ] No HVV palette var() references in tug-tokens.css: `grep "var(--tug-orange\|var(--tug-cyan\|var(--tug-green" styles/tug-tokens.css` returns zero matches (per [D08])

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` succeeds
- [ ] `grep -c "tug-base-" styles/tug-tokens.css` reports at least 280 tokens (full taxonomy)

---

#### Step 4: Repoint --td-* aliases to --tug-base-* {#step-4}

**Depends on:** #step-3

**Commit:** `refactor: repoint --td-* semantic tokens to --tug-base-* aliases`

**References:** [D01] --tug-base-* source of truth, [D05] backward aliases, Spec S03, Table T02, Risk R01, (#alias-mapping, #constraints)

**Artifacts:**
- Modified `tugdeck/styles/tokens.css` -- Tier 2 semantic tokens repointed

**Tasks:**
- [ ] Update every `--td-*` declaration in the Tier 2 section of `tokens.css` from `var(--tways-*)` to the corresponding `var(--tug-base-*)` per Table T02
- [ ] Update `--td-easing-*` tokens to reference `--tug-base-motion-easing-*`
- [ ] Leave `--td-duration-*` unchanged (already points to `--tug-base-motion-duration-*`)
- [ ] Leave `--td-accent-1` through `--td-accent-8` unchanged (direct palette references, not semantic)
- [ ] Leave `--td-chart-*` unchanged (they reference `--td-accent-*` which chains through)
- [ ] Leave all shadcn bridge tokens (`--background`, `--foreground`, etc.) unchanged
- [ ] Leave all `--tways-*` Tier 1 palette declarations unchanged
- [ ] Add a comment block documenting this is the backward-compatibility alias section
- [ ] Verify that `--td-line-tight` and `--td-line-normal` are repointed to `--tug-base-line-height-tight` and `--tug-base-line-height-normal` (these base tokens are defined in Step 1 as part of the typography section)

**Tests:**
- [ ] `bun run build` produces no errors
- [ ] `grep "var(--tug-base-" styles/tokens.css | wc -l` shows alias count matching number of repointed tokens
- [ ] No `--td-*` surface/text/border token still references `var(--tways-*)`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` succeeds
- [ ] `grep "var(--tug-base-" styles/tokens.css | wc -l` shows substantial alias count
- [ ] Visual inspection: open component gallery in Brio theme -- no visual change

---

#### Step 5: Add --tug-base-* overrides to theme files {#step-5}

**Depends on:** #step-4

**Commit:** `feat: add --tug-base-* overrides to Bluenote and Harmony theme files`

**References:** [D01] --tug-base-* source of truth, [D07] theme overrides, [D08] literal hex values, Spec S04, Risk R01, (#constraints, #strategy)

**Artifacts:**
- Modified `tugdeck/styles/bluenote.css` with `--tug-base-*` overrides
- Modified `tugdeck/styles/harmony.css` with `--tug-base-*` overrides

**Tasks:**
- [ ] Add `--tug-base-*` surface/background overrides to `bluenote.css` matching existing `--tways-*` values (e.g., `--tug-base-bg-app: #2a3136`, `--tug-base-surface-default: #3b4348`)
- [ ] Add `--tug-base-*` foreground/text overrides to `bluenote.css` (e.g., `--tug-base-fg-default: #dde4e8`, `--tug-base-fg-muted: #a8b6bf`)
- [ ] Add `--tug-base-*` accent overrides to `bluenote.css` with Bluenote's theme-specific hex values -- each theme has DIFFERENT accent colors: `--tug-base-accent-default: #ff8434` (Bluenote), `--tug-base-accent-cool-default: #4bbde8`, `--tug-base-accent-positive: #73c382` (from `--tways-accent-5`), `--tug-base-accent-warning: #ffe465` (from `--tways-accent-6`), `--tug-base-accent-danger: #ff5162` (from `--tways-accent-4`), `--tug-base-accent-info: #4bbde8` (from `--tways-accent-2`)
- [ ] Add `--tug-base-*` border/shadow overrides to `bluenote.css`
- [ ] Add `--tug-base-*` workspace chrome overrides to `bluenote.css` (card-header, icon, grid, card-shadow, card-dim using Bluenote's `--tways-*` overrides)
- [ ] Add `--tug-base-selection-bg` override to `bluenote.css` using Bluenote's accent-cool hex in the `color-mix()` expression: `color-mix(in srgb, #4bbde8 40%, transparent)` (since `--td-selection-bg` currently uses `var(--td-accent-cool)` which resolves to the theme-specific accent-2 value)
- [ ] Add `--tug-base-syntax-*` overrides to `bluenote.css` for all accent-derived syntax tokens (e.g., `--tug-base-syntax-keyword: #4bbde8` from Bluenote accent-2, `--tug-base-syntax-string: #ff9a72` from accent-8, `--tug-base-syntax-number: #73c382` from accent-5, `--tug-base-syntax-function: #ffe465` from accent-6, etc.). Note: `--tug-base-syntax-operator`, `--tug-base-syntax-punctuation`, and `--tug-base-syntax-comment` do NOT need per-theme overrides because they use `var(--tug-base-fg-default)` and `var(--tug-base-fg-muted)` references that inherit from the already-overridden fg tokens.
- [ ] Add `--tug-base-card-header-icon-active` override to `bluenote.css` (this token defaults to accent-2, which differs per theme)
- [ ] Repeat all the above for `harmony.css` with Harmony's theme-specific values. IMPORTANT: Harmony is a LIGHT theme with radically different values from Brio for virtually all color tokens. For every `--tways-*` token defined in `harmony.css`, create a corresponding `--tug-base-*` override. This includes but is not limited to: surfaces (`--tug-base-bg-app: #3f474c`, `--tug-base-bg-canvas: #b0ab9f`, `--tug-base-surface-default: #f4f1ea`, `--tug-base-surface-raised: #4c555a`, `--tug-base-surface-sunken: #c6c2b8`, `--tug-base-surface-control: #e4ded1`, `--tug-base-surface-content: #fcf9f2`), foreground (`--tug-base-fg-default: #26333b`, `--tug-base-fg-muted: #41525c`, `--tug-base-fg-inverse: #f4f7f8`), accents (`--tug-base-accent-default: #ff7f2a`, `--tug-base-accent-cool-default: #42b8e6`, `--tug-base-accent-positive: #68bf78`, `--tug-base-accent-warning: #ffe15a`, `--tug-base-accent-danger: #ff4458`, `--tug-base-accent-info: #42b8e6`), borders (`--tug-base-border-default: #7f796a`, `--tug-base-border-muted: #a29b8a`), selection (`--tug-base-selection-bg: color-mix(in srgb, #42b8e6 40%, transparent)`), all accent-derived syntax tokens, workspace chrome overrides (`--tug-base-card-header-bg-active: #d4b888`, `--tug-base-card-header-bg-inactive: #c8c0b0`, `--tug-base-card-header-icon-active: #42b8e6`, `--tug-base-card-header-icon-inactive: #a29b8a`, `--tug-base-canvas-grid-line: rgba(0, 0, 0, 0.06)`, `--tug-base-card-shadow-active: 0 2px 8px rgba(0, 0, 0, 0.18)`, `--tug-base-card-shadow-inactive: 0 1px 4px rgba(0, 0, 0, 0.09)`, `--tug-base-card-dim-overlay: rgba(0, 0, 0, 0.08)`), `--tug-base-shadow-sm: rgba(0, 0, 0, 0.24)`, etc.
- [ ] Audit: for every `--tug-base-*` token whose Brio default is derived from an accent palette value (`--tways-accent-*`) OR from a text/border value that differs across themes, verify that theme overrides exist in both Bluenote and Harmony files with the correct theme-specific hex values. Tokens that do NOT need per-theme overrides: (a) tokens using `var(--tug-base-fg-*)` references like syntax-operator/punctuation/comment per [D09], (b) compound shadow tokens using `var(--tug-base-shadow-sm)` per [D10] -- they inherit dynamic resolution from the overridden shadow-sm token.
- [ ] Keep existing `--tways-*` overrides in both files (removed in Phase 5d5d)

**Tests:**
- [ ] `bun run build` produces no errors
- [ ] `grep -c "tug-base-" styles/bluenote.css` confirms Bluenote overrides present
- [ ] `grep -c "tug-base-" styles/harmony.css` confirms Harmony overrides present

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` succeeds
- [ ] Visual inspection: switch to Bluenote theme -- no visual change
- [ ] Visual inspection: switch to Harmony theme -- no visual change

---

#### Step 6: Create tug-comp-tokens.css for existing component families {#step-6}

**Depends on:** #step-5

**Commit:** `feat: add tug-comp-tokens.css with --tug-comp-* tokens for button, tab-bar, tugcard, dropdown`

**References:** [D02] comp scope, Spec S02, Table T01, (#token-naming, #strategy)

**Artifacts:**
- New file `tugdeck/styles/tug-comp-tokens.css`
- New `@import` line in `tugdeck/src/globals.css`

**Tasks:**
- [ ] Create `tugdeck/styles/tug-comp-tokens.css` with `body {}` block
- [ ] Define `--tug-comp-button-*` tokens: primary/secondary/ghost/destructive variants for bg-rest, bg-hover, bg-active, fg, border -- each resolving from `--tug-base-action-*` or `--tug-base-surface-*`
- [ ] Define `--tug-comp-tab-*` tokens: tab-bar-bg, tab-bg-rest/hover/active, tab-fg-rest/active, close-bg/fg-hover, underline-active, badge-bg/fg, overflow-btn, add-btn -- resolving from `--tug-base-tab-*`
- [ ] Define `--tug-comp-card-*` tokens: card-bg, card-border, header-bg-active/inactive, header-fg, icon-active/inactive, close-btn, content-bg, accessory-bg/border, shadow-active/inactive, dim-overlay -- resolving from `--tug-base-card-*` and `--tug-base-surface-*`
- [ ] Define `--tug-comp-dropdown-*` tokens: bg, border, shadow, item-bg-hover, item-fg, item-fg-disabled -- resolving from `--tug-base-menu-*` and `--tug-base-surface-*`
- [ ] Add `@import "../styles/tug-comp-tokens.css";` to `globals.css` after the `tug-tokens.css` import

**Tests:**
- [ ] `bun run build` produces no errors
- [ ] `grep "var(--tug-base-" styles/tug-comp-tokens.css | wc -l` confirms all comp tokens resolve from base
- [ ] No `--tug-comp-*` token references a raw color value (hex, rgb, hsl) directly

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` succeeds
- [ ] `grep "var(--tug-base-" styles/tug-comp-tokens.css | wc -l` confirms all comp tokens resolve from base
- [ ] No `--tug-comp-*` token references a raw value -- all go through `--tug-base-*`

---

#### Step 7: Integration Checkpoint -- Full Verification {#step-7}

**Depends on:** #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] --tug-base-* source of truth, [D05] backward aliases, [D07] theme overrides, Risk R01, Risk R02, (#success-criteria, #constraints)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-6 are complete and consistent
- [ ] Verify the full alias chain: `--background` -> `--td-bg` -> `--tug-base-bg-app` -> `#1c1e22` (Brio)
- [ ] Verify no `--tug-base-motion-duration-*` tokens are redefined in `tug-tokens.css`

**Tests:**
- [ ] Token count audit: `grep -c "tug-base-" styles/tug-tokens.css` >= 280
- [ ] Comp resolution: `grep "var(--tug-base-" styles/tug-comp-tokens.css` shows all comp tokens resolve from base
- [ ] Alias completeness: every `--td-*` in tokens.css (except accent-1..8, chart-*, duration-*) references `--tug-base-*`
- [ ] No visual regression: inspect component gallery in Brio, Bluenote, Harmony -- all identical to before

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` succeeds with no errors
- [ ] Visual inspection confirms zero regression across all three themes

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The `--tug-base-*` and `--tug-comp-*` token layers are fully defined with backward-compatibility aliases ensuring zero visual change, ready for consumer migration in Phase 5d5d.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugdeck/styles/tug-tokens.css` exists with ~300 `--tug-base-*` token declarations (verify: grep count)
- [ ] `tugdeck/styles/tug-comp-tokens.css` exists with `--tug-comp-*` tokens for button, tab-bar, tugcard, dropdown families (verify: grep count)
- [ ] Both files are imported in `globals.css` in correct order after `tokens.css`
- [ ] All `--td-*` tokens in `tokens.css` resolve to `--tug-base-*` (verify: grep)
- [ ] Bluenote and Harmony theme files contain matching `--tug-base-*` overrides
- [ ] `bun run build` succeeds with no errors
- [ ] Zero visual regression across Brio, Bluenote, Harmony themes (manual inspection)

**Acceptance tests:**
- [ ] `grep -c "tug-base-" tugdeck/styles/tug-tokens.css` >= 280
- [ ] `grep -c "tug-comp-" tugdeck/styles/tug-comp-tokens.css` >= 30
- [ ] `cd tugdeck && bun run build` exits 0

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5d5d: Migrate all CSS/TS consumers from `--td-*`/`--tways-*` to `--tug-base-*`/`--tug-comp-*`
- [ ] Phase 5d5d: Wire accent/chart/syntax tokens to HVV palette `var()` references (with visual tuning)
- [ ] Phase 5d5d: Remove legacy `--td-*`, `--tways-*` tokens and aliases
- [ ] Phase 5d5d: Cut over shadcn bridge tokens to point directly at `--tug-base-*`
- [ ] Phase 5d5e: Cascade Inspector showing token resolution chains

| Checkpoint | Verification |
|------------|--------------|
| Token taxonomy complete | `grep -c "tug-base-" tug-tokens.css` >= 280 |
| Comp tokens complete | `grep -c "tug-comp-" tug-comp-tokens.css` >= 30 |
| Alias chain correct | All `--td-*` resolve to `--tug-base-*` |
| Build passes | `bun run build` exits 0 |
| Zero visual regression | Manual inspection of all three themes |
