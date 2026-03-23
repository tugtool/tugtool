<!-- tugplan-skeleton v2 -->

## Formula Editor for Theme System {#formula-editor}

**Purpose:** Ship a dev-only formula editor that extends the style inspector overlay to show formula provenance for any inspected element, provide live slider/input controls for formula fields, and write changes back to recipe source files on disk with instant visual feedback.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | formula-editor |
| Last updated | 2026-03-23 (revised: overviewer OF1-OF3 + OQ1) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

When tuning theme recipes (`src/components/tugways/recipes/dark.ts`, `src/components/tugways/recipes/light.ts`), there is no way to connect what you see on screen to the formula that produced it. You see a color, but you don't know which `DerivationFormulas` field controls it, what its current value is, or how changing it would affect other tokens. Editing requires round-tripping between the browser, source code, and mental models of the rules table.

The formula editor closes this loop: hover any element, see exactly which formula fields produce its colors, drag sliders to change those values, and have the changes write through to the recipe source files on disk — live, with instant visual feedback.

#### Strategy {#strategy}

- Build a Proxy-based reverse map (formula field <-> CSS tokens) as the data foundation before any UI work.
- Extend the existing style inspector overlay with read-only formula provenance display, validating the reverse map end-to-end before adding editing.
- Add interactive slider/input controls with two-phase preview: delta approximation during drag (instant), file write on release (canonical).
- Implement write-back as a Vite plugin middleware endpoint that auto-detects the active recipe file from the theme's mode field.
- Extend `controlTokenHotReload` to watch recipe files so edits trigger the full token regeneration + HMR pipeline.
- Change the inspector's pin behavior to support click-to-re-inspect workflow (click re-inspects new element, Escape/close dismisses).
- All code is dev-only, gated by `process.env.NODE_ENV`, consistent with the existing inspector.

#### Success Criteria (Measurable) {#success-criteria}

- Shift+Alt hover on any element with `--tug-*` tokens shows the formula field names and current values that produced those tokens (verify: inspect 5 different elements across surface, text, and control tokens)
- Dragging a tone slider updates the screen color within one animation frame — no visible lag during drag (verify: drag `surfaceCanvasTone` slider and observe smooth color transition)
- On slider release, the recipe file on disk contains the new literal value (verify: `grep surfaceCanvasTone src/components/tugways/recipes/dark.ts` shows the new value)
- HMR delivers the canonical generated CSS within 500ms of slider release (verify: observe that the temporary preview override is replaced by HMR-delivered values)
- `bun run build` succeeds — formula editor code is excluded from production (verify: build completes, search production bundle for formula editor symbols)
- High-fan-out field (`roleIntensity`, 150+ tokens) drag preview runs at 60fps (verify: use Performance panel in DevTools during drag)

#### Scope {#scope}

1. Proxy-based reverse map from `DerivationFormulas` fields to CSS tokens (both directions)
2. Style inspector formula provenance display (read-only formula fields + current values)
3. Interactive slider/input/dropdown controls for formula fields with two-phase preview
4. Write-back middleware endpoint (`POST /__themes/formula`) with regex-based recipe file editing
5. Formulas cache endpoint (`GET /__themes/formulas`) serving current derivation state
6. Recipe file hot-reload via `controlTokenHotReload` extension
7. Pin behavior change: click re-inspects, Escape/close dismisses

#### Non-goals (Explicitly out of scope) {#non-goals}

- ThemeSpec editing — the theme generator card already handles spec-level editing
- Adding new formula fields — this editor changes values of existing fields only
- Rules table editing — changing which formula field a token reads is a structural change
- New recipe modes — creating a third recipe (e.g., "high-contrast") is a separate task
- Expression editing — sliders write literal values, not expressions; users restore expressions in source if needed
- Boolean field editing — boolean fields (e.g., `selectionInactiveSemanticMode`) are displayed read-only; there is only one such field and adding a dedicated control type is not justified (OF1, OQ1)
- Production inclusion — all formula editor code is dev-only

#### Dependencies / Prerequisites {#dependencies}

- `theme-engine.ts` exports `DerivationFormulas` type and `deriveTheme()` returns `ThemeOutput` with `formulas` field
- `theme-rules.ts` exports `RULES` table with multiple rule types: `ChromaticRule` (has `intensityExpr`, `toneExpr`, `alphaExpr`), `ShadowRule` and `HighlightRule` (have `alphaExpr`), `StructuralRule` (has `valueExpr` and optional `resolvedExpr`), `WhiteRule` and `InvariantRule` (no formula expressions)
- `style-inspector-overlay.ts` provides the singleton inspector with pin/unpin, `resolveTokenChain`, and panel rendering
- `vite.config.ts` has `controlTokenHotReload` plugin with `handleHotUpdate` hook and `activateThemeOverride` function
- Recipe files (`src/components/tugways/recipes/dark.ts`, `src/components/tugways/recipes/light.ts`) return an object literal from a recipe function — fields use `fieldName: expression,` format (not assignment statements), including shorthand properties (`fieldName,`) where field name equals variable name

