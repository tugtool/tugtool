## Refactor Theme Derivation Engine to Formula-Based Mode Presets {#mode-preset-formulas}

**Purpose:** Make the theme derivation engine authoritative for all `--tug-base-*` tokens by introducing a mode preset system that exactly reproduces the hand-authored Brio dark-mode CSS, then replaces those hand-maintained tokens with engine-generated output.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugplan/mode-preset-formulas |
| Last updated | 2026-03-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The theme derivation engine (`theme-derivation-engine.ts`) currently produces 350 tokens via inline formulas calibrated against Bluenote (now removed). The hand-authored Brio CSS in `tug-base.css` body{} is the ground truth for dark mode. The engine's formulas were calibrated to the midpoint of Brio/Bluenote at `surfaceContrast=50`, which means the Brio recipe (with default `surfaceContrast=50`) does not reproduce the exact hand-authored Brio token values. For example, surface tones are computed from `darkBgApp = 8 + (50/100)*10 = 13` (matching Bluenote), but Brio's hand-authored bg-app uses `t: 5`.

The gap between engine output and hand-authored CSS means both must be maintained separately. This plan closes that gap: reverse-engineer the Brio token values into parameterized formulas organized by mode preset, verify exact match, then delete the hand-maintained tokens and let the generation script be the single source of truth.

#### Strategy {#strategy}

- Audit every chromatic token in tug-base.css body{} and record the exact `--tug-color()` string as the "Brio ground truth" fixture
- Compare engine output to the fixture, identifying every mismatch in hue, intensity, tone, and alpha
- Correct engine formulas group-by-group (surfaces, foreground, borders, accents, controls, etc.) by directly replacing inline constants and formula expressions with Brio-matching values. Steps 2-4 modify the existing code in place -- no preset indirection yet
- After formulas match, introduce a `ModePreset` type that bundles the mode-specific formula parameters (tone anchors, intensity levels, surface spreads) into a named preset (Step 6)
- Wire the dark-mode preset into `deriveTheme()` so the existing code paths use preset parameters instead of inline computations
- Add a light-mode preset stub with current light-mode formulas (correctness deferred to follow-on)
- Once the engine matches Brio exactly, replace the hand-maintained token block in tug-base.css with a unified `@generated:tokens` region
- Update the generation script to use the unified region markers

#### Success Criteria (Measurable) {#success-criteria}

- For every chromatic token in tug-base.css body{}, `deriveTheme(EXAMPLE_RECIPES.brio).tokens[tokenName]` produces the exact same `--tug-color()` string (verified by a new test T-BRIO-MATCH)
- The generation script (`bun run generate:tokens`) produces output that, when spliced into tug-base.css, results in a byte-identical file (verified by running the script and checking `git diff`)
- All existing tests pass (`bun test`) with no regressions
- tug-base.css body{} has a single `@generated:tokens:begin` / `@generated:tokens:end` region covering all 350 tokens (no hand-maintained chromatic tokens remain)

#### Scope {#scope}

1. Audit and correct all engine formulas for the Brio dark-mode recipe
2. Introduce `ModePreset` type and dark-mode preset
3. Add light-mode preset stub (wrapping current light-mode formulas, not audited for correctness)
4. Unify tug-base.css body{} into a single generated region
5. Add exact-match test (T-BRIO-MATCH)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Light-mode formula accuracy audit (deferred -- current light-mode formulas are preserved as-is in the light preset stub)
- Stark-mode presets (dark-stark, light-stark) -- not needed yet per user answer
- Changing the ThemeRecipe interface or deriveTheme() public API beyond the minimal `interactive?: string` field addition required by [D05]
- Modifying postcss-tug-color, the palette engine, or any component CSS
- Accessibility or CVD pipeline changes

#### Dependencies / Prerequisites {#dependencies}

- `theme-derivation-engine.ts` and `tug-base.css` are the primary files
- `generate-tug-tokens.ts` script is the secondary file
- Existing test suite must remain green throughout

#### Constraints {#constraints}

- Must use bun (not npm) for all JS/TS tooling
- Warnings are errors in the tugcode Rust project (not directly relevant but policy applies to any Rust changes)
- The postcss-tug-color plugin and `--tug-color()` notation remain the token value format

#### Assumptions {#assumptions}

