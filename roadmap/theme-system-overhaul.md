# Theme System Overhaul

The theme system must produce legible, contrast-compliant themes across any
combination of recipe (dark, light, dark/stark, light/stark) and color palette
(any hue family). The current system fails this requirement. This document
identifies what is broken and lays out the work to fix it.

---

## What we learned

The iOS word game's theme picker demonstrates the target architecture: COLOR/RECIPE.
PURPLE/LIGHT, BLUE/DARK, YELLOW/DARK/STARK. The color (purple, blue, yellow) is one
axis. The recipe (light, dark, light/stark, dark/stark) is the other. Every
combination works. Every one is legible. The recipe describes a *design approach*,
not a pile of formula overrides.

The current Tug theme system fails to deliver this. The Harmony light theme has
illegible card titles, unreadable badge text, and muddy role colors. The contrast
engine reports zero failures while the UI shows obvious problems. Three structural
flaws explain why.

---

## Problem 1: Recipes are not independent

`LIGHT_FORMULAS` is defined as `{ ...BASE_FORMULAS, ...LIGHT_OVERRIDES }` where
`BASE_FORMULAS === DARK_FORMULAS`. Light is structurally "dark, but change these
things." This is wrong. Each recipe must be a complete, self-contained definition
of how to render a theme — 198 values chosen for that recipe's design intent, not
198 values inherited from dark with some patched.

The iOS game defines 4 independent recipes. Each specifies all 22 color roles from
scratch. None inherits from another. When the dark recipe says PrimaryFill has
`gray:0.33, targetLightness:29`, and the light recipe says `gray:0.8,
targetLightness:77`, these are independent design decisions — not inversions.

**What must change:** Each recipe (dark, light, dark/stark, light/stark) must be a
complete `DerivationFormulas` object with all fields explicitly set and annotated
with design rationale. No spreading from a "base." The base/override pattern served
as scaffolding but it has become the ceiling.

---

## Problem 2: The contrast engine does not check what matters

The element-surface pairing map is a hand-curated list of 239 token pairs. It was
written by reasoning about what *should* need checking, not by looking at what *does*
need checking. The result: obvious failures slip through.

The card title bar renders `fg-default` on `tab-bg-active`. This pairing is not in
the map. The contrast engine never checks it. The UI shows illegible text. The tests
pass.

### The token naming problem

The pairings can't be reliably extracted from CSS because the token naming is
inconsistent:

| Token pattern | Role | Count | Examples |
|---------------|------|------:|---------|
| `fg-*` | Text/foreground color | 12 | fg-default, fg-muted, fg-link |
| `bg-*` | App-level background | 2 | bg-app, bg-canvas |
| `surface-*` | Component background | 8 | surface-default, surface-raised, surface-overlay |
| `control-*-bg-*` | Control background | ~50 | control-filled-accent-bg-rest |
| `control-*-fg-*` | Control text | ~50 | control-filled-accent-fg-rest |
| `field-bg-*` | Field background | 5 | field-bg-rest, field-bg-hover |
| `field-fg` / `field-placeholder` | Field text | 3 | field-fg, field-placeholder |
| `tab-bg-*` / `tab-fg-*` | Tab colors | 9 | tab-bg-active, tab-fg-active |
| `badge-tinted-*-bg/fg` | Badge colors | 21 | badge-tinted-accent-bg |
| `tone-*` | Semantic signals | 35 | tone-accent, tone-danger-fg |
| `toggle-*` | Switch/checkbox | 11 | toggle-track-on, toggle-thumb |
| `icon-*` | Icon colors | 11 | icon-active, icon-muted |
| `border-*` | Borders | 6 | border-default, border-strong |
| `shadow-*` | Shadows | 5 | shadow-md, shadow-lg |
| `divider-*` | Dividers | 2 | divider-default, divider-muted |
| `highlight-*` | Selection/drag | 6 | highlight-hover, highlight-flash |

The problem: "surface" tokens are backgrounds but don't use the `bg-` prefix.
`tab-bg-active` is a background. `control-filled-accent-bg-rest` is a background.
`field-bg-rest` is a background. These are all backgrounds but use 4 different
naming conventions. A tool trying to extract "which tokens are backgrounds" has to
understand all 4 patterns.

Similarly, foreground tokens use `fg-`, `control-*-fg-*`, `field-fg`, `tab-fg-*`,
`badge-tinted-*-fg`, `tone-*-fg`, and `icon-*` — 7 different patterns for "this
color goes on top of something."

**What must change:**