#### Constraints {#constraints}

- Law L01: One `root.render()`, at mount, ever — formula editor uses pure DOM, no React
- Law L06: Appearance changes go through CSS and DOM, never React state — all preview applies via `document.body.style.setProperty()` (all `--tug-*` tokens are on `body {}` selectors)
- Dev-only gating via `process.env.NODE_ENV !== 'production'` — consistent with existing inspector
- The "no theme sliders" directive applies only to the user-facing theme generator card. Dev inspector sliders for formula editing are explicitly approved (CQ1).
- Two-phase preview: drag uses client-side delta approximation (no file round-trip), release writes to disk
- Write-back uses regex replacement, not AST manipulation — keeps the implementation simple and matches the consistent recipe object literal format

#### Assumptions {#assumptions}

- The Proxy-based reverse map runs once at inspector activation time in the browser, importing RULES from `theme-rules.ts` through the normal module graph
- The formula editor is entirely dev-only and excluded from production builds via `process.env.NODE_ENV` checks, consistent with existing inspector gating
- The regex replacement needs two patterns to match the object literal format used in recipe files:
  - Expression properties: `{fieldName}\s*:\s*.+,` matches `fieldName: expr,` form (e.g., `surfaceCanvasTone: canvasTone,` or `surfaceAppIntensity: 2,`)
  - Shorthand properties: `{fieldName}\s*,` matches bare `fieldName,` form (e.g., `cardBodyTone,` where the field name equals the variable name)
- The `mode` field on `ThemeSpec` (`dark` | `light`) maps 1:1 to recipe file paths: `dark` -> `src/components/tugways/recipes/dark.ts`, `light` -> `src/components/tugways/recipes/light.ts`
- `getComputedStyle()` on `document.body` at drag-start gives an accurate snapshot of current oklch values for affected tokens

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses the conventions defined in the tugplan skeleton v2: explicit `{#anchor}` on every referenced heading, `[DNN]` for design decisions, `[QNN]` for open questions, `Spec SNN` for specs, `Table TNN` for tables, `Risk RNN` for risks, and `**References:**` / `**Depends on:**` lines on every execution step.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| High-fan-out drag perf | med | med | Benchmark `roleIntensity` early in Step 5 | Frame drops below 30fps during drag |
| Proxy misses computed refs | low | low | Fallback to 0 for dummy values; test all rules | Reverse map is incomplete for any rule |
| Regex replacement breaks | med | low | Validate consistent recipe format before merge | Recipe file fails to parse after write |
| Intermediate variable coupling loss | med | med | Show UI warning when replacing shared variable | User decouples related fields unknowingly |

