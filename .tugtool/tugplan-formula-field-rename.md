## Phase 3.5C: Spell Out Formula Field Abbreviations {#formula-field-rename}

**Purpose:** Rename all ~200 formula field names across `DerivationFormulas`, `ComputedTones`, `DARK_FORMULAS`, `LIGHT_FORMULAS`, and `derivation-rules.ts` to self-documenting four-slot names (`<context><Constituent><State><Parameter>`), eliminating the readability tax of cryptic abbreviations while preserving identical runtime behavior.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-20 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `DerivationFormulas` interface uses terse abbreviations like `txtI`, `atmI`, `bgAppI`, and `fgDefaultTone` that require memorization or constant cross-referencing with JSDoc comments. Every reader — human or LLM — pays this readability tax on every encounter. Phase 3.5C renames all formula fields to self-documenting spelled-out names using the four-slot naming convention established in the renaming guide (`<context><Constituent><State><Parameter>`).

This is a pure mechanical rename with no behavioral changes. The authoritative old-to-new mapping is defined in `roadmap/3c-renaming-scheme-2.txt`. Two dead fields (`outlinedBgHoverAlpha`, `outlinedBgActiveAlpha`) are deleted as part of this phase.

#### Strategy {#strategy}

- Rename `DerivationFormulas` interface fields, `ComputedTones` interface fields, `DARK_FORMULAS`, `LIGHT_FORMULAS`, and `derivation-rules.ts` atomically in a single step — these are tightly coupled via `keyof F` types and `formulas.xxx` accesses, so they must change together to maintain TypeScript compilation.
- Update test files and gallery component references next.
- Delete the two dead fields (`outlinedBgHoverAlpha`, `outlinedBgActiveAlpha`) in the interface rename step.
- Perform an exhaustive grep sweep for any old field names that were missed.
- Verify zero behavioral change via `bun run check`, `bun test`, and `bun run audit:tokens lint` after every step.

#### Success Criteria (Measurable) {#success-criteria}

- `bun run check` (tsc --noEmit) passes with zero errors after all renames (verification: run command)
- `bun test` passes with identical results before and after (verification: run command, compare pass/fail counts)
- `bun run audit:tokens lint` passes with no new warnings or errors (verification: run command)
- Zero formula fields use the old abbreviated names — no `txtI`, `bgApp`, `fgDefault`, etc. remain in any TypeScript file (verification: grep for old field names across `tugdeck/src/`)
- The two dead fields `outlinedBgHoverAlpha` and `outlinedBgActiveAlpha` are removed from `DerivationFormulas`, `DARK_FORMULAS`, and `LIGHT_FORMULAS` (verification: grep confirms absence)

#### Scope {#scope}

1. Rename all ~95 fields that change names in `DerivationFormulas` interface per the rename table
2. Rename corresponding `ComputedTones` fields (`bgApp` -> `surfaceApp`, `bgCanvas` -> `surfaceCanvas`, `disabledBgTone` -> `disabledSurfaceTone`, `disabledFgTone` -> `disabledTextTone`, `outlinedBgRestTone` -> `outlinedSurfaceRestTone`, `outlinedBgHoverTone` -> `outlinedSurfaceHoverTone`, `outlinedBgActiveTone` -> `outlinedSurfaceActiveTone`, `signalI` -> `signalIntensity`)
3. Update `DARK_FORMULAS` and `LIGHT_FORMULAS` object literals
4. Update all `formulas.xxx` property accesses in `derivation-rules.ts`
5. Update string-literal hueSlot sentinels in `derivation-rules.ts` (e.g., `"bgApp"` -> `"surfaceApp"`)
6. Update `computeTones()` function body — local variables and `formulas.xxx` references
7. Update hueSlot resolution logic in `theme-derivation-engine.ts` that builds sentinel-to-slot mappings
8. Update `theme-derivation-engine.test.ts` — all string references to formula/computed field names
9. Update `gallery-theme-generator-content.tsx` — `DerivationFormulas` type usage (no field-name string literals expected, but imports and typed references)
10. Delete two dead fields: `outlinedBgHoverAlpha`, `outlinedBgActiveAlpha`
11. Update JSDoc `@semantic` group comments that reference old field names

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing any formula values, derivation logic, or token output
- Renaming CSS custom properties (`--tug-base-*` tokens are unchanged)
- Renaming `ThemeRecipe`, `MoodKnobs`, `ResolvedHueSlots`, or other non-formula interfaces
- Adding new fields or removing fields beyond the two confirmed dead ones
- Changing the `RULES` table structure or adding/removing rules