1. **Audit and regularize token naming.** Every token must be unambiguously
   classifiable as "element" (goes on top of a surface) or "surface" (things go on
   top of it). The naming convention must make this classification mechanical, not
   interpretive.

2. **Derive pairings from components.** Every `var(--tug-base-*)` used as `color`,
   `fill`, or `border-color` in component CSS, paired with the `var(--tug-base-*)`
   used as `background-color` in the same rendering context, is a contrast-required
   pairing. This must be extractable — either by a build-time tool that parses CSS,
   or by a disciplined component annotation system.

3. **Audit all existing components.** Verify every component uses tokens correctly
   and consistently. The audit produces the authoritative pairing list.

4. **Establish rules for future components.** New components must declare their
   foreground/background pairings. The contrast engine validates them automatically.

---

## Problem 3: Recipe formulas are opaque

The current `DerivationFormulas` interface has 198 numeric fields organized by 23
semantic decision groups. Even with `@semantic` tags and design rationale comments,
the interface is a wall of numbers. You can't look at it and understand what a recipe
*does* or how one recipe differs from another.

The iOS game's recipe is 22 color roles, each with 4 parameters. The description
says it plainly: "Colors based on PURPLE with more filled-in shapes on a light
background." The recipe's design intent is visible in its structure.

The Tug system needs a similar level of clarity. A recipe author (human or LLM)
should be able to:
- See the small number of meaningful design decisions a recipe makes
- Understand how each decision maps to visual outcomes
- Compare two recipes and see what differs
- Create a new recipe by making those decisions, not by filling in 198 fields

**What must change:**

1. **Reduce the effective parameter count.** Many of the 198 fields are
   mechanically derived from a smaller set of design decisions. The semantic groups
   from Part 2 identified ~13 core decisions. The interface should expose those
   decisions, not their expansion into per-state, per-role, per-property fields.
   (Part 3 of the contrast-engine-overhaul roadmap already identified this — the
   formula de-duplication that collapsed 74 per-role fields into 18 emphasis-level
   fields. This work was partially done but needs completion.)

2. **Make the Theme Generator expose recipe parameters meaningfully.** The current
   3 mood sliders (Surface Contrast, Signal Intensity, Warmth) don't provide useful
   control. The generator should expose the design decisions that actually matter:
   canvas brightness, text hierarchy spread, control prominence, border visibility,
   shadow depth. These are the knobs the iOS game's recipe system controls.

3. **Document what makes each recipe different.** A comparison table showing dark vs
   light vs dark/stark vs light/stark across each design decision — not 198 numbers,
   but the 13 decisions that distinguish them.

---

## Problem 4: Contrast enforcement has structural gaps

The contrast floor enforcement in the derivation engine (Part 4 of the
contrast-engine-overhaul roadmap) has three gaps:

1. **Missing pairings are not enforced.** If a pairing isn't in the map,
   `enforceContrastFloor` never runs for it. The card title bar is the most visible
   example.

2. **Composited surfaces are skipped.** Pairs with `parentSurface` (badges,
   highlights) are excluded from floor enforcement at line 2440:
   `if (pairing.parentSurface) continue;`. These tokens are validated post-derivation
   but never corrected.

3. **Tests only validate dark mode.** The core T3.5 accessibility test runs
   `deriveTheme(EXAMPLE_RECIPES.brio)` only. Harmony is never checked by the
   authoritative accessibility test.

**What must change:**

1. **Complete pairing coverage.** Every pairing from the component audit (Problem 2)
   must be in the map. No exceptions for "assumed valid."

2. **Handle composited surfaces.** The engine must either enforce contrast floors
   for composited surfaces (computing the composite inline) or mark them as requiring
   special treatment with a documented strategy.

3. **Validate every recipe.** The test suite must run contrast validation on every
   `EXAMPLE_RECIPES` entry, not just brio. Adding a recipe must automatically add it
   to contrast validation.

---

## Execution approach

These four problems are interconnected. The token naming audit (Problem 2) produces
the authoritative pairing list. The pairing list feeds the contrast engine
(Problem 4). Independent recipes (Problem 1) need the working contrast engine to
validate them. Recipe clarity (Problem 3) depends on the recipes being correct.

### Tooling: `audit-tokens.ts`

`tugdeck/scripts/audit-tokens.ts` (`bun run audit:tokens`) is the authoritative tool
for all token and pairing work. It runs in <100ms and replaces manual grep/bash
exploration. Every phase must use this tool — hours-long LLM-driven line-by-line
investigation of CSS files is an anti-pattern.

