# Theme Inspector and Editing

Consolidate theme editing into a single card. Make formula values editable
in the inspector. Clean up the code produced by the failed Phase 2 attempt.

## Current State

The **Style Inspector** card (Opt+Cmd+I) inspects elements: three-state
button, scan overlay, pinned highlight, token chain display (bg/fg/border),
formula provenance section showing which DerivationFormulas fields control
the inspected element's colors. This all works.

The **Theme Generator** gallery card has five sections:
- **Colors** — hue pickers for canvas, grid, frame, card, text, role accents
- **Controls** — semantic role hue pickers (accent, action, agent, etc.)
- **Contrast Dashboard** — WCAG contrast results with threshold badges
- **CVD Preview** — color vision deficiency simulation grid
- **Contrast Diagnostics** — diagnostic table output

A merged PR added inline editing infrastructure (POST endpoint,
`findAndEditNumericLiteral`, HMR listeners, `FormulaChipValue` component)
but the editing doesn't actually work because `getEditableType` returns
"readonly" for any formula field whose recipe expression lacks a numeric
literal — and most fields the inspector shows (like `roleIntensity`,
`filledSurfaceRestTone`) come from `spec.*` references or `Math.round()`
wrappers with no editable literal.

## What's Wrong

1. **Formula values aren't editable.** The inspector shows
   `roleIntensity = 50` but you can't click it. The value 50 is right
   there but the code refuses to let you edit it because the recipe
   source is `Math.round(roleIntensity)` — no bare numeric literal.

2. **The editing strategy is too narrow.** `findAndEditNumericLiteral`
   only handles expressions that contain a numeric literal. For
   expressions like `spec.role.tone`, `roleTone`, or
   `Math.round(roleIntensity)`, it returns null and the field is
   read-only. But the user sees a number. They should be able to
   change it.

3. **Theme editing is split across two cards.** The Colors and Controls
   sections in Theme Generator overlap conceptually with what the
   inspector does — both let you change formula values. But the
   inspector shows you which values affect the element you're looking
   at, which is strictly more useful.

4. **Dead code from the failed All Tug Properties implementation.**
   A dash cleaned up most of it, but the overall code quality needs
   an audit pass.

## Target State

### Card Restructuring

**Style Inspector → Theme Inspector**

The card is renamed. It keeps everything it has now (element inspection,
token chains, formula provenance) and gains:

- Inline editing of formula values in the FORMULA section
- The Colors section from Theme Generator (hue pickers for spec fields)

The inspection workflow doesn't change: scan, click element, see its
token chains and formulas, edit values inline.

**Theme Generator → Theme Accessibility**

The card is renamed. It keeps only:
- Contrast Dashboard
- CVD Preview
- Contrast Diagnostics

Everything else (Colors, Controls) is removed from this card.

**Controls section — removed entirely.** The per-component gallery cards
already show each component's states and variants. No functionality lost.

**Theme Creation** stays in the Theme Accessibility card for now.
Creating a theme is an analytical task (pick parameters, evaluate
contrast) that fits with the accessibility tools. The Theme Inspector
is for inspecting and tweaking what you already have. We can revisit
this later if it feels wrong.

### Formula Editing — How It Must Work

The user sees `roleIntensity = 50 intensity`. They click 50, type 60,
press Enter. The theme updates live. This must work for every numeric
formula value the inspector shows, regardless of recipe expression form.

**Editing strategy:**

When the user edits a formula value, the POST handler receives
`{ field: "roleIntensity", value: 60 }`. It reads the recipe file,
finds the line for `roleIntensity`, and:

1. **If the expression contains a numeric literal** (e.g.,
   `canvasTone + 6`): replace the literal (`canvasTone + 8`).
   This is what `findAndEditNumericLiteral` already does.

2. **If no numeric literal exists** (e.g., `spec.role.tone`,
   `Math.round(roleIntensity)`, `roleTone`): replace the entire
   RHS with the new value as a bare literal (`60`). The expression
   structure is lost, but the user explicitly chose a new value.

This means `findAndEditNumericLiteral` needs a fallback mode: when
it can't find a literal to replace, it replaces the whole expression.

**Editability rule:**

`getEditableType` is simplified: if `row.value` is a number, it's
`"numeric"`. If the field name ends with `HueSlot`, it's `"hue"`.
If `row.value` is a boolean, it's `"readonly"`. No source expression
check needed — sources are only used to pre-fill the edit input with
the current literal (when one exists) instead of the computed value.

**Sources (pre-fill behavior):**

Sources are read from the recipe file at GET request time (no sidecar,
no caching). When a source has a numeric literal, the edit input
pre-fills with that literal (e.g., `28` from `primaryTextTone - 28`).
When there's no literal, it pre-fills with the computed value
(e.g., `50` from `roleIntensity = 50`). Either way, the user can
edit the number.

### Colors Section in Theme Inspector

