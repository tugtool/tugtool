<!-- tugplan-skeleton v2 -->

## Semantic Token Vocabulary for tug-base.css {#semantic-token-vocabulary}

**Purpose:** Ship a 20-token tone system and ~30-token control surface system in tug-base.css, rename action-* to control-*, fold surface-control-* into control-secondary-bg-*, remove dead accent and component tone tokens, update themes, and verify the entire CSS stack passes.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugplan/semantic-token-vocabulary |
| Last updated | 2026-03-12 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current `tug-base.css` defines a `--tug-base-action-*` token family for interactive controls and separate `--tug-base-accent-positive/warning/danger/info` tokens for semantic colors. Component CSS files (tug-dialog.css, tug-tab.css, tug-button.css) duplicate raw `--tug-color()` values for toast, badge, and banner tone variants instead of referencing shared base tokens. The proposal in `roadmap/tugways-semantic-token-proposal.md` defines the complete semantic vocabulary that base should provide so components never invent their own colors.

This plan implements the proposal's two key additions: a systematic tone system (positive, warning, danger, info -- each with 5 tokens) and a control surface system (primary, secondary, destructive, ghost -- backgrounds, foregrounds, borders, icons). It also performs the rename from `action-*` to `control-*`, folds `surface-control-*` into `control-secondary-bg-*`, and removes dead component tone tokens.

#### Strategy {#strategy}

- Add the 20 tone tokens to tug-base.css first, since they have no naming conflict with existing tokens and components can start referencing them immediately.
- Rename `--tug-base-action-*` to `--tug-base-control-*` in a single hard-rename pass across all files that reference them (tug-base.css, tug-button.css, harmony.css, style-inspector-overlay.ts, gallery-cascade-inspector-content.tsx).
- Fold `--tug-base-surface-control`, `--tug-base-surface-control-hover`, and `--tug-base-surface-control-active` into the control-secondary-bg-* namespace, updating all call sites (tug-tab.css, tug-button.css, tug-menu.css, gallery-card.css, gallery-palette-content.css, bluenote.css, harmony.css).
- Add remaining new control tokens (ghost, selected, highlighted, control icons) per the proposal.
- Clean up component CSS: replace duplicated `--tug-color()` tone values with `var(--tug-base-tone-*)` references and delete dead component tone tokens.
- Delete `--tug-base-accent-positive/warning/danger/info` and migrate all call sites to `--tug-base-tone-*`.
- Update theme files (bluenote.css, harmony.css) to override the new token families.
- Verify: TypeScript passes, manual visual inspection across Brio, Bluenote, and Harmony themes.

#### Success Criteria (Measurable) {#success-criteria}

- All 20 `--tug-base-tone-*` tokens defined in tug-base.css body block and resolvable at runtime (verify via browser devtools).
- All ~30 `--tug-base-control-*` tokens defined in tug-base.css body block.
- Zero occurrences of `--tug-base-action-` in the entire `tugdeck/` directory (`grep -r` returns nothing).
- Zero occurrences of `--tug-base-surface-control` as a standalone token (only `--tug-base-control-secondary-bg-rest` and friends remain).
- Zero occurrences of `--tug-base-accent-positive`, `--tug-base-accent-warning`, `--tug-base-accent-danger`, `--tug-base-accent-info` in the codebase.
- `bun run typecheck` passes with zero errors.
- Manual visual inspection confirms no regressions across Brio, Bluenote, and Harmony themes.

#### Scope {#scope}

1. Add tone tokens (20 tokens) to tug-base.css
2. Add control surface tokens (~30 tokens) to tug-base.css, including rename of action-* to control-*
3. Fold surface-control-* into control-secondary-bg-*
4. Clean up component CSS files: tug-dialog.css, tug-tab.css, tug-button.css, tug-menu.css, tug-card.css, tug-dock.css, tug-data.css, tug-code.css, tug-inspector.css, tug-skeleton.css
5. Remove dead accent tokens (accent-positive/warning/danger/info)
6. Update theme files: harmony.css, bluenote.css
7. Update style-inspector-overlay.ts token arrays
8. Update globals.css Shiki bridge token `--syntax-background` reference (currently points to `--tug-base-surface-control`)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Field tokens, toggle/range tokens, scrollbar/separator/avatar tokens are already implemented and not changing.
- Adding new component CSS rules or new React components.
- Automated visual snapshot testing infrastructure.
- Per-theme canonical L tuning (future phase).

#### Dependencies / Prerequisites {#dependencies}

- `roadmap/tugways-semantic-token-proposal.md` is the design authority for all token names and values.
- tug-palette.css and postcss-tug-color build plugin must be working (they are).
- Current `tug-base.css` already defines the action-* and surface-control-* tokens being renamed/folded.

#### Constraints {#constraints}

- All token renames must be done atomically per commit -- no intermediate state where a token is referenced but undefined.
- Theme overrides must match the new token names exactly; a missing override would silently fall back to Brio defaults.
- The style-inspector-overlay.ts token lists are string arrays -- renaming must update them or the inspector will fail to match.

#### Assumptions {#assumptions}

