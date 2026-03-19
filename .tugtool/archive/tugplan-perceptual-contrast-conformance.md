<!-- tugplan-skeleton v2 -->

## Perceptual Contrast Conformance for the Derivation Engine {#perceptual-contrast-conformance}

**Purpose:** Expand the theme derivation engine's contrast pipeline to use perceptual lightness contrast (perceptual contrast) as the normative threshold standard -- covering non-text UI component visibility, focus indicator contrast, semi-transparent token compositing, and cascade-aware auto-adjustment -- so that every generated theme ships with verifiable conformance across all contrast categories, with WCAG 2.x ratio retained as informational secondary data.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | perceptual-contrast-conformance |
| Last updated | 2026-03-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The derivation engine currently validates contrast only for text-on-background pairs (189 entries in FG_BG_PAIRING_MAP) and uses WCAG 2.x relative luminance ratio as the normative pass/fail gate. The engine also computes perceptual lightness contrast (perceptual contrast) but treats it as informational only. This plan flips that relationship: perceptual contrast becomes the normative threshold standard, and WCAG ratio is retained as informational secondary data displayed in the contrast dashboard.

Beyond the normative flip, the pipeline does not cover three additional categories: non-text UI component visibility for toggles, checkboxes, input borders, and badges against their parent surfaces; focus indicator contrast for focus outlines against every surface they appear on; and accurate measurement of semi-transparent tokens that currently bypass contrast checks because the pipeline resolves to solid OKLCH without compositing over parent surfaces.

The auto-adjust loop compounds the problem. Its 3-iteration cap and fg-only bumping strategy cannot handle the cascade effects that non-text pairs introduce -- bumping a toggle track for surface contrast may break the thumb-on-track relationship. The adjuster needs convergence detection, oscillation guards, and the ability to bump any token type (fg, bg, or border).

#### Strategy {#strategy}

- Phase 1: Rename symbols to reflect perceptual contrast as normative. Rename `computePerceptualContrast` to `computePerceptualContrast`, rename `apcaLc` field to `contrast` in ContrastResult, add `contrastPass` field as the normative pass/fail gate, demote `wcagPass` to informational. Rename `CONTRAST_THRESHOLDS` to `CONTRAST_THRESHOLDS` and update the large-text threshold from 45 to 60. Rename the fg/bg interface to element/surface across all consumers.
- Phase 2: Refactor autoAdjustContrast to be cascade-aware with convergence detection, driven by `contrastPass` instead of `wcagPass`. Remove the 3-iteration cap, add oscillation detection, allow bumping any token type. This must be in place BEFORE new pairs are added so cascade effects are handled correctly from the start.
- Phase 3: Add ~33 non-text component-visibility pairs to the pairing map using the existing `ui-component` role. Run the pipeline with the cascade-aware adjuster, identify failures, fix formulas as needed.
- Phase 4: Add alpha-composite resolution to the pipeline. When a token has alpha < 1.0, composite it over its parent surface before measuring contrast.
- Phase 5: Add focus indicator pairs. Validate accent-cool-default against all surfaces, and compare focused vs unfocused border states.
- Phases are ordered so the normative contrast flip and cascade-aware adjuster (Phases 1-2) are operational before new non-text pairs (Phase 3), compositing (Phase 4), and focus pairs (Phase 5) are added.
- Existing 189 text pairs remain unchanged. New pairs are purely additive.
- `bun run generate:tokens` is run after any formula changes in theme-derivation-engine.ts, per project policy.

#### Success Criteria (Measurable) {#success-criteria}

- T4.1 test gate passes with zero unexpected failures after autoAdjustContrast using perceptual contrast thresholds, including all new non-text, composited, and focus indicator pairs (verified by `cd tugdeck && bun test`)
- All non-text UI component tokens (toggle tracks, checkbox borders, input borders, badge borders) achieve contrast 30 against their parent surfaces in the Brio theme for both dark and light presets
- Focus indicator token (accent-cool-default) achieves contrast 30 against all nine target surfaces (including surface-screen) in both modes
- Auto-adjust loop converges without hitting the safety cap (20 iterations) for the Brio recipe
- Semi-transparent badge/tone/selection tokens are composited before measurement -- no semi-transparent tokens remain in KNOWN_BELOW_THRESHOLD solely due to unmeasured alpha
- `contrastPass` is the normative pass/fail gate for all contrast checks; `wcagPass` is computed and displayed but does not gate pipeline pass/fail

#### Scope {#scope}

1. Flip normative standard from WCAG ratio to perceptual contrast: rename `computePerceptualContrast` to `computePerceptualContrast`, rename `apcaLc` field to `contrast`, add `contrastPass` as normative gate, demote `wcagPass` to informational
2. Rename `CONTRAST_THRESHOLDS` to `CONTRAST_THRESHOLDS`; update large-text threshold from contrast 45 to contrast 60
3. Expand ELEMENT_SURFACE_PAIRING_MAP with ~33 non-text component-visibility pairs plus ~11 focus indicator pairs
4. Refactor autoAdjustContrast for cascade-aware convergence with oscillation detection and any-token-type bumping, driven by `contrastPass`
5. Rename FgBgPairing interface to ElementSurfacePairing (element/surface instead of fg/bg) and update all consumers
6. Add alpha-composite resolution with optional parentSurface field on pairing entries
7. Add focus indicator pairs for accent-cool-default against all surfaces
8. Update BRIO_GROUND_TRUTH, KNOWN_BELOW_THRESHOLD, and test fixtures to reflect new pairs, adjusted tokens, and new ContrastResult shape

#### Non-goals (Explicitly out of scope) {#non-goals}

- Adding contrast requirements for disabled states (exempt per WCAG: "User Interface Components that are not available for user interaction are not required to meet contrast requirements")
- Modifying the palette engine or hue angle math
- Adding new token types or new CSS custom properties beyond what the derivation engine already generates
- Importing external perceptual contrast packages -- the existing existing perceptual contrast implementation is used as-is
- Making compliance claims about any external standard

#### Dependencies / Prerequisites {#dependencies}

- Current FG_BG_PAIRING_MAP with 189 text pairs (fg-bg-pairing-map.ts)
- Current autoAdjustContrast with tone-bump strategy (theme-accessibility.ts)
- Current `computePerceptualContrast` implementation in theme-accessibility.ts (to be renamed; algorithm unchanged)
- Current setChromatic() alpha parameter support in theme-derivation-engine.ts
- oklchToHex and oklchToLinearSRGB utilities from palette-engine.ts

#### Constraints {#constraints}

- Perceptual contrast is normative for all threshold comparisons; WCAG 2.x ratio is retained as informational secondary data
- Signed contrast polarity is handled by taking magnitude for threshold comparison
- Disabled states stay classified as `decorative` role (no minimum) per WCAG explicit exemption
- Token generation must remain a pure function: no browser APIs, no DOM access
- Auto-adjust must terminate deterministically; safety cap at 20 iterations with oscillation detection
- Do not import external perceptual contrast packages; use existing own perceptual contrast implementation
- Do not make compliance claims about any external standard