#### Dependencies / Prerequisites {#dependencies}

- Phase 3 (independent recipes) is merged — `LIGHT_FORMULAS` exists as a standalone 202-field literal
- The rename table in `roadmap/3c-renaming-scheme-2.txt` is finalized and authoritative

#### Constraints {#constraints}

- Pure rename — no behavioral changes permitted; all existing tests must pass identically
- TypeScript strict mode must remain satisfied (`bun run check`)
- `bun run audit:tokens lint` must pass — confirms no token derivation behavior changed
- The rename table is the single source of truth — no improvised renames beyond what it specifies

#### Assumptions {#assumptions}

- The rename table in `roadmap/3c-renaming-scheme-2.txt` is complete — no additional renames beyond what is listed
- The two dead fields (`outlinedBgHoverAlpha`, `outlinedBgActiveAlpha`) are confirmed unreferenced at runtime; only their `AlphaValue` counterparts are consumed
- `ComputedTones` fields that correspond to renamed `DerivationFormulas` fields are renamed in this phase
- Hue slot sentinel strings in `derivation-rules.ts` are updated to match the new naming conventions
- String literals passed to helper functions (`filledBg`, `outlinedBg`, `outlinedFg`, `ghostBg`, etc.) are updated to use new field names

---

### Design Decisions {#design-decisions}

#### [D01] Four-slot naming convention is the target format (DECIDED) {#d01-four-slot-naming}

**Decision:** All formula fields follow `<context><Constituent><State><Parameter>` as defined in `roadmap/3c-renaming-scheme-2.txt`.

**Rationale:**
- Four slots map directly to the six-slot token naming convention (minus plane and role, which are absent from formula names)
- Every field name becomes self-documenting: `outlinedSurfaceHoverIntensity` immediately tells you context=outlined, constituent=Surface, state=Hover, parameter=Intensity

**Implications:**
- All substitution rules from the rename guide apply: `bg` -> `surface`, `fg` -> context-specific text, `I` -> `Intensity`, `Bg` (mid-word) -> `Surface`, `Fg` (mid-word) -> `Text`, `Value` -> dropped or `Computed`, `Hue`/`Expr`/`Source` -> `HueExpression`

#### [D02] ComputedTones fields renamed alongside DerivationFormulas (DECIDED) {#d02-computed-tones-rename}

**Decision:** ComputedTones fields are renamed in the same phase using the same four-slot conventions — no half-measures.

**Rationale:**
- ComputedTones keys are used as string arguments in `surface()` builder calls in `derivation-rules.ts`
- Leaving old names in ComputedTones while renaming DerivationFormulas would create inconsistency
- User explicitly requested: "Rename BOTH DerivationFormulas AND ComputedTones fields together"

**Implications:**
- The `surface()` builder's `toneKey` parameter (typed `keyof ComputedTones`) must use new names
- All `computed[key]` accesses in `derivation-rules.ts` and `computeTones()` must be updated
- Local variables inside `computeTones()` should match the new ComputedTones field names

#### [D03] String-literal sentinel hueSlots updated to match new names (DECIDED) {#d03-sentinel-update}

**Decision:** All formulas-mediated hueSlot sentinel strings in `derivation-rules.ts` are updated to match the new formula field names. For example, `"bgApp"` becomes `"surfaceApp"`, and `"outlinedBgHover"` becomes `"outlinedSurfaceHover"`.

**Rationale:**
- Sentinel strings are resolved via `formulas[name + "HueSlot"]` — when `bgAppHueSlot` becomes `surfaceAppHueSlot`, the sentinel must change from `"bgApp"` to `"surfaceApp"` for the lookup to work
- User explicitly requested: "UPDATE sentinel strings to match the new formula field name conventions. No old names left anywhere"

