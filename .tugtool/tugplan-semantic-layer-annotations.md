<!-- tugplan-skeleton v2 -->

## Semantic Layer: Annotation and Documentation Pass {#semantic-layer-annotations}

**Purpose:** Annotate every formula field in `DerivationFormulas` with `@semantic` JSDoc tags linking each to a semantic decision group, add a required `description` field to `ThemeRecipe`, write the Brio theme description, and document the full semantic decision table in module-level JSDoc — all without behavioral code changes.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | tugtool |
| Status | draft |
| Target branch | semantic-layer-annotations |
| Last updated | 2026-03-17 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Part 1 of the semantic formula architecture (named formula builders and recipe rename) is already merged. `DARK_FORMULAS` and `DARK_OVERRIDES` are the current names. The `DerivationFormulas` interface contains ~160+ fields spread across numeric tone/intensity parameters, string hue-slot dispatch fields, boolean mode selectors, and computed-tone override fields. These fields have no annotation linking them to the design decisions they represent. A recipe author — human or LLM — faces an opaque wall of parameters with no guidance about which ones control a given design intent.

This phase is Part 2 from `roadmap/semantic-formula-architecture.md`: a purely additive annotation and documentation pass. No token output changes. No runtime behavioral changes.

#### Strategy {#strategy}

- Define ~18-20 semantic decision groups covering both the ~13 numeric groups from the roadmap and ~5 new groups for non-numeric fields (hue-slot dispatch, sentinel alpha, computed-tone overrides, etc.).
- Annotate every field in `DerivationFormulas` with a `@semantic` custom JSDoc tag naming its group and providing a brief description.
- Add the module-level semantic decision table as a JSDoc block in `theme-derivation-engine.ts` alongside the existing `@module` doc.
- Add a required `description: string` field to `ThemeRecipe` and update all consumers.
- Write the Brio theme description in `EXAMPLE_RECIPES.brio`.
- Verify zero behavioral change: token output before and after must be identical.

#### Success Criteria (Measurable) {#success-criteria}

- Every field in `DerivationFormulas` has a `@semantic` JSDoc tag (grep count matches field count).
- `ThemeRecipe` interface has `description: string` as a required field.
- `EXAMPLE_RECIPES.brio` includes a `description` value.
- Module-level JSDoc contains a semantic decision table with all ~18-20 groups.
- `bun run generate:tokens` produces byte-identical output before and after.
- All existing tests pass: `cd tugdeck && bun test`.
- TypeScript compiles cleanly: `cd tugdeck && bunx tsc --noEmit`.

#### Scope {#scope}

1. `@semantic` JSDoc annotations on all `DerivationFormulas` fields.
2. Module-level semantic decision table in JSDoc.
3. `description: string` field on `ThemeRecipe`.
4. Brio theme description in `EXAMPLE_RECIPES.brio`.
5. Consumer updates: `validateRecipeJson`, `generateCssExport`, `generateResolvedCssExport`, `currentRecipe` memo, `runDerive` callback, test fixtures.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Reordering fields within `DerivationFormulas` (that is Part 3).
- Annotating `DARK_FORMULAS` values with design rationale comments (that is Part 4).
- Creating a light theme recipe (that is Part 5).
- Any changes to token output, derivation rules, or runtime behavior.

#### Dependencies / Prerequisites {#dependencies}

- Part 1 (named formula builders + recipe rename) must be merged. It is.
- Current names: `DARK_FORMULAS`, `DARK_OVERRIDES`, `BASE_FORMULAS`, `EXAMPLE_RECIPES.brio`.

#### Constraints {#constraints}

- Token output must be byte-identical before and after.
- No TSDoc tooling or doc generator is in use; `@semantic` is a documentation-only custom tag.
- There is exactly one theme recipe (`EXAMPLE_RECIPES.brio`) and one theme — backward compatibility for the `description` field is a non-issue.

#### Assumptions {#assumptions}

- The module-level JSDoc semantic decision table will be added to the existing `@module` block at the top of `theme-derivation-engine.ts`.
- `EXAMPLE_RECIPES.brio` gets the `description` field; no other recipe entries exist.
- The `validateRecipeJson` function in `gallery-theme-generator-content.tsx` needs updating to validate the required `description` field on import.
- Both `generateCssExport` (in `gallery-theme-generator-content.tsx`) and `generateResolvedCssExport` (in `theme-derivation-engine.ts`) can use `recipe.description` in the `@theme-description` header instead of the current computed string.