- The hand-authored tug-base.css body{} block is the definitive Brio ground truth
- The existing ThemeRecipe interface and deriveTheme() function are the correct extension points
- Typography, spacing, radius, icon-size, and motion tokens are invariants and do not need formula derivation
- The token count remains 350 after this refactor

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Light-mode preset correctness (DEFERRED) {#q01-light-mode-deferred}

**Question:** Should the light-mode preset formulas be audited against a hand-authored light-mode ground truth?

**Why it matters:** Without a ground truth, light-mode formulas may produce visually incorrect themes.

**Options (if known):**
- Audit now against Harmony CSS
- Defer to a follow-on task

**Plan to resolve:** Defer to follow-on. The light preset wraps current formulas unchanged.

**Resolution:** DEFERRED -- no hand-authored light-mode ground truth exists in tug-base.css; will be revisited when light-mode themes are actively used.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Formula corrections break light-mode output | med | low | Light-mode formulas are not changed; only dark-mode paths are corrected | If light-mode visual regressions are reported |
| Exact-match test is brittle to formatting | low | med | Match on parsed token name + value string, not on CSS formatting | If generation script formatting changes |

**Risk R01: Formula corrections introduce dark-mode visual regression** {#r01-dark-regression}

- **Risk:** Correcting formulas to match Brio ground truth changes some token values that non-Brio recipes (if any) depend on
- **Mitigation:** Only the Brio recipe exists in EXAMPLE_RECIPES; no other recipes are in production. The exact-match test locks Brio output.
- **Residual risk:** Future recipes may need different formula tuning; the preset system accommodates this by design.

---

### Design Decisions {#design-decisions}

#### [D01] Exact string match as verification method (DECIDED) {#d01-exact-string-match}

**Decision:** Engine output must match the exact `--tug-color()` shorthand string for every token, not just the resolved OKLCH color.

**Rationale:**
- The `--tug-color()` strings are what appear in the CSS and are expanded by postcss-tug-color at build time
- Matching resolved OKLCH would mask differences in compact form (e.g., `--tug-color(orange)` vs `--tug-color(orange, i: 50, t: 50)`)
- String matching is simpler to verify and debug

**Implications:**
- The `makeTugColor()` helper must produce identical strings to what appears in tug-base.css
- Preset formulas must use exactly the right hue refs, intensity, tone, and alpha values

#### [D06] makeTugColor emits verbose form for semi-transparent canonical tokens (DECIDED) {#d06-verbose-alpha}

**Decision:** When `makeTugColor()` produces a semi-transparent token (alpha < 100) at canonical intensity and tone (i=50, t=50), it must emit the verbose form `--tug-color(hue, i: 50, t: 50, a: N)` instead of the compact form `--tug-color(hue, a: N)`.

**Rationale:**
- The CSS ground truth uses the verbose form for ~19 tokens: accent-subtle, all tone-*-bg, selection-bg, highlight-dropTarget/preview/inspectorTarget/snapGuide, highlight-flash, control-selected-bg/bg-hover/disabled-bg, control-highlighted-bg/border
- Without this fix, T-BRIO-MATCH would fail on all 19 tokens due to string mismatch
- The verbose form is semantically equivalent but must be used for exact-match compliance

**Implications:**
- Modify `makeTugColor()`: when `ra !== 100` and `ri === 50` and `rt === 50`, still include `i: 50, t: 50` in the output instead of omitting them as defaults
- This is a one-line change to the compaction logic: the "canonical bare form" shortcut (`ri === 50 && rt === 50 && ra === 100`) remains unchanged, but the fallback path must not omit i/t when alpha is non-default

#### [D02] Single unified generated region in tug-base.css (DECIDED) {#d02-unified-region}

**Decision:** Collapse all hand-maintained token blocks (current `@generated:control-tokens` and `@generated:chrome-tokens` regions plus all non-generated tokens) into a single `@generated:tokens:begin` / `@generated:tokens:end` region covering all 350 tokens.

**Rationale:**
- Eliminates the split between hand-maintained and generated tokens
- One region is simpler to maintain and less error-prone
- The generation script code (`generate-tug-tokens.ts`) already uses `@generated:tokens:begin/end` markers, but the CSS file still has the old `@generated:control-tokens` and `@generated:chrome-tokens` markers. Step 7 migrates the CSS to match the script's markers. Until Step 7, the generation script cannot be run as an intermediate correctness check -- formula verification during Steps 2-4 relies solely on the T-BRIO-MATCH test

**Implications:**
- The old `@generated:control-tokens:begin/end` and `@generated:chrome-tokens:begin/end` markers are removed
- All `--tug-base-*` tokens in body{} are generated (chromatic, invariant, and structural); only non-token CSS outside body{} (font-face, :root, scrollbars) remains hand-authored
- The chart aliases and shiki bridge tokens inside body{} but outside `@generated` are preserved as hand-authored preamble above the generated region

#### [D03] ModePreset type encapsulates mode-specific formula parameters (DECIDED) {#d03-mode-preset-type}

**Decision:** Introduce a `ModePreset` interface that bundles all mode-dependent formula constants (surface tone anchors, fg tone anchors, intensity levels, shadow alphas, etc.) into a single object. `deriveTheme()` selects a preset by `recipe.mode` and uses its values instead of inline `isLight ? ... : ...` branches.

**Rationale:**
- Current code has ~80 inline ternaries (`isLight ? X : Y`); extracting these into a preset object makes each mode's formula parameters explicit, inspectable, and testable in isolation
- Adding new modes (dark-stark, light-stark) later becomes a matter of adding a new preset object, not threading new branches through 80+ ternaries
- The Brio ground truth can be verified directly against the dark preset's parameter values

**Implications:**
- The internal structure of `deriveTheme()` changes significantly, but the public API (ThemeRecipe in, ThemeOutput out) does not change
- Each preset contains ~40-50 named numeric parameters covering surface tones, fg tones, intensities, shadow alphas, etc.
- The dark preset parameters are set to the exact values that reproduce the hand-authored Brio CSS
- ModePreset captures numeric formula parameters only. Hue-selection logic (e.g., "light mode surfaces use text hue for bg-app, dark mode uses atmosphere hue") and structural code paths (e.g., "light mode fg-onAccent uses setWhite, dark mode uses setChromatic") remain as `isLight` branches in `deriveTheme()`. These are algorithmic choices, not numeric parameters, and do not belong in a data-only preset object. The ~80 inline ternaries will be reduced to ~30-40 (numeric ones extracted), with the remaining ~40-50 hue-selection and structural ternaries staying as code branches.
- Derived values that are computed from other preset parameters (e.g., `dividerTone = surfaceRaisedTone - 2`, `toggleTrackOffTone = dividerTone`) stay as computed code in `deriveTheme()`, not as additional preset fields. The preset contains only independent anchor values; dependent calculations remain as formulas.

#### [D05] Brio uses two distinct active-family hues: blue and cyan (DECIDED) {#d05-brio-active-cyan}

**Decision:** The CSS ground truth distinguishes two active-family hue roles that the engine currently conflates under a single `activeHue`:

- **blue** -- used for: tone-active-*, control-selected-*, control-highlighted-*, outlined-action-border-*, filled-action-*, outlined-agent-border-*
- **cyan** -- used for: fg-link, fg-link-hover, selection-bg, highlight-dropTarget/preview/inspectorTarget/snapGuide, field-border-active

Add an `interactive` field to `ThemeRecipe` (optional, defaults to `recipe.active ?? "blue"`). Set `interactive: "cyan"` in the Brio recipe. Link, selection, highlight, and field-border-active tokens use `recipe.interactive`. Tone-active-* and control-selected/highlighted tokens continue using `recipe.active` (blue).

**Rationale:**
- `cyan` and `blue` are distinct named hues in the palette engine with different angles
- The CSS ground truth unambiguously uses cyan for interactive-feedback tokens and blue for semantic-active tokens
- Without this separation, T-BRIO-MATCH would fail on ~8 cyan-based tokens

**Implications:**
- `ThemeRecipe` gains an optional `interactive?: string` field
- `EXAMPLE_RECIPES.brio` gains `interactive: "cyan"`
- `deriveTheme()` resolves `interactiveHue = recipe.interactive ?? recipe.active ?? "blue"` and uses it for link, selection, highlight, and field-border-active tokens
- Existing `activeHue` continues to drive tone-active-*, control-selected-*, control-highlighted-*, and button border tokens

#### [D04] Non-body tokens stay outside the generated region (DECIDED) {#d04-non-body-outside}

**Decision:** Font-face declarations, :root multiplier tokens, motion-off rules, and scrollbar styling remain hand-authored outside body{}. Within body{}, the zoom property, chart aliases, and shiki bridge tokens remain as hand-authored preamble above the generated region. Motion-duration calc tokens are NOT part of the preamble -- they are produced by the engine as invariants and belong inside the generated region. Only `--tug-base-*` custom properties inside body{} are generated.

**Rationale:**
- These tokens are structural CSS (not theme-derivable) and do not vary by recipe
- The generation script only produces `--tug-base-*` custom properties; adding non-token CSS to it would blur responsibilities

**Implications:**
- The body{} block structure becomes: hand-authored preamble (zoom, chart aliases, shiki bridge) -> `@generated:tokens:begin` -> 350 tokens (including motion-duration invariants) -> `@generated:tokens:end` -> closing brace

---

### Specification {#specification}

#### ModePreset Interface {#mode-preset-interface}

**Spec S01: ModePreset type (starting spec -- implementer extends during Step 6)** {#s01-mode-preset}

```typescript
interface ModePreset {
  // Surface tone anchors (absolute tone values for the Brio recipe)
  bgAppTone: number;
  bgCanvasTone: number;
  surfaceSunkenTone: number;
  surfaceDefaultTone: number;
  surfaceRaisedTone: number;
  surfaceOverlayTone: number;
  surfaceInsetTone: number;
  surfaceContentTone: number;
  surfaceScreenTone: number;

  // Surface intensity — independent per-tier values, not computed from atmI.
  // Brio dark: atmI=5, sunkenI=5, overlayI=4, screenI=7.
  // Each tier may differ due to hand-tuned Brio ground truth.
  atmI: number;          // base atmosphere intensity (bg-app, canvas, default, raised, inset, content)
  surfaceSunkenI: number; // sunken uses its own intensity
  surfaceOverlayI: number; // overlay uses its own intensity
  surfaceScreenI: number;  // screen uses its own intensity
  surfaceTierOffsets: {
    default: number;    // offset from atmBaseAngle
    overlay: number;
    sunken: number;
    screen: number;
  };

  // Foreground tone anchors
  fgDefaultTone: number;
  fgMutedTone: number;
  fgSubtleTone: number;
  fgDisabledTone: number;
  fgPlaceholderTone: number;
  fgInverseTone: number;

  // Text intensity levels
  txtI: number;
  txtISubtle: number;
  fgMutedI: number;
  fgInverseI: number;

  // Per-tier fg hue offsets (from txtBaseAngle)
  fgTierOffsets: {
    muted: number;
    subtle: number;
    placeholder: number;
  };

  // Border parameters
  borderIBase: number;
  borderIStrong: number;

  // Shadow / overlay alphas
  shadowXsAlpha: number;
  shadowMdAlpha: number;
  shadowLgAlpha: number;
  shadowXlAlpha: number;
  shadowOverlayAlpha: number;
  overlayDimAlpha: number;
  overlayScrimAlpha: number;
  overlayHighlightAlpha: number;

  // Control emphasis parameters
  filledBgDarkTone: number;
  filledBgHoverTone: number;
  filledBgActiveTone: number;

  // Field tone anchors
  fieldBgRestTone: number;
  fieldBgHoverTone: number;
  fieldBgFocusTone: number;
  fieldBgDisabledTone: number;
  fieldBgReadOnlyTone: number;
}
```

#### Brio Ground Truth Fixture {#brio-ground-truth}

**Spec S02: Brio dark-mode token fixture** {#s02-brio-fixture}

The fixture is extracted from tug-base.css body{} by parsing every `--tug-base-*:` declaration and recording the exact `--tug-color()` value string. Only chromatic tokens (those whose value starts with `--tug-color(` or contains `--tug-color(` as a substring) are included. Structural tokens (`transparent`, `none`, `var(...)`, plain CSS values) are recorded separately.

The fixture is stored as a `Record<string, string>` constant in the test file. It contains approximately 260 chromatic tokens (the remaining ~90 are invariant/structural).

#### Token Groups for Formula Correction {#token-groups}

**Table T01: Token groups and their formula dependencies** {#t01-token-groups}

| Group | Token count | Primary seed | Key parameters |
|-------|-------------|-------------|----------------|
| Surfaces (bg-app, surface-*) | 9 | atmosphere hue | atmI, surface tone anchors, tier offsets |
| Foreground (fg-*) | 12 | text hue | txtI, fg tone anchors, fg tier offsets |
| Icons (icon-*) | 5 | text hue | follows fg formulas |
| Borders/Dividers | 8 | text/atmosphere hue | borderIBase, divider tones |
| Shadows/Overlays | 8 | black/white | shadow alpha values |
| Accent system | 3 | accent hue | signalI |
| Semantic tones | 35 | per-tone hue | signalI, caution-bg alpha |
| Selection/Highlight | 9 | active/accent hue | signalI |
| Tab chrome | 7 | atmosphere/text hue | atmI, surface tones |
| Control disabled | 6 | atmosphere/text hue | atmI, divider tones |
| Control emphasis x role | 156 | per-role hue | signalI, filled tones |
| Control surface/selected | 8 | active hue | signalI |
| Field tokens | 21 | atmosphere/text hue | field tone anchors |
| Toggle/check/radio | 13 | atmosphere/accent/text hue | divider tones, signalI |
| Separator | 1 | atmosphere hue | divider tones |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| (none) | All changes are to existing files |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ThemeRecipe.interactive` | field (add) | `theme-derivation-engine.ts` | Optional interactive-feedback hue (defaults to active) [D05] |
| `ModePreset` | interface | `theme-derivation-engine.ts` | Mode-specific formula parameters |
| `DARK_PRESET` | const | `theme-derivation-engine.ts` | Dark mode preset matching Brio ground truth |
| `LIGHT_PRESET` | const | `theme-derivation-engine.ts` | Light mode preset wrapping current formulas |
| `deriveTheme` | fn (modify) | `theme-derivation-engine.ts` | Use preset instead of inline ternaries; resolve interactiveHue |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Golden / Contract** | Compare engine output token strings against hand-authored Brio CSS fixture | Core verification -- T-BRIO-MATCH |
| **Drift Prevention** | Ensure generation script produces byte-identical CSS | Post-generation verification |
| **Unit** | Verify ModePreset parameter values match Brio expectations | Preset constant validation |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Extract Brio ground truth fixture {#step-1}

**Commit:** `test(theme): add Brio dark-mode exact-match fixture`

**References:** [D01] Exact string match, Spec S02, Table T01, (#brio-ground-truth, #context)

**Artifacts:**
- New constant `BRIO_GROUND_TRUTH` in `theme-derivation-engine.test.ts` containing every `--tug-base-*` chromatic token from tug-base.css body{} as `Record<string, string>`

**Tasks:**
- [ ] Parse tug-base.css body{} block to extract all `--tug-base-*: --tug-color(...)` declarations
- [ ] Record each token name and its exact `--tug-color()` value string (trimmed, no trailing semicolon)
- [ ] Include composite values like `--tug-base-shadow-overlay: 0 4px 16px --tug-color(black, a: 60)` as-is
- [ ] Record structural tokens separately: `transparent`, `none`, `0.5`, `var(...)` values
- [ ] Store as `BRIO_GROUND_TRUTH: Record<string, string>` constant
- [ ] Add test T-BRIO-MATCH that iterates over BRIO_GROUND_TRUTH and asserts `deriveTheme(EXAMPLE_RECIPES.brio).tokens[name] === expected` for each entry -- mark it as `it.todo(...)` so it is defined but skipped (does not fail the suite)
- [ ] Manually run the assertions in a scratch script or temporary `it.only` to record the mismatch count, then revert to `.todo`

**Tests:**
- [ ] T-BRIO-MATCH: test defined as `.todo` (skipped); mismatch count recorded in commit message or code comment for reference

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test --grep "derivation-engine"` -- all existing tests pass, T-BRIO-MATCH is present as `.todo` (no failures)
- [ ] Mismatch count recorded for reference

---

#### Step 2: Correct surface and foreground formulas {#step-2}

**Depends on:** #step-1

**Commit:** `fix(theme): correct surface and fg formulas to match Brio ground truth`

**References:** [D01] Exact string match, [D03] ModePreset, [D05] Brio active cyan, Spec S02, Table T01, (#brio-ground-truth, #token-groups)

**Artifacts:**
- Modified `ThemeRecipe` interface: added optional `interactive?: string` field
- Modified `EXAMPLE_RECIPES.brio`: added `interactive: "cyan"`
- Modified `deriveTheme()` in `theme-derivation-engine.ts`: corrected surface tone anchors, fg tone anchors, intensity levels, per-tier hue offsets, and interactive hue resolution for the Brio dark-mode path

**Tasks:**
- [ ] Add `interactive?: string` field to `ThemeRecipe` interface [D05]
- [ ] Add `interactive: "cyan"` to `EXAMPLE_RECIPES.brio` [D05]
- [ ] In `deriveTheme()`, resolve `interactiveHue = recipe.interactive ?? recipe.active ?? "blue"` and derive `interactiveAngle`, `interactiveName`, `interactiveRef` from it. Use `interactiveHue` for fg-link, fg-link-hover, selection-bg, highlight-dropTarget/preview/inspectorTarget/snapGuide, and field-border-active. Keep `activeHue` for tone-active-*, control-selected-*, control-highlighted-*, and action-role border tokens [D05]
- [ ] Compare each surface token's engine output to the Brio fixture; identify mismatches in hue ref, intensity, tone
- [ ] Correct the dark-mode surface tone constants (`darkBgApp`, `darkSurfaceSunken`, etc.) to produce the exact Brio values: bg-app=5, sunken=11, default=12, raised=11, overlay=14, inset=6, content=6, screen=16
- [ ] Correct the dark-mode surface intensity values: bg-app/canvas use `i: 2`, sunken/default use `i: 5`, raised uses `i: 5`, overlay uses `i: 4`, etc.
- [ ] Correct per-tier hue offsets for Brio: bg-app uses `violet-6` (offset -6 from recipe), sunken uses bare `violet`, default uses bare `violet`, raised uses `violet-6`, etc.
- [ ] Correct fg tone anchors: fg-default=94, fg-muted=66, fg-subtle=37, fg-disabled=23, fg-placeholder=30
- [ ] Correct fg intensity levels: fg-default i=3, fg-muted i=5, fg-subtle i=7, fg-disabled i=7, fg-placeholder i=6
- [ ] Correct fg per-tier hue offsets for dark mode. The engine currently uses `fgTierAngle(offset)` which adds offsets from Bluenote (+6 for muted, +7 for subtle, +8 for placeholder). The Brio CSS ground truth uses different offsets:
  - fg-default: bare cobalt (offset 0) -- already correct
  - fg-muted: bare cobalt (offset 0) -- engine currently uses +6, change to 0
  - fg-subtle: cobalt+7 (offset +7) -- already correct
  - fg-disabled: cobalt+8 (offset +8) -- engine currently uses bare `txtRefW` with no tier offset, change to use `fgTierAngle(8)` producing `cobalt+8, i: 7, t: 23`
  - fg-placeholder: bare cobalt (offset 0) -- engine currently uses +8, change to 0. The DARK_PRESET `fgTierOffsets.placeholder` must be 0
- [ ] Correct fg-inverse: Brio uses `--tug-color(cobalt-8, i: 3, t: 100)`. The engine currently uses `txtRefW` (bare cobalt) with `fgInverseI = max(1, txtI - 1) = 2`. Fix: change the hue ref to use a per-tier offset of -8 from txtBaseAngle (producing `cobalt-8`), and change `fgInverseI` to `txtI` (3, not txtI-1=2) so the output is `cobalt-8, i: 3, t: 100`
- [ ] Correct fg-link-hover: Brio uses `--tug-color(cyan-light)` which is the preset form for i=20, t=85. The engine currently uses `activeHue` at `signalI+20=70, t=55`. Fix: use `interactiveHue` (cyan) at i=20, t=85 so `makeTugColor` emits the `cyan-light` preset shorthand
- [ ] Correct fg-onAccent, fg-onDanger: Brio uses `--tug-color(cobalt-8, i: 3, t: 100)` (same as fg-inverse). Fix: use the same corrected hue ref and intensity as fg-inverse
- [ ] Correct fg-onCaution, fg-onSuccess: Brio uses `violet-6, i: 4, t: 7` (atmosphere hue, dark text on bright bg) -- verify these match
- [ ] Verify icon tokens follow the corrected fg formulas (icon-default=fg-muted values, icon-muted=fg-subtle values, icon-disabled=fg-disabled values, icon-onAccent=fg-inverse values)

**Tests:**
- [ ] T-BRIO-MATCH surface subset: all 9 surface tokens match exactly
- [ ] T-BRIO-MATCH fg subset: all 12 fg tokens match exactly
- [ ] T-BRIO-MATCH icon subset: all 5 icon tokens match exactly

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test --grep "derivation-engine"` -- surface/fg/icon mismatches resolved
- [ ] Remaining mismatch count decreased significantly

---

#### Step 3: Correct border, shadow, accent, and tone formulas {#step-3}

**Depends on:** #step-2

**Commit:** `fix(theme): correct border, shadow, accent, and tone formulas for Brio`

**References:** [D01] Exact string match, [D05] Brio active cyan, [D06] Verbose alpha, Spec S02, Table T01, (#brio-ground-truth, #token-groups)

**Artifacts:**
- Modified `deriveTheme()`: corrected border hue refs and intensities, shadow alpha values, accent system values, semantic tone values
- Modified `makeTugColor()`: verbose form for semi-transparent canonical tokens; fixed `-muted` preset check
- Modified `makeShadowToken()`: verbose form with explicit i/t

**Tasks:**
- [ ] Fix `makeTugColor()` verbose alpha form [D06]: when alpha is non-default (ra !== 100) and intensity/tone are at canonical defaults (ri === 50, rt === 50), emit `--tug-color(hue, i: 50, t: 50, a: N)` instead of `--tug-color(hue, a: N)`. This affects ~19 tokens including accent-subtle, all tone-*-bg, selection-bg, highlight-*, control-selected-bg/*, control-highlighted-bg/border
- [ ] Fix `makeTugColor()` `-muted` preset check: line 246 currently checks `ri === 20 && rt === 50` but palette-engine defines muted as `{ intensity: 50, tone: 42 }`. Change to `ri === 50 && rt === 42 && ra === 100`. Without this fix, `makeTugColor("orange", 50, 42)` produces `--tug-color(orange, t: 42)` instead of `--tug-color(orange-muted)`, causing toggle-track-on to fail T-BRIO-MATCH
- [ ] Correct border tokens: border-default uses `cobalt, i: 6, t: 30`; border-muted uses `cobalt+7, i: 7, t: 37`; border-strong uses `cobalt+8, i: 7, t: 40`
- [ ] Correct divider tokens: divider-default uses `violet-6, i: 6, t: 17`; divider-muted uses `violet, i: 4, t: 15`
- [ ] Fix `makeShadowToken()` string format: currently produces `--tug-color(black, a: 20)` but the CSS ground truth uses `--tug-color(black, i: 0, t: 0, a: 20)`. Update `makeShadowToken()` to emit the verbose form with explicit `i: 0, t: 0` parameters. Do NOT change `makeHighlightToken()` globally -- the 12 control/tab tokens that use it need the compact form `--tug-color(white, a: N)` which matches the CSS ground truth. Only `overlay-highlight` uses the verbose form `--tug-color(white, i: 0, t: 100, a: 6)` -- handle this single token by using `setChromatic` or a direct string assignment instead of `setHighlight`
- [ ] Verify shadow alpha values match Brio: xs=20, md=60, lg=70, xl=80, overlay=60, dim=48, scrim=64, highlight=6
- [ ] Correct accent-cool-default: CSS uses `--tug-color(cobalt-intense)` which is cobalt at i=90, t=50. Engine currently uses `activeHue` (blue) at signalI+20. Change to use text hue (cobalt) at intensity 90, tone 50, producing the `cobalt-intense` preset form
- [ ] Verify accent system: accent-default=`orange` (canonical), accent-subtle=`orange, i: 50, t: 50, a: 15`
- [ ] Correct any tone token mismatches (verify caution-bg alpha=12 vs other tones alpha=15)
- [ ] Correct selection-bg-inactive: engine currently uses text hue (cobalt) for dark mode but the CSS ground truth uses `--tug-color(yellow, i: 0, t: 30, a: 25)` -- change the dark-mode path to use the correct hue (yellow), intensity (0), tone (30), and alpha (25)
- [ ] Correct remaining selection/highlight tokens: verify they use `interactiveHue` (cyan for Brio) per [D05]

**Tests:**
- [ ] T-BRIO-MATCH border/divider subset: all 8 tokens match
- [ ] T-BRIO-MATCH shadow/overlay subset: all 8 tokens match
- [ ] T-BRIO-MATCH accent/tone/selection/highlight subsets: all match

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test --grep "derivation-engine"` -- border/shadow/accent/tone mismatches resolved

---

#### Step 4: Correct control, field, toggle, and tab formulas {#step-4}

**Depends on:** #step-3

**Commit:** `fix(theme): correct control, field, toggle, and tab formulas for Brio`

**References:** [D01] Exact string match, Spec S02, Table T01, (#brio-ground-truth, #token-groups)

**Artifacts:**
- Modified `deriveTheme()`: corrected control emphasis x role tokens, field tokens, toggle tokens, tab chrome tokens

**Tasks:**
- [ ] Correct filled control tokens: verify bg-rest uses `{role}-dark` preset (e.g., `orange-dark`), bg-hover uses `i: 55, t: 40`, bg-active uses `{role}-intense`, fg/icon all use `cobalt, i: 2, t: 100`, borders use `i: 55` / `i: 65` / `{role}-intense`
- [ ] Correct outlined control tokens: verify bg uses `transparent` / `white, a: 10` / `white, a: 20`, fg/icon use `cobalt, i: 2, t: 100`, borders match
- [ ] Correct ghost control tokens: verify bg-hover/active alpha values, ghost-danger fg/icon intensity progressions (signalI / signalI+10 / signalI+20)
- [ ] Correct outlined-option border: uses `cobalt, i: 7` / `cobalt, i: 9, t: 55` / `cobalt, i: 11, t: 60`
- [ ] Correct field tokens: field-bg-rest uses `violet-6, i: 5, t: 8`, field-bg-hover uses `violet, i: 5, t: 11`, field-bg-focus uses `violet-6, i: 4, t: 7`, etc.
- [ ] Correct toggle tokens: toggle-track-off uses `violet-6, i: 6, t: 17`, toggle-track-on uses `orange-muted`, toggle-track-on-hover uses `orange, i: 55, t: 45`
- [ ] Correct tab chrome tokens: tab-bg-active uses `violet+5, i: 5, t: 18`, tab-fg-rest uses `cobalt, i: 7`
- [ ] Correct separator token
- [ ] Enable T-BRIO-MATCH test: change from `it.todo(...)` to `it(...)` so it runs as a real assertion now that all token groups are corrected

**Tests:**
- [ ] T-BRIO-MATCH control subset: all 156 emphasis x role tokens match
- [ ] T-BRIO-MATCH field subset: all 21 tokens match
- [ ] T-BRIO-MATCH toggle subset: all 13 tokens match
- [ ] T-BRIO-MATCH tab subset: all 7 tokens match
- [ ] T-BRIO-MATCH: 0 mismatches (full green -- test is now active, not `.todo`)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test --grep "derivation-engine"` -- T-BRIO-MATCH fully passes, all existing tests pass
- [ ] Total mismatch count = 0

---

#### Step 5: Formula correction integration checkpoint {#step-5}

**Depends on:** #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Exact string match, Spec S02, (#success-criteria)

**Tasks:**
- [ ] Verify T-BRIO-MATCH passes with 0 mismatches across all 350 tokens
- [ ] Verify all existing tests still pass (T2.1 token count, T2.4 chromatic pattern, T2.5 invariants, T2.6 gamut, T4.1 contrast pipeline)

**Tests:**
- [ ] T-BRIO-MATCH: 0 mismatches across all chromatic tokens
- [ ] All existing derivation-engine tests pass without regression

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test --grep "derivation-engine"` -- all tests green (T-BRIO-MATCH enabled and passing, all existing tests pass)

Note: the generation script (`bun run generate:tokens`) is not run here because the CSS markers are not yet unified (that happens in Step 7). The test suite alone verifies formula correctness.

---

#### Step 6: Introduce ModePreset type and dark/light presets {#step-6}

**Depends on:** #step-5

**Commit:** `refactor(theme): introduce ModePreset type with dark and light presets`

**References:** [D03] ModePreset, Spec S01, (#mode-preset-interface, #strategy)

**Artifacts:**
- New `ModePreset` interface in `theme-derivation-engine.ts`
- New `DARK_PRESET` constant with values matching the corrected Brio formulas
- New `LIGHT_PRESET` constant wrapping current light-mode formula values
- Modified `deriveTheme()` to select preset by `recipe.mode` and use preset parameters

**Tasks:**
- [ ] Define `ModePreset` interface with all mode-dependent parameters (see Spec S01)
- [ ] Create `DARK_PRESET` constant with the exact parameter values from Steps 2-4 that reproduce Brio
- [ ] Create `LIGHT_PRESET` constant by extracting the current `isLight` branch values into the same structure
- [ ] Replace numeric `isLight ? X : Y` ternaries in `deriveTheme()` with `preset.paramName` references (tone values, intensity levels, alpha values, etc.)
- [ ] Keep hue-selection ternaries (which hue ref to use) and structural ternaries (setWhite vs setChromatic) as `isLight` code branches -- these are algorithmic choices that don't reduce to numeric preset parameters
- [ ] Verify that the refactored `deriveTheme()` produces identical output for both modes (no behavioral change)
- [ ] Export `ModePreset` type for potential future use

**Tests:**
- [ ] T-BRIO-MATCH still passes (no regression from refactor)
- [ ] All existing tests pass unchanged
- [ ] New test: `deriveTheme(brio)` output is identical before and after the refactor (snapshot comparison)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test --grep "derivation-engine"` -- all tests green
- [ ] No behavioral change in output

---

#### Step 7: Unify tug-base.css generated region {#step-7}

**Depends on:** #step-6

**Commit:** `refactor(theme): unify tug-base.css to single generated token region`

**References:** [D02] Unified region, [D04] Non-body outside, (#strategy, #success-criteria)

**Artifacts:**
- Modified `tug-base.css`: body{} block restructured with preamble (zoom, chart aliases, shiki bridge) followed by single `@generated:tokens:begin` / `@generated:tokens:end` region
- Modified `generate-tug-tokens.ts`: updated marker constants if needed, verified output includes all 350 tokens

**Tasks:**
- [ ] In tug-base.css, move the zoom property, chart aliases, and shiki bridge tokens to the top of body{} (above the generated region). Do NOT move motion-duration calc tokens to the preamble -- the engine already produces `--tug-base-motion-duration-*` tokens as invariants, so they belong inside the generated region
- [ ] Remove the old `@generated:control-tokens:begin/end` and `@generated:chrome-tokens:begin/end` markers
- [ ] Remove all hand-maintained `--tug-base-*` declarations from body{} (chromatic, invariant, and structural alike -- the engine produces all 350 tokens including invariants like typography, spacing, radius, and motion)
- [ ] Place a single `@generated:tokens:begin` / `@generated:tokens:end` marker pair encompassing where all 350 tokens will be generated
- [ ] Update `generate-tug-tokens.ts` marker constants if they differ from the current ones
- [ ] Run `bun run generate:tokens` to populate the unified region
- [ ] Verify the generated CSS is valid and complete

**Tests:**
- [ ] `bun run generate:tokens` succeeds without errors
- [ ] `bun test --grep "derivation-engine"` -- all tests pass
- [ ] Visual inspection: the generated tug-base.css has the same token values as before

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run generate:tokens && bun test` -- all tests pass
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` -- build succeeds with generated CSS
- [ ] No hand-maintained `--tug-base-*` tokens remain in body{} outside the generated region

---

#### Step 8: Final verification {#step-8}

**Depends on:** #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Exact string match, [D02] Unified region, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run the full test suite
- [ ] Run `bun run generate:tokens` and verify `git diff styles/tug-base.css` shows no changes (generation is idempotent)
- [ ] Verify tug-base.css structure: preamble -> generated region -> closing brace
- [ ] Verify the build succeeds and the app renders correctly

**Tests:**
- [ ] T-BRIO-MATCH: passes with 0 mismatches
- [ ] T-IDEMPOTENT: `generate:tokens` produces no diff
- [ ] All existing tests pass

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` -- all tests pass
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run generate:tokens && git diff --exit-code styles/tug-base.css` -- exits 0 (no diff)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run build` -- succeeds

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The theme derivation engine is the single source of truth for all 350 `--tug-base-*` tokens, with a mode preset system that exactly reproduces the hand-authored Brio dark-mode CSS and generates tug-base.css body{} via a single authoritative script.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] T-BRIO-MATCH test passes: every chromatic token from Brio ground truth matches engine output exactly (`bun test --grep "BRIO-MATCH"`)
- [ ] Generation is idempotent: `bun run generate:tokens && git diff --exit-code styles/tug-base.css` exits 0
- [ ] All existing tests pass: `bun test` exits 0
- [ ] Build succeeds: `bun run build` exits 0
- [ ] No hand-maintained `--tug-base-*` tokens remain in tug-base.css body{} outside the `@generated:tokens` region

**Acceptance tests:**
- [ ] T-BRIO-MATCH: `deriveTheme(EXAMPLE_RECIPES.brio).tokens[name] === BRIO_GROUND_TRUTH[name]` for all chromatic tokens
- [ ] T-IDEMPOTENT: running `generate:tokens` twice produces no diff

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Audit light-mode preset against Harmony ground truth
- [ ] Add dark-stark and light-stark mode presets
- [ ] Add recipe-level overrides for individual tokens
- [ ] Add theme preview UI that renders preset parameter changes in real time

| Checkpoint | Verification |
|------------|--------------|
| Brio exact match | `bun test --grep "BRIO-MATCH"` passes |
| Generation idempotent | `bun run generate:tokens && git diff --exit-code styles/tug-base.css` exits 0 |
| Full test suite | `bun test` passes |
| Build clean | `bun run build` succeeds |
