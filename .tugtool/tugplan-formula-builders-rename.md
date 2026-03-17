<!-- tugplan-skeleton v2 -->

## Named Formula Builders + Recipe Rename {#formula-builders-rename}

**Purpose:** Extract ~22 distinct formula patterns from `derivation-rules.ts` into named builder functions and rename `BRIO_DARK_FORMULAS`/`BRIO_DARK_OVERRIDES` to `DARK_FORMULAS`/`DARK_OVERRIDES`. Token output must be identical before and after.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | formula-builders-rename |
| Last updated | 2026-03-17 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `derivation-rules.ts` file (1383 lines) inlines formula expressions in every rule entry. The same expression (e.g., `{ type: "chromatic", hueSlot: "txt", intensityExpr: filledFgI, toneExpr: lit(100) }`) appears in multiple token entries within factory functions, and each factory is called multiple times across roles. Analysis from `roadmap/semantic-formula-architecture.md` shows these 158 chromatic rules reduce to ~22 distinct mathematical formulas — the rest are role-multiplied copies.

Additionally, the names `BRIO_DARK_FORMULAS` and `BRIO_DARK_OVERRIDES` conflate the theme identity ("Brio" = dark recipe + cobalt/violet/indigo palette) with the recipe identity ("Dark"). The recipe is simply "Dark" — any color palette fed through it produces a dark theme. Renaming makes the architecture ready for a future Light recipe.

#### Strategy {#strategy}

- Capture a golden token snapshot before any code changes to guarantee output identity
- Add a local type alias `type F = DerivationFormulas` at the top of `derivation-rules.ts` for concise builder signatures
- Extract named builder functions organized by semantic role: surface, filledFg, outlinedFg, borderRamp, filledBg, semanticTone, badgeTinted, and others
- Simplify factory functions to become pure token-name generators that reference builders instead of inlining expressions
- Rename `BRIO_DARK_FORMULAS` to `DARK_FORMULAS` and `BRIO_DARK_OVERRIDES` to `DARK_OVERRIDES` across all files
- Update `BASE_FORMULAS` alias to point to `DARK_FORMULAS`
- Verify token output identity after each step via `bun run generate:tokens` + diff

#### Success Criteria (Measurable) {#success-criteria}

- `bun run generate:tokens` produces byte-identical CSS output before and after the refactor (verified by diffing `tug-base.css`)
- All existing tests pass: `cd tugdeck && bun test` with zero failures
- `BRIO_DARK_FORMULAS` and `BRIO_DARK_OVERRIDES` appear zero times in the codebase (verified by grep)
- `DARK_FORMULAS` and `DARK_OVERRIDES` are exported from `theme-derivation-engine.ts` and used in all call sites
- Each of the ~22 distinct formula patterns is defined exactly once as a named builder function in `derivation-rules.ts`
- Factory functions (`filledRoleRules`, `outlinedFgRules`, `ghostFgRules`, etc.) reference builders instead of inlining expressions

#### Scope {#scope}

1. Named formula builder extraction in `derivation-rules.ts`
2. Factory function simplification to use builders
3. Rename `BRIO_DARK_FORMULAS` → `DARK_FORMULAS` and `BRIO_DARK_OVERRIDES` → `DARK_OVERRIDES` in `theme-derivation-engine.ts`
4. Update all imports and references in test files
5. Update `deriveTheme()` fallback call sites

#### Non-goals (Explicitly out of scope) {#non-goals}

- Semantic layer annotations (`@semantic` JSDoc tags) — that is Part 2
- Restructuring `DerivationFormulas` interface field ordering — that is Part 3
- Annotating `DARK_FORMULAS` values with design rationale comments — that is Part 4
- Creating a Light recipe — that is Part 5
- Moving any code to new files; all builders remain in `derivation-rules.ts`

#### Dependencies / Prerequisites {#dependencies}

- `roadmap/semantic-formula-architecture.md` Part 1 spec (complete)
- Current `derivation-rules.ts` (1383 lines, 373 tokens)
- `theme-derivation-engine.ts` exports `BRIO_DARK_FORMULAS`, `BASE_FORMULAS`, `BRIO_DARK_OVERRIDES`

#### Constraints {#constraints}

- Token output must be byte-identical before and after (zero behavioral change)
- All builders must remain in `derivation-rules.ts` (no new files)
- `bun` must be used for all JS/TS operations (never npm)

