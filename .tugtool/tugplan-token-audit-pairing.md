<!-- tugplan-skeleton v2 -->

## Token Audit and Pairing Extraction {#token-audit-pairing}

**Purpose:** Produce the authoritative foreground-on-background pairing list by auditing every component CSS file, regularize the 373 token names so element-vs-surface classification is mechanical, close all gaps in element-surface-pairing-map.ts, and establish CSS comment conventions for declaring pairings in each component file.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | token-audit-pairing |
| Last updated | 2026-03-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The theme system's contrast engine validates accessibility by checking foreground-on-background token pairs declared in `element-surface-pairing-map.ts`. However, the current map was hand-curated by reasoning about what should need checking rather than by observing what components actually render. The result: the card title bar renders `fg-default` on `tab-bg-active` but this pairing is missing from the map. The contrast engine never checks it, the UI shows illegible text in Harmony light, and the tests pass.

The root cause is twofold: (1) token naming uses 4+ different conventions for background tokens (`bg-*`, `surface-*`, `tab-bg-*`, `control-*-bg-*`, `field-bg-*`) and 7+ for foreground tokens, making mechanical classification impossible, and (2) no convention exists for components to declare the pairings they use. This phase solves both problems and produces the authoritative pairing list that Phase 2 of the theme-system-overhaul will consume.

#### Strategy {#strategy}

- Audit all 23 component CSS files in `tugdeck/src/components/tugways/` including `cards/` subdirectory, extracting every `color`/`fill` token paired with the `background-color` token in the same rendering context.
- Record pairings at both the component-alias level (e.g., `--tug-card-title-bar-fg` on `--tug-card-title-bar-bg-active`) and the resolved `--tug-base-*` level (e.g., `--tug-base-fg-default` on `--tug-base-tab-bg-active`) for engine consumption.
- Design and execute a full token rename that makes element-vs-surface classification mechanical from the token name alone.
- Update `generate-tug-tokens.ts`, all component CSS files, and `element-surface-pairing-map.ts` to use the new names.
- Compare extracted pairings against the current 239-entry map, identify all gaps, and add them.
- Establish a parseable CSS comment convention (`@tug-pairings` blocks) in every component CSS file.

#### Success Criteria (Measurable) {#success-criteria}

- Every component CSS file in `tugways/` and `tugways/cards/` has a `@tug-pairings` comment block listing all foreground-on-background pairings used by that component (verified by grep count matching file count).
- Every pairing declared in the CSS comment blocks has a corresponding entry in `element-surface-pairing-map.ts` (verified by a cross-check script).
- Token names follow the regularized naming convention such that every `--tug-base-*` color token is classifiable as element, surface, or chromatic (verified by running the classification logic against the full token list with zero unclassified color tokens).
- `bun run generate:tokens` succeeds with zero errors after the rename.
- All existing tests pass after the rename (`cd tugcode && cargo nextest run`; `bun test` in tugdeck).

#### Scope {#scope}

1. Audit all 23 CSS files: `tug-button.css`, `tug-card.css`, `tug-tab.css`, `tug-menu.css`, `tug-dialog.css`, `tug-badge.css`, `tug-switch.css`, `tug-checkbox.css`, `tug-input.css`, `tug-label.css`, `tug-marquee.css`, `tug-data.css`, `tug-code.css`, `tug-dock.css`, `tug-hue-strip.css`, `tug-skeleton.css`, `tug-inspector.css`, `style-inspector-overlay.css`, `gallery-card.css`, `gallery-badge-mockup.css`, `gallery-popup-button.css`, `gallery-palette-content.css`, `gallery-theme-generator-content.css`
2. Full token rename across generated tokens, component CSS, and pairing map
3. Gap analysis and pairing map completion
4. CSS comment convention (`@tug-pairings`) in all component files

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the contrast engine algorithm or enforcement logic (Phase 2)
- Modifying recipe formulas or `DerivationFormulas` interface (Phase 3)
- Building a build-time tool that parses the `@tug-pairings` comments automatically (future follow-on; the convention is established here for future tooling)
- Adding new tokens that do not already exist in the system

#### Dependencies / Prerequisites {#dependencies}