The Colors section from Theme Generator moves to Theme Inspector as
a collapsible section below the Formula section. It shows the hue
pickers for the current theme's spec fields (canvas hue, text hue,
role hue, etc.).

This section is always visible (not tied to element inspection) and
provides a broader editing surface for the theme's color parameters.
Changes here trigger the same HMR pipeline as inline formula edits.

Implementation note: the existing `CompactHuePicker` and
`FullColorPicker` components from `gallery-theme-generator-content.tsx`
should be extracted to shared modules, not duplicated. The Theme
Accessibility card continues to use them for its theme creation flow.

## Execution Plan

### Phase A — Fix Formula Editing (must work first)

1. **Fix `getEditableType`**: If value is a number, return `"numeric"`.
   If field is hueSlot, return `"hue"`. If boolean, return `"readonly"`.
   Remove the source expression check.

2. **Fix `findAndEditNumericLiteral` fallback**: When no numeric literal
   is found in the expression, replace the entire RHS with the new
   value. Return the modified file content, not null.

3. **Fix source pre-fill**: When `extractLastNumericLiteral` returns
   null for the source, pre-fill the edit input with the computed
   value (the number the user sees) instead of refusing to edit.

4. **Verify end-to-end**: Inspect a TugButton. Click `roleIntensity`'s
   value (50). Type 60. Press Enter. The recipe file changes, HMR
   fires, the inspector updates to show 60. This must work for every
   formula field the inspector shows.

5. **Update tests**: Tests for `getEditableType` need to reflect the
   new rule. Tests for `findAndEditNumericLiteral` need to cover the
   whole-RHS-replacement fallback. Existing tests for the happy path
   (literal replacement) should not change.

### Phase B — Code Audit and Cleanup

1. **Audit `style-inspector-core.ts`**: Remove any dead code left
   from Phase 2 cleanup. Verify all exports are used. Remove
   `createFormulaSection` if it's dead.

2. **Audit `vite.config.ts`**: Verify all `formulasCache` population
   paths are consistent. Remove any remaining sidecar references.
   Verify `handleFormulasGet` reads sources correctly.

3. **Audit `style-inspector-card.tsx`**: Verify `FormulaChipValue`
   renders correctly for all editableType values. Remove any dead
   code or stale comments referencing the All Properties section.

4. **Audit CSS**: Verify no dead classes remain. Verify `@tug-pairings`
   are accurate.

5. **Run all checks**: `bun run check`, `bun run test`,
   `bun run audit:tokens`.

### Phase C — Card Restructuring

1. **Rename Style Inspector → Theme Inspector**: Update card
   registration, menu items, comments, test descriptions. The card
   component ID changes from "style-inspector" to "theme-inspector".

2. **Extract shared components**: Move `CompactHuePicker`,
   `FullColorPicker`, and related helpers from
   `gallery-theme-generator-content.tsx` to shared modules.

3. **Add Colors section to Theme Inspector**: Import the shared
   hue picker components. Add a collapsible "Colors" section below
   the Formula section. Wire changes to the same POST/HMR pipeline.

4. **Rename Theme Generator → Theme Accessibility**: Update card
   registration, remove Colors and Controls sections, keep Contrast
   Dashboard, CVD Preview, Contrast Diagnostics. Import shared
   picker components for theme creation flow.

5. **Remove Controls section**: Delete from Theme Generator. Verify
   per-component gallery cards cover all functionality.

6. **Update all tests**: Card registration IDs, component names,
   section presence/absence.

## Lessons Learned (from prior failures — do not ignore)

These are from `roadmap/formula-provenance-and-editing.md` and from
the failed Phase 2 implementation. Every plan and agent must follow them.

### Keep it simple

The failed implementation built a global stylesheet scanner, property
categorization heuristics, and a sidecar caching pattern — none of
which the user needed. The user wanted to click a number and change it.
Start from the user's action and work backward to the minimum code.

### Vite config dependency tracking

Any file reachable via `require()` from vite.config.ts is a config dep.
When it changes, Vite restarts the dev server. Use subprocesses for
theme-engine imports. Construct paths dynamically so the scanner can't
trace them.

### No sidecar files

The `.formulas.json` sidecar was out of sync on multiple code paths.
Read the recipe file directly at request time. The file is on disk.
It's 200 lines. Reading it is cheap.

### Token name formats

RULES keys include the `--tug-` prefix. Never double-prefix when
looking up from the reverse map.

### require() caching

Node's `require()` caches modules forever. The subprocess approach
avoids this. Do not add `require()` calls for theme-engine or recipe
files to vite.config.ts.

### Test reality, not just conformance

The failed implementation passed all tests but the feature didn't work.
Tests verified code matched the plan — nobody verified the plan matched
reality. End-to-end verification (inspect element, click value, verify
edit works) is not optional.

### Don't optimize for test passage

Clean, correct code matters more than test counts. Write the code
right, then make tests match the code. Not the other way around.
