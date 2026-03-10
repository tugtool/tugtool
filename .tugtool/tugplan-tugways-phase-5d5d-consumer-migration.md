<!-- tugplan-skeleton v2 -->

## Consumer Migration to Canonical Token Naming (Phase 5d5d) {#phase-5d5d}

**Purpose:** Migrate all CSS and TypeScript consumers in tugdeck from legacy `--td-*`/`--tways-*` token naming to the canonical `--tug-base-*`/`--tug-comp-*` naming established in Phase 5d5c, remove all backward-compatibility aliases and Tier 1 palette blocks, cut over the shadcn bridge, and add CI enforcement to prevent regression.

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

Phase 5d5c introduced the `--tug-base-*` and `--tug-comp-*` token layers with full semantic coverage, but left all existing consumers pointing at the legacy `--td-*` semantic tokens. The `--td-*` tokens now exist solely as backward-compatibility aliases (`--td-bg: var(--tug-base-bg-app)`, etc.) in `tokens.css`. Similarly, the `--tways-*` Tier 1 palette blocks remain in `tokens.css`, `bluenote.css`, and `harmony.css` despite the canonical values now living in `tug-tokens.css` as literal hex in `--tug-base-*`.

The legacy aliases add ~145 `--td-*` declarations and ~67 `--tways-*` declarations in `tokens.css` alone, plus ~40 `--tways-*` overrides each in `bluenote.css` and `harmony.css`. This indirection makes the token system harder to understand and maintain. Completing the migration removes the indirection, simplifies the theme files, and establishes `--tug-base-*` as the single source of truth consumed directly by all code.

#### Strategy {#strategy}

- Migrate CSS consumers first (7 component CSS files + `chrome.css` + `globals.css`), working file-by-file with visual verification after each batch.
- Migrate TypeScript consumers second (~12 files with inline `--td-*` string references), including doc comments, inline styles, and test assertions.
- Cut over the shadcn bridge: remove legacy short-name aliases (`--background`, `--foreground`, `--primary`, etc.) from `tokens.css` and update the Tailwind `@theme` block in `globals.css` to reference `--tug-base-*` directly.
- Delete all `--tways-*` Tier 1 palette blocks from `tokens.css`, `bluenote.css`, and `harmony.css`; refactor theme files so `bluenote.css` and `harmony.css` override `--tug-base-*` tokens directly (no `--tways-*` intermediary).
- Remove all backward-compatibility `--td-*` aliases from `tokens.css`.
- Add a grep-based CI enforcement script that fails on any `--td-*`, `--tways-*`, or legacy short-name alias found in source.
- Per-component zoom is out of scope for this phase (noted as future option only).

#### Success Criteria (Measurable) {#success-criteria}

- Zero occurrences of `--td-` in any CSS or TypeScript file under `tugdeck/src/` and `tugdeck/styles/` (verify: `grep -r '\-\-td-' tugdeck/src tugdeck/styles` returns no matches)
- Zero occurrences of `--tways-` in any file under `tugdeck/` (verify: `grep -r '\-\-tways-' tugdeck/` returns no matches)
- Zero occurrences of legacy short-name aliases (`--background`, `--foreground`, `--primary`, `--secondary`, `--accent`, `--destructive`, `--muted`, `--popover`, `--ring`, `--input`, `--chart-1` through `--chart-5`, `--syntax-keyword` through `--syntax-attribute`) as CSS custom property definitions in `tokens.css` (verify: grep)
- Tailwind `@theme` block references `--tug-base-*` tokens directly (verify: inspect `globals.css`)
- `bun run build` succeeds with no errors (verify: build command)
- CI enforcement script passes (verify: `bash tugdeck/scripts/check-legacy-tokens.sh` exits 0)
- Zero visual change across all three themes: Brio, Bluenote, Harmony (verify: manual visual inspection of component gallery)

#### Scope {#scope}

1. Migrate ~205 `--td-*` references across 7 component CSS files to `--tug-base-*` or `--tug-comp-*`
2. Migrate ~12 `--td-*` references in `chrome.css` to `--tug-base-*`
3. Migrate ~4 `--td-*` references in `globals.css` body rules to `--tug-base-*`
4. Migrate ~29 `--td-*` string references across ~12 TypeScript files to `--tug-base-*`
5. Cut over shadcn bridge: remove short-name aliases from `tokens.css`, update `@theme` block in `globals.css`
6. Delete `--tways-*` Tier 1 palette blocks from `tokens.css`, `bluenote.css`, `harmony.css`
7. Refactor `bluenote.css` and `harmony.css` to override `--tug-base-*` directly (remove `--tways-*` intermediary)
8. Remove all backward-compatibility `--td-*` aliases from `tokens.css`
9. Add `tugdeck/scripts/check-legacy-tokens.sh` CI enforcement script
10. Clean up `tokens.css` file header comments and doc references to removed tiers

#### Non-goals (Explicitly out of scope) {#non-goals}

- Per-component zoom overrides (`--tug-comp-*-zoom`) -- future option only
- CITA palette `var()` wiring (tokens remain literal hex; CITA wiring is a separate future phase)
- Adding new tokens or expanding the semantic taxonomy
- Migrating shadcn `components/ui/*.tsx` internals (they consume Tailwind utilities, not `--td-*` directly)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5d5c (Token Architecture): COMPLETE -- `--tug-base-*` and `--tug-comp-*` tokens fully defined in `tug-tokens.css` and `tug-comp-tokens.css`
- Phase 5d5b (Scale & Timing): COMPLETE -- motion duration tokens in `tokens.css`
- Phase 5d5a (CITA Palette Engine): COMPLETE -- CITA palette available but not consumed in this phase

#### Constraints {#constraints}

- Zero visual regression: every pixel must look identical before and after across all three themes
- `tug-tokens.css` import must remain after `tokens.css` in `globals.css`
- `tug-comp-tokens.css` import must remain after `tug-tokens.css`
- The Shiki CSS variable bridge tokens (`--syntax-foreground`, `--syntax-background`, `--syntax-token-*`) must be preserved -- they are an external contract consumed by the Shiki code highlighter
- Motion duration tokens (`--tug-base-motion-duration-*`) remain defined in `tokens.css` where the `calc()` expressions reference `--tug-timing`

#### Assumptions {#assumptions}