**Implications:**
- Every `hueSlot: "bgApp"` in the RULES table becomes `hueSlot: "surfaceApp"`
- Every `hueSlot: "outlinedBgHover"` becomes `hueSlot: "outlinedSurfaceHover"`
- The sentinel resolution code in `resolveHueSlots()` or `evaluateRules()` that does `formulas[sentinel + "HueSlot"]` continues working because the sentinel prefix now matches the renamed formula field

#### [D04] Dead fields deleted, not renamed (DECIDED) {#d04-dead-field-deletion}

**Decision:** `outlinedBgHoverAlpha` and `outlinedBgActiveAlpha` are deleted outright rather than renamed. The corresponding `AlphaValue` fields (`outlinedBgHoverAlphaValue` -> `outlinedSurfaceHoverAlpha`, `outlinedBgActiveAlphaValue` -> `outlinedSurfaceActiveAlpha`) are the real fields consumed at runtime.

**Rationale:**
- These fields are never read at runtime — confirmed dead code
- Renaming dead code would perpetuate confusion about which alpha fields are real

**Implications:**
- Field count drops from 202 to 200
- Both `DARK_FORMULAS` and `LIGHT_FORMULAS` lose two entries each
- `DerivationFormulas` interface loses two field declarations

#### [D05] Atomic rename across tightly coupled files (DECIDED) {#d05-atomic-rename}

**Decision:** `theme-derivation-engine.ts` and `derivation-rules.ts` are renamed in a single step because they are tightly coupled via `keyof F` types and ~104 `formulas.xxx` property accesses.

**Rationale:**
- Renaming `DerivationFormulas` fields without simultaneously updating `derivation-rules.ts` would produce 100+ TypeScript type errors — `tsc` cannot pass in an intermediate state
- `derivation-rules.ts` has ~11 `keyof F` typed parameters, ~104 `formulas.xxx` accesses, and ~21 `computed.xxx` accesses that all reference `DerivationFormulas` and `ComputedTones` field names

**Implications:**
- Step 2 is the largest step: it touches both `theme-derivation-engine.ts` and `derivation-rules.ts` atomically
- Step 3 handles test files and gallery component separately since they have no circular dependency on the engine types

---

### Specification {#specification}

#### Rename Table Reference {#rename-table-ref}

The complete rename table is in `roadmap/3c-renaming-scheme-2.txt`. It defines ~95 field renames across 22 context groups and 2 deletions.

