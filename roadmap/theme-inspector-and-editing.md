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

### Phase A2 — Show All States for the Inspected Element

**Problem:** The FORMULA section only shows formula fields reachable
from three computed CSS values (background-color, color, border-color).
This misses most of the element's formula-driven styling. A tug-tab
shows `(constant)` even though it has `--tug-tab-fg-rest`,
`--tug-tab-fg-hover`, `--tug-tab-bg-rest`, etc. — all defined in its
matched CSS rules. A TugButton shows rest-state formulas but nothing
for hover, active, or disabled.

**Root cause:** `buildFormulaRows` only examines the three token chains
already traced. It never looks at the element's other `--tug-*` custom
properties.

**Solution:** Walk the inspected element's matched CSS rules, collect
all `--tug-*` custom properties, resolve each through the existing
`resolveTokenChain`, look up formula fields via the reverse map, and
group by interaction state.

This is NOT a global stylesheet scan. It's scoped to rules that match
the specific element the user clicked. The existing `walkRulesForToken`
already does element-scoped rule walking with `el.matches()` — the
new function follows the same pattern.

#### What to build

**One new function in `style-inspector-core.ts`:**

```
collectElementTugProperties(el: HTMLElement): string[]
```

Walk `document.styleSheets`. For each `CSSStyleRule`, check
`el.matches(rule.selectorText)`. If it matches, iterate
`rule.style` and collect any property starting with `--tug-`.
Recurse into grouping rules (`@media`, `@supports`, `@layer`)
the same way `walkRulesForToken` does. Also check ancestor
elements up the DOM (depth 3-5) since tug tokens are often
defined on parent containers like `body` or wrapper divs.

Return a deduplicated array of `--tug-*` property names.

**One new function in `style-inspector-core.ts`:**

```
buildAllStateFormulaRows(
  tugProperties: string[],
  formulasData: FormulasData,
  reverseMap: ReverseMap
): Map<string, FormulaRow[]>
```

For each property name:
1. Call `resolveTokenChain(property)` to walk the var() chain.
2. Get the terminal token (last hop's property, or the property
   itself if chain is empty).
3. Look up `reverseMap.tokenToFields.get(terminalToken)`.
4. If mappings found, build `FormulaRow` entries from
   `formulasData.formulas`.
5. Parse the interaction state from the property name suffix:
   `-rest`, `-hover`, `-active`, `-disabled`. Default to `"rest"`
   if no recognized suffix.
6. Insert rows into the Map keyed by state.

Deduplicate by field name within each state group (same field
can appear via multiple properties).

Return `Map<string, FormulaRow[]>` where keys are state names.

**Changes to `style-inspector-card.tsx`:**

1. Import `collectElementTugProperties` and
   `buildAllStateFormulaRows`.

2. In `handleElementSelected`, after the formulas fetch resolves,
   call `collectElementTugProperties(el)` then
   `buildAllStateFormulaRows(tugProps, data, reverseMap)`.
   Store the result in `inspectionDataRef`.

3. In the `formulas-updated` handler, recompute the same way.

4. Replace the current `FormulaSection` render with a loop over
   states. If only one state has rows (common case), render it
   without a state header. If multiple states have rows, render
   each with a header:

   ```
   FORMULA
   rest
     filledSurfaceRestTone = spec.role.tone  tone
     roleIntensity = Math.round(roleIntensity)  intensity
   hover
     filledSurfaceHoverTone = Math.max(0, ...)  tone
   active
     filledSurfaceActiveTone = Math.max(0, ...)  tone
   ```

   Each row is editable via the existing `FormulaChipValue`.

5. Add `InspectionData.allStateFormulas: Map<string, FormulaRow[]> | null`.

**CSS additions:**

Add a `.tug-inspector-formula-state__label` class for state
sub-headers (rest, hover, active, disabled). Style like a subtle
uppercase label — similar to how the existing section titles look
but smaller and lighter.

**What NOT to do:**

- Do NOT scan all stylesheets globally. Only rules matching the
  inspected element.
- Do NOT add categorization heuristics (BACKGROUND, TEXT, BORDER).
  Group by state only. The field names are self-documenting.
- Do NOT cache the property scan. The element's matched rules
  don't change between inspections of the same element, and
  re-scanning is cheap. Caching adds complexity with no benefit.
- Do NOT touch the existing three-chain display (BACKGROUND COLOR,
  TEXT COLOR, BORDER COLOR sections). Those stay as-is — they show
  the live resolution path. The expanded FORMULA section appears
  below them.

#### Testing

- Unit test `collectElementTugProperties` with a mock element
  that has matched rules containing `--tug-*` properties. Verify
  it collects from matching rules and skips non-matching ones.
