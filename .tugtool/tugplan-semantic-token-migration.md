<!-- tugplan-skeleton v2 -->

## Migrate Component CSS Tokens to Semantic Base References {#semantic-token-migration}

**Purpose:** Eliminate raw `--tug-color()` duplication in component-level CSS token definitions by migrating ~240 tokens across 8 component files to reference `--tug-base-*` semantic tokens where appropriate, and fix ~11 hardcoded hex colors in gallery CSS files.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugplan/semantic-token-migration |
| Last updated | 2026-03-12 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The semantic-token-vocabulary plan shipped the `--tug-base-tone-*`, `--tug-base-control-*`, `--tug-base-surface-*`, and `--tug-base-accent-*` token families in `tug-base.css`. These tokens provide a single source of truth for semantic color meaning. However, component-level CSS files (tug-data.css, tug-code.css, tug-dock.css, tug-dialog.css, tug-card.css, tug-inspector.css, tug-tab.css, tug-menu.css) still define their own tokens using raw `--tug-color()` values that duplicate base token definitions. This duplication means theme overrides must be applied in multiple places, and semantic meaning is obscured.

Additionally, gallery-card.css contains a `box-shadow: rgba(0, 0, 0, 0.18)` and gallery-palette-content.css has ~8 hardcoded hex values (`#cc3333`, `#fff0f0`, `#ffcccc`, `rgba(255,255,255,0.85)`, `rgba(0,0,0,0.5)`, `#fff`, `#000`, `rgba(0,0,0,0.6)`) that should use semantic tokens where they represent themed UI (error states) and be left as-is where they are intentional literal overlays on arbitrary color backgrounds.

#### Strategy {#strategy}

- Audit each component CSS file's `body {}` token block and classify every token as "migrate" (matching base token exists) or "keep" (component-specific with no base equivalent).
- Migrate tokens by replacing `--tug-color(...)` with `var(--tug-base-*)` references, preserving the component token name so all CSS rule call sites remain untouched.
- Process files in dependency order: start with files that have no cross-file token references (tug-data.css, tug-dialog.css, tug-inspector.css), then files with some cross-references (tug-code.css, tug-dock.css, tug-menu.css), then tug-tab.css and tug-card.css which have CSS rules.
- Fix gallery hardcoded colors: migrate error-state hex values to tone-danger tokens; leave picker overlay colors as intentional literals.
- Verify visually across all three themes (Brio, Bluenote, Harmony) after each step.

#### Success Criteria (Measurable) {#success-criteria}

- Every component token whose `--tug-color()` value is identical to a `--tug-base-*` token's value now uses `var(--tug-base-*)` instead of the duplicated `--tug-color()` call. (Verify: grep for remaining `--tug-color()` in body{} blocks should only return tokens classified as "keep".)
- The `.gp-import-error` class uses `var(--tug-base-tone-danger-fg)`, `var(--tug-base-tone-danger-bg)`, and `var(--tug-base-tone-danger-border)` instead of hardcoded hex values.
- `bun run typecheck` passes with zero errors.
- **Brio theme**: pixel-identical rendering after migration (verify via visual inspection). Brio is the default theme defined in tug-base.css, so migrating from a duplicated `--tug-color()` to `var(--tug-base-*)` resolves to the same value.
- **Bluenote theme**: component tokens that previously used Brio-default `--tug-color()` values now inherit Bluenote's `--tug-base-*` overrides. This is the intended behavior -- Bluenote was under-themed for component tokens, and this migration enables proper theme propagation. Visual inspection confirms the inherited values are appropriate.
- **Harmony theme**: Harmony directly overrides most component tokens in harmony.css. For those tokens, the migration from `--tug-color()` to `var(--tug-base-*)` is a no-op because Harmony's direct override takes CSS cascade precedence. For any component tokens Harmony does NOT override, they inherit Harmony's base token overrides (same propagation as Bluenote). Visual inspection confirms correctness.

#### Scope {#scope}

1. Audit and migrate token definitions in tug-data.css (~28 tokens)
2. Audit and migrate token definitions in tug-code.css (~42 tokens)
3. Audit and migrate token definitions in tug-dock.css (~21 tokens)
4. Audit and migrate token definitions in tug-dialog.css (~20 tokens)
5. Audit and migrate token definitions in tug-card.css (~20 tokens)
6. Audit and migrate token definitions in tug-inspector.css (~20 tokens)
7. Audit and migrate token definitions in tug-tab.css (~25 tokens)
8. Audit and migrate token definitions in tug-menu.css (~22 tokens)
9. Fix hardcoded hex colors in gallery-palette-content.css (error state) and gallery-card.css (verified; box-shadow kept as literal per [D07])

#### Non-goals (Explicitly out of scope) {#non-goals}

- Creating new base tokens in tug-base.css -- this plan only references existing base tokens
- Migrating syntax highlighting tokens (`--tug-syntax-*`) which are a specialized palette
- Migrating ANSI terminal tokens (`--tug-terminal-ansi-*`) which are a fixed specification domain
- Migrating chart series tokens (`--tug-chart-series-*`) which are a data visualization palette
- Migrating canvas/snap/sash/flash geometry tokens which are spatial feedback colors
- Migrating inspector source classification tokens which are color-coded category labels
- Migrating picker overlay colors in gallery-palette-content.css (`.gp-picker-preset-dot`, `.gp-picker-crosshair`, `.gp-picker-preset-label`) which are intentional literal overlays on arbitrary swatch backgrounds
- Changing the hsl() gradient in `.cg-hue-swatch` which is a full-spectrum display gradient
- Renaming any component token names -- only their values change
- Theme file changes (themes override `--tug-base-*` tokens, and components now inherit those overrides automatically)

#### Dependencies / Prerequisites {#dependencies}

- The semantic-token-vocabulary plan must have shipped: `tug-base.css` must already define `--tug-base-tone-*`, `--tug-base-control-*`, `--tug-base-surface-*`, `--tug-base-accent-*`, `--tug-base-fg-*`, `--tug-base-border-*`, `--tug-base-icon-*`, `--tug-base-shadow-*`, `--tug-base-divider-*`, `--tug-base-highlight-*`, `--tug-base-selection-*`, `--tug-base-field-*`, and `--tug-base-overlay-*` token families.

#### Constraints {#constraints}

- Component token names must not change -- only their values are updated. All CSS rule call sites reference component tokens by name, so names are a public contract.
- Visual output must be pixel-identical in Brio (the default theme). Replacing `--tug-color(red)` with `var(--tug-base-tone-danger)` is valid because the base token's value is `--tug-color(red)` in tug-base.css.
- In Bluenote and Harmony, visual changes are expected and intended. Bluenote overrides `--tug-base-*` tokens but historically lacked component-token overrides, so components displayed Brio defaults. After migration, components inherit Bluenote's base overrides -- this is the correct behavior. Harmony directly overrides most component tokens in harmony.css, so the migration is a no-op for those (Harmony's direct override takes CSS cascade precedence).
- Theme files (bluenote.css, harmony.css) must not need changes for this migration to be safe. For Harmony's direct component-token overrides, the migration changes the underlying default value but Harmony's override still wins. For Bluenote, the intended effect is that components now pick up Bluenote's base token values.

#### Assumptions {#assumptions}

