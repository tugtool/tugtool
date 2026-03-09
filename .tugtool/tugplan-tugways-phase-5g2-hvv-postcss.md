<!-- tugplan-skeleton v2 -->

## HVV PostCSS Plugin and Theme Conversion {#hvv-postcss}

**Purpose:** Ship a PostCSS plugin that expands `--hvv(hue, vib, val)` notation to concrete `oklch()` values at build time, add an `oklchToHVV()` reverse mapper to palette-engine.ts, and convert all hardcoded hex tokens in theme files to `--hvv()` calls.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-09 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Tugways design system uses an HVV (Hue, Vibrancy, Value) color model backed by OKLCH. The `hvvColor()` function in `palette-engine.ts` already computes `oklch()` strings from HVV parameters at runtime. However, the three theme files (tug-tokens.css, bluenote.css, harmony.css) still contain hundreds of hardcoded hex color values for non-chromatic tokens (surfaces, grays, borders, text). These hex values were originally hand-tuned but are expressible as HVV coordinates with specific hue tints and vibrancy/value settings.

Converting hex tokens to `--hvv()` notation makes the color system fully parametric: every color in every theme is described by hue family, vibrancy, and value. This enables future features like theme generation, accessibility tooling, and palette-wide adjustments. The conversion must happen at build time (not runtime) so there is zero performance cost.

#### Strategy {#strategy}

- Build the PostCSS plugin first as a standalone module with its own tests, independent of theme conversion.
- Add the `oklchToHVV()` reverse mapper to palette-engine.ts to enable programmatic hex-to-HVV derivation.
- Write a one-time conversion script that uses `oklchToHVV()` to derive HVV parameters for every hex token, producing the rewritten theme files.
- Wire the plugin into Vite via the `css.postcss` inline option, coexisting with `@tailwindcss/vite`.
- Leave `tug-palette.css` untouched — its `var()` formulas are the source of truth for P3 gamut overrides.
- Validate with visual regression: build output must produce identical (or near-identical) computed colors.

#### Success Criteria (Measurable) {#success-criteria}

- Zero standalone `#hex` color values remain in tug-tokens.css, bluenote.css, or harmony.css body{} blocks. The only `#ffffff` occurrences (in harmony.css) become `var(--tug-white)`. Values inside `rgba()`/`color-mix()` stay as-is. (`grep -c '#[0-9a-fA-F]' styles/{tug-tokens,bluenote,harmony}.css` returns 0 for standalone hex values outside function calls)
- All Harmony contrast-critical hex overrides (formerly marked [D06] in comments) are converted to `--hvv()`: `#c46020` becomes `--hvv(flame, 45, 38)`, `#8a7200` becomes `--hvv(yellow, 46, 27)`, `#b89000` becomes `--hvv(yellow, 55, 35)`, `#2898c8` becomes `--hvv(blue, 42, 40)`, `#ffe15a` becomes `--hvv(yellow, 62, 58)`. All map with delta-E < 0.02.
- `bun run build` succeeds with no errors.
- The PostCSS plugin expands `--hvv(blue, 5, 13)` to `oklch(0.3115 0.0143 230)` (matching hvvColor() output exactly: L = 0.15 + 13 * (0.771 - 0.15) / 50 = 0.3115).
- Raw hue angles work: `--hvv(237, 5, 13)` expands correctly using binary-searched max chroma at that angle.
- All existing `var()`, `color-mix()`, and `rgba()` references in theme files are preserved unchanged.
- `oklchToHVV()` round-trips: for every named hue family, `oklchToHVV(hvvColor(hue, vib, val))` returns the original `{hue, vib, val}` within rounding tolerance.

#### Scope {#scope}

1. PostCSS plugin (`postcss-hvv.ts`) that expands `--hvv()` in CSS declaration values.
2. `oklchToHVV()` and `hvvPretty()` functions in palette-engine.ts.
3. One-time conversion script to rewrite theme files from hex to `--hvv()`.
4. Vite config wiring for the PostCSS plugin.
5. Theme file rewrites: tug-tokens.css body{} block, bluenote.css body{} block, harmony.css body{} block.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Modifying `tug-palette.css` — its `var()` formulas for P3 gamut overrides remain as-is.
- Converting `brio.css` — it is nearly empty (defaults live in tug-tokens.css body{} block).
- Runtime HVV evaluation in the browser — all expansion is build-time only.
- Converting `rgba()`, `color-mix()`, or `var()` expressions to `--hvv()`.
- Per-theme canonical L tuning (future phase).
- Converting tokens in `tug-comp-tokens.css` (component tokens reference base tokens via `var()`).

