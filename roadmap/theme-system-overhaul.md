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

### Phase 2: Fix the contrast engine ✅ COMPLETE

*Completed via `tugplan-contrast-engine-fix` (PR #140, merged).*

1. ✅ Removed the `parentSurface` skip from `enforceContrastFloor`. Implemented
   two-pass composited enforcement: pass 1 handles opaque pairings, pass 2 defers
   semi-transparent pairings, composites via `compositeOverSurface` + `hexToOkLabL`,
   then enforces contrast against the composite.
2. ✅ Expanded test coverage: parameterized recipe loop validates every
   `EXAMPLE_RECIPES` entry automatically. Adding a recipe adds it to contrast
   validation.
3. ✅ Ran expanded validation on Harmony, captured all failures. Documented each
   failure with contrast value, threshold, role, and CSS rendering context.
   Cross-referenced via `bun run audit:tokens pairings`.
4. ✅ Cleaned up exception lists. Consolidated into shared module
   (`contrast-exceptions.ts`). Every entry tagged `[design-choice]` or
   `[phase-3-bug]` with inline rationale.
5. ✅ All tooling gates pass: `audit:tokens lint`, `audit:tokens verify`, `bun test`.

### Phase 3: Build independent recipes ✅ COMPLETE

*Completed via `tugplan-independent-recipes` (PR #141, merged).*

1. ✅ Verified `DARK_FORMULAS` annotations complete (200 fields, all with
   `@semantic` tags and design-rationale comments).
2. ✅ Built `LIGHT_FORMULAS` as a complete, independent 202-field literal object —
   every field explicitly set with light-mode design rationale. No spread from
   `BASE_FORMULAS`.
3. ✅ Calibrated both recipes using the Phase 2 contrast engine. Resolved all
   `[phase-3-bug]` entries: B03 (cardFrameActiveTone), B04 (new accentSubtleTone
   field), B05 (new cautionBgTone field), B02 (via LIGHT_FORMULAS values).
   B01/B06/B08 deferred as `[phase-4-engine]` (gamut ceiling, mode-aware tokens).
   B07 documented as `[design-choice]` (fg-inverse polarity).
4. ✅ Removed `BASE_FORMULAS`, `DARK_OVERRIDES`, `LIGHT_OVERRIDES`, and
   `LIGHT_FORMULAS_LEGACY`. Updated `EXAMPLE_RECIPES` to reference `DARK_FORMULAS`
   and `LIGHT_FORMULAS` directly.
5. ✅ Updated all test file imports. Regenerated CSS documentation via
   `audit:tokens inject --apply`. All tooling gates pass.
6. ✅ Fixed light-mode test formulas: T4.2, T4.4, T4.7 now use `LIGHT_FORMULAS`
   when mode is light, eliminating the root cause of B09-B14 surface contrast bugs.
   Removed `LIGHT_MODE_PAIR_EXCEPTIONS` and `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS`
   entirely.

### Phase 3.5-tooling: Enhance audit-tokens for bulk rename

*Upgrades the `audit-tokens` rename infrastructure to handle the Phase 3.5A rename
(320+ tokens across 40+ files) safely and mechanically.*

#### The problem

The current `audit-tokens rename` subcommand has a hardcoded 7-entry rename map
from Phase 1. Phase 3.5A requires renaming every structured token in the system
(~320+ tokens) across every file that references them (~40+ files). The current
tooling cannot:

- Generate the rename map programmatically from the naming convention rules
- Load a rename map from an external file
- Handle component alias tokens (`--tug-card-*`, `--tug-tab-*`)
- Handle `@tug-renders-on` annotations
- Scan all files that reference tokens (missing ~15 files)
- Verify that no old names remain after rename

#### What must change

1. **`audit-tokens rename-map` subcommand (new).** Generates the complete old→new
   rename map by:
   - Reading the current token inventory from `audit-tokens tokens`
   - Parsing each token name to extract component, emphasis, role, channel, state
   - Applying the Phase 3.5A six-slot naming convention to produce the new name
   - Outputting a JSON file (`token-rename-map.json`) with `{ "old-short": "new-short" }` entries
   - Validating: no collisions, all tokens covered, all new names well-formed
   - Flagging chromatic tokens that need manual naming decisions

   The map generator encodes the naming rules as code, so the naming convention
   can be iterated — regenerate, preview, adjust — before touching any source files.

2. **`audit-tokens rename` enhancements:**

   a. **Load map from JSON.** Instead of only using the hardcoded `RENAME_MAP`,
      accept `--map token-rename-map.json` to load an external map. The hardcoded
      map becomes the fallback when no `--map` is specified.

   b. **Expanded file targets.** Add all files that reference tokens:
      - `src/__tests__/contrast-exceptions.ts`
      - `src/__tests__/theme-accessibility.test.ts`
      - `src/__tests__/debug-contrast.test.ts`
      - `src/__tests__/tug-checkbox-role.test.tsx`
      - `src/__tests__/tug-switch-role.test.tsx`
      - `src/__tests__/theme-export-import.test.tsx`
      - `src/components/tugways/theme-accessibility.ts`
      - `src/canvas-color.ts`
      - `src/globals.css`
      - `styles/tug-base.css`
      - `src/components/tugways/tug-checkbox.tsx`
      - `src/components/tugways/tug-switch.tsx`
      - `src/components/tugways/style-inspector-overlay.ts`
      - `scripts/audit-tokens.ts` (the script itself references token names)
      - Any other `.ts`, `.tsx`, or `.css` file under `tugdeck/src/` and
        `tugdeck/styles/` that contains `--tug-base-`
      Auto-discover target files by scanning for `--tug-base-` references rather
      than maintaining a hardcoded list.

   c. **Component alias handling.** Detect `var(--tug-base-*)` references inside
      component alias definitions (`--tug-card-*`, `--tug-tab-*`, etc. defined in
      `tug-card.css`, `tug-tab.css`, etc.) and update them when the base token
      they reference is renamed.

   d. **`@tug-renders-on` annotation handling.** These annotations reference token
      names as `/* @tug-renders-on: --tug-base-{name} */`. Update them when the
      referenced token is renamed.

3. **`audit-tokens rename --verify` mode (new).** After a rename is applied, scan
   all files for any remaining references to old token names. Reports every stale
   reference with file, line number, and the old name found. Exit code 1 if any
   remain. This is the safety net — run it after `--apply` to confirm nothing was
   missed.

4. **`audit-tokens rename --stats` mode (new).** Before applying, show a summary:
   total tokens to rename, files to modify, estimated replacements per file. Helps
   gauge the blast radius before committing.

#### Verification

- `bun run audit:tokens rename-map` produces a valid JSON map with no collisions
- `bun run audit:tokens rename --map token-rename-map.json` (dry run) shows all
  expected replacements
- `bun run audit:tokens rename --map token-rename-map.json --apply` applies cleanly
- `bun run audit:tokens rename --verify --map token-rename-map.json` reports zero
  stale references
- `bun run audit:tokens lint` — zero violations after rename
- `bun test` — all tests pass after rename

### Phase 3.5A: Standardize element/surface terminology and token naming convention

*Addresses the terminology fragmentation and inconsistent token naming across the
codebase. This is a comprehensive rename — no old names remain. Uses the tooling
from Phase 3.5-tooling for mechanical execution.*

#### The problem

The system uses three overlapping term pairs for the same design concept — the
figure/ground relationship where one color sits on top of another:

| Term pair | Where it appears |
|-----------|-----------------|
| foreground/background | CSS properties (`color`, `background-color`), some doc language |
| fg/bg | Token names (`fg-default`, `bg-app`), formula field prefixes (`fgDefaultTone`, `bgAppTone`) |
| element/surface | Pairing map (`element-surface-pairing-map.ts`), audit-tokens classification, `@tug-pairings` blocks |

Token names are also inconsistently structured. `fg-default` puts the role first.
`control-filled-accent-fg-rest` puts it in the middle. `tone-accent-fg` puts it at
the end. There is no rule to follow when adding a new token.

#### The solution: unified naming convention

**Plane** is the top-level distinction: `element` (the thing you need to see) or
`surface` (the thing it sits on). This aligns with WCAG's contrast model where every
check is between a visual mark and its adjacent color context.

Every structured token follows a six-slot naming convention:

```
<plane>-<component>-<emphasis>-<role>-<channel>-<state>
```

| Slot | What it answers | Values |
|------|----------------|--------|
| **plane** | Which side of the contrast pair? | `element`, `surface` |
| **component** | What UI piece? | `global`, `control`, `field`, `tab`, `tone`, `badge`, `selection`, ... |
| **emphasis** | How visually prominent? | `normal`, `filled`, `outlined`, `ghost`, `tinted` |
| **role** | What does it signify? | `default`, `muted`, `subtle`, `accent`, `action`, `danger`, `success`, `caution`, `agent`, `data`, `active`, `plain`, ... |
| **channel** | What visual property? | Element: `text`, `icon`, `border`, `shadow`, `divider`. Surface: `primary`, `secondary`, `tertiary` |
| **state** | What interaction state? | `rest`, `hover`, `active`, `focus`, `disabled`, `readOnly`, ... Omitted for stateless tokens |

**Rules:**
- All six slots are always present. No shortcuts, no omissions.
- `normal` is the default emphasis (no special visual weight).
- `plain` is the default role (no semantic signal).
- `primary` is the default surface channel.
- State may be omitted for tokens that have no interaction states (global text,
  global surfaces, tone signals). This is the only permitted omission.
- CamelCase within a slot is allowed when a slot value is compound
  (e.g., `linkHover` as a role, `dropTarget` as a state).

#### Token rename map

**Global element tokens (text, icon, border, divider, shadow):**

| Current | Proposed |
|---------|----------|
| `fg-default` | `element-global-normal-default-text` |
| `fg-muted` | `element-global-normal-muted-text` |
| `fg-subtle` | `element-global-normal-subtle-text` |
| `fg-disabled` | `element-global-normal-disabled-text` |
| `fg-inverse` | `element-global-normal-inverse-text` |
| `fg-placeholder` | `element-global-normal-placeholder-text` |
| `fg-link` | `element-global-normal-link-text` |
| `fg-link-hover` | `element-global-normal-linkHover-text` |
| `fg-onAccent` | `element-global-normal-onAccent-text` |
| `fg-onDanger` | `element-global-normal-onDanger-text` |
| `fg-onSuccess` | `element-global-normal-onSuccess-text` |
| `fg-onCaution` | `element-global-normal-onCaution-text` |
| `icon-active` | `element-global-normal-active-icon` |
| `icon-default` | `element-global-normal-default-icon` |
| `icon-disabled` | `element-global-normal-disabled-icon` |
| `icon-muted` | `element-global-normal-muted-icon` |
| `icon-onAccent` | `element-global-normal-onAccent-icon` |
| `border-default` | `element-global-normal-default-border` |
| `border-muted` | `element-global-normal-muted-border` |
| `border-strong` | `element-global-normal-strong-border` |
| `border-inverse` | `element-global-normal-inverse-border` |
| `border-accent` | `element-global-normal-accent-border` |
| `border-danger` | `element-global-normal-danger-border` |
| `divider-default` | `element-global-normal-default-divider` |
| `divider-muted` | `element-global-normal-muted-divider` |
| `divider-separator` | `element-global-normal-separator-divider` |
| `shadow-xs` | `element-global-normal-plain-shadow-xs` |
| `shadow-md` | `element-global-normal-plain-shadow-md` |
| `shadow-lg` | `element-global-normal-plain-shadow-lg` |
| `shadow-xl` | `element-global-normal-plain-shadow-xl` |
| `shadow-overlay` | `element-global-normal-overlay-shadow` |

**Global surface tokens:**

| Current | Proposed |
|---------|----------|
| `bg-app` | `surface-global-normal-app-primary` |
| `bg-canvas` | `surface-global-normal-canvas-primary` |
| `surface-default` | `surface-global-normal-default-primary` |
| `surface-raised` | `surface-global-normal-raised-primary` |
| `surface-overlay` | `surface-global-normal-overlay-primary` |
| `surface-sunken` | `surface-global-normal-sunken-primary` |
| `surface-inset` | `surface-global-normal-inset-primary` |
| `surface-content` | `surface-global-normal-content-primary` |
| `surface-screen` | `surface-global-normal-screen-primary` |
| `surface-control` | `surface-global-normal-control-primary` |

**Control tokens (filled/outlined/ghost × role × channel × state):**

| Current | Proposed |
|---------|----------|
| `control-filled-accent-fg-rest` | `element-control-filled-accent-text-rest` |
| `control-filled-accent-bg-rest` | `surface-control-filled-accent-primary-rest` |
| `control-filled-accent-icon-rest` | `element-control-filled-accent-icon-rest` |
| `control-filled-accent-border-rest` | `element-control-filled-accent-border-rest` |
| `control-filled-accent-fg-hover` | `element-control-filled-accent-text-hover` |
| `control-filled-accent-bg-hover` | `surface-control-filled-accent-primary-hover` |
| `control-filled-accent-icon-hover` | `element-control-filled-accent-icon-hover` |
| `control-filled-accent-border-hover` | `element-control-filled-accent-border-hover` |
| `control-filled-accent-fg-active` | `element-control-filled-accent-text-active` |
| `control-filled-accent-bg-active` | `surface-control-filled-accent-primary-active` |
| `control-filled-accent-icon-active` | `element-control-filled-accent-icon-active` |
| `control-filled-accent-border-active` | `element-control-filled-accent-border-active` |
| `control-disabled-fg` | `element-control-normal-disabled-text` |
| `control-disabled-bg` | `surface-control-normal-disabled-primary` |
| `control-disabled-icon` | `element-control-normal-disabled-icon` |
| `control-disabled-border` | `element-control-normal-disabled-border` |
| `control-disabled-shadow` | `element-control-normal-disabled-shadow` |
| `control-highlighted-fg` | `element-control-normal-highlighted-text` |
| `control-highlighted-bg` | `surface-control-normal-highlighted-primary` |
| `control-highlighted-border` | `element-control-normal-highlighted-border` |
| `control-selected-fg` | `element-control-normal-selected-text` |
| `control-selected-bg` | `surface-control-normal-selected-primary` |
| `control-selected-bg-hover` | `surface-control-normal-selected-primary-hover` |
| `control-selected-border` | `element-control-normal-selected-border` |
| `control-selected-disabled-bg` | `surface-control-normal-selectedDisabled-primary` |

(Same pattern repeats for action, danger, agent, data, success, caution roles
across filled/outlined/ghost emphasis levels — ~120 control tokens total.)

**Tab tokens:**

| Current | Proposed |
|---------|----------|
| `tab-fg-rest` | `element-tab-normal-plain-text-rest` |
| `tab-fg-hover` | `element-tab-normal-plain-text-hover` |
| `tab-fg-active` | `element-tab-normal-plain-text-active` |
| `tab-bg-active` | `surface-tab-normal-plain-primary-active` |
| `tab-bg-hover` | `surface-tab-normal-plain-primary-hover` |
| `tab-bg-inactive` | `surface-tab-normal-plain-primary-inactive` |
| `tab-bg-collapsed` | `surface-tab-normal-plain-primary-collapsed` |
| `tab-close-fg-hover` | `element-tabClose-normal-plain-text-hover` |
| `tab-close-bg-hover` | `surface-tabClose-normal-plain-primary-hover` |

**Tone tokens (semantic signals):**

| Current | Proposed |
|---------|----------|
| `tone-accent-fg` | `element-tone-normal-accent-text` |
| `tone-accent-bg` | `surface-tone-normal-accent-primary` |
| `tone-accent-icon` | `element-tone-normal-accent-icon` |
| `tone-accent-border` | `element-tone-normal-accent-border` |
| `tone-accent` | *(chromatic — see below)* |

(Same pattern for active, agent, caution, danger, data, success.)

**Field tokens:**

| Current | Proposed |
|---------|----------|
| `field-fg-default` | `element-field-normal-plain-text-default` |
| `field-fg-disabled` | `element-field-normal-plain-text-disabled` |
| `field-fg-label` | `element-field-normal-plain-text-label` |
| `field-fg-placeholder` | `element-field-normal-plain-text-placeholder` |
| `field-fg-readOnly` | `element-field-normal-plain-text-readOnly` |
| `field-fg-required` | `element-field-normal-plain-text-required` |
| `field-bg-rest` | `surface-field-normal-plain-primary-rest` |
| `field-bg-hover` | `surface-field-normal-plain-primary-hover` |
| `field-bg-focus` | `surface-field-normal-plain-primary-focus` |
| `field-bg-disabled` | `surface-field-normal-plain-primary-disabled` |
| `field-bg-readOnly` | `surface-field-normal-plain-primary-readOnly` |
| `field-border-rest` | `element-field-normal-plain-border-rest` |
| `field-border-hover` | `element-field-normal-plain-border-hover` |
| `field-border-active` | `element-field-normal-plain-border-active` |
| `field-border-disabled` | `element-field-normal-plain-border-disabled` |
| `field-border-readOnly` | `element-field-normal-plain-border-readOnly` |
| `field-border-danger` | `element-field-normal-danger-border` |
| `field-border-success` | `element-field-normal-success-border` |
| `field-tone-caution` | *(chromatic — see below)* |
| `field-tone-danger` | *(chromatic — see below)* |
| `field-tone-success` | *(chromatic — see below)* |

**Badge tokens:**

| Current | Proposed |
|---------|----------|
| `badge-tinted-accent-fg` | `element-badge-tinted-accent-text` |
| `badge-tinted-accent-bg` | `surface-badge-tinted-accent-primary` |
| `badge-tinted-accent-border` | `element-badge-tinted-accent-border` |

(Same pattern for action, agent, caution, danger, data, success.)

**Selection tokens:**

| Current | Proposed |
|---------|----------|
| `selection-fg` | `element-selection-normal-plain-text` |
| `selection-bg` | `surface-selection-normal-plain-primary` |
| `selection-bg-inactive` | `surface-selection-normal-plain-primary-inactive` |

**Checkmark/toggle tokens:**

| Current | Proposed |
|---------|----------|
| `checkmark-fg` | `element-checkmark-normal-plain-text` |
| `checkmark-fg-mixed` | `element-checkmark-normal-mixed-text` |
| `toggle-icon-disabled` | `element-toggle-normal-disabled-icon` |
| `toggle-icon-mixed` | `element-toggle-normal-mixed-icon` |

**Chromatic tokens (32):** These tokens do not participate in element/surface
pairings in the standard way. They are standalone chromatic values (overlays,
accents, highlights, toggle tracks/thumbs, radio dots). They need a naming
convention decision — either they adopt the six-slot structure with appropriate
values, or they are explicitly categorized as `chromatic-*` tokens outside the
element/surface system. This decision is deferred to the planning phase.

#### Execution strategy

This is a complete rename. No old names remain. The Phase 3.5-tooling upgrades
make this mechanical rather than manual.

**Step 1: Generate the rename map.**

```bash
bun run audit:tokens rename-map > token-rename-map.json
```

Review the generated map. Resolve any chromatic tokens flagged for manual naming
decisions. Iterate the naming convention if any names look wrong — regenerate,
review, adjust — until the map is correct. This is the design phase.

**Step 2: Preview the rename.**

```bash
bun run audit:tokens rename --map token-rename-map.json --stats
bun run audit:tokens rename --map token-rename-map.json
```

The stats mode shows the blast radius. The dry run shows every replacement that
will be made. Review for surprises.

**Step 3: Apply the rename.**

```bash
bun run audit:tokens rename --map token-rename-map.json --apply
```

This is the single mechanical step that renames all token references across all
files — CSS custom properties, `var()` references, `@tug-renders-on` annotations,
component alias definitions, TypeScript string keys, test assertions, contrast
exception strings, gallery/preview components.

**Step 4: Regenerate derived files.**

```bash
bun run audit:tokens inject --apply    # regenerate @tug-pairings blocks
bun run generate:tokens                # regenerate tug-base-generated.css + harmony.css
```

**Step 5: Verify nothing was missed.**

```bash
bun run audit:tokens rename --verify --map token-rename-map.json
```

Exit code 0 means zero stale references to old names remain anywhere in the
project.

**Step 6: Full verification gates.**

```bash
bun run audit:tokens lint       # zero violations
bun run audit:tokens pairings   # zero unresolved
bun run audit:tokens verify     # map ↔ CSS consistency
bun test                        # all tests pass
```

**Step 7: Update documentation.** All references to old token names in docs,
roadmaps, and design-system-concepts.md updated to new names. All
"foreground/background" language in design docs updated to "element/surface."
Add a rule to the Rules of Tugways establishing element/surface as the canonical
vocabulary for contrast and pairing discussions.

#### Scope of changes

Every file that references a `--tug-base-*` token is updated by the rename tool.
The auto-discovery in Phase 3.5-tooling ensures no files are missed. The major
categories:

1. **CSS custom property names** — all 373 `--tug-base-*` tokens renamed
2. **Component CSS files** (23 files) — `var()` references, `@tug-renders-on`
   annotations, component alias definitions
3. **Component alias tokens** (`--tug-card-*`, `--tug-tab-*`, etc.) — updated
   to reference new `--tug-base-*` names
4. **TypeScript source** — derivation rules, pairing map, theme engine, theme
   accessibility, canvas color, gallery/preview components
5. **Test files** — assertions, exception sets, descriptions
6. **Generated CSS** — regenerated via `generate:tokens`
7. **Documentation** — roadmaps, design docs, code comments
8. **audit-tokens.ts** — internal token references updated

### Phase 3.5B: Design vocabulary — semantic text types, contrast roles, recipe inputs

*Establishes the design vocabulary for the element plane, updates contrast roles,
and restructures recipe color inputs to match the naming convention from Phase 3.5A.*

#### Semantic text types

The current system treats all text as a single category. The same global text token
is used for card titles, body prose, button labels, and status text. But these serve
different design purposes. Phase 3.5A's naming convention already separates text
tokens by component (control, tab, badge, field). This phase completes the picture
by defining the semantic text types that drive element plane hue selection and
contrast role assignment.

| Type | Purpose | Examples |
|------|---------|---------|
| **content** | Prose, body text, descriptions | Card body, paragraphs, list items |
| **control** | Interactive element labels | Button text, menu items, tab labels |
| **display** | Titles, headers, emphasis | Card titles, section headers, hero text |
| **informational** | Status, metadata, secondary | Badges, timestamps, placeholders, muted text |

These types inform two things: (1) which element plane hue a token uses, and
(2) which contrast role the pairing map assigns to it.

#### Contrast roles

The current contrast role vocabulary is ad-hoc (`body-text`, `ui-component`,
`subdued-text`). Replace with four roles that map to the semantic text types:

| Current role | New role | Threshold |
|-------------|----------|-----------|
| `body-text` | `content` | 75 |
| `ui-component` | `control` | 60 |
| *(new)* | `display` | 45 |
| `subdued-text` | `informational` | 30 |

The `decorative` role (threshold 15) is retained for non-text ornamental elements
where contrast is not a legibility concern.

#### Card title token

The card title currently uses the global default text token. It needs its own token
(`element-cardTitle-normal-plain-text` per the Phase 3.5A convention) with its own
derivation rule and formula fields. This gives the card title independent control
over hue, tone, and intensity — and allows the pairing map to assign it the
`display` contrast role instead of `content`.

#### Recipe color inputs

The current `ThemeRecipe` interface specifies 13 hue inputs split into "structural"
and "role." This split mixes planes — `canvas` and `cardBg` are surfaces, `text`
and `borderTint` are elements, and `cardFrame` should be derived rather than
specified directly. The recipe inputs are reorganized into three groups that map
directly to the naming convention from Phase 3.5A:

**Surface plane (2 hues)** — what the backgrounds look like:

| Input | Controls | Current equivalent |
|-------|----------|-------------------|
| `canvas` | App background, canvas surface | `canvas` |
| `card` | Card/panel surfaces, overlays, insets | `cardBg` |

**Element plane (6 hues)** — what the foreground marks look like. The four textual
hues map to the semantic text types. The two graphical hues (`border`, `decorative`)
cover non-text visual marks:

| Input | Controls | Current equivalent |
|-------|----------|-------------------|
| `content` | Body prose text, primary icons | `text` |
| `control` | Interactive element labels, control icons | *(derived from `text` via intensity)* |
| `display` | Card titles, section headers | *(no equivalent — used global text token)* |
| `informational` | Muted/subtle text, metadata, placeholders | *(derived from `text` via intensity)* |
| `border` | Borders, dividers; formula basis for frame color | `borderTint` |
| `decorative` | Canvas grid, ornamental marks | *(missing — was `grid` in early designs)* |

**Semantic roles (7 hues)** — signal colors used across both planes:

| Input | Controls | Current equivalent |
|-------|----------|-------------------|
| `accent` | Accent signals (highlights, selection) | `accent` |
| `action` | Action signals (buttons, links, interactive cues) | `active` |
| `agent` | Agent/AI signals | `agent` |
| `data` | Data visualization signals | `data` |
| `success` | Success signals | `success` |
| `caution` | Warning signals | `caution` |
| `danger` | Error/destructive signals | `destructive` |

Total: 2 + 6 + 7 = 15 hue inputs.

**Derived values (not recipe inputs):**

| Value | Derived from | Rationale |
|-------|-------------|-----------|
| Frame color | `element.border` hue + formula | The card frame is visually an extension of the border system — same hue family, different tone/intensity. Deriving it from the border input ensures visual coherence without requiring a separate color choice. |
| Link color | `element.content` hue + `role.action` | Links are content text that signal action. The hue comes from the element plane; the semantic signal comes from the action role. |

#### Proposed ThemeRecipe interface

```typescript
export interface ThemeRecipe {
  name: string;
  description: string;
  mode: "dark" | "light";

  /** Surface plane — hues for backgrounds. */
  surface: {
    canvas: string;         // app background, canvas
    card: string;           // card/panel surfaces, overlays, insets
  };

  /** Element plane — hues for foreground marks. */
  element: {
    content: string;        // body prose, primary icons
    control: string;        // interactive labels, control icons
    display: string;        // card titles, section headers
    informational: string;  // muted/subtle text, metadata
    border: string;         // borders, dividers; formula basis for frame
    decorative: string;     // canvas grid, ornamental marks
  };

  /** Semantic roles — signal hues used across both planes. */
  role: {
    accent: string;         // highlights, selection
    action: string;         // buttons, links, interactive cues
    agent: string;          // agent/AI signals
    data: string;           // data visualization
    success: string;        // success signals
    caution: string;        // warning signals
    danger: string;         // error/destructive signals
  };

  /** Mood knobs (Phase 4 will expand these). */
  surfaceContrast?: number;   // 0-100, default 50
  signalIntensity?: number;   // 0-100, default 50
  warmth?: number;            // 0-100, default 50

  /** Formula constants for this recipe. */
  formulas?: DerivationFormulas;
}
```

#### What must change

1. **Define the four semantic text types** (`content`, `control`, `display`,
   `informational`) in design-system-concepts.md with purpose and examples.

2. **Update contrast roles.** Replace the current three-role system (`body-text`,
   `ui-component`, `subdued-text`) with the four-role system (`content`, `control`,
   `display`, `informational`) in the contrast engine's `CONTRAST_THRESHOLDS` map.

3. **Add a card title text token.** Create `element-cardTitle-normal-plain-text`
   with its own derivation rule and formula fields. Update `tug-card.css` to use
   this token for `.tugcard-title`. The token uses the `display` element hue.

4. **Update `ThemeRecipe` interface.** Replace the flat hue fields with the nested
   `surface`, `element`, `role` structure. Remove `cardFrame` (derived), `link`
   (derived), `borderTint` (renamed to `element.border`). Add `element.control`,
   `element.display`, `element.informational`, `element.decorative`. Rename
   `text` to `element.content`, `destructive` to `role.danger`.

5. **Update `EXAMPLE_RECIPES`.** Rewrite `brio` and `harmony` recipe objects to use
   the new structure. Choose appropriate hues for `control`, `display`,
   `informational`, and `decorative` — these are new design decisions.

6. **Update `resolveHueSlots()`.** Update Layer 1 hue resolution to read from the
   nested structure and to derive `frame` from `element.border` and `link` from
   `element.content` + `role.action`.

7. **Add derivation rules for the new element hues.** The element plane currently
   uses a single `text` hue slot for all text tokens. Add hue slots for `control`,
   `display`, `informational`, and `decorative`. Update derivation rules so each
   text token uses the hue slot matching its semantic text type.

8. **Update the pairing map roles.** Reassign every pairing in
   `element-surface-pairing-map.ts` to use the four-role vocabulary:
   - Global text tokens (default) → `content`
   - Control text tokens → `control`
   - Card title token → `display`
   - Badge text, placeholder, muted → `informational`
   - Icon, border, divider → `control`

9. **Update the Theme Generator UI.** Replace "Structural" / "Roles" column headers
   with "Surface" / "Element" / "Roles" groupings. Add hue pickers for the new
   element inputs.

10. **Update `@tug-pairings` blocks** via `bun run audit:tokens inject --apply`.

11. **Update contrast exception sets.** Some exceptions may be resolved by the
    threshold changes. Review and remove resolved entries.

12. **Verify:** `bun run audit:tokens lint`, `bun run audit:tokens pairings`,
    `bun run audit:tokens inject --apply`, `bun run audit:tokens verify`,
    `bun test` after all changes.

#### Note on emphasis

Emphasis (filled/outlined/ghost) is not a recipe color input. It controls how a role
color is *rendered* — filled renders the hue as a solid surface, outlined renders it
as a border, ghost renders it as transparent. The hue comes from the role; the
rendering strategy comes from the emphasis. Emphasis may become a recipe-level
*strategy parameter* in Phase 4 (e.g., "this recipe's default control emphasis is
outlined"), but it is not a color specification concern.

### Phase 3.5C: Spell out formula field abbreviations

*Addresses the readability tax of cryptic formula field names.*

The `DerivationFormulas` interface uses terse abbreviations that obscure meaning:
`txtI`, `atmI`, `txtISubtle`, `bgAppI`, `fgDefaultTone`. These names require
memorization or constant cross-referencing with JSDoc comments. Every person (or LLM)
reading the code pays this tax.

**Rename policy:** All formula field names in the `DerivationFormulas` interface,
`DARK_FORMULAS`, `LIGHT_FORMULAS`, and `derivation-rules.ts` are renamed to
self-documenting spelled-out names. The new names should align with the vocabulary
established in Phases 3.5A and 3.5B — using `element`, `surface`, `content`,
`control`, `display`, `informational` where applicable.

**Examples:**

| Current | Renamed |
|---------|---------|
| `txtI` | `contentTextIntensity` |
| `atmI` | `atmosphereIntensity` |
| `txtISubtle` | `informationalTextIntensity` |
| `bgAppTone` | `surfaceAppTone` |
| `bgAppI` | `surfaceAppIntensity` |
| `fgDefaultTone` | `contentTextTone` |
| `surfaceDefaultI` | `surfaceDefaultIntensity` |
| `cardFrameActiveI` | `cardFrameActiveIntensity` |

**What must change:**

1. **Rename all formula fields** in the `DerivationFormulas` interface (202 fields).
   Use a TypeScript-aware refactoring tool to ensure all references are updated
   atomically.

2. **Update `DARK_FORMULAS` and `LIGHT_FORMULAS`** — every field assignment gets
   the new name.

3. **Update `derivation-rules.ts`** — all `formulas.txtI` references become
   `formulas.contentTextIntensity`, etc.

4. **Update test assertions** that reference formula field names by string.

5. **Verify:** TypeScript compilation (zero errors), `bun run audit:tokens lint`,
   `bun test`. No behavioral changes — this is a pure rename.

**Naming conventions:**
- Tone fields: `<context>Tone` (e.g., `contentTextTone`, `surfaceRaisedTone`)
- Intensity fields: `<context>Intensity` (e.g., `contentTextIntensity`, `cardFrameActiveIntensity`)
- Alpha fields: `<context>Alpha` (e.g., `shadowExtraSmallAlpha`)
- Hue dispatch fields: `<context>HueSlot` (e.g., `contentHueSlot`, `cardFrameHueSlot`)
- String expression fields: `<context>HueExpression` (e.g., `mutedHueExpression`)

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
  (Harmony light theme) is superseded by Phase 3 of this document — the override
  approach was rebuilt as independent recipes.

- **contrast-engine-overhaul.md** Parts 1-2 (completed). Part 3 (formula
  de-duplication) is incorporated into Phase 4. Part 4 (contrast-aware derivation)
  was completed in Phase 2 of this document.

- **tugplan-token-audit-pairing** (Phase 1, PR #138, merged). Audited all 23
  component CSS files, regularized 7 token names, closed all pairing gaps, added
  `@tug-pairings` blocks and `verify-pairings.ts`.

- **tugplan-token-audit-enforce** (Phase 1.5, PR #139, merged). Built
  `audit-tokens.ts` with 6 subcommands, added 145 `@tug-renders-on` annotations,
  flattened alias chains, replaced heuristic resolution with deterministic parsing,
  added Rules 16/17 and D81 to the Rules of Tugways.

- **tugplan-contrast-engine-fix** (Phase 2, PR #140, merged). Two-pass composited
  enforcement, parameterized recipe test loop, shared exception module with
  categorized `[design-choice]` and `[phase-3-bug]` tags.

- **tugplan-independent-recipes** (Phase 3, PR #141, merged). Built standalone
  `LIGHT_FORMULAS` (202 fields), resolved all `[phase-3-bug]` entries, removed
  `BASE_FORMULAS`/`DARK_OVERRIDES`/`LIGHT_OVERRIDES`, updated all test imports,
  switched light-mode tests to use `LIGHT_FORMULAS`.

The work done in Parts 1-4 of the semantic-formula-architecture roadmap (named
builders, @semantic annotations, interface restructuring, design rationale comments)
remains valuable — it provides the vocabulary and organization that the independent
recipes use. The problem was not the annotation work but the assumption that light
could be built as an override of dark.
