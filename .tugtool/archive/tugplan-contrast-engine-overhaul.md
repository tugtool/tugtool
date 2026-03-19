<!-- tugplan-skeleton v2 -->

## Contrast Engine Overhaul {#contrast-engine-overhaul}

**Purpose:** Replace the third-party contrast algorithm with an OKLab-based perceptual contrast metric, de-duplicate formula constants from per-role to emphasis-level fields, and make the derivation engine produce contrast-compliant tokens by construction — eliminating auto-fix.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | dev/contrast-engine-overhaul |
| Last updated | 2026-03-17 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The theme derivation engine generates 373 `--tug-base-*` tokens from a compact `ThemeRecipe`. Contrast checking currently uses a third-party algorithm (`computePerceptualContrast` in `theme-accessibility.ts`) that is a direct implementation of a restricted-license algorithm, using its proprietary constants (0.56, 0.57, 0.62, 0.65, 1.14, 0.027) and exponent (2.4). The `autoAdjustContrast` post-hoc fixer is structurally broken (3 bugs: ignores parentSurface compositing, tries to bump black/white/alpha tokens, can only adjust foregrounds). Meanwhile, the `DerivationFormulas` interface encodes tone/intensity values at the wrong granularity — per-role fields where emphasis-level fields would eliminate a large number of redundant fields.

These three problems are linked: replacing the algorithm establishes an unencumbered metric, de-duplicating formulas provides a clean data surface, and contrast-aware derivation uses both to produce compliant tokens by construction.

#### Strategy {#strategy}

- Replace the contrast algorithm first — swap proprietary internals with an OKLab L-based perceptual contrast function with polarity correction, calibrated against the Brio token set to preserve pass/fail boundaries
- De-duplicate formula constants second — consolidate `DerivationFormulas` from per-role fields to emphasis-level fields for outlined and ghost emphasis, add BASE_FORMULAS + override pattern
- Add contrast floor enforcement last — integrate contrast floors into the derivation engine's `evaluateRules` pass so tokens are compliant by construction, then repurpose the auto-fix UI to show diagnostics
- Each step produces a working system — no step leaves the build broken or tests failing
- Skip the terminology purge (Part 2 from roadmap) — already completed and merged to main

#### Success Criteria (Measurable) {#success-criteria}

- All existing contrast pass/fail boundaries are preserved after algorithm replacement (calibration test verifies rank-ordering invariant) (`bun test theme-accessibility`)
- Net reduction of at least 40 `DerivationFormulas` fields for outlined + ghost emphasis (exact count determined by pre-consolidation audit in Step 3)
- `bun run generate:tokens` produces identical token output before and after formula de-duplication (snapshot comparison)
- After contrast-aware derivation, `validateThemeContrast` reports 0 failures on Brio dark theme (`bun test theme-derivation-engine`)
- The auto-fix button is repurposed to display `ContrastDiagnostic` output instead of running `autoAdjustContrast`

#### Scope {#scope}

1. Replace `computePerceptualContrast` internals with OKLab L-based metric + polarity correction
2. Add `hexToOkLabL` helper derived from existing sRGB linearization path in `theme-accessibility.ts`
3. Calibrate CONTRAST_SCALE and POLARITY_FACTOR constants against Brio token set
4. Consolidate `DerivationFormulas` outlined and ghost fields from per-role to emphasis-level
5. Refactor `outlinedFgRules`, `ghostActionRules`, `ghostOptionRules` factories to read emphasis-level fields
6. Add BASE_FORMULAS + BRIO_DARK_OVERRIDES pattern for theme families
7. Add `enforceContrastFloor` in the derivation engine's `evaluateRules` pass
8. Add `ContrastDiagnostic` interface and structured diagnostic output
9. Remove or neuter `autoAdjustContrast`, repurpose its UI to show diagnostics

#### Non-goals (Explicitly out of scope) {#non-goals}

- Terminology purge (Part 2) — already completed
- Light mode recipe formulas — future work, but BASE_FORMULAS pattern enables it
- New contrast threshold categories beyond the existing five (body-text, large-text, subdued-text, ui-component, decorative)
- WCAG 2.x ratio changes — kept as informational display only

#### Dependencies / Prerequisites {#dependencies}

- Terminology purge must be complete (confirmed: already merged to main)
- Current test suite must pass before starting (`bun test`)
- `theme-accessibility.ts` already contains `srgbChannelToLinear` — reused by `hexToOkLabL` (no dependency on palette-engine for this conversion)

#### Constraints {#constraints}

- `bun run generate:tokens` must produce valid CSS after each step — no regressions in the generated token block
- All existing tests must continue to pass (with updated expectations where algorithm output changes)
- The OKLab L conversion must use the existing `srgbChannelToLinear` path already in `theme-accessibility.ts` for consistency

#### Assumptions {#assumptions}