#### Dependencies / Prerequisites {#dependencies}

- `postcss` package added as an explicit devDependency (`bun add -D postcss`). Currently available only transitively through `@tailwindcss/vite` and `vite`; making it explicit avoids fragile transitive resolution.
- `palette-engine.ts` exports: `HUE_FAMILIES`, `DEFAULT_CANONICAL_L`, `MAX_CHROMA_FOR_HUE`, `PEAK_C_SCALE`, `L_DARK`, `L_LIGHT`, `hvvColor()`, `findMaxChroma()`.
- Vite config at `tugdeck/vite.config.ts` with existing `@tailwindcss/vite` plugin.

#### Constraints {#constraints}

- Must use `bun` (never npm) for all package operations.
- Number precision: 4 decimal places, trailing zeros stripped (matching `hvvColor()` format function).
- Plugin must not add new third-party PostCSS helper dependencies (no `postcss-functions` or similar). `postcss` itself is promoted from transitive to explicit devDependency, which is not a new dependency.
- Plugin runs alongside `@tailwindcss/vite` (Tailwind CSS v4) without conflict.
- `#ffffff` maps to `var(--tug-white)` as a special case (appears 3 times in harmony.css only). `#000000` does not appear in any theme file, so no special case is needed for it.

#### Assumptions {#assumptions}

- The `oklchToHVV()` reverse mapper will be added to palette-engine.ts alongside the existing `hvvColor()` function.
- Raw numeric hue angles (e.g. `--hvv(237, 5, 13)`) are supported by the plugin using binary search for max chroma at the raw angle.
- The plugin source file will live in `tugdeck/` alongside `vite.config.ts` and import constants from palette-engine.ts.
- brio.css remains nearly empty and does not need `--hvv()` conversion since its defaults live in tug-tokens.css body{} block.
- The conversion script is a one-time tool; it does not ship in production.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

All headings, decisions, specs, and steps use explicit `{#anchor}` anchors per the skeleton contract. See skeleton for full rules.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Color drift from hex-to-HVV rounding | med | med | Validate round-trip within delta-E threshold | Visual regression detected |
| PostCSS plugin conflicts with Tailwind v4 | high | low | Tailwind uses its own Vite plugin, PostCSS plugins are separate pipeline | Build errors after wiring |
| Raw hue angle chroma lookup inaccuracy | low | low | Use same findMaxChroma binary search from palette-engine.ts | Color appears wrong for raw angles |