**Risk R01: High-fan-out field drag performance** {#r01-drag-perf}

- **Risk:** Fields like `roleIntensity` affect 150+ tokens. Updating all CSS custom properties per animation frame during drag may drop below 60fps.
- **Mitigation:** Benchmark early in Step 5 with `roleIntensity`. If performance is insufficient, batch property updates using `requestAnimationFrame` and consider throttling delta computation. Setting CSS custom properties is typically fast (sub-millisecond per property), so 150 updates should be well within budget.
- **Residual risk:** Extremely complex pages with many matching elements could still have layout thrash from property changes.

**Risk R02: Proxy-based introspection misses edge cases** {#r02-proxy-edge-cases}

- **Risk:** Some rule expressions may use conditional logic that accesses different formula fields depending on the input value. The Proxy with dummy return value 0 may not exercise all branches.
- **Mitigation:** Validate the reverse map against the full RULES table in the integration checkpoint. Compare the set of unique formula fields in the map against all fields in `DerivationFormulas`. Any field present in the type but absent from the map is either unused or missed by the Proxy.
- **Residual risk:** If a field is only accessed in a rarely-taken branch, the reverse map may be incomplete for that field. This is acceptable — the user sees "no formula fields" for those tokens, which is a minor inaccuracy.

**Risk R03: Intermediate variable coupling loss** {#r03-coupling-loss}

- **Risk:** Recipe files use intermediate variables (e.g., `const canvasTone = spec.surface.canvas.tone;`) and multiple formula fields reference the same variable (e.g., `surfaceAppTone: canvasTone`, `surfaceCanvasTone: canvasTone`). When the write-back replaces one field's RHS with a literal, it breaks the coupling — sibling fields that shared the same intermediate variable are no longer updated together.
- **Mitigation:** When writing a literal to a field, detect whether the old RHS is an intermediate variable name (not a literal or expression). If so, show a warning in the inspector UI: "This field shared variable `canvasTone` with N other fields. Only this field was changed." This informs the user without blocking the edit.
- **Residual risk:** Users may not notice the warning and accidentally decouple related fields. This is acceptable for a dev-only tool — `git diff` makes the change visible and reversible.

---

### Design Decisions {#design-decisions}

#### [D01] Proxy-based reverse map, not source parsing (DECIDED) {#d01-proxy-reverse-map}

**Decision:** Use JavaScript Proxy to intercept property accesses on a dummy `DerivationFormulas` object when calling each rule's expression functions, rather than parsing TypeScript source with regex or AST tools.

**Rationale:**
- Runtime introspection is simpler and more accurate than static analysis
- Catches computed references (`formulas[dynamicKey]`) that regex would miss
- No TypeScript parser dependency needed
- The RULES table expressions are pure functions with no side effects — safe to call with dummy values

**Implications:**
- The reverse map is computed at runtime, not at build time
- Expressions that throw with dummy values are caught and skipped — those tokens show no formula fields
- The map must be recomputed if the rules table changes (but this only happens during development)

#### [D02] Two-phase slider preview with delta approximation (DECIDED) {#d02-two-phase-preview}

**Decision:** During slider drag, apply tone/intensity deltas directly to the computed oklch values of affected CSS custom properties on `document.body` (all `--tug-*` tokens are defined on `body {}` selectors). On drag release, write the final literal value to the recipe file and let the full pipeline (file write -> watcher -> token generation -> HMR) deliver canonical values.

**Rationale:**
- The full derivation pipeline takes ~300ms, too slow for continuous drag feedback
- Delta approximation (e.g., +3 to L channel for tone delta) gives visually accurate feedback for most fields
- The canonical pipeline on release corrects any approximation error (clamping, nonlinear transforms)
- Snapshot current oklch values via `getComputedStyle()` on `document.body` at drag-start for the delta base

**Implications:**
- Brief visual "snap" may occur on release when canonical values replace the approximation
- Alpha and hue slot fields need different delta strategies (alpha: direct replacement; hue slots: no drag preview, apply on release)
- Must clean up temporary style overrides after HMR delivers the canonical update

#### [D03] Literal replacement, not expression editing (DECIDED) {#d03-literal-replacement}

**Decision:** When the user changes a formula field value via slider, the write-back replaces the entire right-hand side of the assignment with a literal number, discarding any expression (e.g., `spec.surface.canvas.tone + 3` becomes `8`).

**Rationale:**
- Live tuning is about finding the right value, not writing the right expression
- Keeps write-back logic trivial (regex replace) instead of requiring AST manipulation
- Users can restore expressions later by editing source directly
- The response includes the old expression for visibility

**Implications:**
- Recipe files will have literal values after tuning — expressions are lost
- `git diff` clearly shows what changed (old expression -> new literal)
- No undo within the editor — use git to revert

#### [D04] Dev-only, pure DOM controls (DECIDED) {#d04-dev-only-dom}

**Decision:** The formula editor uses direct DOM manipulation consistent with the existing style inspector. No React components, no React state. All code is gated by `process.env.NODE_ENV !== 'production'`.

**Rationale:**
- Follows Law L01 (one root.render, ever) and Law L06 (appearance via CSS/DOM, not React state)
- Consistent with the existing style inspector architecture
- Vite tree-shakes dev-only code in production builds

**Implications:**
- Controls are created and updated via `document.createElement` and direct property manipulation
- Event listeners are managed manually (added on activation, removed on cleanup)
- No component lifecycle — state is managed by the `StyleInspectorOverlay` singleton

#### [D05] Formulas endpoint caches derivation output (DECIDED) {#d05-formulas-endpoint}

**Decision:** Add an in-memory cache variable in the Vite plugin that stores the latest `DerivationFormulas` and `ThemeSpec` whenever `activateThemeOverride` is called. Serve this cache from a new `GET /__themes/formulas` endpoint.

**Rationale:**
- The dev server already runs `deriveTheme()` for the active theme via `activateThemeOverride`
- Caching the formulas object avoids redundant derivation
- The inspector fetches once on activation and refreshes after each edit

**Implications:**
- `activateThemeOverride` returns `formulas` and `mode` in its `ActivateResult` — callers update the cache from the return value, keeping `activateThemeOverride` free of cache side effects
- All call sites (theme switch, theme save, recipe hot-reload) must update `formulasCache` from the returned result
- Cache is null until the first theme activation — the endpoint returns 404 if no theme is active
- Response includes `mode` field so the client never needs to know recipe file paths

#### [D06] Pin behavior change: click re-inspects, Escape dismisses (DECIDED) {#d06-pin-behavior}

**Decision:** Change the inspector's pin behavior unconditionally (not gated by formula editor mode). When pinned, clicking a different element re-inspects it (updates the panel). Escape and the close button dismiss the panel. Clean break from the old toggle behavior.

**Rationale:**
- The tuning workflow requires clicking around the UI while keeping the inspector open
- The old "click to unpin" behavior forces re-activation for each new element
- A clean break (no mode gating) avoids complexity and is a better UX for the cascade inspector too

**Implications:**
- Existing inspector users must use Escape or the close button to dismiss — clicking no longer dismisses
- The `onClick` handler changes from toggle to re-inspect
- The hint text updates from "Click to unpin" to "Escape to close"

#### [D07] Recipe hot-reload via controlTokenHotReload extension (DECIDED) {#d07-recipe-hot-reload}

**Decision:** Extend the existing `controlTokenHotReload` plugin's `handleHotUpdate` hook to also watch `src/components/tugways/recipes/*.ts` files, triggering `regenerate()` and `reactivateActiveTheme()` when a recipe file changes.

**Rationale:**
- `controlTokenHotReload` already handles theme-engine.ts and theme JSON changes with the same regenerate + reactivate pattern
- Adding recipe files to the same hook is a one-line check, consistent with the existing architecture
- No new file watcher needed — uses Vite's built-in watcher

**Implications:**
- Recipe file edits (both manual and via the write-back endpoint) trigger the full token regeneration pipeline
- The formulas cache is updated from the `ActivateResult` returned by `reactivateActiveTheme` / `activateThemeOverride` (after [D05] is implemented)

---

### Specification {#specification}

#### Reverse Map Data Structures {#reverse-map-structures}

**Spec S01: Reverse Map Types** {#s01-reverse-map-types}

```typescript
interface FormulaTokenMapping {
  token: string;      // e.g., "surface-app-bg"
  property: string;   // "intensity" | "tone" | "alpha" | "hueSlot"
}

interface TokenFormulaMapping {
  field: string;      // e.g., "surfaceAppTone"
  property: string;   // "intensity" | "tone" | "alpha" | "hueSlot"
}

interface ReverseMap {
  fieldToTokens: Map<string, FormulaTokenMapping[]>;
  tokenToFields: Map<string, TokenFormulaMapping[]>;
}
```

**Spec S02: buildReverseMap function** {#s02-build-reverse-map}

```typescript
function buildReverseMap(rules: Record<string, DerivationRule>): ReverseMap
```

- Iterates all entries in RULES
- Dispatches on rule `type` to determine which expression functions to probe:
  - `ChromaticRule`: probe `intensityExpr`, `toneExpr`, `alphaExpr` (if present), plus `hueSlot` mediation
  - `ShadowRule`: probe `alphaExpr` only (base color is fixed black)
  - `HighlightRule`: probe `alphaExpr` only (base color is fixed white)
  - `StructuralRule`: probe `valueExpr(formulas, {} as ResolvedHueSlots)` and `resolvedExpr` (if present) — these can reference arbitrary formula fields. Pass an empty object cast to `ResolvedHueSlots` as the second parameter since no current rules use it, but the function signature requires it (OF3).
  - `WhiteRule`, `InvariantRule`: skip (no formula expressions)
- For each probed expression, wraps a Proxy around a dummy `DerivationFormulas` object
- Records which fields were accessed via the Proxy `get` trap
- Also handles `hueSlot` string fields that reference formulas-mediated slots (pattern: if `hueSlot` is not a direct `ResolvedHueSlots` key, check `formulas[hueSlot + "HueSlot"]`)
- Returns both forward (`fieldToTokens`) and inverse (`tokenToFields`) maps

#### Formulas Endpoint {#formulas-endpoint}

**Spec S03: GET /__themes/formulas response** {#s03-formulas-response}

```typescript
interface FormulasResponse {
  formulas: Record<string, number | string>;  // All DerivationFormulas fields
  mode: "dark" | "light";                     // Active theme mode
  themeName: string;                          // Active theme display name
}
```

Returns 404 if no theme has been activated yet.

**Spec S04: POST /__themes/formula request/response** {#s04-formula-write}

Request:
```typescript
interface FormulaWriteRequest {
  field: string;    // DerivationFormulas field name
  value: number | string;  // New value (number for tone/intensity/alpha, string for hue slots/expressions)
}
// Note: Boolean fields (e.g., selectionInactiveSemanticMode) are excluded from write-back.
// The POST endpoint returns 400 if the field is boolean. (OF1, OQ1)
```

Response (success):
```typescript
interface FormulaWriteResponse {
  ok: true;
  file: string;           // e.g., "src/components/tugways/recipes/dark.ts"
  field: string;
  oldValue: string;       // Previous RHS expression text
  newValue: string;       // New literal value as written
}
```

Response (error, 400):
```typescript
interface FormulaWriteError {
  error: string;          // Human-readable error message
}
```

#### Control Types {#control-types}

**Table T01: Formula field control mapping** {#t01-control-mapping}

| Field property | Control | Range | Step | Example fields |
|---------------|---------|-------|------|---------------|
| Tone | slider + number input | 0-100 | 1 | `surfaceCanvasTone`, `contentTextTone` |
| Intensity | slider + number input | 0-100 | 1 | `roleIntensity`, `surfaceAppIntensity` |
| Alpha | slider + number input | 0-100 | 1 | `shadowMdAlpha`, `overlayDimAlpha` |
| HueSlot | dropdown | enum values | N/A | `surfaceAppHueSlot`, `mutedTextHueSlot` |
| HueExpression | text input | free-form string | N/A | HueExpression string fields that are not HueSlot enums |
| Boolean | read-only display | N/A | N/A | `selectionInactiveSemanticMode` |

Field property is inferred from the `property` field in `TokenFormulaMapping`. Hue slot fields are identified by the `"hueSlot"` property value. HueExpression fields are string fields that do not match the HueSlot enum and use a text input fallback. Boolean fields are excluded from interactive editing and rendered as read-only display (OF1, OQ1) — there is only one boolean field (`selectionInactiveSemanticMode`) and adding a dedicated control type is not worth the complexity.

#### Delta Approximation During Drag {#delta-approximation}

**Spec S05: Drag preview algorithm** {#s05-drag-preview}

1. On drag-start: call `getComputedStyle(document.body)` to snapshot current oklch values of all CSS custom properties affected by the formula field being dragged (looked up via `fieldToTokens` from the reverse map).
2. Parse each snapshot value to extract oklch components. `getComputedStyle` returns oklch values in the form `oklch(L C h)` or `oklch(L C h / alpha)` where L is 0-1 (fraction), C is 0-0.4 (chroma), h is 0-360 (degrees), and alpha is 0-1. Use a regex like `oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)` to parse. If the computed value is not in oklch form (e.g., `StructuralRule` tokens producing non-color values), skip delta preview for that token.
3. On each drag-move frame:
   - Compute delta = currentSliderValue - dragStartValue
   - For **tone** fields: apply `delta / 100` to the L channel (oklch L is 0-1, tone is 0-100, so L ~ tone/100)
   - For **intensity** fields: apply `delta * 0.004` to the C channel (oklch C is 0-0.4, intensity is 0-100, so C ~ intensity*0.004)
   - For **alpha** fields: apply `delta / 100` to the alpha component (oklch alpha is 0-1, alpha field is 0-100)
   - Set each affected CSS custom property via `document.body.style.setProperty()`
4. On drag-end: remove all temporary style overrides; POST the final value to `/__themes/formula`; HMR will deliver canonical values.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/formula-reverse-map.ts` | Proxy-based reverse map builder (`buildReverseMap`, types) |
| `tugdeck/src/components/tugways/formula-editor-controls.ts` | DOM-based slider/input/dropdown controls for formula fields |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `buildReverseMap` | fn | `formula-reverse-map.ts` | Builds forward and inverse maps from RULES |
| `ReverseMap` | interface | `formula-reverse-map.ts` | Type for the two-direction map |
| `FormulaTokenMapping` | interface | `formula-reverse-map.ts` | Entry in fieldToTokens |
| `TokenFormulaMapping` | interface | `formula-reverse-map.ts` | Entry in tokenToFields |
| `createFormulaSection` | fn | `style-inspector-overlay.ts` | Renders formula provenance rows in panel |
| `createFormulaControls` | fn | `formula-editor-controls.ts` | Creates slider/input/dropdown/text controls (boolean fields rendered read-only) |
| `handleFormulaDrag` | fn | `formula-editor-controls.ts` | Drag preview with delta approximation |
| `handleFormulaCommit` | fn | `formula-editor-controls.ts` | POST to write-back endpoint on release |
| `formulasCache` | var | `vite.config.ts` | In-memory cache of latest DerivationFormulas + ThemeSpec |
| `handleFormulasGet` | fn | `vite.config.ts` | Handler for GET /__themes/formulas |
| `handleFormulaPost` | fn | `vite.config.ts` | Handler for POST /__themes/formula (write-back) |
| `onClick` | method (modify) | `style-inspector-overlay.ts` | Change from toggle to re-inspect behavior |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test reverse map builder with mock rules, test regex replacement logic | Core data structures, edge cases |
| **Integration** | Test inspector shows formula fields for real elements, test write-back round-trip | End-to-end formula editing flow |
| **Manual verification** | Drag slider, observe preview, check file on disk | Visual feedback quality, performance |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Reverse map module {#step-1}

<!-- Step 1 has no dependencies (root step) -->

**Commit:** `feat(theme): add Proxy-based formula reverse map`

**References:** [D01] Proxy-based reverse map, Spec S01, Spec S02, (#reverse-map-structures, #strategy)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/formula-reverse-map.ts`

**Tasks:**
- [ ] Create `formula-reverse-map.ts` with `ReverseMap`, `FormulaTokenMapping`, `TokenFormulaMapping` types per Spec S01
- [ ] Implement `buildReverseMap(rules)` per Spec S02: iterate RULES, dispatch on rule type (`ChromaticRule`, `ShadowRule`, `HighlightRule`, `StructuralRule`), use Proxy to intercept formula field accesses for each rule type's expression functions. For `StructuralRule.valueExpr`, pass `{} as ResolvedHueSlots` as the second parameter (OF3).
- [ ] Handle hue slot resolution: for formulas-mediated hue slots, the Proxy catches access to `formulas[slotName + "HueSlot"]` and records it with property `"hueSlot"`
- [ ] Handle constant expressions (`lit()` helpers): Proxy correctly records no fields — these tokens get empty formula field lists
- [ ] Wrap expression calls in try/catch to handle expressions that throw with dummy values (return 0 from Proxy get trap)
- [ ] Export `buildReverseMap` and all types

**Tests:**
- [ ] Unit test with a small mock RULES table: verify `fieldToTokens` contains expected entries for a surface rule with `intensityExpr` and `toneExpr`
- [ ] Unit test with a `lit()` constant rule: verify `tokenToFields` for that token is empty
- [ ] Unit test with a mock `ShadowRule`: verify only the `alphaExpr` formula field is captured with property `"alpha"`
- [ ] Unit test with a mock `StructuralRule` that has `valueExpr` referencing formula fields: verify those fields appear in the map
- [ ] Unit test with a formulas-mediated hue slot rule: verify the hue slot field appears in the map
- [ ] Integration test: call `buildReverseMap(RULES)` with the real RULES table and verify the map is non-empty, all field names are valid `keyof DerivationFormulas`

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "reverse-map"` passes
- [ ] `cd tugdeck && bun run build` succeeds (tree-shaken in prod since nothing imports it yet)

---

#### Step 2: Formulas cache and GET endpoint {#step-2}

**Depends on:** #step-1

**Commit:** `feat(theme): add formulas cache and GET /__themes/formulas endpoint`

**References:** [D05] Formulas endpoint caches derivation output, [D07] Recipe hot-reload, Spec S03, (#formulas-endpoint, #strategy)

**Artifacts:**
- Modified: `tugdeck/vite.config.ts` — add `formulasCache` variable, `handleFormulasGet` function, GET endpoint in middleware, recipe file watching in `controlTokenHotReload`

**Tasks:**
- [ ] Add `formulasCache` module-level variable in `vite.config.ts` to store `{ formulas, mode, themeName }` (null initially)
- [ ] Extend `ActivateResult` (the return type of `activateThemeOverride`) to include `formulas` and `mode` fields so callers can read derivation output without side effects inside the activation function
- [ ] Update all call sites of `activateThemeOverride` to populate `formulasCache` from the returned `ActivateResult` — extract `formulas` from the result, `mode` and `name` from the parsed `ThemeSpec`. This keeps `activateThemeOverride` free of cache side effects while ensuring the cache is always in sync regardless of which code path triggers activation (theme switch, theme save, recipe hot-reload, etc.)
- [ ] Implement `handleFormulasGet()` that returns the cached formulas as JSON per Spec S03, or 404 if cache is null
- [ ] Register `GET /__themes/formulas` in the `themeSaveLoadPlugin` middleware
- [ ] Extend `controlTokenHotReload`'s `handleHotUpdate` to trigger `regenerate()` + `reactivateActiveTheme()` when file path matches `src/components/tugways/recipes/*.ts` (same pattern as the existing `theme-engine.ts` and `themes/*.json` checks)

**Tests:**
- [ ] Manual: start dev server, activate a non-base theme, `curl http://localhost:5173/__themes/formulas` returns JSON with `formulas`, `mode`, `themeName` fields
- [ ] Manual: edit a recipe file by hand, verify the formulas endpoint returns updated values after HMR cycle
- [ ] Unit test for `handleFormulasGet`: mock the cache, verify JSON response shape matches Spec S03

**Checkpoint:**
- [ ] `curl http://localhost:5173/__themes/formulas | jq .mode` returns `"dark"` or `"light"` when a theme is active
- [ ] `cd tugdeck && bun run build` succeeds

---

#### Step 3: Inspector formula provenance display {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat(inspector): show formula field provenance in style inspector`

**References:** [D01] Proxy-based reverse map, [D04] Dev-only DOM, [D06] Pin behavior change, Spec S01, (#context, #control-types)

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/style-inspector-overlay.ts` — add formula section rendering, change pin behavior
- Modified: `tugdeck/src/components/tugways/style-inspector-overlay.css` — styles for formula section

**Tasks:**
- [ ] On inspector activation, fetch `GET /__themes/formulas` to get current formula values and mode
- [ ] On inspector activation, call `buildReverseMap(RULES)` to get the `tokenToFields` map (cache result for session)
- [ ] In the panel rendering code, after the existing token chain display, add a "Formula" section: for each formula field referenced by the terminal token (via `tokenToFields`), show `fieldName = currentValue` with the property type label (tone, intensity, alpha, hueSlot)
- [ ] For constant expressions (tokens with empty formula field list), display "constant" indicator
- [ ] For `StructuralRule` tokens that produce non-color values (cannot do drag preview), display an "(applies on release)" indicator next to the control — these fields skip delta approximation and only take effect after the write-back + HMR cycle
- [ ] Change pin behavior per [D06]: modify `onClick` so that when pinned, clicking a different element calls `inspectElement` on the new target instead of toggling pin state. Escape and close button dismiss the panel.
- [ ] Update hint text: when pinned, show "Escape to close" instead of "Click or Escape to unpin"

**Tests:**
- [ ] Unit test: mock a token chain result and formula data, verify `createFormulaSection` produces DOM nodes with expected field names and values
- [ ] Manual: Shift+Alt hover on a surface element (e.g., the app background) — verify formula section shows `surfaceAppTone`, `surfaceAppIntensity`, `surfaceAppHueSlot` with current values
- [ ] Manual: pin the inspector, click a different element — verify the panel updates to show the new element's formulas (not dismissed)
- [ ] Manual: press Escape while pinned — verify the panel dismisses

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "inspector"` passes
- [ ] `cd tugdeck && bun run build` succeeds (formula section code is dev-only gated)

---

#### Step 4: Write-back middleware endpoint {#step-4}

**Depends on:** #step-2

**Commit:** `feat(theme): add POST /__themes/formula write-back endpoint`

**References:** [D03] Literal replacement, [D05] Formulas endpoint, Spec S04, (#formulas-endpoint, #assumptions)

**Artifacts:**
- Modified: `tugdeck/vite.config.ts` — add `handleFormulaPost` function, POST endpoint in middleware

**Tasks:**
- [ ] Implement `handleFormulaPost(body, formulasCache)` per Spec S04:
  - Read `mode` from the formulas cache to determine recipe file path (`"dark"` -> `src/components/tugways/recipes/dark.ts`, `"light"` -> `src/components/tugways/recipes/light.ts`)
  - Read the recipe file from disk
  - Find the object literal property using regex: `{fieldName}\s*[:,]\s*.+,` — recipe files use object literal format (`fieldName: expression,`), not assignment statements
  - Also handle shorthand properties (e.g., `cardBodyTone,` where the field name equals the variable name) — the regex must match both `fieldName: expr,` and `fieldName,` forms
  - Extract the old RHS expression text (everything after the colon, or the bare field name for shorthand)
  - Replace the RHS with the new raw literal value (number or quoted string for hue slots) — no clamping on write-back; the value is written exactly as provided by the client (OQ1)
  - Write the file back to disk
  - Return success response with `file`, `field`, `oldValue`, `newValue`
- [ ] When the old RHS is a bare identifier (intermediate variable), include a `couplingWarning` field in the success response listing other fields in the same file that reference the same variable (Risk R03)
- [ ] Return 400 with clear error if: cache is null (no active theme), field not found in recipe file, field name is not a valid formula field
- [ ] Register `POST /__themes/formula` in the `themeSaveLoadPlugin` middleware
- [ ] After successful write, the file watcher triggers `activateThemeOverride` via the recipe hot-reload path — the caller updates `formulasCache` from the returned `ActivateResult` (per [D05]) — no manual cache update needed in the POST handler

**Tests:**
- [ ] Unit test: given a mock recipe file content string, verify regex finds and replaces `surfaceCanvasTone: canvasTone,` with `surfaceCanvasTone: 8,`
- [ ] Unit test: verify shorthand property replacement — `cardBodyTone,` becomes `cardBodyTone: 8,`
- [ ] Unit test: verify 400 response when field name is not found in the file
- [ ] Unit test: verify hue slot fields write as quoted strings: `surfaceAppHueSlot: "frame",`
- [ ] Manual: `curl -X POST http://localhost:5173/__themes/formula -H 'Content-Type: application/json' -d '{"field":"surfaceCanvasTone","value":8}'` returns success response and recipe file on disk is updated

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "formula-write"` passes
- [ ] `cd tugdeck && bun run build` succeeds

---

#### Step 5: Interactive slider controls with drag preview {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `feat(inspector): add formula field slider/input controls with live preview`

**References:** [D02] Two-phase slider preview, [D04] Dev-only DOM, Spec S05, Table T01, Risk R01, (#delta-approximation, #control-types, #success-criteria)

**Artifacts:**
- New file: `tugdeck/src/components/tugways/formula-editor-controls.ts`
- Modified: `tugdeck/src/components/tugways/style-inspector-overlay.ts` — replace static formula display with interactive controls
- Modified: `tugdeck/src/components/tugways/style-inspector-overlay.css` — styles for slider/input/dropdown controls

**Tasks:**
- [ ] Create `formula-editor-controls.ts` with `createFormulaControls` function that builds DOM controls per Table T01:
  - Tone fields: `<input type="range" min="0" max="100" step="1">` + `<input type="number">`
  - Intensity fields: same as tone
  - Alpha fields: `<input type="range" min="0" max="100" step="1">` + `<input type="number">`
  - HueSlot fields: `<select>` dropdown with available hue slot names
  - HueExpression fields: `<input type="text">` for free-form string values (OF2 — these are string fields that don't match the HueSlot enum)
  - Boolean fields: read-only `<span>` displaying `true`/`false` with no interactive control (OF1, OQ1)
- [ ] Implement `handleFormulaDrag` per Spec S05:
  - On pointerdown on a slider: snapshot current oklch values of all affected tokens via `getComputedStyle(document.body)` and the `fieldToTokens` map. Skip delta preview for `StructuralRule` tokens that produce non-color values (these show "(applies on release)" indicator).
  - On pointermove: compute delta, apply to oklch L/C/alpha channels, set via `document.body.style.setProperty()`
  - On pointerup: remove temporary overrides, call `handleFormulaCommit`
- [ ] Implement `handleFormulaCommit`: POST to `/__themes/formula` with field name and final value
- [ ] After successful POST, fetch updated formulas from `GET /__themes/formulas` and refresh all visible controls with new values (handles cascading changes)
- [ ] Benchmark `roleIntensity` drag performance (Risk R01): verify 60fps by checking frame timing during drag of a high-fan-out field
- [ ] In `style-inspector-overlay.ts`, replace the static formula rows from Step 3 with calls to `createFormulaControls` when in dev mode

**Tests:**
- [ ] Unit test: `createFormulaControls` with mock data produces expected DOM structure (slider + input for tone field, dropdown for hue slot field, text input for hue expression field, read-only span for boolean field)
- [ ] Manual: hover a surface element, pin, drag the tone slider — verify smooth color transition during drag
- [ ] Manual: release the slider — verify recipe file on disk has new literal value, HMR delivers canonical CSS within 500ms
- [ ] Manual: drag `roleIntensity` slider — verify smooth performance (no visible frame drops) despite 150+ token updates
- [ ] Manual: change a hue slot dropdown — verify recipe file is updated with quoted string value

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "formula"` passes
- [ ] `cd tugdeck && bun run build` succeeds (formula editor controls are dev-only gated)
- [ ] Manual: full round-trip works — drag slider, see preview, release, see HMR update, recipe file has new value

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Proxy-based reverse map, [D02] Two-phase slider preview, [D03] Literal replacement, [D06] Pin behavior change, (#success-criteria, #scope)

**Tasks:**
- [ ] Verify all success criteria from #success-criteria end-to-end
- [ ] Verify reverse map completeness: compare formula fields in the map against all fields in `DerivationFormulas` type (Risk R02)
- [ ] Verify dev-only gating: `bun run build` succeeds, search production JS bundle for `buildReverseMap` and `formulaEditor` — neither should appear
- [ ] Verify recipe file integrity after multiple edits: edit 3-4 different fields, then run `bun test` to confirm the recipe still produces valid `DerivationFormulas`

**Tests:**
- [ ] End-to-end: hover element -> see formula fields -> drag slider -> see preview -> release -> check file -> verify HMR update
- [ ] Pin workflow: pin inspector -> click 3 different elements -> verify panel updates each time -> Escape to close
- [ ] Git diff: after a tuning session, `git diff` shows clean, readable changes to the recipe file (one line per changed field)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes (all tests, not just formula-related)
- [ ] `cd tugdeck && bun run build` succeeds
- [ ] `bun run audit:tokens` passes (if applicable to this codebase)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A dev-only formula editor integrated into the style inspector that shows formula provenance for any inspected element and provides live slider/input editing with instant visual feedback and automatic recipe file write-back.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Shift+Alt hover on any `--tug-*` token element shows formula field names and current values (verify: inspect surface, text, and control elements)
- [ ] Slider drag produces smooth, instant visual feedback with no visible frame drops (verify: drag `surfaceCanvasTone` and `roleIntensity` sliders)
- [ ] Slider release writes literal value to the correct recipe file on disk (verify: `git diff src/components/tugways/recipes/dark.ts` shows the change)
- [ ] HMR delivers canonical CSS within 500ms of release (verify: observe temporary override replaced by HMR values)
- [ ] Pin-and-click workflow works: pin inspector, click different elements, panel updates each time (verify: click 3 elements in sequence)
- [ ] `bun run build` succeeds — formula editor excluded from production (verify: search bundle for formula editor symbols)
- [ ] `bun test` passes — no regressions (verify: full test suite)

**Acceptance tests:**
- [ ] Full round-trip: hover -> pin -> drag slider -> release -> verify file change -> verify HMR update -> click new element -> drag another slider -> Escape to close
- [ ] High-fan-out: drag `roleIntensity` slider at 60fps with no dropped frames
- [ ] Production exclusion: `bun run build` produces no formula editor code in output

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Session summary endpoint: return all formula fields changed in current session, grouped by recipe file
- [ ] "Changes" badge in inspector showing count of modified fields
- [ ] Undo/redo within the editor (currently relies on git)
- [ ] Expression-aware editing: preserve `spec.x.y + offset` patterns instead of replacing with literals
- [ ] Multi-field editing: adjust related fields together (e.g., all surface tones as a group)

| Checkpoint | Verification |
|------------|--------------|
| Reverse map complete | All `DerivationFormulas` fields that appear in RULES are present in the map |
| Formulas endpoint live | `curl /__themes/formulas` returns valid JSON with all formula fields |
| Inspector shows formulas | Shift+Alt hover shows formula section for any `--tug-*` token |
| Write-back works | POST to `/__themes/formula` updates recipe file on disk |
| Live preview smooth | Drag any slider with no visible frame drops |
| HMR cycle fast | Canonical CSS delivered within 500ms of slider release |
| Production clean | `bun run build` succeeds, no formula editor symbols in bundle |