- The Contrast Engine Overhaul (PR #131) must be merged (it is: commit `b664babc`)
- `semantic-formula-architecture` plan is complete (commit `a07f963e`)

#### Constraints {#constraints}

- Token rename must be atomic: generate-tug-tokens.ts, all CSS files, and the pairing map must all be updated in the same commit to avoid breakage
- `style-inspector-overlay.css` uses hardcoded oklch values (not tokens) for dev tooling; it is in scope for pairing audit but its hardcoded colors are not subject to rename
- The `--tug-base-*` prefix must be preserved (it is the canonical namespace)

#### Assumptions {#assumptions}

- The contrast roles (body-text, subdued-text, large-text, ui-component, decorative) remain unchanged
- The `style-inspector-overlay.css` and `tug-inspector.css` are in scope for the audit
- The gap between `tab-fg-active` on `tab-bg-active` (already in map) and `fg-default` on `tab-bg-active` (used by `.tugcard-title`) is the most visible gap to confirm and resolve
- Component-alias tokens (e.g., `--tug-card-title-bar-fg`) resolve to `--tug-base-*` tokens and the pairing map records the resolved `--tug-base-*` level

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor}` anchors on all headings that are referenced elsewhere. All anchors are kebab-case, lowercase, no phase numbers.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token rename breaks runtime CSS | high | medium | Atomic commit; full visual regression check | Any visual artifact after rename commit |
| Audit misses a pairing in a deeply nested selector | medium | medium | Systematic file-by-file audit with checklist; cross-check script | New pairing gap discovered post-audit |
| Rename creates merge conflicts with in-flight branches | medium | low | Coordinate timing; rename is self-contained | Other branches touching component CSS |

**Risk R01: Atomic rename breaks runtime CSS** {#r01-rename-breakage}

- **Risk:** Renaming 373 tokens across generated output, 23 CSS files, and the pairing map may introduce a typo or missed reference, causing visual breakage at runtime.
- **Mitigation:**
  - Use find-and-replace tooling with exact string matching (not regex) for each token rename
  - Run `bun run generate:tokens` immediately after updating the generation script to verify generated output matches expectations
  - Run full test suite and visually verify the gallery card renders correctly
- **Residual risk:** A hardcoded token name in a JS/TS file outside the audited scope could reference the old name.

**Risk R02: Pairing audit misses a rendering context** {#r02-missed-pairing}

- **Risk:** A foreground-on-background pairing exists at runtime (e.g., via JS-injected styles or inherited color) but is not visible in static CSS analysis.
- **Mitigation:**
  - Audit inline styles set in JS/TS component files alongside CSS
  - Cross-check the `@tug-pairings` comment blocks against the pairing map with a verification script
  - The `@tug-pairings` convention enables future tooling to catch drift
- **Residual risk:** Dynamically computed pairings (e.g., `--demo-bg`) may not be capturable.

---

### Design Decisions {#design-decisions}

#### [D01] Token naming regularization uses element/surface suffix convention (DECIDED) {#d01-element-surface-naming}

**Decision:** Every `--tug-base-*` color token is classified into exactly one of three categories: "element" (foreground: text, icon, border rendered on a surface), "surface" (background: things render on top of it), or "chromatic" (dual-use: a pure chromatic value used as either element or surface depending on rendering context). The classification is encoded by a consistent suffix or segment in the token name, not by prefix alone. Non-color tokens (spacing, radius, font, opacity, motion, sizing) are excluded from classification entirely.

**Rationale:**
- The current system uses 4+ background conventions (`bg-*`, `surface-*`, `tab-bg-*`, `control-*-bg-*`, `field-bg-*`) and 7+ foreground conventions, making mechanical extraction impossible
- A regex-classifiable naming scheme enables future build-time pairing extraction
- Regularization is a prerequisite for the contrast engine to validate all pairings
- Some tokens are genuinely dual-use (e.g., `accent-default` is used as foreground color in text and as background in active mode buttons; `tone-accent` is a chromatic signal value). These require a third category rather than forced classification.

**Implications:**
- All existing `surface-*` tokens retain the `surface-` prefix (already classifiable as surface)
- `bg-app` and `bg-canvas` are already classifiable (have `bg-` prefix)
- `control-*-bg-*` tokens already contain `-bg-` and are classifiable as surface
- `field-bg-*` tokens already contain `-bg-` (classifiable as surface); `field-fg` needs rename to `field-fg-default` for consistency
- `tab-bg-*` and `tab-fg-*` are already classifiable
- `icon-*` color tokens already match the element regex (`icon-` is an element segment) and are NOT renamed; naming-consistency rename is deferred to reduce scope and risk. Non-color `icon-size-*` tokens are excluded from classification (they are invariant sizing tokens).
- `toggle-icon-*` tokens similarly already match the element regex and are not renamed
- `badge-tinted-*-bg/fg` are already classifiable
- Dual-use tokens classified as "chromatic": `accent-default`, `accent-cool-default`, `accent-subtle`, bare `tone-*` (7 families: `tone-accent`, `tone-active`, `tone-agent`, `tone-data`, `tone-success`, `tone-caution`, `tone-danger`), `highlight-*` (6 tokens), `overlay-*` (3 tokens), `toggle-track-*` (7 tokens), `toggle-thumb` / `toggle-thumb-disabled`, `radio-dot`, `field-tone-*` (3 tokens). These are explicitly listed in the pairing map with their role determined per usage context.
- The classification regex (applied only to color tokens after non-color exclusion): surface tokens match `/(bg-|surface-)/`, element tokens match `/(fg-|border-|divider-|shadow-)/` plus `icon-` color tokens (excluding `icon-size-`). Chromatic tokens match the explicit enumerated list. Post-rename, `checkmark-fg` and `checkmark-fg-mixed` match via `-fg-`; `divider-separator` matches via `divider-`. Non-color tokens (containing `size-`, `radius-`, `font-`, `space-`, `motion-`, `opacity`, `chrome-height`) are excluded before classification.

#### [D02] Pairing map records resolved tug-base-level tokens (DECIDED) {#d02-base-level-pairings}

**Decision:** The `element-surface-pairing-map.ts` records pairings at the `--tug-base-*` resolved level, not at the component-alias level. Component-alias pairings are documented in the `@tug-pairings` CSS comment blocks for human readability.

**Rationale:**
- The contrast engine operates on resolved token values from `deriveTheme()`, which outputs `--tug-base-*` tokens
- Multiple component aliases may resolve to the same base token; recording at the base level avoids duplicate entries
- Human-readable component-level pairings live in the CSS comment blocks where they are most useful

**Implications:**
- The `@tug-pairings` comment blocks list both the component-alias and the resolved base token
- The pairing map is the single source of truth for the contrast engine
- Adding a new component pairing requires updating both the CSS comment block and the pairing map

#### [D03] CSS comment convention uses @tug-pairings structured block (DECIDED) {#d03-css-comment-convention}

**Decision:** Every component CSS file includes a `@tug-pairings` comment block at the top of the file (after the file docblock) that lists all foreground-on-background pairings used by the component.

**Rationale:**
- Provides a single, grep-able location in each file for all pairings
- Parseable by future build-time tooling
- Co-located with the CSS rules that create the pairings, reducing drift

**Implications:**
- The format is a structured comment block parseable by a future build tool
- Each pairing entry includes: element token, surface token, contrast role, rendering context description
- Decorative elements (shadows, dividers with no text) are listed with role "decorative"

#### [D04] Rename scope includes generated tokens, all CSS files, and pairing map atomically (DECIDED) {#d04-atomic-rename}

**Decision:** The token rename is executed as an atomic operation in a single commit: `tugdeck/scripts/generate-tug-tokens.ts`, `tugdeck/src/components/tugways/derivation-rules.ts` (defines all token names as map keys), `tugdeck/src/components/tugways/theme-derivation-engine.ts`, all 23 component CSS files, the pairing map, all test files referencing old token names (notably `theme-derivation-engine.test.ts`, `contrast-dashboard.test.tsx`, `gallery-theme-generator-content.test.tsx`), and all `cards/*.tsx` files that set CSS variables programmatically are all updated together.

**Rationale:**
- Partial rename would break CSS custom property resolution, causing visual failures
- A single commit enables clean revert if problems are found
- The rename is mechanical (exact string replacement) and can be verified by build + test

**Implications:**
- The rename commit will be large but entirely mechanical
- A pre-rename snapshot of the token list serves as a verification checklist
- `derivation-rules.ts` has ~20 references to renamed tokens and is the primary source of token name definitions
- `cards/*.tsx` files set CSS variables programmatically (~10 files with inline style references) and must be audited for old token names

---

### Specification {#specification}

#### Token Classification Regex {#token-classification}

**Spec S01: Element/Surface/Chromatic Classification** {#s01-classification}

After the rename, every `--tug-base-*` token is classifiable by a two-phase process:

**Phase 1 — Exclude non-color tokens.** Tokens matching any of these patterns are non-color (sizing, spacing, layout, typography, motion) and are excluded from classification entirely:
- Contains `size-` (e.g., `icon-size-sm`, `font-size-md`)
- Contains `radius-`, `space-`, `font-`, `motion-`, `chrome-height`
- Contains `opacity`, `easing`, `duration`
- Type is `invariant` and value is a length/time/string (not a color)

**Phase 2 — Classify color tokens into exactly one of three categories:**

- **Surface (background):** token name contains `-bg-` or `-surface-` or is exactly one of the named surface tokens (`bg-app`, `bg-canvas`)
- **Element (foreground):** token name contains `-fg-` or `-border-` or `-divider-` or `-shadow-` or matches one of the explicit element token patterns (`checkmark-fg`, `checkmark-fg-mixed`, `divider-separator`). Color tokens containing `icon-` (but not `icon-size-`) also classify as element.
- **Chromatic (dual-use):** tokens that are pure chromatic signal values used as both foreground and background depending on context. These are explicitly enumerated:
  - `accent-default`, `accent-cool-default`, `accent-subtle`
  - Bare `tone-*` tokens (7 families: `tone-accent`, `tone-active`, `tone-agent`, `tone-data`, `tone-success`, `tone-caution`, `tone-danger`)
  - `tone-*-bg` tokens (7 tokens) — these have `-bg-` and classify as surface, NOT chromatic
  - `tone-*-border` tokens (7 tokens) — these have `-border-` and classify as element, NOT chromatic
  - `tone-*-icon` tokens (7 tokens) — these have `icon-` and classify as element, NOT chromatic
  - `highlight-*` tokens (6: `highlight-hover`, `highlight-dropTarget`, `highlight-preview`, `highlight-inspectorTarget`, `highlight-snapGuide`, `highlight-flash`)
  - `overlay-*` tokens (3: `overlay-dim`, `overlay-scrim`, `overlay-highlight`)
  - `toggle-track-*` tokens (7: `toggle-track-off`, `toggle-track-off-hover`, `toggle-track-on`, `toggle-track-on-hover`, `toggle-track-disabled`, `toggle-track-mixed`, `toggle-track-mixed-hover`)
  - `toggle-thumb`, `toggle-thumb-disabled`
  - `radio-dot`
  - `field-tone-*` tokens (3: `field-tone-danger`, `field-tone-caution`, `field-tone-success`)
- **Unclassified:** zero color tokens should be unclassified after the rename. If any color token cannot be placed into element, surface, or chromatic, the classification is incomplete.

#### @tug-pairings Comment Block Format {#pairing-comment-format}

**Spec S02: @tug-pairings Comment Block** {#s02-pairings-block}

```css
/**
 * @tug-pairings
 * | Element                              | Surface                              | Role         | Context                           |
 * |---------------------------------------|---------------------------------------|--------------|-----------------------------------|
 * | --tug-card-title-bar-fg (fg-default)  | --tug-card-title-bar-bg-active (tab-bg-active) | body-text    | Card title text on active title bar |
 * | --tug-card-title-bar-icon-active (icon-active) | --tug-card-title-bar-bg-active (tab-bg-active) | ui-component | Card icon on active title bar     |
 */