---

### Design Decisions {#design-decisions}

#### [D01] Use @semantic as a custom JSDoc tag (DECIDED) {#d01-semantic-tag-format}

**Decision:** Use `@semantic` as a plain custom JSDoc tag. No TSDoc compliance needed.

**Rationale:**
- No documentation generator is in use on this project.
- The tag serves as a structured, greppable annotation for humans and LLMs reading the source.
- User explicitly does not care about TSDoc standards.

**Implications:**
- Every `DerivationFormulas` field gets a `/** @semantic <group-name> — <brief description> */` comment.
- The tag is purely documentary; no tooling validates it.

#### [D02] ~18-20 semantic groups including non-numeric fields (DECIDED) {#d02-group-count}

**Decision:** Create ~5 new semantic groups for non-numeric fields (hue-slot dispatch, sentinel alpha, computed-tone overrides, etc.) in addition to the ~13 groups from the roadmap, totaling ~18-20 groups.

**Rationale:**
- The ~60 non-numeric fields (hue-slot strings, sentinel alphas, computed-tone overrides, boolean mode flags) have distinct semantic roles that deserve their own groups.
- Precision: a field tagged `@semantic hue-slot-dispatch` is more informative than lumping it into `surface-coloring`.
- Groups like `sentinel-alpha`, `computed-tone-override`, `hue-name-dispatch`, and `selection-mode` capture the actual semantic purpose.

**Implications:**
- The semantic decision table in the module JSDoc will have ~18-20 entries.
- The annotation pass must assign every field to exactly one group.

#### [D03] description is a required field on ThemeRecipe (DECIDED) {#d03-description-required}

**Decision:** Add `description: string` as a required (non-optional) field on `ThemeRecipe`.

**Rationale:**
- There is one theme recipe and one theme. No backward compatibility concern.
- A required field enforces that every recipe carries its design intent as prose.
- The user explicitly confirmed: "backward compat is a non-issue. There is one theme recipe and one theme. Fix them up."

**Implications:**
- `ThemeRecipe` interface gains `description: string`.
- `EXAMPLE_RECIPES.brio` gains a `description` value.
- `validateRecipeJson` must check for `description`.
- All code paths that construct a `ThemeRecipe` must include `description`: the gallery UI `currentRecipe` memo (~line 1581), the `runDerive` useCallback (~line 1441), and test fixtures.
- Both `generateCssExport` (in `gallery-theme-generator-content.tsx`) and `generateResolvedCssExport` (in `theme-derivation-engine.ts` ~line 2268) use `recipe.description` for the `@theme-description` CSS header.

---

### Specification {#specification}

#### Semantic Group Inventory {#semantic-group-inventory}

