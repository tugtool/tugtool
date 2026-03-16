## Declarative Theme Derivation Engine {#declarative-derivation-engine}

**Purpose:** Refactor deriveTheme() from a 2082-line imperative function with 81 isLight branches into a three-layer declarative system (HueSlot resolution, derivation rules, ModePreset), eliminating all mode branching while preserving exact token output.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-17 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current `deriveTheme()` in `theme-derivation-engine.ts` is a 2082-line function containing 81 `isLight` branches, 22 inline hue source variables, and ~460 `set*` calls. Mode differences (dark vs light) are scattered throughout the function as ternary expressions and if/else blocks, making the code difficult to reason about, extend, and tune.

The existing `ModePreset` already absorbs numeric parameters (tone anchors, intensity levels, alpha values), but hue-selection logic and structural code paths remain as `isLight` branches. This plan completes the migration: every remaining mode difference is absorbed into ModePreset hue slot fields, and a declarative rule table replaces the imperative set* call sequence.

#### Strategy {#strategy}

- Extract all 81 remaining `isLight` branches into ModePreset hue slot fields, making rules mode-agnostic
- Build a derivation rule table where each token is an object with `hueSlot`, `intensityExpr`, and `toneExpr` function fields
- Pre-compute a `ComputedTones` object from mood knobs before rule evaluation, so rules reference computed values rather than computing inline
- Preserve the existing `set*` helpers as-is; the rule evaluation loop calls them
- Validate every step against T-BRIO-MATCH fixture to ensure zero visual regression
- Keep LIGHT_PRESET values unchanged during refactor; light theme tuning is deferred
- Execute incrementally: first hue slots, then ComputedTones, then rules, then cleanup

#### Success Criteria (Measurable) {#success-criteria}

- Zero `isLight` branches remain in the rule evaluation section of `deriveTheme()` (verified by grep)
- T-BRIO-MATCH test passes: engine output matches Brio ground truth fixture within OKLCH delta-E < 0.02
- Token count remains exactly 373 (verified by existing test T2.1, adjusting for current count)
- All existing tests pass without modification (`cd tugdeck && bun test`)
- `bun run generate:tokens` produces identical output to current main branch

#### Scope {#scope}

1. Extend `ModePreset` interface with hue slot fields for all per-tier hue assignments
2. Define `ComputedTones` interface and pre-computation function
3. Define `DerivationRule` interface and build the rule table (373 entries)
4. Replace imperative set* call sequence with rule evaluation loop
5. Populate `DARK_PRESET` and `LIGHT_PRESET` hue slot fields from existing inline values
6. Remove all `isLight` branches from token derivation

#### Non-goals (Explicitly out of scope) {#non-goals}

- Light theme visual tuning (LIGHT_PRESET values preserved as-is)
- Changing the ThemeRecipe interface (no new fields)
- Changing the public API surface of deriveTheme() (same input/output contract)
- Refactoring palette-engine.ts or set* helper internals
- Adding new tokens beyond the current 373

#### Dependencies / Prerequisites {#dependencies}

- Current T-BRIO-MATCH test fixture must be up to date and passing
- All existing theme-derivation-engine tests must be green
- `bun run generate:tokens` output captured as baseline before starting

#### Constraints {#constraints}

- Zero visual regression: T-BRIO-MATCH is the ground truth contract
- Token count is a hard constraint (373 tokens)
- Existing tests must pass without modification throughout all steps
- LIGHT_PRESET values preserved exactly; only new hue slot fields added

#### Assumptions {#assumptions}