- The semantic-token-vocabulary plan has shipped and tug-base.css defines all `--tug-base-*` tokens listed in the current codebase.
- Each component token whose `--tug-color()` value exactly matches a `--tug-base-*` token definition is safe to migrate. Approximate matches (different `i:` or `t:` parameters) must NOT be migrated.
- CSS rules in component files already reference `--tug-base-*` tokens directly in many places, so this migration is only about the `body {}` token definition blocks.
- The `.tug-pole` fallback values (`#3a3e46`, `#ff8a38`) are harmless defaults for when tokens are not loaded; they can be left as-is since they are fallback values, not primary definitions.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All ambiguities were resolved during clarification:
- Chart threshold tokens migrate to tone (per user answer on `chart_tokens`).
- Code feed/file-status tokens migrate tone-semantic only (per user answer on `code_tokens`).
- Picker overlay colors stay literal (per user answer on `picker_colors`).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token value mismatch causes visual regression | high | low | Verify each `--tug-color()` value exactly matches the target `--tug-base-*` definition before migrating | Any visual diff in browser inspection |
| Theme override cascade breaks when component tokens reference base tokens | high | low | Test all three themes after each migration step; base tokens are already overridden by themes at the body{} level | Theme switching shows wrong colors |
| Migrating a "keep" token by mistake (false positive match) | med | low | Use the classification table as a checklist; verify token semantics not just values | Post-migration audit of remaining `--tug-color()` calls |