- Visual regression check means manual inspection in the browser across Brio, Bluenote, and Harmony themes -- no automated visual snapshot infrastructure.
- tug-skeleton.css is in scope for cleanup if it references affected tokens (it does not reference action-* or surface-control-* tokens, only skeleton-specific tokens, so it is effectively out of scope).
- The proposal's field tokens, toggle/range tokens, and scrollbar/separator/avatar tokens are already implemented and not part of this change.
- TypeScript clean means `bun run typecheck` passes with zero errors.
- The primary button variant (`.tug-button-primary`) currently uses `--tug-base-accent-cool-default` (cobalt) for its background, not `--tug-base-control-primary-bg-rest` (orange). This is intentional -- the app's primary action button is cobalt-colored by design. Migrating the primary button to use control-primary-* tokens is a separate design decision and is not part of this plan.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All design decisions were resolved by the user answers and the proposal document.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Missed token reference causes runtime CSS var fallback to initial | med | med | Grep-based verification at each step | Visual glitch in any theme |
| Theme file missing override for new token | med | low | Exhaustive search for all tokens that need per-theme values | Color anomaly in Bluenote or Harmony |
| Style inspector token arrays out of sync | low | med | Update arrays in same step as rename | Inspector fails to resolve chain |

**Risk R01: Missed token reference** {#r01-missed-reference}

- **Risk:** A `var(--tug-base-action-*)` or `var(--tug-base-surface-control)` reference survives the rename and resolves to CSS initial value at runtime.
- **Mitigation:**
  - Run `grep -r` after each rename step to verify zero remaining references.
  - Visual inspection across all three themes.
- **Residual risk:** References in inline styles within TypeScript files could be missed by CSS-only searches. The grep covers `.ts` and `.tsx` files as well.

**Risk R02: Theme override gap** {#r02-theme-override-gap}

- **Risk:** A new tone or control token needs a per-theme override in Harmony or Bluenote but does not get one, causing the Brio default to show through.
- **Mitigation:**
  - For tone tokens: the `--tug-color()` values resolve through the palette, which is theme-aware, so most tones do not need per-theme overrides. Only contrast-critical cases (e.g., Harmony warning-fg) need explicit overrides.
  - For control tokens: the renamed control-* tokens carry the same values as the old action-* tokens, so existing theme overrides transfer directly.
- **Residual risk:** Newly added tokens (selected, highlighted, ghost) may need Harmony-specific contrast tuning discovered only during manual testing.

---

### Design Decisions {#design-decisions}

#### [D01] Hard rename action-* to control-* (DECIDED) {#d01-action-to-control}

**Decision:** Replace all `--tug-base-action-*` tokens with `--tug-base-control-*` in a single pass across tug-base.css, tug-button.css, harmony.css, style-inspector-overlay.ts, and gallery-cascade-inspector-content.tsx.

**Rationale:**
- The proposal uses "control" as the organizing concept (control kinds, control states).
- "Action" is ambiguous (could mean user action, Redux action, etc.).
- A hard rename avoids maintaining two parallel naming schemes.

**Implications:**
- Every file that references `--tug-base-action-*` must be updated in the same commit.
- Theme overrides in harmony.css that use `--tug-base-action-*` become `--tug-base-control-*`.

#### [D02] Fold surface-control-* into control-secondary-bg-* using surface-control values (DECIDED) {#d02-fold-surface-control}

**Decision:** Replace `--tug-base-surface-control`, `--tug-base-surface-control-hover`, and `--tug-base-surface-control-active` with `--tug-base-control-secondary-bg-rest`, `--tug-base-control-secondary-bg-hover`, and `--tug-base-control-secondary-bg-active` respectively. The consolidated tokens use the **surface-control values** (not the action-secondary-bg values), because surface-control has ~16 call sites vs 1 for action-secondary-bg-rest.

**Value reconciliation:** The old surface-control-* and action-secondary-bg-* tokens had different values:

| State | surface-control-* (adopted) | action-secondary-bg-* (dropped) |
|-------|---------------------------|-------------------------------|
| rest | `violet-6, i: 5, t: 8` | `violet, i: 5, t: 12` |
| hover | `violet, i: 5, t: 12` | `violet, i: 4, t: 15` |
| active | `violet, i: 4, t: 14` | `cobalt+10, i: 7, t: 16` |

The one call site using `action-secondary-bg-rest` (tug-button.css base `.tug-button` background) will adopt the surface-control value. This is a minor visual change: the button rest background becomes slightly darker (t:8 vs t:12). Since the same token is used for ghost hover, tab hover, and menu hover across the system, using the surface-control value creates visual consistency.

**Rationale:**
- The surface-control tokens are the dominant set (~16 call sites in tabs, menus, galleries, ghost tabs, drop targets).
- Having both `surface-control-*` and `action-secondary-bg-*` is confusing and the proposal explicitly consolidates them.
- The single tug-button.css call site that used action-secondary-bg-rest is visually minor and benefits from system-wide consistency.

**Implications:**
- Call sites in tug-tab.css, tug-button.css, tug-menu.css, gallery-card.css, gallery-palette-content.css, bluenote.css, and harmony.css must be updated.
- The Shiki bridge token `--syntax-background` in tug-base.css currently references `--tug-base-surface-control` and must be updated.
- tug-button.css base background shifts from `violet, i: 5, t: 12` to `violet-6, i: 5, t: 8` -- verify visually.

#### [D03] Delete component tone tokens outright (DECIDED) {#d03-delete-component-tones}

**Decision:** Remove per-component tone tokens (`--tug-toast-success-bg`, `--tug-toast-success-fg`, `--tug-badge-success-bg`, `--tug-badge-success-fg`, `--tug-banner-info-bg`, etc.) and have callers reference `--tug-base-tone-*` directly.

**Rationale:**
- Toast tone tokens are exact value matches with base tones (same `--tug-color()` hue and alpha parameters). Banner tone tokens are also exact matches. Badge tone tokens have slightly different alpha values (badge-success-bg uses `a: 20` vs tone-positive-bg `a: 15`; badge-warning-bg uses `a: 15` vs tone-warning-bg `a: 12`; badge-danger-bg uses `a: 20` vs tone-danger-bg `a: 15`). This 5-8% opacity difference is accepted as an intentional simplification -- consistency across the tone system outweighs per-component alpha tuning for this subtle difference. If badges need distinct opacity in the future, a single bespoke `--tug-badge-tone-bg-boost` token can be added.
- Maintaining per-component duplicates is error-prone and inflates the token count.
- Components that need a slightly different opacity can define a single bespoke token rather than a full parallel set.

**Implications:**
- tug-dialog.css loses its toast-success-bg/fg, toast-warning-bg/fg, toast-danger-bg/fg, badge-success-bg/fg, badge-warning-bg/fg, badge-danger-bg/fg, banner-info-bg/fg, banner-warning-bg/fg, banner-danger-bg/fg tokens.
- Harmony theme overrides for toast-warning-fg, badge-warning-fg, banner-info-fg, banner-warning-fg are contrast-critical per [D06] in harmony.css. These collapse into tone-level overrides: `--tug-base-tone-warning-fg` and `--tug-base-tone-info-fg`. **Harmony contrast value resolution:** Harmony currently has two different warning-fg values: toast-warning-fg at `i: 55, t: 35` and badge/banner-warning-fg at `i: 46, t: 27`. The darker value (`i: 46, t: 27`) is chosen for `--tug-base-tone-warning-fg` because it provides better contrast for 2 of 3 consumers (badge and banner) and is still adequate for toast text. For info-fg, harmony uses `--tug-color(blue, i: 42, t: 40)` which becomes `--tug-base-tone-info-fg`.
- Any CSS rules or TypeScript code referencing these removed tokens must be updated to use `var(--tug-base-tone-*)`.
- The test file `step8-roundtrip-integration.test.ts` references `--tug-toast-warning-fg`, `--tug-badge-warning-fg`, and `--tug-banner-info-fg` and must be updated.

#### [D04] Remove accent-positive/warning/danger/info (DECIDED) {#d04-remove-accent-semantic}

**Decision:** Delete `--tug-base-accent-positive`, `--tug-base-accent-warning`, `--tug-base-accent-danger`, and `--tug-base-accent-info` from tug-base.css and migrate all call sites to `--tug-base-tone-*` directly.

**Value mapping (accent-* to tone-*):** The accent tokens use `-intense` palette presets while the tone tokens use plain hues. This is an intentional simplification:

| Accent Token | Old Value | Tone Replacement | New Value | Visual Change |
|-------------|-----------|-----------------|-----------|---------------|
| `accent-positive` | `green-intense` | `tone-positive` | `green` | Slightly less vivid green; no call sites reference this token so no runtime impact |
| `accent-warning` | `yellow-intense` | `tone-warning` | `yellow` | Less vivid yellow; affects disconnect-banner.tsx |
| `accent-danger` | `red` | `tone-danger` | `red` | No change (same value) |
| `accent-info` | `cyan-intense` | `tone-info` | `cyan` | Slightly less vivid cyan; no call sites reference this token so no runtime impact |

For disconnect-banner.tsx, the change from `yellow-intense` to `yellow` produces a slightly softer warning background. This is acceptable because the banner already uses an inline fallback (`#f59e0b`) and the visual difference is subtle. If the intense variant is needed, it can be achieved with a bespoke token in a follow-up.

**Rationale:**
- The tone system provides a richer vocabulary (5 tokens per tone vs. 1 accent token per tone).
- Having both accent-danger and tone-danger is confusing -- callers must choose between them.
- Only 2 of 4 accent-semantic tokens have external call sites (accent-danger in tug-button.css, accent-warning in disconnect-banner.tsx). The others are definition-only.

**Implications:**
- `--tug-base-accent-danger` in tug-button.css destructive variant becomes `var(--tug-base-control-destructive-bg-rest)` for background and `var(--tug-base-control-destructive-border)` for border -- these are control surface tokens (same underlying `red` value), not tone tokens, because the destructive button is a control surface concern, not a tone messaging concern. The hover border also uses `var(--tug-base-control-destructive-bg-rest)` to preserve the current `red` value (using `-bg-hover` would change it to `red-intense`).
- `--tug-base-accent-warning` in disconnect-banner.tsx becomes `var(--tug-base-tone-warning)` -- changes from `yellow-intense` to `yellow`, minor visual softening.
- The 4 tokens are removed from tug-base.css body block.

#### [D05] Tone token values match proposal exactly (DECIDED) {#d05-tone-values}

**Decision:** Use the exact `--tug-color()` values specified in the proposal for all 20 tone tokens.

**Rationale:**
- The proposal values were derived from the existing duplicated values in tug-dialog.css.
- Using identical values ensures zero visual change on the Brio theme.

**Implications:**
- Brio: tone tokens are exact matches for the old component tokens.
- Harmony: contrast-critical overrides (warning-fg, info-fg) must be added to harmony.css.
- Bluenote: no tone overrides needed (dark theme, palette resolves correctly).

---

### Specification {#specification}

#### Tone Token Definitions {#tone-token-spec}

**Table T01: Tone Tokens (20 tokens)** {#t01-tone-tokens}

| Token | Value (Brio) | Purpose |
|-------|-------------|---------|
| `--tug-base-tone-positive` | `--tug-color(green)` | Full-strength positive/success color |
| `--tug-base-tone-positive-bg` | `--tug-color(green, i: 50, t: 50, a: 15)` | Subtle positive background |
| `--tug-base-tone-positive-fg` | `--tug-color(green)` | Text color for positive context |
| `--tug-base-tone-positive-border` | `--tug-color(green)` | Border for positive context |
| `--tug-base-tone-positive-icon` | `--tug-color(green)` | Icon color for positive context |
| `--tug-base-tone-warning` | `--tug-color(yellow)` | Full-strength warning color |
| `--tug-base-tone-warning-bg` | `--tug-color(yellow, i: 50, t: 50, a: 12)` | Subtle warning background |
| `--tug-base-tone-warning-fg` | `--tug-color(yellow)` | Text color for warning context |
| `--tug-base-tone-warning-border` | `--tug-color(yellow)` | Border for warning context |
| `--tug-base-tone-warning-icon` | `--tug-color(yellow)` | Icon color for warning context |
| `--tug-base-tone-danger` | `--tug-color(red)` | Full-strength danger color |
| `--tug-base-tone-danger-bg` | `--tug-color(red, i: 50, t: 50, a: 15)` | Subtle danger background |
| `--tug-base-tone-danger-fg` | `--tug-color(red)` | Text color for danger context |
| `--tug-base-tone-danger-border` | `--tug-color(red)` | Border for danger context |
| `--tug-base-tone-danger-icon` | `--tug-color(red)` | Icon color for danger context |
| `--tug-base-tone-info` | `--tug-color(cyan)` | Full-strength info color |
| `--tug-base-tone-info-bg` | `--tug-color(cyan, i: 50, t: 50, a: 12)` | Subtle info background |
| `--tug-base-tone-info-fg` | `--tug-color(cyan)` | Text color for info context |
| `--tug-base-tone-info-border` | `--tug-color(cyan)` | Border for info context |
| `--tug-base-tone-info-icon` | `--tug-color(cyan)` | Icon color for info context |

#### Control Surface Token Definitions {#control-token-spec}

**Table T02: Control Background Tokens** {#t02-control-bg-tokens}

| Token | Value (Brio) | Notes |
|-------|-------------|-------|
| `--tug-base-control-primary-bg-rest` | `--tug-color(orange)` | Was action-primary-bg-rest |
| `--tug-base-control-primary-bg-hover` | `--tug-color(orange-intense)` | Was action-primary-bg-hover |
| `--tug-base-control-primary-bg-active` | `--tug-color(orange-dark)` | Was action-primary-bg-active |
| `--tug-base-control-primary-bg-disabled` | `var(--tug-base-control-disabled-bg)` | New, references disabled contract |
| `--tug-base-control-secondary-bg-rest` | `--tug-color(violet-6, i: 5, t: 8)` | Adopts surface-control value per [D02]; was surface-control AND action-secondary-bg-rest |
| `--tug-base-control-secondary-bg-hover` | `--tug-color(violet, i: 5, t: 12)` | Adopts surface-control-hover value per [D02]; was surface-control-hover AND action-secondary-bg-hover |
| `--tug-base-control-secondary-bg-active` | `--tug-color(violet, i: 4, t: 14)` | Adopts surface-control-active value per [D02]; was surface-control-active AND action-secondary-bg-active |
| `--tug-base-control-secondary-bg-disabled` | `var(--tug-base-control-disabled-bg)` | New, references disabled contract |
| `--tug-base-control-destructive-bg-rest` | `--tug-color(red)` | Was action-destructive-bg-rest |
| `--tug-base-control-destructive-bg-hover` | `--tug-color(red-intense)` | Was action-destructive-bg-hover |
| `--tug-base-control-destructive-bg-active` | `--tug-color(red-dark)` | Was action-destructive-bg-active |
| `--tug-base-control-destructive-bg-disabled` | `var(--tug-base-control-disabled-bg)` | New, references disabled contract |
| `--tug-base-control-ghost-bg-rest` | `transparent` | New |
| `--tug-base-control-ghost-bg-hover` | `--tug-color(white, i: 0, t: 100, a: 7)` | Was action-ghost-bg-hover |
| `--tug-base-control-ghost-bg-active` | `var(--tug-base-surface-default)` | New |

**Table T03: Control Foreground, Border, Icon, and State Tokens** {#t03-control-detail-tokens}

| Token | Value (Brio) | Notes |
|-------|-------------|-------|
| `--tug-base-control-primary-fg` | `--tug-color(cobalt-8, i: 3, t: 100)` | Was action-primary-fg |
| `--tug-base-control-secondary-fg` | `--tug-color(cobalt, i: 3, t: 94)` | Was action-secondary-fg |
| `--tug-base-control-destructive-fg` | `--tug-color(cobalt-8, i: 3, t: 100)` | Was action-destructive-fg |
| `--tug-base-control-ghost-fg` | `--tug-color(cobalt, i: 5, t: 66)` | Was action-ghost-fg |
| `--tug-base-control-primary-border` | `transparent` | Was action-primary-border |
| `--tug-base-control-secondary-border` | `--tug-color(cobalt, i: 6, t: 30)` | Was action-secondary-border |
| `--tug-base-control-destructive-border` | `transparent` | Was action-destructive-border |
| `--tug-base-control-ghost-border` | `transparent` | New |
| `--tug-base-control-primary-icon` | `--tug-color(cobalt-8, i: 3, t: 100)` | New |
| `--tug-base-control-secondary-icon` | `--tug-color(cobalt, i: 5, t: 66)` | New |
| `--tug-base-control-destructive-icon` | `--tug-color(cobalt-8, i: 3, t: 100)` | New |
| `--tug-base-control-ghost-icon` | `--tug-color(cobalt+7, i: 7, t: 37)` | New |
| `--tug-base-control-selected-bg` | `--tug-color(orange, i: 50, t: 50, a: 18)` | New |
| `--tug-base-control-selected-bg-hover` | `--tug-color(orange, i: 50, t: 50, a: 24)` | New |
| `--tug-base-control-selected-fg` | `--tug-color(cobalt, i: 3, t: 94)` | New |
| `--tug-base-control-selected-border` | `--tug-color(orange)` | New |
| `--tug-base-control-selected-disabled-bg` | `--tug-color(orange, i: 50, t: 50, a: 10)` | New |
| `--tug-base-control-highlighted-bg` | `--tug-color(orange, i: 50, t: 50, a: 10)` | New |
| `--tug-base-control-highlighted-fg` | `--tug-color(cobalt, i: 3, t: 94)` | New |
| `--tug-base-control-highlighted-border` | `--tug-color(orange, i: 50, t: 50, a: 25)` | New |

#### Token Rename Mapping {#rename-mapping}

**Table T04: Action-to-Control Rename Map** {#t04-rename-map}

| Old Token | New Token |
|-----------|-----------|
| `--tug-base-action-primary-bg-rest` | `--tug-base-control-primary-bg-rest` |
| `--tug-base-action-primary-bg-hover` | `--tug-base-control-primary-bg-hover` |
| `--tug-base-action-primary-bg-active` | `--tug-base-control-primary-bg-active` |
| `--tug-base-action-primary-fg` | `--tug-base-control-primary-fg` |
| `--tug-base-action-primary-border` | `--tug-base-control-primary-border` |
| `--tug-base-action-secondary-bg-rest` | `--tug-base-control-secondary-bg-rest` |
| `--tug-base-action-secondary-bg-hover` | `--tug-base-control-secondary-bg-hover` |
| `--tug-base-action-secondary-bg-active` | `--tug-base-control-secondary-bg-active` |
| `--tug-base-action-secondary-fg` | `--tug-base-control-secondary-fg` |
| `--tug-base-action-secondary-border` | `--tug-base-control-secondary-border` |
| `--tug-base-action-ghost-bg-hover` | `--tug-base-control-ghost-bg-hover` |
| `--tug-base-action-ghost-fg` | `--tug-base-control-ghost-fg` |
| `--tug-base-action-destructive-bg-rest` | `--tug-base-control-destructive-bg-rest` |
| `--tug-base-action-destructive-bg-hover` | `--tug-base-control-destructive-bg-hover` |
| `--tug-base-action-destructive-bg-active` | `--tug-base-control-destructive-bg-active` |
| `--tug-base-action-destructive-fg` | `--tug-base-control-destructive-fg` |
| `--tug-base-action-destructive-border` | `--tug-base-control-destructive-border` |
| `--tug-base-action-disabled-bg` | (delete -- redundant with control-disabled-bg) |
| `--tug-base-action-disabled-fg` | (delete -- redundant with control-disabled-fg) |
| `--tug-base-action-disabled-border` | (delete -- redundant with control-disabled-border) |

**Table T05: Surface-Control Fold Map** {#t05-surface-fold-map}

| Old Token | New Token | Call Sites |
|-----------|-----------|-----------|
| `--tug-base-surface-control` | `--tug-base-control-secondary-bg-rest` | tug-tab.css, tug-button.css, tug-menu.css, gallery-card.css, gallery-palette-content.css, tug-base.css (Shiki bridge), bluenote.css, harmony.css |
| `--tug-base-surface-control-hover` | `--tug-base-control-secondary-bg-hover` | bluenote.css, harmony.css |
| `--tug-base-surface-control-active` | `--tug-base-control-secondary-bg-active` | bluenote.css, harmony.css |

**Table T06: Accent Semantic Token Removal** {#t06-accent-removal}

| Removed Token | Old Value | Replacement | New Value | Call Sites | Visual Change |
|---------------|-----------|------------|-----------|-----------|---------------|
| `--tug-base-accent-positive` | `green-intense` | `--tug-base-tone-positive` | `green` | tug-base.css only (definition) | None (no call sites) |
| `--tug-base-accent-warning` | `yellow-intense` | `--tug-base-tone-warning` | `yellow` | tug-base.css, disconnect-banner.tsx | Minor: softer yellow in disconnect banner |
| `--tug-base-accent-danger` | `red` | `--tug-base-control-destructive-bg-rest` (button bg), `--tug-base-control-destructive-border` (button border) | `red` | tug-base.css, tug-button.css | None (same value; button uses control-destructive-* not tone-danger) |
| `--tug-base-accent-info` | `cyan-intense` | `--tug-base-tone-info` | `cyan` | tug-base.css only (definition) | None (no call sites) |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add Tone Tokens to tug-base.css {#step-1}

**Commit:** `feat(tokens): add 20-token tone system to tug-base.css`

**References:** [D05] Tone token values match proposal, Table T01 (#t01-tone-tokens), (#tone-token-spec, #context)

**Artifacts:**
- 20 new `--tug-base-tone-*` custom properties in tug-base.css body block

**Tasks:**
- [ ] Add a new section comment `/* --- Semantic Tones --- */` in the body block of tug-base.css, after the Accent System section (section B).
- [ ] Add all 20 tone tokens per Table T01 with exact `--tug-color()` values from the proposal.
- [ ] Verify the values match the existing duplicated values in tug-dialog.css (e.g., `--tug-toast-success-bg` uses `--tug-color(green, i: 50, t: 50, a: 15)` which should match `--tug-base-tone-positive-bg`).

**Tests:**
- [ ] `bun run typecheck` passes (no TS errors).

**Checkpoint:**
- [ ] `grep -c 'tug-base-tone-' tugdeck/styles/tug-base.css` returns 20.
- [ ] `bun run typecheck` exits 0.

---

#### Step 2: Rename action-* to control-* {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tokens): rename --tug-base-action-* to --tug-base-control-*`

**References:** [D01] Hard rename action-* to control-*, Table T04 (#t04-rename-map), (#strategy)

**Artifacts:**
- tug-base.css: all `--tug-base-action-*` definitions become `--tug-base-control-*`
- tug-button.css: all `var(--tug-base-action-*)` references updated
- harmony.css: all `--tug-base-action-*` overrides updated
- style-inspector-overlay.ts: BASE_TOKEN_FALLBACKS arrays updated
- gallery-cascade-inspector-content.tsx: documentation string updated

**Tasks:**
- [ ] In tug-base.css, rename all `--tug-base-action-primary-*`, `--tug-base-action-secondary-*`, `--tug-base-action-ghost-*`, `--tug-base-action-destructive-*` definitions to `--tug-base-control-*` per Table T04.
- [ ] Delete the three `--tug-base-action-disabled-*` tokens (redundant with existing `--tug-base-control-disabled-*` contract).
- [ ] In tug-button.css, replace all `var(--tug-base-action-*)` with `var(--tug-base-control-*)`.
- [ ] In harmony.css, replace all `--tug-base-action-*` overrides with `--tug-base-control-*`.
- [ ] In style-inspector-overlay.ts, update `BASE_TOKEN_FALLBACKS` arrays: replace `--tug-base-action-primary-bg-rest` with `--tug-base-control-primary-bg-rest`, `--tug-base-action-secondary-bg-rest` with `--tug-base-control-secondary-bg-rest`. **Note:** The inspector currently has `--tug-base-action-primary-fg-rest` and `--tug-base-action-secondary-fg-rest` -- these have a pre-existing bug (the actual tokens are `-fg` without `-rest`). Fix the bug during rename: replace with `--tug-base-control-primary-fg` and `--tug-base-control-secondary-fg` (dropping the erroneous `-rest` suffix).
- [ ] In gallery-cascade-inspector-content.tsx, update the documentation string reference.
- [ ] Update the section comment in tug-base.css from "Actions and Generic Controls" to "Control Surfaces".
- [ ] Add new control tokens per the proposal that do not yet exist: `--tug-base-control-ghost-bg-rest`, `--tug-base-control-ghost-bg-active`, `--tug-base-control-ghost-border`, `--tug-base-control-primary-bg-disabled`, `--tug-base-control-secondary-bg-disabled`, `--tug-base-control-destructive-bg-disabled`, plus all control icon tokens, selected state tokens, and highlighted state tokens per Tables T02 and T03. **Note:** These ~15 net-new tokens are combined with the rename in a single commit because they all belong to the same "Control Surfaces" section of tug-base.css and share the `--tug-base-control-*` namespace. Splitting would leave an incomplete control surface section between commits.

**Tests:**
- [ ] `bun run typecheck` passes.

**Checkpoint:**
- [ ] `grep -r 'tug-base-action-' tugdeck/` returns zero matches.
- [ ] `bun run typecheck` exits 0.

---

#### Step 3: Fold surface-control-* into control-secondary-bg-* {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tokens): fold surface-control-* into control-secondary-bg-*`

**References:** [D02] Fold surface-control-* into control-secondary-bg-*, Table T05 (#t05-surface-fold-map), (#strategy)

**Artifacts:**
- tug-base.css: remove `--tug-base-surface-control`, `--tug-base-surface-control-hover`, `--tug-base-surface-control-active` definitions (values already live under control-secondary-bg-*)
- tug-base.css: update Shiki bridge token `--syntax-background` to reference `--tug-base-control-secondary-bg-rest`
- tug-tab.css: all `var(--tug-base-surface-control)` references become `var(--tug-base-control-secondary-bg-rest)`
- tug-button.css: update ghost hover reference
- tug-menu.css: update hover reference
- gallery-card.css, gallery-palette-content.css: update references
- bluenote.css: update `--tug-base-surface-control`, `--tug-base-surface-control-hover`, `--tug-base-surface-control-active` overrides to `--tug-base-control-secondary-bg-rest`, etc.
- harmony.css: same treatment as bluenote.css

**Tasks:**
- [ ] Remove the three `--tug-base-surface-control*` definitions from the Surfaces section of tug-base.css. The control-secondary-bg-* tokens (added in Step 2) must use the **surface-control values** per [D02]: rest = `violet-6, i: 5, t: 8`, hover = `violet, i: 5, t: 12`, active = `violet, i: 4, t: 14`. If Step 2 used the old action-secondary values, correct them now.
- [ ] Update `--syntax-background: var(--tug-base-surface-control)` to `--syntax-background: var(--tug-base-control-secondary-bg-rest)` in the Shiki bridge section.
- [ ] In tug-tab.css, replace all occurrences of `var(--tug-base-surface-control)` with `var(--tug-base-control-secondary-bg-rest)`.
- [ ] In tug-button.css, replace `var(--tug-base-surface-control)` (ghost hover bg) with `var(--tug-base-control-secondary-bg-rest)`.
- [ ] In tug-menu.css, replace `var(--tug-base-surface-control)` references. Also update the explanatory comment near line 140 that references `--tug-base-surface-control` by name -- change it to `--tug-base-control-secondary-bg-rest`.
- [ ] In gallery-card.css and gallery-palette-content.css, replace `var(--tug-base-surface-control)` references.
- [ ] In bluenote.css, rename the three surface-control override definitions to control-secondary-bg-*.
- [ ] In harmony.css, rename the three surface-control override definitions to control-secondary-bg-*.

**Tests:**
- [ ] `bun run typecheck` passes.

**Checkpoint:**
- [ ] `grep -r 'tug-base-surface-control' tugdeck/` returns zero matches.
- [ ] `bun run typecheck` exits 0.

---

#### Step 4: Clean Up Component Tone Tokens {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `refactor(tokens): replace component tone tokens with base tone references`

**References:** [D03] Delete component tone tokens outright, Table T01 (#t01-tone-tokens), (#strategy)

**Artifacts:**
- tug-dialog.css: remove `--tug-toast-success-bg`, `--tug-toast-success-fg`, `--tug-toast-warning-bg`, `--tug-toast-warning-fg`, `--tug-toast-danger-bg`, `--tug-toast-danger-fg`, `--tug-badge-success-bg`, `--tug-badge-success-fg`, `--tug-badge-warning-bg`, `--tug-badge-warning-fg`, `--tug-badge-danger-bg`, `--tug-badge-danger-fg`, `--tug-banner-info-bg`, `--tug-banner-info-fg`, `--tug-banner-warning-bg`, `--tug-banner-warning-fg`, `--tug-banner-danger-bg`, `--tug-banner-danger-fg`, `--tug-status-success`, `--tug-status-warning`, `--tug-status-danger`, `--tug-status-info`
- harmony.css: convert contrast-critical toast/badge/banner overrides to tone-level overrides
- step8-roundtrip-integration.test.ts: update references to removed token names
- Any CSS rules or TSX files referencing removed tokens must be updated

**Tasks:**
- [ ] In tug-dialog.css, remove all tone-duplicated tokens listed above. Keep tokens that are NOT tone duplicates: `--tug-toast-info-bg`, `--tug-toast-info-fg` (these are surface/fg colors, not tone colors), `--tug-badge-neutral-bg`, `--tug-badge-neutral-fg`, `--tug-alert-bg`, `--tug-alert-fg`, and all non-tone tokens (progress, spinner, skeleton, emptyState, kbd). **Explicitly preserve `--tug-badge-accent-bg` and `--tug-badge-accent-fg`** -- these reference the brand accent (orange), not a semantic tone, and remain as bespoke component tokens.
- [ ] Search for any CSS rules or TSX files that reference the removed tokens (e.g., `var(--tug-toast-success-bg)`) and update them to use `var(--tug-base-tone-positive-bg)`, `var(--tug-base-tone-positive-fg)`, etc.
- [ ] Update the test file `step8-roundtrip-integration.test.ts`: the three old entries collapse into two new entries. Replace the array entries with:
  - `{ token: "--tug-base-tone-warning-fg", tugColor: "--tug-color(yellow, i: 46, t: 27)" }` (replaces both `--tug-toast-warning-fg` at `i: 55, t: 35` and `--tug-badge-warning-fg` at `i: 46, t: 27` -- uses the darker value per [D03] contrast resolution)
  - `{ token: "--tug-base-tone-info-fg", tugColor: "--tug-color(blue, i: 42, t: 40)" }` (replaces `--tug-banner-info-fg`)
- [ ] In harmony.css, remove the per-component tone overrides (`--tug-toast-warning-fg`, `--tug-badge-warning-fg`, `--tug-banner-info-fg`, `--tug-banner-warning-fg`) and add tone-level overrides instead. **Use the darker value for warning-fg** per [D03] contrast resolution:
  - `--tug-base-tone-warning-fg: --tug-color(yellow, i: 46, t: 27);` (darker value from badge/banner -- provides better contrast for 2 of 3 consumers; adequate for toast)
  - `--tug-base-tone-info-fg: --tug-color(blue, i: 42, t: 40);` (covers banner-info)

**Tests:**
- [ ] `bun run typecheck` passes.

**Checkpoint:**
- [ ] `grep -r 'tug-toast-success\|tug-toast-warning\|tug-toast-danger\|tug-badge-success\|tug-badge-warning\|tug-badge-danger\|tug-banner-info\|tug-banner-warning\|tug-banner-danger\|tug-status-success\|tug-status-warning\|tug-status-danger\|tug-status-info' tugdeck/` returns zero matches (excluding test fixtures if any).
- [ ] `bun run typecheck` exits 0.

---

#### Step 5: Remove Accent Semantic Tokens and Migrate Call Sites {#step-5}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `refactor(tokens): remove accent-positive/warning/danger/info, use tone-* directly`

**References:** [D04] Remove accent-positive/warning/danger/info, Table T06 (#t06-accent-removal), (#strategy)

**Artifacts:**
- tug-base.css: remove `--tug-base-accent-positive`, `--tug-base-accent-warning`, `--tug-base-accent-danger`, `--tug-base-accent-info`
- tug-button.css: replace `var(--tug-base-accent-danger)` with control-destructive-* tokens (bg and border)
- disconnect-banner.tsx: replace `var(--tug-base-accent-warning, #f59e0b)` with `var(--tug-base-tone-warning, #f59e0b)`

**Tasks:**
- [ ] In tug-base.css, remove the four `--tug-base-accent-positive/warning/danger/info` definitions from the Accent System section.
- [ ] In tug-button.css, replace destructive variant `var(--tug-base-accent-danger)` references with control-destructive-* tokens: `.tug-button-destructive` background becomes `var(--tug-base-control-destructive-bg-rest)`, `.tug-button-destructive.tug-button-bordered` border-color becomes `var(--tug-base-control-destructive-border)`, and `.tug-button-destructive:hover` border-color becomes `var(--tug-base-control-destructive-bg-rest)` (preserves current `red` value -- using `control-destructive-bg-hover` would change it to `red-intense`, which is an unnecessary visual change; add a CSS comment: `/* uses -bg-rest to preserve red border on hover */`). These are control surface tokens -- destructive button appearance is a control kind concern, not tone messaging.
- [ ] In disconnect-banner.tsx, replace `var(--tug-base-accent-warning, #f59e0b)` with `var(--tug-base-tone-warning, #f59e0b)`. **Note:** This changes the resolved color from `yellow-intense` to `yellow` per [D04] value mapping -- a minor visual softening of the banner background. Verify visually.
- [ ] Run a final grep to verify no other references to the removed tokens exist.

**Tests:**
- [ ] `bun run typecheck` passes.

**Checkpoint:**
- [ ] `grep -r 'tug-base-accent-positive\|tug-base-accent-warning\|tug-base-accent-danger\|tug-base-accent-info' tugdeck/` returns zero matches.
- [ ] `bun run typecheck` exits 0.

---

#### Step 6: Update Theme Files {#step-6}

**Depends on:** #step-2, #step-3, #step-4, #step-5

**Commit:** `feat(themes): add tone and control surface overrides to theme files`

**References:** [D05] Tone token values, [D01] Hard rename, [D02] Fold surface-control, Table T01 (#t01-tone-tokens), Tables T02-T03, Risk R02 (#r02-theme-override-gap), (#strategy)

**Artifacts:**
- harmony.css: add `--tug-base-tone-warning-fg` and `--tug-base-tone-info-fg` overrides (if not already done in Step 4); verify all control-* overrides are in place (done in Steps 2-3)
- bluenote.css: verify no new overrides needed (dark theme, palette resolves correctly)
- Both theme files: add overrides for new selected/highlighted/ghost control tokens if needed for visual correctness

**Tasks:**
- [ ] Review harmony.css to verify tone overrides are present: `--tug-base-tone-warning-fg`, `--tug-base-tone-info-fg`.
- [ ] Review harmony.css to verify control-secondary-bg-* overrides are present (from the former surface-control-* and action-secondary-* overrides, merged in Steps 2-3).
- [ ] Review bluenote.css for control-secondary-bg-* overrides (from the former surface-control-* overrides, merged in Step 3).
- [ ] Add theme overrides for any new tokens (selected, highlighted, ghost) if the Brio defaults produce incorrect visuals on Harmony or Bluenote. For Harmony (light theme), selected-bg and highlighted-bg may need adjusted opacity. For Bluenote (dark blue), defaults are likely correct.
- [ ] Clean up any orphaned comments referencing old token names.

**Tests:**
- [ ] `bun run typecheck` passes.

**Checkpoint:**
- [ ] All three themes load without CSS resolution warnings in browser devtools.
- [ ] `bun run typecheck` exits 0.

---

#### Step 7: Final Verification {#step-7}

**Depends on:** #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] Hard rename, [D02] Fold surface-control, [D03] Delete component tones, [D04] Remove accent semantic, (#success-criteria)

**Tasks:**
- [ ] Run `grep -r 'tug-base-action-' tugdeck/` -- must return zero matches.
- [ ] Run `grep -r 'tug-base-surface-control[^-]' tugdeck/` -- must return zero matches (allow `control-secondary` etc.).
- [ ] Run `grep -r 'tug-base-accent-positive\|tug-base-accent-warning\|tug-base-accent-danger\|tug-base-accent-info' tugdeck/` -- must return zero matches.
- [ ] Run `bun run typecheck` -- must exit 0.
- [ ] Manual visual inspection: open the app in browser, switch through Brio, Bluenote, and Harmony themes. Verify buttons, tabs, menus, toasts, badges, banners, dialogs render correctly with no color regressions.
- [ ] Verify tone tokens resolve at runtime: in browser devtools, inspect a toast element and confirm it uses `--tug-base-tone-*` tokens.
- [ ] Verify control tokens resolve at runtime: in browser devtools, inspect a button element and confirm it uses `--tug-base-control-*` tokens.

**Tests:**
- [ ] `bun run typecheck` passes with zero errors.

**Checkpoint:**
- [ ] All grep checks return zero matches.
- [ ] `bun run typecheck` exits 0.
- [ ] Visual inspection confirms no regressions across all three themes.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A complete semantic token vocabulary in tug-base.css -- 20 tone tokens and ~30 control surface tokens -- with all component CSS files, theme files, and TypeScript references updated to use the new tokens.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero occurrences of `--tug-base-action-` in tugdeck/ (grep verification).
- [ ] Zero occurrences of `--tug-base-surface-control` as a standalone token in tugdeck/ (grep verification).
- [ ] Zero occurrences of `--tug-base-accent-positive/warning/danger/info` in tugdeck/ (grep verification).
- [ ] All 20 `--tug-base-tone-*` tokens defined in tug-base.css.
- [ ] All ~30 `--tug-base-control-*` tokens defined in tug-base.css.
- [ ] `bun run typecheck` passes with zero errors.
- [ ] Manual visual inspection passes across Brio, Bluenote, and Harmony themes.

**Acceptance tests:**
- [ ] `grep -r 'tug-base-action-' tugdeck/` returns nothing.
- [ ] `grep -c 'tug-base-tone-' tugdeck/styles/tug-base.css` returns 20.
- [ ] `grep -c 'tug-base-control-' tugdeck/styles/tug-base.css` returns at least 30.
- [ ] `bun run typecheck` exits 0.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Per-theme canonical L tuning for tone tokens (contrast optimization).
- [ ] Update component CSS rules to use control-selected-* and control-highlighted-* tokens for tab active states, menu hover states, etc.
- [ ] Automated visual snapshot testing infrastructure.
- [ ] Migrate remaining bespoke component tokens to base where patterns emerge.

| Checkpoint | Verification |
|------------|--------------|
| Tone tokens defined | `grep -c 'tug-base-tone-' tugdeck/styles/tug-base.css` returns 20 |
| Action tokens gone | `grep -r 'tug-base-action-' tugdeck/` returns nothing |
| Surface-control gone | `grep -r 'tug-base-surface-control' tugdeck/` returns nothing |
| Accent semantic gone | `grep -r 'tug-base-accent-(positive\|warning\|danger\|info)' tugdeck/` returns nothing |
| TypeScript clean | `bun run typecheck` exits 0 |
| Visual check | Manual inspection across Brio, Bluenote, Harmony |