- ThemeRecipe interface is unchanged; no new fields added during this refactor
- ModePreset interface will be extended with hue slot fields to absorb hue switching
- T-BRIO-MATCH test fixture is the ground truth contract
- Warmth bias computation moves to the resolveHueSlots() step
- The 81 `isLight` branches can all be expressed as preset hue slot differences

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan skeleton v2. All headings that are referenced use explicit `{#anchor}` tags. Steps use `**References:**` and `**Depends on:**` lines per the skeleton contract.

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Light-mode ground truth fixture (OPEN) {#q01-light-ground-truth}

**Question:** Should a light-mode ground truth fixture be created before or after this refactor?

**Why it matters:** Without a light-mode fixture, light-mode regressions during refactoring could go undetected. T-BRIO-MATCH only covers dark mode.

**Options (if known):**
- Create a light-mode snapshot test before refactoring (captures current output as ground truth)
- Defer to follow-on work (current plan approach)

**Plan to resolve:** Step 1 captures `bun run generate:tokens` output which includes both modes. A full diff of generated output after each step serves as a lightweight regression gate for light mode until a dedicated fixture is created.

**Resolution:** DEFERRED (light-mode tuning is out of scope; generated-tokens diff provides sufficient regression detection during this refactor)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Rule table produces different output than imperative code | high | medium | Per-step T-BRIO-MATCH validation | Any test failure during migration |
| Some isLight branches cannot be expressed as hue slot differences | medium | low | Audit all 81 branches before coding; identify structural vs hue differences | Audit step reveals non-hue branching patterns |
| ComputedTones pre-computation changes evaluation order | medium | low | Verify tone values match existing inline computations exactly | Delta-E > 0 on any token |

**Risk R01: Regression in token output** {#r01-token-regression}

- **Risk:** Converting from imperative to declarative evaluation introduces subtle numeric differences in token values due to evaluation order or floating-point rounding.
- **Mitigation:**
  - Run T-BRIO-MATCH after every step
  - Capture `bun run generate:tokens` baseline before starting and diff after each step
  - Keep imperative code alongside rules during migration; delete only after full verification
- **Residual risk:** Light mode tokens are less thoroughly tested than dark mode (no hand-authored fixture), so light mode regression could go undetected if only T-BRIO-MATCH is checked.

**Risk R02: Rule table size and maintainability** {#r02-rule-table-size}

- **Risk:** 373 rule entries may be verbose and hard to navigate.
- **Mitigation:**
  - Group rules by token category (surfaces, foreground, borders, controls, etc.)
  - Use factory functions for common patterns (e.g., `surfaceRule(slot, toneField)`)
  - Comment each group with its category header
- **Residual risk:** The rule table will be large but each entry is self-contained and greppable.

---

### Design Decisions {#design-decisions}

#### [D01] ModePreset absorbs all hue switching via hue slot fields (DECIDED) {#d01-preset-hue-slots}

**Decision:** ModePreset gets string fields like `bgAppHueSlot`, `fgMutedHueSlot`, etc. that name which recipe hue slot to use per mode. Rules reference the slot name; the preset resolves which recipe slot to use.

**Rationale:**
- Eliminates all `isLight` branches related to hue selection
- Mode differences become pure data (dark preset picks canvas hue for bg-app; light preset picks text hue)
- New modes (e.g., high-contrast) would only need new preset values, no code changes

**Implications:**
- ModePreset interface grows by ~20 hue slot fields plus ~80-100 numeric fields for per-tier intensities, tones, alphas, and control emphasis per-state values (see [D10] for organization)
- DARK_PRESET and LIGHT_PRESET must be populated with the current inline hue assignments and per-state values
- Rules become mode-agnostic: `rule.hueSlot` returns a slot name, preset resolves it

#### [D02] Derivation rules are objects with function fields (DECIDED) {#d02-rule-format}

**Decision:** Each rule is `{ hueSlot: string, intensityExpr: (preset, knobs, computed) => number, toneExpr: (preset, knobs, computed) => number }`. The rule table is a Record mapping token names to rules.

**Rationale:**
- Function fields provide maximum flexibility for complex expressions (e.g., `Math.round(preset.surfaceSunkenTone + ((knobs.surfaceContrast - 50) / 50) * 5)`)
- Rules can reference ComputedTones for pre-computed values
- No DSL to parse or interpret; TypeScript type-checks all expressions

**Implications:**
- Rule table is TypeScript code, not configuration data
- Each rule entry is ~3-5 lines; 373 entries = ~1500-1900 lines for the rule table
- The rule evaluation loop is simple: iterate entries, resolve hue slot from preset, call intensityExpr and toneExpr, pass to set* helper

#### [D03] Pre-computed ComputedTones before rule evaluation (DECIDED) {#d03-computed-tones}

**Decision:** A `ComputedTones` object is computed from mood knobs and preset values before the rule evaluation loop. Rules reference `computed.darkBgApp`, `computed.darkSurfaceSunken`, etc. instead of computing inline.

**Rationale:**
- Prevents redundant computation (multiple tokens reference the same derived tone)
- Makes rule expressions shorter and more readable
- Separates "what tones exist" from "which token uses which tone"

**Implications:**
- ComputedTones interface must include all tone derivations currently computed in sections 3-5 of deriveTheme()
- Tone computation code moves out of deriveTheme() into a `computeTones(preset, knobs)` function
- Rules reference `computed.*` fields instead of inline arithmetic

#### [D04] Per-tier hue derivation via preset hue slot fields (DECIDED) {#d04-per-tier-hue}

**Decision:** The preset declares which hue name to use for each semantic slot per mode. For example, `DARK_PRESET.fgSubtleHueSlot = "indigo-cobalt"` while `LIGHT_PRESET.fgSubtleHueSlot` uses the recipe's text hue.

**Rationale:**
- Brio dark uses per-tier hue offsets (fg-subtle = indigo-cobalt, fg-disabled = indigo-cobalt, fg-inverse = sapphire-cobalt)
- Light mode collapses all foreground tiers to the base text hue
- Expressing this in preset fields makes the pattern explicit and mode-agnostic in rules

**Implications:**
- Preset hue slot fields need a way to reference both fixed hue names ("indigo-cobalt") and recipe-relative slots ("text", "canvas")
- HueSlot resolution step must handle both cases: fixed names resolve directly, recipe-relative names look up the recipe field

#### [D05] set* helpers preserved as-is (DECIDED) {#d05-set-helpers}

**Decision:** The existing `setChromatic()`, `setWhite()`, `setShadow()`, `setHighlight()`, `setStructural()`, and `setInvariant()` helpers are preserved unchanged. The rule evaluation loop calls them.

**Rationale:**
- set* helpers handle token string formatting and resolved OKLCH computation correctly
- Changing them would risk breaking the output contract
- Rules produce the same arguments that set* helpers currently receive

**Implications:**
- Rules must produce all arguments needed by set* helpers (hueRef, hueAngle, intensity, tone, alpha, hueName)
- Some tokens use setWhite/setShadow/setHighlight/setStructural/setInvariant rather than setChromatic; the rule must specify which helper to use
- The rule evaluation loop needs a `type` discriminator per rule to dispatch to the right set* helper

#### [D06] HueSlot resolution computes warmth bias once (DECIDED) {#d06-warmth-bias}

**Decision:** Warmth bias is applied during HueSlot resolution, producing a `ResolvedHueSlots` object with `{ angle: number, name: string, ref: string }` for each slot. Rules reference resolved slots, never raw recipe angles.

**Rationale:**
- Currently warmth bias is applied to 7+ hue variables inline (atmAngleW, txtAngleW, canvasAngleW, etc.)
- Centralizing warmth bias application into HueSlot resolution prevents inconsistency
- Rules see only resolved, warmth-biased angles

**Implications:**
- `resolveHueSlots(recipe, warmth)` becomes the first step of deriveTheme()
- ResolvedHueSlots includes entries for all recipe hues plus derived per-tier hues
- The existing per-tier hue derivation logic (bare base extraction, adjacency, etc.) moves into HueSlot resolution

#### [D07] Sentinel hue slot values for non-chromatic dispatch (DECIDED) {#d07-sentinel-hue-slots}

**Decision:** Preset hue slot fields use reserved sentinel values to signal non-chromatic dispatch in the rule evaluator. Three sentinels are defined:

- `"__white"` -- evaluator calls `setWhite()`. Used for tokens like `fg-onAccent` that are white in light mode but chromatic in dark mode.
- `"__highlight"` -- evaluator calls `setHighlight(alphaExpr(...))`. Used for tokens like `outlined-action-bg-hover` and `ghost-action-bg-hover` that use `setHighlight()` in dark mode but `setChromatic()` in light mode.
- `"__shadow"` -- evaluator calls `setShadow(alphaExpr(...))`. Used for tokens like `ghost-action-bg-hover` that use `setShadow()` in light mode but `setHighlight()` in dark mode.
- `"__verboseHighlight"` -- evaluator emits the verbose white form `--tug-color(white, i: 0, t: 100, a: N)` and sets `resolved` to `WHITE_RESOLVED` with alpha. Used in two contexts: (1) **mode-conditional**: `highlight-hover` uses `__verboseHighlight` in dark mode but `__shadow` in light mode (preset-mediated hue slot). (2) **unconditional**: `overlay-highlight` always uses verbose form in both modes, so its rule uses `__verboseHighlight` as a direct hueSlot (not preset-mediated). The sentinel works for both because it simply describes the output format, not the mode-switching mechanism.

**Rationale:**
- ~5 tokens switch between `setWhite()` and `setChromatic()` based on mode
- ~10 tokens switch between `setHighlight()` and `setChromatic()` based on mode (outlined-action/agent/option bg-hover/active)
- ~6 tokens switch between `setShadow()` and `setHighlight()` based on mode (ghost-action/option bg-hover/active, tab-bg-hover, tab-close-bg-hover)
- ~2 tokens use verbose white highlight form in dark mode but shadow in light mode (highlight-hover); using `__verboseHighlight` sentinel avoids StructuralRule escape hatch that would re-introduce mode branching
- Using sentinel values in preset hue slot fields (rather than per-token type discriminator fields) keeps the pattern uniform: every mode-conditional dispatch is just a different preset hue slot value
- The rule remains a single ChromaticRule; mode difference is purely in the preset value

**Implications:**
- Evaluator checks for sentinels before ResolvedHueSlots resolution: `__white` -> `setWhite()`, `__highlight` -> `setHighlight(alphaExpr)`, `__shadow` -> `setShadow(alphaExpr)`, `__verboseHighlight` -> emit verbose white form with `alphaExpr`
- When `__white` is detected, `intensityExpr`, `toneExpr`, and `alphaExpr` are all ignored
- When `__highlight`, `__shadow`, or `__verboseHighlight` is detected, only `alphaExpr` is used; `intensityExpr` and `toneExpr` are ignored
- Sentinel strings must never appear as valid ResolvedHueSlots keys
- ChromaticRule's `alphaExpr` field now serves double duty: alpha for chromatic tokens, and alpha for highlight/shadow/verboseHighlight sentinel dispatch

#### [D09] Dual hueSlot resolution: direct key vs preset-mediated (DECIDED) {#d09-dual-resolution}

**Decision:** ChromaticRule `hueSlot` supports two resolution paths. If the `hueSlot` string is a valid key in `ResolvedHueSlots`, it resolves directly to that slot (no preset indirection). If it is not a valid key, the evaluator looks up `preset[hueSlot + "HueSlot"]` to get the `ResolvedHueSlots` key.

**Rationale:**
- ~130 tokens reference mode-independent hues (accent, active, interactive, destructive, success, caution, agent, data) that are the same in both dark and light modes. These tokens should reference `ResolvedHueSlots` keys directly (e.g., `hueSlot: "accent"`) without preset indirection.
- ~50 tokens reference mode-dependent hues (surface tiers, foreground tiers, icons) where dark and light modes select different recipe slots. These tokens use preset-mediated resolution (e.g., `hueSlot: "bgApp"` -> `preset.bgAppHueSlot` -> `"canvas"` in dark, `"txt"` in light).
- Adding 130+ identity-mapping fields to both presets for uniformity would be wasteful boilerplate.

**Implications:**
- The evaluator checks `hueSlot in resolvedSlots` first; if found, uses it directly. Otherwise, reads `preset[hueSlot + "HueSlot"]` and resolves that key from `resolvedSlots`.
- Preset hue slot fields are only needed for mode-dependent tokens (~50 fields, not ~180).
- Rule authors must use the correct convention: direct keys for mode-independent hues, non-key names for mode-dependent hues.
- Sentinel values (`"__white"`, `"__highlight"`, `"__shadow"`, `"__verboseHighlight"`) are checked after resolution per [D07].

#### [D10] Flat preset fields with naming convention (DECIDED) {#d10-flat-preset-fields}

**Decision:** All new ModePreset fields use flat naming with a `{family}{role}{property}{state}` convention. No sub-objects are introduced. The total ModePreset interface will have ~130-170 fields (existing ~50 numeric fields + ~20 hue slot fields + ~60-100 new per-state fields for control emphasis, toggle, field, and badge tokens).

**Rationale:**
- The existing ModePreset is flat (50+ numeric fields); introducing sub-objects would be inconsistent
- Flat fields with naming conventions sort together naturally (all `outlined*` fields, all `ghost*` fields)
- TypeScript provides type safety regardless of flat vs nested structure
- Sub-object grouping can be a follow-on refactoring if the flat approach proves unwieldy

**Implications:**
- Field naming convention: `{family}{State}{Property}` -- e.g., `outlinedActionFgRestTone`, `outlinedActionFgHoverTone`, `ghostActionFgRestI`
- Each emphasis family (outlined-action, outlined-agent, ghost-action, ghost-danger, ghost-option, outlined-option) needs ~6-10 per-state fields for fg tone, fg intensity, icon tone, icon intensity across rest/hover/active states
- Step 1 audit will produce the complete field enumeration; the plan estimates ~60-100 new fields beyond what is already documented in Spec S05
- DARK_PRESET and LIGHT_PRESET will be large but each field is a simple literal value -- no computed expressions

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Input:** `ThemeRecipe` (unchanged interface) -- see existing Spec S01 in engine source.

**Output:** `ThemeOutput` (unchanged interface) -- `{ name, mode, tokens, resolved, contrastResults, cvdWarnings }`.

The refactoring is purely internal. The public API contract is unchanged.

#### Terminology and Naming {#terminology}

**Table T01: Key Terms** {#t01-terms}

| Term | Definition |
|------|-----------|
| HueSlot | A named reference to a resolved hue angle. Recipe-relative (e.g., "canvas", "text") or fixed (e.g., "indigo-cobalt"). |
| ResolvedHueSlot | A HueSlot with warmth bias applied: `{ angle, name, ref }` |
| DerivationRule | An object defining how to derive a single token: hue slot, intensity expression, tone expression |
| ComputedTones | Pre-computed tone values derived from mood knobs and preset before rule evaluation |
| ModePreset | Mode-specific parameter bundle: numeric constants + hue slot assignments |

#### Internal Architecture {#internal-architecture}

**Spec S01: Three-layer derivation pipeline** {#s01-derivation-pipeline}

```
ThemeRecipe
    |
    v
[Layer 1: HueSlot Resolution]
    resolveHueSlots(recipe, warmth) --> ResolvedHueSlots
    - Recipe's 14 color picks --> resolved hue angles/refs
    - Warmth bias applied once
    - Per-tier hue derivations (bare base extraction, adjacency offsets)
    |
    v
[Layer 2: Tone Pre-computation]
    computeTones(preset, knobs) --> ComputedTones
    - Surface tone spreads from surfaceContrast
    - Signal intensity modulation
    - All derived tone values ready for rules
    |
    v
[Layer 3: Rule Evaluation]
    evaluateRules(rules, resolvedSlots, preset, computed, set*) --> tokens + resolved
    - Iterate 373 rules
    - Each rule: resolve hueSlot via dual path [D09]:
      direct ResolvedHueSlots key OR preset-mediated lookup
    - Call intensityExpr/toneExpr, dispatch to set* helper
    - Handle __white sentinel [D07], verbose highlights, structural+resolved
```

**Spec S02: ResolvedHueSlots interface** {#s02-resolved-hue-slots}

```typescript
interface ResolvedHueSlot {
  angle: number;   // Hue angle in degrees, warmth-biased
  name: string;    // Closest hue family name (e.g., "violet")
  ref: string;     // Formatted hue ref for --tug-color() (e.g., "violet-6")
  primaryName: string; // Primary color name for the hue (e.g., "violet")
}

interface ResolvedHueSlots {
  atm: ResolvedHueSlot;       // atmosphere (cardBg hue)
  txt: ResolvedHueSlot;       // text hue
  canvas: ResolvedHueSlot;    // canvas hue (bg-app, bg-canvas)
  cardFrame: ResolvedHueSlot; // card title bar hue
  borderTint: ResolvedHueSlot; // border/divider tint hue
  interactive: ResolvedHueSlot; // link/selection hue
  active: ResolvedHueSlot;    // active state hue
  accent: ResolvedHueSlot;    // accent hue
  // Semantic hues (resolved but no warmth bias)
  destructive: ResolvedHueSlot;
  success: ResolvedHueSlot;
  caution: ResolvedHueSlot;
  agent: ResolvedHueSlot;
  data: ResolvedHueSlot;
  // Per-tier derived hues (dark mode specific hue offsets)
  surfBareBase: ResolvedHueSlot;   // bare base of atm hue (last segment)
  surfScreen: ResolvedHueSlot;     // screen surface hue
  fgMuted: ResolvedHueSlot;        // fg-muted tier hue
  fgSubtle: ResolvedHueSlot;       // fg-subtle tier hue
  fgDisabled: ResolvedHueSlot;     // fg-disabled tier hue
  fgInverse: ResolvedHueSlot;      // fg-inverse tier hue
  fgPlaceholder: ResolvedHueSlot;  // fg-placeholder tier hue
  selectionInactive: ResolvedHueSlot; // selection-bg-inactive hue (dark: "yellow"; light: atmBaseAngle-20)
  borderTintBareBase: ResolvedHueSlot; // bare base of borderTint hue (last segment, same logic as surfBareBase but for borderTint)
}
```

**Spec S03: ComputedTones interface** {#s03-computed-tones}

```typescript
interface ComputedTones {
  // Surface tones (derived from preset + surfaceContrast)
  bgApp: number;
  bgCanvas: number;   // Note: light-mode uses a different formula (see below)
  surfaceSunken: number;
  surfaceDefault: number;
  surfaceRaised: number;
  surfaceOverlay: number;
  surfaceInset: number;
  surfaceContent: number;
  surfaceScreen: number;
  // Divider tones
  dividerDefault: number;
  dividerMuted: number;
  dividerTone: number; // shared reference for disabled/toggle/separator
  // Control/field derived tones
  disabledBgTone: number;
  disabledFgTone: number;
  disabledBorderTone: number;
  outlinedBgRestTone: number;
  outlinedBgHoverTone: number;
  outlinedBgActiveTone: number;
  toggleTrackOffTone: number;
  toggleDisabledTone: number;
  // Signal intensity
  signalI: number;
}
```

**Light-mode formula exceptions:** Not all tone computations follow the `preset.fieldTone + ((sc - 50) / 50) * scale` pattern. The `computeTones()` function must handle mode-specific formulas stored as preset fields:

- `bgCanvas`: Dark uses `Math.round(darkBgApp)` (i.e., shares the bgApp formula: `preset.bgAppTone + ((sc - 50) / 50) * 8`). Light uses a completely different formula: `Math.round(35 + (surfaceContrast / 100) * 10)`. A simple `bgCanvasBase + scale` parameterization cannot express the dark-mode "alias to bgApp" behavior. Solution: the preset stores `bgCanvasToneExpr` as a formula selector. In practice, `computeTones()` uses `preset.bgCanvasToneBase` and `preset.bgCanvasToneSCCenter` so that dark preset has `bgCanvasToneBase: preset.bgAppTone, bgCanvasToneSCCenter: 50, bgCanvasToneScale: 8` (same params as bgApp) and light preset has `bgCanvasToneBase: 35, bgCanvasToneSCCenter: 0, bgCanvasToneScale: 10` (anchored at 35, scaling with sc/100). The unified formula is: `Math.round(bgCanvasToneBase + ((sc - bgCanvasToneSCCenter) / (bgCanvasToneSCCenter === 0 ? 100 : 50)) * bgCanvasToneScale)`.
- `disabledBgTone`: Light uses `Math.round(70 + (sc / 100) * 10)`, dark uses a flat `22`.
- `borderMutedTone`, `borderStrongTone`, `dividerDefaultTone`, `dividerMutedTone`: Light-mode values are derived from `surfaceOverlay` or `fgSubtleTone` rather than flat constants.

These exceptions are absorbed by adding formula parameter fields to ModePreset (e.g., `bgCanvasBase`, `bgCanvasScale`) so that `computeTones()` uses `preset.bgCanvasBase + (sc / scDivisor) * preset.bgCanvasScale` uniformly. Step 1 audit will produce the complete list of formula exceptions.

**Spec S04: DerivationRule interface** {#s04-derivation-rule}

```typescript
// MoodKnobs: normalized mood knob values
interface MoodKnobs {
  surfaceContrast: number; // 0-100, default 50
  signalIntensity: number; // 0-100, default 50
  warmth: number;          // 0-100, default 50
}

// Shared expression type alias
type Expr = (preset: ModePreset, knobs: MoodKnobs, computed: ComputedTones) => number;

interface ChromaticRule {
  type: "chromatic";
  hueSlot: string; // Two resolution paths (see [D09]):
                   //   1. Direct key: if hueSlot is a key in ResolvedHueSlots (e.g., "accent",
                   //      "interactive", "destructive"), resolve directly. Used by ~130
                   //      mode-independent tokens.
                   //   2. Preset-mediated: if hueSlot is NOT a ResolvedHueSlots key, look up
                   //      preset[hueSlot + "HueSlot"] to get the ResolvedHueSlots key. Used by
                   //      ~50 mode-dependent tokens (e.g., hueSlot "bgApp" -> preset.bgAppHueSlot
                   //      -> "canvas" in dark, "txt" in light).
                   //   Sentinel values "__white", "__highlight", "__shadow",
                   //   "__verboseHighlight" trigger non-chromatic dispatch (see [D07]).
  intensityExpr: Expr;
  toneExpr: Expr;
  alphaExpr?: Expr; // default 100
}

interface WhiteRule { type: "white"; }

interface ShadowRule {
  type: "shadow";
  alphaExpr: Expr;
}

interface HighlightRule {
  type: "highlight";
  alphaExpr: Expr;
}

interface StructuralRule {
  type: "structural";
  valueExpr: (preset: ModePreset, knobs: MoodKnobs, computed: ComputedTones, resolvedSlots: ResolvedHueSlots) => string;
  resolvedExpr?: (preset: ModePreset, knobs: MoodKnobs, computed: ComputedTones) => ResolvedColor;
}

interface InvariantRule {
  type: "invariant";
  value: string;
}

type DerivationRule = ChromaticRule | WhiteRule | ShadowRule | HighlightRule | StructuralRule | InvariantRule;
```

**Rule dispatch semantics:**

- **ChromaticRule hueSlot resolution** ([D07], [D09]): The evaluator resolves `hueSlot` in three steps:
  1. **Resolve effective slot value**: Determine the effective slot string:
     - If `hueSlot` is a valid key in `ResolvedHueSlots` (e.g., `"accent"`, `"interactive"`, `"selectionInactive"`), the effective value IS `hueSlot` itself. This is the **direct key** path for ~130 mode-independent tokens.
     - Otherwise, look up `preset[hueSlot + "HueSlot"]` to get the effective value. This is the **preset-mediated** path for ~50 mode-dependent tokens (e.g., `hueSlot: "bgApp"` -> `preset.bgAppHueSlot` -> `"canvas"` or `"__highlight"`).
  2. **Sentinel check**: If the effective value is a sentinel, dispatch immediately:
     - `"__white"` -> call `setWhite()`. Skip all expression evaluation.
     - `"__highlight"` -> call `setHighlight(alphaExpr(...))`. Skip `intensityExpr`, `toneExpr`.
     - `"__shadow"` -> call `setShadow(alphaExpr(...))`. Skip `intensityExpr`, `toneExpr`.
     - `"__verboseHighlight"` -> emit `--tug-color(white, i: 0, t: 100, a: ${alphaExpr(...)})` and set resolved to `WHITE_RESOLVED` with alpha. Skip `intensityExpr`, `toneExpr`.
  3. **Chromatic resolution**: The effective value is a `ResolvedHueSlots` key. Look up the slot, call `setChromatic(slot.ref, slot.angle, intensityExpr(...), toneExpr(...), alphaExpr?.(...) ?? 100, slot.primaryName)`.

- **StructuralRule with `resolvedExpr`**: For tokens like `shadow-overlay` that have a composite string value (e.g., `"0 4px 16px --tug-color(black, a: 60)"`) but also need a resolved OKLCH entry. The `valueExpr` produces the token string; `resolvedExpr` produces the resolved color. StructuralRule is an escape hatch for truly irreducible structural differences (composite values); it should NOT be used for mode-conditional helper dispatch, which is handled by sentinels.

- **ChromaticRule hueName passing**: The evaluator passes `resolvedSlot.primaryName` as the `hueName` argument to `setChromatic()`, enabling correct canonical-L lookup in OKLCH resolution.

- **WhiteRule**: Used for tokens that are unconditionally white in all modes (no mode branching, no alpha). Distinct from `"__white"` sentinel (mode-conditional white/chromatic dispatch) and from HighlightRule (white with alpha). WhiteRule produces a direct `setWhite()` call with no preset lookup or expression evaluation.

**Spec S05: ModePreset hue slot extensions** {#s05-preset-hue-slots}

New fields added to ModePreset for mode-dependent tokens only (~50 tokens). Mode-independent tokens (~130 tokens using accent, active, interactive, destructive, etc.) bypass preset and reference ResolvedHueSlots keys directly per [D09]. Each preset hue slot field names a key in ResolvedHueSlots or the special value `"__white"`.

```typescript
// Added to ModePreset interface:
{
  // Surface hue slots (which resolved hue to use per surface tier)
  bgAppHueSlot: string;         // "canvas" (dark) | "txt" (light)
  bgCanvasHueSlot: string;      // "canvas" (dark) | "atm" (light)
  surfaceSunkenHueSlot: string;  // "surfBareBase" (dark) | "atm" (light)
  surfaceDefaultHueSlot: string; // "surfBareBase" (dark) | "atm" (light)
  surfaceRaisedHueSlot: string;  // "atm" (dark) | "txt" (light)
  surfaceOverlayHueSlot: string; // "surfBareBase" (dark) | "atm" (light)
  surfaceInsetHueSlot: string;   // "atm" (dark) | "atm" (light)
  surfaceContentHueSlot: string; // "atm" (dark) | "atm" (light)
  surfaceScreenHueSlot: string;  // "surfScreen" (dark) | "txt" (light)

  // Foreground hue slots
  fgMutedHueSlot: string;       // "fgMuted" (dark) | "txt" (light)
  fgSubtleHueSlot: string;      // "fgSubtle" (dark) | "txt" (light)
  fgDisabledHueSlot: string;    // "fgDisabled" (dark) | "txt" (light)
  fgPlaceholderHueSlot: string;  // "fgPlaceholder" (dark) | "atm" (light)
  fgInverseHueSlot: string;     // "fgInverse" (dark) | "txt" (light)
  fgOnAccentHueSlot: string;    // "fgInverse" (dark) | "__white" (light)

  // Icon hue slots
  iconMutedHueSlot: string;     // "fgSubtle" (dark) | "atm" (light)
  iconOnAccentHueSlot: string;  // "fgInverse" (dark) | "__white" (light)

  // Border/divider hue slots
  dividerMutedHueSlot: string;  // "borderTintBareBase" (dark) | "borderTint" (light)

  // Per-tier intensity overrides (where dark/light differ in intensity, not just hue)
  // Surface intensities
  bgAppI: number;               // 2 (dark) | atmI (light)
  bgCanvasI: number;            // 2 (dark) | 7 (light)
  surfaceDefaultI: number;      // atmI (dark) | 4 (light)
  surfaceRaisedI: number;       // atmI (dark) | 5 (light)
  surfaceOverlayI: number;      // 4 (dark) | 6 (light) -- already exists as preset.surfaceOverlayI
  surfaceInsetI: number;        // atmI (dark) | 4 (light)
  surfaceContentI: number;      // atmI (dark) | 4 (light)
  surfaceScreenI: number;       // txtISubtle (dark) | 4 (light)

  // Foreground intensities
  fgInverseI: number;           // txtI (dark) | 1 (light)
  fgOnCautionI: number;         // 4 (dark) | atmI (light)
  fgOnSuccessI: number;         // 4 (dark) | atmI (light)

  // Divider intensity
  dividerDefaultI: number;      // 6 (dark) | atmI (light)
  dividerMutedI: number;        // 4 (dark) | atmI (light)

  // Border/divider mode-dependent tones
  borderMutedTone: number;      // fgSubtleTone (dark) | 36 (light)
  borderMutedI: number;         // borderIStrong (dark) | 10 (light)
  borderStrongTone: number;     // 40 (dark) | fgSubtleTone-6 (light)

  // Control/field mode-dependent tones and intensities [D10]
  // ~60-100 flat fields with naming convention {family}{State}{Property}.
  // Full enumeration produced by Step 1 audit. Representative examples by family:
  //
  // Key insight for outlined/ghost fg/icon tokens:
  // Dark mode uses UNIFORM values across ALL states (rest/hover/active identical):
  //   tone = filledFgTone (= 100), intensity = Math.max(1, txtI - 1) (= 2 for Brio)
  // Light mode has PER-STATE variation (different tones and intensities per state).
  //
  // This means dark values collapse to 2 shared fields per family, while light
  // needs ~6 per-state fields. The preset can use either:
  //   (a) Per-state fields for both modes (uniform dark values repeated), or
  //   (b) Shared dark fields + per-state light fields
  // Step 1 audit will determine the best layout. Representative fields:
  //
  // Outlined-action fg/icon:
  outlinedActionFgTone: number;       // 100 (dark, = filledFgTone, all states) | per-state (light)
  outlinedActionFgI: number;          // 2 (dark, = max(1, txtI-1), all states) | per-state (light)
  outlinedActionFgRestToneLight: number;  // N/A (dark) | fgDefaultTone (light)
  outlinedActionFgHoverToneLight: number; // N/A (dark) | 10 (light)
  outlinedActionFgActiveToneLight: number;// N/A (dark) | 8 (light)
  outlinedActionIconRestToneLight: number;  // N/A (dark) | fgMutedTone (light)
  outlinedActionIconHoverToneLight: number; // N/A (dark) | 22 (light)
  outlinedActionIconActiveToneLight: number;// N/A (dark) | 13 (light)
  //
  // Ghost-action fg/icon/border:
  ghostActionFgTone: number;          // 100 (dark, = filledFgTone, all states) | per-state (light)
  ghostActionFgI: number;             // 2 (dark, = max(1, txtI-1), all states) | per-state (light)
  ghostActionFgRestToneLight: number; // N/A (dark) | fgMutedTone (light)
  ghostActionFgHoverToneLight: number;// N/A (dark) | 15 (light)
  ghostActionFgActiveToneLight: number;// N/A (dark) | 10 (light)
  ghostActionFgRestILight: number;    // N/A (dark) | txtISubtle (light)
  ghostActionFgHoverILight: number;   // N/A (dark) | 9 (light)
  ghostActionFgActiveILight: number;  // N/A (dark) | 9 (light)
  ghostActionBorderI: number;         // 20 (dark) | 10 (light)
  ghostActionBorderTone: number;      // 60 (dark) | 35 (light)
  //
  // NOTE: The dual-layout (shared dark + per-state light) shown above is one option.
  // If Step 1 audit reveals it's cleaner to use per-state fields for BOTH modes
  // (with dark values simply repeated), that is also acceptable. The rule's
  // intensityExpr/toneExpr reads whichever fields exist.
  //
  // Similar patterns for: outlined-agent, ghost-danger, outlined-option, ghost-option,
  // toggle (track/thumb states), field (bg/border states), badge-tinted, tab fg.
  // Total: ~60-100 additional fields across all emphasis families.
  //
  iconActiveTone: number;       // 80 (dark) | 22 (light)
  tabFgActiveTone: number;      // 90 (dark) | fgDefaultTone (light)

  // Formula parameter fields for non-standard tone computations
  // bgCanvas: dark reuses bgApp formula, light uses independent formula (see Spec S03 exceptions)
  bgCanvasToneBase: number;     // bgAppTone (dark, = 5) | 35 (light)
  bgCanvasToneSCCenter: number; // 50 (dark, same center as bgApp) | 0 (light, anchored at 0)
  bgCanvasToneScale: number;    // 8 (dark, same scale as bgApp) | 10 (light)
  disabledBgBase: number;       // 22 (dark, flat) | 70 (light)
  disabledBgScale: number;      // 0 (dark) | 10 (light)

  // Alpha values for sentinel-dispatched tokens (see [D07])
  tabBgHoverAlpha: number;      // 8 (dark, highlight) | 6 (light, shadow)
  tabCloseBgHoverAlpha: number; // 12 (dark, highlight) | 10 (light, shadow)
  outlinedBgHoverAlpha: number; // 10 (dark, highlight) | N/A (light, chromatic)
  outlinedBgActiveAlpha: number;// 20 (dark, highlight) | N/A (light, chromatic)
  ghostActionBgHoverAlpha: number;  // 10 (dark, highlight) | 6 (light, shadow)
  ghostActionBgActiveAlpha: number; // 20 (dark, highlight) | 12 (light, shadow)
  ghostOptionBgHoverAlpha: number;  // 10 (dark, highlight) | 6 (light, shadow)
  ghostOptionBgActiveAlpha: number; // 20 (dark, highlight) | 12 (light, shadow)

  // Sentinel hue slot fields for tokens that switch helper type per mode (see [D07])
  outlinedBgHoverHueSlot: string;  // "__highlight" (dark) | "atm" (light)
  outlinedBgActiveHueSlot: string; // "__highlight" (dark) | "atm" (light)
  ghostActionBgHoverHueSlot: string;  // "__highlight" (dark) | "__shadow" (light)
  ghostActionBgActiveHueSlot: string; // "__highlight" (dark) | "__shadow" (light)
  ghostOptionBgHoverHueSlot: string;  // "__highlight" (dark) | "__shadow" (light)
  ghostOptionBgActiveHueSlot: string; // "__highlight" (dark) | "__shadow" (light)
  tabBgHoverHueSlot: string;       // "__highlight" (dark) | "__shadow" (light)
  tabCloseBgHoverHueSlot: string;  // "__highlight" (dark) | "__shadow" (light)
  highlightHoverHueSlot: string;  // "__verboseHighlight" (dark) | "__shadow" (light)
  highlightHoverAlpha: number;    // 5 (dark) | 4 (light)
}
```

**Note on completeness:** The fields shown above are representative. The Step 1 audit (List L01) will produce the definitive, complete enumeration of all mode-dependent fields. The total ModePreset will have ~130-170 fields: ~50 existing numeric fields + ~20 hue slot fields + ~10 sentinel hue slot fields + ~10 alpha/formula fields + ~60-100 per-state control emphasis fields per [D10]. Each of the 81 `isLight` grep occurrences (see List L01 note on counting) maps to one or more preset fields. No ellipsis or "additional fields as needed" -- every field will be enumerated before coding begins.

**List L01: All 81 isLight branches by category** {#l01-islight-branches}

| Category | Count | Absorption target |
|----------|-------|-------------------|
| Surface hue selection | 18 | Preset hue slot fields (Spec S05) |
| Foreground hue selection | 12 | Preset hue slot fields (Spec S05) |
| Border/divider hue + tone | 8 | Preset hue slot + tone fields |
| Control emphasis (filled/outlined/ghost) | 24 | Preset numeric + hue slot fields |
| Toggle/field/badge | 12 | Preset numeric fields |
| Icon hue selection | 4 | Preset hue slot fields |
| Miscellaneous tone/intensity | 3 | Preset numeric fields |
| No-op branches (identical in both modes) | ~1 | Remove branch; single mode-agnostic rule (e.g., tab-bg-collapsed) |
| **Total** | **81** | grep occurrences (some lines contain multiple ternaries; ~65-70 distinct branch decisions) |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `src/components/tugways/derivation-rules.ts` | Rule table (Record<string, DerivationRule>) with 373 entries, grouped by token category. Separating the rule table from the engine keeps both files manageable (~1500-1900 lines for rules, ~400-500 lines for engine). |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ResolvedHueSlot` | interface | `theme-derivation-engine.ts` | Per Spec S02 |
| `ResolvedHueSlots` | interface | `theme-derivation-engine.ts` | Per Spec S02 |
| `MoodKnobs` | interface | `theme-derivation-engine.ts` | Per Spec S04 |
| `ComputedTones` | interface | `theme-derivation-engine.ts` | Per Spec S03 |
| `ChromaticRule` | interface | `theme-derivation-engine.ts` | Per Spec S04 |
| `WhiteRule` | interface | `theme-derivation-engine.ts` | Per Spec S04 |
| `ShadowRule` | interface | `theme-derivation-engine.ts` | Per Spec S04 |
| `HighlightRule` | interface | `theme-derivation-engine.ts` | Per Spec S04, with `verbose` flag |
| `StructuralRule` | interface | `theme-derivation-engine.ts` | Per Spec S04, with `resolvedExpr` |
| `InvariantRule` | interface | `theme-derivation-engine.ts` | Per Spec S04 |
| `DerivationRule` | type union | `theme-derivation-engine.ts` | Per Spec S04 |
| `resolveHueSlots()` | fn | `theme-derivation-engine.ts` | Layer 1: recipe + warmth -> ResolvedHueSlots |
| `computeTones()` | fn | `theme-derivation-engine.ts` | Layer 2: preset + knobs -> ComputedTones |
| `evaluateRules()` | fn | `theme-derivation-engine.ts` | Layer 3: rules + slots + preset -> tokens |
| `RULES` | const | `derivation-rules.ts` | Record<string, DerivationRule> with 373 entries; exported for engine import |
| `ModePreset` | interface (modify) | `theme-derivation-engine.ts` | Add ~80-120 fields: ~20 hue slot + ~10 sentinel hue slot + ~10 alpha/formula + ~60-100 per-state control fields per [D10] |
| `DARK_PRESET` | const (modify) | `theme-derivation-engine.ts` | Add hue slot and type discriminator values |
| `LIGHT_PRESET` | const (modify) | `theme-derivation-engine.ts` | Add hue slot and type discriminator values |
| `applyWarmthBias()` | fn (move) | `theme-derivation-engine.ts` | Move from inside deriveTheme to module scope |
| `primaryColorName()` | fn (move) | `theme-derivation-engine.ts` | Move from inside deriveTheme to module scope |

---

### Documentation Plan {#documentation-plan}

- [ ] Update module-level JSDoc in `theme-derivation-engine.ts` to describe the three-layer pipeline architecture
- [ ] Add JSDoc to each new interface (`ResolvedHueSlot`, `ComputedTones`, `DerivationRule`, `MoodKnobs`)
- [ ] Add JSDoc to each new function (`resolveHueSlots`, `computeTones`, `evaluateRules`)
- [ ] Update inline comments in ModePreset to document all new hue slot and formula fields
- [ ] Fix token count in module header JSDoc (currently says 350, actual is 373)

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Contract (T-BRIO-MATCH)** | Engine output matches Brio ground truth within delta-E < 0.02 | Every step; primary regression gate |
| **Token count** | Exactly 373 tokens in output | Every step; hard constraint |
| **Generated CSS diff** | `bun run generate:tokens` output matches baseline | Every step; catches any token value drift |
| **Unit** | ComputedTones, resolveHueSlots, rule evaluation in isolation | Steps 2-4 |
| **Integration** | Full deriveTheme() pipeline with both presets | Steps 5-7 |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Baseline capture and isLight branch audit {#step-1}

**Commit:** `refactor: capture baseline and audit isLight branches`

**References:** [D01] ModePreset absorbs hue switching, List L01, Risk R01, (#context, #strategy)

**Artifacts:**
- Baseline snapshot of `bun run generate:tokens` output saved to `.tugtool/baseline-tokens.css`
- Audit document: `.tugtool/islight-audit.md` cataloging all 81 isLight branches with their category, line number, and proposed absorption target

**Tasks:**
- [ ] Run `bun run generate:tokens` and save output as baseline for diff comparison
- [ ] Run `cd tugdeck && bun test` to confirm all tests pass at start
- [ ] Audit all 81 `isLight` branches in `theme-derivation-engine.ts`, categorizing each by type (hue selection, tone value, intensity value, structural)
- [ ] For each branch, document: current dark value, current light value, proposed preset field name. Track all four possible difference types: hue slot, intensity, tone, and alpha.
- [ ] Verify that all branches can be expressed as preset field differences (confirm List L01 is accurate, including alpha differences)

**Tests:**
- [ ] T-BASELINE: `bun run generate:tokens` output captured successfully
- [ ] T-AUDIT: All 81 isLight branches accounted for in audit

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `bun run generate:tokens` output matches pre-existing CSS (no changes from this step)

---

#### Step 2: Extend ModePreset with hue slot fields {#step-2}

**Depends on:** #step-1

**Commit:** `refactor: extend ModePreset with hue slot fields`

**References:** [D01] ModePreset absorbs hue switching, [D04] Per-tier hue derivation, [D07] Sentinel hue slots, [D10] Flat preset fields, Spec S05, (#design-decisions)

**Artifacts:**
- Extended `ModePreset` interface with ~80-120 new fields: ~20 hue slot fields, ~10 sentinel hue slot fields, ~10 alpha/formula fields, ~60-100 per-state control emphasis fields per [D10]
- Updated `DARK_PRESET` and `LIGHT_PRESET` with all new field values from Step 1 audit

**Tasks:**
- [ ] Add hue slot fields to `ModePreset` interface per Spec S05
- [ ] Add sentinel hue slot fields for mode-conditional dispatch per [D07] (outlined bg, ghost bg, tab bg, highlight-hover)
- [ ] Add per-state control emphasis fields using flat `{family}{State}{Property}` naming per [D10]
- [ ] Populate `DARK_PRESET` hue slot fields from current inline dark-mode hue assignments (e.g., `bgAppHueSlot: "canvas"`, `surfaceSunkenHueSlot: "surfBareBase"`)
- [ ] Populate `LIGHT_PRESET` hue slot fields from current inline light-mode hue assignments (e.g., `bgAppHueSlot: "txt"`, `surfaceSunkenHueSlot: "atm"`)
- [ ] Add per-tier intensity, tone, and alpha fields where dark/light use different values
- [ ] Ensure existing code still compiles and all existing preset field usages unchanged

**Tests:**
- [ ] T-TYPES: TypeScript compiles with no errors
- [ ] T-PRESET-COMPLETE: Both presets have all new fields populated

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes (no behavioral change yet)
- [ ] `bun run generate:tokens` output matches baseline

---

#### Step 3: Implement resolveHueSlots() {#step-3}

**Depends on:** #step-2

**Commit:** `refactor: implement resolveHueSlots for centralized hue resolution`

**References:** [D06] HueSlot resolution with warmth bias, Spec S01, Spec S02, (#internal-architecture)

**Artifacts:**
- New `resolveHueSlots(recipe: ThemeRecipe, warmth: number): ResolvedHueSlots` function
- New `ResolvedHueSlots` and `ResolvedHueSlot` interfaces

**Tasks:**
- [ ] Define `ResolvedHueSlot` and `ResolvedHueSlots` interfaces per Spec S02
- [ ] Implement `resolveHueSlots()` that:
  - Resolves all recipe hue angles (atm, txt, canvas, cardFrame, borderTint, interactive, active, accent, semantic)
  - Applies warmth bias to achromatic-adjacent hues (existing `applyWarmthBias` logic)
  - Derives per-tier hues (bare base extraction, fg-muted/subtle/disabled/inverse offsets)
  - Derives computed hues: `selectionInactive` (dark: fixed "yellow"; light: atmBaseAngle - 20 with warmth bias), `borderTintBareBase` (bare base extraction of borderTint hue, same logic as surfBareBase)
  - Returns complete `ResolvedHueSlots` object
- [ ] Extract `ACHROMATIC_ADJACENT_HUES`, `primaryColorName()`, and `applyWarmthBias()` to module scope (currently inside deriveTheme)
- [ ] Call `resolveHueSlots()` in deriveTheme() alongside existing code (parallel, not replacing yet)
- [ ] Add assertion that resolveHueSlots output matches existing inline variables for Brio recipe

**Tests:**
- [ ] T-RESOLVE: resolveHueSlots(EXAMPLE_RECIPES.brio, 50) produces expected angle/name/ref for each slot
- [ ] T-WARMTH: warmth bias produces correct angle shifts for achromatic-adjacent hues
- [ ] T-BARE-BASE: bare base extraction returns "violet" for "indigo-violet" atmosphere

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `bun run generate:tokens` output matches baseline

---

#### Step 4: Implement computeTones() {#step-4}

**Depends on:** #step-2

**Commit:** `refactor: implement computeTones for pre-computed tone values`

**References:** [D03] Pre-computed ComputedTones, Spec S01, Spec S03, (#internal-architecture)

**Artifacts:**
- New `ComputedTones` interface per Spec S03
- New `MoodKnobs` interface
- New `computeTones(preset: ModePreset, knobs: MoodKnobs): ComputedTones` function

**Tasks:**
- [ ] Define `MoodKnobs` interface per Spec S04
- [ ] Define `ComputedTones` interface per Spec S03
- [ ] Implement `computeTones()` that computes all derived tones from preset and mood knobs:
  - Surface tone spreads (darkBgApp, darkBgCanvas, darkSurfaceSunken, etc.) from sections 3-3a of current deriveTheme
  - Divider tones (dividerDefaultTone, dividerMutedTone, dividerTone)
  - Signal intensity (signalI)
- [ ] Call `computeTones()` in deriveTheme() alongside existing inline computations
- [ ] Add assertion that computeTones output matches existing inline values for Brio recipe at surfaceContrast=50

**Tests:**
- [ ] T-TONES-DARK: computeTones(DARK_PRESET, {surfaceContrast: 50, signalIntensity: 50, warmth: 50}) matches Brio dark ground truth
- [ ] T-TONES-LIGHT: computeTones(LIGHT_PRESET, {surfaceContrast: 50, ...}) matches current light-mode inline values
- [ ] T-TONES-SC: surfaceContrast=0 and surfaceContrast=100 produce expected extremes

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `bun run generate:tokens` output matches baseline

---

#### Step 5: Build derivation rule table for core visual tokens {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `refactor: build derivation rules for core visual tokens`

**References:** [D02] Derivation rule format, [D05] set* helpers preserved, [D07] __white sentinel, [D09] Dual hueSlot resolution, Spec S04, Spec S01, (#inputs-outputs, #internal-architecture)

**Artifacts:**
- `DerivationRule` type union and related interfaces per Spec S04 in `theme-derivation-engine.ts`
- New file `src/components/tugways/derivation-rules.ts` with rule table entries for core visual tokens: surfaces (~9), foreground (~8), icon (~5), borders/dividers (~8), elevation/overlay (~8), invariants (~85)
- Rule evaluation function `evaluateRules()` in `theme-derivation-engine.ts`

**Tasks:**
- [ ] Define `DerivationRule` type union per Spec S04 (ChromaticRule, WhiteRule, ShadowRule, HighlightRule, StructuralRule with `resolvedExpr`, InvariantRule)
- [ ] Build rule entries for section A (Core Visual) of deriveTheme:
  - Surface tokens (bg-app, bg-canvas, surface-sunken/default/raised/overlay/inset/content/screen)
  - Foreground tokens (fg-default, fg-muted, fg-subtle, fg-disabled, fg-inverse, fg-placeholder, fg-link, fg-link-hover, fg-onAccent, fg-onDanger, fg-onCaution, fg-onSuccess)
  - Icon tokens (icon-default, icon-muted, icon-disabled, icon-active, icon-onAccent)
  - Border/divider tokens
  - Elevation/overlay tokens: shadow-xs/md/lg/xl as ShadowRule; shadow-overlay as StructuralRule with resolvedExpr (composite `"0 4px 16px ..."` value); overlay-dim/scrim as ShadowRule; overlay-highlight as ChromaticRule with hueSlot resolving to `__verboseHighlight` sentinel (verbose white form per ground truth)
  - Invariant tokens (typography, spacing, radius, chrome, icons, strokes)
- [ ] Implement `evaluateRules()` that iterates rules and for each ChromaticRule: (1) resolves effective slot value via dual path per [D09], (2) checks for sentinels `__white`/`__highlight`/`__shadow`/`__verboseHighlight` per [D07], (3) for non-sentinel values, resolves to ResolvedHueSlot and calls `setChromatic()` with `resolvedSlot.primaryName` as `hueName`. Dispatches non-chromatic rules to appropriate set* helpers (HighlightRule, ShadowRule, StructuralRule with `resolvedExpr`, WhiteRule, InvariantRule).
- [ ] Run evaluateRules() in parallel with existing imperative code; assert output matches for all core visual tokens

**Tests:**
- [ ] T-RULES-SURFACES: Rule-derived surface tokens match imperative output for Brio dark
- [ ] T-RULES-FG: Rule-derived foreground tokens match imperative output
- [ ] T-RULES-INVARIANT: All invariant tokens present and correct

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `bun run generate:tokens` output matches baseline

---

#### Step 6: Build derivation rules for semantic and control tokens {#step-6}

**Depends on:** #step-5

**Commit:** `refactor: build derivation rules for semantic and control tokens`

**References:** [D02] Derivation rule format, [D01] ModePreset hue slots, [D07] __white sentinel, Spec S04, List L01, (#internal-architecture)

**Artifacts:**
- Rule table entries in `derivation-rules.ts` for: accent family (~10), semantic families (destructive, success, caution, agent, data: ~50), selection/highlight (~5), card frame (~4), control emphasis tokens (filled, outlined, ghost, toggle, field, badge, tab: ~170)

**Tasks:**
- [ ] Build rules for accent tokens (accent-default, accent-muted, accent-strong, accent-onAccent, accent-bg)
- [ ] Build rules for semantic hue families (destructive, success, caution, agent, data) — each has default/muted/strong/bg/onBg pattern
- [ ] Build rules for selection/highlight tokens
- [ ] Build rules for card frame tokens (frame-active-bg, frame-inactive-bg, etc.)
- [ ] Build rules for all control emphasis tokens:
  - Filled (bg, fg, border for rest/hover/active states)
  - Outlined (bg via sentinel hue slots per [D07], fg/icon with 6-8 per-state tone/intensity preset fields per emphasis family, border for rest/hover/active states)
  - Ghost (bg via sentinel hue slots per [D07], fg/icon with 6-8 per-state tone/intensity preset fields per emphasis family, border for rest/hover/active states)
  - Disabled (bg, fg, border)
  - Tab emphasis tokens (tab-bg-hover and tab-close-bg-hover use mode-conditional shadow/highlight dispatch per [D07])
  - Toggle tokens (track, thumb for on/off states)
  - Highlight tokens (highlight-hover uses `__verboseHighlight` sentinel in dark, `__shadow` in light per [D07])
  - Field tokens (bg, border for rest/hover/focus/disabled/read-only states)
  - Badge tinted tokens
  - Outlined-option and ghost-option tokens
- [ ] Run evaluateRules() for all new rules in parallel with imperative code; assert output matches

**Tests:**
- [ ] T-RULES-SEMANTIC: All semantic hue family tokens match imperative output
- [ ] T-RULES-CONTROLS: All control emphasis tokens match imperative output
- [ ] T-RULES-COMPLETE: Rule table has exactly 373 entries
- [ ] T-RULES-DARK-MATCH: All rule-derived dark tokens match imperative output (both Steps 5 and 6 combined)
- [ ] T-RULES-LIGHT-MATCH: All rule-derived light tokens match imperative output

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] Rule-derived output matches imperative output for all 373 tokens (both modes)
- [ ] `bun run generate:tokens` output matches baseline

---

#### Step 7: Replace imperative code with rule evaluation {#step-7}

**Depends on:** #step-6

**Commit:** `refactor: replace imperative deriveTheme body with rule evaluation loop`

**References:** [D01] ModePreset absorbs hue switching, [D02] Derivation rule format, [D03] ComputedTones, [D06] HueSlot resolution, [D07] __white sentinel, [D09] Dual hueSlot resolution, Spec S01, Risk R01, (#internal-architecture, #success-criteria)

**Artifacts:**
- `deriveTheme()` body rewritten: calls resolveHueSlots(), computeTones(), evaluateRules()
- All imperative set* call sequences removed
- All `isLight` branches in token derivation removed

**Tasks:**
- [ ] Replace deriveTheme() body:
  1. `const knobs = { surfaceContrast, signalIntensity, warmth }` (normalize mood knobs)
  2. `const resolvedSlots = resolveHueSlots(recipe, warmth)` (Layer 1)
  3. `const computed = computeTones(preset, knobs)` (Layer 2)
  4. `evaluateRules(RULES, resolvedSlots, preset, knobs, computed, tokens, resolved)` (Layer 3)
- [ ] Remove all imperative set* call sequences (sections A through end of current deriveTheme)
- [ ] Remove all inline hue resolution variables (atmAngleW, txtRefW, surfBareBaseRef, etc.) — now in resolveHueSlots
- [ ] Remove all inline tone computations (darkBgApp, darkSurfaceSunken, etc.) — now in computeTones
- [ ] Remove `isLight` variable and all branches
- [ ] Keep seed hue resolution (section 1) and mood knob normalization (section 2) as they feed into resolveHueSlots and computeTones

**Tests:**
- [ ] T-NO-ISLIGHT: `grep -c "isLight" theme-derivation-engine.ts` returns 0 (or only in comments/docs)
- [ ] T-BRIO-MATCH passes
- [ ] All existing tests pass without modification

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `bun run generate:tokens` output matches baseline
- [ ] `grep "isLight" src/components/tugways/theme-derivation-engine.ts | grep -v "^.*\/\/"` returns no results (no isLight outside comments)

---

#### Step 8: Cleanup and documentation {#step-8}

**Depends on:** #step-7

**Commit:** `refactor: cleanup declarative derivation engine and update docs`

**References:** [D01] ModePreset absorbs hue switching, [D02] Derivation rule format, (#context, #success-criteria)

**Artifacts:**
- Updated module-level JSDoc in theme-derivation-engine.ts describing the three-layer architecture
- Removed `.tugtool/baseline-tokens.css` and `.tugtool/islight-audit.md` (temporary artifacts)
- Updated decision references in source comments

**Tasks:**
- [ ] Update module-level JSDoc to describe the three-layer pipeline (HueSlot resolution, ComputedTones, rule evaluation)
- [ ] Fix token count in module header JSDoc (currently says "350-token" but actual count is 373)
- [ ] Update/remove stale inline comments referencing old imperative structure
- [ ] Remove parallel-run assertion code added in Steps 3-5 (the "alongside existing code" scaffolding)
- [ ] Remove temporary baseline/audit files
- [ ] Verify all exported symbols still exported (no accidental removal of public API)

**Tests:**
- [ ] T-EXPORTS: All currently-exported symbols are still exported
- [ ] T-BRIO-MATCH passes

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `bun run generate:tokens` output matches baseline
- [ ] `theme-derivation-engine.ts` is ~900-1100 lines (types, expanded ModePreset with ~130-170 fields, DARK_PRESET/LIGHT_PRESET literals, set* helpers, resolveHueSlots, computeTones, evaluateRules, pipeline orchestration)
- [ ] `derivation-rules.ts` is ~1500-1900 lines (rule table with 373 entries grouped by category)
- [ ] Combined ~2400-3000 lines is larger than original 2082 but cleanly separated into engine vs rules, with all mode logic expressed as data rather than branches

---

#### Step 9: Final integration checkpoint {#step-9}

**Depends on:** #step-7, #step-8

**Commit:** `N/A (verification only)`

**References:** Risk R01, Risk R02, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run full test suite: `cd tugdeck && bun test`
- [ ] Verify T-BRIO-MATCH passes
- [ ] Verify token count is exactly 373
- [ ] Verify `bun run generate:tokens` output matches original baseline from Step 1
- [ ] Verify zero `isLight` branches in token derivation code
- [ ] Review rule table organization and grouping for maintainability

**Tests:**
- [ ] T-FINAL-BRIO: T-BRIO-MATCH passes end-to-end
- [ ] T-FINAL-COUNT: Token count is exactly 373
- [ ] T-FINAL-GENERATE: `bun run generate:tokens` output matches baseline

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes with 0 failures
- [ ] `bun run generate:tokens` output is byte-identical to pre-refactor baseline
- [ ] `grep -c "isLight" src/components/tugways/theme-derivation-engine.ts` shows only comments/documentation references

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A declarative three-layer theme derivation engine that produces identical output to the current imperative implementation, with zero isLight branches in token derivation.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] T-BRIO-MATCH passes (delta-E < 0.02 for all tokens)
- [ ] Token count is exactly 373 (`bun test` T2.1)
- [ ] `bun run generate:tokens` output is byte-identical to pre-refactor baseline
- [ ] Zero `isLight` branches in rule evaluation / token derivation code
- [ ] All existing tests pass without modification
- [ ] ModePreset interface fully documents hue slot fields with dark/light values

**Acceptance tests:**
- [ ] T-BRIO-MATCH: Engine output matches Brio ground truth fixture
- [ ] T-TOKEN-COUNT: deriveTheme produces exactly 373 tokens
- [ ] T-GENERATE: `bun run generate:tokens` output unchanged
- [ ] T-NO-ISLIGHT: No isLight branches in token derivation

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Light theme visual tuning: create hand-authored light-mode ground truth fixture, tune LIGHT_PRESET values
- [ ] New mode presets: high-contrast mode, reduced-motion mode
- [ ] Rule table DSL: if rule table proves unwieldy, consider a more compact notation
- [ ] Recipe validation: validate ThemeRecipe fields before derivation
- [ ] Performance: benchmark rule evaluation loop vs imperative code; optimize if needed

| Checkpoint | Verification |
|------------|--------------|
| T-BRIO-MATCH | `cd tugdeck && bun test --grep "T-BRIO-MATCH"` |
| Token count | `cd tugdeck && bun test --grep "T2.1"` |
| Generated tokens | `bun run generate:tokens && diff baseline output` |
| No isLight | `grep -c "isLight" src/components/tugways/theme-derivation-engine.ts` |