**Risk R01: Color drift from hex-to-HVV rounding** {#r01-color-drift}

- **Risk:** Converting hex values through oklch intermediate to HVV and back may introduce perceptible color shifts.
- **Mitigation:**
  - Use delta-E (OKLCH) comparison between original hex and round-tripped oklch output.
  - Accept tolerance of delta-E < 0.01 (imperceptible).
  - Manual review of key surfaces (bg-app, fg-default) across all three themes.
- **Residual risk:** Sub-perceptual rounding differences will exist but are functionally invisible.

**Risk R02: PostCSS plugin ordering with Tailwind** {#r02-postcss-tailwind}

- **Risk:** The HVV PostCSS plugin and Tailwind's CSS processing could interfere.
- **Mitigation:**
  - Tailwind v4 uses `@tailwindcss/vite` (a Vite plugin), not a PostCSS plugin. The HVV plugin goes in `css.postcss.plugins` which is a separate pipeline stage.
  - Test that both work together with `bun run build`.
- **Residual risk:** Future Tailwind updates could change their Vite integration.

---

### Design Decisions {#design-decisions}

#### [D01] Bespoke PostCSS plugin with no new dependencies (DECIDED) {#d01-bespoke-plugin}

**Decision:** Write a custom PostCSS plugin that walks the AST and expands `--hvv()` patterns, rather than using `postcss-functions` or similar libraries.

**Rationale:**
- Full control over the `--hvv()` syntax parsing (three-argument function with named hues or raw angles).
- No new third-party PostCSS helper dependency to maintain or audit. `postcss` itself is promoted from transitive to explicit devDependency (already present transitively via `@tailwindcss/vite` and `vite`).
- The plugin logic is straightforward: regex match in declaration values, compute oklch(), replace.

**Implications:**
- Plugin file lives at `tugdeck/postcss-hvv.ts`.
- Must handle both named hues (`blue`) and raw numeric angles (`237`).
- Must import constants from `palette-engine.ts` via explicit relative path (`./src/components/tugways/palette-engine`) since the `@/` alias is not available in Node/Bun PostCSS context. Bun's native TS support handles the `.ts` import directly.

#### [D02] Inline PostCSS in Vite config (DECIDED) {#d02-inline-postcss}

**Decision:** Use Vite's `css.postcss` option to pass the HVV plugin inline rather than using a separate `postcss.config.js`.

**Rationale:**
- Keeps configuration co-located in `vite.config.ts`.
- Works alongside `@tailwindcss/vite` since Tailwind v4 operates as a Vite plugin, not a PostCSS plugin.
- Simpler to maintain: one config file instead of two.

**Implications:**
- `vite.config.ts` gains a `css: { postcss: { plugins: [...] } }` block.
- The HVV plugin must be importable from the Vite config (same directory).

#### [D03] Keep palette var() formulas in tug-palette.css (DECIDED) {#d03-palette-unchanged}

**Decision:** `tug-palette.css` is not modified. Only theme files (tug-tokens.css, bluenote.css, harmony.css) use `--hvv()`.

**Rationale:**
- The preset formulas in tug-palette.css use `var(--tug-{hue}-peak-c)` for P3 gamut overrides via cascade.
- Replacing these with `--hvv()` would lose the runtime P3 override mechanism.
- Theme tokens are the only place where hardcoded hex values need conversion.

**Implications:**
- The plugin only needs to process theme CSS files (though it will harmlessly skip files without `--hvv()` calls).
- P3 gamut override via `--tug-{hue}-peak-c` continues to work unmodified.

#### [D04] Re-derive HVV mappings programmatically (DECIDED) {#d04-programmatic-derivation}

**Decision:** Build `oklchToHVV()` first, then use it in a conversion script to programmatically derive HVV parameters for every hex token.

**Rationale:**
- Avoids manual mapping of ~470 hex tokens (error-prone).
- The reverse mapper is independently useful for developer tooling and debugging.
- Ensures consistency: same math in both directions.

**Implications:**
- `oklchToHVV()` must handle the full range of hex values in theme files, including near-achromatic grays with slight hue tints.
- The conversion script parses CSS, identifies hex values, converts each, and writes back `--hvv()` calls.
- `#ffffff` is special-cased to `var(--tug-white)` (appears in harmony.css only). `#000000` does not appear in any theme file.

#### [D05] Number precision matches hvvColor() (DECIDED) {#d05-number-precision}

**Decision:** The PostCSS plugin outputs oklch() values with 4 decimal places and trailing zeros stripped, identical to `hvvColor()`.

**Rationale:**
- Consistency with existing programmatic output.
- The `hvvColor()` format function (`parseFloat(n.toFixed(4)).toString()`) is the established convention.

**Implications:**
- The plugin reuses the same formatting logic.
- Round-trip validation compares strings directly.

#### [D06] Convert all contrast-critical hex overrides to --hvv() (DECIDED) {#d06-contrast-overrides}

**Decision:** All Harmony contrast-critical hex overrides (previously marked with [D06] comments referencing a prior phase decision) are converted to `--hvv()` notation. None are left as raw hex.

**Rationale:**
- Prior analysis confirmed every contrast-critical hex maps cleanly to HVV with delta-E < 0.02.
- Specific verified mappings: `#c46020` (accent-muted) maps to `--hvv(flame, 45, 38)` (delta-E=0.009), `#8a7200` (various warning/function tokens) maps to `--hvv(yellow, 46, 27)` (delta-E=0.009), `#b89000` (toast-warning-fg) maps to `--hvv(yellow, 55, 35)` (delta-E=0.003), `#2898c8` (banner-info-fg) maps to `--hvv(blue, 42, 40)` (delta-E=0.004), `#ffe15a` (field-warning) maps to `--hvv(yellow, 62, 58)` (delta-E=0.018).
- Achieving zero standalone hex is the target; exempting contrast overrides would leave ~10 hex values and complicate grep-based validation.

**Implications:**
- The conversion script does not need a skip list for contrast-critical tokens.
- The existing [D06] comments in harmony.css will be updated to reference the HVV notation instead.
- Future per-theme canonical L tuning (out of scope) may further refine these values.

---

### Deep Dives (Optional) {#deep-dives}

#### PostCSS Plugin Architecture {#plugin-architecture}

The plugin walks the PostCSS AST using `Declaration` visitor. For each declaration whose value contains `--hvv(`, it:

1. Extracts all `--hvv(arg1, arg2, arg3)` calls via regex.
2. For each call, resolves `arg1` as either a named hue (lookup in `HUE_FAMILIES`) or a raw numeric angle.
3. Computes the oklch() string using the same math as `hvvColor()`:
   - L = piecewise from L_DARK through canonicalL to L_LIGHT based on val.
   - C = (vib / 100) * peakC where peakC = MAX_CHROMA_FOR_HUE[hue] * PEAK_C_SCALE.
   - For raw angles: uses `findMaxChroma(canonicalL, angle)` to determine max chroma at that angle, then peakC = maxC * PEAK_C_SCALE. Uses a default canonicalL of 0.77 for raw angles (the median of DEFAULT_CANONICAL_L values across all 24 hue families, ranging from 0.619 to 0.901).
4. Replaces the `--hvv()` call in the value string with the computed `oklch(L C h)`.

**Spec S01: --hvv() Syntax** {#s01-hvv-syntax}

```
--hvv( <hue> , <vibrancy> , <value> )

<hue>      := <hue-name> | <number>
<hue-name> := cherry | red | tomato | flame | orange | amber | gold | yellow
             | lime | green | mint | teal | cyan | sky | blue | cobalt
             | violet | purple | plum | pink | rose | magenta | berry | coral
<vibrancy> := <number>   /* 0-100 */
<value>    := <number>   /* 0-100 */
```

Examples:
- `--hvv(blue, 5, 13)` -- named hue
- `--hvv(237, 5, 13)` -- raw angle
- `--hvv(cobalt, 3, 18)` -- named hue, low vibrancy

#### oklchToHVV() Reverse Mapping Algorithm {#reverse-mapping}

Given an oklch() color string, reverse-map to the closest HVV notation:

1. Parse the oklch string to extract L, C, h values.
2. Find the closest named hue family by comparing h to all angles in `HUE_FAMILIES`. If the closest angle is within 5 degrees, use the named hue; otherwise use `hue-NNN` notation.
3. Derive `val` from L: invert the piecewise formula. If L <= canonicalL, val = 50 * (L - L_DARK) / (canonicalL - L_DARK). If L > canonicalL, val = 50 + 50 * (L - canonicalL) / (L_LIGHT - canonicalL). Clamp to [0, 100] and round to integer.
4. Derive `vib` from C: peakC = maxChroma * PEAK_C_SCALE, vib = (C / peakC) * 100. Clamp to [0, 100] and round to integer.
5. Return `{ hue, vib, val }`.

`hvvPretty()` formats the result as a human-readable string: `"blue vib=5 val=13"` or `"hue-237 vib=5 val=13"`.

#### Hex-to-HVV Conversion Pipeline {#conversion-pipeline}

The one-time conversion script uses `postcss.parse()` to walk the CSS AST, which automatically separates comments from declarations and prevents corruption of hex values that appear inside CSS comments (harmony.css has 7+ comments containing hex references):

1. Reads each theme CSS file and parses it with `postcss.parse()`.
2. Walks only `Declaration` nodes (comments are separate AST nodes and are never visited):
   - For each declaration whose value contains a standalone `#hex` (6-digit or 3-digit):
     - Skip if the hex is inside a CSS function call (`rgba()`, `color-mix()`, `url()`, etc.) by checking the surrounding value context.
     - Special case: `#ffffff` becomes `var(--tug-white)` (appears in harmony.css only).
     - Convert hex to oklch (via standard hex-to-sRGB-to-OKLCH pipeline).
     - Run `oklchToHVV()` to get the HVV parameters.
     - Replace the hex value with `--hvv(hue, vib, val)`.
3. Serializes the modified AST back to the file (preserving comments, whitespace, and non-declaration nodes).
4. Validates round-trip accuracy by comparing original hex oklch values with the PostCSS-expanded output.

**Table T01: Theme Tint Characteristics** {#t01-theme-tints}

| Theme | Primary Tint Hue | Vibrancy Range | Notes |
|-------|------------------|----------------|-------|
| Brio (tug-tokens.css) | cobalt/violet | 3-6 | Cool-neutral dark, slight blue-purple tint |
| Bluenote | blue | 5-14 | Blue-steel dark, stronger blue tint |
| Harmony | yellow/gold | 4-10 | Warm light theme, yellow-tinted surfaces with blue-tinted text |

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**PostCSS Plugin Input:** CSS files containing `--hvv(hue, vib, val)` patterns in declaration values.

**PostCSS Plugin Output:** Same CSS with `--hvv()` calls replaced by `oklch(L C h)` strings.

**oklchToHVV() Input:** An `oklch(L C h)` CSS string.

**oklchToHVV() Output:** An object `{ hue: string, vib: number, val: number }` where hue is a named family or `hue-NNN`.

#### Terminology and Naming {#terminology}

| Term | Definition |
|------|-----------|
| HVV | Hue, Vibrancy, Value — the three-axis color system |
| `--hvv()` | CSS function notation expanded at build time by the PostCSS plugin |
| Named hue | One of 24 hue family names (cherry through coral) |
| Raw angle | A numeric OKLCH hue angle (0-360) used directly instead of a named hue |
| Vibrancy | Chroma axis, 0-100; at vib=50, C equals sRGB-safe max |
| Value | Lightness axis, 0-100; at val=50, L equals canonical L for the hue |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/postcss-hvv.ts` | PostCSS plugin that expands `--hvv()` to `oklch()` |
| `tugdeck/scripts/convert-hex-to-hvv.ts` | One-time conversion script for theme files |
| `tugdeck/src/__tests__/postcss-hvv.test.ts` | Tests for PostCSS plugin (imports from `bun:test`) |
| `tugdeck/src/__tests__/convert-hex-to-hvv.test.ts` | Tests for conversion script (imports from `bun:test`) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `oklchToHVV` | fn | `palette-engine.ts` | Reverse maps oklch string to `{ hue, vib, val }` |
| `hvvPretty` | fn | `palette-engine.ts` | Formats HVV as human-readable string |
| `postcssHvv` | fn | `postcss-hvv.ts` | PostCSS plugin factory function |
| `convertHexToHvv` | script | `scripts/convert-hex-to-hvv.ts` | One-time hex conversion script |

---

### Documentation Plan {#documentation-plan}

- [ ] Update palette-engine.ts JSDoc with oklchToHVV() and hvvPretty() documentation.
- [ ] Add inline comments in postcss-hvv.ts explaining the plugin architecture.
- [ ] Add comments in vite.config.ts explaining the css.postcss configuration.
- [ ] Update theme file headers to reference the --hvv() notation.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `oklchToHVV()` round-trips, `hvvPretty()` formatting, plugin regex matching | Core logic, edge cases |
| **Integration** | Test PostCSS plugin processes CSS files correctly end-to-end | Plugin wiring, Vite build |
| **Golden / Contract** | Compare PostCSS output against known-good oklch values | Regression prevention |
| **Drift Prevention** | Verify theme files contain no residual hex values after conversion | Post-conversion validation |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add oklchToHVV() and hvvPretty() to palette-engine.ts {#step-1}

**Commit:** `feat(palette): add oklchToHVV() reverse mapper and hvvPretty() formatter`

**References:** [D04] Re-derive HVV mappings programmatically, [D05] Number precision matches hvvColor(), Spec S01, (#reverse-mapping, #inputs-outputs, #terminology)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/palette-engine.ts` with two new exported functions.

**Tasks:**
- [ ] Implement `oklchToHVV(oklchStr: string): { hue: string; vib: number; val: number }`:
  - Parse `oklch(L C h)` string to extract numeric L, C, h.
  - Find closest named hue by comparing h to all `HUE_FAMILIES` angles. Use named hue if within 5 degrees; otherwise return `hue-NNN`.
  - Invert the val-to-L piecewise formula to recover val (round to integer).
  - Compute peakC from `MAX_CHROMA_FOR_HUE` and `PEAK_C_SCALE`, then vib = (C / peakC) * 100 (round to integer).
  - For raw-angle hues (no named match), use `findMaxChroma()` to determine max chroma at that angle and a default canonicalL of 0.77 (the median of DEFAULT_CANONICAL_L values across all 24 hue families, which range from 0.619 to 0.901).
- [ ] Implement `hvvPretty(oklchStr: string): string`:
  - Call `oklchToHVV()` and format as `"blue vib=5 val=13"` or `"hue-237 vib=5 val=13"`.
- [ ] Verify round-trip: for each of the 24 hue families, confirm `oklchToHVV(hvvColor(hue, vib, val, canonicalL))` recovers `{hue, vib, val}` within tolerance for a range of vib/val inputs.

**Tests:**
- [ ] Round-trip test: for all 24 hues at vib=50/val=50, oklchToHVV(hvvColor(...)) recovers exact hue name and vib/val.
- [ ] Round-trip test: edge values vib=0, vib=100, val=0, val=100.
- [ ] Raw angle test: oklchToHVV with an oklch string at hue angle 237 returns `hue-237`.
- [ ] hvvPretty formatting: verify output strings match expected format.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/palette-engine.test.ts` passes (tests go in `src/__tests__/` per project convention, importing from `bun:test`).

---

#### Step 2: Create PostCSS plugin (postcss-hvv.ts) {#step-2}

**Depends on:** #step-1

**Commit:** `feat(build): add postcss-hvv plugin for --hvv() expansion`

**References:** [D01] Bespoke PostCSS plugin, [D05] Number precision, Spec S01, (#plugin-architecture, #s01-hvv-syntax, #inputs-outputs)

**Artifacts:**
- New file `tugdeck/postcss-hvv.ts`.

**Tasks:**
- [ ] Add `postcss` as an explicit devDependency: `cd tugdeck && bun add -D postcss`. This promotes postcss from transitive (via `@tailwindcss/vite` and `vite`) to explicit, ensuring stable resolution and type availability.
- [ ] Create `postcss-hvv.ts` exporting a PostCSS plugin factory function.
- [ ] Implement the Declaration visitor that:
  - Detects `--hvv(` in declaration values.
  - Extracts arguments via regex: `--hvv\(\s*([a-z]+|\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)`.
  - Resolves named hues via `HUE_FAMILIES` lookup.
  - For raw numeric angles: uses `findMaxChroma()` at a default canonicalL of 0.77 (the median of DEFAULT_CANONICAL_L values across all 24 hue families, which range from 0.619 to 0.901) to determine max chroma, then computes oklch.
  - For named hues: uses `DEFAULT_CANONICAL_L[hue]` and `MAX_CHROMA_FOR_HUE[hue]` with `PEAK_C_SCALE`.
  - Applies the same L and C formulas as `hvvColor()`.
  - Formats output with 4 decimal places, trailing zeros stripped.
  - Replaces the `--hvv()` call in the value with the computed `oklch(L C h)` string.
- [ ] Handle multiple `--hvv()` calls in a single declaration value (replace all occurrences).
- [ ] Import constants from `palette-engine.ts` using explicit relative path `./src/components/tugways/palette-engine` (the `@/` alias does not work in Node/Bun PostCSS context; Bun's native TS support handles the `.ts` import).

**Tests:**
- [ ] Unit test: `--hvv(blue, 5, 13)` expands to `oklch(0.3115 0.0143 230)` (L = 0.15 + 13 * (0.771 - 0.15) / 50).
- [ ] Unit test: `--hvv(237, 5, 13)` expands correctly for raw angle.
- [ ] Unit test: multiple `--hvv()` calls in one value are all expanded.
- [ ] Unit test: values without `--hvv()` are left unchanged.
- [ ] Unit test: `var()`, `color-mix()`, `rgba()` values pass through unmodified.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/postcss-hvv.test.ts` passes (test imports from `bun:test`).

---

#### Step 3: Wire PostCSS plugin into Vite config {#step-3}

**Depends on:** #step-2

**Commit:** `feat(build): wire postcss-hvv plugin into vite.config.ts`

**References:** [D02] Inline PostCSS in Vite config, [D03] Keep palette var() formulas, (#plugin-architecture)

**Artifacts:**
- Modified `tugdeck/vite.config.ts` with `css.postcss.plugins` configuration.

**Tasks:**
- [ ] Import `postcssHvv` from `./postcss-hvv.ts` in vite.config.ts.
- [ ] Add `css: { postcss: { plugins: [postcssHvv()] } }` to the Vite config return object.
- [ ] Verify the plugin coexists with `@tailwindcss/vite` (Tailwind v4 uses a Vite plugin, not PostCSS).
- [ ] Create a small test CSS file with `--hvv()` calls and verify it expands correctly in dev mode.

**Tests:**
- [ ] Manual verification: add a temporary `--hvv(blue, 50, 50)` declaration and check dev server output.

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no errors.
- [ ] Dev server (`bun run dev`) processes `--hvv()` declarations correctly.

---

#### Step 4: Build hex-to-HVV conversion script {#step-4}

**Depends on:** #step-1

**Commit:** `feat(scripts): add convert-hex-to-hvv conversion script`

**References:** [D04] Re-derive HVV mappings programmatically, Table T01, (#conversion-pipeline, #reverse-mapping)

**Artifacts:**
- New file `tugdeck/scripts/convert-hex-to-hvv.ts`.

**Tasks:**
- [ ] Implement hex-to-oklch conversion: hex string to sRGB [0,1], then sRGB to OKLCH using the inverse of the existing `oklchToLinearSRGB` pipeline (sRGB to linear, linear sRGB to LMS, LMS to OKLab, OKLab to OKLCH).
- [ ] Use `postcss.parse()` to parse each CSS file into an AST. Walk only `Declaration` nodes to identify standalone `#hex` values. Comments are separate AST nodes and are automatically skipped, preventing corruption of hex values in CSS comments (harmony.css has 7+ comments containing hex references like `#c46020`, `#8a7200`, etc.).
- [ ] For each declaration value containing a standalone hex, check context to skip hex inside function calls (`rgba()`, `color-mix()`, `url()`).
- [ ] Special-case `#ffffff` to `var(--tug-white)` (appears in harmony.css only; `#000000` does not appear in any theme file).
- [ ] For each hex value, convert to oklch, run `oklchToHVV()`, and replace with `--hvv(hue, vib, val)`.
- [ ] Preserve all non-hex values (var(), color-mix(), rgba(), transparent, etc.) unchanged.
- [ ] Serialize the modified AST back to the file, preserving comments, whitespace, and structure.
- [ ] Add a round-trip validation mode: after conversion, run the PostCSS plugin on the output and compare the expanded oklch values against the original hex-derived oklch values (delta-E < 0.01).

**Tests:**
- [ ] Unit test: hex-to-oklch conversion matches known reference values.
- [ ] Unit test: PostCSS AST parser correctly identifies standalone hex values in declarations vs. hex inside function calls.
- [ ] Unit test: hex values inside CSS comments are not modified (feed comment-containing CSS through the script and verify comments are unchanged).
- [ ] Unit test: `#ffffff` special case produces `var(--tug-white)` output.

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/convert-hex-to-hvv.test.ts` passes (test imports from `bun:test`).

---

#### Step 5: Convert tug-tokens.css hex values to --hvv() {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `refactor(tokens): convert tug-tokens.css hex values to --hvv() notation`

**References:** [D03] Keep palette var() formulas, [D04] Re-derive mappings, [D05] Number precision, Table T01, (#conversion-pipeline, #t01-theme-tints)

**Artifacts:**
- Modified `tugdeck/styles/tug-tokens.css` with all standalone hex values replaced by `--hvv()` calls.

**Tasks:**
- [ ] Run the conversion script on `tugdeck/styles/tug-tokens.css`.
- [ ] Verify that all `var()`, `color-mix()`, `rgba()`, and `transparent` values are preserved unchanged.
- [ ] Verify that all standalone `#hex` values in the body{} block are replaced with `--hvv()` calls.
- [ ] Confirm the cobalt/violet tint characteristic of Brio tokens (vib 3-6 range) in the converted output.
- [ ] Leave non-body declarations (font-face, :root, scrollbar styling) unchanged.

**Tests:**
- [ ] Grep confirms zero standalone hex values remain in body{} block (excluding values inside rgba/color-mix).
- [ ] Build succeeds: `cd tugdeck && bun run build`.

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no errors.
- [ ] Visual spot-check: Brio theme surfaces, text, and borders appear correct in dev server.

---

#### Step 6: Convert bluenote.css hex values to --hvv() {#step-6}

**Depends on:** #step-3, #step-4

**Commit:** `refactor(tokens): convert bluenote.css hex values to --hvv() notation`

**References:** [D04] Re-derive mappings, [D05] Number precision, Table T01, (#conversion-pipeline, #t01-theme-tints)

**Artifacts:**
- Modified `tugdeck/styles/bluenote.css` with all standalone hex values replaced by `--hvv()` calls.

**Tasks:**
- [ ] Run the conversion script on `tugdeck/styles/bluenote.css`.
- [ ] Verify the blue tint characteristic (vib 5-14 range) in the converted output.
- [ ] Confirm all `rgba()` values (shadows, selection) are preserved unchanged.

**Tests:**
- [ ] Grep confirms zero standalone hex values remain in body{} block.
- [ ] Build succeeds: `cd tugdeck && bun run build`.

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no errors.
- [ ] Visual spot-check: Bluenote theme surfaces and borders appear correct.

---

#### Step 7: Convert harmony.css hex values to --hvv() {#step-7}

**Depends on:** #step-3, #step-4

**Commit:** `refactor(tokens): convert harmony.css hex values to --hvv() notation`

**References:** [D04] Re-derive mappings, [D05] Number precision, [D06] Convert all contrast-critical hex overrides, Table T01, (#conversion-pipeline, #t01-theme-tints)

**Artifacts:**
- Modified `tugdeck/styles/harmony.css` with all standalone hex values replaced by `--hvv()` calls, including contrast-critical overrides.

**Tasks:**
- [ ] Run the conversion script on `tugdeck/styles/harmony.css`.
- [ ] Verify the yellow/gold tint characteristic for surfaces (vib 4-10) and blue tint for text in the converted output.
- [ ] Verify all contrast-critical hex overrides are converted per [D06]: `#c46020` to `--hvv(flame, 45, 38)`, `#8a7200` to `--hvv(yellow, 46, 27)`, `#b89000` to `--hvv(yellow, 55, 35)`, `#2898c8` to `--hvv(blue, 42, 40)`, `#ffe15a` to `--hvv(yellow, 62, 58)`.
- [ ] Update existing [D06] comments in harmony.css to reference the new HVV values instead of hex.
- [ ] Convert all `#ffffff` occurrences to `var(--tug-white)`.
- [ ] Confirm all `rgba()` and `color-mix()` values are preserved unchanged.

**Tests:**
- [ ] Grep confirms zero standalone hex values remain in body{} block.
- [ ] Build succeeds: `cd tugdeck && bun run build`.

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` succeeds with no errors.
- [ ] Visual spot-check: Harmony theme surfaces, text, and warm tones appear correct.

---

#### Step 8: Integration Checkpoint {#step-8}

**Depends on:** #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Bespoke plugin, [D02] Inline PostCSS, [D03] Palette unchanged, [D04] Programmatic derivation, [D05] Number precision, Risk R01, Risk R02, (#success-criteria)

**Tasks:**
- [ ] Verify all three theme files and the PostCSS plugin work together end-to-end.
- [ ] Confirm `tug-palette.css` is completely unmodified.
- [ ] Confirm `brio.css` is completely unmodified.
- [ ] Verify no standalone `#hex` color values remain in tug-tokens.css, bluenote.css, or harmony.css body{} blocks.
- [ ] Full build succeeds: `cd tugdeck && bun run build`.
- [ ] Dev server hot-reload works: modify an `--hvv()` value and confirm it updates in the browser.
- [ ] Verify `oklchToHVV()` round-trip accuracy across all converted tokens.

**Tests:**
- [ ] Full test suite passes: `cd tugdeck && bun test` covering plugin, reverse mapper, and conversion tests.

**Checkpoint:**
- [ ] `cd tugdeck && bun run build` completes with zero errors and zero warnings.
- [ ] `grep -rn '#[0-9a-fA-F]\{3,8\}' tugdeck/styles/tug-tokens.css tugdeck/styles/bluenote.css tugdeck/styles/harmony.css` returns only values inside `rgba()` / `color-mix()` / comments, not standalone hex.
- [ ] All test suites pass: `cd tugdeck && bun test`.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A build-time PostCSS plugin that expands `--hvv()` color notation to `oklch()`, with all theme files converted from hardcoded hex to `--hvv()` calls, and a reverse mapper (`oklchToHVV()`) for developer tooling.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `postcss-hvv.ts` plugin expands all `--hvv()` calls to correct `oklch()` values at build time.
- [ ] `oklchToHVV()` and `hvvPretty()` are exported from palette-engine.ts and round-trip correctly.
- [ ] tug-tokens.css, bluenote.css, and harmony.css contain zero standalone hex color values in their body{} blocks.
- [ ] `tug-palette.css` and `brio.css` are completely unmodified.
- [ ] `bun run build` succeeds with no errors.
- [ ] Dev server hot-reload processes `--hvv()` changes correctly.

**Acceptance tests:**
- [ ] `cd tugdeck && bun run build` exits 0.
- [ ] `cd tugdeck && bun test` all tests pass.
- [ ] Visual verification: all three themes render correctly with no color regression.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Per-theme canonical L tuning for accessibility-optimized contrast.
- [ ] Dev overlay tool that shows HVV values on hover (using `hvvPretty()`).
- [ ] Theme builder UI that uses `--hvv()` notation for user-defined themes.
- [ ] Linter rule to prevent new hex values from being added to theme files.

| Checkpoint | Verification |
|------------|--------------|
| PostCSS plugin works | `--hvv(blue, 50, 50)` expands to correct oklch value |
| Build succeeds | `cd tugdeck && bun run build` exits 0 |
| No hex regression | grep for standalone hex in theme files returns empty |
| Round-trip accuracy | oklchToHVV(hvvColor(hue, vib, val)) recovers original params |
| Tests pass | `cd tugdeck && bun test` exits 0 |