#### Assumptions {#assumptions}

- The existing 189 text pairs in FG_BG_PAIRING_MAP produce correct results and do not need modification
- Badge tinted bg tokens use alpha values from the ModePreset (badgeTintedBgAlpha: 15 for both dark and light presets) and are composited over surface-default
- Focus outlines use accent-cool-default (cobalt-intense) as the focus ring color across all components
- Toggle track tokens (on/off/mixed) appear exclusively on surface-default and surface-raised parent surfaces
- The contrast 60 large-text threshold is intentionally stricter than the previous informational contrast 45 -- this is a deliberate quality bar increase, not a typo. KNOWN_BELOW_THRESHOLD must be audited in Step 1 for any large-text pairs that passed at contrast 45 but fail at contrast 60.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan format relies on **explicit, named anchors** and **rich `References:` lines** in execution steps.

#### 1) Use explicit anchors everywhere you will cite later

- **Technique**: append an explicit anchor to the end of a heading using `{#anchor-name}`.

#### 2) Anchor naming rules (lock these in)

- **Allowed characters**: lowercase `a-z`, digits `0-9`, and hyphen `-` only.
- **Style**: short, semantic, **kebab-case**, no phase numbers.
- **Prefix conventions**: `step-N` for execution steps, `dNN-...` for design decisions, `tNN-...` for tables, `sNN-...` for specs.

#### 3) Stable label conventions (for non-heading artifacts)

- **Design decisions**: `[D01]` with explicit anchors
- **Tables**: `Table T01` with explicit anchors
- **Specs**: `Spec S01` with explicit anchors

#### 4) `**Depends on:**` lines for execution step dependencies

**Format:** `**Depends on:** #step-1, #step-2`

#### 5) `**References:**` lines are required for every execution step

Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Cascade oscillation in auto-adjust | med | low | Oscillation detection with per-token adjustment history | Any pair flagged as unfixable that was not unfixable before |
| Formula changes break existing Brio ground truth | high | med | Run full test suite after each formula change; update BRIO_GROUND_TRUTH incrementally | T-BRIO-MATCH test failure |
| Semi-transparent compositing changes measured contrast for tokens currently passing | med | low | Composite-before-measure only for pairs with parentSurface; existing solid pairs unchanged | New failures appear in existing text pairs |
| Large-text contrast 60 threshold causes regressions | med | med | Audit KNOWN_BELOW_THRESHOLD in Step 1 for large-text pairs that passed at contrast 45 but fail at contrast 60 | New unexpected failures in existing large-text pairs |