- The `hexToOkLabL` helper will be implemented as a new function in `theme-accessibility.ts`, derived from the existing sRGB linearization path already present in that file
- The `ghostActionRules` and `ghostOptionRules` factories will be refactored in Step 3 in the same way as `outlinedFgRules` — reading emphasis-level fields instead of per-role fields
- The contrast floor enforcement will be added inside the derivation engine's `evaluateRules` pass, not as a separate post-processing phase, so it has access to already-computed surface tones
- Test files will be updated in each step to match renamed symbols and new behavior

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] POLARITY_FACTOR calibration precision (OPEN) {#q01-polarity-calibration}

**Question:** What is the exact POLARITY_FACTOR value after calibration against Brio dark tokens?

**Why it matters:** The roadmap suggests starting at 0.85 (~15% published disadvantage). The actual value will be determined by calibration in Step 1 to preserve current pass/fail boundaries.

**Options (if known):**
- 0.85 (starting point from published research)
- Adjusted value from calibration (likely 0.80-0.90 range)

**Plan to resolve:** Calibration test in Step 1 runs both old and new metrics on all Brio token pairs, finds the POLARITY_FACTOR that preserves rank ordering.

**Resolution:** OPEN — will be resolved during Step 1 calibration

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Calibration fails to preserve rank ordering | high | low | Binary search over POLARITY_FACTOR range; accept minor reordering if delta < 2 | Any pair flips pass/fail after calibration |
| Formula de-duplication breaks edge cases | med | med | Snapshot token output before/after; diff must be empty | `generate:tokens` output changes |
| Contrast floor clamping produces ugly tones | med | low | Diagnostic output shows all clamped tokens for manual review | Any token clamped by > 10 tone units |

**Risk R01: Rank-ordering invariant violation** {#r01-rank-ordering}

- **Risk:** The new OKLab L metric may reorder token pairs differently than the old algorithm, causing some currently-passing pairs to fail or vice versa.
- **Mitigation:**
  - Calibration test explicitly checks rank ordering across all Brio pairs
  - CONTRAST_SCALE is tuned to anchor fg-default at the body-text threshold
  - POLARITY_FACTOR is tuned to preserve negative-polarity pass/fail boundary
- **Residual risk:** Pairs near the threshold boundary (within CONTRAST_MARGINAL_DELTA) may shift classification

**Risk R02: Formula refactoring regression** {#r02-formula-regression}

- **Risk:** Consolidating per-role fields to emphasis-level fields could introduce subtle value mismatches if any role currently has a different value.
- **Mitigation:**
  - Verify all per-role values are identical before consolidation (pre-flight audit test in Step 3)
  - Snapshot `generate:tokens` output before and after, diff must be empty
- **Residual risk:** None if pre-consolidation audit is thorough

---

### Design Decisions {#design-decisions}

#### [D01] OKLab L-based perceptual contrast replaces third-party algorithm (DECIDED) {#d01-oklab-contrast}

**Decision:** Replace `computePerceptualContrast` internals with a function that computes OKLab L for each color via `hexToOkLabL`, takes the signed delta, and applies a polarity correction factor for light-on-dark pairs.

**Rationale:**
- OKLab L is the most perceptually uniform lightness channel available (0.20 RMSE vs 1.70 for CIELAB L*)
- Polarity correction is grounded in published vision science (Piepenbrock 2013, Whittle 1986)
- All inputs are from unencumbered public-domain / public-standard sources
- We already compute OKLab values in the palette engine

**Implications:**
- `computePerceptualContrast` keeps its public signature (two hex strings, returns signed number) but changes its internals entirely
- Old constants (NORMAL_BG_EXP, NORMAL_TXT_EXP, etc.) are removed
- New constants: CONTRAST_SCALE, POLARITY_FACTOR, CONTRAST_MIN_DELTA
- Threshold values (75, 60, 45, 30, 15) are recalibrated to the new scale

#### [D02] Emphasis-level formula fields replace per-role fields (DECIDED) {#d02-emphasis-level-formulas}

**Decision:** Consolidate `DerivationFormulas` from per-role fields (`outlinedActionFgRestTone`, `outlinedAgentFgRestTone`, `outlinedOptionFgRestTone`) to emphasis-level fields (`outlinedFgRestTone`). Factory functions read shared emphasis fields; role only determines which hue slot to use.

**Rationale:**
- 36 fields express 4 unique values — the formula varies by emphasis, not by role
- Eliminates the class of bug where duplicated formulas diverge
- Matches the existing pattern used by `filledRoleRules` and `badgeTintedRoleRules`, which already read emphasis-level fields

**Implications:**
- `outlinedFgRules` stops constructing dynamic role-specific field names; reads `outlinedFgRestTone` etc. directly
- `ghostActionRules` and `ghostOptionRules` are unified into a single `ghostFgRules` factory
- Per-role overrides remain as explicit exceptions: `outlinedOptionBorderRestTone` (option borders use neutral hue), ghost bg hue slot and alpha fields (sentinel dispatch differs per role, see Table T02)
- BRIO_DARK_FORMULAS shrinks by at least 40 fields (exact count determined by pre-consolidation audit)

#### [D03] BASE_FORMULAS + override pattern for theme families (DECIDED) {#d03-base-formulas}

**Decision:** Split `BRIO_DARK_FORMULAS` into `BASE_FORMULAS` (defaults shared across all recipes) and `BRIO_DARK_OVERRIDES` (fields that differ for Brio dark). Compose as `{ ...BASE_FORMULAS, ...BRIO_DARK_OVERRIDES }`.

**Rationale:**
- Makes the "what is default vs what is recipe-specific" distinction explicit
- Enables future theme families (dark/light/stark) to override only what differs
- Follows user direction: "BASE_FORMULAS holds defaults, BRIO_DARK_FORMULAS becomes { ...BASE_FORMULAS, ...BRIO_DARK_OVERRIDES }"

**Implications:**
- `BASE_FORMULAS` is a new exported const in `theme-derivation-engine.ts`
- `BRIO_DARK_OVERRIDES` is a new `Partial<DerivationFormulas>` const
- `BRIO_DARK_FORMULAS` becomes a computed const: `{ ...BASE_FORMULAS, ...BRIO_DARK_OVERRIDES }`
- Future light-mode recipes override only the fields that differ

#### [D04] Contrast floor enforcement in evaluateRules, not post-processing (DECIDED) {#d04-contrast-floor}

**Decision:** Add contrast floor enforcement inside the derivation engine's `evaluateRules` pass, where it has access to already-computed surface tones and the pairing map. This is not a separate post-processing phase.

**Rationale:**
- The engine already knows all surface tones at rule evaluation time
- Integrating into evaluateRules avoids the three bugs in autoAdjustContrast (parentSurface compositing, black/white/alpha tokens, foreground-only adjustment)
- Structurally fixed tokens (black, white, transparent, alpha < 100) are naturally excluded by checking token type

**Implications:**
- `evaluateRules` gains a contrast-floor enforcement pass after computing each foreground token's tone
- `enforceContrastFloor` is a new function that binary-searches in tone space for the minimum element tone meeting the threshold, using direct OKLab L comparison (no hex round-trip)
- The pairing map must be accessible during rule evaluation (passed as parameter or imported)
- `autoAdjustContrast` is no longer called; its UI is repurposed to show `ContrastDiagnostic` output

#### [D05] Repurpose auto-fix UI to show contrast diagnostics (DECIDED) {#d05-repurpose-autofix}

**Decision:** Instead of removing the auto-fix button entirely, repurpose it to display `ContrastDiagnostic` output showing floor-applied and structurally-fixed token information.

**Rationale:**
- Follows user direction: "show ContrastDiagnostic output (floor-applied / structurally-fixed) instead of fix action"
- Preserves the UI affordance for contrast information while removing the broken fix behavior
- Structured diagnostics are more useful than the current "unfixable" string list

**Implications:**
- `ContrastDiagnostic` interface replaces `unfixable: string[]` in the derivation output
- Gallery theme generator component shows diagnostic details instead of running auto-fix
- `autoAdjustContrast` function is retained but deprecated (or removed if no consumers remain)

---

### Specification {#specification}

#### Algorithm Specification {#algorithm-spec}

**Spec S01: computePerceptualContrast algorithm** {#s01-perceptual-contrast}

The new `computePerceptualContrast(elementHex, surfaceHex)` function:

1. Convert each hex color to OKLab L via `hexToOkLabL`:
   - Parse hex to sRGB [0,1] channels
   - Linearize via `srgbChannelToLinear` (IEC 61966-2-1)
   - Convert linear sRGB to OKLab L using the OKLab matrix (Ottosson 2020)
2. Compute `deltaL = surfaceL - elementL`
3. If `|deltaL| < CONTRAST_MIN_DELTA`, return 0
4. If `surfaceL > elementL` (positive polarity): return `deltaL * CONTRAST_SCALE`
5. Else (negative polarity): return `deltaL * CONTRAST_SCALE * POLARITY_FACTOR`

The result is a signed contrast score: positive for dark-on-light, negative for light-on-dark.

**Spec S02: hexToOkLabL conversion** {#s02-hex-to-oklab-l}

Convert a #rrggbb hex string to OKLab perceptual lightness:

1. Parse to sRGB [0,1] channels
2. Linearize each channel via `srgbChannelToLinear`
3. Apply OKLab matrix M1 to get linear LMS cone responses:
   - l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
   - m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
   - s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
4. Cube-root each: l_ = cbrt(l), m_ = cbrt(m), s_ = cbrt(s)
5. Compute L: `L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_`

**Spec S03: enforceContrastFloor function** {#s03-enforce-contrast-floor}

```typescript
function enforceContrastFloor(
  elementTone: number,
  surfaceL: number,
  threshold: number,
  polarity: "lighter" | "darker",
  elementHueName: string,
): number
```

Binary searches in **tone space** (0-100) for the minimum element tone that produces contrast >= threshold. Tone is the derivation engine's native unit -- `evaluateRules` computes tone values via rule expressions, then `resolveOklch` converts tone to OKLab L.

The `surfaceL` parameter is read directly from `resolved[surfaceToken].L` -- surfaces are already evaluated and stored in the resolved map before foreground tokens are processed. This avoids needing to recover surface tone and hue name.

**Conversion path (direct L comparison, no hex round-trip):** The binary search converts candidate element tones to OKLab L via the existing `toneToL(tone, hueName)` helper (which uses the hue's canonical L for the piecewise tone-to-L mapping). It then applies the contrast formula directly on the L values: `deltaL = surfaceL - elementL`, scaled by `CONTRAST_SCALE` and `POLARITY_FACTOR` as appropriate. This avoids the hex round-trip entirely -- the new metric is purely an OKLab L delta, so the intermediate hex conversion in `computePerceptualContrast` is unnecessary when we already have L values.

**Approximation gap:** `toneToL` is a piecewise linear approximation of the tone-to-OKLab-L relationship. The validation path (`validateThemeContrast`) converts OKLCH to hex (8-bit quantized) and then recovers L via `hexToOkLabL`. These two paths can produce slightly different L values due to hex quantization and chroma/hue affecting the hex output. A reconciliation test (in Step 4) verifies that every token clamped by `enforceContrastFloor` also passes when measured through the hex-path validation. If any discrepancy surfaces, the floor enforcement adds a small tone margin (e.g., 1 tone unit) to compensate.

Returns the adjusted tone, or the original tone if it already passes.

**Spec S04: ContrastDiagnostic interface** {#s04-contrast-diagnostic}

```typescript
interface ContrastDiagnostic {
  token: string;
  reason: "floor-applied" | "structurally-fixed" | "composite-dependent";
  surfaces: string[];
  initialTone: number;
  finalTone: number;
  threshold: number;
}
```

**Note:** The `ContrastResult.role` field is currently a 4-member union type (`"body-text" | "large-text" | "ui-component" | "decorative"`) that is missing `"subdued-text"`. The `CONTRAST_THRESHOLDS` record includes all five categories (body-text, subdued-text, large-text, ui-component, decorative) and the pairing map assigns `"subdued-text"` roles, but the union silently widens to `string` at the assignment site. Step 4 adds a task to expand the `ContrastResult.role` union to include `"subdued-text"` so the type is correct and exhaustive.

#### Formula De-duplication Specification {#formula-dedup-spec}

**Table T01: Outlined emphasis field consolidation** {#t01-outlined-consolidation}

| Before (per-role) | After (emphasis-level) | Value (Brio dark) |
|---|---|---|
| outlinedActionFgRestTone, outlinedAgentFgRestTone, outlinedOptionFgRestTone | outlinedFgRestTone (rename existing `outlinedFgTone` for per-state consistency) | 100 |
| outlinedActionFgHoverTone, outlinedAgentFgHoverTone, outlinedOptionFgHoverTone | outlinedFgHoverTone (new) | 100 |
| outlinedActionFgActiveTone, outlinedAgentFgActiveTone, outlinedOptionFgActiveTone | outlinedFgActiveTone (new) | 100 |
| outlinedActionFgRestI ... outlinedOptionFgActiveI (9 fields) | outlinedFgI (already exists) | 2 |
| outlinedActionIconRestTone ... outlinedOptionIconActiveTone (9 fields) | outlinedIconRestTone, outlinedIconHoverTone, outlinedIconActiveTone (new) | 100 |
| outlinedActionIconRestI ... outlinedOptionIconActiveI (9 fields) | outlinedIconI (new) | 2 |
| outlinedActionFgRestToneLight ... outlinedOptionIconActiveToneLight (18 fields) | outlinedFgRestToneLight, outlinedFgHoverToneLight, outlinedFgActiveToneLight, outlinedIconRestToneLight, outlinedIconHoverToneLight, outlinedIconActiveToneLight (6 fields) | 0 |

**Table T02: Ghost emphasis field consolidation** {#t02-ghost-consolidation}

| Before (per-role) | After (emphasis-level) | Value (Brio dark) |
|---|---|---|
| ghostActionFgTone, ghostOptionFgTone | ghostFgTone (new) | value from current |
| ghostActionFgI, ghostOptionFgI | ghostFgI (new) | value from current |
| ghostActionFg{Rest,Hover,Active}Tone (6), ghostOptionFg{Rest,Hover,Active}Tone (6) | ghostFg{Rest,Hover,Active}Tone (3) | per-state values |
| ghostActionFg{Rest,Hover,Active}I (6), ghostOptionFg{Rest,Hover,Active}I (6) | ghostFg{Rest,Hover,Active}I (3) | per-state values |
| ghostActionIcon* (6), ghostOptionIcon* (6) | ghostIcon* (6) | per-state values |
| ghostActionBorderI/Tone, ghostOptionBorderI/Tone | ghostBorderI/Tone (2) | values from current |
| ghostActionFg*ToneLight (3+3), ghostOptionFg*ToneLight (3+3) | ghostFg*ToneLight (3) | light-mode values |
| ghostActionFg*ILight (3+3), ghostOptionFg*ILight (3+3) | ghostFg*ILight (3) | light-mode values |
| ghostActionIcon*ToneLight (3+3), ghostOptionIcon*ToneLight (3+3) | ghostIcon*ToneLight (3) | light-mode values |
| ghostActionIcon*ILight (1+1) | ghostIconActiveILight (1) | light-mode value |

**Ghost bg hue slot and alpha fields — kept as per-role exceptions:**

The ghost bg hover/active tokens use sentinel-dispatched hue slots (`ghostActionBgHoverHueSlot`, `ghostOptionBgHoverHueSlot`) and per-role alpha values (`ghostActionBgHoverAlpha`, `ghostOptionBgHoverAlpha`, etc.). These fields remain per-role because:

- The bg hue slots dispatch to different sentinels per role in dark vs light mode (e.g., `__highlight` for action, `__shadow` for option in certain modes)
- The alpha values may differ between action and option (different visual weight)
- This matches the same pattern as `outlinedOptionBorderRules()` — an explicit per-role exception where the roles genuinely differ

The `ghostFgRules` factory signature accepts `bgHoverHueSlot` and `bgActiveHueSlot` parameters to pass the per-role sentinel hue slot, plus per-role alpha formula field names. Ghost-danger rules remain a separate factory entirely (it uses `destructive` hue slot with inline intensity/tone expressions, not sentinel dispatch).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| None | All changes are to existing files |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `hexToOkLabL` | fn | `theme-accessibility.ts` | New: hex to OKLab L conversion |
| `CONTRAST_SCALE` | const | `theme-accessibility.ts` | Replaces old perceptual contrast constants |
| `POLARITY_FACTOR` | const | `theme-accessibility.ts` | New: light-on-dark polarity correction |
| `CONTRAST_MIN_DELTA` | const | `theme-accessibility.ts` | Replaces `DELTA_MIN` |
| `computePerceptualContrast` | fn | `theme-accessibility.ts` | Modified: new algorithm internals |
| `toneToL` | fn | `theme-accessibility.ts` | Modified: promoted from private to public export (was `_toneToL` test-only) |
| `enforceContrastFloor` | fn | `theme-derivation-engine.ts` | New: binary search in tone space for minimum passing tone (uses direct L comparison via `toneToL`, no hex round-trip) |
| `ContrastDiagnostic` | interface | `theme-derivation-engine.ts` | New: structured diagnostic output |
| `BASE_FORMULAS` | const | `theme-derivation-engine.ts` | New: default formula values |
| `BRIO_DARK_OVERRIDES` | const | `theme-derivation-engine.ts` | New: Brio-dark-specific overrides |
| `BRIO_DARK_FORMULAS` | const | `theme-derivation-engine.ts` | Modified: composed from BASE + OVERRIDES |
| `ghostFgRules` | fn | `derivation-rules.ts` | New: replaces ghostActionRules + ghostOptionRules |
| `outlinedFgRules` | fn | `derivation-rules.ts` | Modified: reads emphasis-level fields |
| `autoAdjustContrast` | fn | `theme-accessibility.ts` | Deprecated/neutered |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `hexToOkLabL`, `computePerceptualContrast`, `enforceContrastFloor` in isolation | Steps 1, 2, 4 |
| **Calibration** | Verify rank-ordering invariant between old and new metrics | Step 2 |
| **Pre-flight audit** | Programmatic assertion that per-role values are identical before consolidation | Step 3 |
| **Golden / Snapshot** | Compare `generate:tokens` output before/after formula changes | Step 3 |
| **Integration** | Full `deriveTheme` + `validateThemeContrast` with 0 failures | Step 4 |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add hexToOkLabL helper and calibration test infrastructure {#step-1}

**Commit:** `feat(theme): add hexToOkLabL helper and calibration test`

**References:** [D01] OKLab L-based contrast, Spec S02 (#s02-hex-to-oklab-l), (#algorithm-spec)

**Artifacts:**
- New `hexToOkLabL` function in `theme-accessibility.ts`
- New calibration test in `theme-accessibility.test.ts`

**Tasks:**
- [ ] Implement `hexToOkLabL(hex: string): number` in `theme-accessibility.ts` using the OKLab M1 matrix (Spec S02)
- [ ] Reuse `srgbChannelToLinear` already in the file for linearization
- [ ] Add unit tests for `hexToOkLabL`: black (#000000) should return ~0.0, white (#ffffff) should return ~1.0, mid-gray should return ~0.53
- [ ] Add calibration test infrastructure: run current `computePerceptualContrast` on all Brio token pairs, store results as baseline

**Tests:**
- [ ] `hexToOkLabL` returns expected L values for known colors (black, white, mid-gray, Brio fg-default, Brio bg-app)
- [ ] Calibration baseline captures all Brio pair contrast values

**Checkpoint:**
- [ ] `cd tugdeck && bun test theme-accessibility`

---

#### Step 2: Replace computePerceptualContrast algorithm {#step-2}

**Depends on:** #step-1

**Commit:** `feat(theme): replace contrast algorithm with OKLab L + polarity correction`

**References:** [D01] OKLab L-based contrast, Spec S01 (#s01-perceptual-contrast), Risk R01 (#r01-rank-ordering), [Q01] POLARITY_FACTOR calibration

**Artifacts:**
- Modified `computePerceptualContrast` in `theme-accessibility.ts`
- Removed old constants (NORMAL_BG_EXP, NORMAL_TXT_EXP, REVERSE_BG_EXP, REVERSE_TXT_EXP, LOW_CLIP, LUMINANCE_EXPONENT)
- Removed `perceptualGamma` and `perceptualLuminance` helper functions
- New constants: CONTRAST_SCALE, POLARITY_FACTOR, CONTRAST_MIN_DELTA

**Tasks:**
- [ ] Remove old constants: NORMAL_BG_EXP, NORMAL_TXT_EXP, REVERSE_BG_EXP, REVERSE_TXT_EXP, CONTRAST_SCALE (old value 1.14), LOW_CLIP, DELTA_MIN, LUMINANCE_EXPONENT
- [ ] Remove `perceptualGamma` and `perceptualLuminance` helper functions
- [ ] Add new constants: CONTRAST_SCALE (calibrated), POLARITY_FACTOR (starting at 0.85), CONTRAST_MIN_DELTA
- [ ] Rewrite `computePerceptualContrast` body per Spec S01: use `hexToOkLabL` for both inputs, compute signed deltaL, apply polarity correction for negative polarity
- [ ] Run calibration test: tune CONTRAST_SCALE so fg-default/bg-app score matches body-text threshold region, tune POLARITY_FACTOR to preserve negative-polarity pass/fail boundary
- [ ] Assert rank-ordering invariant: no pair that currently passes should fail, no pair that currently fails should pass
- [ ] Update existing `computePerceptualContrast` tests with new expected values
- [ ] Document the calibrated constants with JSDoc referencing the scientific sources

**Tests:**
- [ ] Calibration test: both metrics produce same rank ordering on all Brio pairs
- [ ] `computePerceptualContrast` returns positive for dark-on-light, negative for light-on-dark
- [ ] `computePerceptualContrast` returns 0 when deltaL < CONTRAST_MIN_DELTA
- [ ] White-on-black and black-on-white produce maximum-magnitude scores
- [ ] Negative polarity scores have smaller magnitude than positive polarity for same deltaL (polarity correction)

**Checkpoint:**
- [ ] `cd tugdeck && bun test theme-accessibility`
- [ ] `cd tugdeck && bun run generate:tokens` succeeds (no build errors)

---

#### Step 3: Consolidate DerivationFormulas to emphasis-level fields {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(theme): consolidate DerivationFormulas to emphasis-level fields`

**References:** [D02] Emphasis-level formulas, [D03] BASE_FORMULAS + overrides, Table T01 (#t01-outlined-consolidation), Table T02 (#t02-ghost-consolidation), Risk R02 (#r02-formula-regression)

**Artifacts:**
- Modified `DerivationFormulas` interface in `theme-derivation-engine.ts` — at least 40 fewer fields
- Modified `BRIO_DARK_FORMULAS` — composed from `BASE_FORMULAS` + `BRIO_DARK_OVERRIDES`
- Modified `outlinedFgRules` in `derivation-rules.ts` — reads emphasis-level fields
- New `ghostFgRules` in `derivation-rules.ts` — unified factory replacing `ghostActionRules` + `ghostOptionRules`
- New pre-consolidation audit test in `theme-derivation-engine.test.ts`

**Tasks:**
- [ ] **Pre-flight audit (before any interface changes):** Add a programmatic assertion test that iterates `BRIO_DARK_FORMULAS` and verifies all outlined-action/agent/option fg/icon tone and intensity fields have identical values (Table T01), and ghost-action/option fg/icon/border fields have identical values (Table T02). If any differ, the test fails with the differing field names and values. This test replaces a manual audit and documents exceptions.
- [ ] **Light-field consumer audit:** Grep `derivation-rules.ts` and `theme-derivation-engine.ts` for all references to `*ToneLight` and `*ILight` fields. Document which rule expressions read them (the `outlinedFgRules` factory reads them via dynamic field name construction: `outlined${capitalRole}Fg${state}ToneLight`). Confirm these are only read by the unified per-state fields that will replace them, and that no other code path reads them directly. If a mode-dispatch expression reads them separately from the unified fields, document it as an exception.
- [ ] Capture `bun run generate:tokens` output as the pre-consolidation baseline snapshot
- [ ] Remove per-role outlined fg/icon fields from `DerivationFormulas` interface: `outlinedActionFgRestTone`, `outlinedAgentFgRestTone`, `outlinedOptionFgRestTone` (and all Hover/Active/I variants). Rename existing `outlinedFgTone` to `outlinedFgRestTone` for per-state naming consistency with the new `outlinedFgHoverTone` and `outlinedFgActiveTone` fields. Keep existing `outlinedFgI` as-is (it already serves as the shared intensity). Add new `outlinedIconRestTone`, `outlinedIconHoverTone`, `outlinedIconActiveTone`, `outlinedIconI`.
- [ ] Remove per-role outlined light-mode fields — replaced by `outlinedFgRestToneLight`, `outlinedFgHoverToneLight`, `outlinedFgActiveToneLight`, `outlinedIconRestToneLight`, `outlinedIconHoverToneLight`, `outlinedIconActiveToneLight`
- [ ] Remove per-role ghost fg/icon/border fields — replaced by emphasis-level `ghostFgTone`, `ghostFgI`, `ghostFg{Rest,Hover,Active}Tone`, `ghostFg{Rest,Hover,Active}I`, `ghostIcon*`, `ghostBorderI`, `ghostBorderTone`, and their light-mode variants. Ghost bg hue slot and alpha fields remain per-role (Table T02 exceptions).
- [ ] Refactor `outlinedFgRules` to read emphasis-level fields directly instead of constructing dynamic `outlined${capitalRole}Fg${state}Tone` field names
- [ ] Create unified `ghostFgRules(role, hueSlot, bgHoverHueSlot, bgActiveHueSlot)` factory that accepts per-role bg sentinel hue slot and alpha formula field names as parameters. Remove `ghostActionRules()` and `ghostOptionRules()`.
- [ ] Retain `outlinedOptionBorderRules()` as an explicit per-role override (it reads option-specific border fields)
- [ ] Create `BASE_FORMULAS` const with sensible defaults for all emphasis-level fields
- [ ] Create `BRIO_DARK_OVERRIDES: Partial<DerivationFormulas>` with only the fields that differ from defaults
- [ ] Redefine `BRIO_DARK_FORMULAS = { ...BASE_FORMULAS, ...BRIO_DARK_OVERRIDES }`
- [ ] Update `EXAMPLE_RECIPES.brio.formulas` reference if needed
- [ ] Update test files to use new field names; remove the pre-flight audit test (it served its purpose)

**Tests:**
- [ ] Pre-flight audit test passes before consolidation (all per-role values are identical within emphasis groups)
- [ ] `bun run generate:tokens` output matches pre-consolidation baseline snapshot exactly
- [ ] All existing derivation engine tests pass with updated field names
- [ ] Net field reduction is at least 40 (verified by counting interface fields before and after)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens` output is identical to pre-consolidation snapshot

---

#### Step 4: Add enforceContrastFloor to evaluateRules {#step-4}

**Depends on:** #step-3

**Commit:** `feat(theme): add contrast floor enforcement to derivation engine`

**References:** [D04] Contrast floor in evaluateRules, Spec S03 (#s03-enforce-contrast-floor), Spec S04 (#s04-contrast-diagnostic)

**Artifacts:**
- New `enforceContrastFloor` function in `theme-derivation-engine.ts`
- New `ContrastDiagnostic` interface in `theme-derivation-engine.ts`
- Modified `evaluateRules` to apply contrast floors after computing foreground tones
- Modified `ThemeOutput` to include `diagnostics: ContrastDiagnostic[]`

**Tasks:**
- [ ] Implement `enforceContrastFloor(elementTone, surfaceL, threshold, polarity, elementHueName): number` — binary search in tone space using direct OKLab L comparison via `toneToL` for the element and `surfaceL` read from the resolved map. See Spec S03 for the conversion path.
- [ ] Add `ContrastDiagnostic` interface (Spec S04)
- [ ] Modify `evaluateRules` to accept the pairing map and apply contrast floors:
  - After computing each chromatic token's tone value (before `setChromatic` call), look up all surfaces it is paired against in the pairing map
  - For each paired surface, read `surfaceL` directly from `resolved[surfaceToken].L` (surfaces are already evaluated and stored in the `resolved` map by this point in the rule iteration). Convert `elementTone` to `elementL` via `toneToL(elementTone, elementHueName)`. Apply the contrast formula on L values directly to check the threshold.
  - Take the most restrictive requirement and clamp the tone if needed
  - Pass the clamped tone to `setChromatic`
  - Record a `ContrastDiagnostic` entry for each clamped token
  - **Rule ordering prerequisite:** The RULES table in `derivation-rules.ts` must evaluate surface tokens before foreground tokens. Verify this ordering holds (it does today: SURFACE_RULES precedes FG_RULES, CONTROL_RULES, etc.).
- [ ] Skip structurally fixed tokens: type "structural", type "shadow", type "highlight", and any token with alpha < 1.0
- [ ] Add `diagnostics: ContrastDiagnostic[]` to `ThemeOutput`
- [ ] Import the pairing map in `evaluateRules` or pass it as a parameter
- [ ] Export `toneToL` from `theme-accessibility.ts` as a proper public export (currently private with a test-only `_toneToL` wrapper). `enforceContrastFloor` in `theme-derivation-engine.ts` needs it for the tone-to-L conversion in the binary search. Remove the `_toneToL` test-only export once the proper export exists.
- [ ] Expand `ContrastResult.role` union in `theme-derivation-engine.ts` to include `"subdued-text"`: change from `"body-text" | "large-text" | "ui-component" | "decorative"` to `"body-text" | "subdued-text" | "large-text" | "ui-component" | "decorative"`

**Tests:**
- [ ] `enforceContrastFloor` returns original tone when already passing
- [ ] `enforceContrastFloor` returns adjusted tone when below threshold
- [ ] `validateThemeContrast` on Brio dark reports 0 failures after derivation with contrast floors
- [ ] `diagnostics` array is populated for tokens that were floor-clamped
- [ ] Structurally fixed tokens (black, white, transparent, alpha) are not clamped
- [ ] **Reconciliation test:** For every token where `diagnostics` reports `"floor-applied"`, run `computePerceptualContrast` (hex path) on the clamped token against each of its paired surfaces and verify `|contrast| >= threshold`. This catches any gap between the `toneToL` approximation used by `enforceContrastFloor` and the hex-path L used by `validateThemeContrast`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens`

---

#### Step 5: Neuter autoAdjustContrast and repurpose UI {#step-5}

**Depends on:** #step-4

**Commit:** `feat(theme): repurpose auto-fix UI to show contrast diagnostics`

**References:** [D05] Repurpose auto-fix UI, Spec S04 (#s04-contrast-diagnostic), (#success-criteria)

**Artifacts:**
- Modified `gallery-theme-generator-content.tsx` — auto-fix button shows diagnostics
- Modified `gallery-theme-generator-content.css` — updated styles if needed
- Modified `autoAdjustContrast` — deprecated with JSDoc annotation

**Tasks:**
- [ ] Add `@deprecated` JSDoc annotation to `autoAdjustContrast` with rationale
- [ ] Modify gallery theme generator component (`gallery-theme-generator-content.tsx`): replace auto-fix button action with diagnostic display
- [ ] Show `ContrastDiagnostic` entries from `ThemeOutput.diagnostics`:
  - "floor-applied" entries show token, initial tone, final tone, threshold
  - "structurally-fixed" entries show token and surfaces
- [ ] Remove the `unfixable` display since it is superseded by diagnostics
- [ ] Update `theme-accessibility.test.ts`: remove or update tests that call `autoAdjustContrast` directly, replace with tests verifying the deprecated annotation and that the function still compiles
- [ ] Update `theme-derivation-engine.test.ts`: remove tests that invoke `autoAdjustContrast` via the derivation pipeline, replace with tests verifying `ThemeOutput.diagnostics` is populated
- [ ] Update `cvd-preview-auto-fix.test.tsx`: read the file first to understand its coupling to `autoAdjustContrast`, then remove or update tests referencing auto-fix behavior, verify diagnostic display integration
- [ ] Update `gallery-theme-generator-content.test.tsx`: update to test diagnostic display instead of fix button

**Tests:**
- [ ] Gallery component renders diagnostic output instead of fix button
- [ ] Diagnostic display shows floor-applied and structurally-fixed entries
- [ ] No reference to `autoAdjustContrast` result in the rendering path
- [ ] All four test files compile and pass: `theme-accessibility.test.ts`, `theme-derivation-engine.test.ts`, `cvd-preview-auto-fix.test.tsx`, `gallery-theme-generator-content.test.tsx`

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bun run generate:tokens`
- [ ] Grep for removed constants (NORMAL_BG_EXP, NORMAL_TXT_EXP, perceptualGamma, perceptualLuminance) returns 0 matches in `tugdeck/src/`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The theme derivation engine uses an unencumbered OKLab L-based contrast metric with polarity correction, consolidates formula constants to emphasis-level fields, and produces contrast-compliant tokens by construction with structured diagnostics.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `computePerceptualContrast` uses OKLab L with polarity correction, no third-party algorithm constants remain (`grep` verification)
- [ ] Calibration test confirms rank-ordering invariant between old and new metrics (`bun test theme-accessibility`)
- [ ] `DerivationFormulas` has at least 40 fewer per-role fields, replaced by emphasis-level fields (interface inspection)
- [ ] `BRIO_DARK_FORMULAS` is composed from `BASE_FORMULAS` + `BRIO_DARK_OVERRIDES`
- [ ] `validateThemeContrast` reports 0 contrast failures on Brio dark theme (`bun test theme-derivation-engine`)
- [ ] Gallery UI shows `ContrastDiagnostic` output instead of auto-fix action
- [ ] `bun run generate:tokens` produces valid CSS (`bun run generate:tokens`)

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `cd tugdeck && bun run generate:tokens` — no errors, valid output

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Light mode recipe with `LIGHT_OVERRIDES` on top of `BASE_FORMULAS`
- [ ] "Stark" profile with higher contrast thresholds
- [ ] Remove `autoAdjustContrast` entirely once no consumers remain
- [ ] Audit inline constants in `deriveTheme()` — every numeric constant should be in `DerivationFormulas` or a named constant

| Checkpoint | Verification |
|------------|--------------|
| Algorithm replaced | `grep -r "NORMAL_BG_EXP\|NORMAL_TXT_EXP\|perceptualGamma\|perceptualLuminance" tugdeck/src/` returns 0 matches |
| Rank ordering preserved | Calibration test passes in `theme-accessibility.test.ts` |
| Formulas consolidated | `DerivationFormulas` interface has emphasis-level fields, not per-role fields |
| Zero contrast failures | `validateThemeContrast` on Brio dark returns all `contrastPass: true` |
| Diagnostics displayed | Gallery theme generator shows `ContrastDiagnostic` output |