**Table T01: ComputedTones Field Renames** {#t01-computed-tones-renames}

| Current | Proposed |
|---------|----------|
| `bgApp` | `surfaceApp` |
| `bgCanvas` | `surfaceCanvas` |
| `disabledBgTone` | `disabledSurfaceTone` |
| `disabledFgTone` | `disabledTextTone` |
| `outlinedBgRestTone` | `outlinedSurfaceRestTone` |
| `outlinedBgHoverTone` | `outlinedSurfaceHoverTone` |
| `outlinedBgActiveTone` | `outlinedSurfaceActiveTone` |
| `signalI` | `signalIntensity` |

**Table T02: Sentinel HueSlot String Renames** {#t02-sentinel-renames}

| Current sentinel | Proposed sentinel | Reason |
|-----------------|-------------------|--------|
| `"bgApp"` | `"surfaceApp"` | `bgAppHueSlot` -> `surfaceAppHueSlot` |
| `"bgCanvas"` | `"surfaceCanvas"` | `bgCanvasHueSlot` -> `surfaceCanvasHueSlot` |
| `"outlinedBgHover"` | `"outlinedSurfaceHover"` | `outlinedBgHoverHueSlot` -> `outlinedSurfaceHoverHueSlot` |
| `"outlinedBgActive"` | `"outlinedSurfaceActive"` | `outlinedBgActiveHueSlot` -> `outlinedSurfaceActiveHueSlot` |
| `"selectionInactive"` | (no change) | `selectionInactiveHue` -> `selectionInactiveHueExpression`, but HueSlot is not used |
| `"tabBgActive"` | `"tabSurfaceActive"` | `tabBgActiveHueSlot` -> `tabSurfaceActiveHueSlot` |
| `"tabBgInactive"` | `"tabSurfaceInactive"` | `tabBgInactiveHueSlot` -> `tabSurfaceInactiveHueSlot` |
| `"tabBgHover"` | `"tabSurfaceHover"` | `tabBgHoverHueSlot` -> `tabSurfaceHoverHueSlot` |
| `"tabCloseBgHover"` | `"tabCloseSurfaceHover"` | `tabCloseBgHoverHueSlot` -> `tabCloseSurfaceHoverHueSlot` |
| `"ghostActionBgHover"` | `"ghostActionSurfaceHover"` | `ghostActionBgHoverHueSlot` -> `ghostActionSurfaceHoverHueSlot` |
| `"ghostActionBgActive"` | `"ghostActionSurfaceActive"` | `ghostActionBgActiveHueSlot` -> `ghostActionSurfaceActiveHueSlot` |
| `"ghostOptionBgHover"` | `"ghostOptionSurfaceHover"` | `ghostOptionBgHoverHueSlot` -> `ghostOptionSurfaceHoverHueSlot` |
| `"ghostOptionBgActive"` | `"ghostOptionSurfaceActive"` | `ghostOptionBgActiveHueSlot` -> `ghostOptionSurfaceActiveHueSlot` |
| `"disabledBg"` | `"disabledSurface"` | `disabledBgHueSlot` -> `disabledSurfaceHueSlot` |
| `"fieldBgHover"` | `"fieldSurfaceHover"` | `fieldBgHoverHueSlot` -> `fieldSurfaceHoverHueSlot` |
| `"fieldBgReadOnly"` | `"fieldSurfaceReadOnly"` | `fieldBgReadOnlyHueSlot` -> `fieldSurfaceReadOnlyHueSlot` |
| `"fgOnAccent"` | `"onAccentText"` | `fgOnAccentHueSlot` -> `onAccentTextHueSlot` |
| `"highlightHover"` | (no change) | `highlightHoverHueSlot` is unchanged |
| `"dividerMuted"` | (no change) | `dividerMutedHueSlot` is unchanged |

**Table T03: Affected Files** {#t03-affected-files}

| File | What changes |
|------|-------------|
| `tugdeck/src/components/tugways/theme-derivation-engine.ts` | `DerivationFormulas` interface, `ComputedTones` interface, `DARK_FORMULAS`, `LIGHT_FORMULAS`, `computeTones()`, JSDoc `@semantic` comments, hueSlot resolution logic |
| `tugdeck/src/components/tugways/derivation-rules.ts` | `keyof F` arguments to builders, `formulas.xxx` property accesses, hueSlot sentinel strings, `computed.xxx` accesses, JSDoc comments |
| `tugdeck/src/__tests__/theme-derivation-engine.test.ts` | String-literal field name references in test assertions |
| `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` | Type imports (no field-name changes expected beyond import type alignment) |
| `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` | String-literal field name references (e.g., `harmonyFormulas.bgAppTone`, `harmonyFormulas.fgDefaultTone`) |

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Missed string-literal reference | high | medium | Exhaustive grep for every old field name after rename | Any test failure or runtime error |
| Sentinel/hueSlot mismatch | high | low | Systematic update per Table T02, verified by `bun test` | Token output changes (audit:tokens lint) |
| Merge conflict with concurrent work | medium | low | Coordinate timing; this is a focused rename phase | Other PRs touching formula files |

**Risk R01: Missed string-literal reference breaks hue resolution** {#r01-missed-string-literal}

- **Risk:** A formulas-mediated hueSlot string like `"bgApp"` is missed during rename, causing `formulas["bgAppHueSlot"]` to return `undefined` at runtime.
- **Mitigation:** Step 4 performs an exhaustive grep for every old field name across all TypeScript files. Step 5 runs the full test suite and audit:tokens to catch any behavioral deviation.
- **Residual risk:** None if the grep sweep is thorough — old names that are still present will be caught.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers — add an anchor instead.

#### Step 1: Baseline verification {#step-1}

<!-- Step 1 has no dependencies (it is the root) -->

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #context)

**Artifacts:**
- Baseline test results for comparison after rename

**Tasks:**
- [ ] Run `bun run check` and confirm zero TypeScript errors
- [ ] Run `bun test` and record pass/fail count
- [ ] Run `bun run audit:tokens lint` and confirm clean output
- [ ] Save baseline results for comparison in Step 5

**Tests:**
- [ ] `cd tugdeck && bun run check` exits with code 0
- [ ] `cd tugdeck && bun test` exits with code 0
- [ ] `cd tugdeck && bun run audit:tokens lint` exits with code 0

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes
- [ ] `cd tugdeck && bun test` passes
- [ ] `cd tugdeck && bun run audit:tokens lint` passes

---

#### Step 2: Rename DerivationFormulas, ComputedTones, formula objects, derivation-rules.ts, and computeTones {#step-2}

**Depends on:** #step-1

**Commit:** `refactor: rename DerivationFormulas, ComputedTones, and derivation-rules fields to four-slot names`

**References:** [D01] Four-slot naming convention, [D02] ComputedTones rename, [D03] Sentinel update, [D04] Dead field deletion, [D05] Atomic rename, Table T01, Table T02, (#rename-table-ref, #t01-computed-tones-renames, #t02-sentinel-renames)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — renamed `DerivationFormulas` interface (~95 field renames, 2 deletions), renamed `ComputedTones` interface (8 field renames), updated `DARK_FORMULAS` and `LIGHT_FORMULAS` objects, updated `computeTones()` function body and local variables, updated JSDoc `@semantic` group comments, updated hueSlot resolution logic
- `tugdeck/src/components/tugways/derivation-rules.ts` — updated `keyof F` string arguments, `formulas.xxx` property accesses (~104 accesses), hueSlot sentinel strings, `computed.xxx` accesses (~21 accesses), JSDoc comments

**Tasks:**
- [ ] Open `theme-derivation-engine.ts`
- [ ] In the `DerivationFormulas` interface (starting around line 479): apply all renames from `roadmap/3c-renaming-scheme-2.txt` — rename ~95 fields, preserve JSDoc comments, update `@semantic` group field lists in the file header
- [ ] Delete the two dead fields: `outlinedBgHoverAlpha` and `outlinedBgActiveAlpha` from the interface
- [ ] In the `ComputedTones` interface: rename 8 fields per Table T01
- [ ] In `DARK_FORMULAS` object: rename all ~95 field keys to match the new interface, delete the two dead field entries
- [ ] In `LIGHT_FORMULAS` object: rename all ~95 field keys to match the new interface, delete the two dead field entries
- [ ] In `computeTones()` function: update `formulas.xxx` property accesses to use new names (e.g., `formulas.bgAppTone` -> `formulas.surfaceAppTone`), rename local variables to match new ComputedTones fields (e.g., `bgApp` -> `surfaceApp`), update return object keys
- [ ] Update the hueSlot resolution logic that builds sentinel-to-slot mappings — any code that does `formulas[sentinel + "HueSlot"]` or iterates formula fields for hue dispatch
- [ ] Update the module-level JSDoc header (~lines 48-232) — all `@semantic` group comments reference old field names and must be updated to use new names (e.g., `atmI` -> `atmosphereIntensity`, `bgAppI` -> `surfaceAppBaseIntensity`, `txtI` -> `contentTextIntensity`)
- [ ] Update all other `formulas.xxx` accesses within `theme-derivation-engine.ts` (e.g., in `deriveTheme()`, `evaluateRules()`, `resolveHueSlots()`, and any other helper functions)
- [ ] Open `derivation-rules.ts`
- [ ] Update all `keyof F` typed arguments passed to builder functions: `surface()`, `outlinedFg()`, `filledBg()`, `outlinedBg()`, `badgeTinted()`, and any other builders that take `keyof F` parameters
  - Example: `filledBg(50, "filledBgDarkTone")` -> `filledBg(50, "filledSurfaceRestTone")`
  - Example: `outlinedFg("outlinedFgI", "outlinedFgRestTone")` -> `outlinedFg("outlinedTextIntensity", "outlinedTextRestTone")`
  - Example: `surface("bgApp", "bgAppSurfaceI", "bgApp")` -> `surface("surfaceApp", "surfaceAppBaseIntensity", "surfaceApp")`
- [ ] Update all inline `formulas.xxx` property accesses in lambda expressions
  - Example: `formulas.txtI` -> `formulas.contentTextIntensity`
  - Example: `formulas.cardFrameActiveI` -> `formulas.cardFrameActiveIntensity`
  - Example: `formulas.fgOnCautionI` -> `formulas.onCautionTextIntensity`
- [ ] Update all `computed.xxx` accesses to use new ComputedTones field names
  - Example: `computed.signalI` -> `computed.signalIntensity`
  - Example: `computed.disabledBgTone` -> `computed.disabledSurfaceTone`
  - Example: `computed.outlinedBgHoverTone` -> `computed.outlinedSurfaceHoverTone`
  - Example: `computed.outlinedBgRestTone` -> `computed.outlinedSurfaceRestTone`
  - Example: `computed.outlinedBgActiveTone` -> `computed.outlinedSurfaceActiveTone`
- [ ] Update all formulas-mediated hueSlot sentinel strings per Table T02 (19 entries, 15 that change). **WARNING: Direct `ResolvedHueSlots` keys used as hueSlot strings must NOT be renamed. These include: `fgDisabled`, `fgMuted`, `fgSubtle`, `fgInverse`, `fgPlaceholder`, `surfScreen`, `selectionInactive`, `borderTintBareBase`, `borderStrong`, `surfBareBase`. Only formulas-mediated sentinel strings listed in Table T02 change.**
  - Example: `hueSlot: "bgApp"` -> `hueSlot: "surfaceApp"`
  - Example: `"outlinedBgHover"` in `outlinedBg(...)("outlinedBgHover")` -> `"outlinedSurfaceHover"`
  - Example: `hueSlot: "tabBgActive"` -> `hueSlot: "tabSurfaceActive"`
  - Example: `hueSlot: "disabledBg"` -> `hueSlot: "disabledSurface"`
  - Example: `hueSlot: "fieldBgHover"` -> `hueSlot: "fieldSurfaceHover"`
  - Example: `hueSlot: "fieldBgReadOnly"` -> `hueSlot: "fieldSurfaceReadOnly"`
  - Example: `formulaField("fgOnAccent", ...)` -> `formulaField("onAccentText", ...)`
- [ ] Update JSDoc comments and inline comments in `derivation-rules.ts` referencing old field names
- [ ] Update builder function JSDoc comments (e.g., `filledFg` references `txtI`, update to `contentTextIntensity`)

**Tests:**
- [ ] TypeScript compilation passes with renamed interfaces and all downstream references updated across both files

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes

---

#### Step 3: Update test file and gallery component {#step-3}

**Depends on:** #step-2

**Commit:** `refactor: update tests and gallery for renamed formula fields`

**References:** [D01] Four-slot naming convention, [D02] ComputedTones rename, Table T01, Table T03, (#t01-computed-tones-renames, #t03-affected-files)

**Artifacts:**
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — updated string-literal field name references in assertions
- `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` — updated string-literal field name references (e.g., `harmonyFormulas.bgAppTone`, `harmonyFormulas.fgDefaultTone`)
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` — updated typed references if any

**Tasks:**
- [ ] In `theme-derivation-engine.test.ts`: update all string-literal references to formula field names and ComputedTones field names in test assertions
- [ ] In `theme-derivation-engine.test.ts`: update any test descriptions/comments that reference old field names
- [ ] In `gallery-theme-generator-content.test.tsx`: update all string-literal references to formula field names (e.g., `harmonyFormulas.bgAppTone` -> `harmonyFormulas.surfaceAppTone`, `harmonyFormulas.fgDefaultTone` -> `harmonyFormulas.contentTextDefaultTone`)
- [ ] In `gallery-theme-generator-content.tsx`: verify imports compile correctly; update any field-name string references if present
- [ ] Search for any other `.ts` or `.tsx` files in `tugdeck/src/` that reference old formula field names and update them

**Tests:**
- [ ] All tests pass with updated field name references

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes
- [ ] `cd tugdeck && bun test` passes

---

#### Step 4: Exhaustive old-name sweep {#step-4}

**Depends on:** #step-3

**Commit:** `refactor: clean up any remaining old formula field references`

**References:** [D01] Four-slot naming convention, [D02] ComputedTones rename, Risk R01, (#success-criteria, #r01-missed-string-literal)

**Artifacts:**
- Any remaining files with old field names — cleaned up

**Tasks:**
- [ ] Grep for every old DerivationFormulas field name that was renamed across all `.ts` and `.tsx` files in `tugdeck/src/`. Key old names to search for (non-exhaustive — search for all ~95 renamed fields):
  - `txtI` (but not `contentTextIntensity`), `atmI` (but not `atmosphereIntensity`), `bgAppTone`, `bgCanvasTone`, `bgAppI`, `bgCanvasI`, `bgAppSurfaceI`, `bgAppHueSlot`, `bgCanvasHueSlot`
  - `fgDefaultTone`, `fgMutedTone`, `fgMutedI`, `fgMutedHueSlot`, `fgMutedHueExpr`, `fgSubtleTone`, `txtISubtle`, `fgSubtleHueSlot`, `fgSubtleHue`
  - `fgDisabledTone`, `disabledFgToneValue`, `fgDisabledHueSlot`, `fgDisabledHue`, `disabledBgI`, `disabledBgHueSlot`, `disabledBg` (as a sentinel string), `disabledBgBase`, `disabledBgScale`
  - `fieldBgHoverHueSlot`, `fieldBgHover` (as a sentinel string), `fieldBgReadOnlyHueSlot`, `fieldBgReadOnly` (as a sentinel string)
  - `fgInverseTone`, `fgInverseI`, `fgInverseHueSlot`, `fgInverseHue`
  - `fgPlaceholderTone`, `fgPlaceholderHueSlot`, `fgPlaceholderSource`
  - `fgOnAccentHueSlot`, `fgOnAccent` (as a sentinel string in `formulaField()`), `fgOnCautionI`, `fgOnSuccessI`
  - `borderMutedI`, `borderStrongToneValue`, `borderIBase`, `borderIStrong`
  - `dividerDefaultI`, `dividerMutedI`
  - `filledBgDarkTone`, `filledBgHoverTone`, `filledBgActiveTone`
  - `outlinedFgRestTone`, `outlinedFgHoverTone`, `outlinedFgActiveTone`, `outlinedFgI`, `outlinedFgRestToneLight`, `outlinedFgHoverToneLight`, `outlinedFgActiveToneLight`
  - `outlinedIconI`, `outlinedBgHoverI`, `outlinedBgHoverAlphaValue`, `outlinedBgActiveI`, `outlinedBgActiveAlphaValue`
  - `outlinedBgRestToneOverride`, `outlinedBgHoverToneOverride`, `outlinedBgActiveToneOverride`, `outlinedBgHoverHueSlot`, `outlinedBgActiveHueSlot`
  - All ghost `Fg`/`Bg` old names
  - All badge `Fg`/`Bg` old names
  - All tab/field/selection old names
  - `cardFrameActiveI`, `cardFrameInactiveI`, `iconMutedI`
  - `toggleTrackDisabledI`
  - `surfScreenHue`, `selectionInactiveHue`
  - `cautionBgTone`
  - `tabFgActiveTone`, `tabBgActiveHueSlot`, `tabBgInactiveHueSlot`, `tabBgHoverHueSlot`, `tabBgHoverAlpha`
  - `tabCloseBgHoverHueSlot`, `tabCloseBgHoverAlpha`
  - `surfaceDefaultI`, `surfaceRaisedI`, `surfaceOverlayI`, `surfaceScreenI`, `surfaceInsetI`, `surfaceContentI`
  - `badgeTintedFgTone`, `badgeTintedFgI`, `badgeTintedBgTone`, `badgeTintedBgI`, `badgeTintedBgAlpha`, `badgeTintedBorderI`
  - `selectionBgInactiveTone`, `selectionBgInactiveI`, `selectionBgInactiveAlpha`
  - `bgCanvasToneBase`, `bgCanvasToneSCCenter`, `bgCanvasToneScale`
  - `atmIBorder`
- [ ] Grep for every old ComputedTones field name across all `.ts` and `.tsx` files in `tugdeck/src/`:
  - `bgApp` (as a ComputedTones key, not as part of a longer name), `bgCanvas`, `disabledBgTone`, `disabledFgTone`, `outlinedBgRestTone`, `outlinedBgHoverTone`, `outlinedBgActiveTone`, `signalI`
- [ ] Fix any remaining references found by the grep sweep
- [ ] Also grep for the two deleted fields to confirm they are fully removed: `outlinedBgHoverAlpha` (as a standalone field, not as part of `outlinedBgHoverAlphaValue`), `outlinedBgActiveAlpha` (as a standalone field)
- [ ] Check `roadmap/3c-renaming-scheme-2.txt` itself — this reference document should NOT be modified (it documents old->new mappings)

**Tests:**
- [ ] Grep returns zero hits for any old DerivationFormulas or ComputedTones field name in TypeScript source files (excluding `roadmap/` documentation)

**Checkpoint:**
- [ ] Grep sweep confirms zero old field names remain in `tugdeck/src/**/*.ts` and `tugdeck/src/**/*.tsx`
- [ ] `cd tugdeck && bun run check` passes

---

#### Step 5: Final verification and comparison {#step-5}

**Depends on:** #step-4

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #context)

**Tasks:**
- [ ] Run `bun run check` and confirm zero TypeScript errors
- [ ] Run `bun test` and compare pass/fail count to Step 1 baseline — must be identical
- [ ] Run `bun run audit:tokens lint` and confirm clean output matches Step 1 baseline
- [ ] Visually confirm that the rename is complete by spot-checking a few formula field names in each context group

**Tests:**
- [ ] `cd tugdeck && bun run check` exits with code 0
- [ ] `cd tugdeck && bun test` pass/fail count matches Step 1 baseline exactly
- [ ] `cd tugdeck && bun run audit:tokens lint` exits with code 0

**Checkpoint:**
- [ ] `cd tugdeck && bun run check` passes
- [ ] `cd tugdeck && bun test` passes with same pass/fail count as baseline
- [ ] `cd tugdeck && bun run audit:tokens lint` passes

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All ~200 formula field names across `DerivationFormulas`, `ComputedTones`, `DARK_FORMULAS`, `LIGHT_FORMULAS`, and `derivation-rules.ts` use self-documenting four-slot names. Two dead fields deleted. Zero behavioral change.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `bun run check` passes with zero errors (verification: `cd tugdeck && bun run check`)
- [ ] `bun test` passes with identical results to pre-rename baseline (verification: `cd tugdeck && bun test`)
- [ ] `bun run audit:tokens lint` passes clean (verification: `cd tugdeck && bun run audit:tokens lint`)
- [ ] Zero old abbreviated field names remain in TypeScript source files (verification: exhaustive grep)
- [ ] Two dead fields (`outlinedBgHoverAlpha`, `outlinedBgActiveAlpha`) are removed (verification: grep confirms absence)

**Acceptance tests:**
- [ ] `cd tugdeck && bun run check` — zero TypeScript errors
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run audit:tokens lint` — clean output

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 4: Recipe clarity and generator improvements (builds on the renamed formula vocabulary)
- [ ] Update JSDoc `@semantic` group documentation if any groups were missed
- [ ] Consider generating a migration guide for external consumers (if any)

| Checkpoint | Verification |
|------------|--------------|
| TypeScript compiles | `cd tugdeck && bun run check` |
| Tests pass | `cd tugdeck && bun test` |
| Token audit clean | `cd tugdeck && bun run audit:tokens lint` |
| No old names remain | Grep sweep across `tugdeck/src/` |
