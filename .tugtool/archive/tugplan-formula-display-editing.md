<!-- tugplan-skeleton v2 -->

## Complete Formula Display and Inline Editing {#formula-display-editing}

**Purpose:** Show all formula-controlled tug properties for an inspected element (across all states), grouped by semantic category, and let the user edit numeric values inline with live hot-reload feedback.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | formula-display-editing |
| Last updated | 2026-03-24 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The style inspector currently traces token chains for three computed CSS values (background-color, color, border-color) on the selected element, then looks up those terminal tokens in the reverse map to find formula fields. This approach has two shortcomings: (1) elements with rich styling show "(constant)" because `buildFormulaRows` only follows the three chains it already traced, and (2) only the currently-computed rest-state values are visible -- hover, active, and disabled state formula fields are invisible.

Phase 1.5 and 1.5B are complete. The inspector is a card with three-state button, persistent highlight, theme-aware styling, and scan mode via Opt+Cmd+E. This phase adds comprehensive formula display and inline editing -- the core developer workflow for tuning theme recipes.

#### Strategy {#strategy}

- Scan ALL stylesheets for `--tug-*` custom property definitions on `:root`/`body`/`html` (not element-matched rules) to discover every tug property the element could use.
- Run `resolveTokenChain` on each discovered property and look up formula fields via the existing reverse map.
- Group results by semantic category (BACKGROUND, TEXT, BORDER, OTHER) using name heuristic on the token alias, and by state suffix (-rest, -hover, -active, -disabled).
- Keep the existing three-chain display; add the expanded all-properties table below it.
- Add inline editing: click a formula value, edit the numeric literal WITHIN the expression (not replace the whole RHS), press Enter, POST to a new endpoint that performs a targeted regex edit on the recipe file.
- Let HMR deliver the update; the server sends a custom `tug:formulas-updated` event after regeneration, with `vite:afterUpdate` as fallback, to trigger a re-fetch.

#### Success Criteria (Measurable) {#success-criteria}

- All `--tug-*` properties defined on `:root`/`body`/`html` are discovered and displayed grouped by category and state (verify: inspect a TugButton and see BACKGROUND rest/hover/active rows, TEXT rest/hover/active rows, BORDER rows).
- Clicking a numeric formula value shows an editable input pre-filled with the source literal (not the computed value); pressing Enter triggers `POST /__themes/formula` (verify: network panel shows the POST, recipe file on disk is modified). Fields whose source expression has no numeric literal (bare variable refs) are read-only.
- The POST handler edits only the specific numeric literal within the expression RHS, not the entire expression (verify: `mutedTextTone: primaryTextTone - 28` with value edit to 30 results in `mutedTextTone: primaryTextTone - 30`, not `mutedTextTone: 30`).
- After edit + HMR cycle, the inspector re-fetches formulas and displays updated values (verify: edited value appears in inspector within ~1 second).
- Hue slot fields show a `<select>` dropdown; boolean fields are read-only (verify: visual inspection).

#### Scope {#scope}

1. Enumerate all `--tug-*` properties from stylesheet rules on `:root`/`body`/`html`
2. Group properties by semantic category and state
3. Display formula fields for each property via reverse map
4. `POST /__themes/formula` endpoint with targeted numeric literal editing
5. Inline editing UI with input fields, hue slot dropdowns, read-only booleans
6. HMR-triggered re-fetch via custom `tug:formulas-updated` event (with `vite:afterUpdate` fallback)

#### Non-goals (Explicitly out of scope) {#non-goals}

- No sliders, drag preview, or pointer capture
- No two-phase commit or client-side oklch parsing
- No TugAccordion for collapsible groups (future work)
- No "force state" toggles for hover/active inspection (the all-properties scan makes this unnecessary)
- No separate refresh mechanism beyond existing HMR pipeline

#### Dependencies / Prerequisites {#dependencies}

- Phase 1.5B complete (style inspector card with three-state button, persistent highlight, theme-aware styling)
- `resolveTokenChain`, `buildReverseMap`, `fetchFormulasData` functions working correctly
- `GET /__themes/formulas` endpoint serving cached formula data (will be extended to include source expressions)
- `handleHotUpdate` in vite.config.ts correctly handling recipe file changes

#### Constraints {#constraints}

- L06: Appearance changes through CSS/DOM, never React state -- inline editing UI must use imperative DOM for input creation/removal
- L02: External state enters React through `useSyncExternalStore` only
- L03: `useLayoutEffect` for registrations that events depend on (HMR listener)
- L15: Interactive controls use token-driven control states
- L16: Every color-setting rule declares its rendering surface
- L17: Component alias tokens resolve to `--tug-*` in one hop
- POST handler must NOT replace entire expression RHS with a bare literal (see [D02])
- Recipe files use expressions like `primaryTextTone - 28` and `spec.role.tone`; the handler must identify the specific numeric constant within the expression

#### Assumptions {#assumptions}

- The FormulaSection React component will be extended (not replaced) to render the new all-properties table below the existing three chain sections
- Boolean formula fields will be shown as read-only with no edit control
- HueSlot fields will use a `<select>` dropdown populated from `RESOLVED_HUE_SLOT_KEYS` exported from `formula-reverse-map.ts` (currently module-private; Step 1 exports it)
- The POST handler will be a new exported function in vite.config.ts following the same testable handler pattern as `handleThemesActivate`
- The existing `resolveTokenChain` function will be reused as-is for each discovered `--tug-*` property
- No new CSS files are needed -- styles for the expanded table will go in `style-inspector-card.css`

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors and rich References lines per the skeleton contract. See the skeleton for full conventions.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Regex edit on recipe files fails for complex expressions | high | medium | Comprehensive regex patterns + unit tests for all expression forms | First edit that produces invalid TypeScript |
| Stylesheet scan is slow with many stylesheets | medium | low | Cache the property set; only re-scan on element change | Inspector feels sluggish when selecting elements |
| HMR `vite:afterUpdate` fires for unrelated CSS changes | low | high | Re-fetch unconditionally; the fetch is cheap (~1ms) | N/A (accepted by design) |