```

Rules:
- Placed immediately after the file-level docblock comment, before the first CSS rule
- Each row lists: component-alias token (with resolved `--tug-base-*` short name in parentheses), surface token (with resolved short name), contrast role, human-readable rendering context
- Contrast roles are one of: `body-text`, `subdued-text`, `large-text`, `ui-component`, `decorative`
- The table format is fixed-width columns for grep/parse friendliness

#### Token Rename Map {#rename-map}

**Table T01: Token Rename Summary** {#t01-rename-summary}

The following token families require rename for classification consistency:

| Current Pattern | Issue | New Pattern | Count (approx) |
|----------------|-------|-------------|----------------|
| `field-fg` (bare, no state suffix) | Inconsistent with `field-fg-disabled`, `field-fg-readOnly` | `field-fg-default` | 1 |
| `field-placeholder` | No `-fg-` segment; unclassifiable by regex | `field-fg-placeholder` | 1 |
| `field-label` | No `-fg-` segment; unclassifiable by regex | `field-fg-label` | 1 |
| `field-required` | No `-fg-` segment; unclassifiable by regex | `field-fg-required` | 1 |
| `checkmark`, `checkmark-mixed` | No `-fg-` segment; unclassifiable by regex | `checkmark-fg`, `checkmark-fg-mixed` | 2 |
| `separator` | No `-border-` or `-divider-` segment; unclassifiable by regex | `divider-separator` | 1 |
| `accent-default`, `accent-cool-default`, `accent-subtle` | Dual-use: used as both foreground and background | Retain as-is; classify as chromatic; add to pairing map with explicit role per usage context | ~3 |
| `tone-*` (e.g., `tone-accent`, `tone-danger`) | Used as foreground color but no `-fg-` segment | Retain `tone-*` as chromatic values; `tone-*-fg` already exists for foreground usage | ~8 |

Note: `icon-*` tokens (including `icon-active`, `icon-muted`, etc.) are NOT renamed because they already match the classification regex (`icon-` is an element segment in Spec S01). A naming-consistency rename is deferred to a follow-on to reduce scope and risk.

Note: `accent-warm-default` does not exist as a generated token — it only appears as a CSS fallback in `gallery-card.css` (`var(--tug-base-accent-warm-default, var(...))`) and is not subject to rename.

Tokens that are already classifiable and need no rename:
- `fg-*` (12 tokens): already classifiable as element
- `bg-*` (2 tokens): already classifiable as surface
- `surface-*` (8 tokens): already classifiable as surface
- `control-*-bg-*` (~50 tokens): already classifiable as surface
- `control-*-fg-*` (~50 tokens): already classifiable as element
- `control-*-border-*` (~50 tokens): already classifiable as element
- `control-*-icon-*` (~50 tokens): already classifiable as element
- `icon-*` (~11 tokens): already classifiable as element (regex matches `icon-`)
- `toggle-icon-*` (2 tokens): already classifiable as element (regex matches `icon-`)
- `field-bg-*` (5 tokens): already classifiable as surface
- `tab-bg-*` (4 tokens): already classifiable as surface
- `tab-fg-*` (3 tokens): already classifiable as element
- `badge-tinted-*-bg/fg` (21 tokens): already classifiable
- `border-*` (6 tokens): already classifiable as element
- `divider-*` (2 tokens): already classifiable as element
- `shadow-*` (5 tokens): already classifiable as element

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Snapshot current token inventory {#step-1}

**Commit:** `chore(tokens): snapshot current token inventory for audit baseline`

**References:** [D01] Token naming regularization, [D04] Atomic rename, (#context, #strategy, #scope)

**Artifacts:**
- `tugdeck/docs/token-inventory-baseline.md` — full list of all `--tug-base-*` tokens extracted from `tug-base-generated.css`, with current classification status (element/surface/chromatic/non-color/unclassified)

**Tasks:**
- [ ] Extract every `--tug-base-*` token from `tug-base-generated.css` (generated by `bun run generate:tokens`)
- [ ] For each token, record: token name, current prefix pattern, classification (element/surface/chromatic/non-color/unclassified)
- [ ] Identify and list all tokens that are unclassified under the current naming scheme (expected: ~7 tokens that will be renamed per Table T01)
- [ ] Record the total count (expected: ~373 color tokens)

**Tests:**
- [ ] Count of extracted tokens matches the known ~373 figure
- [ ] Every token is classified into exactly one category

**Checkpoint:**
- [ ] `token-inventory-baseline.md` exists and lists all tokens
- [ ] Unclassified color token count matches Table T01 rename candidates (~7 tokens)

---

#### Step 2: Audit component CSS files and extract pairings {#step-2}

**Depends on:** #step-1

**Commit:** `docs(tokens): extract all foreground-on-background pairings from component CSS`

**References:** [D02] Base-level pairings, [D03] CSS comment convention, Spec S02, (#scope, #assumptions)

**Artifacts:**
- `tugdeck/docs/pairing-audit-results.md` — exhaustive list of all foreground-on-background pairings extracted from the 23 component CSS files, recording both component-alias and resolved `--tug-base-*` tokens

**Tasks:**
- [ ] For each of the 23 CSS files listed in Scope, extract every foreground-on-background pairing by identifying:
  - `color` / `fill` properties (element tokens) in the same CSS rule or rendering context as `background-color` / `background` properties (surface tokens)
  - Inherited color contexts (e.g., `.tugcard-title` inherits `color` but `.tugcard-title-bar` sets `background-color`)
  - Border-on-surface pairings where `border-color` must contrast with the element's own background
- [ ] Record each pairing at both component-alias level and resolved `--tug-base-*` level
- [ ] Assign a contrast role to each pairing (body-text, subdued-text, large-text, ui-component, decorative)
- [ ] Flag the `fg-default` on `tab-bg-active` gap (card title bar) explicitly
- [ ] Audit `style-inspector-overlay.css` — note that it uses hardcoded oklch values (not tokens) and document which pairings exist but are outside the token system

**Tests:**
- [ ] Every CSS file in scope has been audited (23 files checked off)
- [ ] The card title bar pairing (`fg-default` on `tab-bg-active`) is identified

**Checkpoint:**
- [ ] `pairing-audit-results.md` contains entries from all 23 files
- [ ] Pairing count is documented (expected: significantly more than the current 239)

---

#### Step 3: Design the regularized naming scheme {#step-3}

**Depends on:** #step-1

**Commit:** `docs(tokens): design regularized token naming scheme`

**References:** [D01] Token naming regularization, Spec S01, Table T01, (#token-classification, #rename-map)

**Artifacts:**
- `tugdeck/docs/token-rename-plan.md` — complete rename mapping: current name to new name for every token that changes, with the classification logic that validates the result
- `tugdeck/docs/chromatic-token-list.md` — explicit enumeration of all chromatic (dual-use) tokens with their usage contexts

**Tasks:**
- [ ] Starting from Table T01, produce the exact old-name to new-name mapping for every token that needs renaming
- [ ] Enumerate all chromatic tokens per Spec S01 (accent-*, bare tone-*, highlight-*, overlay-*, toggle-track-*, toggle-thumb*, radio-dot, field-tone-*) with usage context for each
- [ ] Verify the two-phase classification logic (Spec S01) correctly classifies all color tokens after the rename into element, surface, or chromatic: zero unclassified color tokens
- [ ] Confirm non-color tokens (icon-size-*, radius-*, font-*, space-*, motion-*, etc.) are excluded from classification
- [ ] Identify all files that reference each renamed token (CSS files, TS files, the generation script, the pairing map)
- [ ] Document the rename plan with file-by-file impact analysis

**Tests:**
- [ ] Classification logic applied to the post-rename color token list produces zero unclassified tokens
- [ ] Every renamed token has an identified set of files to update
- [ ] Chromatic token list accounts for all ~32 dual-use tokens

**Checkpoint:**
- [ ] `token-rename-plan.md` exists with complete mapping
- [ ] `chromatic-token-list.md` exists with all dual-use tokens enumerated
- [ ] Dry-run of classification logic on renamed list yields zero unclassified color tokens

---

#### Step 4: Execute atomic token rename across all files {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(tokens): regularize token naming for element/surface classification`

