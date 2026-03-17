<!-- tugplan-skeleton v2 -->

## Theme Generator Card with Accessibility Engine {#theme-generator}

**Purpose:** Ship a Theme Generator gallery card that derives complete 264-token themes from seed colors + mood parameters, validates all pairings for WCAG 2.x + perceptual contrast, simulates color vision deficiency via Machado et al. 2009 matrices, and supports high-contrast / reduced-contrast accessibility modes.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | theme-generator |
| Last updated | 2026-03-12 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Tugways design system defines 264 `--tug-base-*` semantic tokens in `tug-base.css`, with three hand-authored themes (Brio, Bluenote, Harmony) providing overrides. Creating a new theme today requires manually deriving every token value — a process that is slow, error-prone, and disconnected from contrast validation. The existing Harmony theme carries `[D06]` contrast-critical overrides that exist only because there is no automated contrast checking at theme-authoring time.

The Palette Engine card (`gallery-palette`) already demonstrates the interactive pattern: swatches, sliders, grids, export/import. The `palette-engine.ts` module provides OKLCH math primitives (`tugColor()`, `oklchToHex()`, `oklchToLinearSRGB()`, gamut checking). A Theme Generator card extends both of these foundations to produce complete, accessibility-validated themes from a compact recipe.

#### Strategy {#strategy}

- **Layer 1 first:** Build the derivation engine (`theme-derivation-engine.ts`) that maps a `ThemeRecipe` to all 264 tokens. Validate by regenerating Bluenote and Harmony from recipes and diff-comparing.
- **Layer 2 second:** Build the accessibility module (`theme-accessibility.ts`) with WCAG 2.x contrast, perceptual contrast calculation, and CVD simulation matrices. Wire it to an authoritative pairing map.
- **Layer 3 third:** Build the Theme Generator gallery card UI with seed selectors, mood sliders, contrast dashboard, and token preview. Follow existing gallery card patterns.
- **Layer 4 last:** Add the CVD preview strip and auto-fix loop. This layer depends on Layers 1-3 being stable.
- **Integration checkpoints** after each layer group verify end-to-end correctness before proceeding.
- **Export format is `--tug-color()` notation**, matching existing theme file patterns (Brio, Bluenote, Harmony). Requires `postcss-tug-color` at build time — no runtime overhead.
- **Explicit pairing map** is an authoritative deliverable that declares which fg tokens check against which bg tokens, ensuring the contrast dashboard is correct.

#### Success Criteria (Measurable) {#success-criteria}

- Theme Generator derives a theme from a recipe and the output diff (compared at resolved OKLCH level) against the tokens Bluenote explicitly overrides is less than 5% of the override subset, i.e., fewer than ~2 of ~30 overridden tokens exceed the perceptual delta-E threshold (verify: automated golden test)
- All generated themes pass WCAG AA for body text (4.5:1) and UI components (3:1) as measured by the built-in contrast dashboard (verify: unit tests against pairing map)
- CVD simulation produces visually correct transforms for protanopia, deuteranopia, tritanopia (verify: compare against published Coblis reference swatches, unit tests with known matrix outputs)
- Theme Generator card registers as `gallery-theme-generator` in the Component Gallery and appears as tab 15 (verify: gallery card test)
- Export produces valid CSS that loads without postcss errors (verify: round-trip test — generate, export, import into postcss pipeline)

#### Scope {#scope}

1. `theme-derivation-engine.ts` — role formula catalog, recipe-to-token derivation for all 264 `--tug-base-*` tokens (base tier only; component-level tokens like `--tug-card-*`, `--tug-tab-*` inherit from base tokens and are out of scope per [D08])
2. `theme-accessibility.ts` — WCAG 2.x luminance contrast, perceptual contrast calculation, CVD simulation (Machado et al. 2009), pairing map, auto-adjustment
3. `gallery-theme-generator-content.tsx` + `.css` — gallery card UI: seed selector, mood sliders, contrast dashboard, CVD preview strip, token preview, export/import
4. Gallery registration in `gallery-card.tsx` — new tab entry in `GALLERY_DEFAULT_TABS`, new `registerCard` call
5. Authoritative `fg-bg-pairing-map.ts` — declares which foreground tokens check against which background tokens

#### Non-goals (Explicitly out of scope) {#non-goals}

- Replacing existing hand-authored theme files (Brio, Bluenote, Harmony) — the generator produces new themes; existing themes remain as-is
- P3 wide-gamut color output — sRGB gamut only for this phase
- Runtime theme switching driven by the generator — themes are exported as static CSS files
- Removing `[D06]` overrides from Harmony — that is a follow-on after the engine proves it can produce correct contrast natively
- Component-level token derivation (`--tug-card-*`, `--tug-tab-*`, `--tug-menu-*`, etc.) — Bluenote overrides ~35 and Harmony overrides ~120 component tokens, but these inherit sensible values from `--tug-base-*` tokens when not overridden; component-token derivation is a follow-on (see [D08])
- Parameterized accessibility targets on ThemeRecipe (`contrastTarget`, `colorBlindSafe`, `highContrast`) — this phase hardcodes WCAG AA; the three-level conformance modes (Standard/Enhanced/High Contrast) from the proposal ship as a coherent unit in a follow-on
- WCAG 3.0 / perceptual contrast as a normative standard — perceptual contrast is included as an informational metric alongside the normative WCAG 2.x checks

#### Dependencies / Prerequisites {#dependencies}

- `palette-engine.ts` exports `oklchToLinearSRGB()`, `tugColor()`, `oklchToHex()`, `isInSRGBGamut()`, `findMaxChroma()`, `HUE_FAMILIES`, `DEFAULT_CANONICAL_L`, `MAX_CHROMA_FOR_HUE`
- `postcss-tug-color` plugin is operational in the build pipeline for `--tug-color()` expansion
- `tug-base.css` defines all 264 `--tug-base-*` tokens (Brio defaults) — this is the authoritative token catalog
- Existing gallery card registration pattern in `gallery-card.tsx` with 14 tabs

#### Constraints {#constraints}

- Rules of Tugways apply to all React code: appearance through CSS/DOM not React state ([D08]/[D09]), `useSyncExternalStore` for external state ([D40]), `useLayoutEffect` for registrations ([D41])
- React 19.2.4 — verify lifecycle assumptions against React 19 semantics, not React 18
- Export format must be `--tug-color()` notation (not raw `oklch()`) to match existing theme file convention
- No runtime performance regression — derivation and contrast checks must complete in under 100ms for interactive use
- Bun for all JS/TS tooling (never npm)

#### Assumptions {#assumptions}