- Unit test `buildAllStateFormulaRows` with mock properties and
  reverse map. Verify state grouping (-rest, -hover, -active,
  -disabled, default-to-rest).
- Verify `(constant)` no longer appears for tug-tab when it has
  `--tug-tab-*` properties in its matched rules.
- Verify TugButton shows rest, hover, and active formula groups.

#### Why this is different from the failed attempt

The failed Phase 2 implementation built `scanAllTugProperties`
which scanned every stylesheet globally for every `--tug-*`
property, then categorized them by name heuristic into
BACKGROUND/TEXT/BORDER/OTHER groups. That produced a wall of
hundreds of properties with no connection to the element being
inspected.

This approach:
- Scopes to the inspected element via `el.matches()`
- Groups by interaction state (useful) not semantic category
  (noise)
- Uses existing infrastructure (`walkRulesForToken` pattern,
  `resolveTokenChain`, reverse map)
- Produces a focused list of exactly the formula fields that
  control the element the user is looking at

### Phase A3 — Fix All-State Formula Collection (Phase A2 was incomplete)

**What Phase A2 got wrong:**

Phase A2 added `collectElementTugProperties` which scans matched CSS
rules for property **names** starting with `--tug-`. This works for
components that define custom property aliases (e.g., tug-tab defines
`--tug-tab-bg-rest: var(--tug-surface-tab-...)`). But it completely
misses components that reference `--tug-*` tokens via `var()` in
standard CSS properties (e.g., a button's rule sets
`background-color: var(--tug-surface-control-primary-filled-accent-rest)`).
The `--tug-*` token is in the property VALUE, not the property NAME.

Result: TugButton shows `(constant)` — a regression from before
Phase A2, where `buildFormulaRows` at least found the rest-state
formulas from the three traced chains.

Phase A2 also kept `buildFormulaRows` as a "fallback" path in
`FormulaSection`, creating two competing code paths. That's a code
smell, not a solution.

**What Phase A3 fixes:**

1. `collectElementTugProperties` must collect `--tug-*` tokens from
   TWO sources in matched rules:
   - Property **names** starting with `--tug-` (custom property
     aliases like `--tug-tab-bg-rest`)
   - `var(--tug-...)` references in property **values** (like
     `background-color: var(--tug-surface-control-...)`)

   Use `matchAll(/var\((--tug-[a-zA-Z0-9_-]+)/g)` on each property
   value to extract all `--tug-*` token references.

2. Remove `buildFormulaRows` entirely. `FormulaSection` takes
   `allStateFormulas: Map<string, FormulaRow[]>` — no `rows` prop,
   no fallback, no null check. One path.

3. Remove `formulaRows` variable and the `buildFormulaRows` call
   from `StyleInspectorContent`. The `allStateFormulas` field on
   `InspectionData` is the only formula data source.

4. Remove the `buildFormulaRows` import from `style-inspector-card.tsx`.

5. Remove the `buildFormulaRows` function from
   `style-inspector-core.ts` if nothing else imports it. Check
   whether tests or other files reference it — if so, remove those
   references too.

**Verification:**

- TugButton must show rest, hover, and active formula groups
  (not `(constant)`)
- tug-tab must show its formula fields across states
  (not `(constant)`)
- `bun run check`, `bun run test`, `bun run audit:tokens` pass

### Phase A4 — Fix pseudo-class matching in collectElementTugProperties

**Bug:** After editing a formula value, the FORMULA section loses
its hover/active state groups and shows only rest-state formulas.
Initial inspection works because the element may still have hover
state from the scan click.

**Root cause:** `collectElementTugProperties` calls
`el.matches(rule.selectorText)` on each CSS rule. For a rule like
`.tug-button-filled-accent:hover`, this only returns true when the
element is CURRENTLY being hovered. After an HMR update, the user's
mouse is on the inspector card, not the inspected element — so
`:hover` rules don't match, and their `var(--tug-*)` references
are never collected.

The same problem affects `:active`, `:focus`, and `:disabled`
pseudo-class selectors.

**Fix:** Before calling `el.matches()`, strip interaction
pseudo-classes from the selector. We want rules that COULD apply
to the element in any state, not rules that match its current state.

In `collectElementTugProperties`, replace:

```typescript
matches = target.matches(rule.selectorText);
```

with:

```typescript
const stripped = rule.selectorText.replace(
  /:(?:hover|active|focus|focus-visible|focus-within|disabled)/g, ""
);
matches = target.matches(stripped);
```

This is a one-line change inside the existing function. No new
functions, no new data flow, no new props.

**Verification:**

- Inspect a TugButton → see REST and HOVER state groups
- Edit a formula value → after HMR, REST and HOVER groups persist
- Inspect a tug-tab → see its formula fields across states

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