**References:** [D01] Token naming regularization, [D04] Atomic rename, Table T01, Spec S01, (#constraints, #scope)

**Artifacts:**
- Updated `tugdeck/scripts/generate-tug-tokens.ts` with renamed token output
- Updated `tugdeck/src/components/tugways/derivation-rules.ts` (token name map keys, ~20 entries)
- Updated `tugdeck/src/components/tugways/theme-derivation-engine.ts` (token references)
- Regenerated `tugdeck/styles/tug-base-generated.css`
- All 23 component CSS files updated with new token names
- Updated `tugdeck/src/components/tugways/element-surface-pairing-map.ts` (token name strings)
- Updated TypeScript source files referencing old token names, including:
  - `tugdeck/src/__tests__/theme-derivation-engine.test.ts` (~14 references)
  - `tugdeck/src/__tests__/contrast-dashboard.test.tsx` (~1 reference)
  - `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` (~5 references)
  - `tugdeck/src/components/tugways/cards/*.tsx` files that set CSS variables programmatically (~10 files with inline style references to audit for old token names)

**Tasks:**
- [ ] Update `derivation-rules.ts` token name map keys per the rename plan (~20 entries: `field-placeholder`, `field-label`, `field-fg`, `field-required`, `checkmark`, `checkmark-mixed`, `separator`)
- [ ] Update `generate-tug-tokens.ts` to emit the new token names
- [ ] Update `theme-derivation-engine.ts` token references if any use the old names
- [ ] For each of the 23 CSS files in scope, replace every occurrence of old token names with new names using exact string matching
- [ ] Search all `.ts` and `.tsx` files in `tugdeck/src/` for old token name strings and replace with new names
- [ ] Audit all `cards/*.tsx` files for inline style references (`style.setProperty`, `cssText`, etc.) that use old token names
- [ ] Update `element-surface-pairing-map.ts` token name strings to use new names
- [ ] Run `bun run generate:tokens` to regenerate `tug-base-generated.css`
- [ ] Verify zero old token names remain anywhere in the codebase

**Tests:**
- [ ] `bun run generate:tokens` exits with status 0
- [ ] `bun run check` (TypeScript type check) passes with zero errors
- [ ] `bun test` passes with zero failures
- [ ] `grep` for old token names across all CSS, TS, and TSX files returns zero matches
- [ ] Classification logic (Spec S01) applied to generated color token list yields zero unclassified tokens

**Checkpoint:**
- [ ] `bun run generate:tokens` succeeds
- [ ] `bun run check` passes
- [ ] `bun test` passes
- [ ] Zero old token names in `tugdeck/src/` and `tugdeck/styles/`
- [ ] Classification logic produces zero unclassified color tokens
- [ ] Gallery card renders correctly (visual check)

---

#### Step 5: Update element-surface-pairing-map.ts with all discovered pairings {#step-5}

**Depends on:** #step-2, #step-4

**Commit:** `feat(contrast): add all missing pairings to element-surface-pairing-map`

**References:** [D02] Base-level pairings, Table T01, (#pairing-comment-format, #rename-map, #assumptions)

**Artifacts:**
- Updated `tugdeck/src/components/tugways/element-surface-pairing-map.ts` with all pairings from the audit

**Tasks:**
- [ ] Compare the audit results (Step 2) against the current pairing map entries
- [ ] Add every missing pairing, using the new (post-rename) token names
- [ ] Confirm the `fg-default` on `tab-bg-active` pairing (card title bar) is now present with role `body-text`
- [ ] Organize new entries into logical groups matching the existing comment structure
- [ ] Remove any entries that reference tokens that no longer exist after the rename

**Tests:**
- [ ] `bun run check` passes (TypeScript compilation)
- [ ] Every pairing from the audit results has a corresponding entry in the map
- [ ] `bun test` passes (contrast engine tests use the map)

**Checkpoint:**
- [ ] `bun run check` passes
- [ ] `bun test` passes
- [ ] `grep "tab-bg-active"` in pairing map returns at least one entry with `fg-default` as element

---

#### Step 6: Add @tug-pairings comment blocks to all component CSS files {#step-6}

**Depends on:** #step-5

**Commit:** `docs(tokens): add @tug-pairings comment blocks to all component CSS files`

**References:** [D03] CSS comment convention, Spec S02, (#pairing-comment-format, #scope)

**Artifacts:**
- All 23 component CSS files updated with `@tug-pairings` comment blocks

**Tasks:**
- [ ] For each of the 23 CSS files in scope, add a `@tug-pairings` comment block after the file docblock
- [ ] Each block lists all foreground-on-background pairings for that component per Spec S02 format
- [ ] For `style-inspector-overlay.css`, note in the comment that it uses hardcoded oklch values and list the logical pairings (not token pairings)
- [ ] Cross-check: every entry in the pairing map should trace back to at least one `@tug-pairings` block

**Tests:**
- [ ] `grep -c "@tug-pairings" tugdeck/src/components/tugways/**/*.css` returns 23 (one per file)
- [ ] Spot-check 5 representative files to confirm the block content matches the audit results

**Checkpoint:**
- [ ] All 23 files contain `@tug-pairings` blocks
- [ ] Cross-check: every pairing map entry is traceable to a CSS comment block

---

#### Step 7: Write cross-check verification script {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tokens): add pairing cross-check verification script`

**References:** [D02] Base-level pairings, [D03] CSS comment convention, Spec S01, Spec S02, (#success-criteria)

**Artifacts:**
- `tugdeck/scripts/verify-pairings.ts` — script that parses `@tug-pairings` blocks from all CSS files and compares against `element-surface-pairing-map.ts`, reporting any mismatches

**Tasks:**
- [ ] Write a script that:
  1. Parses every `@tug-pairings` block from CSS files
  2. Extracts the resolved `--tug-base-*` token pairs
  3. Loads the pairing map from `element-surface-pairing-map.ts`
  4. Reports: pairings in CSS but not in map (gaps); pairings in map but not in any CSS (orphans)
- [ ] Run the script and confirm zero gaps and zero orphans

**Tests:**
- [ ] Script exits with status 0 (no gaps, no orphans)

**Checkpoint:**
- [ ] `bun run tugdeck/scripts/verify-pairings.ts` exits cleanly with zero mismatches

---

#### Step 8: Final validation checkpoint {#step-8}

**Depends on:** #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Token naming regularization, [D02] Base-level pairings, [D03] CSS comment convention, [D04] Atomic rename, Spec S01, Spec S02, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run `bun run generate:tokens` and confirm success
- [ ] Run `bun test` and confirm all tests pass
- [ ] Run `cd tugcode && cargo nextest run` and confirm all tests pass
- [ ] Run `bun run tugdeck/scripts/verify-pairings.ts` and confirm zero mismatches
- [ ] Verify the classification logic produces zero unclassified color tokens
- [ ] Verify all 23 CSS files have `@tug-pairings` blocks

**Tests:**
- [ ] `bun run generate:tokens` exits 0
- [ ] `bun test` passes
- [ ] `cargo nextest run` passes
- [ ] `verify-pairings.ts` reports zero gaps and zero orphans

**Checkpoint:**
- [ ] All verification commands pass
- [ ] Zero unclassified color tokens
- [ ] Zero pairing mismatches

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A regularized token naming scheme with mechanical element-vs-surface classification, an authoritative foreground-on-background pairing list in `element-surface-pairing-map.ts`, and `@tug-pairings` CSS comment blocks in all 23 component CSS files.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Every `--tug-base-*` color token is classifiable as element, surface, or chromatic (zero unclassified color tokens)
- [ ] Every foreground-on-background pairing used by any component CSS file is present in `element-surface-pairing-map.ts`
- [ ] Every component CSS file has a `@tug-pairings` comment block listing its pairings
- [ ] `bun run generate:tokens` succeeds
- [ ] All existing tests pass (`bun test`, `cargo nextest run`)
- [ ] The verification script (`verify-pairings.ts`) reports zero mismatches

**Acceptance tests:**
- [ ] Classification logic applied to full color token list: zero unclassified color tokens
- [ ] `verify-pairings.ts` exits with status 0
- [ ] `bun run generate:tokens` exits with status 0
- [ ] `bun test` passes
- [ ] `cd tugcode && cargo nextest run` passes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Build a PostCSS or Vite plugin that parses `@tug-pairings` blocks and auto-generates pairing map entries
- [ ] Naming-consistency rename for `icon-*` tokens to `icon-fg-*` (deferred from this phase; regex already classifies them)
- [ ] Phase 2: Fix the contrast engine to enforce all pairings (including composited surfaces)
- [ ] Phase 3: Build independent recipes using the complete pairing map for validation

| Checkpoint | Verification |
|------------|--------------|
| Token rename complete | `grep` for old names returns zero; classification logic passes |
| Pairing map complete | `verify-pairings.ts` exits 0 |
| CSS comments complete | `grep -c "@tug-pairings"` returns 23 |
| All tests pass | `bun test && cargo nextest run` |