- The 24 hue families in `HUE_FAMILIES` and the TugColor (Hue, Intensity, Tone, Alpha) model are sufficient to express all 264 tokens — no new color primitives needed
- The three existing themes (Brio, Bluenote, Harmony) provide enough data points to derive ~55 role formulas that generalize to novel seeds
- The `ThemeRecipe` interface and three example recipes (brio, bluenote, harmony) from the proposal are taken as given
- `palette-engine.ts` already exports `oklchToLinearSRGB()`, so CVD matrices can be applied without additional math infrastructure

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan skeleton: explicit `{#anchor}` tags on all referenced headings, kebab-case anchors, stable `[DNN]`/`[QNN]`/`Spec SNN` labels, `**References:**` and `**Depends on:**` lines on every execution step.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Role Formula Generalization Accuracy (OPEN) {#q01-role-formula-accuracy}

**Question:** Can ~55 role formulas derived from three themes generalize well enough that novel seed combinations produce aesthetically acceptable results without manual tweaking?

**Why it matters:** If formulas overfit to the three training themes, the generator produces ugly or broken output for novel seeds, undermining the tool's value.

**Options (if known):**
- Conservative: derive formulas, but expose per-token override knobs in the UI for manual correction
- Aggressive: derive formulas and trust them; add overrides only if user testing reveals problems

**Plan to resolve:** Step 2 includes a validation gate — regenerate Bluenote and Harmony from recipes and diff. If delta exceeds 5% of tokens, formulas need iteration.

**Resolution:** OPEN — will be resolved during Step 2 implementation

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Role formulas don't generalize | high | medium | Diff-validation against existing theme overrides; expose per-token overrides in UI | >5% delta on override subset for Bluenote/Harmony |
| perceptual contrast constants change before WCAG 3.0 finalization | low | low | perceptual contrast is informational-only; WCAG 2.x is normative | WCAG 3.0 reaches CR stage |
| Performance: 264-token derivation + contrast checking too slow for live preview | medium | low | Profile early; batch contrast checks; debounce slider updates | >100ms derivation time |

**Risk R01: Role Formula Generalization** {#r01-formula-generalization}

- **Risk:** Formulas derived from three themes may not generalize to arbitrary seed colors, producing poor aesthetics or broken contrast.
- **Mitigation:**
  - Validate against known themes with automated diff test
  - Expose per-token override capability in the UI
  - Layer 2 auto-adjustment catches contrast failures even if formulas produce marginal values
- **Residual risk:** Novel seed combinations far from the training set may need manual aesthetic tuning.

**Risk R02: Interactive Performance** {#r02-interactive-performance}

- **Risk:** Computing 264 tokens + running contrast checks against all pairings on every slider change may cause UI jank.
- **Mitigation:**
  - Debounce slider input (150ms)
  - Profile derivation pipeline early in Step 2
  - Contrast dashboard renders lazily (visible pairs first)
- **Residual risk:** Extremely large pairing maps may need pagination.

---

### Design Decisions {#design-decisions}

#### [D01] Export format is --tug-color() notation (DECIDED) {#d01-export-format}

**Decision:** Generated themes export as `--tug-color()` values, matching the existing Brio/Bluenote/Harmony pattern.

**Rationale:**
- Consistency with existing theme files — a generated theme is indistinguishable from a hand-authored one
- `postcss-tug-color` already handles expansion to `oklch()` at build time
- Preserves the human-readable TugColor semantics (hue name, intensity, tone) in the exported file

**Implications:**
- The derivation engine outputs `--tug-color(...)` strings, not raw OKLCH triplets
- Export round-trip test must pass through postcss-tug-color without errors

#### [D02] Engine auto-fixes contrast natively (DECIDED) {#d02-native-contrast-fix}

**Decision:** The derivation engine must produce tokens that pass contrast checks natively. Layer 2 auto-adjustment fires as a safety net, so `[D06]`-style manual overrides become unnecessary for generated themes.

**Rationale:**
- The Harmony `[D06]` overrides exist because hand-authoring had no contrast feedback loop
- An automated engine should not replicate a manual process's workarounds
- Auto-adjustment (tone bumping) is deterministic and auditable

**Implications:**
- Role formulas must be contrast-aware: surface/foreground pairs are derived with minimum contrast thresholds in mind
- Layer 2 auto-adjustment is a fallback, not the primary mechanism — formulas should produce passing values in the common case
- The pairing map is a required input to the derivation engine, not just to the dashboard

#### [D03] Authoritative fg/bg pairing map (DECIDED) {#d03-pairing-map}

**Decision:** An explicit pairing map (`fg-bg-pairing-map.ts`) declares which foreground tokens must be contrast-checked against which background tokens. This map is the single source of truth for contrast validation.

**Rationale:**
- Without an authoritative map, the contrast dashboard would rely on heuristics (e.g., "check every fg against every bg"), producing false positives and missing real failures
- The map makes the contrast contract explicit and testable
- Component CSS references specific token pairs — the map codifies those relationships

**Implications:**
- The pairing map must be maintained when new tokens are added
- Both the derivation engine (for auto-adjustment) and the contrast dashboard (for display) consume the same map
- The map is a deliverable artifact, not an implementation detail

#### [D04] ThemeRecipe interface from proposal (DECIDED) {#d04-theme-recipe}

**Decision:** The `ThemeRecipe` interface and three example recipes (brio, bluenote, harmony) from `roadmap/theme-generator-proposal.md` are adopted as-is.

**Rationale:**
- The proposal's recipe format is compact (minimum 3 values) yet expressive (full control with ~12)
- Three mood knobs (`surfaceContrast`, `signalVividity`, `warmth`) capture the aesthetic dimensions that matter
- Example recipes are validated against existing themes

**Implications:**
- `theme-derivation-engine.ts` takes a `ThemeRecipe` as input
- The gallery card UI maps directly to recipe fields (mode toggle, hue selector, mood sliders)
- Recipe JSON is the import/export serialization format

#### [D05] CVD simulation uses Machado et al. 2009 matrices (DECIDED) {#d05-cvd-matrices}

**Decision:** Color vision deficiency simulation uses the Machado et al. 2009 matrices at severity 1.0, operating in linear sRGB space.

**Rationale:**
- Machado et al. 2009 is the academic gold standard, widely cited and validated
- The matrices are published constants — computation, not invention
- `oklchToLinearSRGB()` from palette-engine.ts provides the necessary color space conversion

**Implications:**
- Pipeline: OKLCH -> linear sRGB -> apply 3x3 matrix -> clamp [0,1] -> sRGB gamma -> hex for display
- Four simulation types: protanopia, deuteranopia, tritanopia, achromatopsia
- Severity parameter (0.0-1.0) supported for anomalous trichromacy (protanomaly, deuteranomaly)

#### [D06] Gallery tab follows existing 14-tab pattern (DECIDED) {#d06-gallery-tab}

**Decision:** The Theme Generator registers as `gallery-theme-generator` componentId and is added as tab 15 in `GALLERY_DEFAULT_TABS`, following the existing gallery card pattern exactly.

**Rationale:**
- All 14 existing gallery tabs follow the same registration pattern
- Consistency reduces implementation risk and maintenance cost
- The contentFactory receives `cardId` if needed (following `gallery-observable-props` precedent)

**Implications:**
- New import in `gallery-card.tsx` for `GalleryThemeGeneratorContent`
- New entry in `GALLERY_DEFAULT_TABS` array
- New `registerCard` call in `registerGalleryCards()`

#### [D07] Contrast thresholds follow WCAG 2.x as normative, perceptual contrast as informational (DECIDED) {#d07-contrast-thresholds}

**Decision:** WCAG 2.x contrast ratios are the normative pass/fail criteria. perceptual contrast values are displayed alongside for informational purposes but do not gate pass/fail.

**Rationale:**
- WCAG 2.x is the current legal/compliance standard
- perceptual contrast (WCAG 3.0 draft) is more accurate for dark themes but not yet finalized
- Showing both helps theme authors understand where WCAG 2.x overstates or understates contrast

**Implications:**
- The contrast dashboard shows both WCAG ratio and perceptual contrast for every pair
- Auto-adjustment targets WCAG 2.x thresholds (4.5:1 body text, 3:1 large text/UI)
- Pass/fail badge colors are driven by WCAG 2.x only

#### [D09] Derivation engine returns dual output: strings + resolved OKLCH (DECIDED) {#d09-dual-output}

**Decision:** `deriveTheme()` returns both `--tug-color()` strings (for export/display) and a parallel `Record<string, ResolvedColor>` with OKLCH values (for contrast checking and CVD simulation). Only chromatic tokens appear in the resolved map; structural and invariant tokens are omitted.

**Rationale:**
- The derivation engine already computes OKLCH values internally when building `--tug-color()` strings — it has the L, C, h values before formatting them
- Contrast checking and CVD simulation need numeric color values, not strings. Without dual output, the accessibility module would need to parse `--tug-color()` strings back into parameters and re-expand them — duplicating the PostCSS plugin's logic at runtime
- The resolved map avoids a parse-expand-parse roundtrip and is both cleaner and faster for interactive use

**Implications:**
- `ThemeOutput.resolved` contains `ResolvedColor` objects with `{L, C, h, alpha}` for every chromatic token
- `validateThemeContrast()` and `simulateCVD*()` consume the resolved map directly via `oklchToLinearSRGB()` and `oklchToHex()`, never needing to parse `--tug-color()` strings
- Structural tokens (`transparent`, `none`, `var()` references) are absent from the resolved map — the contrast checker skips them

#### [D08] Derivation scope is --tug-base-* tokens only (DECIDED) {#d08-base-tokens-only}

**Decision:** The derivation engine produces only `--tug-base-*` tokens (264 tokens). Component-level tokens (`--tug-card-*`, `--tug-tab-*`, `--tug-menu-*`, `--tug-inspector-*`, etc.) are out of scope for this phase.

**Rationale:**
- Component tokens inherit from base tokens via CSS custom property fallbacks defined in component CSS files. A generated theme that sets base tokens correctly will produce a usable result even without explicit component overrides.
- Bluenote overrides ~35 component tokens; Harmony overrides ~120. These are aesthetic refinements, not functional requirements. The inheritance path produces correct (if less polished) results.
- Scoping to base tokens keeps the role formula catalog tractable (~55 formulas vs ~160+) and allows the engine to ship sooner.
- Component-token derivation can be added in a follow-on phase once the base engine is proven.

**Implications:**
- Golden tests compare only `--tug-base-*` tokens, not component-level overrides
- Exported CSS contains only `--tug-base-*` overrides in the `body {}` block
- Generated themes may look slightly different from hand-authored themes in component-specific areas (e.g., card title bar gradients, tab bar tints) — this is acceptable

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Input:** A `ThemeRecipe` object (see [D04]) with seed colors and mood knobs.

**Spec S01: ThemeRecipe Interface** {#s01-theme-recipe}

```typescript
interface ThemeRecipe {
  name: string;
  mode: "dark" | "light";
  atmosphere: { hue: string; offset?: number };
  text: { hue: string; offset?: number };
  accent?: string;        // default: "orange"
  primary?: string;       // default: "blue"
  destructive?: string;   // default: "red"
  positive?: string;      // default: "green"
  warning?: string;       // default: "yellow"
  info?: string;          // default: "cyan"
  surfaceContrast?: number;  // 0-100, default 50
  signalVividity?: number;   // 0-100, default 50
  warmth?: number;           // 0-100, default 50
  // Note: parameterized accessibility targets (contrastTarget, colorBlindSafe,
  // highContrast) are deferred to a follow-on phase. This phase hardcodes
  // WCAG AA as the normative threshold per [D07].
}
```

**Output:** A `ThemeOutput` object containing all 264 `--tug-base-*` token values as `--tug-color()` strings, a parallel resolved-color map for direct use by contrast checking and CVD simulation, plus validation results.

**Spec S02: ThemeOutput Interface** {#s02-theme-output}

```typescript
interface ResolvedColor {
  L: number;   // OKLCH lightness
  C: number;   // OKLCH chroma
  h: number;   // OKLCH hue angle
  alpha: number; // 0-1
}

interface ThemeOutput {
  name: string;
  mode: "dark" | "light";
  tokens: Record<string, string>;           // token name -> --tug-color() string (for export)
  resolved: Record<string, ResolvedColor>;  // token name -> OKLCH values (for contrast/CVD; only chromatic tokens)
  contrastResults: ContrastResult[];
  cvdWarnings: CVDWarning[];
}

interface ContrastResult {
  fg: string;       // token name
  bg: string;       // token name
  wcagRatio: number;
  apcaLc: number;
  wcagPass: boolean;
  role: "body-text" | "large-text" | "ui-component" | "decorative";
}

interface CVDWarning {
  type: "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";
  tokenPair: [string, string];
  description: string;
  suggestion: string;
}
```

#### Terminology and Naming {#terminology}

| Term | Definition |
|------|-----------|
| **Role formula** | A function that maps (recipe seed values, mood knobs) to a specific `--tug-base-*` token value |
| **Pairing map** | Authoritative mapping of which fg tokens must pass contrast against which bg tokens |
| **Seed color** | A hue family name (from `HUE_FAMILIES`) with optional offset, used as the starting point for derivation |
| **Mood knob** | One of `surfaceContrast`, `signalVividity`, `warmth` — continuous 0-100 parameters that adjust derivation aesthetics |
| **Auto-adjustment** | Algorithmic tone-bumping to bring a token pair into contrast compliance |

#### Supported Features {#supported-features}

**List L01: Token Role Categories** {#l01-token-roles}

| Category | Token prefix | Approximate count | Derivation source |
|----------|-------------|-------------------|-------------------|
| Surfaces | `--tug-base-bg-*`, `--tug-base-surface-*` | ~12 | atmosphere hue + surfaceContrast + mode |
| Foreground/Text | `--tug-base-fg-*` | ~12 | text hue + mode |
| Icon | `--tug-base-icon-*` | ~5 | text hue (follows fg) |
| Borders/Dividers | `--tug-base-border-*`, `--tug-base-divider-*` | ~10 | atmosphere hue, blended |
| Shadows/Overlay | `--tug-base-shadow-*`, `--tug-base-overlay-*` | ~8 | achromatic, mode-dependent alpha |
| Accent | `--tug-base-accent-*` | ~12 | accent seed hue |
| Semantic tones | `--tug-base-tone-*` | ~20 | positive/warning/danger/info seed hues |
| Selection/Highlight | `--tug-base-selection-*`, `--tug-base-highlight-*` | ~10 | primary + accent hues |
| Control surfaces | `--tug-base-control-*` | ~60+ | variant × state (rest/hover/active/disabled) × channel (bg/fg/border/icon) |
| Fields | `--tug-base-field-*` | ~27 | bg/fg/border/placeholder/label/helper/error/warning/success × state (rest/hover/focus/disabled/readOnly); bg from atmosphere, fg from text, validation states from semantic hues |
| Toggle/Checkbox/Radio/Range | `--tug-base-toggle-*`, `--tug-base-checkmark*`, `--tug-base-radio-*`, `--tug-base-range-*` | ~20 | track from atmosphere (off state) or accent (on/fill), thumb/dot from text hue at high tone, disabled from disabled contract |
| Avatar/Separator | `--tug-base-avatar-*`, `--tug-base-separator` | ~4 | atmosphere hue for bg/ring/separator, text hue for fg |
| Structural (non-chromatic, non-invariant) | `--tug-base-control-ghost-bg-rest`, `--tug-base-control-disabled-shadow`, `--tug-base-control-disabled-opacity`, `--tug-base-shadow-overlay`, `--tug-base-scrollbar-track`, `*-bg-disabled` (var refs) | ~10 | Values are `transparent`, `none`, `0.5`, `var()` references, or composite (e.g., `0 4px 16px --tug-color(...)`) — see handling rules below |
| Typography/Spacing/Radius | `--tug-base-font-*`, `--tug-base-space-*`, etc. | ~50+ | Theme-invariant, passed through unchanged |
| Motion | `--tug-base-motion-*` | ~15 | Theme-invariant, passed through unchanged |

**Structural token handling rules:** Tokens in the "Structural" category are neither pure `--tug-color()` chromatic values nor theme-invariant constants. The derivation engine handles them as follows:
- **`transparent` tokens** (e.g., `ghost-bg-rest`, `ghost-border-rest`, `scrollbar-track`): pass through as literal `transparent` for all themes.
- **`var()` references** (e.g., `primary-bg-disabled: var(--tug-base-control-disabled-bg)`): pass through as-is; the referenced token is derived elsewhere.
- **Plain non-color values** (e.g., `control-disabled-opacity: 0.5`, `control-disabled-shadow: none`): pass through from Brio defaults unchanged.
- **Composite shadow values** (e.g., `shadow-overlay: 0 4px 16px --tug-color(...)`): template the structural prefix (`0 4px 16px `) and derive the embedded `--tug-color()` portion using mode-appropriate alpha values.

**Table T01: Contrast Threshold Matrix** {#t01-contrast-thresholds}

| Token Role | Min WCAG 2.x | Min perceptual contrast | Rationale |
|---|---|---|---|
| Body text (14px / 400wt) | 4.5:1 (AA) | contrast 75 | Primary readability |
| Large text (18px+ / 700wt) | 3:1 (AA) | contrast 45 | Button labels, headings |
| UI components (icons, borders) | 3:1 (AA) | contrast 30 | Non-text contrast |
| Decorative / dividers | no minimum | contrast 15 | Structural only |

**Table T02: CVD Simulation Matrices (Machado et al. 2009, severity=1.0)** {#t02-cvd-matrices}

| Type | Matrix (linear sRGB) |
|------|---------------------|
| Protanopia | `[[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]` |
| Deuteranopia | `[[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]` |
| Tritanopia | `[[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]` |
| Achromatopsia | `[[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]]` |

#### Internal Architecture {#internal-architecture}

```
ThemeRecipe
    │
    ▼
┌─────────────────────────┐
│  theme-derivation-engine │  ← role formulas + mood knobs
│  (theme-derivation-      │
│   engine.ts)             │
└────────┬────────────────┘
         │ tokens: Record<string, string>     (--tug-color() strings for export)
         │ resolved: Record<string, OKLCH>    (numeric values for contrast/CVD)
         ▼
┌─────────────────────────┐     ┌──────────────────────┐
│  theme-accessibility     │────►│  fg-bg-pairing-map   │
│  (theme-accessibility.ts)│     │  (fg-bg-pairing-     │
│                          │     │   map.ts)             │
│  • WCAG 2.x contrast    │     └──────────────────────┘
│  • perceptual contrast              │
│  • CVD simulation        │  ← consumes resolved map directly [D09]
│  • Auto-adjustment       │
└────────┬────────────────┘
         │ ThemeOutput (tokens + resolved + results)
         ▼
┌─────────────────────────┐
│  gallery-theme-generator │
│  -content.tsx            │
│                          │
│  • Seed selector         │
│  • Mood sliders          │
│  • Contrast dashboard    │  ← reads contrastResults
│  • CVD preview strip     │  ← reads cvdWarnings + resolved for simulation
│  • Token preview         │  ← reads tokens for display
│  • Export/Import         │  ← reads tokens for CSS export
└─────────────────────────┘
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/theme-derivation-engine.ts` | Role formula catalog; `deriveTheme(recipe) -> { tokens, resolved }` per [D09] |
| `tugdeck/src/components/tugways/theme-accessibility.ts` | WCAG contrast, perceptual contrast, CVD simulation, auto-adjustment |
| `tugdeck/src/components/tugways/fg-bg-pairing-map.ts` | Authoritative fg/bg pairing map for contrast validation |
| `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` | Theme Generator gallery card UI component |
| `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css` | Styles for Theme Generator card |
| `tugdeck/src/__tests__/theme-derivation-engine.test.ts` | Unit tests for derivation engine |
| `tugdeck/src/__tests__/theme-accessibility.test.ts` | Unit tests for accessibility module |
| `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` | Tests for gallery card registration and rendering |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ThemeRecipe` | interface | `theme-derivation-engine.ts` | Spec S01 |
| `ThemeOutput` | interface | `theme-derivation-engine.ts` | Spec S02 — includes both `tokens` and `resolved` maps |
| `ResolvedColor` | interface | `theme-derivation-engine.ts` | Spec S02 — `{L, C, h, alpha}` for chromatic tokens |
| `ContrastResult` | interface | `theme-accessibility.ts` | Spec S02 |
| `CVDWarning` | interface | `theme-accessibility.ts` | Spec S02 |
| `deriveTheme` | fn | `theme-derivation-engine.ts` | `(recipe: ThemeRecipe) -> { tokens: Record<string, string>, resolved: Record<string, ResolvedColor> }` |
| `ROLE_FORMULAS` | const | `theme-derivation-engine.ts` | Map of token name -> derivation function |
| `EXAMPLE_RECIPES` | const | `theme-derivation-engine.ts` | brio, bluenote, harmony recipes |
| `computeWcagContrast` | fn | `theme-accessibility.ts` | WCAG 2.x relative luminance ratio |
| `computeApcaLc` | fn | `theme-accessibility.ts` | perceptual contrast value with polarity |
| `simulateCVD` | fn | `theme-accessibility.ts` | Apply Machado matrix to linear sRGB |
| `simulateCVDFromOKLCH` | fn | `theme-accessibility.ts` | Primary CVD entry point: accepts resolved OKLCH per [D09] |
| `validateThemeContrast` | fn | `theme-accessibility.ts` | Check all pairs against pairing map using resolved OKLCH map per [D09] |
| `autoAdjustContrast` | fn | `theme-accessibility.ts` | Tone-bump to pass WCAG thresholds; groups by fg token, targets most-restrictive bg; returns updated tokens + resolved + unfixable per [D09] |
| `FG_BG_PAIRING_MAP` | const | `fg-bg-pairing-map.ts` | Authoritative pairing map |
| `GalleryThemeGeneratorContent` | component | `gallery-theme-generator-content.tsx` | React component for gallery tab |
| `GALLERY_DEFAULT_TABS` | const (modify) | `gallery-card.tsx` | Add 15th tab entry |
| `registerGalleryCards` | fn (modify) | `gallery-card.tsx` | Add `gallery-theme-generator` registration |

---

### Documentation Plan {#documentation-plan}

- [ ] JSDoc on all exported functions and interfaces in new files
- [ ] Inline comments explaining each role formula's derivation logic
- [ ] Comment block in `fg-bg-pairing-map.ts` documenting the methodology for pairing selection
- [ ] Update all stale tab-count references in `gallery-card.tsx` module JSDoc (three locations: lines 8, 57, 946) to reflect 15 tabs

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual derivation formulas, contrast calculations, CVD matrix math | Core engine logic, edge cases |
| **Integration** | Test full recipe-to-theme pipeline, contrast validation across all 264 tokens | End-to-end derivation + validation |
| **Golden / Contract** | Regenerate Bluenote/Harmony from recipes and compare against hand-authored originals | Regression, formula accuracy |
| **Component** | Test gallery card renders, tab registration, interactive controls | UI correctness |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Authoritative Pairing Map {#step-1}

**Commit:** `feat(theme-gen): add authoritative fg/bg pairing map`

**References:** [D03] Authoritative fg/bg pairing map, List L01, Table T01, (#inputs-outputs, #internal-architecture)

**Artifacts:**
- `tugdeck/src/components/tugways/fg-bg-pairing-map.ts`
- `tugdeck/src/__tests__/theme-accessibility.test.ts` (pairing map completeness test only)

**Tasks:**
- [ ] Read `tug-base.css` and catalog every chromatic `--tug-base-*` token (surfaces, fg, icon, border, accent, tone, selection, highlight, control surfaces)
- [ ] For each fg-class token (fg, icon, control-fg, onAccent, onDanger, onWarning, onSuccess), identify the bg tokens it appears over in component CSS
- [ ] Export `FG_BG_PAIRING_MAP` as a typed array of `{ fg: string; bg: string; role: "body-text" | "large-text" | "ui-component" | "decorative" }` entries
- [ ] Annotate each pairing with the contrast role from Table T01
- [ ] Add a completeness test: every chromatic fg token appears in at least one pairing; every chromatic bg token appears in at least one pairing

**Tests:**
- [ ] T1.1: `FG_BG_PAIRING_MAP` contains entries for all fg tokens in `tug-base.css`
- [ ] T1.2: Every entry has a valid `role` from the allowed set
- [ ] T1.3: No duplicate pairs

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "pairing-map"`

---

#### Step 2: Theme Derivation Engine — Role Formulas {#step-2}

**Depends on:** #step-1

**Commit:** `feat(theme-gen): add theme derivation engine with role formulas`

**References:** [D01] Export format, [D02] Native contrast fix, [D04] ThemeRecipe interface, [D09] Dual output, Spec S01, Spec S02, List L01, (#inputs-outputs, #terminology, #internal-architecture)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts`
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts`

**Tasks:**
- [ ] Define `ThemeRecipe` interface per Spec S01
- [ ] Define `ThemeOutput` and `ResolvedColor` interfaces per Spec S02 (dual output: `tokens` string map + `resolved` OKLCH map per [D09]; contrast results added in Step 4)
- [ ] Analyze Brio (`tug-base.css`), Bluenote (`bluenote.css`), and Harmony (`harmony.css`) to extract ~55 role formulas mapping (atmosphere hue, text hue, mood knobs, mode) to each token category from List L01
- [ ] Implement `deriveTheme(recipe: ThemeRecipe): { tokens: Record<string, string>, resolved: Record<string, ResolvedColor> }` that applies role formulas to produce all 264 token values as `--tug-color()` strings in `tokens`, and simultaneously populates `resolved` with the OKLCH values for all chromatic tokens (structural and invariant tokens are omitted from `resolved`) per [D09]
- [ ] Handle theme-invariant tokens (typography, spacing, radius, stroke, icon-size, motion) by passing them through unchanged
- [ ] Handle structural tokens per List L01 handling rules: pass through `transparent`, `none`, `var()` references, and plain numeric values from Brio defaults; for composite shadow values, template the structural prefix and derive the embedded `--tug-color()` portion
- [ ] For achromatic extremes, always use `--tug-color()` notation rather than `var()` references: emit `--tug-color(white)` and `--tug-color(black)` as bare keyword forms (matching postcss-tug-color keyword behavior) instead of `var(--tug-white)` / `var(--tug-black)`. This ensures all chromatic output uses a uniform format and avoids golden test mismatches between semantically equivalent values. **Special-case resolved OKLCH values:** black resolves to `{L: 0, C: 0, h: 0}` and white resolves to `{L: 1, C: 0, h: 0}`, matching postcss-tug-color keyword semantics. Note: the `tugColor()` formula in palette-engine.ts maps tone 0 to `L_DARK` (~0.15) and tone 100 to `L_LIGHT` (~0.96), not to 0/1. Black and white keywords are special cases that bypass the tone formula entirely.
- [ ] Implement `EXAMPLE_RECIPES` const with brio, bluenote, harmony recipes from the proposal
- [ ] Implement mood knob modulation: `surfaceContrast` adjusts tone spread between surface layers, `signalVividity` adjusts intensity of accent/semantic hues, `warmth` biases neutral hue angles toward warm
- [ ] Ensure all output `--tug-color()` strings conform to the syntax accepted by `parseTugColor()` in `postcss-tug-color`. Valid forms include: `--tug-color(hue)`, `--tug-color(hue, i: N, t: N)`, `--tug-color(hue+N, i: N, t: N, a: N)`, `--tug-color(hue-preset)` where preset is one of `light`, `dark`, `intense`, `muted`. Hue offsets use `+N` or `-N` suffix on the hue name (e.g., `blue+5`, `violet-6`). Labeled parameters are `i:` (intensity), `t:` (tone), `a:` (alpha), all 0-100. **Prefer the most compact valid form:** bare hue name for canonical (i: 50, t: 50) values (e.g., `--tug-color(orange)`), preset suffix for standard presets (e.g., `--tug-color(blue-dark)`), and full parameterized form only when no shorter form matches. This produces human-readable output consistent with hand-authored themes.

**Tests:**
- [ ] T2.1: `deriveTheme(EXAMPLE_RECIPES.bluenote)` produces token map with 264 entries
- [ ] T2.2: Bluenote golden test — compare only the ~30 `--tug-base-*` tokens that Bluenote explicitly overrides (parsed from `bluenote.css`), not all 264 merged tokens. Comparison is at the resolved-color level (OKLCH values) using a perceptual delta-E threshold (OKLCH Euclidean distance < 0.02). Rationale: Bluenote's recipe (atmosphere: blue+9, text: blue) will produce blue-tinted values for all tokens, but the remaining ~234 Brio-default tokens are violet/cobalt -- they reflect Brio's recipe, not Bluenote's. Comparing non-overridden tokens would penalize the engine for correctly deriving from the Bluenote recipe. Delta must be <5% of the override subset (i.e., <~2 tokens out of ~30 overrides).
- [ ] T2.3: Harmony golden test — same methodology as T2.2 for Harmony; compare only the 94 `--tug-base-*` tokens that Harmony explicitly overrides (parsed from `harmony.css`), delta <5% of the override subset (i.e., <~5 tokens out of 94 overrides)
- [ ] T2.6: Sanity check for non-overridden tokens — verify that tokens NOT overridden by the reference theme are still reasonable: all chromatic non-override tokens should resolve to valid sRGB gamut colors and use the recipe's seed hues (not Brio's defaults)

**Note on golden test reference resolution:** The reference side (hand-authored theme values) contains `--tug-color()` strings that must be resolved to OKLCH for comparison. Do NOT depend on postcss-tug-color at test time. Instead, parse the `--tug-color()` parameters (hue name, offset, intensity, tone, alpha) and resolve to OKLCH using `tugColor()` + `HUE_FAMILIES` + `DEFAULT_CANONICAL_L` from `palette-engine.ts`. For `var()` references (e.g., `var(--tug-white)`), resolve to the known achromatic OKLCH values directly. This keeps tests self-contained within the JS runtime.
- [ ] T2.4: All output values for chromatic tokens match `--tug-color(...)` pattern
- [ ] T2.5: Theme-invariant tokens (spacing, radius, etc.) are identical to Brio defaults

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "derivation-engine"`

---

#### Step 3: Accessibility Module — Contrast Calculations {#step-3}

**Depends on:** #step-1

**Commit:** `feat(theme-gen): add WCAG 2.x and perceptual contrast calculations`

**References:** [D07] Contrast thresholds, [D03] Pairing map, [D09] Dual output, Table T01, Spec S02, (#inputs-outputs, #supported-features)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-accessibility.ts` (contrast portion)
- `tugdeck/src/__tests__/theme-accessibility.test.ts` (contrast tests)

**Tasks:**
- [ ] Implement `computeWcagContrast(fgHex: string, bgHex: string): number` — standard relative luminance ratio `(L1 + 0.05) / (L2 + 0.05)`
- [ ] Implement `computePerceptualContrast(fgHex: string, bgHex: string): number` — full perceptual contrast algorithm with polarity detection (text-on-bg vs bg-on-text)
- [ ] Implement `validateThemeContrast(resolved: Record<string, ResolvedColor>, pairingMap: PairingEntry[]): ContrastResult[]` — converts each resolved OKLCH value to hex via `oklchToHex()` and checks all pairs per [D09]; pairs referencing non-chromatic tokens (absent from `resolved`) are skipped
- [ ] Implement `autoAdjustContrast(tokens: Record<string, string>, resolved: Record<string, ResolvedColor>, failures: ContrastResult[]): { tokens: Record<string, string>, resolved: Record<string, ResolvedColor>, unfixable: string[] }` — adjusts fg token tone values to meet WCAG thresholds from Table T01; returns updated `tokens` and `resolved` maps per [D09], plus a list of token names that could not be fixed. **Convergence strategy for cascading conflicts:** when a single fg token (e.g., `fg-default`) participates in multiple pairings against different bg tokens, group all pairings by fg token, identify the most restrictive background (darkest bg in dark mode, lightest bg in light mode), and bump tone to satisfy that worst-case pair — which guarantees all other pairings for the same fg token also pass. Apply a maximum of 3 iterations over the full failure set to handle secondary effects. If any pair still fails after 3 iterations, add the fg token to `unfixable` and flag it in the UI rather than looping indefinitely. **Note:** this phase adjusts only fg tokens. Background token adjustment (shifting bg tone to create more headroom) is a future enhancement that requires careful surface-consistency constraints and is deferred.

**Tests:**
- [ ] T3.1: `computeWcagContrast("#000000", "#ffffff")` returns 21.0 (within floating point tolerance)
- [ ] T3.2: `computeWcagContrast("#777777", "#ffffff")` returns ~4.48 (known value)
- [ ] T3.3: `computeApcaLc` returns correct polarity for dark-on-light vs light-on-dark
- [ ] T3.4: `autoAdjustContrast` fixes a deliberately failing pair and resulting ratio >= threshold
- [ ] T3.5: `validateThemeContrast` against Brio defaults — all body-text pairs pass 4.5:1
- [ ] T3.6: `autoAdjustContrast` with a fg token paired against 3 different bg tokens (varying lightness) — single adjustment satisfies all pairings (most-restrictive-bg strategy)
- [ ] T3.7: `autoAdjustContrast` returns `unfixable` list when a token cannot reach threshold within tone range 0-100

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "theme-accessibility"`

---

#### Step 4: Integration Checkpoint — Derivation + Contrast {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [D02] Native contrast fix, [D03] Pairing map, [D09] Dual output, Spec S02, (#success-criteria)

**Artifacts:**
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts` (integration tests added to existing file)

**Tasks:**
- [ ] Verify that `deriveTheme()` resolved map feeds directly into `validateThemeContrast()` with no intermediate parsing or conversion per [D09]
- [ ] Run full pipeline: recipe -> deriveTheme -> validateThemeContrast(resolved) -> verify all body-text and UI-component pairs pass
- [ ] If any pairs fail, verify `autoAdjustContrast` fixes them and both `tokens` strings and `resolved` OKLCH values are updated consistently

**Tests:**
- [ ] T4.1: End-to-end: `deriveTheme(brio recipe)` -> `validateThemeContrast()` -> 0 failures for body-text role
- [ ] T4.2: End-to-end: `deriveTheme(bluenote recipe)` -> `validateThemeContrast()` -> 0 failures for body-text role
- [ ] T4.3: End-to-end: `deriveTheme(harmony recipe)` -> `validateThemeContrast()` -> 0 failures for body-text role

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "derivation-engine|theme-accessibility"`

---

#### Step 5: CVD Simulation Module {#step-5}

**Depends on:** #step-3

**Commit:** `feat(theme-gen): add CVD simulation with Machado matrices`

**References:** [D05] CVD matrices, [D09] Dual output, Table T02, (#supported-features, #internal-architecture)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-accessibility.ts` (CVD portion added)
- `tugdeck/src/__tests__/theme-accessibility.test.ts` (CVD tests added)

**Tasks:**
- [ ] Define `CVD_MATRICES` const with the four matrices from Table T02
- [ ] Implement `simulateCVD(linearRGB: {r,g,b}, type: CVDType, severity?: number): {r,g,b}` — apply 3x3 matrix multiplication in linear sRGB, clamp [0,1]
- [ ] Implement `simulateCVDFromOKLCH(L: number, C: number, h: number, type: CVDType, severity?: number): {r,g,b}` — primary entry point per [D09]: accepts resolved OKLCH values directly, converts to linear sRGB via `oklchToLinearSRGB()`, applies CVD matrix, clamps [0,1], returns simulated linear sRGB
- [ ] Implement `simulateCVDForHex(hex: string, type: CVDType, severity?: number): string` — convenience wrapper: hex -> linearize sRGB -> apply matrix -> gamma encode -> hex. Useful for standalone use outside the theme pipeline.
- [ ] Implement `checkCVDDistinguishability(resolved: Record<string, ResolvedColor>, semanticPairs: [string, string][]): CVDWarning[]` — consumes the resolved OKLCH map per [D09]; for each CVD type, runs `simulateCVDFromOKLCH` on both tokens in a semantic pair and checks if their lightness delta drops below a threshold
- [ ] Define semantic pairs to check: positive/warning, positive/destructive, primary/destructive, accent/atmosphere

**Tests:**
- [ ] T5.1: `simulateCVD` with identity-like input (pure gray) returns nearly unchanged values for all types
- [ ] T5.2: Protanopia simulation of pure red (#ff0000) significantly reduces the R channel
- [ ] T5.3: `checkCVDDistinguishability` flags green/red pair under protanopia and deuteranopia
- [ ] T5.4: Achromatopsia matrix produces identical R, G, B channels (grayscale)
- [ ] T5.5: Severity=0.0 returns input unchanged; severity=1.0 matches full matrix

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "cvd-simulation"`

---

#### Step 6: Theme Generator Card — Core UI {#step-6}

**Depends on:** #step-4

**Commit:** `feat(theme-gen): add Theme Generator gallery card with seed selector and mood sliders`

**References:** [D06] Gallery tab pattern, [D04] ThemeRecipe, Spec S01, (#constraints, #internal-architecture)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx`
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css`
- `tugdeck/src/components/tugways/cards/gallery-card.tsx` (modified — new tab + registration)

**Tasks:**
- [ ] Create `GalleryThemeGeneratorContent` component following existing gallery content pattern (`cg-content`, `cg-section`, `cg-section-title`)
- [ ] Implement mode toggle (dark/light) as a two-state button group
- [ ] Implement atmosphere hue selector: 24 hue swatches from `HUE_FAMILIES` (reuse pattern from palette gallery)
- [ ] Implement text hue selector: same 24 swatches
- [ ] Implement three mood sliders (`surfaceContrast`, `signalVividity`, `warmth`) with 0-100 range, default 50
- [ ] Wire controls to `deriveTheme()` — debounce slider changes by 150ms, call `deriveTheme()` with assembled recipe
- [ ] Implement token preview section: scrollable grid showing all 264 tokens with name, `--tug-color()` value, and rendered color swatch
- [ ] Rules of Tugways: appearance changes through CSS custom properties on the preview container, not React state. Use `useState` only for recipe parameters (local component state, not external store).
- [ ] Add `gallery-theme-generator` entry to `GALLERY_DEFAULT_TABS` as tab 15
- [ ] Add `registerCard` call in `registerGalleryCards()` with componentId `gallery-theme-generator`, icon `Paintbrush`, title `Theme Generator`
- [ ] Add import for `GalleryThemeGeneratorContent` in `gallery-card.tsx`
- [ ] Update all three stale tab-count references in `gallery-card.tsx` JSDoc: line 8 says "ten-tab" (should be "fifteen-tab"), line 57 says "fourteen-tab" (should be "fifteen-tab"), line 946 says "thirteen-tab" (should be "fifteen-tab"). Search for all numeric tab-count strings and correct them.

**Tests:**
- [ ] T6.1: `GALLERY_DEFAULT_TABS` has 15 entries
- [ ] T6.2: `gallery-theme-generator` componentId is registered
- [ ] T6.3: `GalleryThemeGeneratorContent` renders without errors
- [ ] T6.4: Mode toggle switches recipe mode between "dark" and "light"

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "gallery-theme-generator|gallery-card"`

---

#### Step 7: Contrast Dashboard {#step-7}

**Depends on:** #step-6

**Commit:** `feat(theme-gen): add contrast dashboard to Theme Generator card`

**References:** [D07] Contrast thresholds, [D03] Pairing map, Table T01, Spec S02, (#success-criteria)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` (dashboard section added)
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css` (dashboard styles)

**Tasks:**
- [ ] Add contrast dashboard section to `GalleryThemeGeneratorContent` below the token preview
- [ ] Render a grid of all fg/bg pairs from `FG_BG_PAIRING_MAP` with: fg swatch, bg swatch, WCAG ratio, perceptual contrast, pass/fail badge
- [ ] Color-code badges: green = pass both thresholds, yellow = marginal (within 0.5 of threshold), red = fail
- [ ] Badge pass/fail driven by WCAG 2.x only per [D07]; perceptual contrast shown as informational
- [ ] Add summary bar: "N/M pairs pass WCAG AA" count
- [ ] Wire to live recipe: when recipe changes, re-run `validateThemeContrast()` and update dashboard
- [ ] Lazy rendering: only render visible rows (use CSS `content-visibility: auto` for off-screen pairs)

**Tests:**
- [ ] T7.1: Dashboard renders correct number of pairs from pairing map
- [ ] T7.2: Brio recipe shows all body-text pairs as passing
- [ ] T7.3: Summary bar count matches actual pass/fail results

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "contrast-dashboard"`

---

#### Step 8: CVD Preview Strip and Auto-Fix {#step-8}

**Depends on:** #step-5, #step-7

**Commit:** `feat(theme-gen): add CVD preview strip and auto-fix to Theme Generator card`

**References:** [D05] CVD matrices, [D02] Native contrast fix, Table T02, (#supported-features, #internal-architecture)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` (CVD section added)
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css` (CVD strip styles)

**Tasks:**
- [ ] Add CVD preview strip section below contrast dashboard
- [ ] For each CVD type (protanopia, deuteranopia, tritanopia, achromatopsia), render the theme's key semantic colors (accent, positive, warning, destructive, primary, info) as simulated swatches in a horizontal strip
- [ ] Run `checkCVDDistinguishability` on each recipe change; display warning badges on indistinguishable pairs
- [ ] Add "Auto-fix" button that runs `autoAdjustContrast` followed by hue-shift suggestions for CVD-confusable pairs
- [ ] Auto-fix adjusts tone for contrast failures and suggests hue shifts for CVD distinguishability (e.g., shift green toward teal to separate from red under deuteranopia)

**Tests:**
- [ ] T8.1: CVD strip renders 4 simulation rows (one per type)
- [ ] T8.2: Each row shows the correct number of semantic color swatches
- [ ] T8.3: Auto-fix button triggers `autoAdjustContrast` and updates tokens

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "cvd-preview|auto-fix"`

---

#### Step 9: Export and Import {#step-9}

**Depends on:** #step-8

**Commit:** `feat(theme-gen): add theme export/import to Theme Generator card`

**References:** [D01] Export format, [D04] ThemeRecipe, Spec S01, (#success-criteria, #constraints)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` (export/import section added)

**Tasks:**
- [ ] Add Export section with two buttons: "Export CSS" and "Export Recipe JSON"
- [ ] "Export CSS" generates a complete theme CSS file in the same format as `bluenote.css` / `harmony.css` — `body { }` block with all `--tug-base-*` overrides as `--tug-color()` values
- [ ] Include a header comment with `@theme-name`, `@theme-description`, generation date, and source recipe hash
- [ ] "Export Recipe JSON" serializes the current `ThemeRecipe` as formatted JSON
- [ ] Add Import section: "Import Recipe" button that accepts a JSON file, parses it as `ThemeRecipe`, and loads it into the UI controls
- [ ] Validate imported JSON against `ThemeRecipe` schema before applying; show error toast for invalid input
- [ ] Both export buttons use `Blob` + `URL.createObjectURL` + programmatic `<a>` click for download

**Tests:**
- [ ] T9.1: Exported CSS contains `body {` block with `--tug-base-*` tokens
- [ ] T9.2: Exported CSS contains only `--tug-color()` values for chromatic tokens
- [ ] T9.3: Exported recipe JSON round-trips: export -> import -> re-export produces identical JSON
- [ ] T9.4: Invalid JSON import shows error, does not crash

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "theme-export|theme-import"`

---

#### Step 10: Final Integration Checkpoint {#step-10}

**Depends on:** #step-9

**Commit:** `N/A (verification only)`

**References:** [D01] Export format, [D02] Native contrast fix, [D03] Pairing map, [D04] ThemeRecipe, [D05] CVD matrices, [D06] Gallery tab, [D07] Contrast thresholds, [D08] Base tokens only, Spec S01, Spec S02, (#success-criteria, #exit-criteria)

**Artifacts:**
- `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` (end-to-end integration tests added to existing file)

**Tasks:**
- [ ] Verify full pipeline: create a novel recipe (not brio/bluenote/harmony), derive theme, validate contrast, check CVD, export CSS
- [ ] Verify exported CSS loads in postcss-tug-color without errors
- [ ] Verify gallery card appears as tab 15 with correct title "Theme Generator"
- [ ] Verify all 14 existing gallery tabs still function correctly (no regressions)
- [ ] Run full test suite

**Tests:**
- [ ] T10.1: All unit tests pass
- [ ] T10.2: All integration tests pass
- [ ] T10.3: Novel recipe end-to-end: derive -> validate -> 0 body-text failures -> export -> postcss roundtrip

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A Theme Generator gallery card that derives complete, accessibility-validated themes from compact seed-color recipes with mood parameters, producing export-ready CSS in `--tug-color()` notation.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `theme-derivation-engine.ts` produces all 264 `--tug-base-*` tokens from a `ThemeRecipe` (verify: unit test T2.1)
- [ ] Generated Bluenote matches hand-authored overrides within 5% of override subset (verify: golden test T2.2)
- [ ] All generated themes pass WCAG AA for body text pairings (verify: integration test T4.1-T4.3)
- [ ] CVD simulation produces correct matrix transforms (verify: unit tests T5.1-T5.5)
- [ ] Gallery card registers and renders as tab 15 (verify: component test T6.1-T6.2)
- [ ] Exported CSS is valid `--tug-color()` notation (verify: round-trip test T9.1-T9.2)
- [ ] `fg-bg-pairing-map.ts` covers all chromatic fg and bg tokens (verify: completeness test T1.1)
- [ ] Full test suite passes with zero failures (verify: `cd tugdeck && bun test`)

**Acceptance tests:**
- [ ] T-ACC-1: Novel recipe (CHM mood: surfaceContrast=70, signalVividity=80, warmth=65) produces theme with 0 WCAG AA body-text failures
- [ ] T-ACC-2: Exported CSS file from a generated theme loads successfully in the postcss-tug-color pipeline
- [ ] T-ACC-3: CVD preview strip correctly flags green/red confusion under protanopia

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Replace Harmony `[D06]` overrides with engine-generated values once formula accuracy is proven
- [ ] Component-level token derivation (`--tug-card-*`, `--tug-tab-*`, `--tug-menu-*`, etc.) for full parity with hand-authored themes per [D08]
- [ ] P3 wide-gamut color output for displays that support it
- [ ] Persist generated themes to TugBank for cross-session storage
- [ ] Parameterized accessibility targets on ThemeRecipe: `contrastTarget` (AA/AAA/perceptual contrast levels), `colorBlindSafe` (auto hue-shift), `highContrast` (prefers-contrast: more support)
- [ ] WCAG 3.0 / perceptual contrast as normative standard once finalized
- [ ] Anomalous trichromacy simulation with configurable severity slider in the CVD strip
- [ ] CHM mood board as a named preset recipe

| Checkpoint | Verification |
|------------|--------------|
| Pairing map complete | T1.1: all fg tokens covered |
| Derivation engine produces 264 tokens | T2.1: token count check |
| Golden test: Bluenote overrides <5% delta | T2.2: automated diff against override subset |
| Contrast validation passes for all recipes | T4.1-T4.3: end-to-end |
| CVD matrices correct | T5.2: protanopia red test |
| Gallery card renders | T6.3: render test |
| Export round-trip | T9.3: JSON round-trip |
| Full suite green | `cd tugdeck && bun test` |