**Risk R01: Value Mismatch Regression** {#r01-value-mismatch}

- **Risk:** A component token's `--tug-color()` value may differ subtly from the base token it appears to match (different `i:`, `t:`, or `a:` parameters), causing a visual regression when migrated.
- **Mitigation:**
  - Compare exact parameter values before each migration.
  - Use browser devtools computed-style comparison before and after.
  - Migrate one file at a time with visual verification between each.
- **Residual risk:** Subtle color differences may not be visible in side-by-side comparison but could affect edge cases (e.g., semi-transparent overlays).

---

### Design Decisions {#design-decisions}

#### [D01] Migrate by exact value match only (DECIDED) {#d01-exact-match}

**Decision:** A component token is migrated to `var(--tug-base-*)` only when its `--tug-color()` value is character-for-character identical to the base token's definition in tug-base.css.

**Rationale:**
- Eliminates risk of subtle color shifts from approximate matches.
- Makes the migration mechanically verifiable (diff the parameter strings).

**Implications:**
- Some component tokens that "look like" they should migrate will stay as `--tug-color()` because their parameters differ slightly from any base token.

#### [D02] Component token names are immutable (DECIDED) {#d02-names-immutable}

**Decision:** Only the token values (right-hand side of the CSS custom property) change. Token names (left-hand side) remain exactly as they are.

**Rationale:**
- CSS rules throughout the codebase reference these tokens by name. Changing names would require updating all rule call sites.
- Theme files do not override component tokens -- they override base tokens. Name stability ensures no cascade breakage.

**Implications:**
- Some token names will appear semantically mismatched with their new `var()` values (e.g., `--tug-card-header-fg` defined as `var(--tug-base-fg-default)` rather than an explicit color), but this is correct: the name describes the role, the value chains to the source of truth.

#### [D03] Chart threshold tokens migrate to tone tokens (DECIDED) {#d03-chart-threshold}

**Decision:** `--tug-chart-threshold-warning` and `--tug-chart-threshold-danger` (and their gauge equivalents) migrate to `var(--tug-base-tone-warning)` and `var(--tug-base-tone-danger)` respectively.

**Rationale:**
- Per user answer: threshold tokens use warning/danger for consistent semantic meaning.
- Their current values (`--tug-color(yellow)` and `--tug-color(red)`) exactly match the base tone token definitions.

**Implications:**
- Theme overrides to tone-warning or tone-danger will automatically propagate to chart/gauge thresholds.

#### [D04] Code feed/file-status tokens: tone-semantic migration only (DECIDED) {#d04-code-tone-only}

**Decision:** Only tokens with clear tone-semantic meaning AND exact value matches migrate: `--tug-feed-step-error` to `var(--tug-base-tone-danger)`, `--tug-feed-step-complete` to `var(--tug-base-tone-positive)`, `--tug-file-status-added` to `var(--tug-base-tone-positive)`, `--tug-file-status-deleted` to `var(--tug-base-tone-danger)`, `--tug-file-status-modified` to `var(--tug-base-tone-warning)`, `--tug-file-status-renamed` to `var(--tug-base-tone-info)`, `--tug-diff-addition-fg` to `var(--tug-base-tone-positive)`, `--tug-diff-deletion-fg` to `var(--tug-base-tone-danger)`. Note: `--tug-diff-addition-bg` and `--tug-diff-deletion-bg` are excluded because their alpha values (a: 12) differ from the base tone-bg tokens (a: 15), violating [D01].

**Rationale:**
- Per user answer: only migrate tokens that are clearly tone-semantic.
- Other tug-code tokens (terminal, chat, codeBlock) have surface/structural values that map to base surface/fg/border tokens, not tone tokens.

**Implications:**
- The remaining tug-code tokens still migrate to appropriate non-tone base tokens (surfaces, borders, etc.) where exact matches exist.

#### [D05] Picker overlay colors stay as literals (DECIDED) {#d05-picker-literals}

**Decision:** The hardcoded colors in `.gp-picker-preset-dot`, `.gp-picker-crosshair`, `.gp-picker-preset-label` remain as literal rgba/hex values.

**Rationale:**
- Per user answer: these are intentional overlay colors on arbitrary swatch backgrounds, not themed UI.
- They must maintain fixed contrast regardless of theme.

**Implications:**
- These will remain as the only non-token colors in gallery-palette-content.css alongside the token-using error state.

#### [D06] Import error hex values migrate to tone-danger (DECIDED) {#d06-import-error}

**Decision:** The `.gp-import-error` hardcoded hex values (`#cc3333`, `#fff0f0`, `#ffcccc`) migrate to `var(--tug-base-tone-danger-fg)`, `var(--tug-base-tone-danger-bg)`, and `var(--tug-base-tone-danger-border)` respectively.

**Rationale:**
- These represent an error state and should follow the semantic tone system.
- The tone-danger tokens provide theme-aware equivalents.

**Implications:**
- The error message will change appearance slightly (from hardcoded light-theme hex to the dark-theme tone-danger values in Brio), which is the correct behavior -- it was previously broken in dark themes.

#### [D07] Box-shadow rgba stays as literal (DECIDED) {#d07-box-shadow}

**Decision:** The `rgba(0, 0, 0, 0.18)` box-shadow in `.cg-mutation-tx-card` stays as-is and is NOT migrated to `var(--tug-base-shadow-xs)`.

**Rationale:**
- `--tug-base-shadow-xs` is defined as `--tug-color(black, i: 0, t: 0, a: 20)` in Brio, which is close but not an exact match (18% vs 20%), violating [D01].
- More critically, Harmony overrides `--tug-base-shadow-xs` to `--tug-color(black, i: 0, t: 0, a: 8)`. Migrating would change the gallery card shadow from 18% to 8% opacity in Harmony -- a visible regression.
- The gallery demo card is a transient UI element where theme-aware shadow is not essential.

**Implications:**
- The `rgba(0, 0, 0, 0.18)` remains the only hardcoded rgba in gallery-card.css (alongside the hsl gradient and pole fallbacks).

---

### Deep Dives (Optional) {#deep-dives}

#### Token Migration Classification {#token-classification}

**Table T01: Token Classification by File** {#t01-classification}

This table classifies each file's tokens into "migrate" and "keep" categories based on [D01] exact-match analysis. Only "migrate" tokens are changed.

**tug-data.css (28 tokens):**

| Category | Tokens | Migration Target |
|----------|--------|-----------------|
| Migrate | `--tug-table-header-bg`, `--tug-table-header-fg`, `--tug-table-row-bg-selected`, `--tug-table-row-border`, `--tug-table-cell-divider`, `--tug-table-sortIndicator`, `--tug-list-row-selected` | Base surface/fg/highlight/divider tokens |
| Keep | `--tug-table-row-bg-striped` | `--tug-color(white, i: 0, t: 100, a: 2)` -- no exact base match per [D01] |
| Keep | `--tug-table-row-bg-hover`, `--tug-list-row-hover` | `--tug-color(white, i: 0, t: 100, a: 4)` -- no exact base match per [D01] |
| Migrate | `--tug-stat-label`, `--tug-stat-value`, `--tug-stat-trend-positive`, `--tug-stat-trend-negative`, `--tug-stat-trend-neutral` | Base fg/tone tokens |
| Migrate | `--tug-chart-threshold-warning`, `--tug-chart-threshold-danger` | `var(--tug-base-tone-warning)`, `var(--tug-base-tone-danger)` per [D03] |
| Migrate | `--tug-chart-grid`, `--tug-chart-axis`, `--tug-chart-tick` | Base overlay/border tokens |
| Migrate | `--tug-gauge-track`, `--tug-gauge-fill`, `--tug-gauge-needle`, `--tug-gauge-tick-major`, `--tug-gauge-tick-minor`, `--tug-gauge-readout`, `--tug-gauge-threshold-warning`, `--tug-gauge-threshold-danger`, `--tug-gauge-unit`, `--tug-gauge-annotation` | Base separator/accent/fg/tone tokens |
| Keep | `--tug-chart-series-*` (8 tokens) | Chart palette -- specialized data viz colors |

**tug-code.css (42 tokens):**

| Category | Tokens | Migration Target |
|----------|--------|-----------------|
| Migrate (tone) | `--tug-feed-step-error`, `--tug-feed-step-complete`, `--tug-file-status-added`, `--tug-file-status-deleted`, `--tug-file-status-modified`, `--tug-file-status-renamed`, `--tug-diff-addition-fg`, `--tug-diff-deletion-fg` | Tone tokens per [D04] |
| Keep | `--tug-diff-addition-bg`, `--tug-diff-deletion-bg` | Alpha mismatch: component uses a: 12, base tone-bg uses a: 15 -- violates [D01] |
| Migrate (structural) | `--tug-terminal-bg`, `--tug-terminal-fg`, `--tug-terminal-fg-muted`, `--tug-terminal-cursor`, `--tug-terminal-selection-bg`, `--tug-terminal-border` | Base surface/fg/accent/selection/divider tokens |
| Migrate (structural) | `--tug-chat-transcript-bg`, `--tug-chat-message-user-bg`, `--tug-chat-message-assistant-bg`, `--tug-chat-message-system-bg`, `--tug-chat-message-border`, `--tug-chat-composer-bg`, `--tug-chat-composer-border`, `--tug-chat-attachment-bg`, `--tug-chat-attachment-fg`, `--tug-chat-attachment-border` | Base surface/border/fg tokens |
| Migrate (structural) | `--tug-codeBlock-bg`, `--tug-codeBlock-border`, `--tug-codeBlock-header-bg`, `--tug-codeBlock-header-fg` | Base control/divider/fg tokens |
| Migrate (structural) | `--tug-tree-row-bg-selected`, `--tug-tree-row-fg`, `--tug-tree-chevron` | `--tug-tree-row-bg-selected` maps to `--tug-base-control-highlighted-bg` (exact match: orange a: 10); tree-row-fg/chevron map to base fg/border tokens |
| Keep | `--tug-tree-row-bg-hover`, `--tug-tree-row-bg-current` | `--tug-color(white, i: 0, t: 100, a: 4)` and `--tug-color(cyan, i: 50, t: 50, a: 10)` -- no exact base matches per [D01] |
| Migrate (structural) | `--tug-feed-bg`, `--tug-feed-border`, `--tug-feed-step-bg`, `--tug-feed-step-fg`, `--tug-feed-step-active`, `--tug-feed-stream-cursor`, `--tug-feed-handoff` | Base surface/divider/fg/accent/tone tokens |
| Keep | `--tug-syntax-*` (12 tokens) | Syntax highlighting palette |
| Keep | `--tug-terminal-ansi-*` (7 tokens) | ANSI specification colors |

**tug-dock.css (21 tokens):**

| Category | Tokens | Migration Target |
|----------|--------|-----------------|
| Migrate | `--tug-dock-bg`, `--tug-dock-border`, `--tug-dock-indicator`, `--tug-dock-menu-caret`, `--tug-dock-button-fg`, `--tug-dock-button-fg-active`, `--tug-dock-button-fg-attention`, `--tug-dock-button-badge-bg`, `--tug-dock-button-badge-fg`, `--tug-dock-button-insertIndicator`, `--tug-canvas-grid-line` | Base surface/divider/accent/fg/tone/overlay tokens |
| Keep | `--tug-dock-button-bg-hover`, `--tug-dock-button-bg-active` | `--tug-color(white, i: 0, t: 100, a: 8)` and `a: 12` -- no exact base matches per [D01] |
| Keep | `--tug-canvas-grid-emphasis` | `--tug-color(white, i: 0, t: 100, a: 10)` -- no exact base match per [D01] |
| Keep | `--tug-snap-guide`, `--tug-sash-hover`, `--tug-flash-perimeter` | Spatial feedback -- custom alpha blends |
| Keep | `--tug-set-member-border-collapsed`, `--tug-set-member-corner-squared`, `--tug-set-focused-outline`, `--tug-set-hull-flash`, `--tug-set-breakout-flash`, `--tug-set-dropTarget` | Set visualization -- custom alpha blends |

**tug-dialog.css (20 tokens):**

| Category | Tokens | Migration Target |
|----------|--------|-----------------|
| Migrate | `--tug-dialog-bg`, `--tug-dialog-fg`, `--tug-dialog-border` | Base surface/fg/border tokens |
| Migrate | `--tug-sheet-bg`, `--tug-sheet-fg`, `--tug-sheet-border` | Base surface/fg/border tokens |
| Migrate | `--tug-toast-info-bg`, `--tug-toast-info-fg` | Base surface/fg tokens |
| Migrate | `--tug-alert-bg`, `--tug-alert-fg` | Base surface/fg tokens |
| Migrate | `--tug-badge-neutral-bg`, `--tug-badge-neutral-fg`, `--tug-badge-accent-fg` | Base divider/fg/accent tokens |
| Keep | `--tug-badge-accent-bg` | `--tug-color(orange, i: 50, t: 50, a: 20)` -- no exact base match per [D01] |
| Migrate | `--tug-progress-track`, `--tug-progress-fill`, `--tug-spinner` | Base separator/accent tokens |
| Keep | `--tug-skeleton-base`, `--tug-skeleton-highlight` | No exact base match -- `--tug-color(violet, i: 5, t: 20)` and `--tug-color(cobalt+10, i: 7, t: 28)` per [D01] |
| Migrate | `--tug-emptyState-fg`, `--tug-emptyState-icon` | Base fg/border tokens |
| Migrate | `--tug-kbd-bg`, `--tug-kbd-fg`, `--tug-kbd-border` | Base surface/fg/border tokens |

**tug-card.css (20 tokens):**

| Category | Tokens | Migration Target |
|----------|--------|-----------------|
| Migrate | `--tug-card-bg`, `--tug-card-border` | Base surface/border tokens |
| Migrate | `--tug-card-header-fg`, `--tug-card-header-icon-active`, `--tug-card-header-icon-inactive`, `--tug-card-header-divider`, `--tug-card-header-button-fg`, `--tug-card-header-button-fg-danger` | Base fg/icon/divider/tone tokens |
| Keep | `--tug-card-header-button-bg-hover`, `--tug-card-header-button-bg-active` | `--tug-color(white, ...)` with a: 8, a: 12 -- no exact base matches per [D01] |
| Keep | `--tug-card-header-button-fg-danger-hover` | `--tug-color(red-light)` -- no base token match |
| Migrate | `--tug-card-accessory-bg`, `--tug-card-accessory-border`, `--tug-card-findbar-bg`, `--tug-card-findbar-border` | Base surface/border tokens |
| Keep | `--tug-card-shadow-active`, `--tug-card-shadow-inactive`, `--tug-card-dim-overlay` | Card-specific composite shadow values |
| Keep | `--tug-card-header-bg-active`, `--tug-card-header-bg-inactive`, `--tug-card-header-bg-collapsed` | Card-specific header surface colors (violet-9 tints not in base) |
| Keep | `--tug-card-findbar-match`, `--tug-card-findbar-match-active` | Find bar highlight -- custom alpha blends |

**tug-inspector.css (20 tokens):**

| Category | Tokens | Migration Target |
|----------|--------|-----------------|
| Migrate | `--tug-inspector-panel-bg`, `--tug-inspector-panel-border`, `--tug-inspector-panel-bg-pinned`, `--tug-inspector-section-bg`, `--tug-inspector-field-bg`, `--tug-inspector-field-border`, `--tug-inspector-field-readOnly` | Base surface/divider/control tokens |
| Migrate | `--tug-inspector-target-outline`, `--tug-inspector-preview-outline` | Base tone/accent tokens |
| Migrate | `--tug-inspector-emptyState-fg`, `--tug-inspector-emptyState-icon`, `--tug-inspector-swatch-border`, `--tug-inspector-scrub-track`, `--tug-inspector-scrub-thumb`, `--tug-inspector-scrub-active` | Base fg/border/separator/accent tokens |
| Migrate | `--tug-dev-overlay-fg`, `--tug-dev-overlay-border` | Base fg/border tokens |
| Keep | `--tug-inspector-source-token`, `--tug-inspector-source-class`, `--tug-inspector-source-inline`, `--tug-inspector-source-preview` | Source classification -- color-coded category labels |
| Keep | `--tug-inspector-field-inherited`, `--tug-inspector-field-default`, `--tug-inspector-field-preview`, `--tug-inspector-field-cancelled` | Inspector-specific state indicators with custom alpha |
| Keep | `--tug-dev-overlay-bg`, `--tug-dev-overlay-targetHighlight`, `--tug-dev-overlay-targetDim` | Dev overlay -- custom alpha composites |

**tug-tab.css (25 tokens):**

| Category | Tokens | Migration Target |
|----------|--------|-----------------|
| Migrate | `--tug-tab-bar-bg`, `--tug-tab-bg-active`, `--tug-tab-bg-hover`, `--tug-tab-fg-rest`, `--tug-tab-fg-active`, `--tug-tab-fg-compact`, `--tug-tab-close-fg-hover` | Base surface/fg/highlight tokens |
| Migrate | `--tug-tab-underline-active`, `--tug-tab-badge-bg`, `--tug-tab-badge-fg`, `--tug-tab-insertIndicator` | Base accent/fg tokens |
| Migrate | `--tug-tab-overflow-trigger-bg`, `--tug-tab-overflow-trigger-fg`, `--tug-tab-add-fg`, `--tug-tab-typePicker-bg`, `--tug-tab-typePicker-fg` | Base overlay/fg/surface tokens |
| Migrate | `--tug-tab-dropTarget-bg`, `--tug-tab-dropTarget-border` | Base highlight/tone tokens |
| Keep | `--tug-tab-bg-rest` (transparent) | Literal transparent -- no base token needed |
| Keep | `--tug-tab-bg-compact`, `--tug-tab-close-bg-hover`, `--tug-tab-add-bg-hover` | `--tug-color(white, ...)` with a: 4, a: 10, a: 8 -- no exact base matches per [D01] |
| Keep | `--tug-tab-ghost-bg`, `--tug-tab-ghost-border` | Ghost tab -- custom alpha overlay values |

**tug-menu.css (22 tokens):**

| Category | Tokens | Migration Target |
|----------|--------|-----------------|
| Migrate | `--tug-menu-bg`, `--tug-menu-fg`, `--tug-menu-border` | Base surface/fg/border tokens |
| Migrate | `--tug-menu-item-bg-hover`, `--tug-menu-item-bg-selected`, `--tug-menu-item-fg`, `--tug-menu-item-fg-disabled`, `--tug-menu-item-fg-danger`, `--tug-menu-item-meta`, `--tug-menu-item-shortcut`, `--tug-menu-item-icon`, `--tug-menu-item-icon-danger`, `--tug-menu-item-chevron` | Base control/fg/tone/icon/accent tokens |
| Migrate | `--tug-popover-bg`, `--tug-popover-fg`, `--tug-popover-border`, `--tug-tooltip-bg`, `--tug-tooltip-fg`, `--tug-tooltip-border` | Base surface/fg/border tokens |
| Migrate | `--tug-menu-shadow` | Composite shadow value matches `--tug-base-shadow-overlay` exactly (`0 4px 16px --tug-color(black, i: 0, t: 0, a: 60)`) |
| Keep | `--tug-dropdown-*` aliases (14 tokens) | Already `var()` references to `--tug-menu-*` -- no change needed |

---

### Specification {#specification}

**Spec S01: Exact-Match Mapping Reference** {#s01-exact-match-mapping}

The following table maps `--tug-color()` values to their base token equivalents. A component token migrates only if its value appears in the "Source Value" column.

| Source Value | Base Token |
|-------------|-----------|
| `--tug-color(violet, i: 5, t: 11)` | `--tug-base-surface-sunken` |
| `--tug-color(violet, i: 5, t: 12)` | `--tug-base-surface-default` |
| `--tug-color(violet, i: 4, t: 14)` | `--tug-base-surface-overlay` |
| `--tug-color(violet-6, i: 5, t: 6)` | `--tug-base-surface-inset` |
| `--tug-color(violet-6, i: 5, t: 8)` | `--tug-base-control-secondary-bg-rest` |
| `--tug-color(violet-6, i: 4, t: 7)` | `--tug-base-field-bg-focus` (also `--tug-base-focus-ring-offset`) |
| `--tug-color(cobalt+10, i: 7, t: 16)` | `--tug-base-surface-screen` (also `--tug-base-avatar-bg`) |
| `--tug-color(cobalt, i: 3, t: 94)` | `--tug-base-fg-default` |
| `--tug-color(cobalt, i: 5, t: 66)` | `--tug-base-fg-muted` |
| `--tug-color(cobalt+7, i: 7, t: 37)` | `--tug-base-fg-subtle` |
| `--tug-color(cobalt+8, i: 7, t: 23)` | `--tug-base-fg-disabled` |
| `--tug-color(cobalt-8, i: 3, t: 100)` | `--tug-base-fg-inverse` |
| `--tug-color(cobalt, i: 6, t: 30)` | `--tug-base-border-default` |
| `--tug-color(violet-6, i: 6, t: 17)` | `--tug-base-divider-default` (also `--tug-base-separator`) |
| `--tug-color(violet, i: 4, t: 15)` | `--tug-base-divider-muted` |
| `--tug-color(white, i: 0, t: 100, a: 2)` | (no base token -- keep) |
| `--tug-color(white, i: 0, t: 100, a: 4)` | (no base token -- keep) |
| `--tug-color(white, i: 0, t: 100, a: 5)` | `--tug-base-highlight-hover` |
| `--tug-color(white, i: 0, t: 100, a: 6)` | `--tug-base-overlay-highlight` |
| `--tug-color(white, i: 0, t: 100, a: 7)` | `--tug-base-control-ghost-bg-hover` |
| `--tug-color(white, i: 0, t: 100, a: 8)` | (no base token -- keep) |
| `--tug-color(white, i: 0, t: 100, a: 10)` | (no base token -- keep) |
| `--tug-color(white, i: 0, t: 100, a: 12)` | (no base token -- keep) |
| `--tug-color(orange)` | `--tug-base-accent-default` |
| `--tug-color(orange, i: 50, t: 50, a: 10)` | `--tug-base-control-highlighted-bg` |
| `--tug-color(orange, i: 50, t: 50, a: 15)` | `--tug-base-accent-subtle` |
| `--tug-color(orange, i: 50, t: 50, a: 18)` | `--tug-base-control-selected-bg` |
| `--tug-color(orange, i: 50, t: 50, a: 20)` | (no base token -- keep) |
| `--tug-color(cyan)` | `--tug-base-focus-ring-default` (also `--tug-base-icon-active`, `--tug-base-tone-info`) |
| `--tug-color(cyan, i: 50, t: 50, a: 10)` | (no base token -- keep) |
| `--tug-color(cyan, i: 50, t: 50, a: 12)` | `--tug-base-highlight-preview` |
| `--tug-color(cyan, i: 50, t: 50, a: 30)` | (no base token -- keep) |
| `--tug-color(red)` | `--tug-base-tone-danger` |
| `--tug-color(red-light)` | (no base token -- keep) |
| `--tug-color(green)` | `--tug-base-tone-positive` |
| `--tug-color(green, i: 50, t: 50, a: 12)` | (no base token -- keep; `--tug-base-tone-positive-bg` uses a: 15) |
| `--tug-color(green, i: 50, t: 50, a: 15)` | `--tug-base-tone-positive-bg` |
| `--tug-color(yellow)` | `--tug-base-tone-warning` |
| `--tug-color(red, i: 50, t: 50, a: 12)` | (no base token -- keep; `--tug-base-tone-danger-bg` uses a: 15) |
| `--tug-color(red, i: 50, t: 50, a: 15)` | `--tug-base-tone-danger-bg` |
| `--tug-color(black, i: 0, t: 0, a: 60)` | `--tug-base-shadow-md` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Visual regression** | Verify pixel-identical rendering after token value migration | After each file migration step |
| **Token audit** | Grep for remaining `--tug-color()` in body{} blocks to confirm only "keep" tokens remain | After all migration steps |
| **TypeScript** | `bun run typecheck` to verify no TS references broke | After each commit |
| **Theme verification** | Manual inspection across Brio, Bluenote, Harmony | After each step |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Migrate tug-data.css token definitions {#step-1}

**Commit:** `refactor(css): migrate tug-data.css tokens to base semantic references`

**References:** [D01] Exact match only, [D03] Chart threshold tokens, Spec S01, Table T01 (#t01-classification, #d01-exact-match, #d03-chart-threshold)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-data.css`

**Tasks:**
- [ ] Open tug-data.css and locate the `body {}` token block
- [ ] For each token classified as "migrate" in Table T01 tug-data.css section, replace `--tug-color(...)` with the corresponding `var(--tug-base-*)` from Spec S01
- [ ] Specific migrations for tone tokens: `--tug-stat-trend-positive: var(--tug-base-tone-positive)`, `--tug-stat-trend-negative: var(--tug-base-tone-danger)`, `--tug-chart-threshold-warning: var(--tug-base-tone-warning)`, `--tug-chart-threshold-danger: var(--tug-base-tone-danger)`, `--tug-gauge-threshold-warning: var(--tug-base-tone-warning)`, `--tug-gauge-threshold-danger: var(--tug-base-tone-danger)`
- [ ] Leave `--tug-chart-series-*` tokens unchanged (keep)
- [ ] Leave `--tug-table-row-bg-striped` as `--tug-color(white, i: 0, t: 100, a: 2)` -- no exact base match per [D01]
- [ ] Leave `--tug-table-row-bg-hover` and `--tug-list-row-hover` as `--tug-color(white, i: 0, t: 100, a: 4)` -- no exact base match per [D01]
- [ ] Leave `--tug-table-row-bg` as `transparent` -- literal value

**Tests:**
- [ ] Grep audit: `grep '--tug-color' tugdeck/src/components/tugways/tug-data.css` returns only chart-series and "keep" tokens

**Checkpoint:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-data.css` returns only chart-series tokens and any "keep" tokens
- [ ] Visual inspection: data components render identically in Brio theme

---

#### Step 2: Migrate tug-dialog.css token definitions {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(css): migrate tug-dialog.css tokens to base semantic references`

**References:** [D01] Exact match only, Spec S01, Table T01 (#t01-classification, #d01-exact-match)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-dialog.css`

**Tasks:**
- [ ] Migrate dialog/sheet/toast/alert surface tokens to `var(--tug-base-surface-overlay)` and `var(--tug-base-fg-default)` etc.
- [ ] Migrate badge tokens: `--tug-badge-neutral-bg: var(--tug-base-divider-default)`, `--tug-badge-neutral-fg: var(--tug-base-fg-muted)`, `--tug-badge-accent-fg: var(--tug-base-accent-default)`
- [ ] Migrate progress/spinner: `--tug-progress-track: var(--tug-base-separator)`, `--tug-progress-fill: var(--tug-base-accent-default)`, `--tug-spinner: var(--tug-base-accent-default)`
- [ ] Migrate empty state and kbd tokens
- [ ] Verify `--tug-skeleton-base` and `--tug-skeleton-highlight` values: `--tug-color(violet, i: 5, t: 20)` and `--tug-color(cobalt+10, i: 7, t: 28)` -- check if any base token matches. `violet i:5 t:20` does not match any base surface token. Keep both.
- [ ] Verify `--tug-badge-accent-bg: --tug-color(orange, i: 50, t: 50, a: 20)` -- check Spec S01. No exact base match (closest is `--tug-base-accent-bg-emphasis` at `a: 24`). Keep.

**Tests:**
- [ ] Grep audit: `grep '--tug-color' tugdeck/src/components/tugways/tug-dialog.css` returns only skeleton and badge-accent-bg tokens

**Checkpoint:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-dialog.css` returns only skeleton and badge-accent-bg tokens
- [ ] Visual inspection: dialog/toast/badge components render identically in Brio theme

---

#### Step 3: Migrate tug-inspector.css token definitions {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(css): migrate tug-inspector.css tokens to base semantic references`

**References:** [D01] Exact match only, Spec S01, Table T01 (#t01-classification, #d01-exact-match)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-inspector.css`

**Tasks:**
- [ ] Migrate panel tokens: `--tug-inspector-panel-bg: var(--tug-base-surface-sunken)`, `--tug-inspector-panel-border: var(--tug-base-divider-default)`, `--tug-inspector-panel-bg-pinned: var(--tug-base-surface-default)`, `--tug-inspector-section-bg: var(--tug-base-control-secondary-bg-rest)`, `--tug-inspector-field-bg: var(--tug-base-field-bg-focus)`, `--tug-inspector-field-border: var(--tug-base-divider-default)`, `--tug-inspector-field-readOnly: var(--tug-base-surface-sunken)`
- [ ] Migrate outline tokens: `--tug-inspector-target-outline: var(--tug-base-icon-active)`, `--tug-inspector-preview-outline: var(--tug-base-accent-default)`
- [ ] Migrate scrub tokens: `--tug-inspector-scrub-track: var(--tug-base-separator)`, `--tug-inspector-scrub-thumb: var(--tug-base-fg-subtle)`, `--tug-inspector-scrub-active: var(--tug-base-accent-default)`
- [ ] Migrate empty state and swatch tokens
- [ ] Migrate dev overlay: `--tug-dev-overlay-fg: var(--tug-base-fg-default)`, `--tug-dev-overlay-border: var(--tug-base-border-default)`
- [ ] Leave source classification tokens, field state indicators, and dev overlay alpha composites unchanged

**Tests:**
- [ ] Grep audit: `grep '--tug-color' tugdeck/src/components/tugways/tug-inspector.css` returns only "keep" tokens

**Checkpoint:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-inspector.css` returns only "keep" tokens (source-*, field-inherited/default/preview/cancelled, dev-overlay-bg/targetHighlight/targetDim)
- [ ] Visual inspection: inspector panel renders identically in Brio theme

---

#### Step 4: Migrate tug-code.css token definitions {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(css): migrate tug-code.css tokens to base semantic references`

**References:** [D01] Exact match only, [D04] Code tone-only, Spec S01, Table T01 (#t01-classification, #d01-exact-match, #d04-code-tone-only)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-code.css`

**Tasks:**
- [ ] Migrate tone-semantic tokens per [D04]: `--tug-feed-step-error: var(--tug-base-tone-danger)`, `--tug-feed-step-complete: var(--tug-base-tone-positive)`, `--tug-file-status-added: var(--tug-base-tone-positive)`, `--tug-file-status-deleted: var(--tug-base-tone-danger)`, `--tug-file-status-modified: var(--tug-base-tone-warning)`, `--tug-file-status-renamed: var(--tug-base-tone-info)`, `--tug-diff-addition-fg: var(--tug-base-tone-positive)`, `--tug-diff-deletion-fg: var(--tug-base-tone-danger)`
- [ ] Leave `--tug-diff-addition-bg` and `--tug-diff-deletion-bg` as `--tug-color()` -- their alpha (a: 12) differs from base tone-bg tokens (a: 15), violating [D01]
- [ ] Migrate structural terminal tokens: `--tug-terminal-bg: var(--tug-base-surface-inset)`, `--tug-terminal-fg: var(--tug-base-fg-default)`, `--tug-terminal-fg-muted: var(--tug-base-fg-muted)`, `--tug-terminal-cursor: var(--tug-base-accent-default)`, `--tug-terminal-border: var(--tug-base-divider-default)`
- [ ] Check `--tug-terminal-selection-bg: --tug-color(cyan, i: 50, t: 50, a: 30)` -- Spec S01 shows no exact match for `a: 30`. Keep.
- [ ] Migrate chat tokens: `--tug-chat-transcript-bg: var(--tug-base-field-bg-focus)` (violet-6 i:4 t:7), `--tug-chat-message-user-bg: var(--tug-base-surface-default)` (violet i:5 t:12), `--tug-chat-message-assistant-bg: var(--tug-base-surface-sunken)` (violet i:5 t:11), `--tug-chat-message-border: var(--tug-base-divider-default)` (violet-6 i:6 t:17), `--tug-chat-composer-bg: var(--tug-base-surface-default)` (violet i:5 t:12), `--tug-chat-composer-border: var(--tug-base-border-default)` (cobalt i:6 t:30), `--tug-chat-attachment-bg: var(--tug-base-surface-overlay)` (violet i:4 t:14), `--tug-chat-attachment-border: var(--tug-base-border-default)` (cobalt i:6 t:30), `--tug-chat-attachment-fg: var(--tug-base-fg-muted)` (cobalt i:5 t:66)
- [ ] Migrate codeBlock tokens: `--tug-codeBlock-bg: var(--tug-base-control-secondary-bg-rest)`, `--tug-codeBlock-border: var(--tug-base-divider-default)`, `--tug-codeBlock-header-bg: var(--tug-base-surface-sunken)`, `--tug-codeBlock-header-fg: var(--tug-base-fg-subtle)`
- [ ] Migrate tree tokens: `--tug-tree-row-fg: var(--tug-base-fg-default)`, `--tug-tree-chevron: var(--tug-base-border-default)`, `--tug-tree-row-bg-selected: var(--tug-base-control-highlighted-bg)` (exact match: `--tug-color(orange, i: 50, t: 50, a: 10)`)
- [ ] Leave `--tug-tree-row-bg-hover` and `--tug-tree-row-bg-current` as `--tug-color()` -- no exact base matches per [D01]
- [ ] Migrate feed structural tokens: `--tug-feed-border: var(--tug-base-divider-default)`, `--tug-feed-step-bg: var(--tug-base-surface-sunken)`, `--tug-feed-step-fg: var(--tug-base-fg-muted)`, `--tug-feed-step-active: var(--tug-base-accent-default)`, `--tug-feed-stream-cursor: var(--tug-base-accent-default)`
- [ ] Check `--tug-feed-bg: --tug-color(violet-6, i: 4, t: 7)` -- matches `--tug-base-field-bg-focus`. Migrate.
- [ ] Check `--tug-feed-handoff: --tug-color(cyan)` -- matches `--tug-base-tone-info`. Migrate.
- [ ] Check `--tug-chat-message-system-bg: --tug-color(cyan, i: 50, t: 50, a: 7)` -- no exact base match. Keep.
- [ ] Leave syntax tokens and ANSI tokens unchanged

**Tests:**
- [ ] Grep audit: `grep '--tug-color' tugdeck/src/components/tugways/tug-code.css` returns only syntax-*, terminal-ansi-*, and other "keep" tokens

**Checkpoint:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-code.css` returns only syntax-*, terminal-ansi-*, terminal-selection-bg, tree-row-bg-hover, tree-row-bg-current, diff-addition-bg, diff-deletion-bg, chat-message-system-bg, and any other "keep" tokens
- [ ] Visual inspection: terminal, chat, and feed components render identically in Brio theme

---

#### Step 5: Migrate tug-dock.css token definitions {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(css): migrate tug-dock.css tokens to base semantic references`

**References:** [D01] Exact match only, Spec S01, Table T01 (#t01-classification, #d01-exact-match)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-dock.css`

**Tasks:**
- [ ] Migrate dock tokens: `--tug-dock-bg: var(--tug-base-field-bg-focus)`, `--tug-dock-border: var(--tug-base-divider-default)`, `--tug-dock-indicator: var(--tug-base-accent-default)`, `--tug-dock-menu-caret: var(--tug-base-fg-subtle)`
- [ ] Migrate dock button tokens: `--tug-dock-button-fg: var(--tug-base-fg-subtle)`, `--tug-dock-button-fg-active: var(--tug-base-accent-default)`, `--tug-dock-button-fg-attention: var(--tug-base-tone-warning)`, `--tug-dock-button-badge-bg: var(--tug-base-tone-danger)`, `--tug-dock-button-badge-fg: var(--tug-base-fg-inverse)`, `--tug-dock-button-insertIndicator: var(--tug-base-icon-active)`
- [ ] Check dock button hover/active: `--tug-dock-button-bg-hover: --tug-color(white, i: 0, t: 100, a: 8)` and `--tug-dock-button-bg-active: --tug-color(white, i: 0, t: 100, a: 12)` -- no exact base match for `a: 8` or `a: 12`. Keep.
- [ ] Migrate canvas tokens: `--tug-canvas-grid-line` uses `a: 5` -- matches `--tug-base-highlight-hover` (which is `white a: 5`). Migrate. `--tug-canvas-grid-emphasis` uses `a: 10` -- no exact base match. Keep.
- [ ] Leave snap/sash/flash/set tokens unchanged

**Tests:**
- [ ] Grep audit: `grep '--tug-color' tugdeck/src/components/tugways/tug-dock.css` returns only "keep" tokens

**Checkpoint:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-dock.css` returns only dock-button-bg-hover/active, canvas-grid-emphasis, snap-*, sash-*, flash-*, set-* tokens
- [ ] Visual inspection: dock and canvas render identically in Brio theme

---

#### Step 6: Migrate tug-menu.css token definitions {#step-6}

**Depends on:** #step-5

**Commit:** `refactor(css): migrate tug-menu.css tokens to base semantic references`

**References:** [D01] Exact match only, Spec S01, Table T01 (#t01-classification, #d01-exact-match)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-menu.css`

**Tasks:**
- [ ] Migrate menu surface tokens: `--tug-menu-bg: var(--tug-base-surface-overlay)`, `--tug-menu-fg: var(--tug-base-fg-default)`, `--tug-menu-border: var(--tug-base-border-default)`
- [ ] Migrate menu item tokens: `--tug-menu-item-bg-hover: var(--tug-base-control-ghost-bg-hover)`, `--tug-menu-item-fg: var(--tug-base-fg-default)`, `--tug-menu-item-fg-disabled: var(--tug-base-fg-disabled)`, `--tug-menu-item-fg-danger: var(--tug-base-tone-danger)`, `--tug-menu-item-meta: var(--tug-base-fg-subtle)`, `--tug-menu-item-shortcut: var(--tug-base-fg-subtle)`, `--tug-menu-item-icon: var(--tug-base-fg-muted)`, `--tug-menu-item-icon-danger: var(--tug-base-tone-danger)`, `--tug-menu-item-chevron: var(--tug-base-fg-subtle)`
- [ ] Migrate `--tug-menu-item-bg-selected: var(--tug-base-accent-subtle)` (exact match: `--tug-color(orange, i: 50, t: 50, a: 15)`)
- [ ] Migrate menu shadow: `--tug-menu-shadow: 0 4px 16px --tug-color(black, i: 0, t: 0, a: 60)` -- this matches `--tug-base-shadow-overlay` exactly (`0 4px 16px --tug-color(black, i: 0, t: 0, a: 60)`). Migrate: `--tug-menu-shadow: var(--tug-base-shadow-overlay)`
- [ ] Migrate popover/tooltip: `--tug-popover-bg: var(--tug-base-surface-overlay)`, `--tug-popover-fg: var(--tug-base-fg-default)`, `--tug-popover-border: var(--tug-base-border-default)`, `--tug-tooltip-bg: var(--tug-base-surface-screen)`, `--tug-tooltip-fg: var(--tug-base-fg-default)`, `--tug-tooltip-border: var(--tug-base-border-default)`
- [ ] Leave dropdown aliases unchanged (already `var()` references)

**Tests:**
- [ ] Grep audit: `grep '--tug-color' tugdeck/src/components/tugways/tug-menu.css` returns zero matches in the body{} token block (all tokens migrated or are `--tug-dropdown-*` var() aliases)

**Checkpoint:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-menu.css` returns zero matches
- [ ] Visual inspection: dropdown menus and tooltips render identically in Brio theme

---

#### Step 7: Migrate tug-tab.css token definitions {#step-7}

**Depends on:** #step-6

**Commit:** `refactor(css): migrate tug-tab.css tokens to base semantic references`

**References:** [D01] Exact match only, Spec S01, Table T01 (#t01-classification, #d01-exact-match)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab.css`

**Tasks:**
- [ ] Migrate tab bar/tab tokens: `--tug-tab-bar-bg: var(--tug-base-surface-sunken)`, `--tug-tab-bg-active: var(--tug-base-surface-default)`, `--tug-tab-fg-rest: var(--tug-base-fg-subtle)`, `--tug-tab-fg-active: var(--tug-base-fg-default)`, `--tug-tab-fg-compact: var(--tug-base-fg-muted)`
- [ ] Check `--tug-tab-bg-hover: --tug-color(white, i: 0, t: 100, a: 5)` -- matches `--tug-base-highlight-hover`. Migrate.
- [ ] Check `--tug-tab-bg-compact: --tug-color(white, i: 0, t: 100, a: 4)` -- no exact base match. Keep.
- [ ] Check `--tug-tab-close-bg-hover: --tug-color(white, i: 0, t: 100, a: 10)` -- no exact base match. Keep.
- [ ] Migrate accent tokens: `--tug-tab-underline-active: var(--tug-base-accent-default)`, `--tug-tab-badge-bg: var(--tug-base-accent-default)`, `--tug-tab-badge-fg: var(--tug-base-fg-inverse)`, `--tug-tab-insertIndicator: var(--tug-base-accent-default)`
- [ ] Migrate overflow/add tokens: `--tug-tab-overflow-trigger-fg: var(--tug-base-fg-muted)`, `--tug-tab-add-fg: var(--tug-base-fg-subtle)`, `--tug-tab-typePicker-bg: var(--tug-base-surface-default)`, `--tug-tab-typePicker-fg: var(--tug-base-fg-muted)`
- [ ] Check `--tug-tab-overflow-trigger-bg: --tug-color(white, i: 0, t: 100, a: 6)` -- matches `--tug-base-overlay-highlight`. Migrate.
- [ ] Check `--tug-tab-add-bg-hover: --tug-color(white, i: 0, t: 100, a: 8)` -- no exact base match. Keep.
- [ ] Migrate drop target: `--tug-tab-dropTarget-bg: var(--tug-base-highlight-preview)`, `--tug-tab-dropTarget-border: var(--tug-base-icon-active)`
- [ ] Leave ghost tab tokens unchanged (custom alpha)
- [ ] Verify `--tug-tab-close-fg-hover: var(--tug-base-fg-default)` -- `--tug-color(cobalt, i: 3, t: 94)` matches. Migrate.

**Tests:**
- [ ] Grep audit: `grep '--tug-color' tugdeck/src/components/tugways/tug-tab.css` returns only "keep" tokens

**Checkpoint:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-tab.css` returns only tab-bg-rest, tab-bg-compact, tab-close-bg-hover, tab-add-bg-hover, tab-ghost-bg, tab-ghost-border tokens
- [ ] Visual inspection: tab bar renders identically in Brio theme

---

#### Step 8: Migrate tug-card.css token definitions {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(css): migrate tug-card.css tokens to base semantic references`

**References:** [D01] Exact match only, Spec S01, Table T01 (#t01-classification, #d01-exact-match)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-card.css`

**Tasks:**
- [ ] Migrate card tokens: `--tug-card-bg: var(--tug-base-surface-overlay)`, `--tug-card-border: var(--tug-base-border-default)`
- [ ] Migrate header tokens: `--tug-card-header-fg: var(--tug-base-fg-default)`, `--tug-card-header-icon-active: var(--tug-base-icon-active)`, `--tug-card-header-icon-inactive: var(--tug-base-fg-subtle)`, `--tug-card-header-divider: var(--tug-base-divider-default)`, `--tug-card-header-button-fg: var(--tug-base-fg-muted)`, `--tug-card-header-button-fg-danger: var(--tug-base-tone-danger)`
- [ ] Check `--tug-card-header-button-bg-hover: --tug-color(white, i: 0, t: 100, a: 8)` -- no exact base match. Keep.
- [ ] Check `--tug-card-header-button-bg-active: --tug-color(white, i: 0, t: 100, a: 12)` -- no exact base match. Keep.
- [ ] Check `--tug-card-header-button-fg-danger-hover: --tug-color(red-light)` -- no base match. Keep.
- [ ] Migrate accessory/findbar: `--tug-card-accessory-bg: var(--tug-base-surface-sunken)`, `--tug-card-accessory-border: var(--tug-base-border-default)`, `--tug-card-findbar-bg: var(--tug-base-field-bg-focus)`, `--tug-card-findbar-border: var(--tug-base-border-default)`
- [ ] Leave shadow tokens, header bg tokens, and findbar match tokens unchanged

**Tests:**
- [ ] Grep audit: `grep '--tug-color' tugdeck/src/components/tugways/tug-card.css` returns only "keep" tokens

**Checkpoint:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-card.css` returns only card-shadow-*, card-dim-overlay, card-header-bg-*, card-header-button-bg-*, card-header-button-fg-danger-hover, card-findbar-match-* tokens
- [ ] Visual inspection: card header and card body render identically in Brio theme

---

#### Step 9: Fix gallery hardcoded colors {#step-9}

**Depends on:** #step-8

**Commit:** `fix(css): replace hardcoded hex colors in gallery CSS with semantic tokens`

**References:** [D05] Picker literals, [D06] Import error, [D07] Box-shadow stays literal, (#d05-picker-literals, #d06-import-error, #d07-box-shadow)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-palette-content.css`

**Tasks:**
- [ ] In gallery-palette-content.css, migrate `.gp-import-error`: replace `color: #cc3333` with `color: var(--tug-base-tone-danger-fg)`, replace `background-color: #fff0f0` with `background-color: var(--tug-base-tone-danger-bg)`, replace `border: 1px solid #ffcccc` with `border: 1px solid var(--tug-base-tone-danger-border)`
- [ ] Leave `.gp-picker-preset-dot` rgba values unchanged per [D05]
- [ ] Leave `.gp-picker-crosshair` hex/rgba values unchanged per [D05]
- [ ] Leave `.gp-picker-preset-label` hex/text-shadow values unchanged per [D05]
- [ ] In gallery-card.css, leave `.cg-mutation-tx-card` box-shadow `rgba(0, 0, 0, 0.18)` unchanged per [D07] (not an exact match; Harmony override would cause visible regression)
- [ ] Leave `.cg-hue-swatch` hsl() gradient unchanged (full-spectrum display)
- [ ] Leave `.tug-pole` and `.tug-pole-inner` fallback hex values unchanged (they are CSS fallback defaults, not primary values)

**Tests:**
- [ ] Grep audit: `grep '#cc3333\|#fff0f0\|#ffcccc' tugdeck/src/components/tugways/cards/gallery-palette-content.css` returns 0 matches

**Checkpoint:**
- [ ] `grep -E '#[0-9a-fA-F]{3,8}|rgba?\(' tugdeck/src/components/tugways/cards/gallery-palette-content.css` returns only picker overlay colors and font-family fallbacks
- [ ] Visual inspection: gallery card import error renders with theme-appropriate danger colors

---

#### Step 10: Integration Checkpoint {#step-10}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** [D01] Exact match only, [D02] Names immutable, Table T01, Spec S01 (#success-criteria, #t01-classification)

**Tasks:**
- [ ] Run `bun run typecheck` to verify no TypeScript errors
- [ ] Audit all 8 component CSS files: grep for `--tug-color()` in body{} blocks and confirm every remaining instance is in the "keep" classification from Table T01
- [ ] Switch to Brio theme and verify pixel-identical rendering (no visual changes expected)
- [ ] Switch to Bluenote theme and verify visual correctness -- component tokens now inherit Bluenote's `--tug-base-*` overrides (visual changes expected and intended per #success-criteria)
- [ ] Switch to Harmony theme and verify visual correctness -- Harmony's direct component-token overrides take precedence, so most components are unchanged; any component tokens Harmony does NOT override now inherit Harmony's base token values

**Tests:**
- [ ] `bun run typecheck` exits 0
- [ ] Aggregate grep audit across all 8 component CSS files confirms only "keep" tokens retain `--tug-color()`

**Checkpoint:**
- [ ] `bun run typecheck` exits 0
- [ ] Brio theme: pixel-identical, no visual changes
- [ ] Bluenote theme: components inherit proper theme values, visually appropriate
- [ ] Harmony theme: components with direct overrides unchanged, others inherit base values
- [ ] No "migrate" classified tokens still use `--tug-color()` values

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All component-level CSS token definitions that duplicate base token values now reference `var(--tug-base-*)` instead, and all hardcoded hex error-state colors use semantic tone tokens.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All 8 component CSS files migrated (tug-data.css, tug-code.css, tug-dock.css, tug-dialog.css, tug-card.css, tug-inspector.css, tug-tab.css, tug-menu.css)
- [ ] Gallery hardcoded hex colors fixed (gallery-palette-content.css, gallery-card.css)
- [ ] `bun run typecheck` passes with zero errors
- [ ] Visual verification: Brio pixel-identical; Bluenote gains proper theme propagation (intended); Harmony unchanged for directly-overridden tokens
- [ ] Grep audit confirms only "keep" classified tokens retain `--tug-color()` values

**Acceptance tests:**
- [ ] `grep '--tug-color' tugdeck/src/components/tugways/tug-data.css | wc -l` returns count matching chart-series (8) + keep tokens only
- [ ] `grep '#cc3333\|#fff0f0\|#ffcccc' tugdeck/src/components/tugways/cards/gallery-palette-content.css` returns 0 matches

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Migrate Harmony and Bluenote theme files' direct component-token overrides to `var(--tug-base-*)` references. Harmony overrides ~80 component tokens directly (card, tab, dock, menu, dialog, code, inspector, data). After this plan, those overrides could be replaced with base-token references, reducing theme file size and ensuring single-source-of-truth consistency. Bluenote overrides fewer component tokens but would benefit from the same treatment.
- [ ] Consider adding a dedicated `--tug-base-surface-field` token (or similar) to decouple the 5 component background tokens (`--tug-dock-bg`, `--tug-chat-transcript-bg`, `--tug-feed-bg`, `--tug-inspector-field-bg`, `--tug-card-findbar-bg`) that currently chain to `--tug-base-field-bg-focus` via value match. If a future theme changes `field-bg-focus` for form-field purposes, these unrelated backgrounds would change unexpectedly.
- [ ] Audit whether "keep" tokens with custom alpha values could benefit from new base tokens in a future tug-base.css expansion
- [ ] Consider migrating `.tug-pole` fallback hex values to `var()` with fallbacks once CSS custom property fallback support is confirmed across targets
- [ ] Consider adding base tokens for the `white a: 4`, `white a: 8`, `white a: 10`, `white a: 12` values used across multiple component files

| Checkpoint | Verification |
|------------|--------------|
| Component tokens migrated | Grep audit of body{} blocks in all 8 files |
| Gallery hex colors fixed | Grep for hardcoded hex in gallery CSS files |
| TypeScript clean | `bun run typecheck` exits 0 |
| Visual regression-free | Manual inspection across 3 themes |