**Risk R01: Auto-adjust oscillation between dependent token pairs** {#r01-oscillation}

- **Risk:** When auto-adjust bumps a component bg token (e.g., toggle-track-off) to fix contrast against surface-default, it may break the thumb-on-track pair. Bumping the thumb back could re-break the track-on-surface pair, causing infinite oscillation.
- **Mitigation:**
  - Track per-token adjustment history across iterations
  - If a token's last three adjustments alternate directions, freeze it and report the pair as unfixable (3 alternations required to avoid false freezes from initial wrong-direction bumps)
  - Safety cap of 20 iterations (not 3) to allow deep cascades to converge naturally before declaring failure
- **Residual risk:** Some extreme recipe inputs could produce genuinely unfixable pairs where the hue/chroma constraints make the contrast threshold impossible. These are reported as unfixable and documented in KNOWN_BELOW_THRESHOLD.

**Risk R02: Ground truth drift from formula adjustments** {#r02-ground-truth}

- **Risk:** Adjusting formulas in theme-derivation-engine.ts to fix new non-text contrast failures may change existing token values, breaking BRIO_GROUND_TRUTH and T-BRIO-MATCH.
- **Mitigation:**
  - Make formula changes minimal and targeted (adjust tone values, not restructure formula logic)
  - Update BRIO_GROUND_TRUTH after each formula change by regenerating tokens and capturing new values
  - Run `bun run generate:tokens` after every engine change
- **Residual risk:** Ground truth updates require manual review to confirm the visual appearance has not degraded.

**Risk R03: Large-text contrast 60 threshold regression** {#r03-large-text-threshold}

- **Risk:** Raising the large-text threshold from contrast 45 to contrast 60 may cause existing large-text pairs that previously passed informally to now fail under the normative gate.
- **Mitigation:**
  - Audit all large-text pairs in Step 1 against contrast 60 before any other changes
  - Any newly-failing pairs are either fixed by formula adjustment or explicitly documented in KNOWN_BELOW_THRESHOLD with rationale
- **Residual risk:** Some large-text pairs may need formula changes that affect visual appearance. Visual review required.

---

### Design Decisions {#design-decisions}

#### [D01] Rename fg/bg interface to element/surface (DECIDED) {#d01-element-surface-rename}

**Decision:** Rename `FgBgPairing` to `ElementSurfacePairing` with fields `element` and `surface` instead of `fg` and `bg`. Update all consumers: theme-accessibility.ts, fg-bg-pairing-map.ts (rename file to element-surface-pairing-map.ts), test files, and the gallery contrast pipeline.

**Rationale:**
- Non-text pairs check bg-on-bg relationships (toggle track on surface) and border-on-bg relationships -- these are not "foreground on background" in any meaningful sense
- The element/surface naming correctly describes what is being measured: an element (text, icon, border, component bg) against its parent surface

**Implications:**
- The file fg-bg-pairing-map.ts is renamed to element-surface-pairing-map.ts
- The `PairingEntry` type alias in theme-accessibility.ts is updated
- All test files importing FgBgPairing/FG_BG_PAIRING_MAP are updated
- ContrastResult keeps `fg` and `bg` field names internally for backward compatibility with the contrast dashboard display, but the pairing interface uses `element` and `surface`

#### [D02] Cascade-aware auto-adjust with convergence detection (DECIDED) {#d02-cascade-auto-adjust}

**Decision:** Replace the MAX_ITERATIONS=3 cap with convergence detection: stop when no improvements are made in a full pass, or after a safety cap of 20 iterations. After each adjustment, re-validate ALL pairs by delegating to `validateThemeContrast(resolved, pairingMap)` (not inline contrast computation) to catch cascade breakage. Track per-token adjustment history for oscillation detection. The auto-adjuster is driven by `contrastPass` (the normative gate), not `wcagPass`.

**Rationale:**
- 3 iterations is insufficient for cascade effects (bumping toggle track may break thumb, which needs another pass)
- Re-validating all pairs after each adjustment catches secondary breakage immediately
- 20-iteration safety cap is generous but cheap (OKLCH-to-hex-to-contrast is microseconds per pair)
- Delegating re-validation to `validateThemeContrast` (instead of duplicating inline contrast math) ensures the auto-adjuster automatically inherits compositing behavior when Step 4 adds parentSurface support to `validateThemeContrast` -- no second code path to maintain
- Using `contrastPass` aligns the adjuster with the normative standard

**Implications:**
- autoAdjustContrast calls `validateThemeContrast(resolved, pairingMap)` each iteration for re-validation, replacing the current inline `computeWcagContrast` loop
- This creates a single source of truth for contrast measurement: validateThemeContrast handles both solid and composited pairs, and autoAdjustContrast inherits that logic
- Oscillation detection: if a token's last three adjustments alternate directions (`[+1,-1,+1]` or `[-1,+1,-1]`), it is frozen and reported as unfixable (3 alternations required to avoid false freezes)
- The safety cap of 20 is a hard stop; any remaining failures at that point are unfixable
- Remaining failures are determined by `!lcPass`, not `!wcagPass`

#### [D03] Element-only bumping for any token type in auto-adjust (DECIDED) {#d03-any-token-bump}

**Decision:** Allow autoAdjustContrast to bump any token in the `element` position -- fg, bg, or border tokens. Only the element-position token is bumped; surface-position tokens are never adjusted. The adjuster determines bump direction using the contrast sign from `computeLcContrast(elementHex, surfaceHex)`: positive contrast means the element is darker than the surface (dark-on-light), so bump the element darker to increase contrast magnitude; negative contrast means the element is lighter (light-on-dark), so bump the element lighter. If element-only bumping causes oscillation, the pair is frozen and reported as unfixable.

**Rationale:**
- Non-text pairs have bg tokens (toggle-track-off) or border tokens (field-border-rest) in the element position
- Restricting bumping to fg-only would leave these pairs unfixable
- The existing tone-bump math works identically regardless of whether the token is a fg, bg, or border token
- Surface-position tokens are shared across many pairs (e.g., surface-default appears in 50+ pairs); bumping a surface token to fix one pair could break dozens of others, making convergence far harder
- If element-only bumping cannot resolve a pair, it is genuinely unfixable within the element's hue/chroma constraints and should be reported rather than destabilizing shared surfaces

**Implications:**
- parseTugColorToken and rebuildTugColorToken are already token-type agnostic -- no changes needed
- The "group by fg" logic in autoAdjustContrast becomes "group by element"
- KNOWN_BELOW_THRESHOLD may need renaming from `_FG_TOKENS` to `_ELEMENT_TOKENS`
- Surface-position tokens are never in the adjustment set; oscillation between element pairs is caught by Spec S03

#### [D04] Alpha-composite resolution for semi-transparent tokens (DECIDED) {#d04-alpha-composite}

**Decision:** Add an optional `parentSurface` field to the pairing interface. When present, the pipeline checks both the element and surface tokens for `alpha < 1.0` and composites whichever is semi-transparent over the parentSurface using standard alpha-over compositing in linear sRGB, then measures contrast between the (possibly composited) element and surface.

**Rationale:**
- Badge tinted bg tokens (surface side) use alpha 15% -- measuring fg-on-bg contrast without compositing the bg is meaningless
- Tone-*-bg tokens (surface side, alpha 12-15%) are used as backgrounds for tone-*-fg text; the bg must be composited before measuring
- Semi-transparent overlays or highlights could also appear on the element side in future pairs
- The current approach of adding semi-transparent tokens to KNOWN_BELOW_THRESHOLD hides real accessibility problems
- Compositing in linear sRGB before converting to hex for contrast measurement is the standard approach

**Implications:**
- ElementSurfacePairing gains an optional `parentSurface?: string` field
- validateThemeContrast checks both element and surface for alpha < 1.0 when parentSurface is present, compositing whichever side is semi-transparent
- Compositing math: `C_out = token * alpha + parent * (1 - alpha)` per channel in linear sRGB
- Pairs without parentSurface behave exactly as before (no compositing)

#### [D05] Focus indicator validation against all surfaces (DECIDED) {#d05-focus-indicator}

**Decision:** Add focus indicator pairs checking accent-cool-default against all nine surfaces it can appear on (bg-app, surface-default, surface-raised, surface-inset, surface-content, surface-overlay, surface-sunken, surface-screen, field-bg-rest). Also add focused-vs-unfocused state comparison pairs for key components as informational-only (role `decorative`) since perceptual contrast is designed for element-on-area contrast, not border-vs-border comparison.

**Rationale:**
- Focus indicators must contrast against adjacent backgrounds for usability
- accent-cool-default (cobalt-intense) is the universal focus ring color in the design system
- Focused-vs-unfocused pairs (accent-cool-default vs field-border-rest) compare two thin border elements, not an element against a broad area. The perceptual contrast model is designed for element-on-area measurement, making border-vs-border results unreliable for gating. These pairs are kept as `decorative` role (informational, no minimum) so they appear in the dashboard for visual review without driving auto-adjustment.

**Implications:**
- ~11-13 new pairs added to the pairing map: ~10 with `ui-component` role (contrast 30 threshold) for accent-cool-default against surfaces, ~2 with `decorative` role for focused-vs-unfocused comparisons
- If accent-cool-default fails against any surface, the auto-adjuster will bump it -- but since it is shared across all surfaces, bumping must satisfy ALL surface pairs simultaneously (most-restrictive-surface strategy applies)
- surface-screen is included because tooltips (`--tug-tooltip-bg: var(--tug-base-surface-screen)`) can contain focusable elements

#### [D06] Perceptual contrast as normative threshold, WCAG ratio as informational (DECIDED) {#d06-contrast-normative}

**Decision:** Perceptual contrast (computed by the existing `computePerceptualContrast` function) becomes the normative pass/fail gate for all contrast checks. WCAG 2.x relative luminance ratio is retained in `ContrastResult` as the informational `wcagRatio` field and displayed in the contrast dashboard as secondary data. The `contrastPass` field (boolean, `|contrast| >= CONTRAST_THRESHOLDS[role]`) replaces `wcagPass` as the field that gates pipeline pass/fail. The `wcagPass` field is removed from ContrastResult entirely -- it served no purpose beyond the normative gate which is now `contrastPass`.

**Rationale:**
- Perceptual lightness contrast correlates better with human perception of contrast than WCAG 2.x relative luminance ratio
- The engine already computes perceptual contrast via its own implementation; this change makes the existing computation authoritative rather than advisory
- Removing `wcagPass` simplifies ContrastResult -- callers that need WCAG pass/fail can derive it from `wcagRatio` and `WCAG_CONTRAST_THRESHOLDS` (both still available)

**Implications:**
- `ContrastResult.apcaLc` renamed to `ContrastResult.lc`; new `ContrastResult.lcPass` boolean added; `ContrastResult.wcagPass` removed
- `computePerceptualContrast` renamed to `computePerceptualContrast` (algorithm unchanged, only naming)
- `CONTRAST_THRESHOLDS` renamed to `CONTRAST_THRESHOLDS`; large-text threshold updated from 45 to 60
- `validateThemeContrast` computes `lcPass = Math.abs(lc) >= LC_THRESHOLDS[role]` as the normative gate
- `autoAdjustContrast` filters on `!lcPass` instead of `!wcagPass`
- All test assertions that checked `wcagPass` updated to check `contrastPass`
- The contrast dashboard continues to display both `wcagRatio` and `contrast`; badge variant logic uses `contrastPass`
- `WCAG_CONTRAST_THRESHOLDS` remains exported and available for informational display in the dashboard
- The large-text contrast 60 threshold is intentionally stricter than the previous 45; KNOWN_BELOW_THRESHOLD is audited for regressions

---

### Specification {#specification}

**Spec S01: ElementSurfacePairing interface** {#s01-element-surface-pairing}

```typescript
export interface ElementSurfacePairing {
  element: string;       // Token being checked (fg, bg, border, or component bg)
  surface: string;       // Parent surface/background the element sits on
  role: ContrastRole;    // "body-text" | "large-text" | "ui-component" | "decorative"
  parentSurface?: string; // If element or surface has alpha < 1.0, composite the semi-transparent
                          // token over this opaque surface before measuring contrast (see Spec S02)
}
```

**Spec S02: Compositing algorithm** {#s02-compositing}

When `parentSurface` is specified, the pipeline composites whichever token in the pair has `alpha < 1.0` over the parentSurface. Alpha can appear on either side: on the element side (e.g., a semi-transparent overlay used as a visual element) or on the surface side (e.g., badge-tinted-*-bg, tone-*-bg where the bg token is semi-transparent and the fg/text element is opaque).

**Algorithm:**

1. Resolve both the element and surface tokens to OKLCH. Read `alpha` from each token's `ResolvedColor.alpha` field (0-1 range, where 1.0 means fully opaque).
2. Resolve the parentSurface token to OKLCH, convert to linear sRGB via `oklchToLinearSRGB(L, C, h)`. Assert that `parentSurface.alpha === 1.0` -- nested compositing (semi-transparent over semi-transparent) is not supported; the parentSurface must be fully opaque.
3. Determine which token needs compositing:
   - If `element.alpha < 1.0`: composite the element over parentSurface. The composited result replaces the element hex for contrast measurement.
   - If `surface.alpha < 1.0`: composite the surface over parentSurface. The composited result replaces the surface hex for contrast measurement.
   - If both have alpha < 1.0: composite both independently over parentSurface.
4. Alpha-over composite formula (in linear sRGB): `C_out.r = token.r * alpha + parent.r * (1 - alpha)` (same for g, b).
5. Convert composited linear sRGB to hex via gamma encoding.
6. Measure contrast between the (possibly composited) element hex and the (possibly composited) surface hex using `computePerceptualContrast`.

**Spec S03: Oscillation detection** {#s03-oscillation-detection}

For each token adjusted by autoAdjustContrast, track a history of adjustment directions:

1. Record `+1` (tone increased) or `-1` (tone decreased) for each adjustment
2. Require 3 alternating directions before declaring oscillation: freeze the token only if the last three adjustments form `[+1, -1, +1]` or `[-1, +1, -1]`. A 2-direction check (`[+1, -1]`) is too fragile -- it triggers a false freeze when the first bump direction was wrong (e.g., contrast sign edge case) and the second bump corrects it. Three alternations confirm genuine oscillation.
3. Report frozen tokens as unfixable
4. Log the conflicting pair information for diagnostic purposes

**Spec S04: ContrastResult with perceptual contrast normative fields** {#s04-contrast-result}

```typescript
export interface ContrastResult {
  fg: string;              // Populated from pairing.element (kept as "fg" for dashboard display compat)
  bg: string;              // Populated from pairing.surface (kept as "bg" for dashboard display compat)
  wcagRatio: number;       // WCAG 2.x relative luminance ratio (informational)
  contrast: number;        // Perceptual contrast value, signed
  lcPass: boolean;         // Normative gate: Math.abs(lc) >= LC_THRESHOLDS[role]
  role: "body-text" | "large-text" | "ui-component" | "decorative";
}

/** Fixed delta for marginal badge classification in the contrast dashboard. */
export const LC_MARGINAL_DELTA = 5;
// badgeVariant marginal: |lc| >= LC_THRESHOLDS[role] - LC_MARGINAL_DELTA
```

**Spec S05: LC_THRESHOLDS constants** {#s05-lc-thresholds}

```typescript
export const LC_THRESHOLDS: Record<string, number> = {
  "body-text": 75,
  "large-text": 60,     // Raised from 45 — intentionally stricter (see Risk R03)
  "ui-component": 30,
  decorative: 15,
};
```

Note: the large-text threshold of contrast 60 is intentionally stricter than the previous informational contrast 45. This is a deliberate quality bar increase. Any large-text pairs that passed at contrast 45 but fail at contrast 60 must be audited in Step 1 and either fixed or explicitly documented in KNOWN_BELOW_THRESHOLD.

**Table T01: New non-text pairing categories** {#t01-non-text-categories}

| Category | Element token pattern | Surface token | Role | Count (approx) |
|----------|----------------------|---------------|------|----------------|
| Toggle track visibility | toggle-track-{on,off,mixed}{,-hover} | surface-default, surface-raised | ui-component | ~12 |
| Input field borders | field-border-{rest,hover,active} | field-bg-{rest,hover,focus} | ui-component | ~9 |
| Validation borders | field-border-{danger,success} | field-bg-rest | ui-component | ~2 |
| Button outlined borders | control-outlined-{action,agent}-border-{rest,hover,active} | control-outlined-*-bg-* | ui-component | ~6 |
| Badge tinted borders | badge-tinted-*-border (if present) | surface-default | ui-component | ~7 (added in Step 4, not Step 3 -- requires compositing) |
| Separator/divider | border-default, border-muted | surface-default, surface-raised | ui-component | ~4 |
| Focus indicators | accent-cool-default | all 9 surfaces (incl. surface-sunken, surface-screen) + field-bg-rest | ui-component | ~10 |
| Focused vs unfocused | accent-cool-default | field-border-rest, control-outlined-action-border-rest | decorative | ~2 |

**Table T02: Auto-adjust parameter changes** {#t02-auto-adjust-params}

| Parameter | Old value | New value | Rationale |
|-----------|-----------|-----------|-----------|
| MAX_ITERATIONS | 3 | 20 (safety cap) | Allow cascade convergence |
| Convergence check | None | Stop when no improvements in a full pass | Efficient termination |
| Re-validation scope | Only initially-failing pairs | All pairs after each adjustment | Catch cascade breakage |
| Bump target | fg token only | Any token in element position | Support non-text pairs |
| Oscillation detection | None | Per-token direction history | Prevent infinite loops |
| Pass/fail gate | `wcagPass` (WCAG ratio) | `contrastPass` (perceptual contrast threshold) | Normative standard is now perceptual contrast |

**Table T03: Symbol renames** {#t03-symbol-renames}

| Old symbol | New symbol | Location | Notes |
|------------|-----------|----------|-------|
| `computePerceptualContrast` | `computePerceptualContrast` | theme-accessibility.ts | Algorithm unchanged, only naming |
| `CONTRAST_THRESHOLDS` | `CONTRAST_THRESHOLDS` | theme-accessibility.ts | large-text updated 45 -> 60 |
| `apcaLc` (field) | `contrast` (field) | ContrastResult interface | In theme-derivation-engine.ts |
| `wcagPass` (field) | removed | ContrastResult interface | Replaced by `contrastPass` |
| N/A (new) | `contrastPass` (field) | ContrastResult interface | Normative gate: \|lc\| >= threshold |
| `FgBgPairing` | `ElementSurfacePairing` | element-surface-pairing-map.ts | Fields: element/surface |
| `FG_BG_PAIRING_MAP` | `ELEMENT_SURFACE_PAIRING_MAP` | element-surface-pairing-map.ts | Same entries, new name |
| `fg-bg-pairing-map.ts` | `element-surface-pairing-map.ts` | src/components/tugways/ | File rename |
| `KNOWN_BELOW_THRESHOLD_FG_TOKENS` | `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` | test files | Set now holds any element-position token |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `src/components/tugways/element-surface-pairing-map.ts` | Renamed from fg-bg-pairing-map.ts; contains ElementSurfacePairing interface and ELEMENT_SURFACE_PAIRING_MAP |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ElementSurfacePairing` | interface | element-surface-pairing-map.ts | Replaces FgBgPairing; adds `parentSurface?: string` |
| `ELEMENT_SURFACE_PAIRING_MAP` | const | element-surface-pairing-map.ts | Replaces FG_BG_PAIRING_MAP; ~240 entries (189 existing + ~50 new) |
| `computePerceptualContrast` | function (renamed) | theme-accessibility.ts | Renamed from computeApcaLc; algorithm unchanged |
| `CONTRAST_THRESHOLDS` | const (renamed) | theme-accessibility.ts | Renamed from APCA_LC_THRESHOLDS; large-text: 60 |
| `CONTRAST_MARGINAL_DELTA` | const | theme-accessibility.ts | Fixed 5 units for marginal badge classification |
| `compositeOverSurface(token: ResolvedColor, parent: ResolvedColor): string` | function | theme-accessibility.ts | Alpha-over compositing in linear sRGB; reads token.alpha, composites over parent, returns composited hex string |
| `validateThemeContrast` | function (modified) | theme-accessibility.ts | Accepts ElementSurfacePairing[]; computes `contrastPass` as normative gate; handles parentSurface compositing |
| `autoAdjustContrast(tokens, resolved, failures, pairingMap)` | function (modified) | theme-accessibility.ts | New 4th param; cascade-aware with convergence, oscillation detection, any-token bumping; driven by `contrastPass` |
| `ContrastResult` | interface (modified) | theme-derivation-engine.ts | `apcaLc` -> `contrast`, `wcagPass` removed, `contrastPass` added |
| `PairingEntry` | type alias (modified) | theme-accessibility.ts | Re-exports ElementSurfacePairing instead of FgBgPairing |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test compositing math, oscillation detection, convergence, contrast threshold comparison | compositeOverSurface, autoAdjustContrast internals, contrastPass computation |
| **Integration** | End-to-end pipeline: deriveTheme -> validate -> auto-adjust -> re-validate | T4.1 expansion, new pair categories |
| **Drift Prevention** | BRIO_GROUND_TRUTH, KNOWN_BELOW_THRESHOLD updates | Ensure formula changes do not silently regress |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Rename symbols and flip normative standard to perceptual contrast {#step-1}

**Commit:** `refactor(contrast): rename to perceptual contrast (normative), element/surface pairing interface`

**References:** [D01] Rename fg/bg to element/surface, [D06] Perceptual contrast as normative threshold, Spec S01, Spec S04, Spec S05, Table T03, Risk R03, (#d01-element-surface-rename, #d06-contrast-normative, #s01-element-surface-pairing, #s04-contrast-result, #s05-lc-thresholds, #t03-symbol-renames, #r03-large-text-threshold)

**Artifacts:**
- Renamed file: `fg-bg-pairing-map.ts` -> `element-surface-pairing-map.ts`
- Updated interface: `ElementSurfacePairing` with `element` and `surface` fields
- Renamed `computePerceptualContrast` -> `computePerceptualContrast` in theme-accessibility.ts
- Renamed `CONTRAST_THRESHOLDS` -> `CONTRAST_THRESHOLDS` with large-text updated 45 -> 60
- Updated `ContrastResult`: `apcaLc` -> `contrast`, `wcagPass` removed, `contrastPass` added
- Updated `validateThemeContrast` to compute `lcPass = Math.abs(lc) >= LC_THRESHOLDS[role]` as normative gate
- Updated all consumer files (source + tests) for new field names
- Audited KNOWN_BELOW_THRESHOLD for large-text pairs affected by contrast 45 -> 60 change

**Tasks:**
- [ ] Rename `FgBgPairing` interface to `ElementSurfacePairing`; rename `fg` field to `element`, `bg` field to `surface`
- [ ] Add optional `parentSurface?: string` field to `ElementSurfacePairing` (used in Phase 4, but added now to avoid a second interface change)
- [ ] Rename `FG_BG_PAIRING_MAP` to `ELEMENT_SURFACE_PAIRING_MAP`
- [ ] Rename file from `fg-bg-pairing-map.ts` to `element-surface-pairing-map.ts`
- [ ] Rename `computePerceptualContrast` to `computePerceptualContrast` in theme-accessibility.ts (algorithm unchanged, only naming)
- [ ] Rename `CONTRAST_THRESHOLDS` to `CONTRAST_THRESHOLDS`; update large-text threshold from 45 to 60
- [ ] Update `ContrastResult` in theme-derivation-engine.ts: rename `apcaLc` field to `contrast`, remove `wcagPass` field, add `contrastPass` boolean field
- [ ] Update `validateThemeContrast` in theme-accessibility.ts:
  - Read `pairing.element` and `pairing.surface` instead of `pairing.fg` and `pairing.bg`
  - Compute `lcPass = Math.abs(lc) >= (LC_THRESHOLDS[role] ?? 15)` as the normative gate
  - Remove `wcagPass` from the result object; add `contrastPass`
  - Keep `wcagRatio` computation (informational)
- [ ] Update `PairingEntry` type alias re-export
- [ ] Update source consumer: `gallery-theme-generator-content.tsx` -- imports, `CONTRAST_THRESHOLDS` -> `CONTRAST_THRESHOLDS`, `result.apcaLc` -> `result.lc`, rename `apcaLabel` function to `lcLabel`, update to use `result.lc`
- [ ] Update `badgeVariant` function in `gallery-theme-generator-content.tsx`: replace `result.wcagPass` with `result.contrastPass`; update marginal check to use `Math.abs(result.contrast) >= CONTRAST_THRESHOLDS[role] - CONTRAST_MARGINAL_DELTA` (fixed 5-unit near-pass band, per Spec S04) instead of `wcagRatio` distance from `WCAG_CONTRAST_THRESHOLDS[role]`
- [ ] Update `passCount` filter in `ContrastSummaryBar` from `r.wcagPass` to `r.lcPass`
- [ ] Update summary bar text from "pairs pass WCAG AA" to "pairs pass contrast"
- [ ] Update column header and tooltip text to "Contrast" in the contrast dashboard table
- [ ] Update CSS comment in `gallery-theme-generator-content.css` (line 358: `/* Summary bar — "N/M pairs pass WCAG AA" */`) to reflect perceptual contrast normative wording
- [ ] Update all test files for renamed fields: `theme-accessibility.test.ts`, `theme-derivation-engine.test.ts`, `gallery-theme-generator-content.test.tsx`, `contrast-dashboard.test.tsx`, `cvd-preview-auto-fix.test.tsx` -- all `r.wcagPass` -> `r.lcPass`, all `r.apcaLc` -> `r.lc`, all `computePerceptualContrast` -> `computePerceptualContrast`
- [ ] Update `contrast-dashboard.test.tsx` assertions: passCount/failCount filters from `r.wcagPass` to `r.contrastPass`; update any assertion text matching "WCAG AA" to "contrast"
- [ ] Rename `KNOWN_BELOW_THRESHOLD_FG_TOKENS` to `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` in `theme-derivation-engine.test.ts` and `gallery-theme-generator-content.test.tsx` per Table T03. The set now holds any element-position token (fg, bg, or border). This rename happens here in Step 1 alongside the other naming changes so that Step 3 can reference the new name without ambiguity.
- [ ] Audit ALL large-text pairs against contrast 60 (not just currently-passing ones). Since the normative standard is changing, re-evaluate every large-text pair including any that were previously in KNOWN_BELOW_THRESHOLD. For each pair failing at contrast 60, either adjust the formula to fix it or explicitly document it in KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS with rationale. **The contrast 60 large-text threshold is intentionally stricter than the previous 45 -- this is a deliberate quality bar increase.**
- [ ] Update `AutoFixPanel` failures filter in `gallery-theme-generator-content.tsx` (line 574: `contrastResults.filter((r) => !r.wcagPass && ...)`) to use `!r.lcPass`
- [ ] Update `autoAdjustContrast` to use `element`/`surface` field names throughout (group by element, bump element token) and filter on `!lcPass` instead of `!wcagPass`. Note: the full cascade-aware refactor of autoAdjustContrast is deferred to Step 2; this step only updates field names and the pass/fail gate.

**Tests:**
- [ ] All existing contrast tests pass with renamed interface and perceptual contrast normative gate
- [ ] T3.3 test updated: `computePerceptualContrast` (was `computePerceptualContrast`)
- [ ] T4.1 passes with `contrastPass` as the gate (may have new failures from contrast 60 large-text threshold -- these are expected and handled by KNOWN_BELOW_THRESHOLD audit above)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] Verify no references to `FgBgPairing`, `FG_BG_PAIRING_MAP`, `computePerceptualContrast`, `CONTRAST_THRESHOLDS`, or `apcaLc` remain in source (grep confirms zero matches)
- [ ] Verify no references to `wcagPass` remain in source (grep confirms zero matches)

---

#### Step 2: Refactor autoAdjustContrast for cascade-aware convergence {#step-2}

**Depends on:** #step-1

**Commit:** `feat(contrast): cascade-aware auto-adjust with convergence detection and any-token bumping`

**References:** [D02] Cascade-aware auto-adjust, [D03] Any-token-type bumping, [D06] Perceptual contrast normative, Spec S03, Spec S04, Table T02, Risk R01, (#d02-cascade-auto-adjust, #d03-any-token-bump, #d06-contrast-normative, #s03-oscillation-detection, #s04-contrast-result, #t02-auto-adjust-params, #r01-oscillation)

**Artifacts:**
- Refactored `autoAdjustContrast` in theme-accessibility.ts with new signature
- New oscillation detection logic with per-token direction tracking
- Convergence-based termination (stop when no improvements, safety cap at 20)
- Full re-validation of ALL pairs after each adjustment iteration via `validateThemeContrast`
- Updated all 9 call sites across 5 files to pass the pairing map

**Tasks:**
- [ ] Add `pairingMap: ElementSurfacePairing[]` as a new fourth parameter to `autoAdjustContrast`. The function needs the full pairing map to re-validate ALL pairs after each adjustment (not just the initially-failing ones). New signature: `autoAdjustContrast(tokens, resolved, failures, pairingMap)`
- [ ] Update all 9 call expressions across 5 files to pass a pairings array as the fourth argument:
  - `gallery-theme-generator-content.tsx` (1 call) -- pass `ELEMENT_SURFACE_PAIRING_MAP`
  - `theme-derivation-engine.test.ts` (1 call, T4.1) -- pass `ELEMENT_SURFACE_PAIRING_MAP`
  - `gallery-theme-generator-content.test.tsx` (1 call) -- pass `ELEMENT_SURFACE_PAIRING_MAP`
  - `cvd-preview-auto-fix.test.tsx` (3 calls) -- pass `ELEMENT_SURFACE_PAIRING_MAP`
  - `theme-accessibility.test.ts` (3 calls: T3.4, T3.6, T3.7) -- these are synthetic/unit tests with test-local pairings arrays; pass the test-local array (not the full map) so the tests remain isolated and predictable
- [ ] Replace `MAX_ITERATIONS = 3` with `SAFETY_CAP = 20`
- [ ] Add convergence detection: after each full pass, if no pairs improved (no new passes, no new adjustments), stop
- [ ] Replace the inline re-validation loop (which calls `computeWcagContrast` directly on each remaining failure) with a delegation to `validateThemeContrast(updatedResolved, pairingMap)`. This re-evaluates ALL pairs in the pairingMap after each adjustment (not just remaining failures), catching cascade breakage. It also means that when Step 4 adds compositing to validateThemeContrast, the auto-adjuster automatically measures composited contrast without any additional changes.
- [ ] Filter remaining failures as `results.filter(r => !r.lcPass)` -- the normative gate is `contrastPass` per [D06]
- [ ] Add per-token adjustment history: `Map<string, number[]>` tracking direction (+1/-1) of each adjustment
- [ ] Implement oscillation detection per Spec S03: if a token's last three adjustments alternate directions (`[+1,-1,+1]` or `[-1,+1,-1]`), freeze it and add to unfixable. Require 3 alternations (not 2) to avoid false freezes when the first bump direction was wrong and the second corrects it.
- [ ] Change "group by element" logic to bump the element token regardless of whether it is fg, bg, or border per [D03]. Determine bump direction using contrast sign: call `computePerceptualContrast(elementHex, surfaceHex)` -- positive contrast (dark-on-light) means bump element darker (decrease tone); negative contrast (light-on-dark) means bump element lighter (increase tone). This replaces the raw OKLCH L comparison for correctness under polarity semantics.
- [ ] Update unfixable reporting to use element token names

**Tests:**
- [ ] T3.4 (auto-adjust fixes a deliberately failing pair) updated to use element/surface naming and `contrastPass`
- [ ] T3.6 (most-restrictive-bg strategy) updated to most-restrictive-surface
- [ ] T3.7 (unfixable list) updated
- [ ] New test: oscillation detection -- create two pairs where adjusting element A breaks element B and vice versa, verify both are reported as unfixable
- [ ] New test: convergence -- verify auto-adjust stops before safety cap when all pairs pass
- [ ] New test: cascade -- create a pair chain (A on B, B on C) where adjusting A requires B to also adjust, verify both converge

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] Verify T4.1 still passes with 0 unexpected failures (existing 189 pairs with new adjuster, perceptual contrast normative)

---

#### Step 3: Add non-text component-visibility pairs to the pairing map {#step-3}

**Depends on:** #step-2

**Commit:** `feat(contrast): add ~33 non-text component-visibility pairs`

**References:** [D01] Element/surface naming, [D02] Cascade-aware auto-adjust, [D06] Perceptual contrast normative, Table T01, (#t01-non-text-categories, #context, #strategy)

**Artifacts:**
- ~33 new entries in ELEMENT_SURFACE_PAIRING_MAP covering toggle tracks, input borders, validation borders, outlined button borders, and separators (badge-tinted-border pairs deferred to Step 4; focus indicator pairs added separately in Step 5)
- Updated T1.1 completeness check to cover new element/surface tokens
- Incremental BRIO_GROUND_TRUTH updates if any formulas are adjusted to fix new failures

**Tasks:**
- [ ] Add toggle track visibility pairs: toggle-track-{on,off,mixed,on-hover,off-hover,mixed-hover} as element against surface-default and surface-raised as surface, all with role `ui-component`
- [ ] Add input field border pairs: field-border-{rest,hover,active} against field-bg-{rest,hover,focus} with role `ui-component`
- [ ] Add validation border pairs: field-border-{danger,success} against field-bg-rest with role `ui-component`
- [ ] Add outlined button border pairs: control-outlined-{action,agent}-border-{rest,hover,active} against their corresponding bg tokens with role `ui-component`
- [ ] Do NOT add badge-tinted-*-border pairs in this step. These tokens have alpha=35% and require compositing for accurate contrast measurement. Adding them here without compositing would cause the auto-adjuster to incorrectly bump them based on raw (non-composited) contrast -- KNOWN_BELOW_THRESHOLD is test-only and the auto-adjuster does not consult it. These pairs are deferred to Step 4 where compositing infrastructure is available.
- [ ] Add separator/divider pairs: border-default and border-muted against surface-default and surface-raised with role `ui-component`
- [ ] Run pipeline: `cd tugdeck && bun test` to identify any new failures
- [ ] For any failing pairs (where `contrastPass` is false), evaluate whether the formula in theme-derivation-engine.ts needs a tone adjustment or the pair should be added to KNOWN_BELOW_THRESHOLD with documented rationale
- [ ] If any formulas were adjusted, update BRIO_GROUND_TRUTH fixture values for the affected tokens and run `bun run generate:tokens`

**Tests:**
- [ ] Verify T1.1 completeness check passes with new pairs (every chromatic token in at least one pairing)
- [ ] All new pairs included in T4.1 pipeline validation
- [ ] Zero unexpected failures after auto-adjust (cascade-aware adjuster from Step 2 handles non-text cascade effects)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `bun run generate:tokens` (if any formulas were adjusted)

---

#### Step 4: Add alpha-composite resolution for semi-transparent tokens {#step-4}

**Depends on:** #step-3

**Commit:** `feat(contrast): alpha-composite resolution for semi-transparent token pairs`

**References:** [D04] Alpha-composite resolution, [D06] Perceptual contrast normative, Spec S02, (#d04-alpha-composite, #d06-contrast-normative, #s02-compositing)

**Artifacts:**
- New `compositeOverSurface` function in theme-accessibility.ts
- Updated `validateThemeContrast` to composite when `parentSurface` is present
- Updated pairing map entries for badge-tinted-*-bg, tone-*-bg, selection-bg with `parentSurface` field
- Possible reduction in KNOWN_BELOW_THRESHOLD entries (tokens that now measure accurately after compositing)

**Tasks:**
- [ ] Implement `compositeOverSurface(token: ResolvedColor, parent: ResolvedColor): string` in theme-accessibility.ts (co-located with `linearToSrgbGamma` and other contrast utilities). Extract `L`, `C`, `h` from each `ResolvedColor` and call `oklchToLinearSRGB(L, C, h)` to get linear sRGB channels. Blend using `token.alpha`: `C_out = token_channel * alpha + parent_channel * (1 - alpha)` per channel. Gamma-encode via the existing private `linearToSrgbGamma` function (already in theme-accessibility.ts, used by CVD simulation), then format as hex. This function is token-position agnostic: it composites any semi-transparent token over an opaque parent. Assert that `parent.alpha === 1.0` (or is undefined, defaulting to 1.0) at the top of the function; throw if the parentSurface is itself semi-transparent, as nested compositing is not supported.
- [ ] Update `validateThemeContrast`: when `pairing.parentSurface` is defined, resolve the parentSurface token, then check both element and surface for alpha < 1.0. Composite whichever side is semi-transparent over the parentSurface before measuring contrast. Perceptual contrast is measured via `computePerceptualContrast` on the (possibly composited) hex values; `contrastPass` remains the normative gate.
- [ ] Add `parentSurface: "--tug-base-surface-default"` to the 7 existing badge-tinted-*-fg on badge-tinted-*-bg pairs. In these pairs, the **surface** side (badge-tinted-*-bg) has alpha 15% and must be composited over surface-default before measuring contrast against the opaque element (badge-tinted-*-fg).
- [ ] Add `parentSurface: "--tug-base-surface-default"` to the 7 existing tone-*-fg on tone-*-bg pairs (tone-accent-fg/bg, tone-active-fg/bg, tone-agent-fg/bg, tone-data-fg/bg, tone-success-fg/bg, tone-caution-fg/bg, tone-danger-fg/bg). In these pairs, the **surface** side (tone-*-bg) has alpha 12-15% and must be composited over surface-default before measuring contrast against the opaque element (tone-*-fg). The 7 corresponding tone-*-fg on surface-default pairs do not need parentSurface since surface-default is fully opaque.
- [ ] Add 7 badge-tinted-*-border pairs to ELEMENT_SURFACE_PAIRING_MAP with `parentSurface: "--tug-base-surface-default"` and role `ui-component`. These pairs are added here (not in Step 3) because the element side (badge-tinted-*-border) has alpha 35% and requires compositing for accurate contrast measurement. Adding them without compositing would cause the auto-adjuster to incorrectly bump them.
- [ ] Add `parentSurface: "--tug-base-surface-default"` to selection-bg pairing entry (selection-bg has alpha and is on the surface side)
- [ ] Note on bump-direction with composited pairs: the auto-adjuster determines bump direction using the contrast sign from `computePerceptualContrast` (set up in Step 2). For composited pairs, `validateThemeContrast` now composites before measuring, so the contrast sign reflects the composited contrast. However, the bump itself adjusts the raw element tone -- this is correct because increasing |contrast| always means moving the element away from the surface in lightness. No changes to bump-direction logic are needed in this step.
- [ ] Review and update remaining KNOWN_BELOW_THRESHOLD entries: remove any others that now measure accurately after compositing; add new entries only for genuinely below-threshold composited results
- [ ] Verify that compositing produces accurate contrast measurements by spot-checking badge-tinted-accent-bg (alpha 15%) composited over surface-default, then measuring badge-tinted-accent-fg against the composited result using `computePerceptualContrast`

**Tests:**
- [ ] Unit test for compositeOverSurface: white at 50% alpha over black = mid-gray (#808080 approximately)
- [ ] Unit test for compositeOverSurface: fully opaque token (alpha=1.0) returns element color unchanged
- [ ] Integration test: badge-tinted-accent-fg on composited badge-tinted-accent-bg passes contrast 30 (ui-component role)
- [ ] T4.1 updated to include composited pairs

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

#### Step 5: Add focus indicator pairs {#step-5}

**Depends on:** #step-4

**Commit:** `feat(contrast): add focus indicator pairs for accent-cool-default`

**References:** [D05] Focus indicator validation, [D06] Perceptual contrast normative, Table T01, (#d05-focus-indicator, #d06-contrast-normative, #t01-non-text-categories)

**Artifacts:**
- ~11-13 new focus indicator pairs in ELEMENT_SURFACE_PAIRING_MAP
- accent-cool-default checked against 9 surfaces (including surface-sunken, surface-screen) + field-bg-rest with `ui-component` role
- Focused-vs-unfocused state comparison pairs with `decorative` role (informational)

**Tasks:**
- [ ] Add accent-cool-default as element against bg-app, surface-default, surface-raised, surface-inset, surface-content, surface-overlay, surface-sunken, surface-screen, field-bg-rest as surface, all with role `ui-component` (surface-screen included because tooltips can contain focusable elements)
- [ ] Add focused-vs-unfocused pairs as informational-only: accent-cool-default as element against field-border-rest as surface, with role `decorative` (perceptual contrast is designed for element-on-area contrast, not border-vs-border -- see [D05])
- [ ] Add focused-vs-unfocused pair: accent-cool-default as element against control-outlined-action-border-rest as surface, role `decorative`
- [ ] Run pipeline and verify all focus-on-surface pairs pass contrast 30 (ui-component threshold); focused-vs-unfocused pairs are decorative and do not gate
- [ ] If accent-cool-default fails against any surface, evaluate whether the cobalt-intense formula needs adjustment or the pair is an acceptable exception
- [ ] If any formulas were adjusted, update BRIO_GROUND_TRUTH fixture values for the affected tokens and run `bun run generate:tokens`

**Tests:**
- [ ] All focus-on-surface indicator pairs pass contrast 30 in T4.1
- [ ] Focused-vs-unfocused pairs are included in T4.1 as decorative (informational, no minimum gate)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `bun run generate:tokens` (if any formula adjustments were made)

---

#### Step 6: Update ground truth and final integration checkpoint {#step-6}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `test(contrast): update BRIO_GROUND_TRUTH and KNOWN_BELOW_THRESHOLD for perceptual contrast conformance`

**References:** [D01] Element/surface naming, [D02] Cascade-aware auto-adjust, [D04] Alpha-composite, [D05] Focus indicators, [D06] Perceptual contrast normative, Table T01, Table T02, (#success-criteria, #exit-criteria)

**Artifacts:**
- Final reconciliation of BRIO_GROUND_TRUTH (Steps 3-5 perform incremental updates to pass their own checkpoints; this step is a final consistency pass)
- Final reconciliation of KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS (same: Steps 3-5 update incrementally, this step reconciles across all pair categories)
- Updated test assertions

**Tasks:**
- [ ] Regenerate tokens: `bun run generate:tokens`
- [ ] Final reconciliation of BRIO_GROUND_TRUTH fixture values in theme-derivation-engine.test.ts. Steps 3-5 each update ground truth incrementally when formula changes are needed to pass their checkpoints. This step performs a final pass to ensure all values are consistent after the complete set of changes.
- [ ] Final reconciliation of KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS in both theme-derivation-engine.test.ts and gallery-theme-generator-content.test.tsx (renamed from `_FG_TOKENS` in Step 1). Steps 3-5 each update the set incrementally. This step performs a final pass across all pair categories: verify entries that compositing resolved are removed, verify genuinely unfixable entries have documented rationale. The filtering logic in the T4.1 test (`!KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.has(r.fg)`) remains correct because `ContrastResult.fg` is populated from `pairing.element` -- so an element-position bg token like toggle-track-off will appear in `r.fg` and be matched against the set.
- [ ] Verify T1.1 completeness check passes (every chromatic element and surface token appears in at least one pairing)
- [ ] Verify T4.1 passes with 0 unexpected failures for both dark and light presets, using `contrastPass` as the gate
- [ ] Run full test suite for both Brio dark preset and Brio light preset

**Tests:**
- [ ] T4.1 end-to-end: 0 unexpected failures after autoAdjustContrast for all pair categories (perceptual contrast normative)
- [ ] T-BRIO-MATCH: engine output matches updated ground truth
- [ ] T1.1: pairing map completeness check passes (all chromatic tokens covered)
- [ ] All existing text-pair tests continue to pass unchanged

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `bun run generate:tokens` produces no diff (tokens are already up to date)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The theme derivation engine validates all contrast requirements using perceptual contrast as the normative standard -- non-text UI component visibility, focus indicator contrast, and semi-transparent token compositing -- with a cascade-aware auto-adjust loop that converges deterministically. WCAG 2.x ratio is retained as informational secondary data.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] ELEMENT_SURFACE_PAIRING_MAP contains ~240 pairs covering text, non-text, composited, and focus indicator categories
- [ ] autoAdjustContrast uses convergence detection, oscillation guards, and any-token bumping (no 3-iteration cap)
- [ ] Semi-transparent tokens are composited over parent surfaces before contrast measurement
- [ ] `contrastPass` is the normative pass/fail gate; `wcagPass` is removed; `wcagRatio` retained as informational
- [ ] T4.1 passes with 0 unexpected failures for both Brio dark and Brio light presets
- [ ] `cd tugdeck && bun test` passes all tests
- [ ] `bun run generate:tokens` produces consistent output

**Acceptance tests:**
- [ ] T4.1: zero unexpected failures after autoAdjustContrast (all pair categories, perceptual contrast normative)
- [ ] T-BRIO-MATCH: engine output matches updated ground truth
- [ ] T1.1: pairing map completeness check passes
- [ ] New oscillation detection test passes
- [ ] New compositing unit tests pass

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] CVD simulation for non-text pairs (extend checkCVDDistinguishability to cover toggle/badge/focus pairs)
- [ ] Visual regression testing: screenshot comparison for contrast-adjusted tokens
- [ ] Per-recipe perceptual contrast threshold overrides (recipe-level quality bar customization)

| Checkpoint | Verification |
|------------|--------------|
| All pairs validated | `cd tugdeck && bun test` -- T4.1 passes |
| Tokens regenerated | `bun run generate:tokens` -- no diff |
| No leftover old naming | `grep -r "FgBgPairing\|FG_BG_PAIRING_MAP\|computeApcaLc\|APCA_LC_THRESHOLDS\|apcaLc\|wcagPass" tugdeck/src/` returns zero matches |