- The `components/ui/*.tsx` shadcn files contain no direct `--td-*`/`--tways-*` references and do not need CSS edits -- only the Tailwind `@theme` bridge in `globals.css` needs updating.
- No visual regression is expected: `tug-tokens.css` already holds the canonical `--tug-base-*` values as literal hex, and the current `--td-*` aliases in `tokens.css` are `var()` indirections to those same values.
- The CI enforcement script will grep the `tugdeck/src` and `tugdeck/styles` source trees for `--td-`, `--tways-`, and the legacy short alias names, failing on any match found outside migration documentation.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses the standard conventions from the skeleton: explicit anchors on all cited headings, kebab-case anchor names, stable labels for decisions/specs/tables/lists/risks.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Shiki bridge token placement after cleanup (DECIDED) {#q01-shiki-bridge-placement}

**Question:** After removing `--td-*` aliases from `tokens.css`, where should the Shiki CSS variable bridge tokens (`--syntax-foreground`, `--syntax-background`, `--syntax-token-*`) be defined?

**Why it matters:** Shiki expects specific CSS variable names. If we remove them or break the chain, code syntax highlighting breaks.

**Options (if known):**
- Keep them in `tokens.css`, rewired to reference `--tug-base-*` directly instead of `--td-*`
- Move them to a dedicated `shiki-bridge.css` file

**Plan to resolve:** Minimal change -- keep in `tokens.css`, update references from `--td-syntax-*` to `--tug-base-syntax-*`.

**Resolution:** DECIDED (see [D03])

#### [Q02] Chart token aliases after --td-* removal (DECIDED) {#q02-chart-token-aliases}

**Question:** The `--td-chart-1` through `--td-chart-5` tokens currently reference `--td-accent-N` aliases. After removing `--td-*`, how should chart tokens resolve?

**Why it matters:** The `--chart-N` aliases are documented as a runtime contract in `tokens.css` (though no `getCSSToken` call currently exists in source). The resolution chain must remain valid for future consumers.

**Options (if known):**
- Wire `--chart-N` legacy aliases directly to `--tug-base-chart-series-*` tokens
- Remove `--chart-N` aliases entirely and update stats-card.ts

**Plan to resolve:** The `--tug-base-chart-series-*` tokens already exist. Wire the `--chart-N` short aliases directly to them, then migrate stats-card.ts consumers in the TypeScript step.

**Resolution:** DECIDED (see [D04])

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Visual regression from incorrect token mapping | high | low | Each step has visual checkpoint; `--tug-base-*` values are identical hex to current resolved values | Any visual diff spotted in gallery inspection |
| Broken Tailwind utilities after shadcn bridge cutover | med | low | Build check + visual inspection of shadcn components (button, dropdown, dialog) | `bun run build` failure or missing Tailwind utility styles |
| Runtime token resolution failure in TypeScript | med | low | Inline style fallback values preserved where they exist; test suite covers mutation-model hooks | Test failures in mutation-model-demo tests |

**Risk R01: Visual Regression from Token Mapping Errors** {#r01-visual-regression}

- **Risk:** A `--td-*` token maps to an incorrect `--tug-base-*` token, causing a subtle color or spacing change.
- **Mitigation:**
  - The mapping table (Table T01) is derived mechanically from the existing alias definitions in `tokens.css`
  - Each CSS migration step includes visual checkpoint against component gallery
  - The final integration checkpoint verifies all three themes
- **Residual risk:** Tokens used only in rare UI states (e.g., selection, drag feedback) may not be visually verified until those interactions are exercised.

**Risk R02: Broken shadcn Component Styling** {#r02-shadcn-bridge-break}

- **Risk:** Removing the short-name aliases (`--background`, `--foreground`, etc.) breaks shadcn component styling if any component references them outside the Tailwind utility path.
- **Mitigation:**
  - Grep all `components/ui/*.tsx` files for direct CSS variable references before removing aliases
  - The `@theme` block update ensures Tailwind utilities resolve correctly
  - Build check catches any unresolved references
- **Residual risk:** Runtime-only CSS variable lookups in shadcn components could fail silently.

---

### Design Decisions {#design-decisions}

#### [D01] Direct replacement: --td-* to --tug-base-* in consumer CSS (DECIDED) {#d01-direct-replacement}

**Decision:** Replace every `var(--td-*)` reference in component CSS files with the corresponding `var(--tug-base-*)` or `var(--tug-comp-*)` token, using the mapping established by the backward-compatibility aliases in `tokens.css`.

**Rationale:**
- The aliases already define the exact mapping (`--td-bg: var(--tug-base-bg-app)` means `--td-bg` -> `--tug-base-bg-app`)
- Direct replacement is mechanical and verifiable
- Using `--tug-comp-*` where component tokens exist gives components their own override surface

**Implications:**
- Component CSS files reference `--tug-base-*` directly (or `--tug-comp-*` for the four families with component tokens)
- No intermediate alias layer remains after migration

#### [D02] Delete --tways-* palette blocks entirely (DECIDED) {#d02-delete-tways-palette}

**Decision:** Delete all `--tways-*` CSS custom property declarations from `tokens.css`, `bluenote.css`, and `harmony.css`. Refactor `bluenote.css` and `harmony.css` so they override `--tug-base-*` tokens directly with theme-specific hex values.

**Rationale:**
- `bluenote.css` and `harmony.css` already have `--tug-base-*` overrides (added in Phase 5d5c) for all tokens that differ from Brio defaults
- The `--tways-*` palette blocks in these files are now fully redundant
- Removing them simplifies theme files from ~90 lines of `--tways-*` + `--tug-base-*` to just `--tug-base-*`

**Implications:**
- `tokens.css` body block loses all `--tways-*` declarations (~67 properties)
- `bluenote.css` loses its `--tways-*` block (~42 properties)
- `harmony.css` loses its `--tways-*` block (~44 properties plus `--tways-canvas`, `--tways-header-*`, etc.)
- Any remaining `var(--tways-*)` references in `--td-*` aliases (e.g., `--td-accent-1: var(--tways-accent-1)`) must be resolved before the `--tways-*` declarations are deleted

#### [D03] Shiki bridge tokens remain in tokens.css, rewired to --tug-base-* (DECIDED) {#d03-shiki-bridge}

**Decision:** Keep the Shiki CSS variable bridge tokens (`--syntax-foreground`, `--syntax-background`, `--syntax-token-*`) in `tokens.css`, but rewire them from `var(--td-syntax-*)` to `var(--tug-base-syntax-*)` and from `var(--td-text)` / `var(--td-surface-control)` to their `--tug-base-*` equivalents.

**Rationale:**
- Shiki expects these exact variable names -- they are an external contract
- Moving to a separate file adds complexity with no benefit
- The rewiring is a simple find-and-replace within the same file

**Implications:**
- `tokens.css` retains a small "Shiki CSS variable bridge" section after all other legacy tokens are removed
- The bridge tokens are the only non-`--tug-base-*` custom properties remaining in `tokens.css`

#### [D04] Chart and syntax legacy aliases wire directly to --tug-base-* (DECIDED) {#d04-chart-syntax-aliases}

**Decision:** The `--chart-N` legacy aliases (consumed by `stats-card.ts` via `getCSSToken()`) will be rewired from `var(--td-chart-N)` to `var(--tug-base-chart-series-*)` directly. Similarly, `--syntax-*` legacy aliases will point to `--tug-base-syntax-*`.

**Rationale:**
- Removes the `--td-*` intermediary from the resolution chain
- `--tug-base-chart-series-*` tokens already exist with correct per-theme values

**Implications:**
- `--chart-1: var(--tug-base-chart-series-verdant)` (was `--td-chart-1` -> `--td-accent-5` -> `--tways-accent-5`)
- The legacy `--chart-N` and `--syntax-*` aliases remain as runtime contracts until stats-card.ts is rebuilt

#### [D05] shadcn bridge cutover: @theme references --tug-base-* directly (DECIDED) {#d05-shadcn-bridge-cutover}

**Decision:** Remove all legacy short-name alias definitions (`--background`, `--foreground`, `--primary`, `--secondary`, `--accent`, `--destructive`, `--muted`, `--popover`, `--ring`, `--input`, `--border`, `--radius`, etc.) from `tokens.css`. Update the Tailwind `@theme` block in `globals.css` to reference `--tug-base-*` tokens directly.

**Rationale:**
- The short-name aliases are an extra indirection layer from the original shadcn/ui migration
- Tailwind v4's `@theme` block can reference any CSS variable -- it does not require specific names
- Direct references are clearer and shorter to resolve at runtime

**Implications:**
- `--color-background: var(--tug-base-bg-app)` instead of `var(--background)`
- `--color-primary: var(--tug-base-accent-default)` instead of `var(--primary)`
- All 30+ short-name alias definitions removed from `tokens.css`
- shadcn components that use Tailwind utilities (`bg-background`, `text-foreground`, etc.) continue to work via the `@theme` block

#### [D06] CI enforcement via grep-based shell script (DECIDED) {#d06-ci-enforcement}

**Decision:** Add a `tugdeck/scripts/check-legacy-tokens.sh` shell script that greps `tugdeck/src/` and `tugdeck/styles/` for `--td-`, `--tways-`, and a defined list of legacy short-name aliases. The script exits non-zero if any match is found, excluding the enforcement script itself and any explicitly allowlisted patterns (e.g., the Shiki bridge section header comment).

**Rationale:**
- Grep-based enforcement is simple, fast, and requires no build tooling
- Catches accidental reintroduction of legacy tokens in new code
- The allowlist keeps the script from false-positiving on documentation comments

**Implications:**
- The script must be run as part of CI (add to CI pipeline configuration)
- Allowlist patterns are maintained in the script itself

#### [D07] Preserve motion duration tokens in tokens.css (DECIDED) {#d07-motion-duration-tokens}

**Decision:** The `--td-duration-*` and `--td-easing-*` backward-compatibility aliases will be removed from `tokens.css`. Consumer code will reference `--tug-base-motion-duration-*` and `--tug-base-motion-easing-*` directly. The underlying `calc()` definitions in `tokens.css` that compute scaled durations from `--tug-timing` remain unchanged.

**Rationale:**
- Motion duration tokens follow the same migration pattern as all other `--td-*` tokens
- The `calc()` definitions must stay in `tokens.css` because they depend on `--tug-timing` defined in the `:root` block in the same file

**Implications:**
- CSS files using `var(--td-duration-fast)` become `var(--tug-base-motion-duration-fast)`
- The `:root` motion token definitions and `@media (prefers-reduced-motion)` rules remain in `tokens.css`

---

### Deep Dives (Optional) {#deep-dives}

#### Token Migration Mapping {#token-mapping}

**Table T01: --td-* to --tug-base-* Token Mapping** {#t01-td-to-tug-base}

This table is derived mechanically from the backward-compatibility alias section in `tokens.css`. Each row shows the legacy token and its canonical replacement.

| Legacy `--td-*` | Canonical `--tug-base-*` | Domain |
|------|------|------|
| `--td-bg` | `--tug-base-bg-app` | Surface |
| `--td-bg-soft` | `--tug-base-surface-raised` | Surface |
| `--td-card` | `--tug-base-card-bg` | Card |
| `--td-card-soft` | `--tug-base-surface-sunken` | Surface |
| `--td-surface` | `--tug-base-surface-default` | Surface |
| `--td-surface-tab` | `--tug-base-tab-bar-bg` | Tab |
| `--td-surface-control` | `--tug-base-surface-control` | Surface |
| `--td-surface-content` | `--tug-base-surface-content` | Surface |
| `--td-canvas` | `--tug-base-bg-canvas` | Canvas |
| `--td-text` | `--tug-base-fg-default` | Text |
| `--td-text-soft` | `--tug-base-fg-muted` | Text |
| `--td-text-inverse` | `--tug-base-fg-inverse` | Text |
| `--td-accent` | `--tug-base-accent-default` | Accent |
| `--td-accent-cool` | `--tug-base-accent-cool-default` | Accent |
| `--td-accent-1` through `--td-accent-8` | (removed -- no direct `--tug-base-*` equivalent; CSS consumers replace with the semantically appropriate `--tug-base-*` token, e.g. `--td-accent-2` in `tug-button.css` becomes `--tug-base-accent-cool-default` since both resolve to the same hex value; remaining consumers use named chart-series or status tokens as applicable) | Accent |
| `--td-success` | `--tug-base-accent-positive` | Status |
| `--td-warning` | `--tug-base-accent-warning` | Status |
| `--td-danger` | `--tug-base-accent-danger` | Status |
| `--td-info` | `--tug-base-accent-info` | Status |
| `--td-chart-1` | `--tug-base-chart-series-verdant` | Chart |
| `--td-chart-2` | `--tug-base-chart-series-cool` | Chart |
| `--td-chart-3` | `--tug-base-chart-series-golden` | Chart |
| `--td-chart-4` | `--tug-base-chart-series-rose` | Chart |
| `--td-chart-5` | `--tug-base-chart-series-violet` | Chart |
| `--td-header-active` | `--tug-base-card-header-bg-active` | Card Header |
| `--td-header-inactive` | `--tug-base-card-header-bg-inactive` | Card Header |
| `--td-icon-active` | `--tug-base-card-header-icon-active` | Card Header |
| `--td-icon-inactive` | `--tug-base-card-header-icon-inactive` | Card Header |
| `--td-grid-color` | `--tug-base-canvas-grid-line` | Canvas |
| `--td-card-shadow-active` | `--tug-base-card-shadow-active` | Card |
| `--td-card-shadow-inactive` | `--tug-base-card-shadow-inactive` | Card |
| `--td-card-dim-overlay` | `--tug-base-card-dim-overlay` | Card |
| `--td-selection-bg` | `--tug-base-selection-bg` | Selection |
| `--td-selection-text` | `--tug-base-selection-fg` | Selection |
| `--td-border` | `--tug-base-border-default` | Border |
| `--td-border-soft` | `--tug-base-border-muted` | Border |
| `--td-shadow-soft` | `--tug-base-shadow-sm` | Elevation |
| `--td-depth-raise` | `--tug-base-shadow-card-active` | Elevation |
| `--td-space-1` | `--tug-base-space-2xs` | Spacing |
| `--td-space-2` | `--tug-base-space-xs` | Spacing |
| `--td-space-3` | `--tug-base-space-sm` | Spacing |
| `--td-space-4` | `--tug-base-space-md` | Spacing |
| `--td-space-5` | `--tug-base-space-lg` | Spacing |
| `--td-space-6` | `--tug-base-space-xl` | Spacing |
| `--td-radius-xs` | `--tug-base-radius-xs` | Radius |
| `--td-radius-sm` | `--tug-base-radius-sm` | Radius |
| `--td-radius-md` | `--tug-base-radius-md` | Radius |
| `--td-radius-lg` | `--tug-base-radius-lg` | Radius |
| `--td-font-sans` | `--tug-base-font-family-sans` | Typography |
| `--td-font-mono` | `--tug-base-font-family-mono` | Typography |
| `--td-line-tight` | `--tug-base-line-height-tight` | Typography |
| `--td-line-normal` | `--tug-base-line-height-normal` | Typography |
| `--td-syntax-keyword` | `--tug-base-syntax-keyword` | Syntax |
| `--td-syntax-string` | `--tug-base-syntax-string` | Syntax |
| `--td-syntax-number` | `--tug-base-syntax-number` | Syntax |
| `--td-syntax-function` | `--tug-base-syntax-function` | Syntax |
| `--td-syntax-type` | `--tug-base-syntax-type` | Syntax |
| `--td-syntax-variable` | `--tug-base-syntax-variable` | Syntax |
| `--td-syntax-comment` | `--tug-base-syntax-comment` | Syntax |
| `--td-syntax-operator` | `--tug-base-syntax-operator` | Syntax |
| `--td-syntax-punctuation` | `--tug-base-syntax-punctuation` | Syntax |
| `--td-syntax-constant` | `--tug-base-syntax-constant` | Syntax |
| `--td-syntax-decorator` | `--tug-base-syntax-decorator` | Syntax |
| `--td-syntax-tag` | `--tug-base-syntax-tag` | Syntax |
| `--td-syntax-attribute` | `--tug-base-syntax-attribute` | Syntax |
| `--td-duration-fast` | `--tug-base-motion-duration-fast` | Motion |
| `--td-duration-moderate` | `--tug-base-motion-duration-moderate` | Motion |
| `--td-duration-slow` | `--tug-base-motion-duration-slow` | Motion |
| `--td-duration-glacial` | `--tug-base-motion-duration-glacial` | Motion |
| `--td-easing-standard` | `--tug-base-motion-easing-standard` | Motion |
| `--td-easing-enter` | `--tug-base-motion-easing-enter` | Motion |
| `--td-easing-exit` | `--tug-base-motion-easing-exit` | Motion |

**Table T02: shadcn Short-Name Aliases to --tug-base-* Mapping** {#t02-shadcn-bridge}

These short-name aliases are removed from `tokens.css` and the Tailwind `@theme` block is updated to reference `--tug-base-*` directly. This table covers the aliases registered in the Tailwind `@theme` block. Additional short-name aliases in `tokens.css` that are not in the `@theme` block (e.g., `--success`, `--warning`, `--info`, `--border-muted`, `--chart-1` through `--chart-5`, `--syntax-*`) are also deleted by the Step 5 and Step 6 deletion tasks.

| Legacy Short-Name | Tailwind `@theme` Key | Canonical `--tug-base-*` |
|------|------|------|
| `--background` | `--color-background` | `--tug-base-bg-app` |
| `--foreground` | `--color-foreground` | `--tug-base-fg-default` |
| `--card` | `--color-card` | `--tug-base-card-bg` |
| `--card-foreground` | `--color-card-foreground` | `--tug-base-fg-default` |
| `--muted` | `--color-muted` | `--tug-base-surface-control` |
| `--muted-foreground` | `--color-muted-foreground` | `--tug-base-fg-muted` |
| `--popover` | `--color-popover` | `--tug-base-surface-control` |
| `--popover-foreground` | `--color-popover-foreground` | `--tug-base-fg-default` |
| `--border` | `--color-border` | `--tug-base-border-default` |
| `--input` | `--color-input` | `--tug-base-border-default` |
| `--ring` | `--color-ring` | `--tug-base-accent-cool-default` |
| `--primary` | `--color-primary` | `--tug-base-accent-default` |
| `--primary-foreground` | `--color-primary-foreground` | `--tug-base-fg-inverse` |
| `--secondary` | `--color-secondary` | `--tug-base-surface-control` |
| `--secondary-foreground` | `--color-secondary-foreground` | `--tug-base-fg-default` |
| `--accent` | `--color-accent` | `--tug-base-accent-cool-default` |
| `--accent-foreground` | `--color-accent-foreground` | `--tug-base-bg-app` |
| `--destructive` | `--color-destructive` | `--tug-base-accent-danger` |
| `--destructive-foreground` | `--color-destructive-foreground` | `--tug-base-fg-inverse` |
| `--radius` | `--radius-md` | `--tug-base-radius-md` |
| `--radius-sm` | `--radius-sm` | `--tug-base-radius-sm` |
| `--radius-lg` | `--radius-lg` | `--tug-base-radius-lg` |

**Table T03: CSS Files and Approximate --td-* Reference Counts** {#t03-css-file-inventory}

| File | `--td-*` Refs | Migration Target |
|------|------|------|
| `src/components/tugways/cards/gallery-card.css` | ~63 | `--tug-base-*` / `--tug-comp-*` |
| `src/components/tugways/tug-tab-bar.css` | ~45 | `--tug-comp-*` (tab family) |
| `src/components/tugways/tug-button.css` | ~26 | `--tug-comp-*` (button family) |
| `src/components/tugways/cards/gallery-palette-content.css` | ~24 | `--tug-base-*` |
| `src/components/tugways/tugcard.css` | ~22 | `--tug-comp-*` (tugcard family) |
| `src/components/tugways/tug-dropdown.css` | ~21 | `--tug-comp-*` (dropdown family) |
| `styles/chrome.css` | ~12 | `--tug-base-*` |
| `src/globals.css` | ~4 | `--tug-base-*` |

**Table T05: tug-button.css Exact Token Mapping** {#t05-tug-button-mapping}

This table enumerates every `--td-*` reference in `tug-button.css` and its exact replacement. The primary variant uses `--tug-base-accent-cool-default` (cyan) instead of `--tug-comp-button-primary-bg-rest` (orange) to preserve zero visual regression -- the current button intentionally uses `--td-accent-2` (cyan) as its primary fill.

| CSS Rule | Legacy Token | Replacement Token | Notes |
|------|------|------|------|
| `.tug-button-bordered` | `--td-border` | `--tug-base-border-default` | |
| `.tug-button-primary` | `--td-accent-2` | `--tug-base-accent-cool-default` | NOT `--tug-comp-button-primary-bg-rest` (orange) |
| `.tug-button-primary` | `--td-text-inverse` | `--tug-base-fg-inverse` | |
| `.tug-button-destructive` | `--td-danger` | `--tug-base-accent-danger` | |
| `.tug-button-destructive` | `--td-text-inverse` | `--tug-base-fg-inverse` | |
| `.tug-button-destructive.tug-button-bordered` | `--td-danger` | `--tug-base-accent-danger` | |
| `.tug-button-primary:hover` | `--td-border-soft` | `--tug-base-border-muted` | |
| `.tug-button-secondary:hover` | `--td-surface` | `--tug-base-surface-default` | |
| `.tug-button-secondary:hover` | `--td-border-soft` | `--tug-base-border-muted` | |
| `.tug-button-ghost:hover` | `--td-surface-control` | `--tug-base-surface-control` | |
| `.tug-button-ghost:hover` | `--td-text` | `--tug-base-fg-default` | |
| `.tug-button-destructive:hover` | `--td-danger` | `--tug-base-accent-danger` | |
| `.tug-button-secondary:active` | `--td-surface-control` | `--tug-base-surface-control` | |
| `.tug-button-secondary:active` | `--td-border` | `--tug-base-border-default` | |
| `.tug-button-ghost:active` | `--td-surface` | `--tug-base-surface-default` | |
| transition rule | `--td-duration-fast` | `--tug-base-motion-duration-fast` | (x3 occurrences) |
| transition rule | `--td-easing-standard` | `--tug-base-motion-easing-standard` | (x3 occurrences) |
| `.tug-button-state-on` | `--td-accent` | `--tug-base-accent-default` | |
| `.tug-button-state-off` | `--td-border` | `--tug-base-border-default` | |
| `.tug-button-state-mixed` | `--td-text-soft` | `--tug-base-fg-muted` | |
| `.tug-button-spinner` | `--td-duration-moderate` | `--tug-base-motion-duration-moderate` | |
| `.tug-button-spinner` | `--td-easing-standard` | `--tug-base-motion-easing-standard` | |

**Table T04: TypeScript Files with --td-* String References** {#t04-ts-file-inventory}

| File | `--td-*` Refs | Kind |
|------|------|------|
| `src/components/tugways/cards/gallery-palette-content.tsx` | 5 | inline SVG fill/stroke attributes |
| `src/components/tugways/cards/hello-card.tsx` | 5 | inline style objects |
| `src/__tests__/mutation-model-demo.test.tsx` | 4 | test assertions and comments |
| `src/components/tugways/hooks/use-css-var.ts` | 3 | JSDoc examples |
| `src/components/tugways/cards/gallery-card.tsx` | 2 | useCSSVar calls |
| `src/components/chrome/disconnect-banner.tsx` | 2 | inline style fallbacks |
| `src/components/chrome/card-frame.tsx` | 2 | comment + SVG setAttribute |
| `src/components/tugways/tug-dropdown.tsx` | 2 | JSDoc comments |
| `src/components/tugways/tug-button.tsx` | 1 | JSDoc comment |
| `src/components/tugways/hooks/use-dom-style.ts` | 1 | JSDoc example |
| `src/components/tugways/hooks/index.ts` | 1 | JSDoc example |
| `src/components/tugways/cards/gallery-scale-timing-content.tsx` | 1 | UI label string |

---

### Specification {#specification}

#### Shiki Bridge Token Contract (Post-Migration) {#shiki-bridge-contract}

**Spec S01: Shiki CSS Variable Bridge** {#s01-shiki-bridge}

After migration, `tokens.css` retains only these non-`--tug-base-*` custom properties as the Shiki external contract:

```css
/* Shiki CSS variable bridge (external contract -- do not remove) */
--syntax-foreground: var(--tug-base-fg-default);
--syntax-background: var(--tug-base-surface-control);
--syntax-token-keyword: var(--tug-base-syntax-keyword);
--syntax-token-string: var(--tug-base-syntax-string);
--syntax-token-comment: var(--tug-base-syntax-comment);
--syntax-token-function: var(--tug-base-syntax-function);
--syntax-token-constant: var(--tug-base-syntax-constant);
--syntax-token-punctuation: var(--tug-base-syntax-punctuation);
--syntax-token-parameter: var(--tug-base-syntax-variable);
--syntax-token-string-expression: var(--tug-base-syntax-string);
--syntax-token-link: var(--tug-base-syntax-keyword);
```

#### CI Enforcement Script Contract {#ci-script-contract}

**Spec S02: check-legacy-tokens.sh** {#s02-ci-script}

The script greps for the following patterns in `tugdeck/src/` and `tugdeck/styles/`:

1. `--td-` -- legacy semantic token prefix
2. `--tways-` -- legacy Tier 1 palette prefix
3. A defined list of legacy short-name aliases used as CSS property definitions: `--background:`, `--foreground:`, `--primary:`, `--secondary:`, `--accent:`, `--destructive:`, `--muted:`, `--popover:`, `--ring:`, `--input:`, `--chart-[1-5]:`, `--syntax-keyword:` through `--syntax-attribute:` (as definitions, not as values)

Exclusions:
- The enforcement script itself (`check-legacy-tokens.sh`)
- Lines containing `/* legacy-token-allowlist */` marker comment (for intentional documentation references)

Concrete allowlist entries needed: none expected after all comment cleanup in Step 6. If any remain, add the marker comment on the affected line rather than expanding the script's exclusion list.

Exit code: 0 if no matches, 1 if any match found. Output lists each match with file:line:content.

#### tokens.css Post-Migration Structure {#tokens-post-structure}

**Spec S03: tokens.css Final Shape** {#s03-tokens-final-shape}

After migration, `tokens.css` contains only:

1. **Font declarations** (`@font-face` blocks) -- unchanged
2. **Global multiplier tokens** (`:root` block: `--tug-zoom`, `--tug-timing`, `--tug-motion`) -- unchanged
3. **Motion suppression rules** (`body[data-tug-motion="off"]`, `@media (prefers-reduced-motion)`) -- unchanged
4. **Scaled motion duration tokens** (`body` block: `--tug-base-motion-duration-fast` through `--tug-base-motion-duration-glacial` with `calc()`) -- unchanged
5. **Motion alias tokens** (`body` block: `--tug-base-motion-easing-standard`, etc.) -- renamed from `--td-*`
6. **Shiki CSS variable bridge** (Spec S01) -- rewired to `--tug-base-*`
7. **Legacy chart aliases** (`--chart-1` through `--chart-5`) -- rewired to `--tug-base-chart-series-*`; kept as runtime contract for future stats-card consumers
8. **Scrollbar styling** (`::-webkit-scrollbar-*`) -- migrated from `--td-*` to `--tug-base-*`

Removed entirely:
- All `--tways-*` Tier 1 palette declarations
- All `--td-*` backward-compatibility aliases
- All short-name shadcn bridge aliases (`--background`, `--foreground`, `--primary`, etc.)
- All legacy syntax aliases (`--syntax-keyword` through `--syntax-attribute`) -- redundant with Shiki bridge `--syntax-token-*` tokens

---

### Compatibility / Migration / Rollout (Optional) {#rollout}

- **Compatibility policy**: This is an internal-only migration. No external API contracts change. The Shiki bridge tokens and `--chart-N` legacy aliases are preserved as runtime contracts.
- **Migration plan**:
  - All changes are within `tugdeck/` -- no Rust or Swift code affected
  - Migration is file-by-file with visual verification at each step
  - Rollback: revert the commit(s) -- the old tokens are purely additive
- **Rollout plan**:
  - Single branch, merged to main after all checkpoints pass
  - No feature gates needed -- this is a naming change with zero visual regression

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/scripts/check-legacy-tokens.sh` | CI enforcement script: greps for legacy token patterns |

#### Symbols to add / modify {#symbols}

No new TypeScript/CSS symbols are added. All changes are token reference replacements within existing files.

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `check-legacy-tokens.sh` | shell script | `tugdeck/scripts/` | New file: CI enforcement |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `tokens.css` file header comment to reflect new structure (no Tier 1/Tier 2 distinction)
- [ ] Update `chrome.css` file header comment to reference `--tug-base-*` instead of `--td-*`
- [ ] Update JSDoc in `use-css-var.ts`, `use-dom-style.ts`, `hooks/index.ts` to use `--tug-base-*` examples
- [ ] Update `tug-button.tsx` and `tug-dropdown.tsx` JSDoc comments

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Build** | Verify `bun run build` succeeds with no errors | After each migration step |
| **Visual** | Manual inspection of component gallery across all three themes | After each CSS migration step |
| **Unit** | Verify mutation-model-demo tests pass with updated token references | After TypeScript migration |
| **CI Enforcement** | Verify `check-legacy-tokens.sh` catches legacy patterns and passes on clean code | After script creation |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Migrate Component CSS Files (Batch 1: tugcard, tug-button, tug-tab-bar, tug-dropdown) {#step-1}

**Commit:** `refactor(tugdeck): migrate tugcard/button/tab-bar/dropdown CSS from --td-* to --tug-base-*/--tug-comp-*`

**References:** [D01] Direct replacement, Table T01, Table T03, Table T05, (#token-mapping, #t05-tug-button-mapping, #strategy)

**Artifacts:**
- Modified: `src/components/tugways/tugcard.css` (~22 replacements)
- Modified: `src/components/tugways/tug-button.css` (~26 replacements)
- Modified: `src/components/tugways/tug-tab-bar.css` (~45 replacements)
- Modified: `src/components/tugways/tug-dropdown.css` (~21 replacements)

**Tasks:**
- [ ] In each of the four component CSS files, replace every `var(--td-*)` reference with the corresponding `var(--tug-comp-*)` or `var(--tug-base-*)` token, guided by the zero-regression rule below
- [ ] **Zero-regression rule:** Use a `--tug-comp-*` token ONLY when its resolved value matches the current resolved value of the `--td-*` token being replaced. When they differ, use the `--tug-base-*` token that preserves the current visual. Specifically: in `tug-button.css`, `--td-accent-2` (cyan, `#35bcff`) must become `--tug-base-accent-cool-default` (not `--tug-comp-button-primary-bg-rest`, which resolves to orange `#ff8a38`)
- [ ] For `tug-button.css`: use `--tug-comp-button-*` tokens where their resolved values match current visuals; fall back to `--tug-base-*` otherwise (see Table T05 for the exact per-rule mapping)
- [ ] For `tug-tab-bar.css`: prefer `--tug-comp-tab-*` tokens from `tug-comp-tokens.css`
- [ ] For `tugcard.css`: prefer `--tug-comp-card-*` tokens from `tug-comp-tokens.css`
- [ ] For `tug-dropdown.css`: prefer `--tug-comp-dropdown-*` tokens from `tug-comp-tokens.css`

**Tests:**
- [ ] `bun run build` succeeds
- [ ] Visual inspection: gallery card shows all four components correctly in Brio theme

**Checkpoint:**
- [ ] `grep -c '\-\-td-' tugdeck/src/components/tugways/tugcard.css tugdeck/src/components/tugways/tug-button.css tugdeck/src/components/tugways/tug-tab-bar.css tugdeck/src/components/tugways/tug-dropdown.css` returns 0 for all files
- [ ] `bun run build` exits 0

---

#### Step 2: Migrate Component CSS Files (Batch 2: gallery-card, gallery-palette-content, globals.css) {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): migrate gallery CSS and globals.css from --td-* to --tug-base-*`

**References:** [D01] Direct replacement, Table T01, Table T03, (#token-mapping)

**Artifacts:**
- Modified: `src/components/tugways/cards/gallery-card.css` (~63 replacements)
- Modified: `src/components/tugways/cards/gallery-palette-content.css` (~24 replacements)
- Modified: `src/globals.css` (~4 replacements in body rules)

**Tasks:**
- [ ] In `gallery-card.css`, replace every `var(--td-*)` with the corresponding `var(--tug-base-*)` per Table T01
- [ ] In `gallery-palette-content.css`, replace every `var(--td-*)` with the corresponding `var(--tug-base-*)` per Table T01
- [ ] In `globals.css` body rules, replace `var(--td-text)` with `var(--tug-base-fg-default)`, `var(--td-canvas)` with `var(--tug-base-bg-canvas)`, `var(--td-grid-color)` with `var(--tug-base-canvas-grid-line)`

**Tests:**
- [ ] `bun run build` succeeds
- [ ] Visual inspection: gallery card (all tabs), palette content page, and canvas grid background render correctly

**Checkpoint:**
- [ ] `grep -c '\-\-td-' tugdeck/src/components/tugways/cards/gallery-card.css tugdeck/src/components/tugways/cards/gallery-palette-content.css tugdeck/src/globals.css` returns 0 for all files
- [ ] `bun run build` exits 0

---

#### Step 3: Migrate chrome.css from --td-* to --tug-base-* {#step-3}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): migrate chrome.css from --td-* to --tug-base-*`

**References:** [D01] Direct replacement, Table T01, (#token-mapping)

**Artifacts:**
- Modified: `styles/chrome.css` (~12 replacements)

**Tasks:**
- [ ] Replace `var(--td-card-shadow-inactive)` with `var(--tug-base-card-shadow-inactive)`
- [ ] Replace `var(--td-card-shadow-active)` with `var(--tug-base-card-shadow-active)`
- [ ] Replace `var(--td-radius-md)` with `var(--tug-base-radius-md)`
- [ ] Replace `var(--td-card-dim-overlay)` with `var(--tug-base-card-dim-overlay)`
- [ ] Replace `var(--td-accent-cool)` with `var(--tug-base-accent-cool-default)`
- [ ] Replace `var(--td-text)` with `var(--tug-base-fg-default)`
- [ ] Replace `var(--td-accent)` with `var(--tug-base-accent-default)`
- [ ] Update file header comment to reference `--tug-base-*` instead of `--td-*`

**Tests:**
- [ ] `bun run build` succeeds
- [ ] Visual inspection: card shadows, focus dimming, snap guides, sash hover, card flash all render correctly

**Checkpoint:**
- [ ] `grep -c '\-\-td-' tugdeck/styles/chrome.css` returns 0
- [ ] `bun run build` exits 0

---

#### Step 4: Migrate TypeScript Files from --td-* to --tug-base-* {#step-4}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): migrate TypeScript --td-* string references to --tug-base-*`

**References:** [D01] Direct replacement, Table T01, Table T04, (#token-mapping)

**Artifacts:**
- Modified: `src/components/tugways/cards/gallery-palette-content.tsx` (5 inline SVG references)
- Modified: `src/components/tugways/cards/hello-card.tsx` (5 inline style references)
- Modified: `src/__tests__/mutation-model-demo.test.tsx` (4 test assertions/comments)
- Modified: `src/components/tugways/hooks/use-css-var.ts` (3 JSDoc examples)
- Modified: `src/components/tugways/cards/gallery-card.tsx` (2 useCSSVar calls)
- Modified: `src/components/chrome/disconnect-banner.tsx` (2 inline style fallbacks)
- Modified: `src/components/chrome/card-frame.tsx` (1 comment + 1 SVG setAttribute)
- Modified: `src/components/tugways/tug-dropdown.tsx` (2 JSDoc comments)
- Modified: `src/components/tugways/tug-button.tsx` (1 JSDoc comment)
- Modified: `src/components/tugways/hooks/use-dom-style.ts` (1 JSDoc example)
- Modified: `src/components/tugways/hooks/index.ts` (1 JSDoc example)
- Modified: `src/components/tugways/cards/gallery-scale-timing-content.tsx` (1 UI label)

**Tasks:**
- [ ] In each file listed in Table T04, replace `--td-*` string references with the corresponding `--tug-base-*` per Table T01
- [ ] For inline styles with fallback values (e.g., `"var(--td-surface, #1a1a1a)"`), preserve the fallback but change the token name
- [ ] For JSDoc examples, update to show `--tug-base-*` token names
- [ ] For test assertions, update expected values (e.g., `"var(--td-accent)"` -> `"var(--tug-base-accent-default)"`)
- [ ] For the `gallery-scale-timing-content.tsx` UI label mentioning `--td-duration-*`, update to `--tug-base-motion-duration-*`
- [ ] For `hello-card.tsx`: note `var(--td-text-muted, var(--td-text))` needs special handling -- `--td-text-muted` has no alias; replace with `var(--tug-base-fg-muted, var(--tug-base-fg-default))`

**Tests:**
- [ ] `bun run build` succeeds
- [ ] `cd tugdeck && bun test` passes (mutation-model-demo tests)

**Checkpoint:**
- [ ] `grep -r '\-\-td-' tugdeck/src/ --include='*.ts' --include='*.tsx'` returns no matches
- [ ] `bun run build` exits 0

---

#### Step 5: Cut Over shadcn Bridge and Update @theme Block {#step-5}

**Depends on:** #step-2, #step-3, #step-4

**Commit:** `refactor(tugdeck): cut over shadcn bridge to --tug-base-* and update @theme block`

**References:** [D05] shadcn bridge cutover, Table T02, (#t02-shadcn-bridge, #strategy)

**Artifacts:**
- Modified: `styles/tokens.css` (remove ~36 short-name alias definitions)
- Modified: `src/globals.css` (rewrite `@theme` block to reference `--tug-base-*`)

**Tasks:**
- [ ] In `tokens.css`, delete the entire "Legacy aliases (runtime contracts - Table T06)" section containing `--background`, `--foreground`, `--card`, `--card-foreground`, `--muted`, `--muted-foreground`, `--popover`, `--popover-foreground`, `--border`, `--border-muted`, `--input`, `--ring`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent`, `--accent-foreground`, `--success`, `--success-foreground`, `--warning`, `--warning-foreground`, `--destructive`, `--destructive-foreground`, `--info`, `--info-foreground`, `--radius`, `--radius-sm`, `--radius-lg`
- [ ] In `globals.css`, rewrite the `@theme` block per Table T02: `--color-background: var(--tug-base-bg-app)`, `--color-foreground: var(--tug-base-fg-default)`, etc.
- [ ] Update the comment block at the top of the `@theme` section in `globals.css` to explain the new direct references
- [ ] Grep `components/ui/*.tsx` to confirm no direct CSS variable references to short-name aliases exist

**Tests:**
- [ ] `bun run build` succeeds
- [ ] Visual inspection: shadcn button, dropdown menu, and dialog components render correctly with correct colors

**Checkpoint:**
- [ ] `grep -E '^\s*--(background|foreground|primary|secondary|accent|destructive|muted|popover|ring|input|card|border|border-muted|radius|radius-sm|radius-lg|success|warning|info|chart-[1-5]):' tugdeck/styles/tokens.css` returns no matches
- [ ] `bun run build` exits 0

---

#### Step 6: Delete --tways-* Palette Blocks and Refactor Theme Files {#step-6}

**Depends on:** #step-5

**Commit:** `refactor(tugdeck): delete --tways-* palette blocks and simplify theme files`

**References:** [D02] Delete --tways-* palette blocks, [D03] Shiki bridge tokens, [D04] Chart and syntax aliases, [D07] Motion duration tokens, Spec S03, (#tokens-post-structure, #strategy)

**Artifacts:**
- Modified: `styles/tokens.css` (remove ~67 `--tways-*` declarations, remove ~70 `--td-*` aliases, rewire Shiki bridge and chart/syntax aliases)
- Modified: `styles/tug-tokens.css` (update comments that reference `--td-*` or `--tways-*` token names)
- Modified: `styles/brio.css` (update file header comment that references `--tways-*`)
- Modified: `styles/bluenote.css` (remove ~42 `--tways-*` declarations plus `--tways-canvas`, `--tways-header-*`, `--tways-icon-*`, `--tways-grid-color`, `--tways-card-shadow-*`, `--tways-card-dim-overlay`)
- Modified: `styles/harmony.css` (remove ~44 `--tways-*` declarations plus optional palette entries)

**Tasks:**
- [ ] In `tokens.css` body block: delete all `--tways-*` Tier 1 palette declarations (lines starting with `--tways-`)
- [ ] In `tokens.css` body block: delete the entire "Tier 2: Backward-Compatibility Aliases" section (all `--td-*` alias definitions)
- [ ] In `tokens.css` body block: delete the `--td-duration-*` and `--td-easing-*` motion alias definitions; rename the source `--tug-base-motion-duration-*` calc definitions to remove any `--td-` references in comments
- [ ] In `tokens.css` body block: rewire Shiki bridge tokens from `var(--td-*)` to `var(--tug-base-*)` per Spec S01
- [ ] In `tokens.css` body block: rewire legacy chart aliases from `var(--td-chart-N)` to `var(--tug-base-chart-series-*)` per [D04]
- [ ] In `tokens.css` body block: rewire legacy syntax aliases from `var(--td-syntax-*)` to `var(--tug-base-syntax-*)`
- [ ] In `tokens.css`: delete all legacy syntax alias definitions (`--syntax-keyword:` through `--syntax-attribute:`); these are fully redundant with the Shiki bridge tokens (`--syntax-token-*`) which are retained
- [ ] In `tokens.css` scrollbar section: replace `var(--td-border)` with `var(--tug-base-border-default)` and `var(--td-border-soft)` with `var(--tug-base-border-muted)`
- [ ] In `tokens.css`: update file header comment to reflect post-migration structure (no Tier 1/Tier 2 distinction, just global multipliers + motion tokens + Shiki bridge + scrollbar)
- [ ] In `tug-tokens.css`: update all comments that mention `--td-*` or `--tways-*` tokens (e.g., `--td-shadow-soft / --tways-shadow-soft` mapping comments, `--tways-accent-*` sourcing comments) to reference `--tug-base-*` names instead, so the CI enforcement script does not false-positive on comment text
- [ ] In `brio.css`: update file header comment to reference `--tug-base-*` instead of `--tways-*` (currently says "Brio's palette values are defined as defaults in tokens.css (body { --tways-* })")
- [ ] In `bluenote.css`: delete all `--tways-*` declarations (the Tier 1 palette block and the optional palette entries block); keep only the `--tug-base-*` override block
- [ ] In `bluenote.css`: update file header comment to reflect that the file contains only `--tug-base-*` overrides
- [ ] In `harmony.css`: delete all `--tways-*` declarations (same as bluenote); keep only the `--tug-base-*` override block
- [ ] In `harmony.css`: update file header comment similarly
- [ ] Verify no remaining `var(--tways-*)` references exist anywhere in tugdeck (the `--td-accent-1` through `--td-accent-8` aliases referenced `var(--tways-accent-N)` and must be confirmed deleted)

**Tests:**
- [ ] `bun run build` succeeds
- [ ] Visual inspection: all three themes (Brio, Bluenote, Harmony) render correctly in component gallery

**Checkpoint:**
- [ ] `grep -r '\-\-tways-' tugdeck/` returns no matches
- [ ] `grep -r '\-\-td-' tugdeck/styles/` returns no matches (covers tokens.css, tug-tokens.css, brio.css, and all other style files)
- [ ] `bun run build` exits 0

---

#### Step 7: Add CI Enforcement Script {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): add CI enforcement script for legacy token detection`

**References:** [D06] CI enforcement, Spec S02, (#ci-script-contract)

**Artifacts:**
- New: `tugdeck/scripts/check-legacy-tokens.sh`

**Tasks:**
- [ ] Create `tugdeck/scripts/` directory if it does not exist
- [ ] Write `check-legacy-tokens.sh` per Spec S02: grep for `--td-`, `--tways-`, and legacy short-name alias definitions in `tugdeck/src/` and `tugdeck/styles/`
- [ ] Add exclusion for the script itself
- [ ] Add allowlist marker comment support for any remaining intentional references (e.g., migration documentation)
- [ ] Make the script executable (`chmod +x`)
- [ ] Verify the script passes on the current codebase (exit 0)
- [ ] Verify the script catches a test violation (temporarily add `--td-test` to a file, confirm exit 1, then revert)

**Tests:**
- [ ] `bash tugdeck/scripts/check-legacy-tokens.sh` exits 0 on clean codebase
- [ ] Script correctly catches `--td-*` pattern when one is temporarily introduced

**Checkpoint:**
- [ ] `bash tugdeck/scripts/check-legacy-tokens.sh` exits 0
- [ ] Script is executable: `test -x tugdeck/scripts/check-legacy-tokens.sh`

---

#### Step 8: Integration Checkpoint {#step-8}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Direct replacement, [D02] Delete --tways-* palette blocks, [D05] shadcn bridge cutover, [D06] CI enforcement, Spec S02, Spec S03, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify zero `--td-` occurrences in `tugdeck/src/` and `tugdeck/styles/`
- [ ] Verify zero `--tways-` occurrences in `tugdeck/`
- [ ] Verify Tailwind `@theme` block references `--tug-base-*` directly
- [ ] Verify `tokens.css` matches Spec S03 final shape
- [ ] Visual inspection: all three themes in component gallery -- buttons, tabs, cards, dropdowns, palette page, scale/timing page, hello card
- [ ] Verify shadcn components render correctly (dialog, dropdown menu, tooltip)
- [ ] Run CI enforcement script

**Tests:**
- [ ] `bun run build` exits 0
- [ ] `cd tugdeck && bun test` passes
- [ ] `bash tugdeck/scripts/check-legacy-tokens.sh` exits 0

**Checkpoint:**
- [ ] `grep -r '\-\-td-' tugdeck/src tugdeck/styles` returns no matches
- [ ] `grep -r '\-\-tways-' tugdeck/` returns no matches
- [ ] `bun run build` exits 0
- [ ] `bash tugdeck/scripts/check-legacy-tokens.sh` exits 0

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All CSS and TypeScript consumers in tugdeck reference `--tug-base-*`/`--tug-comp-*` tokens directly, all legacy `--td-*`/`--tways-*` tokens and shadcn bridge aliases are removed, and a CI enforcement script prevents regression.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero `--td-` or `--tways-` references in `tugdeck/src/` and `tugdeck/styles/` (verify: grep)
- [ ] Tailwind `@theme` block uses `--tug-base-*` directly (verify: inspect `globals.css`)
- [ ] `tokens.css` contains only: font declarations, global multipliers, motion tokens, Shiki bridge, chart legacy aliases, scrollbar rules (verify: manual inspection per Spec S03)
- [ ] `bluenote.css` and `harmony.css` contain only `--tug-base-*` overrides (verify: grep confirms zero `--tways-*`)
- [ ] `bun run build` succeeds (verify: build command)
- [ ] `cd tugdeck && bun test` passes (verify: test command)
- [ ] `bash tugdeck/scripts/check-legacy-tokens.sh` exits 0 (verify: script execution)
- [ ] Zero visual regression across all three themes (verify: manual gallery inspection)

**Acceptance tests:**
- [ ] Build succeeds: `cd tugdeck && bun run build`
- [ ] Unit tests pass: `cd tugdeck && bun test`
- [ ] CI enforcement passes: `bash tugdeck/scripts/check-legacy-tokens.sh`
- [ ] Visual parity: component gallery renders identically in Brio, Bluenote, and Harmony

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Wire `--tug-base-*` color tokens to CITA palette `var()` references (Phase 5d5e or later)
- [ ] Per-component zoom overrides (`--tug-comp-*-zoom`) for independent component scaling
- [ ] Remove `--chart-N` and `--syntax-*` legacy aliases when stats-card.ts is rebuilt on new infrastructure
- [ ] Add `check-legacy-tokens.sh` to CI pipeline configuration

| Checkpoint | Verification |
|------------|--------------|
| No legacy tokens in source | `grep -r '\-\-td-' tugdeck/src tugdeck/styles` and `grep -r '\-\-tways-' tugdeck/` both return empty |
| Build succeeds | `cd tugdeck && bun run build` exits 0 |
| Tests pass | `cd tugdeck && bun test` exits 0 |
| CI script passes | `bash tugdeck/scripts/check-legacy-tokens.sh` exits 0 |
| Visual parity | Manual inspection of component gallery across all three themes |