| Subcommand | What it does | When to use |
|------------|-------------|-------------|
| `tokens` | Extract and classify all 373 `--tug-base-*` tokens | Verify classification after any token rename |
| `pairings` | Parse all 23 CSS files, resolve aliases, extract foreground-on-background pairings | Verify pairing completeness; diagnose unresolved pairings |
| `rename [--apply]` | Bulk-rename tokens across all files (dry run by default) | Any token rename operation |
| `inject [--apply]` | Generate `@tug-pairings` comment blocks from CSS analysis | Regenerate CSS documentation after pairing map changes |
| `verify` | Cross-check `@tug-pairings` blocks against `element-surface-pairing-map.ts` | Confirm CSS blocks and pairing map are in sync |
| `lint` | Hard-fail (exit 1) on missing annotations, multi-hop aliases, missing blocks, unresolved pairings | CI gate; run after every step that touches CSS or tokens |

**Rules of Tugways enforcement (D81):**
- **Rule 16:** Every CSS rule that sets `color`/`fill`/`border-color` without
  `background-color` must include a `/* @tug-renders-on: --tug-base-{surface} */`
  annotation. `audit-tokens lint` enforces this.
- **Rule 17:** Component alias tokens resolve to `--tug-base-*` in one hop. No
  alias-to-alias chains (compat layers exempt via allowlist). `audit-tokens lint`
  flags violations.

**Implementation workflow for any step that modifies CSS or tokens:**
1. Make the change
2. Run `bun run audit:tokens lint` — immediate feedback
3. Run `bun run audit:tokens pairings` — verify zero unresolved
4. Run `bun run audit:tokens inject --apply` — regenerate `@tug-pairings` blocks
5. Run `bun run audit:tokens verify` — confirm map ↔ CSS consistency
6. Run `bun test` — confirm no test regressions

### Phase 1: Token audit and pairing extraction ✅ COMPLETE