**Table T01: Semantic Decision Groups** {#t01-semantic-groups}

| Group Name | What It Controls | Applies To |
|-----------|-----------------|------------|
| `canvas-darkness` | How dark/light the app background is | bgAppTone, bgCanvasTone |
| `surface-layering` | How surfaces stack visually above the canvas | surfaceSunkenTone, surfaceDefaultTone, surfaceRaisedTone, surfaceOverlayTone, surfaceInsetTone, surfaceContentTone, surfaceScreenTone |
| `text-brightness` | How bright primary text is | fgDefaultTone, fgInverseTone |
| `text-hierarchy` | How much secondary/tertiary text dims from primary | fgMutedTone, fgSubtleTone, fgDisabledTone, fgPlaceholderTone |
| `text-coloring` | How much chroma text carries | txtI, txtISubtle, fgMutedI, atmIBorder, fgInverseI, fgOnCautionI, fgOnSuccessI |
| `surface-coloring` | How much chroma surfaces carry | atmI, bgAppI, bgCanvasI, surfaceDefaultI, surfaceRaisedI, surfaceOverlayI, surfaceScreenI, surfaceInsetI, surfaceContentI, bgAppSurfaceI |
| `filled-control-prominence` | How bold filled buttons are | filledBgDarkTone, filledBgHoverTone, filledBgActiveTone |
| `outlined-control-style` | How outlined buttons present | outlinedFg*, outlinedIcon*, outlinedOptionBorder*, outlinedBgHoverI, outlinedBgActiveI, outlinedBgHoverAlphaValue, outlinedBgActiveAlphaValue |
| `ghost-control-style` | How ghost buttons present | ghostFg*, ghostIcon*, ghostBorderI, ghostBorderTone |
| `border-visibility` | How visible borders and dividers are | borderIBase, borderIStrong, borderMutedI, borderMutedTone, borderStrongTone, borderStrongToneValue, dividerDefaultI, dividerMutedI |
| `shadow-depth` | How pronounced shadows are | shadowXsAlpha, shadowMdAlpha, shadowLgAlpha, shadowXlAlpha, shadowOverlayAlpha, overlayDimAlpha, overlayScrimAlpha, overlayHighlightAlpha |
| `badge-style` | How badges present | badgeTinted* fields |
| `card-frame-style` | How card title/tab bars present | cardFrameActiveI, cardFrameActiveTone, cardFrameInactiveI, cardFrameInactiveTone |
| `hue-slot-dispatch` | Which hue slot a surface/fg/border tier reads from | All `*HueSlot` fields in the surface, foreground, icon, border/divider, disabled, field, and toggle groups |
| `sentinel-alpha` | Alpha values for sentinel-dispatched hover/active tokens | tabBgHoverAlpha, tabCloseBgHoverAlpha, outlinedBgHoverAlpha, outlinedBgActiveAlpha, ghostAction*, ghostOption*, highlightHoverAlpha, ghostDangerBg* |
| `sentinel-hue-dispatch` | Which sentinel hue slot hover/active backgrounds use | outlinedBgHoverHueSlot, outlinedBgActiveHueSlot, ghostAction*, ghostOption*, tabBgHoverHueSlot, tabCloseBgHoverHueSlot, highlightHoverHueSlot |
| `computed-tone-override` | Flat-value overrides for tones that otherwise derive from formulas | dividerDefaultToneOverride, dividerMutedToneOverride, disabledFgToneValue, disabledBorderToneOverride, outlinedBg*ToneOverride, toggleTrackOffToneOverride, toggleDisabledToneOverride, bgCanvasToneBase, bgCanvasToneSCCenter, bgCanvasToneScale, disabledBgBase, disabledBgScale |
| `hue-name-dispatch` | Named hue values for resolveHueSlots branch elimination | surfScreenHue, fgMutedHueExpr, fgSubtleHue, fgDisabledHue, fgInverseHue, fgPlaceholderSource, selectionInactiveHue |
| `selection-mode` | Selection behavior mode flags and parameters | selectionInactiveSemanticMode, selectionBgInactiveI, selectionBgInactiveTone, selectionBgInactiveAlpha |
| `field-style` | How form fields present | fieldBg*, disabledBgI, disabledBorderI |
| `toggle-style` | How toggles present | toggleTrackOnHoverTone, toggleThumbDisabledTone, toggleTrackDisabledI |
| `icon-style` | How icons present in non-control contexts | iconActiveTone, iconMutedI, iconMutedTone |
| `tab-style` | How tabs present | tabFgActiveTone, tabBgActiveHueSlot, tabBgInactiveHueSlot |

#### Annotation Format {#annotation-format}

**Spec S01: @semantic Tag Format** {#s01-tag-format}

```typescript
/** @semantic <group-name> — <brief description of what this field controls> */
fieldName: type;
```

Rules:
- One `@semantic` tag per field.
- Group name matches a key from Table T01.
- Description is a concise phrase (not a full sentence).
- For fields that already have JSDoc, the `@semantic` tag is added as the first line of the JSDoc block.
- Em dash (—) separates group name from description.

#### ThemeRecipe Description Field {#description-field-spec}

**Spec S02: ThemeRecipe.description** {#s02-description-field}

```typescript
export interface ThemeRecipe {
  name: string;
  /** Human-readable description of the design intent for this theme. */
  description: string;
  mode: "dark" | "light";
  // ... existing fields
}
```

- Field is required (not optional).
- `validateRecipeJson` checks `typeof obj["description"] === "string"` and rejects empty strings.
- Both `generateCssExport` and `generateResolvedCssExport` use `recipe.description` for the `@theme-description` CSS header.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Missed fields in annotation | low | med | Automated count check in checkpoint | Any field without @semantic after step 2 |
| Test fixture breakage from required description | low | high | Systematic update of all test files | TypeScript compile errors |

**Risk R01: Consumer breakage from required description** {#r01-consumer-breakage}

- **Risk:** Adding `description` as required on `ThemeRecipe` will cause TypeScript errors in any code that constructs a `ThemeRecipe` without it — test fixtures, the gallery UI `currentRecipe` memo (~line 1581), the `runDerive` useCallback (~line 1441). Additionally, `validateRecipeJson` test cases that use bare objects (not typed as `ThemeRecipe`) will fail at runtime if they lack `description`.
- **Mitigation:** Step 1 systematically updates all construction sites. TypeScript `--noEmit` check catches any missed sites.
- **Residual risk:** None — TypeScript enforces completeness at compile time.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

None.

#### New files (if any) {#new-files}

None.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ThemeRecipe.description` | field | `theme-derivation-engine.ts` | New required `string` field |
| `EXAMPLE_RECIPES.brio.description` | value | `theme-derivation-engine.ts` | Brio theme description string |
| `validateRecipeJson` | fn | `gallery-theme-generator-content.tsx` | Add `description` validation |
| `generateCssExport` | fn | `gallery-theme-generator-content.tsx` | Use `recipe.description` for header |
| `generateResolvedCssExport` | fn | `theme-derivation-engine.ts` | Use `recipe.description` for header |

---

### Documentation Plan {#documentation-plan}

- [ ] Module-level JSDoc semantic decision table in `theme-derivation-engine.ts`
- [ ] `@semantic` tags on all `DerivationFormulas` fields
- [ ] JSDoc on `ThemeRecipe.description` field

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Golden / Contract** | Token output must be byte-identical before and after | After every step |
| **Unit** | validateRecipeJson accepts/rejects description field | Step 1 |
| **Integration** | Full test suite passes with updated fixtures | Step 1 |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add description field to ThemeRecipe and update all consumers {#step-1}

**Commit:** `feat(theme): add required description field to ThemeRecipe`

**References:** [D03] description is required, Spec S02, (#description-field-spec, #symbols, #assumptions)

**Artifacts:**
- Modified `ThemeRecipe` interface with `description: string`
- Updated `EXAMPLE_RECIPES.brio` with description value
- Updated `validateRecipeJson` to check for description
- Updated `generateCssExport` and `generateResolvedCssExport` to use `recipe.description`
- Updated gallery UI `currentRecipe` memo and `runDerive` callback to include description
- Updated all test fixtures that construct `ThemeRecipe` objects or bare recipe-shaped objects

**Tasks:**
- [ ] Add `description: string` to `ThemeRecipe` interface in `theme-derivation-engine.ts`, placed after `name` and before `mode`, with JSDoc: `/** Human-readable description of the design intent for this theme. */`
- [ ] Add description to `EXAMPLE_RECIPES.brio`:
  ```
  "Deep, immersive dark theme. Very dark surfaces with subtle layering. Near-white text with wide hierarchy spread. Filled controls are prominent with vivid accent backgrounds and white text. Borders are subtle. Shadows are moderate. Industrial warmth with muted chassis and vivid signals."
  ```
- [ ] Update `validateRecipeJson` in `gallery-theme-generator-content.tsx`: add check for `typeof obj["description"] === "string"` after the `name` check. Reject empty strings.
- [ ] Update `generateCssExport` in `gallery-theme-generator-content.tsx`: use `recipe.description` for the `@theme-description` CSS header line instead of the computed fallback string.
- [ ] Update `generateResolvedCssExport` in `theme-derivation-engine.ts` (~line 2268): same change — use `recipe.description` for the `@theme-description` CSS header instead of the computed `desc` string.
- [ ] Update the `currentRecipe` useMemo (~line 1581 in `gallery-theme-generator-content.tsx`): add a `description` field with a generated string, e.g. `` `Generated theme (${mode} mode, cardBg: ${cardBgHue}, text: ${textHue})` ``.
- [ ] Update the `runDerive` useCallback (~line 1441 in `gallery-theme-generator-content.tsx`): this is the second `ThemeRecipe` construction site. Add a `description` field with a generated string, e.g. `` `Generated theme (${m} mode, cardBg: ${cardBg}, text: ${txt})` ``.
- [ ] Update `handleRecipeImported` callback — no change needed since it reads from imported JSON which now must include description.
- [ ] Search all test files for `ThemeRecipe` construction sites and bare recipe-shaped objects, and add `description` to each. Note: `theme-export-import.test.tsx` may construct bare objects that pass through `validateRecipeJson` — these must also include `description` or the validation tests will fail. Files to update:
  - `tugdeck/src/__tests__/theme-derivation-engine.test.ts`
  - `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx`
  - `tugdeck/src/__tests__/theme-accessibility.test.ts`
  - `tugdeck/src/__tests__/cvd-preview-auto-fix.test.tsx`
  - `tugdeck/src/__tests__/contrast-dashboard.test.tsx`
  - `tugdeck/src/__tests__/theme-export-import.test.tsx` (includes bare objects for validateRecipeJson — add `description` to those too)
- [ ] `tugdeck/scripts/generate-tug-tokens.ts` needs no changes — it calls `deriveTheme(EXAMPLE_RECIPES.brio)` which inherits the description from the updated `EXAMPLE_RECIPES.brio`.

**Tests:**
- [ ] Existing test: `validateRecipeJson` rejects recipes without `description`
- [ ] Existing test: `validateRecipeJson` accepts recipes with valid `description`
- [ ] All existing tests pass with updated fixtures

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` — zero errors
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — output is byte-identical to pre-change output (compare with `diff`)

---

#### Step 2: Annotate all DerivationFormulas fields with @semantic tags {#step-2}

**Depends on:** #step-1

**Commit:** `docs(theme): annotate DerivationFormulas fields with @semantic tags`

**References:** [D01] @semantic tag format, [D02] ~18-20 groups, Table T01, Spec S01, (#semantic-group-inventory, #annotation-format)

**Artifacts:**
- Every field in `DerivationFormulas` interface annotated with `@semantic` JSDoc tag

**Tasks:**
- [ ] For each field in `DerivationFormulas`, add a `/** @semantic <group> — <description> */` comment above the field declaration. Use the group assignments from Table T01.
- [ ] For fields that already have JSDoc comments, prepend the `@semantic` tag as the first line of the existing JSDoc block.
- [ ] Verify group assignments cover all fields — no field should be untagged.
- [ ] Semantic group assignments for the main field categories:
  - Surface tone anchors (7 fields) → `surface-layering`; bgAppTone, bgCanvasTone → `canvas-darkness`
  - Surface intensity fields (9 fields) → `surface-coloring`
  - Foreground tone anchors (6 fields) → `text-brightness` (fgDefaultTone, fgInverseTone) and `text-hierarchy` (fgMutedTone, fgSubtleTone, fgDisabledTone, fgPlaceholderTone)
  - Text intensity levels (7 fields) → `text-coloring`
  - Border parameters (7 fields) → `border-visibility`
  - Card frame fields (4 numeric + 2 hue-slot) → `card-frame-style` (numeric), `hue-slot-dispatch` (hue-slot)
  - Shadow/overlay alphas (8 fields) → `shadow-depth`
  - Control emphasis parameters (3 fields) → `filled-control-prominence`
  - Icon overrides (3 fields) → `icon-style`
  - Tab overrides (1 field) → `tab-style`
  - Toggle fields (3 fields) → `toggle-style`
  - Field tone anchors (6 fields) → `field-style`
  - Control disabled parameters (2 fields) → `field-style`
  - Formula parameter fields for computed tones (5 fields) → `computed-tone-override`
  - Badge tinted fields (8 fields) → `badge-style`
  - Hue slot fields — surface tiers (9 fields) → `hue-slot-dispatch`
  - Hue slot fields — foreground tiers (6 fields) → `hue-slot-dispatch`
  - Hue slot fields — icon tiers (2 fields) → `hue-slot-dispatch`
  - Hue slot fields — border/divider (1 field) → `hue-slot-dispatch`
  - Hue slot fields — disabled (1 field) → `hue-slot-dispatch`
  - Hue slot fields — field (5 fields) → `hue-slot-dispatch`
  - Hue slot fields — toggle (4 fields) → `hue-slot-dispatch`
  - Sentinel hue slot fields (9 fields) → `sentinel-hue-dispatch`
  - Sentinel alpha fields (10 fields) → `sentinel-alpha`
  - Outlined emphasis fields (16 fields) → `outlined-control-style`
  - Ghost emphasis fields (18 fields) → `ghost-control-style`
  - Non-control unified fields (bgAppSurfaceI) → `surface-coloring`; others to their respective groups
  - Selection fields (3 numeric + 1 boolean) → `selection-mode`
  - Hue-name fields (7 fields) → `hue-name-dispatch`
  - Computed-tone overrides (9 fields) → `computed-tone-override`

**Tests:**
- [ ] No new tests (annotation-only change)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` — zero errors (JSDoc changes don't break types)
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — output is byte-identical

---

#### Step 3: Add module-level semantic decision table to JSDoc {#step-3}

**Depends on:** #step-2

**Commit:** `docs(theme): add semantic decision table to module JSDoc`

**References:** [D02] ~18-20 groups, Table T01, (#context, #strategy, #semantic-group-inventory)

**Artifacts:**
- Expanded `@module` JSDoc block in `theme-derivation-engine.ts` with the semantic decision table

**Tasks:**
- [ ] Expand the existing `@module` JSDoc block (lines 1-38) to include a "Semantic Decision Groups" section after the existing pipeline documentation.
- [ ] The table should list each group name, what it controls, the dark recipe's typical choice, and the formula fields in that group — matching the content of Table T01 but formatted for JSDoc readability.
- [ ] Include a brief introduction explaining: "A recipe is a set of positions on these ~18-20 semantic decisions. Each field in DerivationFormulas is tagged with `@semantic <group>` to link it to its decision group."

**Tests:**
- [ ] No new tests (documentation-only change)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` — zero errors
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — output is byte-identical

---

#### Step 4: Integration Checkpoint {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [D01] @semantic tag format, [D02] ~18-20 groups, [D03] description required, Spec S01, Spec S02, Table T01, (#success-criteria)

**Tasks:**
- [ ] Verify all `DerivationFormulas` fields have `@semantic` tags (grep count matches field count)
- [ ] Verify `ThemeRecipe` has `description: string`
- [ ] Verify `EXAMPLE_RECIPES.brio` has a `description` value
- [ ] Verify module-level JSDoc contains the semantic decision table
- [ ] Verify token output is byte-identical

**Tests:**
- [ ] Full test suite: `cd tugdeck && bun test`

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` — zero errors
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens && diff styles/tug-base-generated.css <(git show HEAD:tugdeck/styles/tug-base-generated.css)` — no diff (token output identical)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** `DerivationFormulas` fields annotated with `@semantic` tags, `ThemeRecipe` has a required `description` field, Brio theme description written, semantic decision table documented in module JSDoc — zero behavioral changes.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Every field in `DerivationFormulas` has a `@semantic` tag (verified by grep count)
- [ ] `ThemeRecipe.description` is a required `string` field
- [ ] `EXAMPLE_RECIPES.brio.description` is populated
- [ ] Module-level JSDoc contains the semantic decision table
- [ ] `bun run generate:tokens` produces byte-identical output
- [ ] `bun test` passes all tests
- [ ] `bunx tsc --noEmit` reports zero errors

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bunx tsc --noEmit` — zero errors
- [ ] `cd tugdeck && bun run generate:tokens` — output unchanged

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Part 3: Restructure `DerivationFormulas` — reorder fields by semantic group
- [ ] Part 4: Annotate `DARK_FORMULAS` values with design rationale comments
- [ ] Part 5: Create a light theme recipe from a design intent prompt

| Checkpoint | Verification |
|------------|--------------|
| TypeScript compiles | `cd tugdeck && bunx tsc --noEmit` |
| Tests pass | `cd tugdeck && bun test` |
| Token output unchanged | `cd tugdeck && bun run generate:tokens` + diff |