#### Assumptions {#assumptions}

- The two fallback call sites in `deriveTheme()` (`recipe.formulas ?? BRIO_DARK_FORMULAS`) will be updated to `?? DARK_FORMULAS` as part of the rename
- `BASE_FORMULAS` stays as an alias pointing to `DARK_FORMULAS` after the rename
- `EXAMPLE_RECIPES.brio` keeps its name unchanged; its `formulas` field becomes `{ ...BASE_FORMULAS, ...DARK_OVERRIDES }`
- Named builders are defined at module scope in `derivation-rules.ts`, above the rule tables that reference them
- The `generate:tokens` script (`bun run generate:tokens`) will be run after the refactor to verify token output is identical

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors on all headings and stable labels for decisions, specs, tables, and lists per the skeleton contract.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token output drift | high | low | Golden snapshot diff at every step | Any `bun run generate:tokens` diff |
| Missed rename site | med | low | Full codebase grep for old names in final step | Test failure referencing old name |
| Builder signature mismatch | med | low | TypeScript compiler catches type errors | `bun test` type errors |

**Risk R01: Token output drift** {#r01-token-drift}

- **Risk:** A builder function subtly changes evaluation order or closure behavior, producing different token values.
- **Mitigation:** Capture golden snapshot of `tug-base.css` before changes. Diff after each step. `bun run generate:tokens` is the authoritative check.
- **Residual risk:** Floating-point edge cases are theoretically possible but practically eliminated by the snapshot diff.

---

### Design Decisions {#design-decisions}

#### [D01] Local type alias for concise builder signatures (DECIDED) {#d01-type-alias}

**Decision:** Add `type F = DerivationFormulas` at the top of `derivation-rules.ts` for use in builder function signatures.

**Rationale:**
- Builder functions reference `keyof DerivationFormulas` frequently; `keyof F` is more readable
- The alias is file-local (not exported), so it does not affect the public API

**Implications:**
- All builder parameter types use `keyof F` instead of `keyof DerivationFormulas`

#### [D02] Full rename without re-exports (DECIDED) {#d02-full-rename}

**Decision:** Rename `BRIO_DARK_FORMULAS` → `DARK_FORMULAS` and `BRIO_DARK_OVERRIDES` → `DARK_OVERRIDES` in all files. Update all test imports and assertions to use the new names. No backward-compatible re-exports.

**Rationale:**
- The old names conflate theme identity with recipe identity
- Re-exports add confusion and dead code; a clean rename is simpler
- All consumers are internal (no external API)

**Implications:**
- Every import of `BRIO_DARK_FORMULAS` or `BRIO_DARK_OVERRIDES` must be updated
- Test assertion strings and comments referencing old names must be updated

#### [D03] Extract all border builders including ramp (DECIDED) {#d03-border-builders}

**Decision:** Extract border rules to named builders (`borderRest`, `borderHover`, `borderActive`) using the `borderRamp` factory as shown in the spec's Border intensity ramp section.

**Rationale:**
- Border intensity ramp (`signalI + offset`) is one of the most duplicated formulas
- The `borderRamp(offset)` higher-order function captures the pattern cleanly
- Three border states (rest/hover/active) with offsets 5/15/25 are used across filled and outlined factories

**Implications:**
- `filledRoleRules` border entries use `borderRest(hueSlot)`, `borderHover(hueSlot)`, `borderActive(hueSlot)`
- `outlinedFgRules` border entries use the same builders
- The filled `border-active` rule uses `lit(90)` intensity and `filledBgActiveTone` tone — the same parameters as `filledBgActive`, so it can reuse `filledBgActive(hueSlot)` rather than the border ramp

#### [D04] Builders defined at module scope above rule tables (DECIDED) {#d04-builder-placement}

**Decision:** Named builder functions are defined at module scope in `derivation-rules.ts`, between the existing `lit()` / `signalIExpr()` helpers and the first rule table constant.

**Rationale:**
- Builders must be available to all factory functions and direct rule table entries
- Module scope avoids closure issues and makes builders testable if needed later
- Placing them above rule tables follows the existing pattern (helpers before consumers)

**Implications:**
- The file grows by ~80-120 lines of builder definitions but shrinks by more through deduplication in factories

---

### Specification {#specification}

#### Builder Function Inventory {#builder-inventory}

**Table T01: Named Formula Builders** {#t01-builders}

| Builder | Signature | Semantic Role | Used In |
|---------|-----------|--------------|---------|
| `surface` | `(hueSlot: string, iField: keyof F, toneKey: keyof ComputedTones) => ChromaticRule` | Surface at per-token hue slot (bgApp, surfaceSunken, etc.), formula-field I, computed tone | `SURFACE_RULES` |
| `filledFg` | `() => ChromaticRule` | Filled control fg/icon: txt hue, computed `Math.max(1, txtI - 1)`, literal tone 100 | `filledRoleRules` |
| `outlinedFg` | `(iField: keyof F, toneField: keyof F) => ChromaticRule` | Outlined control fg/icon: txt hue, formula-field reads for I and tone | `outlinedFgRules` |
| `borderRamp` | `(offset: number) => (hueSlot: string) => ChromaticRule` | Border at role hue, signalI+offset | `filledRoleRules`, `outlinedFgRules` |
| `borderRest` | `(hueSlot: string) => ChromaticRule` | `borderRamp(5)` | Factories |
| `borderHover` | `(hueSlot: string) => ChromaticRule` | `borderRamp(15)` | Factories |
| `borderActive` | `(hueSlot: string) => ChromaticRule` | `borderRamp(25)` | Factories |
| `filledBg` | `(intensity: number, toneField: keyof F) => (hueSlot: string) => ChromaticRule` | Filled bg at role hue | `filledRoleRules` |
| `filledBgRest` | `(hueSlot: string) => ChromaticRule` | `filledBg(50, "filledBgDarkTone")` | Factories |
| `filledBgHover` | `(hueSlot: string) => ChromaticRule` | `filledBg(55, "filledBgHoverTone")` | Factories |
| `filledBgActive` | `(hueSlot: string) => ChromaticRule` | `filledBg(90, "filledBgActiveTone")` | Factories |
| `semanticTone` | `(alpha?: number) => (hueSlot: string) => ChromaticRule` | Semantic signal at signalI, t:50 | `semanticToneFamilyRules` |
| `badgeTinted` | `(iField: keyof F, toneField: keyof F, alphaField?: keyof F) => (hueSlot: string) => ChromaticRule` | Badge at role hue | `badgeTintedRoleRules` |
| `signalRamp` | `(offset: number) => (hueSlot: string) => ChromaticRule` | signalI+offset at role hue, t:50 | `ghostDangerRules` |
| `signalRampAlpha` | `(offset: number, alpha: number) => (hueSlot: string) => ChromaticRule` | signalI+offset at role hue, t:50, fixed alpha | `ghostDangerRules` (border-hover a:40, border-active a:60) |
| `outlinedBg` | `(iField: keyof F, toneKey: keyof ComputedTones, alphaField: keyof F) => (hueSlot: string) => ChromaticRule` | Outlined bg-hover/active: sentinel hue, formula I, computed tone, formula alpha | `outlinedFgRules` |
| `ghostBg` | `(alphaExpr: Expr) => (hueSlot: string) => ChromaticRule` | Ghost bg: zero intensity, zero tone, callback alpha (sentinel hue slot) | `ghostFgRules` |
| `formulaField` | `(hueSlot: string, iField: keyof F, toneField: keyof F) => ChromaticRule` | Generic formula-field read | Various one-off rules |

Note: The exact builder inventory may be refined during implementation as the ~22 distinct patterns are cataloged. The implementer should expect to discover additional builders beyond this table — particularly for one-off patterns in direct rule tables (SURFACE_RULES, FOREGROUND_RULES, etc.). **This plan's Table T01 is authoritative for builder signatures.** The roadmap spec (`roadmap/semantic-formula-architecture.md`) contains illustrative examples that do not always match the actual code (e.g., it shows `controlFg("filledFgI", "filledFgTone")` but neither field exists in `DerivationFormulas`). When the plan and roadmap diverge, follow this plan. `badgeTinted` and `formulaField` are kept as separate builders despite similar signatures because they serve distinct semantic roles and have different currying patterns (badgeTinted is curried over hueSlot for role-multiplied factories; formulaField takes hueSlot directly).

#### Rename Mapping {#rename-mapping}

**Table T02: Rename Mapping** {#t02-rename}

| Old Name | New Name | File(s) |
|----------|----------|---------|
| `BRIO_DARK_FORMULAS` | `DARK_FORMULAS` | `theme-derivation-engine.ts`, test files |
| `BRIO_DARK_OVERRIDES` | `DARK_OVERRIDES` | `theme-derivation-engine.ts`, test files |
| `BASE_FORMULAS = BRIO_DARK_FORMULAS` | `BASE_FORMULAS = DARK_FORMULAS` | `theme-derivation-engine.ts` |
| `recipe.formulas ?? BRIO_DARK_FORMULAS` | `recipe.formulas ?? DARK_FORMULAS` | `theme-derivation-engine.ts` (2 call sites) |
| `recipe.formulas ?? BRIO_DARK_FORMULAS` | `recipe.formulas ?? DARK_FORMULAS` | `theme-derivation-engine.test.ts` (2 call sites) |
| `{ ...BASE_FORMULAS, ...BRIO_DARK_OVERRIDES }` | `{ ...BASE_FORMULAS, ...DARK_OVERRIDES }` | `theme-derivation-engine.ts` (`EXAMPLE_RECIPES.brio`) |

**List L01: Files requiring rename updates** {#l01-rename-files}

- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — definition and all internal references
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — imports, assertions, and comments
- `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` — comment referencing old name

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Golden / Contract** | Byte-identical CSS token output before and after | Every step — primary safety net |
| **Unit** | Existing test suite passes unchanged (modulo rename) | After builder extraction, after rename |
| **Drift Prevention** | Grep for old names to confirm complete rename | Final verification step |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Capture golden token snapshot {#step-1}

**Commit:** `test: capture golden token snapshot for formula builder refactor`

**References:** [D01] Local type alias, Risk R01 (#r01-token-drift), (#success-criteria)

**Artifacts:**
- Golden copy of `tug-base.css` saved to a temporary location for diffing

**Tasks:**
- [ ] Run `cd tugdeck && bun run generate:tokens` to ensure current tokens are up to date
- [ ] Copy `tugdeck/styles/tug-base.css` to `tugdeck/styles/tug-base.css.golden`
- [ ] Add `*.golden` to `tugdeck/styles/.gitignore` (or `tugdeck/.gitignore`) to prevent accidental commit of the snapshot file
- [ ] Run `cd tugdeck && bun test` to confirm all tests pass at baseline

**Tests:**
- [ ] `cd tugdeck && bun test` passes at baseline (confirms no pre-existing failures)

**Checkpoint:**
- [ ] `bun run generate:tokens` exits 0
- [ ] `bun test` exits 0 with all tests passing
- [ ] Golden snapshot file exists

---

#### Step 2: Extract named formula builders {#step-2}

**Depends on:** #step-1

**Commit:** `refactor: extract named formula builders in derivation-rules.ts`

**References:** [D01] Local type alias, [D03] Extract all border builders, [D04] Builder placement, Table T01 (#t01-builders), (#builder-inventory)

**Artifacts:**
- New builder functions at module scope in `derivation-rules.ts`
- `type F = DerivationFormulas` alias at top of file

**Tasks:**
- [ ] Add `ComputedTones` to the type import from `theme-derivation-engine.ts` (needed by `surface` builder signature which references `keyof ComputedTones`)
- [ ] Add `type F = DerivationFormulas` after the existing imports
- [ ] Catalog all distinct formula patterns by reading each factory function and rule table
- [ ] Define named builder functions between the helpers section and the first rule table:
  - `surface(hueSlot, iField, toneKey)` — surface at per-token hue slot (bgApp, surfaceSunken, etc.) with formula-field I and computed tone
  - `filledFg()` — filled control fg/icon: txt hue, computed `Math.max(1, txtI - 1)` intensity, literal tone 100
  - `outlinedFg(iField, toneField)` — outlined control fg/icon: txt hue, formula-field reads for I and tone
  - `borderRamp(offset)` → `borderRest`, `borderHover`, `borderActive`
  - `filledBg(intensity, toneField)` → `filledBgRest`, `filledBgHover`, `filledBgActive`
  - `semanticTone(alpha?)` — semantic signal at signalI, t:50
  - `badgeTinted(iField, toneField, alphaField?)` — badge at role hue
  - `signalRamp(offset)` — signalI+offset at role hue, t:50 (for ghost-danger fg/icon)
  - `signalRampAlpha(offset, alpha)` — signalI+offset at role hue, t:50, fixed alpha (for ghost-danger border-hover/active)
  - `outlinedBg(iField, toneKey, alphaField)` — outlined bg-hover/active with formula I, computed tone, formula alpha
  - `ghostBg(alphaExpr)` — ghost bg: zero intensity/tone, callback alpha for sentinel hue slots
  - Additional builders as discovered during pattern catalog
- [ ] Verify TypeScript compilation: `cd tugdeck && bunx tsc --noEmit`

**Tests:**
- [ ] TypeScript compiles with no errors

**Checkpoint:**
- [ ] `bunx tsc --noEmit` exits 0
- [ ] No changes to token output: `bun run generate:tokens && diff tugdeck/styles/tug-base.css tugdeck/styles/tug-base.css.golden` shows no differences

---

#### Step 3: Simplify factory functions to use builders {#step-3}

**Depends on:** #step-2

**Commit:** `refactor: simplify factory functions to reference named builders`

**References:** [D03] Extract all border builders, [D04] Builder placement, Table T01 (#t01-builders), (#strategy)

**Artifacts:**
- Modified `filledRoleRules()` — uses `filledBgRest`, `filledBgHover`, `filledBgActive`, `filledFg`, `borderRest`, `borderHover`
- Modified `outlinedFgRules()` — uses `borderRest`, `borderHover`, `borderActive`, `outlinedFg` for fg/icon fields
- Modified `outlinedOptionBorderRules()` — uses a distinct builder or inline pattern for txtISubtle-based neutral borders
- Modified `semanticToneFamilyRules()` — uses `semanticTone`
- Modified `ghostFgRules()` and `ghostDangerRules()` — uses `signalRamp` and related builders
- Modified `badgeTintedRoleRules()` — uses `badgeTinted`
- Modified direct rule table entries where patterns match builders

**Tasks:**
- [ ] Replace inlined expressions in `filledRoleRules()` with builder calls per the spec's factory simplification example
- [ ] Replace inlined expressions in `outlinedFgRules()` with builder calls
- [ ] Replace inlined expressions in `outlinedOptionBorderRules()` with builder calls (distinct pattern: txtISubtle-based neutral borders with formula tone fields)
- [ ] Replace inlined expressions in `semanticToneFamilyRules()` with `semanticTone` builder calls
- [ ] Replace inlined expressions in `ghostFgRules()` and `ghostDangerRules()` with builder calls
- [ ] Replace inlined expressions in `badgeTintedRoleRules()` with `badgeTinted` builder calls
- [ ] Review direct rule table entries (SURFACE_RULES, FOREGROUND_RULES, etc.) for opportunities to use builders
- [ ] Verify TypeScript compilation: `cd tugdeck && bunx tsc --noEmit`

**Tests:**
- [ ] TypeScript compiles with no errors
- [ ] All existing tests pass: `cd tugdeck && bun test`

**Checkpoint:**
- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0 with all tests passing
- [ ] Token output identical: `bun run generate:tokens && diff tugdeck/styles/tug-base.css tugdeck/styles/tug-base.css.golden` shows no differences

---

#### Step 4: Rename BRIO_DARK_FORMULAS and BRIO_DARK_OVERRIDES {#step-4}

**Depends on:** #step-3

**Commit:** `refactor: rename BRIO_DARK_FORMULAS to DARK_FORMULAS and BRIO_DARK_OVERRIDES to DARK_OVERRIDES`

**References:** [D02] Full rename without re-exports, Table T02 (#t02-rename), List L01 (#l01-rename-files)

**Artifacts:**
- `theme-derivation-engine.ts`: `DARK_FORMULAS`, `DARK_OVERRIDES` exports; `BASE_FORMULAS = DARK_FORMULAS`; fallback sites updated
- `theme-derivation-engine.test.ts`: all imports and assertions updated
- `gallery-theme-generator-content.test.tsx`: comment updated

**Tasks:**
- [ ] In `theme-derivation-engine.ts`:
  - Rename `BRIO_DARK_FORMULAS` → `DARK_FORMULAS` (definition and all references)
  - Rename `BRIO_DARK_OVERRIDES` → `DARK_OVERRIDES` (definition and all references)
  - Update `BASE_FORMULAS` alias: `export const BASE_FORMULAS: DerivationFormulas = DARK_FORMULAS`
  - Update `EXAMPLE_RECIPES.brio.formulas`: `{ ...BASE_FORMULAS, ...DARK_OVERRIDES }`
  - Update both `deriveTheme()` fallback sites: `recipe.formulas ?? DARK_FORMULAS`
  - Update all comments and JSDoc referencing old names
- [ ] In `theme-derivation-engine.test.ts`:
  - Update import statement: `DARK_FORMULAS`, `DARK_OVERRIDES` instead of old names
  - Update all assertion references and comments (approximately 60 occurrences)
- [ ] In `gallery-theme-generator-content.test.tsx`:
  - Update comment referencing `BRIO_DARK_FORMULAS`

**Tests:**
- [ ] TypeScript compiles with no errors: `bunx tsc --noEmit`
- [ ] All tests pass: `cd tugdeck && bun test`

**Checkpoint:**
- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0 with all tests passing
- [ ] Token output identical: `bun run generate:tokens && diff tugdeck/styles/tug-base.css tugdeck/styles/tug-base.css.golden`
- [ ] `grep -r "BRIO_DARK_FORMULAS\|BRIO_DARK_OVERRIDES" tugdeck/src/` returns zero matches

---

#### Step 5: Final Verification {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D02] Full rename, [D03] Border builders, Risk R01 (#r01-token-drift), (#success-criteria)

**Tasks:**
- [ ] Run full test suite: `cd tugdeck && bun test`
- [ ] Regenerate tokens: `bun run generate:tokens`
- [ ] Diff against golden snapshot to confirm byte-identical output: `diff tugdeck/styles/tug-base.css tugdeck/styles/tug-base.css.golden`
- [ ] Grep entire codebase for old names: `grep -r "BRIO_DARK_FORMULAS\|BRIO_DARK_OVERRIDES" tugdeck/`
- [ ] Verify `DARK_FORMULAS` and `DARK_OVERRIDES` are properly exported: `grep "export.*DARK_FORMULAS\|export.*DARK_OVERRIDES" tugdeck/src/components/tugways/theme-derivation-engine.ts`

**Tests:**
- [ ] `cd tugdeck && bun test` — full suite passes after all changes
- [ ] Token output diff shows zero differences

**Checkpoint:**
- [ ] `bun test` exits 0 with all tests passing
- [ ] `bun run generate:tokens && diff tugdeck/styles/tug-base.css tugdeck/styles/tug-base.css.golden` shows no differences
- [ ] Zero grep hits for old names in `tugdeck/src/`
- [ ] `DARK_FORMULAS` and `DARK_OVERRIDES` are exported
- [ ] Remove golden snapshot file after all checks pass

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** `derivation-rules.ts` uses named formula builders with each distinct formula defined exactly once, and `BRIO_DARK_FORMULAS`/`BRIO_DARK_OVERRIDES` are renamed to `DARK_FORMULAS`/`DARK_OVERRIDES` across the codebase. Token output is byte-identical before and after.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `bun run generate:tokens` produces byte-identical CSS output vs. pre-refactor baseline
- [ ] `bun test` passes with zero failures in `tugdeck/`
- [ ] Zero occurrences of `BRIO_DARK_FORMULAS` or `BRIO_DARK_OVERRIDES` in `tugdeck/src/`
- [ ] Each distinct formula pattern in `derivation-rules.ts` is defined exactly once as a named builder

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run generate:tokens` — tokens regenerate successfully
- [ ] `diff` of `tug-base.css` before and after shows zero differences

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Part 2: Semantic layer annotations (`@semantic` JSDoc tags on `DerivationFormulas` fields)
- [ ] Part 3: Restructure `DerivationFormulas` field ordering by semantic group
- [ ] Part 4: Annotate `DARK_FORMULAS` values with design rationale comments
- [ ] Part 5: Create a Light recipe from a prompt

| Checkpoint | Verification |
|------------|--------------|
| Token output identity | `bun run generate:tokens && diff tug-base.css tug-base.css.golden` |
| Test suite green | `cd tugdeck && bun test` |
| Complete rename | `grep -r "BRIO_DARK" tugdeck/src/` returns 0 hits |
| Builder deduplication | Manual review: each formula pattern appears once as a builder |