*Completed via `tugplan-token-audit-pairing` (PR #138, merged).*

1. ✅ Audited all 23 component CSS files. Extracted every foreground-on-background
   token pairing. Produced the authoritative pairing list (275 CSS-declared pairings,
   339 map entries).
2. ✅ Regularized token naming: renamed 7 unclassifiable tokens so every `--tug-base-*`
   color token is mechanically classifiable as element, surface, or chromatic.
3. ✅ Compared extracted pairings against the pairing map. Identified and closed all
   gaps including the critical `fg-default` on `tab-bg-active` card title bar gap.
4. ✅ Established `@tug-pairings` CSS comment convention in all 23 component files.
5. ✅ Created `verify-pairings.ts` cross-check script.

### Phase 1.5: Make token pairings machine-auditable ✅ COMPLETE

*Completed via `tugplan-token-audit-enforce` (PR #139, merged).*

1. ✅ Added 145 `@tug-renders-on` annotations across 16 component CSS files — every
   color-setting rule now declares its rendering surface deterministically.
2. ✅ Flattened alias chains to 1 hop (tug-tab.css cross-component chains).
3. ✅ Built `audit-tokens.ts` with 6 subcommands: `tokens`, `pairings`, `rename`,
   `inject`, `verify`, `lint`.
4. ✅ Replaced heuristic surface resolution (4 strategies) with deterministic
   annotation-based parsing (2 strategies: same-rule match + annotation lookup).
5. ✅ Added Rules 16, 17, and D81 to the Rules of Tugways.
6. ✅ Exit criteria met: `lint` zero violations, `pairings` zero unresolved,
   `verify` zero gaps, all tests pass.

### Phase 2: Fix the contrast engine

*Addresses Problem 4. Uses `audit-tokens.ts` for all pairing-related verification.*

1. **Remove the `parentSurface` skip from `enforceContrastFloor`.** Currently
   (line ~2440), pairs with `parentSurface` are excluded from floor enforcement.
   Implement inline compositing: compute the effective surface color by alpha-blending
   the semi-transparent token over its `parentSurface`, then enforce contrast against
   that composite. Use `bun run audit:tokens pairings` to identify all composited
   pairings and verify none are skipped.

2. **Expand test coverage to validate every recipe.** The T3.5 accessibility test
   currently runs only `deriveTheme(EXAMPLE_RECIPES.brio)`. Update it to iterate over
   every entry in `EXAMPLE_RECIPES` — adding a recipe must automatically add it to
   contrast validation. This means Harmony light will be validated for the first time
   by the authoritative test.

3. **Run the expanded validation on Harmony and capture failures.** Harmony will fail
   — this is expected and necessary. The failures are the ground truth for Phase 3.
   Document each failure: which pairing, what contrast ratio, what threshold, what
   the recipe formula produces. Use `bun run audit:tokens pairings` to cross-reference
   failures against the CSS-declared pairings and confirm every failure traces to a
   real rendering context.

4. **Clean up exception lists.** Phases 1 and 1.5 added `KNOWN_PAIR_EXCEPTIONS` and
   `STEP5_GAP_PAIR_EXCEPTIONS` to tests as newly-discovered pairings surfaced
   accessibility gaps. Review each exception: is it a genuine design choice (decorative
   element, acceptable low contrast) or a bug that Phase 3 must fix? Categorize and
   document. Use `bun run audit:tokens verify` to confirm the pairing map and CSS
   blocks remain in sync after any map adjustments.

5. **Verify with tooling after every change:**
   - `bun run audit:tokens lint` — annotations and aliases still valid
   - `bun run audit:tokens verify` — map ↔ CSS consistency
   - `bun test` — all tests pass (with documented exceptions for Harmony failures)

### Phase 3: Build independent recipes

*Addresses Problem 1. The working contrast engine from Phase 2 validates every change.*

1. Define `DARK_FORMULAS` as a complete, independent recipe — not a "base" that
   others spread from. Annotate every field with design rationale (already done in
   Part 4 of semantic-formula-architecture).
2. Define `LIGHT_FORMULAS` as a complete, independent recipe — every field explicitly
   set for light-mode design intent. Not `{ ...DARK_FORMULAS, ...LIGHT_OVERRIDES }`.
   The annotated dark recipe serves as reference for understanding what each field
   does, but the light values are chosen independently.
3. Use the working contrast engine from Phase 2 to validate and calibrate both
   recipes. Iterate until both pass with zero exceptions. After each formula change,
   run `bun run audit:tokens lint` and `bun test` to verify no regressions. Use
   `bun run audit:tokens pairings` to trace any new contrast failures back to
   specific CSS rendering contexts.
4. Remove `BASE_FORMULAS` and `LIGHT_OVERRIDES` — they encode the wrong abstraction.
5. **Regenerate all CSS documentation:** Run `bun run audit:tokens inject --apply`
   and `bun run audit:tokens verify` to ensure all `@tug-pairings` blocks and the
   pairing map remain in sync after recipe changes that affect token derivation.

### Phase 4: Recipe clarity and generator improvements

*Addresses Problem 3.*

1. Reduce the effective parameter count by completing the formula de-duplication
   from the contrast-engine-overhaul roadmap (emphasis-level fields, not per-role).
2. Update the Theme Generator to expose meaningful recipe parameters — the ~13
   semantic decisions, not 3 mood sliders that don't map to anything useful.
3. Document the recipe comparison table: dark vs light across each design decision.
4. Prepare the architecture for dark/stark and light/stark recipes.
5. **Maintain audit-tokens invariants:** Any changes to token structure, CSS files,
   or the pairing map must pass `bun run audit:tokens lint` and
   `bun run audit:tokens verify`. These are non-negotiable gates per D81.

---

## Relationship to existing roadmaps

This document supersedes the relevant parts of:

- **semantic-formula-architecture.md** Parts 1-4 (completed and merged). Part 5
  (Harmony light theme) is superseded by Phase 3 of this document — the current
  Harmony implementation is based on the flawed override approach and must be
  rebuilt as an independent recipe.

- **contrast-engine-overhaul.md** Parts 1-2 (completed). Part 3 (formula
  de-duplication) is incorporated into Phase 4. Part 4 (contrast-aware derivation)
  was partially implemented but has the structural gaps documented in Problem 4 —
  Phase 2 of this document completes it.

- **tugplan-token-audit-pairing** (Phase 1, PR #138, merged). Audited all 23
  component CSS files, regularized 7 token names, closed all pairing gaps, added
  `@tug-pairings` blocks and `verify-pairings.ts`.

- **tugplan-token-audit-enforce** (Phase 1.5, PR #139, merged). Built
  `audit-tokens.ts` with 6 subcommands, added 145 `@tug-renders-on` annotations,
  flattened alias chains, replaced heuristic resolution with deterministic parsing,
  added Rules 16/17 and D81 to the Rules of Tugways.

The work done in Parts 1-4 of the semantic-formula-architecture roadmap (named
builders, @semantic annotations, interface restructuring, design rationale comments)
remains valuable — it provides the vocabulary and organization that the new
independent recipes will use. The problem was not the annotation work but the
assumption that light could be built as an override of dark.