**Risk R01: Regex edit may corrupt expression structure** {#r01-regex-corruption}

- **Risk:** A regex replace targeting a numeric literal could match the wrong number in a complex expression (e.g., `canvasTone + 89` has both the offset literal and could theoretically match part of a variable name containing digits).
- **Mitigation:** The regex targets the specific field assignment line (e.g., `/^\s*mutedTextTone:\s*/`) and replaces only the last numeric literal on that line. Unit tests cover all expression forms found in recipes: bare literals, `variable + N`, `variable - N`, `spec.role.tone`, `primaryTextTone`, `Math.max(0, Math.min(100, expr +/- N))`, `Math.round(expr - N)`, and `Math.round(variable)` (non-editable).
- **Residual risk:** Extremely unusual expression forms not covered by tests could be mis-edited. The recipe file is under version control, so any corruption is recoverable.

**Risk R02: Stylesheet scan performance** {#r02-scan-performance}

- **Risk:** Scanning all stylesheets on every element inspection could be slow if there are many stylesheets with many rules.
- **Mitigation:** Scan `:root`/`body`/`html` rules only (not element-matched), which limits the search space. Cache results per session since global `--tug-*` definitions don't change without a theme switch.
- **Residual risk:** First scan may take 10-50ms on large stylesheets; subsequent scans use cache.

**Risk R03: Replace-last-literal strategy depends on recipe expression conventions** {#r03-last-literal-assumption}

- **Risk:** The regex edit strategy relies on clamp-detection and a replace-last-literal fallback. For `Math.max(N, Math.min(N, innerExpr))` clamped expressions, the algorithm extracts `innerExpr` and looks for an arithmetic operator with a numeric literal; if no operator exists (bare variable), it returns null to avoid editing clamp bounds. For non-clamped lines, it replaces the last numeric literal. If a future recipe form places the editable literal before another number in a non-clamped context (e.g., a hypothetical `scale(28, someVar)`), the regex would edit the wrong number.
- **Mitigation:** Unit tests explicitly verify the clamp-detection logic: `Math.max(0, Math.min(100, expr - 5))` edits `5`; `Math.max(0, Math.min(100, variable))` (clamped with no offset) returns null rather than editing a clamp bound. Tests also cover all other expression forms. A comment in `findAndEditNumericLiteral` documents both the clamp-detection and replace-last-literal assumptions. If new expression forms are added to recipes, the corresponding test must be added.
- **Residual risk:** A recipe author could introduce a non-conforming expression form without updating tests. The recipe file is under version control, so any corruption is recoverable.

---

### Design Decisions {#design-decisions}

#### [D01] Scan all stylesheets for global --tug-* definitions (DECIDED) {#d01-scan-all-stylesheets}

**Decision:** Instead of tracing three CSS properties and hoping the reverse map connects them to formulas, scan ALL stylesheets for `--tug-*` custom property definitions on `:root`/`body`/`html` selectors.

**Rationale:**
- Every `--tug-*` property is defined on `:root` or `body` -- they are global by design (L17).
- This captures all states (rest, hover, active, disabled) regardless of which CSS property is currently computed.
- No component identification heuristic needed -- we enumerate what exists.

**Implications:**
- Need a new function `scanAllTugProperties()` in `style-inspector-overlay.ts` that walks all stylesheet rules.
- Results are cached per session (global tug properties don't change without theme switch/HMR).
- The existing three-chain display is retained; the all-properties table is additive.

#### [D02] Edit numeric literal within expression, not replace RHS (DECIDED) {#d02-edit-within-expression}

**Decision:** The `POST /__themes/formula` handler must identify and edit the specific numeric constant within the expression, not replace the entire RHS with a bare literal.

**Rationale:**
- Recipe fields use expressions like `primaryTextTone - 28` and `spec.role.tone`.
- Replacing the entire RHS with `30` would destroy the expression structure and break the recipe's design intent.
- The numeric literal is the user-editable part; the expression structure is the recipe author's intent.

**Implications:**
- The handler uses a two-step regex: (1) find the line matching the field name, (2) replace the specific numeric literal on that line.
- For expressions like `primaryTextTone - 28`, editing the value means changing `28` to the new number.
- For bare literals like `surfaceAppIntensity: 2`, editing replaces `2` with the new number.
- For non-numeric fields (hue slot strings, booleans), different edit strategies apply (hue slot: replace string literal; boolean: read-only).
- The handler receives the field name and the new value; it does NOT receive the full expression.

#### [D03] Group by name heuristic, not by token type (DECIDED) {#d03-group-by-name}

**Decision:** Group `--tug-*` properties into semantic categories by parsing the alias name, not by RULES token type.

**Rationale:**
- Alias names like `--tug-tab-bg-rest`, `--tug-tab-fg-hover` encode category and state directly.
- Name parsing is simple and matches what the developer sees in CSS.
- RULES token types (chromatic, shadow, etc.) don't map cleanly to visual categories.

**Implications:**
- Category heuristic: `-bg-`/`-surface-` -> BACKGROUND, `-fg-`/`-text-` -> TEXT, `-border-` -> BORDER, rest -> OTHER.
- State heuristic: `-rest`/`-hover`/`-active`/`-disabled` suffixes.
- Properties with no recognized category go to OTHER.

#### [D04] HMR listener for re-fetch (DECIDED) {#d04-hmr-listener}

**Decision:** Use a custom HMR event `tug:formulas-updated` sent by the `controlTokenHotReload` plugin after `reactivateActiveTheme` completes, with `vite:afterUpdate` as a fallback for non-recipe CSS changes.

**Rationale:**
- CSS-only HMR in Vite works through link/style tag replacement which may not dispatch `vite:afterUpdate`. A custom event guarantees the signal arrives after formula regeneration.
- False positives from `vite:afterUpdate` (unrelated CSS changes) are acceptable as a fallback -- the fetch is cheap (~1ms).
- Both `server.hot.send()` (server-side) and `import.meta.hot.on()` (client-side) are standard Vite APIs.

**Implications:**
- In `controlTokenHotReload` plugin's `handleHotUpdate`, after `reactivateActiveTheme()` completes, call `server.hot.send({ type: 'custom', event: 'tug:formulas-updated' })` to notify the client.
- Register the `import.meta.hot.on('tug:formulas-updated')` listener at module level (guarded by `if (import.meta.hot)`), following the existing `import.meta.hot` guard pattern used in `css-imports.ts`. Also register `import.meta.hot.on('vite:afterUpdate')` as a fallback. Both listeners dispatch a `formulas-updated` event via `styleInspectorBus`.
- The `StyleInspectorBusEvent` type must be extended from `'toggle-scan'` to `'toggle-scan' | 'formulas-updated'` to support the new event.
- The React component subscribes to the bus signal via `useLayoutEffect` (L03) and calls `fetchFormulasData()` to update the display.
- The `useLayoutEffect` subscription is cleaned up on unmount. The module-level `import.meta.hot.on()` listeners persist (dev-only, no cleanup needed).

#### [D05] POST handler follows testable handler pattern (DECIDED) {#d05-testable-handler}

**Decision:** The `POST /__themes/formula` handler is a new exported function `handleFormulaEdit` in vite.config.ts, following the same pattern as `handleThemesActivate`.

**Rationale:**
- Consistency with existing codebase patterns.
- Exported function enables unit testing with mocked fs.
- The handler reads the recipe file, performs a targeted regex edit, and writes the file back.

**Implications:**
- Handler signature: `handleFormulaEdit(body, fsImpl: FsWriteImpl, formulasCacheRef) -> { status, body }`. Uses existing `FsWriteImpl` interface which includes both `readFileSync` and `writeFileSync`.
- The file write triggers the existing `handleHotUpdate` recipe handler which runs `regenerate()` + `reactivateActiveTheme()`.
- No subprocess calls, no regeneration, no cache update in the handler itself -- HMR handles all of that.
- No write mutex is needed (unlike `handleThemesActivate` which uses `withMutex`). The handler only writes the recipe file; the HMR chain triggered by the file write runs through `handleHotUpdate` which is synchronous. Race with concurrent activate is unlikely in a single-user dev tool and the existing HMR pipeline handles it.

#### [D06] Inline editing uses imperative DOM (DECIDED) {#d06-imperative-editing}

**Decision:** Inline editing (click value -> show input -> Enter -> POST) uses imperative DOM manipulation, not React state for the input lifecycle.

**Rationale:**
- L06: Appearance changes through CSS/DOM, never React state.
- The input element is a transient overlay on the formula value display -- it doesn't represent durable component state.
- React re-renders during editing would cause input focus loss.

**Implications:**
- On click: create an `<input>` element imperatively, position it over the value span, focus it.
- On Enter/blur: read the input value, POST it, remove the input, restore the value span.
- On Escape: cancel edit, remove the input, restore the value span.
- Hue slot fields: create a `<select>` element imperatively with the same lifecycle.

#### [D07] Extend GET formulas endpoint with source expressions (DECIDED) {#d07-source-expressions}

**Decision:** The `GET /__themes/formulas` endpoint returns a `sources` object alongside the existing `formulas` object. `sources` maps each formula field name to its source expression text from the recipe file (e.g., `"mutedTextTone": "primaryTextTone - 28"`).

**Rationale:**
- The `formulas` object contains COMPUTED values (e.g., `mutedTextTone: 66`). The POST handler replaces the SOURCE literal (e.g., `28` in `primaryTextTone - 28`).
- Without source expressions, the input field would show `66` (the computed value), but the user needs to type the replacement for `28` (the source literal). This mismatch would be confusing and error-prone.
- With source expressions available, the client extracts the numeric literal from the expression text and pre-fills the input with that literal. The user sees and edits the actual value that will be replaced.

**Implications:**
- The `generate-theme-override.ts` subprocess reads the recipe file source to extract expression text for each formula field and includes it in the sidecar JSON.
- `FormulasCache` gains a `sources: Record<string, string>` field.
- `FormulasData` on the client gains the same `sources` field.
- The client uses `sources[fieldName]` to extract the last numeric literal (via regex) for input pre-fill.
- Fields with no numeric literal in their source expression (e.g., `contentTextTone: primaryTextTone,` or `filledSurfaceRestTone: spec.role.tone,`) show a computed read-only value.
- Shorthand property assignments (e.g., `cardBodyTone,` with no colon) have no extractable source expression; `sources[field]` will be `undefined` for these. The client treats `undefined` sources as read-only display (show computed value, no edit control).

#### [D08] Export RESOLVED_HUE_SLOT_KEYS for client use (DECIDED) {#d08-export-hue-slot-keys}

**Decision:** Export `RESOLVED_HUE_SLOT_KEYS` from `formula-reverse-map.ts` so the client can populate hue slot `<select>` dropdown options at runtime.

**Rationale:**
- `RESOLVED_HUE_SLOT_KEYS` is currently module-private (`const` without `export`).
- The client needs these keys to populate the hue slot dropdown options.
- Exporting the existing constant is simpler than duplicating the list or deriving it from the `ResolvedHueSlots` interface at runtime.

**Implications:**
- Change `const RESOLVED_HUE_SLOT_KEYS` to `export const RESOLVED_HUE_SLOT_KEYS` in `formula-reverse-map.ts`.
- Hue slot `<select>` options are derived from this set.

---

### Specification {#specification}

#### Property Discovery {#property-discovery}

**Spec S01: Stylesheet scan for --tug-* properties** {#s01-stylesheet-scan}

Walk all `document.styleSheets`, recursing into grouping rules (`@media`, `@supports`, `@layer`). For each `CSSStyleRule`:
1. Check if the selector matches `:root`, `body`, or `html` (use a simple string check, not `el.matches()`).
2. Iterate the rule's `style` object for properties starting with `--tug-`.
3. Collect unique property names into a `Set<string>`.

Cache the result in a module-level variable. Invalidate on theme change (listen for HMR update).

**Spec S06: Extended formulas endpoint response** {#s06-extended-formulas}

The `GET /__themes/formulas` response gains a `sources` field:
```json
{
  "formulas": { "mutedTextTone": 66, "surfaceAppIntensity": 2, ... },
  "sources": { "mutedTextTone": "primaryTextTone - 28", "surfaceAppIntensity": "2", "contentTextTone": "primaryTextTone", ... },
  "mode": "dark",
  "themeName": "example"
}
```

- `sources` maps each formula field to its verbatim RHS expression text from the recipe file.
- The `generate-theme-override.ts` subprocess extracts source expressions by reading the recipe file, finding each field assignment, and capturing the RHS text.
- `FormulasCache` interface gains `sources: Record<string, string>`.
- `FormulasData` interface on the client gains `sources: Record<string, string>`.
- The client extracts the last numeric literal from `sources[field]` via regex to pre-fill edit inputs. If no numeric literal is found, the field is displayed as read-only.

**Spec S02: Property grouping** {#s02-property-grouping}

**Table T01: Category heuristic** {#t01-category-heuristic}

| Substring in property name | Category |
|---------------------------|----------|
| `-bg-` or `-surface-` | BACKGROUND |
| `-fg-` or `-text-` | TEXT |
| `-border-` or `-divider-` | BORDER |
| (none of the above) | OTHER |

**Table T02: State heuristic** {#t02-state-heuristic}

| Suffix | State |
|--------|-------|
| `-rest` | rest |
| `-hover` | hover |
| `-active` | active |
| `-disabled` | disabled |
| (none of the above) | rest (default) |

Grouping structure: `Map<Category, Map<State, PropertyEntry[]>>` where `PropertyEntry` contains: property name, resolved chain, formula rows.

#### Inline Editing {#inline-editing}

**Spec S03: POST /__themes/formula endpoint** {#s03-post-endpoint}

Request body:
```json
{
  "field": "mutedTextTone",
  "value": 30
}
```

The `value` field contains the new literal to write into the source expression. The client extracts the current source literal from the `sources` object returned by `GET /__themes/formulas` (see Spec S06), shows that literal in the input field, and sends the user's replacement directly.

For example, if `sources.mutedTextTone` is `"primaryTextTone - 28"`, the input pre-fills with `28`. The user types `30`, and the POST sends `{ "field": "mutedTextTone", "value": 30 }`. The handler replaces `28` with `30` in the source expression.

Handler logic:
1. Validate `field` is a non-empty string and `value` is a number or string.
2. Read `formulasCache.mode` to determine which recipe file to edit (`dark.ts` or `light.ts`).
3. Read the recipe file content.
4. Find the line matching the field: regex `/^\s*<field>\s*[:=]/m`.
5. On that line, apply a clamp-aware replace-last-literal strategy (see Risk R03):
   - If the line contains a `Math.max(N, Math.min(N, innerExpr))` clamp wrapper, extract `innerExpr`. If `innerExpr` contains an arithmetic operator (`+`/`-`) followed by a numeric literal, replace that literal. If `innerExpr` is a bare variable with no arithmetic operator, return 404 (the `0` and `100` are clamp bounds, not the editable literal).
   - For non-clamped lines with a numeric literal (e.g., `mutedTextTone: primaryTextTone - 28`), replace the LAST numeric literal on the line with the new value.
   - For bare literal assignments (e.g., `surfaceAppIntensity: 2`), replace the numeric literal.
   - For string values (hue slot edits), replace the string literal.
   - For shorthand property assignments (e.g., `cardBodyTone,` with no colon), or bare variable references with no numeric literal, return 404.
6. Write the modified content back to the recipe file.
7. Return `{ ok: true }` with status 200.
8. The file write triggers `handleHotUpdate` for the recipe file, which runs `regenerate()` + `reactivateActiveTheme()` + HMR delivery.

Response:
```json
{ "ok": true }
```

Error responses: 400 for invalid body, 404 for field not found in recipe, 500 for write failure.

**Spec S04: HMR re-fetch flow** {#s04-hmr-refetch}

1. User edits value -> Enter -> `POST /__themes/formula`.
2. Handler writes recipe file.
3. Vite `handleHotUpdate` fires for recipe file change -> `regenerate()` + `reactivateActiveTheme()`.
4. `reactivateActiveTheme` writes new CSS to `tug-theme-override.css` and updates `formulasCache`.
5. After `reactivateActiveTheme` completes, `controlTokenHotReload` plugin sends `server.hot.send({ type: 'custom', event: 'tug:formulas-updated' })`.
6. Client receives `tug:formulas-updated` custom event (or `vite:afterUpdate` as fallback for non-recipe CSS changes).
7. Listener dispatches `formulas-updated` event on `styleInspectorBus`.
8. Inspector calls `fetchFormulasData()` and re-renders with updated values.

**Spec S05: Editable field types** {#s05-editable-field-types}

**Table T03: Edit controls by field type** {#t03-edit-controls}

| Field property | Control | Pre-fill value | Behavior |
|---------------|---------|---------------|----------|
| `tone` (has numeric literal in source) | `<input type="text">` | Last numeric literal from `sources[field]` | Accept numeric value, POST on Enter |
| `intensity` (has numeric literal in source) | `<input type="text">` | Last numeric literal from `sources[field]` | Accept numeric value, POST on Enter |
| `alpha` (has numeric literal in source) | `<input type="text">` | Last numeric literal from `sources[field]` | Accept numeric value, POST on Enter |
| `tone`/`intensity` (bare variable ref, no literal) | read-only text | Computed value from `formulas[field]` | No edit control (source is e.g. `primaryTextTone` or `spec.role.tone`) |
| Any field with `sources[field]` undefined (shorthand) | read-only text | Computed value from `formulas[field]` | No edit control (shorthand like `cardBodyTone,` has no colon, no source expression) |
| `hueSlot` | `<select>` | Current value from `formulas[field]` | Options from exported `RESOLVED_HUE_SLOT_KEYS`, POST on change |
| `hueExpression` (string) | read-only text | N/A | No edit control (expression like `spec.role.hue`) |
| boolean | read-only text | N/A | No edit control |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| (none) | All changes go into existing files |

#### Symbols to add / modify {#symbols}

**Table T04: New and modified symbols** {#t04-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `scanAllTugProperties` | fn | `style-inspector-overlay.ts` | Scan stylesheets for all `--tug-*` on `:root`/`body`/`html` |
| `SemanticCategory` | type | `style-inspector-overlay.ts` | `"BACKGROUND" \| "TEXT" \| "BORDER" \| "OTHER"` |
| `InteractionState` | type | `style-inspector-overlay.ts` | `"rest" \| "hover" \| "active" \| "disabled"` |
| `PropertyEntry` | interface | `style-inspector-overlay.ts` | Property name + chain + formula rows |
| `GroupedProperties` | type | `style-inspector-overlay.ts` | `Map<SemanticCategory, Map<InteractionState, PropertyEntry[]>>` |
| `categorizeProperty` | fn | `style-inspector-overlay.ts` | Name heuristic -> category + state |
| `groupProperties` | fn | `style-inspector-overlay.ts` | Group resolved properties by category and state |
| `RESOLVED_HUE_SLOT_KEYS` | const (export) | `formula-reverse-map.ts` | Change from `const` to `export const` for client hue slot dropdown |
| `FormulasCache.sources` | field | `vite.config.ts` | `Record<string, string>` mapping field names to source expression text |
| `FormulasData.sources` | field | `style-inspector-overlay.ts` | Client-side mirror of `FormulasCache.sources` |
| `AllPropertiesSection` | component | `style-inspector-card.tsx` | React component rendering grouped property table |
| `EditableFormulaValue` | component | `style-inspector-card.tsx` | Inline editing for formula values (imperative DOM) |
| `HueSlotSelect` | component | `style-inspector-card.tsx` | `<select>` dropdown for hue slot fields |
| `handleFormulaEdit` | fn (exported) | `vite.config.ts` | POST handler for `/__themes/formula` |
| `findAndEditNumericLiteral` | fn (exported) | `vite.config.ts` | Clamp-aware regex-based numeric literal editor for recipe files |
| `StyleInspectorBusEvent` | type (modified) | `style-inspector-overlay.ts` | Extend from `'toggle-scan'` to `'toggle-scan' \| 'formulas-updated'` |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `scanAllTugProperties`, `categorizeProperty`, `groupProperties`, `findAndEditNumericLiteral` | Core logic, edge cases |
| **Unit** | Test `handleFormulaEdit` with mocked fs | POST handler validation, error paths |
| **Integration** | Test the full edit flow: POST -> file write -> HMR -> re-fetch | End-to-end verification |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Scan all tug properties from stylesheets {#step-1}

**Commit:** `feat(inspector): scan all --tug-* properties from stylesheets`

**References:** [D01] Scan all stylesheets for global --tug-* definitions, [D07] Extend GET formulas endpoint with source expressions, [D08] Export RESOLVED_HUE_SLOT_KEYS, Spec S01, Spec S06, (#property-discovery, #context, #strategy)

**Artifacts:**
- New function `scanAllTugProperties()` in `style-inspector-overlay.ts`
- New types `SemanticCategory`, `InteractionState`, `PropertyEntry` in `style-inspector-overlay.ts`
- New function `categorizeProperty()` in `style-inspector-overlay.ts`
- Module-level cache for scan results
- `RESOLVED_HUE_SLOT_KEYS` exported from `formula-reverse-map.ts`
- `FormulasCache` extended with `sources` field in `vite.config.ts`
- `FormulasData` extended with `sources` field in `style-inspector-overlay.ts`
- `generate-theme-override.ts` extended to extract source expressions from recipe file

**Tasks:**
- [ ] Add `SemanticCategory`, `InteractionState`, and `PropertyEntry` types to `style-inspector-overlay.ts`
- [ ] Implement `scanAllTugProperties()`: walk all `document.styleSheets`, recurse into grouping rules, check for `:root`/`body`/`html` selectors, collect `--tug-*` property names
- [ ] Implement `categorizeProperty(name: string): { category: SemanticCategory; state: InteractionState }` using the name heuristic from Table T01 and Table T02
- [ ] Add module-level `Set<string>` cache for discovered properties with invalidation flag
- [ ] For each discovered property, run `resolveTokenChain()` and look up formula fields via `getReverseMap()`
- [ ] Export `RESOLVED_HUE_SLOT_KEYS` from `formula-reverse-map.ts`: change `const RESOLVED_HUE_SLOT_KEYS` to `export const RESOLVED_HUE_SLOT_KEYS`
- [ ] Extend `FormulasCache` in `vite.config.ts` with `sources: Record<string, string>` field
- [ ] Extend `FormulasData` in `style-inspector-overlay.ts` with `sources: Record<string, string>` field
- [ ] Extend `generate-theme-override.ts` to read the recipe file source, extract expression text for each formula field (regex: find line matching `/^\s*<field>\s*[:=]\s*(.+?),?\s*$/m` and capture the RHS), and include a `sources` object in the sidecar JSON
- [ ] Update `handleFormulasGet` in `vite.config.ts` to include `sources` in the serialized response: change the `JSON.stringify` call (line 74) from `{ formulas: cache.formulas, mode: cache.mode, themeName: cache.themeName }` to also include `sources: cache.sources`
- [ ] Update existing tests that construct `FormulasCache` without `sources` to include `sources: {}`: `formulas-cache.test.ts` (lines 20 and 47) and any other test files constructing `FormulasCache` literals
- [ ] Update existing tests that construct `FormulasData` without `sources` to include `sources: {}`: `style-inspector-overlay.test.ts` (lines 447, 461, 492) and any other test files constructing `FormulasData` literals

**Tests:**
- [ ] Unit test `categorizeProperty` with representative token names: `--tug-tab-bg-rest` -> BACKGROUND/rest, `--tug-tab-fg-hover` -> TEXT/hover, `--tug-card-border` -> BORDER/rest, `--tug-dropdown-shadow` -> OTHER/rest
- [ ] Unit test `scanAllTugProperties` with mock stylesheets containing `:root` and `body` rules
- [ ] Unit test: verify `handleFormulasGet` response includes `sources` field when cache has sources (the `JSON.stringify` in the response body must serialize `sources` alongside `formulas`, `mode`, and `themeName`)

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes
- [ ] `cd tugdeck && bun run test` passes (existing tests still green)

---

#### Step 2: Group and display all properties in the inspector {#step-2}

**Depends on:** #step-1

**Commit:** `feat(inspector): display all tug properties grouped by category and state`

**References:** [D01] Scan all stylesheets, [D03] Group by name heuristic, Spec S02, Tables T01-T02, (#strategy, #scope)

**Artifacts:**
- New function `groupProperties()` in `style-inspector-overlay.ts`
- New React component `AllPropertiesSection` in `style-inspector-card.tsx`
- New CSS styles for the grouped property table in `style-inspector-card.css`
- Extended `InspectionData` to include grouped properties

**Tasks:**
- [ ] Implement `groupProperties()` that takes the scanned properties, chains, and formula data, returns `GroupedProperties`
- [ ] Add `AllPropertiesSection` component that renders categories as section headers, states as sub-rows, and formula fields for each property
- [ ] Add CSS styles for the grouped table: category headers (`.si-all-props-category`), state labels (`.si-all-props-state`), formula value cells
- [ ] Extend `handleElementSelected` in `StyleInspectorContent` to call `scanAllTugProperties()`, resolve chains, group properties, and pass to the new section
- [ ] Render `AllPropertiesSection` below the existing `FormulaSection` in the card body
- [ ] Update `@tug-pairings` block in `style-inspector-card.css` to include new element/surface pairings
- [ ] Run `bun run audit:tokens` to verify all pairings pass

**Tests:**
- [ ] Unit test `groupProperties` with mock chain results and formula data
- [ ] Visual test: inspect a TugButton and verify BACKGROUND rest/hover/active rows, TEXT rows, BORDER rows are all visible

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes
- [ ] `cd tugdeck && bun run test` passes
- [ ] `cd tugdeck && bun run audit:tokens` passes

---

#### Step 3: POST /__themes/formula endpoint {#step-3}

**Depends on:** #step-1

**Commit:** `feat(inspector): add POST /__themes/formula endpoint for inline editing`

**References:** [D02] Edit numeric literal within expression, [D05] Testable handler pattern, [D07] Source expressions, Spec S03, Spec S06, Risk R01, Risk R03, (#inline-editing, #constraints)

**Artifacts:**
- New exported function `handleFormulaEdit` in `vite.config.ts`
- New exported function `findAndEditNumericLiteral` in `vite.config.ts`
- New route `POST /__themes/formula` registered in `themeSaveLoadPlugin`
- Unit tests for `handleFormulaEdit` and `findAndEditNumericLiteral`

**Tasks:**
- [ ] Implement `findAndEditNumericLiteral(fileContent: string, field: string, newValue: number | string): string | null` -- find the line with the field assignment and apply a clamp-aware replace-last-literal strategy. Specifically: (1) if the line contains a `Math.max(N, Math.min(N, innerExpr))` clamp wrapper, extract `innerExpr`; (2) if `innerExpr` contains an arithmetic operator (`+` or `-`) followed by a numeric literal, replace that literal; (3) if `innerExpr` is a bare variable with no arithmetic operator, return null (the `0` and `100` are clamp bounds, not user-authored offsets); (4) for non-clamped lines, replace the LAST numeric literal on the line; (5) return null if field not found or if no numeric literal exists to target. Add a code comment documenting the clamp-detection and replace-last-literal assumptions per Risk R03.
- [ ] Handle all expression forms from the recipe files: bare literal (`surfaceAppIntensity: 2`), variable + offset (`primaryTextTone - 28`), variable reference (`spec.role.tone`), shorthand property (`cardBodyTone,`), Math.max/Math.min clamped expressions (`Math.max(0, Math.min(100, spec.role.tone - 5))`), Math.round with expression (`Math.round(primaryTextTone - 57)`), and Math.round of bare variable (`Math.round(roleIntensity)` -- non-editable, no numeric literal to target)
- [ ] Implement `handleFormulaEdit(body: unknown, fsImpl: FsWriteImpl, formulasCacheRef: FormulasCache | null): { status: number; body: string }` -- validate body, read recipe file, call `findAndEditNumericLiteral`, write file. `FsWriteImpl` (exported from `vite.config.ts`) already includes both `readFileSync` and `writeFileSync`
- [ ] Determine recipe file path from `formulasCache.mode` using `path.resolve(__dirname, 'src/components/tugways/recipes', mode + '.ts')`, consistent with the existing `recipesDir` resolution in `handleHotUpdate`. Pass `__dirname` as a parameter to the handler (or close over it at registration time) to keep the handler unit-testable
- [ ] Register `POST /__themes/formula` in `themeSaveLoadPlugin.configureServer` middleware, following the same JSON body parsing pattern as `POST /__themes/activate`
- [ ] Return 400 for invalid body, 404 for field not found, 200 with `{ ok: true }` on success

**Tests:**
- [ ] Unit test `findAndEditNumericLiteral` with:
  - Bare literal: `surfaceAppIntensity: 2,` -> `surfaceAppIntensity: 5,`
  - Variable + offset: `mutedTextTone: primaryTextTone - 28,` -> `mutedTextTone: primaryTextTone - 30,`
  - Variable - offset: `surfaceSunkenTone: canvasTone + 6,` -> `surfaceSunkenTone: canvasTone + 8,`
  - Shorthand property reference: `cardBodyTone,` -> (should return null or handle appropriately as non-editable)
  - Math.max/Math.min clamped: `filledSurfaceHoverTone: Math.max(0, Math.min(100, spec.role.tone - 5)),` -> edit `5` to `8` -> `Math.max(0, Math.min(100, spec.role.tone - 8)),`
  - Math.round with expression: `borderStrongToneComputed: Math.round(primaryTextTone - 57),` -> edit `57` to `60` -> `Math.round(primaryTextTone - 60),`
  - Math.round of bare variable: `roleIntensity: Math.round(roleIntensity),` -> should return null (non-editable, no numeric literal)
  - Bare variable reference: `contentTextTone: primaryTextTone,` -> should return null (no numeric literal to edit)
  - Spec path reference: `filledSurfaceRestTone: spec.role.tone,` -> should return null (no numeric literal to edit)
  - Math.max/Math.min clamped with bare variable (no offset): `clampedTone: Math.max(0, Math.min(100, someVariable)),` -> should return null (the `0` and `100` are clamp bounds, not the editable literal; there is no user-authored offset to target)
  - Field not found: returns null
- [ ] Unit test `handleFormulaEdit` with mocked fs: valid edit returns 200, missing field returns 404, invalid body returns 400

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes
- [ ] `cd tugdeck && bun run test` passes (new + existing tests)

---

#### Step 4: Inline editing UI {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat(inspector): inline editing for formula values`

**References:** [D02] Edit numeric literal within expression, [D04] HMR listener for re-fetch, [D06] Imperative editing, [D07] Source expressions, [D08] Export RESOLVED_HUE_SLOT_KEYS, Spec S04, Spec S05, Spec S06, Tables T03, (#inline-editing, #constraints)

**Artifacts:**
- Inline editing logic in `AllPropertiesSection` or a child component in `style-inspector-card.tsx`
- `<select>` dropdown for hue slot fields
- HMR listener for `vite:afterUpdate` in `StyleInspectorContent`
- CSS styles for editable values and inputs in `style-inspector-card.css`

**Tasks:**
- [ ] Make numeric formula values clickable in the all-properties table (only when `sources[field]` is defined AND contains a numeric literal). On click: extract the last numeric literal from `sources[field]` via regex, create an `<input type="text">` imperatively (L06), pre-fill with the extracted literal, position over the value span, focus it, select all text. Fields whose `sources[field]` is `undefined` (shorthand properties) or whose source expression has no numeric literal (bare variable refs like `primaryTextTone` or `spec.role.tone`) are rendered read-only
- [ ] On Enter: read input value, validate it is numeric, POST to `/__themes/formula` with `{ field, value }`, remove the input, restore the value span
- [ ] On Escape: cancel edit, remove the input, restore the original value span
- [ ] On blur: same as Enter (commit the edit)
- [ ] For hue slot fields: create a `<select>` element imperatively. Derive option values from the exported `RESOLVED_HUE_SLOT_KEYS` set in `formula-reverse-map.ts`. POST on change
- [ ] For boolean fields: render as read-only text with no click handler
- [ ] Extend the `StyleInspectorBusEvent` type from `'toggle-scan'` to `'toggle-scan' | 'formulas-updated'` to support the new HMR signal
- [ ] In `controlTokenHotReload` plugin's `handleHotUpdate`, after `reactivateActiveTheme()` completes, add `server.hot.send({ type: 'custom', event: 'tug:formulas-updated' })` to notify the client
- [ ] Register `import.meta.hot.on('tug:formulas-updated')` HMR listener at module level (guarded by `if (import.meta.hot)`), following the pattern in `css-imports.ts`. Also register `import.meta.hot.on('vite:afterUpdate')` as fallback. Both listeners dispatch a `formulas-updated` event on `styleInspectorBus`. The React component subscribes to this bus event via `useLayoutEffect` (L03) and calls `fetchFormulasData()` + re-resolve all properties + update display via `setRenderKey`
- [ ] Clean up the `useLayoutEffect` subscription on component unmount. The module-level `import.meta.hot.on()` listeners persist for the module lifetime (no cleanup needed since they are dev-only)
- [ ] Add CSS for editable value hover state (cursor: pointer, subtle highlight), active input styling
- [ ] Update `@tug-pairings` if new foreground/background combos are introduced
- [ ] Run `bun run audit:tokens` to verify pairings

**Tests:**
- [ ] Unit test: clicking a numeric value creates an input element
- [ ] Unit test: Enter key on input calls POST with correct field and value
- [ ] Unit test: Escape key cancels edit without POSTing
- [ ] Unit test: `tug:formulas-updated` HMR event dispatches `formulas-updated` on bus and triggers re-fetch

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes
- [ ] `cd tugdeck && bun run test` passes
- [ ] `cd tugdeck && bun run audit:tokens` passes

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Scan all stylesheets, [D02] Edit numeric literal within expression, [D04] HMR listener, [D07] Source expressions, Spec S04, Spec S06, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify end-to-end flow: open inspector -> scan element -> see all-properties table with grouped categories -> click a numeric value -> edit it -> Enter -> recipe file on disk changes -> HMR delivers update -> inspector shows new value
- [ ] Verify source literal pre-fill: click to edit `mutedTextTone` -> input pre-fills with `28` (the source literal from `sources.mutedTextTone = "primaryTextTone - 28"`), NOT with `66` (the computed value)
- [ ] Verify expression preservation: edit `mutedTextTone` from 28 to 30 -> recipe file shows `primaryTextTone - 30`, not `30`
- [ ] Verify bare variable refs are read-only: `contentTextTone` (source: `primaryTextTone`) has no edit control
- [ ] Verify hue slot dropdown works: select a different hue -> POST fires -> HMR updates; options come from exported `RESOLVED_HUE_SLOT_KEYS`
- [ ] Verify boolean fields are read-only
- [ ] Verify existing three-chain display still works correctly alongside the new all-properties table
- [ ] Verify no regressions in scan mode, three-state button, persistent highlight

**Tests:**
- [ ] Run full test suite (`bun run test`) to confirm all unit tests from Steps 1-4 pass together
- [ ] Manual end-to-end test: inspect TugButton, edit a tone value, confirm recipe file changes and HMR delivers update within 2 seconds

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes
- [ ] `cd tugdeck && bun run test` passes
- [ ] `cd tugdeck && bun run audit:tokens` passes
- [ ] Manual: inspect a TugButton, edit a tone value, observe live update in < 2 seconds

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Complete formula display showing all `--tug-*` properties grouped by semantic category and state, with inline editing that modifies recipe file expressions in place and delivers updates via HMR.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All `--tug-*` properties on `:root`/`body`/`html` are discovered, resolved, and displayed in the inspector grouped by BACKGROUND/TEXT/BORDER/OTHER and by rest/hover/active/disabled state
- [ ] Numeric formula values are editable inline via click -> input -> Enter -> POST
- [ ] POST handler edits the specific numeric literal within the expression, preserving expression structure
- [ ] HMR delivers updates after edit; inspector re-fetches and displays new values
- [ ] Hue slot fields use `<select>` dropdown; boolean fields are read-only
- [ ] All existing inspector functionality (three-chain display, scan mode, three-state button, persistent highlight) continues to work

**Acceptance tests:**
- [ ] Inspect a TugButton: see BACKGROUND rest/hover/active rows with formula fields
- [ ] Edit `filledSurfaceRestTone` value: recipe file changes, HMR delivers update, inspector refreshes
- [ ] Verify `mutedTextTone: primaryTextTone - 28` becomes `primaryTextTone - 30` after editing (not bare `30`)
- [ ] `cd tugdeck && bun run check && bun run test && bun run audit:tokens` all pass

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] TugAccordion for collapsible category groups
- [ ] Expression visualization (show `primaryTextTone - 28` with inline variable resolution)
- [ ] Undo/redo for inline edits
- [ ] Batch editing (edit multiple values before committing)
- [ ] Non-numeric expression editing (e.g., change `spec.role.tone` to a different spec path)

| Checkpoint | Verification |
|------------|--------------|
| Property scan | Inspect any element; all-properties section shows grouped --tug-* properties |
| Inline editing | Edit a numeric value; recipe file changes on disk |
| HMR round-trip | Edit triggers HMR; inspector re-fetches and shows new value |
| Expression preservation | Recipe file shows edited literal within expression, not bare replacement |
