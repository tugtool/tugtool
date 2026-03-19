<!-- tugplan-skeleton v2 -->

## Phase 2: Fix the Contrast Engine {#contrast-engine-fix}

**Purpose:** Make `enforceContrastFloor` process ALL pairings including composited surfaces, validate every recipe in EXAMPLE_RECIPES via parameterized accessibility tests, and consolidate exception lists into a categorized shared module — producing documented Harmony failures as ground truth for Phase 3.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | plan/contrast-engine-fix |
| Last updated | 2026-03-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The theme-system-overhaul roadmap (Phase 1 and Phase 1.5 complete, PRs #138 and #139 merged) identified three structural gaps in the contrast engine (Problem 4 in `roadmap/theme-system-overhaul.md`): (1) missing pairings are not enforced — closed by Phase 1; (2) composited surfaces with `parentSurface` are skipped by `enforceContrastFloor` at line ~2440; (3) tests only validate dark mode (Brio). Phase 2 closes gaps 2 and 3, making the engine structurally complete for all pairings and all recipes.

The element-surface pairing map now has 339 entries (275 CSS-declared) with 48 `parentSurface` references covering badges, tone backgrounds, selection highlights, and similar semi-transparent tokens. These are the exact tokens the current `if (pairing.parentSurface) continue` skip leaves unenforced. Exception lists are scattered across 4 test files with duplicated entries, making it hard to distinguish design choices from Phase 3 bugs.

#### Strategy {#strategy}

- Implement two-pass contrast enforcement: pass 1 resolves all fully-opaque tokens (current behavior); pass 2 alpha-blends composited tokens over their `parentSurface` and enforces contrast against the composite.
- Replace T4.1 and T4.3 with a single parameterized loop over `Object.entries(EXAMPLE_RECIPES)` so adding a recipe automatically adds it to contrast validation. Retain T4.2 (brio-light) as a separate test since brio-light is a synthetic mode-flip variant, not a first-class `EXAMPLE_RECIPES` entry.
- Extract all exception sets (`KNOWN_PAIR_EXCEPTIONS`, `STEP5_GAP_PAIR_EXCEPTIONS`, `HARMONY_PAIR_EXCEPTIONS`, `LIGHT_MODE_PAIR_EXCEPTIONS`, `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS`, `INTENTIONALLY_BELOW_THRESHOLD`, `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS`) into a shared test helper module with inline categorization (design choice vs Phase 3 bug).
- Run expanded validation on Harmony, capture failures as documented ground truth for Phase 3.
- Use `audit-tokens.ts` as the PRIMARY discovery and verification tool for all pairing-related work. Per the roadmap mandate: "Every phase must use this tool — hours-long LLM-driven line-by-line investigation of CSS files is an anti-pattern." The coder-agent must NEVER grep through CSS files to find pairings, surfaces, or token usage — `bun run audit:tokens pairings` does that in under 100ms. Every step that touches CSS, tokens, or the pairing map must follow this workflow: make change, `bun run audit:tokens lint`, `bun run audit:tokens pairings` (verify zero unresolved), `bun run audit:tokens inject --apply` (if pairing map changed), `bun run audit:tokens verify`, `bun test`.

#### Success Criteria (Measurable) {#success-criteria}

- `enforceContrastFloor` processes all 339 pairing map entries including all 48 `parentSurface` entries (verified by: no `if (pairing.parentSurface) continue` in the engine; `bun run audit:tokens pairings` shows zero skipped composited pairings)
- Every key in `EXAMPLE_RECIPES` is validated by a parameterized test case (verified by: adding a new recipe key to `EXAMPLE_RECIPES` automatically includes it in contrast validation without any test code changes)
- Harmony light failures are captured in a documented exception list categorized as design choice or Phase 3 bug (verified by: the shared exception module contains each Harmony failure with an inline comment classifying it)
- Exception lists consolidated into a single shared module imported by all test files (verified by: `KNOWN_PAIR_EXCEPTIONS`, `STEP5_GAP_PAIR_EXCEPTIONS`, `HARMONY_PAIR_EXCEPTIONS`, `LIGHT_MODE_PAIR_EXCEPTIONS`, `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS`, `INTENTIONALLY_BELOW_THRESHOLD`, and `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` no longer defined inline in test files)
- `bun run audit:tokens lint` exits 0
- `bun run audit:tokens verify` exits 0
- `bun test` passes with zero unexpected failures

#### Scope {#scope}

1. Remove `parentSurface` skip from `enforceContrastFloor`; implement inline alpha-blending compositing in a two-pass approach
2. Replace T4.1/T4.3 with parameterized `Object.entries(EXAMPLE_RECIPES)` loop; retain T4.2 (brio-light synthetic variant) as separate test
3. Consolidate exception lists into shared test helper module with design-choice vs bug categorization
4. Document Harmony failures as Phase 3 ground truth
5. Verify all changes with audit tooling

#### Non-goals (Explicitly out of scope) {#non-goals}

- Fixing Harmony contrast failures (Phase 3 scope — independent recipe formulas)
- Reducing the effective parameter count or restructuring `DerivationFormulas` (Phase 4)
- Adding new recipes or modifying existing recipe formulas (beyond what is needed for compositing enforcement)
- Changing token naming conventions or the pairing map structure (Phase 1/1.5 complete)

#### Dependencies / Prerequisites {#dependencies}

- Phase 1 (token audit, PR #138) and Phase 1.5 (machine-auditable pairings, PR #139) are merged
- `audit-tokens.ts` with all 6 subcommands operational (`tokens`, `pairings`, `rename`, `inject`, `verify`, `lint`)
- `element-surface-pairing-map.ts` has 339 entries with `parentSurface` annotations on all composited pairings

#### Constraints {#constraints}

- Must not break existing Brio dark or Brio light test assertions
- The compositing math must match the approach used by `validateThemeContrast` in `theme-accessibility.ts`: composite in linear sRGB via `compositeOverSurface`, then convert back to OKLab L via `hexToOkLabL` — this ensures engine enforcement and post-hoc validation agree
- Alpha-blending must use standard over-compositing in linear sRGB (not OKLCH L space) for physical accuracy
- Exception categorization must be machine-parseable via grep/regex on source code (inline comments with `[design-choice]` or `[phase-3-bug]` tags — not runtime-accessible, but extractable by `grep '\[phase-3-bug\]' contrast-exceptions.ts`)

#### Assumptions {#assumptions}

- `bun run audit:tokens pairings` enumerates all `parentSurface` entries accurately — the pairing map is the source of truth, not manual grep
- The composited contrast check composites in linear sRGB (matching `compositeOverSurface` in `theme-accessibility.ts`) then converts the result to OKLab L via `hexToOkLabL` for contrast measurement
- Harmony failures (once the `parentSurface` skip is removed and the test loop expanded) will be captured as documented exceptions pointing to Phase 3 work, not silently suppressed
- Exception list categorization will use inline comments in the shared module (`[design-choice]` vs `[phase-3-bug]`)

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per the skeleton contract. All anchors are kebab-case, no phase numbers.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Two-pass compositing introduces ordering bugs or color-space mismatch | med | low | Use identical compositing path as validateThemeContrast (compositeOverSurface + hexToOkLabL); unit tests verify against manual calculation | Composited pairs produce unexpected contrast values or engine/validation disagree |
| Harmony failures are numerous and obscure Phase 3 scope | med | med | Categorize each failure with specific token pair and contrast delta | More than 30 Harmony-specific failures |
| Parameterized test loop masks recipe-specific regressions | low | low | Each recipe test case includes recipe name in failure messages | A regression is hard to attribute to a specific recipe |

**Risk R01: Compositing order dependency** {#r01-compositing-order}

- **Risk:** The second enforcement pass may depend on tokens that were adjusted in pass 1, creating ordering sensitivity if pass 1 adjustments change.
- **Mitigation:** Pass 2 reads from the fully-resolved `resolved` map after pass 1 completes. All opaque surfaces are final before composited pairs are processed. Unit test verifies pass 2 sees post-adjustment values.
- **Residual risk:** If a composited surface's `parentSurface` is itself composited (nested compositing), the two-pass approach would need extension. Current pairing map has no nested compositing — all `parentSurface` values are opaque surfaces.

**Risk R02: Harmony failure volume** {#r02-harmony-failure-volume}

- **Risk:** Removing the `parentSurface` skip and expanding to Harmony may surface many failures, making categorization labor-intensive.
- **Mitigation:** Use `validateThemeContrast` output programmatically to generate a structured failure report. Categorize by pattern (all badge-on-surface failures share the same root cause).
- **Residual risk:** Some failures may be ambiguous (design choice vs bug) without visual inspection. Default to `[phase-3-bug]` for ambiguous cases.

---

### Design Decisions {#design-decisions}

#### [D01] Two-pass enforcement for composited surfaces (DECIDED) {#d01-two-pass-enforcement}

**Decision:** Implement composited contrast enforcement as a second pass within `evaluateRules`, running after all opaque tokens are resolved in pass 1.

**Rationale:**
- Composited pairs depend on the resolved L value of their `parentSurface`, which must be final before alpha-blending can compute the effective surface L
- A single-pass approach would require topological sorting of token evaluation order, adding complexity without benefit since all `parentSurface` values in the current map are opaque surfaces
- The two-pass approach is explicit and testable: pass 1 is the existing behavior, pass 2 is a clean addition

**Implications:**
- The `if (pairing.parentSurface) continue` skip is replaced with collection into a `deferredCompositedPairings` array
- The deferred entry data structure is `{ tokenName: string, slotPrimaryName: string, hueRef: string, hueAngle: number, intensity: number, alpha: number, pairing: ElementSurfacePairing }` — capturing all data needed for both `enforceContrastFloor` (slot context) and `setChromatic` re-emission (hueRef, hueAngle, intensity, alpha). Without hueRef/hueAngle/intensity/alpha, pass 2 cannot update the `tokens` map string (e.g., `--tug-color(cobalt, i:22, t:65)`) after adjusting tone.
- **Critical timing:** Deferred entries are collected AFTER the inner pairing loop completes for each token (after `t = adjustedTone` updates), NOT inside the inner loop. This ensures that if pass 1 adjusts a token's tone for opaque surfaces (e.g., pushing from 50 to 60), pass 2 starts from the post-pass-1 tone (60), not the pre-adjustment tone (50). Pass 2 reads each token's final tone from a `finalToneMap` populated after pass 1 completes each token.
- After the main evaluation loop completes, pass 2 iterates deferred entries, composites via `compositeOverSurface` + `hexToOkLabL` per [D04], and calls `enforceContrastFloor` with the composited L
- After `enforceContrastFloor` returns an adjusted tone, pass 2 calls `setChromatic(tokenName, hueRef, hueAngle, intensity, adjustedTone, alpha, slotPrimaryName)` to atomically update both `tokens[name]` (CSS string) and `resolved[name]` (ResolvedColor). This is the same callback used in pass 1 and guarantees tokens and resolved stay consistent.

#### [D02] Parameterized recipe test loop (DECIDED) {#d02-parameterized-test-loop}

**Decision:** Replace the individual T4.1, T4.2, T4.3 test cases with a single `describe` block that iterates over `Object.entries(EXAMPLE_RECIPES)`, creating one `it()` case per recipe with the same exception logic.

**Rationale:**
- Adding a recipe to `EXAMPLE_RECIPES` must automatically add it to contrast validation with zero test code changes
- The current T4.1/T4.2/T4.3 pattern requires manually writing a new test for each recipe, which is error-prone and was the root cause of Harmony never being validated by the authoritative test
- A parameterized loop with recipe-name-keyed exception sets provides both automatic coverage and recipe-specific exception handling

**Implications:**
- T4.1 and T4.3 are replaced by the parameterized loop (one test case per `EXAMPLE_RECIPES` entry)
- T4.2 (brio-light) is retained as a separate test alongside the loop because brio-light is a synthetic variant (`{ ...EXAMPLE_RECIPES.brio, mode: "light" }`) — it is not a first-class `EXAMPLE_RECIPES` entry and tests the cross-mode behavior of the brio palette
- Exception sets are keyed by recipe name (e.g., `RECIPE_PAIR_EXCEPTIONS["brio"]`, `RECIPE_PAIR_EXCEPTIONS["harmony"]`)
- Each test case includes the recipe name in the `it()` description for clear failure attribution
- Stress tests (T4.3-stress through T4.7-stress) remain separate since they test custom recipes, not `EXAMPLE_RECIPES` entries

#### [D03] Shared exception module with categorization (DECIDED) {#d03-shared-exception-module}

**Decision:** Consolidate all exception sets into a new file `tugdeck/src/__tests__/contrast-exceptions.ts` with inline `[design-choice]` or `[phase-3-bug]` tags on every entry.

**Rationale:**
- Exception lists are currently duplicated across 4 test files (`theme-derivation-engine.test.ts`, `theme-accessibility.test.ts`, `contrast-dashboard.test.tsx`, `gallery-theme-generator-content.test.tsx`), making them hard to maintain and easy to diverge
- Categorization creates actionable ground truth for Phase 3: entries tagged `[phase-3-bug]` become the Phase 3 work list
- A shared module ensures all test files use the same authoritative exception data

**Implications:**
- New file: `tugdeck/src/__tests__/contrast-exceptions.ts`
- Exports: `KNOWN_PAIR_EXCEPTIONS`, `RECIPE_PAIR_EXCEPTIONS` (keyed by recipe name), `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS`, `INTENTIONALLY_BELOW_THRESHOLD` (element-token set from `theme-accessibility.test.ts` and `contrast-dashboard.test.tsx`), `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS`, `LIGHT_MODE_PAIR_EXCEPTIONS` (from T4.2's brio-light exceptions)
- Each entry has an inline comment: `// [design-choice] <reason>` or `// [phase-3-bug] <description>`
- All 4 test files import from this module instead of defining exceptions inline

#### [D04] Composite in linear sRGB to match validation (DECIDED) {#d04-composite-linear-srgb}

**Decision:** Compute composited surface color by alpha-blending in linear sRGB (matching the existing `compositeOverSurface` function in `theme-accessibility.ts`), then convert the composited hex to OKLab L via `hexToOkLabL` for contrast measurement.

**Rationale:**
- `validateThemeContrast` already composites via `compositeOverSurface` which blends in linear sRGB space, then calls `computePerceptualContrast` (which internally calls `hexToOkLabL`) on the composited hex
- If the engine enforced using a different compositing approach (e.g., blending directly in OKLCH L space), the engine and validation would disagree — the engine could over- or under-correct relative to what validation reports
- Linear sRGB blending is physically correct for light mixing; OKLCH L blending is a perceptual approximation that diverges for semi-transparent overlays with non-trivial chroma

**Implications:**
- Pass 2 must convert each `ResolvedColor` to linear sRGB (via `oklchToLinearSRGB` from `palette-engine.ts`) before blending
- The composited result is converted back to OKLab L via `hexToOkLabL` (the same function `validateThemeContrast` uses) to get the effective surface L for `contrastFromLValues`
- The engine imports `compositeOverSurface` and `hexToOkLabL` directly from `theme-accessibility.ts`. This does NOT create a circular dependency because `theme-accessibility.ts` only uses `import type` from the engine (type-only imports are erased at compile time and do not create runtime cycles).
- This adds a color space round-trip (OKLCH -> linear sRGB -> blend -> sRGB gamma -> hex -> OKLab L) but it runs only for the ~48 composited pairings per derivation, not all 339

---

### Specification {#specification}

#### Compositing Formula {#compositing-formula}

**Spec S01: Compositing in linear sRGB with OKLab L readout** {#s01-composite-l}

Given a semi-transparent surface token (resolved as `ResolvedColor` with `L`, `C`, `h`, `alpha`) rendered over an opaque parent surface (also `ResolvedColor`):

1. Convert both to linear sRGB via `oklchToLinearSRGB(L, C, h)`
2. Alpha-blend in linear sRGB: `r_out = alpha * r_token + (1 - alpha) * r_parent` (same for g, b)
3. Gamma-encode and convert to hex string (same as `compositeOverSurface`)
4. Convert composited hex to OKLab L via `hexToOkLabL(compositeHex)`

The contrast check then uses the composited OKLab L as the effective surface lightness:

```
compositeL = hexToOkLabL(compositeOverSurface(surfaceToken, parentSurface))
contrast = contrastFromLValues(elementL, compositeL)
```

Where `elementL` is the OKLab lightness of the foreground element token being checked against this composited surface. This matches exactly how `validateThemeContrast` measures composited pairs.

#### Two-Pass Evaluation Order {#two-pass-order}

**Spec S02: Enforcement pass structure** {#s02-two-pass}

**Pass 1 (existing):** Evaluate all rules. For each chromatic token with `alpha === 100` and pairing entries, enforce contrast floor against opaque surfaces only. Skip pairings where `pairing.parentSurface` is set (these are deferred to pass 2). Skip surfaces with `alpha < 1.0` (same as current behavior).

**Deferred entry collection:** For each token processed in pass 1, after the inner pairing loop completes and `t` reflects all pass-1 adjustments, record the token's final tone in a `finalToneMap: Map<string, number>`. Also, during the inner loop, when `pairing.parentSurface` is truthy, push `{ tokenName, slotPrimaryName, hueRef: slot.ref, hueAngle: slot.angle, intensity: i, alpha: a, pairing }` to `deferredCompositedPairings` and `continue`. The tone is NOT captured in the deferred entry — pass 2 reads it from `finalToneMap` to guarantee it reflects pass-1 adjustments.

**Pass 2 (new):** After all tokens are resolved, iterate over `deferredCompositedPairings`. For each deferred entry:
1. Look up the element's post-pass-1 tone from `finalToneMap[tokenName]`
2. Compute the element's L value: `elementL = toneToL(finalTone, entry.slotPrimaryName)`
3. Look up the surface token's `ResolvedColor` from `resolved[surface]` (has L, C, h, alpha)
4. Look up the parent surface's `ResolvedColor` from `resolved[parentSurface]` (opaque)
5. Compute `compositeL` per Spec S01: call `compositeOverSurface(surfaceResolved, parentResolved)` then `hexToOkLabL` on the result
6. Compute polarity from `elementL` vs `compositeL` (not raw surfaceL): `polarity = elementL > compositeL ? "lighter" : "darker"`
7. Check `contrastFromLValues(elementL, compositeL)` against the pairing's role threshold
8. If below threshold, call `enforceContrastFloor(finalTone, compositeL, threshold, polarity, slotPrimaryName)` to get `adjustedTone`
9. Call `setChromatic(tokenName, entry.hueRef, entry.hueAngle, entry.intensity, adjustedTone, entry.alpha, entry.slotPrimaryName)` to atomically update both `tokens[name]` (CSS string) and `resolved[name]` (ResolvedColor)
10. Update `finalToneMap.set(tokenName, adjustedTone)` so subsequent deferred entries for the same token see the most restrictive tone

**Note:** Pass 2 starts from the post-pass-1 tone, so its adjustments are strictly additive. If pass 1 pushed a token's tone from 50 to 60 for an opaque surface, pass 2 starts from 60 and may push further (e.g., to 65) for a composited surface. The most restrictive constraint wins.

#### Exception Module Structure {#exception-module-structure}

**Spec S03: Shared exception module exports** {#s03-exception-module}

File: `tugdeck/src/__tests__/contrast-exceptions.ts`

```typescript
// Global pair exceptions (apply to all recipes)
export const KNOWN_PAIR_EXCEPTIONS: Set<string>;

// Recipe-specific pair exceptions (keyed by recipe name)
export const RECIPE_PAIR_EXCEPTIONS: Record<string, Set<string>>;

// Element tokens known to be below threshold by design (derivation-engine tests)
export const KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS: Set<string>;

// Element tokens intentionally below threshold (theme-accessibility + contrast-dashboard tests)
export const INTENTIONALLY_BELOW_THRESHOLD: Set<string>;

// Light-mode pair exceptions (brio-light synthetic variant, T4.2)
export const LIGHT_MODE_PAIR_EXCEPTIONS: Set<string>;

// Light-mode body-text pair exceptions (for stress tests)
export const LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS: Set<string>;
```

Each entry in every `Set` has an inline comment:
```typescript
"--tug-base-fg-inverse|--tug-base-surface-screen", // [design-choice] fg-inverse is for on-fill text, not light surfaces
"--tug-base-fg-default|--tug-base-tab-bg-active",  // [phase-3-bug] card title text on active title bar; contrast ~73.6
```

#### Parameterized Test Structure {#parameterized-test-structure}

**Spec S04: Recipe validation loop** {#s04-recipe-loop}

```typescript
describe("recipe contrast validation", () => {
  for (const [name, recipe] of Object.entries(EXAMPLE_RECIPES)) {
    it(`${name}: 0 unexpected contrast failures`, () => {
      const output = deriveTheme(recipe);
      const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
      const recipeExceptions = RECIPE_PAIR_EXCEPTIONS[name] ?? new Set();
      // Filter: pass, marginal, known-below-threshold, global exception, recipe exception
      const unexpected = results.filter(r => {
        if (r.contrastPass) return false;
        // ... marginal, element, pair exception filters ...
        return true;
      });
      expect(unexpected).toEqual([]);
    });
  }
});
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/__tests__/contrast-exceptions.ts` | Shared exception module with categorized pair exceptions for all test files |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `KNOWN_PAIR_EXCEPTIONS` | export const | `contrast-exceptions.ts` | Consolidated from 4 test files (includes STEP5_GAP_PAIR_EXCEPTIONS) |
| `RECIPE_PAIR_EXCEPTIONS` | export const | `contrast-exceptions.ts` | Recipe-keyed exception map (brio, harmony) |
| `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` | export const | `contrast-exceptions.ts` | Moved from inline definition |
| `INTENTIONALLY_BELOW_THRESHOLD` | export const | `contrast-exceptions.ts` | Consolidated from theme-accessibility.test.ts and contrast-dashboard.test.tsx |
| `LIGHT_MODE_PAIR_EXCEPTIONS` | export const | `contrast-exceptions.ts` | Moved from T4.2 brio-light test |
| `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS` | export const | `contrast-exceptions.ts` | Moved from inline definition |
| `evaluateRules` (pass 2) | modified fn | `theme-derivation-engine.ts` | Added second pass for composited pairings; imports compositeOverSurface + hexToOkLabL from theme-accessibility.ts |
| `finalToneMap` | local Map | `theme-derivation-engine.ts` | Maps tokenName to post-pass-1 tone; populated after each token's inner loop completes |
| `deferredCompositedPairings` | local array | `theme-derivation-engine.ts` | Array of `{ tokenName, slotPrimaryName, hueRef, hueAngle, intensity, alpha, pairing }` for pass 2 |
| `enforceContrastFloor` (compositing) | modified call | `theme-derivation-engine.ts` | Called with composited L value in pass 2 |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify alpha-blending formula produces correct composited L values | Compositing math, edge cases (alpha=0, alpha=1) |
| **Integration** | Verify full derivation pipeline with composited enforcement for all recipes | Parameterized recipe loop, end-to-end contrast validation |
| **Drift Prevention** | Ensure adding a recipe automatically includes it in contrast validation | The parameterized loop test structure itself |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers — add an anchor and cite that instead.

#### Step 1: Create shared exception module {#step-1}

**Commit:** `refactor: extract contrast exceptions into shared test helper module`

**References:** [D03] Shared exception module with categorization, Spec S03, (#exception-module-structure, #strategy)

**Artifacts:**
- New file: `tugdeck/src/__tests__/contrast-exceptions.ts`
- Modified: `tugdeck/src/__tests__/theme-derivation-engine.test.ts` (remove inline exception definitions, import from shared module)
- Modified: `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` (import from shared module)
- Modified: `tugdeck/src/__tests__/theme-accessibility.test.ts` (import from shared module)
- Modified: `tugdeck/src/__tests__/contrast-dashboard.test.tsx` (import from shared module)

**Tasks:**
- [ ] Create `tugdeck/src/__tests__/contrast-exceptions.ts` exporting `KNOWN_PAIR_EXCEPTIONS`, `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS`, `INTENTIONALLY_BELOW_THRESHOLD`, `RECIPE_PAIR_EXCEPTIONS`, `LIGHT_MODE_PAIR_EXCEPTIONS`, and `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS`
- [ ] Move all entries from `KNOWN_PAIR_EXCEPTIONS` in `theme-derivation-engine.test.ts` into the shared module
- [ ] Move `HARMONY_PAIR_EXCEPTIONS` into `RECIPE_PAIR_EXCEPTIONS["harmony"]`
- [ ] Move `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` into the shared module
- [ ] Move `INTENTIONALLY_BELOW_THRESHOLD` from `theme-accessibility.test.ts` and `contrast-dashboard.test.tsx` into the shared module (these are the same set, currently duplicated)
- [ ] Move `LIGHT_MODE_PAIR_EXCEPTIONS` from T4.2 in `theme-derivation-engine.test.ts` into the shared module
- [ ] Move `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS` into the shared module
- [ ] Move `KNOWN_PAIR_EXCEPTIONS` from `gallery-theme-generator-content.test.tsx` to import from shared module
- [ ] Move `STEP5_GAP_PAIR_EXCEPTIONS` from `theme-accessibility.test.ts` and `contrast-dashboard.test.tsx` into the shared module (merge into `KNOWN_PAIR_EXCEPTIONS` since these are subsets)
- [ ] Add inline categorization comments: `[design-choice]` or `[phase-3-bug]` on every entry (machine-parseable via grep/regex on source code, not runtime-accessible)
- [ ] Update all 4 test files to import from `contrast-exceptions.ts`
- [ ] Run `bun run audit:tokens verify` to confirm pairing map consistency is maintained after modifying test files

**Tests:**
- [ ] All existing tests pass with imports redirected to shared module
- [ ] No inline exception set definitions remain in any test file (except stress test custom recipes)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens lint`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens verify`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 2: Implement two-pass composited contrast enforcement {#step-2}

**Depends on:** #step-1

**Commit:** `feat: enforce contrast floors for composited parentSurface pairings via two-pass evaluation`

**References:** [D01] Two-pass enforcement for composited surfaces, [D04] Composite in linear sRGB to match validation, Spec S01, Spec S02, Risk R01, (#compositing-formula, #two-pass-order)

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/theme-derivation-engine.ts` — `evaluateRules` function updated with pass 2; imports `compositeOverSurface` and `hexToOkLabL` from `theme-accessibility.ts`

**Tasks:**
- [ ] **Discovery first:** Run `bun run audit:tokens pairings` to enumerate ALL composited pairings (entries with `parentSurface`). Use this output — not grep — to identify the full set of ~48 pairings that pass 2 must handle. Record the element tokens, surface tokens, parent surfaces, and alpha values.
- [ ] Import `compositeOverSurface` and `hexToOkLabL` directly from `theme-accessibility.ts` into the engine. This is safe because `theme-accessibility.ts` only uses `import type` from the engine (erased at compile time), so no circular runtime dependency exists.
- [ ] In `evaluateRules`, replace the `if (pairing.parentSurface) continue` skip with collection into a `deferredCompositedPairings` array
- [ ] Define the deferred entry type: `{ tokenName: string, slotPrimaryName: string, hueRef: string, hueAngle: number, intensity: number, alpha: number, pairing: ElementSurfacePairing }` — this captures both the hue slot context for `enforceContrastFloor` and the emission parameters for `setChromatic` (needed to update both `tokens` and `resolved` atomically after tone adjustment). The tone is NOT stored here (see next task).
- [ ] Collection site: inside the inner pairing loop, when `pairing.parentSurface` is truthy, push `{ tokenName, slotPrimaryName: slot.primaryName, hueRef: slot.ref, hueAngle: slot.angle, intensity: i, alpha: a, pairing }` and `continue` (deferring to pass 2)
- [ ] **Critical: capture post-pass-1 tone.** After the inner pairing loop completes for each token (after `t = adjustedTone`), record `finalToneMap.set(tokenName, t)`. This ensures pass 2 reads the post-adjustment tone, not the pre-adjustment value. Tokens like `--tug-base-tone-success-fg` have both opaque and composited pairings — pass 1 may push tone from 50 to 60 for opaque surfaces, and pass 2 must start from 60.
- [ ] After the main evaluation loop completes (all tokens resolved), implement pass 2: iterate `deferredCompositedPairings`
- [ ] For each deferred entry: look up `finalToneMap.get(entry.tokenName)` for the starting tone, compute `elementL = toneToL(finalTone, entry.slotPrimaryName)`, then call `compositeOverSurface(resolved[pairing.surface], resolved[pairing.parentSurface])` to get composited hex, then `hexToOkLabL(compositeHex)` to get `compositeL` — matching exactly how `validateThemeContrast` measures composited pairs per [D04]
- [ ] Compute polarity from `elementL` vs `compositeL` (not raw surfaceL): `polarity = elementL > compositeL ? "lighter" : "darker"`
- [ ] Call `enforceContrastFloor(finalTone, compositeL, threshold, polarity, entry.slotPrimaryName)` to get `adjustedTone`
- [ ] After adjustment, call `setChromatic(tokenName, entry.hueRef, entry.hueAngle, entry.intensity, adjustedTone, entry.alpha, entry.slotPrimaryName)` to atomically update both `tokens[name]` (the CSS string like `--tug-color(cobalt, i:22, t:65)`) and `resolved[name]` (the ResolvedColor). Without this, tokens would encode the pre-pass-2 tone while resolved would be stale.
- [ ] If the element tone is adjusted, update the `resolved` map entry and add a diagnostic with `reason: "floor-applied"` and a note indicating composited enforcement
- [ ] Verify that the engine's compositing produces identical results to `validateThemeContrast` by using the exact same functions (`compositeOverSurface`, `hexToOkLabL`) — no reimplementation
- [ ] Add unit tests for the compositing math: alpha=0 (fully transparent, compositeL = parentL), alpha=1 (fully opaque, compositeL = tokenL), alpha=0.15 (typical badge), alpha=0.40 (selection)
- [ ] Run `bun run audit:tokens pairings` after implementation to verify all parentSurface entries are now processed (zero skipped composited pairings)

**Tests:**
- [ ] Unit test: compositeL calculation for alpha values 0.0, 0.15, 0.40, 1.0
- [ ] Unit test: `enforceContrastFloor` with composited surface L produces correct tone adjustment
- [ ] Unit test: after pass 2 tone adjustment, both `tokens[name]` (CSS string tone parameter) and `resolved[name].L` reflect the adjusted tone (verifies setChromatic re-emission)
- [ ] Integration test: `deriveTheme(EXAMPLE_RECIPES.brio)` still passes all existing assertions (pass 2 does not regress pass 1)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens lint`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens pairings` (verify zero unresolved, zero skipped composited pairings)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens verify`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 3: Replace T4.x with parameterized recipe loop {#step-3}

**Depends on:** #step-2

**Commit:** `feat: replace T4.1/T4.3 with parameterized EXAMPLE_RECIPES contrast validation loop`

**References:** [D02] Parameterized recipe test loop, [D03] Shared exception module with categorization, Spec S04, (#parameterized-test-structure, #success-criteria)

**Artifacts:**
- Modified: `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — T4.1 and T4.3 replaced by parameterized loop; T4.2 (brio-light) retained as separate test

**Tasks:**
- [ ] Remove T4.1 and T4.3 from the `derivation-engine integration` describe block
- [ ] Retain T4.2 (brio-light) as a separate test — brio-light is `{ ...EXAMPLE_RECIPES.brio, mode: "light" }`, a synthetic mode-flip variant, not a first-class recipe entry; update it to import exceptions from the shared module
- [ ] Add a new `describe("recipe contrast validation")` block that iterates `Object.entries(EXAMPLE_RECIPES)`
- [ ] For each recipe, create an `it()` case that: runs `deriveTheme(recipe)`, calls `validateThemeContrast`, filters unexpected failures using `KNOWN_PAIR_EXCEPTIONS`, `RECIPE_PAIR_EXCEPTIONS[name]`, `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS`, and the marginal delta
- [ ] Include recipe name in `it()` description and failure messages for clear attribution
- [ ] Preserve the `runFullPipeline` helper and the core readability assertions (fg-default on primary surfaces) — apply them per-recipe
- [ ] Carry forward the T4.1 focus indicator assertion (accent-cool-default on 9 focus surfaces at contrast 30) as a brio-specific check within the parameterized loop. Gate it with `if (name === "brio")` or use `RECIPE_SPECIFIC_CHECKS[name]` for extensibility. The focus indicator assertion is not applicable to all recipes (light-mode recipes have documented structural constraints on focus surfaces).
- [ ] Preserve the stress tests (T4.3-stress through T4.7-stress) unchanged — they test custom recipes, not `EXAMPLE_RECIPES`
- [ ] For token count: assert `Object.keys(output.tokens).length` is 373 per-recipe (tokens includes invariant tokens absent from resolved, so tokens and resolved have different sizes by design — do not assert equality between them)
- [ ] Ensure the `tokensAndResolvedConsistent` check is applied per-recipe

**Tests:**
- [ ] Parameterized loop creates one test case per `EXAMPLE_RECIPES` entry
- [ ] Brio dark passes with existing exception set
- [ ] Brio-light (T4.2) passes with `LIGHT_MODE_PAIR_EXCEPTIONS` from shared module
- [ ] Harmony light passes with combined exception set (global + harmony-specific)
- [ ] Verify that commenting out a recipe from `EXAMPLE_RECIPES` removes its test case (and restoring it re-adds it)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens lint`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens verify`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 4: Capture and document Harmony failures {#step-4}

**Depends on:** #step-3

**Commit:** `docs: document Harmony contrast failures as Phase 3 ground truth`

**References:** [D03] Shared exception module with categorization, Spec S03, Risk R02, (#context, #success-criteria)

**Artifacts:**
- Modified: `tugdeck/src/__tests__/contrast-exceptions.ts` — `RECIPE_PAIR_EXCEPTIONS["harmony"]` updated with all discovered failures
- Modified: inline comments documenting each Harmony failure with contrast value, threshold, and categorization

**Tasks:**
- [ ] Run the parameterized test loop and collect all Harmony failures (expected to fail initially)
- [ ] For each failure: record the token pair, the contrast value, the threshold, and the role
- [ ] **Cross-reference via tooling:** Run `bun run audit:tokens pairings` and use the output to confirm every Harmony failure traces to a real CSS rendering context (a CSS-declared pairing). Do NOT grep CSS files manually — the pairings subcommand does this in under 100ms.
- [ ] Categorize each failure:
  - `[design-choice]`: decorative pairs, same-hue borders, structural inversions (e.g., fg-inverse on light surface)
  - `[phase-3-bug]`: body-text or large-text pairs that fail due to LIGHT_FORMULAS being derived from dark via override spreading
- [ ] Add all categorized failures to `RECIPE_PAIR_EXCEPTIONS["harmony"]` in the shared exception module
- [ ] If any pairing map entries were added or modified during failure investigation, run `bun run audit:tokens inject --apply` to regenerate `@tug-pairings` blocks in affected CSS files
- [ ] Verify the parameterized test now passes for Harmony with the documented exceptions

**Tests:**
- [ ] Parameterized test passes for all recipes including Harmony (with documented exceptions)
- [ ] Every Harmony exception entry has an inline `[design-choice]` or `[phase-3-bug]` tag

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens lint`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens pairings` (verify zero unresolved)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens verify`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

#### Step 5: Final Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Two-pass enforcement, [D02] Parameterized test loop, [D03] Shared exception module, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify `enforceContrastFloor` processes all 339 pairing map entries (pass 1 handles opaque pairings, pass 2 handles all deferred composited pairings)
- [ ] Verify every `EXAMPLE_RECIPES` key has a corresponding parameterized test case
- [ ] Verify no inline exception definitions remain in test files (all imported from shared module)
- [ ] Verify every Harmony exception is categorized with `[design-choice]` or `[phase-3-bug]`
- [ ] Run the FULL audit-tokens workflow as the exit gate (this is the authoritative verification sequence from the roadmap):
  1. `bun run audit:tokens lint` — annotations and aliases still valid
  2. `bun run audit:tokens pairings` — zero unresolved pairings, zero skipped composited pairings
  3. `bun run audit:tokens verify` — map and CSS blocks in sync
  4. `bun test` — all tests pass

**Tests:**
- [ ] `bun test` passes for all recipes with composited enforcement active and exceptions consolidated

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens lint`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens pairings` (verify zero unresolved, zero skipped composited)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens verify`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A contrast engine that enforces floors on ALL pairings (including composited surfaces), validated by parameterized tests covering every built-in recipe, with exception lists consolidated and categorized as ground truth for Phase 3.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `enforceContrastFloor` processes all pairings including composited surfaces — no unhandled `parentSurface` skip (the only `parentSurface` + `continue` in the engine is the deferred-collection path that feeds pass 2; verify via `bun run audit:tokens pairings` showing 0 skipped composited pairings)
- [ ] Every `EXAMPLE_RECIPES` entry is validated by a parameterized accessibility test (`bun test` output shows one test case per recipe)
- [ ] Harmony light failures are documented in `contrast-exceptions.ts` with `[design-choice]` or `[phase-3-bug]` tags
- [ ] Exception lists consolidated — `KNOWN_PAIR_EXCEPTIONS` defined only in `contrast-exceptions.ts`
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun run audit:tokens verify` exits 0
- [ ] `bun test` passes

**Acceptance tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` — all pass
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens lint` — exit 0
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens verify` — exit 0

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 3: Build independent recipes — use the documented `[phase-3-bug]` exceptions as the work list
- [ ] Phase 4: Recipe clarity and generator improvements — reduce effective parameter count
- [ ] Consider adding compositing support for nested `parentSurface` chains (currently none exist in the pairing map)

| Checkpoint | Verification |
|------------|--------------|
| All pairings enforced | `bun run audit:tokens pairings` shows 0 skipped composited pairings; pass 2 processes all deferred entries |
| All recipes validated | `bun test` output shows one parameterized test per `EXAMPLE_RECIPES` key |
| Exceptions consolidated | `contrast-exceptions.ts` is the single source of truth |
| Tooling green | `bun run audit:tokens lint && bun run audit:tokens verify` both exit 0 |
