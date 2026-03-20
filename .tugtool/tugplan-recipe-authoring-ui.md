<!-- tugplan-skeleton v2 -->

## Recipe Authoring UI — Phase 4, Plan 2 {#recipe-authoring-ui}

**Purpose:** Deliver the React UI components that expose the 7-parameter recipe system (from Plan 1) in the Theme Generator, enabling authors to create, compare, and export recipes using design parameters instead of raw formula fields.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | recipe-authoring-ui |
| Last updated | 2026-03-20 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Plan 1 (tugplan-recipe-parameter-engine, PR #146, merged) delivered the compilation pipeline: `RecipeParameters` interface, `compileRecipe()`, endpoint bundles, and the `deriveTheme()` integration. The Theme Generator currently passes `moodSliders={null}` to ThemePreviewCard and uses `defaultParameters()` (all-50) when no explicit formulas are provided. There is no UI to manipulate the 7 design parameters.

This plan adds the authoring surface: 7 parameter sliders replacing the removed mood sliders, a formula expansion panel for inspecting computed field values, a recipe diff view for comparing parameter states, and endpoint calibration using the new tools. The result is a Theme Generator that functions as a recipe authoring tool.

#### Strategy {#strategy}

- Build the ParameterSlider component first as a self-contained, Laws-of-Tug-compliant control (L06: appearance through CSS/DOM, not React state).
- Wire sliders using the L06-compliant direct-call pattern (matching `loadPreset`/`handleRecipeImported`): the debounce callback calls `setThemeOutput(deriveTheme(recipe))` directly, assembling the recipe from refs. Parameters do NOT flow through the `useEffect` → `runDerive()` path. Debounce at 150ms matches the existing codebase comment.
- Add formula expansion panel as a read-only collapsible section (per-field override deferred to a future plan per user answer).
- Add recipe diff view as an inline collapsible section below sliders, always comparing against `defaultParameters()` (all-50 baseline).
- Use the new UI to visually evaluate parameter extremes and refine endpoint bundles from Plan 1.
- Verify contrast compliance at parameter=0 and parameter=100 for each slider in both dark and light modes.
- Maintain all existing verification gates throughout: `bun run audit:tokens lint`, `bun test`.

#### Success Criteria (Measurable) {#success-criteria}

- Seven ParameterSlider components render in the Theme Generator and produce live preview updates via `compileRecipe()` -> `deriveTheme()` (verified by rendering and slider interaction tests).
- Formula expansion panel shows current interpolated field values for each parameter (verified by test rendering with known parameter values).
- Recipe diff view compares current parameters against defaultParameters() and shows correct delta bars (verified by test with non-default parameter values).
- Contrast engine passes at parameter=0 and parameter=100 for each of the 7 sliders in both dark and light modes (verified by parameterized test).
- `bun run audit:tokens lint` exits 0, `bun test` passes, `bun run audit:tokens verify` exits 0.

#### Scope {#scope}

1. Build 7 ParameterSlider components replacing the 3 mood sliders (which were already removed; the `moodSliders={null}` slot is the mount point).
2. Wire sliders through `compileRecipe()` -> `deriveTheme()` -> live preview with 150ms debounce.
3. Build formula expansion panel -- collapsible per-parameter field list showing current interpolated values (read-only).
4. Build recipe diff view -- parameter-level bars + expandable field-level detail comparing current state against `defaultParameters()`.
5. Refine endpoint bundles using the new UI to visually evaluate parameter extremes and tune the initial placeholder endpoints from Plan 1.
6. Verify contrast compliance across the full 0-100 range for each parameter in both dark and light modes.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Per-field override UI in the formula expansion panel (deferred to a future plan).
- Dark/stark and light/stark recipe variants (dark and light modes only).
- Recipe persistence/save-as-recipe workflow (the existing Export Recipe JSON covers this).
- Recipe interpolation or recipe transitions.
- Changes to the recipe parameter engine itself (Plan 1 is complete and merged).

#### Dependencies / Prerequisites {#dependencies}

- Recipe parameter engine (tugplan-recipe-parameter-engine, PR #146, merged) -- provides `RecipeParameters`, `compileRecipe()`, `defaultParameters()`, endpoint bundles.
- Theme derivation engine (`theme-derivation-engine.ts`) -- `deriveTheme()` already supports `recipe.parameters` path.
- Laws of Tug (L06: appearance changes through CSS/DOM, not React state).
- Rules of Tugways D81: new CSS rules must include `@tug-renders-on` annotations and pass `bun run audit:tokens lint`.

#### Constraints {#constraints}

- All appearance changes must flow through CSS custom properties and direct DOM manipulation, never through React state or useEffect (L06). The slider derivation path calls `setThemeOutput(deriveTheme(recipe))` directly from the debounce callback, matching the existing L06-compliant pattern used by `loadPreset()` and `handleRecipeImported()`.
- `parameters` React state exists only for data panel rendering (FormulaExpansionPanel, RecipeDiffView). It is NOT in the useEffect dependency array. Appearance changes never flow through this state.
- Slider input debounced at 150ms to avoid excessive `deriveTheme()` calls during continuous drag.
- New CSS rules for slider components and panels must include `@tug-renders-on` annotations and pass `bun run audit:tokens lint` per D81.

#### Assumptions {#assumptions}

- The ThemePreviewCard `moodSliders` prop slot (currently passed `null`) is the intended mount point for the 7 ParameterSlider components. The sliders, formula expansion panel, and recipe diff view are all rendered as a single composed ReactNode within this slot -- keeping the authoring controls together in the right panel.
- The ParameterSlider component renders a native HTML range input (or styled equivalent) following Laws of Tug.
- Debouncing at 150ms (matching the existing comment in GalleryThemeGeneratorContent) is appropriate. The debounce controls how often `deriveTheme()` is called directly from the callback.
- `bun run audit:tokens lint` and `bun test` must pass before the plan is considered done.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Endpoint refinement methodology (DECIDED) {#q01-endpoint-methodology}

**Question:** How should endpoint bundles be refined -- by visual evaluation at extremes, by algorithmic search, or by contrast-engine-guided iteration?

**Why it matters:** Poor endpoints produce unusable extremes (visual discontinuities, contrast failures) or imperceptible differences.

**Options (if known):**
- Visual evaluation using the new slider UI at 0 and 100
- Automated sweep testing contrast at every 10-unit increment
- Hybrid: visual evaluation + automated contrast verification

**Plan to resolve:** Use the hybrid approach -- visually evaluate at extremes, then run automated contrast verification at 0 and 100 for both modes.

**Resolution:** DECIDED -- Engineering gate only (per user answer). Contrast engine must pass at parameter=0 and parameter=100 for each slider in both dark and light modes. Visual evaluation guides the tuning; contrast pass is the hard gate.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Endpoint extremes cause contrast failures | high | med | Automated test verifies contrast at 0 and 100 for all 7 params x 2 modes | Any contrast failure in endpoint test |
| Slider debounce causes laggy preview | med | low | 150ms matches existing debounce pattern; can be tuned lower if needed | User reports sluggish interaction |
| CSS for new panels triggers audit-tokens lint failures | med | low | Add `@tug-renders-on` annotations to all new color-setting rules | `bun run audit:tokens lint` fails |

**Risk R01: Endpoint contrast failures** {#r01-endpoint-contrast}

- **Risk:** Refined endpoint values at parameter=0 or parameter=100 may violate contrast thresholds in one or both modes.
- **Mitigation:** Automated parameterized test runs contrast engine at extremes for all 7 parameters in both modes. Pull endpoints back until contrast passes.
- **Residual risk:** Intermediate values (e.g., parameter=5 or parameter=95) could theoretically fail even if endpoints pass, but linear interpolation between valid endpoints makes this unlikely. The contrast engine's `enforceContrastFloor` provides a runtime safety net.

---

### Design Decisions {#design-decisions}

#### [D01] Direct-call derivation for parameters, React state only for data panels (DECIDED) {#d01-params-state}

**Decision:** Slider-driven appearance changes use the direct-call pattern: the debounce callback assembles a `ThemeRecipe` from refs, calls `setThemeOutput(deriveTheme(recipe))`, and applies CSS custom properties to the DOM. This matches the existing L06-compliant pattern used by `loadPreset()` and `handleRecipeImported()`. Parameters do NOT flow through the `useEffect` → `runDerive()` path.

A separate `parameters` React state (mirrored to `parametersRef`) exists solely to drive re-rendering of data panels (FormulaExpansionPanel, RecipeDiffView). This state is NOT in the useEffect dependency array.

**Rationale:**
- **L06 compliance:** Appearance changes go through CSS and DOM, never React state. The debounce callback calls `deriveTheme()` directly and sets the output — no useEffect intermediary. This is the same pattern `loadPreset()` and `handleRecipeImported()` already use.
- **L07 compliance:** The debounce callback reads `parametersRef.current` and `formulasRef.current` (refs, not stale closures). Hue values and mode are stable during a slider drag (they come from discrete pickers, not continuous input), so closure capture is safe for those values.
- Single `RecipeParameters` object avoids 7 separate `useState` calls.
- Clear separation: refs drive appearance (DOM), state drives data display (React).

**Implications:**
- `parameters` is NOT in the useEffect dependency array. The useEffect continues to handle mode/hue/formulas changes only (the pre-existing derivation triggers). Slider changes bypass it entirely.
- The debounce callback assembles a full `ThemeRecipe` inline: hue values from closure (stable during drag), `parameters` from `parametersRef.current`, `formulas` from `formulasRef.current`. When `formulasRef.current` is non-null, the escape hatch takes precedence (consistent with Plan 1).
- After calling `setThemeOutput(deriveTheme(recipe))`, the debounce callback also calls `setParameters(parametersRef.current)` to update React state for the data panels.
- `compiledFormulas` for the UI panels is computed via `useMemo(() => compileRecipe(mode, parameters), [mode, parameters])` — cheap (~130 field interpolations), and in sync with the `parameters` state used for panel rendering.
- `runDerive()` is also updated to read `parametersRef.current` instead of `defaultParameters()`, so that useEffect-triggered re-derives (from hue/mode changes) also use the current slider positions.

#### [D02] 150ms debounce with direct deriveTheme() call (DECIDED) {#d02-debounce}

**Decision:** On each slider `onInput` event: (1) update `parametersRef.current` immediately, (2) clear any pending debounce timeout, (3) set a 150ms timeout whose callback does two things: calls `setThemeOutput(deriveTheme(recipe))` directly for appearance (L06), and calls `setParameters(parametersRef.current)` for data panel re-rendering.

**Rationale:**
- `deriveTheme()` evaluates ~200 derivation rules. 150ms prevents excessive calls during continuous slider drag.
- Matches the existing debounce timing comment in the gallery-theme-generator-content source.
- The direct `deriveTheme()` call follows L06: appearance changes go through CSS/DOM (via `setThemeOutput` which applies `liveTokenStyle`), not through React state → useEffect.
- The separate `setParameters()` call updates React state for the data panels only — this state is not in the useEffect dep array and does not trigger re-derivation.

**Implications:**
- The ref is always up-to-date (updated synchronously on every input event). The debounce callback reads `parametersRef.current` (always current per L07).
- The debounce timeout ID is stored in a `useRef` and cleared on unmount via a cleanup `useEffect` to prevent callbacks firing on an unmounted component.
- The useEffect is NOT involved in slider-driven derivation. It continues to handle discrete changes (mode, hue picker, formulas) only.

#### [D03] Formula expansion panel is read-only (DECIDED) {#d03-expansion-readonly}

**Decision:** The formula expansion panel shows field names and current interpolated values in a read-only collapsible list. Per-field override UI is deferred to a future plan.

**Rationale:**
- Per user answer: "Read-only for now -- show field values read-only, defer override UI to a future plan."
- Keeps the initial implementation simple and focused on the authoring workflow.

**Implications:**
- No input elements in the expansion panel. Display only.
- The `formulas` escape hatch path remains the only way to override individual fields.

#### [D04] Recipe diff baseline is always defaultParameters() (DECIDED) {#d04-diff-baseline}

**Decision:** The recipe diff view always compares the current parameter state against `defaultParameters()` (all values at 50).

**Rationale:**
- Per user answer: "Inline collapsible section below sliders, baseline is always defaultParameters() (all-50)."
- All-50 is the reference point that reproduces current `DARK_FORMULAS`/`LIGHT_FORMULAS` values exactly. Comparing against it shows how far each parameter deviates from the default recipe.

**Implications:**
- No baseline selector UI needed. The diff component receives current parameters and computes delta from 50 for each.
- Diff bars show signed deviation: negative (toward 0) on the left, positive (toward 100) on the right.

#### [D05] ParameterSlider renders native range input with CSS styling (DECIDED) {#d05-slider-element}

**Decision:** Each ParameterSlider renders a native HTML `<input type="range">` element, styled via CSS custom properties.

**Rationale:**
- Native range input provides built-in keyboard accessibility (arrow keys, page up/down) without custom ARIA.
- Consistent with Laws of Tug: styling through CSS, behavior through native HTML.

**Implications:**
- Cross-browser styling requires `-webkit-slider-thumb` and `-moz-range-thumb` pseudo-elements.
- The slider track and thumb colors can use `--tug-base-*` tokens for theme-awareness.

---

### Specification {#specification}

#### ParameterSlider Component {#parameter-slider-spec}

**Spec S01: ParameterSlider props** {#s01-slider-props}

```typescript
interface ParameterSliderProps {
  /** Parameter key (e.g., "surfaceDepth"). */
  paramKey: keyof RecipeParameters;
  /** Human-readable label (e.g., "Surface Depth"). */
  label: string;
  /** Description of the low extreme (parameter=0). */
  lowLabel: string;
  /** Description of the high extreme (parameter=100). */
  highLabel: string;
  /** Current value (0-100). */
  value: number;
  /** Callback when value changes. */
  onChange: (paramKey: keyof RecipeParameters, value: number) => void;
}
```

**Spec S02: Parameter metadata** {#s02-param-metadata}

| Parameter key | Label | Low (0) | High (100) |
|--------------|-------|---------|------------|
| `surfaceDepth` | Surface Depth | Flat | Deep |
| `textHierarchy` | Text Hierarchy | Democratic | Strong order |
| `controlWeight` | Control Weight | Light | Bold |
| `borderDefinition` | Border Definition | Minimal | Strong |
| `shadowDepth` | Shadow Depth | Flat | Deep |
| `signalStrength` | Signal Strength | Muted | Vivid |
| `atmosphere` | Atmosphere | Achromatic | Tinted |

#### FormulaExpansionPanel Component {#formula-expansion-spec}

**Spec S03: FormulaExpansionPanel props** {#s03-expansion-props}

```typescript
interface FormulaExpansionPanelProps {
  /** Current compiled formulas (from parent useMemo calling compileRecipe()). */
  compiledFormulas: DerivationFormulas;
  /** Current parameter values (to determine which fields belong to which parameter). */
  parameters: RecipeParameters;
  /** Current mode (to select the correct endpoint bundle for field grouping). */
  mode: "dark" | "light";
}
```

The panel renders one collapsible section per parameter. Each section lists the field names and their current interpolated numeric values. Fields are grouped using the endpoint bundle keys (e.g., P1 fields come from `DARK_ENDPOINTS.surfaceDepth` or `LIGHT_ENDPOINTS.surfaceDepth`).

#### RecipeDiffView Component {#recipe-diff-spec}

**Spec S04: RecipeDiffView props** {#s04-diff-props}

```typescript
interface RecipeDiffViewProps {
  /** Current parameter values. */
  parameters: RecipeParameters;
  /** Current compiled formulas (from parent useMemo calling compileRecipe()). */
  compiledFormulas: DerivationFormulas;
  /** Current mode (needed to compute defaultParameters() baseline for field-level detail). */
  mode: "dark" | "light";
}
```

Renders 7 horizontal bars, one per parameter. Each bar shows the current value relative to the baseline of 50. A center mark at 50 represents default. Values below 50 extend left; values above 50 extend right. Each bar is expandable to show field-level detail (field name + current value + default value + delta). The component receives `compiledFormulas` from the parent (computed via `useMemo` calling `compileRecipe(mode, parameters)`) and computes `compileRecipe(mode, defaultParameters())` internally for the baseline comparison. The baseline compilation is wrapped in `useMemo` keyed on `mode` (since `defaultParameters()` is constant). This avoids recomputing on every render -- the parent-provided `compiledFormulas` already reflects the current parameters without redundant recompilation.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/parameter-slider.tsx` | ParameterSlider component + parameter metadata constant |
| `tugdeck/src/components/tugways/parameter-slider.css` | Slider styling (track, thumb, labels) |
| `tugdeck/src/components/tugways/formula-expansion-panel.tsx` | Read-only formula field viewer, collapsible per parameter |
| `tugdeck/src/components/tugways/formula-expansion-panel.css` | Expansion panel styling (collapsible sections, field list layout) |
| `tugdeck/src/components/tugways/recipe-diff-view.tsx` | Parameter diff bars + expandable field-level detail |
| `tugdeck/src/components/tugways/recipe-diff-view.css` | Diff bar styling (horizontal bars, center mark, field detail) |
| `tugdeck/src/__tests__/parameter-slider.test.tsx` | ParameterSlider unit tests |
| `tugdeck/src/__tests__/formula-expansion-panel.test.tsx` | FormulaExpansionPanel unit tests |
| `tugdeck/src/__tests__/recipe-diff-view.test.tsx` | RecipeDiffView unit tests |
| `tugdeck/src/__tests__/endpoint-contrast.test.ts` | Parameterized contrast verification at parameter extremes |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ParameterSlider` | component | `parameter-slider.tsx` | 7-instance slider with label, low/high descriptions, numeric value |
| `PARAMETER_METADATA` | const | `parameter-slider.tsx` | Array of `{ paramKey, label, lowLabel, highLabel }` for all 7 parameters |
| `FormulaExpansionPanel` | component | `formula-expansion-panel.tsx` | Read-only collapsible field list per parameter |
| `getParameterFields` | fn | `recipe-parameters.ts` | Returns field names for a given parameter key + mode (reads endpoint keys) |
| `RecipeDiffView` | component | `recipe-diff-view.tsx` | Diff bars comparing current params against defaultParameters(); receives compiledFormulas from parent useMemo, memoizes baseline |
| `GalleryThemeGeneratorContent` | modified component | `gallery-theme-generator-content.tsx` | Add parametersRef + parameters state (data panels only), debounced direct-call handler (L06), compiledFormulas useMemo, expansion/diff panels |
| `runDerive` | modified fn | `gallery-theme-generator-content.tsx` | Read `parametersRef.current` instead of `defaultParameters()` so useEffect-triggered re-derives use current slider positions |
| `ThemePreviewCard` | modified component | `gallery-theme-generator-content.tsx` | `moodSliders` prop receives slider panel instead of null |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test ParameterSlider rendering, value change callbacks, debounce behavior | Slider component isolation |
| **Unit** | Test FormulaExpansionPanel field display for known parameter values | Expansion panel isolation |
| **Unit** | Test RecipeDiffView bar rendering and delta computation | Diff view isolation |
| **Integration** | Test full slider -> compileRecipe -> deriveTheme -> preview pipeline | End-to-end parameter flow |
| **Contract** | Verify contrast compliance at parameter=0 and parameter=100 for all 7 params x 2 modes | Endpoint calibration gate |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Create ParameterSlider component and metadata {#step-1}

**Commit:** `feat(tugdeck): add ParameterSlider component with parameter metadata`

**References:** [D05] ParameterSlider renders native range input, Spec S01, Spec S02, (#parameter-slider-spec, #new-files, #constraints)

**Artifacts:**
- `tugdeck/src/components/tugways/parameter-slider.tsx` -- ParameterSlider component + PARAMETER_METADATA constant
- `tugdeck/src/components/tugways/parameter-slider.css` -- Slider CSS styling
- `tugdeck/src/__tests__/parameter-slider.test.tsx` -- Unit tests

**Tasks:**
- [ ] Create `parameter-slider.tsx` with the `ParameterSlider` component per Spec S01: native `<input type="range">` with `min=0`, `max=100`, `step=1`.
- [ ] Define `PARAMETER_METADATA` constant array per Spec S02 with all 7 parameter entries.
- [ ] Render: label text, low-label (left), high-label (right), numeric value display, range input.
- [ ] The `onChange` callback fires on the `input` event (not `change`) for continuous updates during drag.
- [ ] Create `parameter-slider.css` with styling for the slider track, thumb, label row, and value display. If any color-setting rules reference `--tug-base-*` tokens, add `@tug-renders-on` annotations per D81.
- [ ] Write unit tests: renders all 7 parameters from PARAMETER_METADATA, fires onChange with correct paramKey and value, displays current numeric value.

**Tests:**
- [ ] T1.1: ParameterSlider renders label, low/high descriptions, and numeric value for each parameter.
- [ ] T1.2: Slider onChange callback fires with correct `(paramKey, value)` tuple.
- [ ] T1.3: Range input has correct min/max/step attributes.

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- parameter-slider`
- [ ] `cd tugdeck && bun run audit:tokens lint`

---

#### Step 2: Add getParameterFields helper to recipe-parameters.ts {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add getParameterFields helper for endpoint field introspection`

**References:** [D03] Formula expansion read-only, Spec S03, (#formula-expansion-spec, #symbols)

**Artifacts:**
- `tugdeck/src/components/tugways/recipe-parameters.ts` -- new exported `getParameterFields()` function

**Tasks:**
- [ ] Add `getParameterFields(paramKey: keyof RecipeParameters, mode: "dark" | "light"): string[]` function that returns the sorted list of field names from the corresponding endpoint bundle (e.g., `DARK_ENDPOINTS.surfaceDepth.low` keys for dark mode surfaceDepth).
- [ ] Export the function for use by FormulaExpansionPanel.
- [ ] Add unit test in `recipe-parameters.test.ts` verifying correct field lists for each parameter x mode combination.

**Tests:**
- [ ] T2.1: `getParameterFields("surfaceDepth", "dark")` returns field names matching `Object.keys(DARK_ENDPOINTS.surfaceDepth.low)` (assert against the actual endpoint keys, not a hardcoded count).
- [ ] T2.2: `getParameterFields("controlWeight", "light")` returns field names matching LIGHT_P3_ENDPOINTS keys.
- [ ] T2.3: All 7 parameters x 2 modes return non-empty field lists.

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- recipe-parameters`

---

#### Step 3: Build FormulaExpansionPanel component {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): add read-only FormulaExpansionPanel component`

**References:** [D03] Formula expansion read-only, Spec S03, (#formula-expansion-spec, #new-files)

**Artifacts:**
- `tugdeck/src/components/tugways/formula-expansion-panel.tsx` -- FormulaExpansionPanel component
- `tugdeck/src/components/tugways/formula-expansion-panel.css` -- Panel styling

**Tasks:**
- [ ] Create `formula-expansion-panel.tsx` with the `FormulaExpansionPanel` component per Spec S03.
- [ ] Render one collapsible `<details>` element per parameter. Summary shows parameter label and field count.
- [ ] Expanded content shows a list of field names with their current numeric values from `compiledFormulas`.
- [ ] Use `getParameterFields()` to determine which fields belong to each parameter section.
- [ ] All display is read-only -- no input elements. Per [D03].
- [ ] Create `formula-expansion-panel.css` with styling for collapsible sections and field list layout. If any color-setting rules reference `--tug-base-*` tokens, add `@tug-renders-on` annotations per D81.

**Tests:**
- [ ] T3.1: FormulaExpansionPanel renders 7 collapsible sections with correct parameter labels.
- [ ] T3.2: Expanding a section shows field names and numeric values from compiled formulas.
- [ ] T3.3: Field count in summary matches the number of fields for that parameter.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run audit:tokens lint`

---

#### Step 4: Build RecipeDiffView component {#step-4}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): add RecipeDiffView component with parameter delta bars`

**References:** [D04] Diff baseline is defaultParameters(), Spec S04, (#recipe-diff-spec, #new-files)

**Artifacts:**
- `tugdeck/src/components/tugways/recipe-diff-view.tsx` -- RecipeDiffView component
- `tugdeck/src/components/tugways/recipe-diff-view.css` -- Diff bar styling
- `tugdeck/src/__tests__/recipe-diff-view.test.tsx` -- Unit tests

**Tasks:**
- [ ] Create `recipe-diff-view.tsx` with the `RecipeDiffView` component per Spec S04. The component accepts `parameters`, `compiledFormulas`, and `mode` props. Import `compileRecipe` and `defaultParameters` from `recipe-parameters.ts` (needed for baseline field-level detail computation).
- [ ] Render 7 horizontal bars, one per parameter. Each bar has a center mark at 50 (baseline).
- [ ] Values below 50 extend left from center; values above 50 extend right. Bar width proportional to deviation.
- [ ] Display parameter label, current value, and delta from 50 as text.
- [ ] Each bar is expandable (collapsible `<details>`) to show field-level detail: field name, current interpolated value, default value (from all-50 compilation), and delta. Use the parent-provided `compiledFormulas` for current values (no redundant `compileRecipe()` call). Compute `compileRecipe(mode, defaultParameters())` for the baseline via `useMemo` keyed on `mode` (since `defaultParameters()` is constant, the baseline only recomputes on mode change). Defer the field-level computation until the collapsible section is open -- only run the field-by-field comparison when the `<details>` element is expanded.
- [ ] The entire diff view is wrapped in a collapsible section (inline below sliders, per user answer).
- [ ] Create `recipe-diff-view.css` for bar, center mark, and field detail styling. If any color-setting rules reference `--tug-base-*` tokens, add `@tug-renders-on` annotations per D81.
- [ ] Write unit tests: correct bar rendering for non-default parameters, correct delta computation, expandable field detail.

**Tests:**
- [ ] T4.1: RecipeDiffView with all parameters at 50 shows zero-width bars (no deviation).
- [ ] T4.2: RecipeDiffView with surfaceDepth=80 shows a rightward bar for Surface Depth with delta=+30.
- [ ] T4.3: Expanding a parameter bar shows field-level detail with correct values and deltas.

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- recipe-diff-view`

---

#### Step 5: Wire sliders into GalleryThemeGeneratorContent {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `feat(tugdeck): wire ParameterSliders into Theme Generator with debounced preview`

**References:** [D01] RecipeParameters state, [D02] 150ms debounce, [D05] ParameterSlider, (#context, #strategy, #symbols)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` -- modified

**Tasks:**
- [ ] Add `parameters` React state via `useState(defaultParameters())` — this state exists **only** for data panel rendering (FormulaExpansionPanel, RecipeDiffView). It is NOT added to the useEffect dependency array. Add a `parametersRef` mirroring the state (same pattern as existing `formulasRef`). Add a `setParametersAndRef()` helper matching the existing `setFormulasAndRef()` pattern.
- [ ] Import `compileRecipe`, `RecipeParameters`, and `defaultParameters` from `recipe-parameters.ts` (extending the existing `defaultParameters` import).
- [ ] Create a debounced slider change handler per [D02]. This is the L06-compliant direct-call pattern (matching `loadPreset`/`handleRecipeImported`):
  1. On each slider `onInput`: update `parametersRef.current` immediately (L07: refs, not stale closures).
  2. Clear any pending debounce timeout.
  3. Set a 150ms timeout whose callback does:
     - **Appearance (L06):** Assemble a `ThemeRecipe` inline from closure values (hue strings, mode, recipeName — stable during slider drag) plus `parametersRef.current` and `formulasRef.current` (refs — always current). Call `setThemeOutput(deriveTheme(recipe))`. This applies CSS custom properties to the DOM via `liveTokenStyle`, bypassing React state and useEffect entirely.
     - **Data panels:** Call `setParameters(parametersRef.current)` to update React state for FormulaExpansionPanel and RecipeDiffView re-rendering.
- [ ] Store the debounce timeout ID in a `useRef<ReturnType<typeof setTimeout>>()`. Add a cleanup `useEffect` that clears the pending timeout on unmount to prevent callbacks firing on an unmounted component.
- [ ] Do NOT add `parameters` to the existing useEffect dependency array. The useEffect continues to handle discrete changes (mode toggle, hue picker selection, formulas escape hatch) only. Slider-driven derivation bypasses it entirely per L06.
- [ ] Modify `runDerive()`: replace the current `{ parameters: defaultParameters() }` spread with `{ parameters: parametersRef.current }`. This ensures that useEffect-triggered re-derives (from hue/mode changes during or after slider interaction) also use the current slider positions. Do NOT call `compileRecipe()` inside `runDerive()` — let `deriveTheme()` handle compilation internally.
- [ ] Add a `compiledFormulas` memo via `useMemo(() => formulas ?? compileRecipe(mode, parameters), [mode, parameters, formulas])`. This provides compiled formula values for data panels. `compileRecipe()` is cheap (~130 field interpolations). When `formulas` is non-null (escape hatch), use `formulas` directly.
- [ ] Render 7 `ParameterSlider` instances using `PARAMETER_METADATA` in the `moodSliders` prop slot of `ThemePreviewCard`.
- [ ] Render the `FormulaExpansionPanel` below the sliders section, passing `compiledFormulas`, current `parameters`, and current `mode`. Since `compiledFormulas` is computed via `useMemo` (not async state), it is always available — no null guard needed.
- [ ] Add the `RecipeDiffView` as an inline collapsible section below the sliders, passing current `parameters` state, `compiledFormulas`, and current `mode` (per updated Spec S04). Same as FormulaExpansionPanel, no null guard needed.
- [ ] Update `loadPreset()` to set parameters from `recipe.parameters` (or `defaultParameters()` if absent) via `setParametersAndRef()`. `loadPreset` already calls `setThemeOutput(deriveTheme(r))` directly (L06-compliant) — no change needed for the appearance path.
- [ ] Update `handleRecipeImported()` with the same `setParametersAndRef()` call. `handleRecipeImported` also already calls `setThemeOutput(deriveTheme(r))` directly.
- [ ] In the `currentRecipe` memo, replace the hardcoded `defaultParameters()` call with the `parameters` state variable so the exported recipe reflects the actual slider positions.
- [ ] When mode toggles (Dark/Light buttons): reset `parametersRef.current` and `parameters` state to `defaultParameters()`. Rationale: endpoint bundles are mode-specific (DARK_ENDPOINTS vs LIGHT_ENDPOINTS), so parameter values tuned for one mode do not produce equivalent visual results in the other mode. Resetting avoids confusing visual jumps. The mode toggle already triggers the useEffect (mode is in the dep array), which calls `runDerive()`, which reads the just-reset `parametersRef.current`. The `setParameters()` call updates data panels. Both happen synchronously before the next render.

**Tests:**
- [ ] T5.1: Theme Generator renders 7 ParameterSlider components.
- [ ] T5.2: Moving a slider triggers `compileRecipe()` -> `deriveTheme()` and updates the preview.
- [ ] T5.3: FormulaExpansionPanel appears below sliders with correct field data.
- [ ] T5.4: RecipeDiffView appears as a collapsible section below sliders.
- [ ] T5.5: Loading a preset resets all sliders to the preset's parameter values (or defaults). Use a test fixture recipe with non-default parameters (e.g., `surfaceDepth: 80`) to exercise the `loadPreset` parameter restoration path.
- [ ] T5.6: Exporting recipe JSON includes the `parameters` field.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run audit:tokens lint`
- [ ] `cd tugdeck && bun run audit:tokens verify`

---

#### Step 6: Integration checkpoint -- slider pipeline end-to-end {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] RecipeParameters state, [D02] 150ms debounce, (#success-criteria, #scope)

**Tasks:**
- [ ] Verify all 7 sliders render correctly and update the preview on drag.
- [ ] Verify the FormulaExpansionPanel shows correct field values for the current parameter state.
- [ ] Verify the RecipeDiffView shows correct deltas when parameters deviate from 50.
- [ ] Verify Export Recipe JSON includes the `parameters` field with current slider values.
- [ ] Verify Import Recipe JSON with `parameters` restores slider positions.
- [ ] Verify mode toggle (Dark/Light) resets sliders to defaults and re-derives correctly.

**Tests:**
- [ ] T6.1: Full test suite passes, confirming no regressions from slider integration.
- [ ] T6.2: Audit tokens lint passes with all new CSS rules properly annotated.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run audit:tokens lint`
- [ ] `cd tugdeck && bun run audit:tokens verify`

---

#### Step 7: Refine endpoint bundles {#step-7}

**Depends on:** #step-6

**Commit:** `feat(tugdeck): refine recipe parameter endpoint bundles for visual quality`

**References:** [Q01] Endpoint refinement methodology, Risk R01, (#risks, #assumptions)

**Artifacts:**
- `tugdeck/src/components/tugways/recipe-parameters.ts` -- refined endpoint values in DARK_ENDPOINTS and LIGHT_ENDPOINTS

**Tasks:**
- [ ] For each of the 7 parameters, set the slider to 0 and visually evaluate the result in the Theme Generator preview. Adjust low endpoint values in the corresponding `DARK_P*_ENDPOINTS` and `LIGHT_P*_ENDPOINTS` IIFEs if the visual result is unusable or imperceptibly different from midpoint.
- [ ] Repeat at slider value 100 for each parameter.
- [ ] Verify that the midpoint constraint holds: `compileRecipe(mode, defaultParameters())` still produces field values matching the current `DARK_FORMULAS`/`LIGHT_FORMULAS` reference values. If endpoint adjustments break the midpoint, use the asymmetric clamping strategy already in `toneEndpoints()` to maintain `low + 0.5 * (high - low) = ref`.
- [ ] Focus on the parameters with the most visual impact: P1 (Surface Depth), P2 (Text Hierarchy), and P3 (Control Weight).
- [ ] Test intermediate values (25 and 75) for smooth interpolation -- no visual discontinuities.

**Tests:**
- [ ] T7.1: Existing `compileRecipe()` midpoint test still passes (all-50 reproduces reference formulas).
- [ ] T7.2: `compileRecipe()` at all-0 and all-100 produces valid DerivationFormulas (no NaN, no out-of-range values).

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- recipe-parameters`
- [ ] `cd tugdeck && bun test`

---

#### Step 8: Verify contrast compliance at parameter extremes {#step-8}

**Depends on:** #step-7

**Commit:** `test(tugdeck): add parameterized contrast verification at parameter extremes`

**References:** Risk R01, [Q01] Endpoint methodology, (#success-criteria, #non-goals)

**Artifacts:**
- `tugdeck/src/__tests__/endpoint-contrast.test.ts` -- new parameterized test file

**Tasks:**
- [ ] Create `endpoint-contrast.test.ts` with a parameterized test that iterates over all 7 parameters x 2 modes (dark, light) x 2 extremes (0, 100).
- [ ] For each combination: set the target parameter to the extreme value, all others to 50. Call `compileRecipe()`, then `deriveTheme()` with a reference recipe (brio for dark, harmony for light, substituting the compiled formulas). Run `validateThemeContrast()` on the result.
- [ ] Assert zero contrast failures (excluding decorative-role pairs).
- [ ] If any contrast failures are found, adjust the corresponding endpoint values in recipe-parameters.ts until the test passes. This may require iterating with Step 7.
- [ ] Document any endpoint values that were pulled back from their initial refined values to satisfy contrast.

**Tests:**
- [ ] T8.1: All 7 parameters at value=0 pass contrast validation in dark mode.
- [ ] T8.2: All 7 parameters at value=0 pass contrast validation in light mode.
- [ ] T8.3: All 7 parameters at value=100 pass contrast validation in dark mode.
- [ ] T8.4: All 7 parameters at value=100 pass contrast validation in light mode.

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- endpoint-contrast`
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run audit:tokens lint`

---

#### Step 9: Final verification {#step-9}

**Depends on:** #step-8

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria, #scope)

**Tasks:**
- [ ] Verify all 5 success criteria are met.
- [ ] Verify no regressions in existing Theme Generator functionality (hue pickers, mode toggle, export/import, preset loading, contrast dashboard, CVD preview).
- [ ] Run the full verification gate suite.

**Tests:**
- [ ] T9.1: Full test suite passes with zero failures (`bun test`).
- [ ] T9.2: All audit gates pass (`audit:tokens lint`, `audit:tokens pairings`, `audit:tokens verify`).

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run audit:tokens lint`
- [ ] `cd tugdeck && bun run audit:tokens pairings`
- [ ] `cd tugdeck && bun run audit:tokens verify`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The Theme Generator functions as a recipe authoring tool. Authors can manipulate 7 design parameter sliders to shape recipe strategy, inspect formula field values in the expansion panel, compare parameter states via the diff view, and export complete recipes -- all while maintaining contrast compliance across the full parameter range.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Seven ParameterSlider components render and produce live preview updates via `compileRecipe()` -> `deriveTheme()` (`bun test -- parameter-slider` passes).
- [ ] Formula expansion panel displays correct interpolated field values for each parameter (`bun test` covers this).
- [ ] Recipe diff view shows correct delta bars against defaultParameters() baseline (`bun test -- recipe-diff-view` passes).
- [ ] Contrast engine passes at parameter=0 and parameter=100 for all 7 sliders in both dark and light modes (`bun test -- endpoint-contrast` passes).
- [ ] All existing verification gates pass: `bun test`, `bun run audit:tokens lint`, `bun run audit:tokens verify`.

**Acceptance tests:**
- [ ] T-EXIT-1: Full test suite passes (`cd tugdeck && bun test`).
- [ ] T-EXIT-2: Audit tokens lint passes (`cd tugdeck && bun run audit:tokens lint`).
- [ ] T-EXIT-3: Endpoint contrast test passes (`cd tugdeck && bun test -- endpoint-contrast`).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Per-field override UI in the formula expansion panel (read-only deferred per [D03]).
- [ ] Dark/stark and light/stark recipe variants.
- [ ] Recipe save-as workflow (named recipe persistence beyond JSON export).
- [ ] Recipe interpolation / transition animations between parameter states.
- [ ] Automated endpoint optimization (algorithmic search for optimal extremes).

| Checkpoint | Verification |
|------------|--------------|
| Sliders render and update preview | `cd tugdeck && bun test -- parameter-slider` |
| Expansion panel shows correct fields | `cd tugdeck && bun test` |
| Diff view shows correct deltas | `cd tugdeck && bun test -- recipe-diff-view` |
| Contrast at extremes | `cd tugdeck && bun test -- endpoint-contrast` |
| All gates pass | `cd tugdeck && bun test && bun run audit:tokens lint && bun run audit:tokens verify` |
