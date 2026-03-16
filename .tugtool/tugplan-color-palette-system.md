## Color Palette System: Named Grayscale, Transparent, and Picker Fixes {#color-palette-system}

**Purpose:** Replace numeric gray-NN names with descriptive names across the entire TugColor system, add `transparent` as a named color, and fix cosmetic issues in the compact hue popover picker.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-16 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The TugColor system currently uses numeric `gray-NN` names (gray-10 through gray-90) for intermediate achromatic values. These are functional but lack the evocative quality of the chromatic palette (48 hues with names like cobalt, vermilion, jade). Replacing them with descriptive names (paper, linen, parchment, vellum, graphite, carbon, charcoal, ink, pitch) makes the achromatic palette more memorable and consistent with the system's design philosophy.

Additionally, `transparent` is a common CSS concept that has no representation in the --tug-color() notation. Adding it as a named color (expanding to `oklch(0 0 0 / 0)`) closes a gap in the color vocabulary. Separately, the compact hue popover picker added in the theme-creation-gaps plan has minor CSS/layout issues that need cleanup.

#### Strategy {#strategy}

- Foundational first: implement named grays and transparent in the parser/engine before updating consumers.
- Named grays replace `--tug-gray-NN` CSS variables one-to-one; the `gray` pseudo-hue remains valid for continuous tone access.
- Achromatic adjacency uses the same 2/3 + 1/3 weighting formula as hue adjacency, applied to lightness values on a linear (non-wrapping) sequence.
- Transparent is a special-case color excluded from all adjacency (ring and linear).
- Picker fixes are CSS-only, sequenced last since they have no dependencies on the color system changes.
- Each step has its own commit boundary; an integration checkpoint verifies the full palette system before the cosmetic pass.

#### Success Criteria (Measurable) {#success-criteria}

- All 9 named gray keywords (paper through pitch) parse successfully in `parseTugColor()` and expand to correct oklch() values in the PostCSS plugin (verified by unit tests).
- `transparent` parses to `oklch(0 0 0 / 0)` and produces warnings when i/t/a args are supplied (verified by unit tests).
- `--tug-gray-paper` through `--tug-gray-pitch` CSS variables replace `--tug-gray-10` through `--tug-gray-90` in tug-palette.css (verified by `bun run generate:palette` succeeding).
- Achromatic adjacency produces correct hyphenated names (e.g., paper-linen, linen-paper) with different L values for each direction (verified by unit tests).
- The compact hue popover hides rotated labels, constrains width properly, and wraps swatches cleanly (verified by visual inspection).
- Total named color count: 60 basic (48 chromatic + 11 achromatic + 1 transparent), 176 extended with adjacency (144 chromatic + 31 achromatic + 1 transparent).

#### Scope {#scope}

1. Named gray keywords in parser, PostCSS plugin, and palette engine
2. Achromatic linear adjacency sequence and hyphenated name resolution
3. `transparent` keyword with warning behavior
4. CSS variable rename from `--tug-gray-NN` to `--tug-gray-{name}`
5. Gallery palette content achromatic strip update
6. Compact hue popover CSS fixes

#### Non-goals (Explicitly out of scope) {#non-goals}

- Deprecation warnings for `gray-10` through `gray-90` numeric forms (may be a follow-on)
- P3 gamut support for achromatic adjacency (achromatics are always C=0)
- New preset definitions for named grays
- Architectural changes to the compact hue picker component

#### Dependencies / Prerequisites {#dependencies}

- Gray pseudo-hue and parser rewrite (tugplan-gray-parser-rewrite) must be complete (it is; merged as commit 51310a4f)
- Theme creation gaps plan (tugplan-theme-creation-gaps) must be complete for the picker component to exist

#### Constraints {#constraints}

- Named grays must produce identical oklch() values to the numeric grays they replace (no visual change)
- The `gray` pseudo-hue must remain valid as a backward-compatible name for continuous tone access
- `transparent` must not appear in any adjacency sequence
- Picker fixes are primarily CSS; minor Radix prop adjustments (e.g., collisionPadding) are permitted but no component architecture changes

#### Assumptions {#assumptions}

- The 9 named grays are fixed and will not change (paper=10, linen=20, parchment=30, vellum=40, graphite=50, carbon=60, charcoal=70, ink=80, pitch=90)
- Achromatic adjacency uses lightness blending (2/3 + 1/3) on the linear sequence, not hue angle blending (achromatics have no hue)
- No existing code outside this repository references `--tug-gray-10` through `--tug-gray-90` by name

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors on all headings and stable labels for all artifacts, per the skeleton convention.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All ambiguities were resolved during clarification.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| CSS variable rename breaks downstream consumers | med | low | Search-and-replace all references; no external consumers known | If external themes reference --tug-gray-NN |
| Achromatic adjacency naming collisions | low | low | Linear sequence with no wrap eliminates ambiguity | If new achromatic names are added later |

**Risk R01: CSS Variable Rename Breakage** {#r01-css-rename-breakage}

- **Risk:** Renaming `--tug-gray-NN` to `--tug-gray-{name}` could break any CSS that references the old variable names.
- **Mitigation:**
  - Grep the entire codebase for `--tug-gray-` references before and after the rename
  - The generate-tug-palette.ts script produces these variables, so updating the script updates all generated output
  - tug-base.css and theme files will be checked for references
- **Residual risk:** Any hand-written CSS outside the generated files that uses the old names will break silently (no runtime error, just missing variable).

---

### Design Decisions {#design-decisions}

#### [D01] Named Grays Replace Numeric Grays (DECIDED) {#d01-named-grays}

**Decision:** The 9 intermediate achromatic values use descriptive names (paper, linen, parchment, vellum, graphite, carbon, charcoal, ink, pitch) instead of numeric suffixes (10, 20, ..., 90).

**Rationale:**
- Descriptive names are more memorable and consistent with the chromatic palette naming philosophy
- Names evoke material/texture associations that aid design communication
- Dark-to-light ordering in the achromatic sequence: paper (tone 10, L=0.22, darkest named gray) through pitch (tone 90, L=0.868, lightest named gray). The names map to their position in the tone ramp, not to the perceived lightness of their real-world referents. This is the user's explicit specification

**Implications:**
- `--tug-gray-10` becomes `--tug-gray-paper`, etc.
- GRAY_STEPS in gallery-palette-content.tsx must use the new names
- The `gray` pseudo-hue with continuous tone remains valid as a separate mechanism

#### [D02] Transparent as Special-Case Color (DECIDED) {#d02-transparent}

**Decision:** `transparent` is a named color that expands to `oklch(0 0 0 / 0)`. It is excluded from all adjacency (ring and linear). When i/t/a arguments are supplied, a warning is produced (same pattern as black/white ignoring intensity).

**Rationale:**
- `transparent` is a fundamental CSS concept that belongs in the color vocabulary
- It has no meaningful intensity, tone, or alpha override — the whole point is full transparency
- Excluding from adjacency prevents nonsensical combinations like `paper-transparent`

**Implications:**
- Added to KNOWN_HUES in postcss-tug-color.ts
- Parser produces warnings for any i/t/a args, not errors (soft degradation)
- expandTugColor() handles it as a special case before the gray/black/white checks

#### [D03] Achromatic Linear Adjacency (DECIDED) {#d03-achromatic-adjacency}

**Decision:** Achromatic adjacency uses the same 2/3 + 1/3 weighting formula as chromatic adjacency, but applied to lightness values on a linear (non-wrapping) sequence: black, paper, linen, parchment, vellum, graphite, carbon, charcoal, ink, pitch, white. The `gray` pseudo-hue is intentionally excluded from this sequence — it is a continuous tone accessor, not a fixed-lightness named gray, and does not participate in achromatic adjacency.

**Rationale:**
- Consistent weighting formula across chromatic and achromatic systems
- Linear (not circular) because there is no meaningful wrap between black and white
- Both directions valid: paper-linen and linen-paper resolve to different L values

**Implications:**
- New `ACHROMATIC_SEQUENCE` array in palette-engine.ts
- New `resolveAchromaticAdjacency()` function to compute blended L value
- `parseTugColor()` signature extended with an optional `achromaticSequence` parameter (parallel to the existing `adjacencyRing` parameter). The PostCSS plugin passes `ACHROMATIC_SEQUENCE` so the parser validates achromatic adjacency in addition to ring adjacency
- 11 base achromatic + 20 hyphenated = 31 achromatic names total

#### [D05] Drop --tug-gray-0 and --tug-gray-100 Endpoint Variables (DECIDED) {#d05-drop-gray-endpoints}

**Decision:** The `--tug-gray-0` and `--tug-gray-100` CSS variables are dropped from the generated palette. `--tug-black` and `--tug-white` are the only endpoint variables.

**Rationale:**
- `--tug-gray-0` (L=0.15) is not a true alias for `--tug-black` (L=0); they have different L values. This is confusing.
- `--tug-gray-100` (L=0.96) is not a true alias for `--tug-white` (L=1); same issue.
- No CSS files outside tug-palette.css reference these endpoint variables (verified by grep).
- Named grays start at paper (tone 10) and end at pitch (tone 90); endpoints are black and white.

**Implications:**
- generate-tug-palette.ts emits 9 named gray variables (paper through pitch) instead of 11 numeric variables (0 through 100)
- palette-engine.test.ts gray ramp tests updated to assert on named variables and the absence of `--tug-gray-0` / `--tug-gray-100`

#### [D06] Named Grays Have Fixed Lightness (DECIDED) {#d06-named-gray-fixed-l}

**Decision:** Named grays (paper through pitch) are fixed-lightness achromatic colors. `expandTugColor()` looks up the named gray's inherent tone from `NAMED_GRAYS`, computes L from that inherent tone using the gray piecewise formula, and ignores the parser's intensity and tone parameters entirely. Supplying intensity or tone produces a warning. Alpha is the only parameter that modulates named gray output.

**Rationale:**
- Named grays are specific, memorable reference points — paper always means L=0.22, pitch always means L=0.868
- This is consistent with black/white behavior (fixed L, ignore i/t)
- If adjustable lightness is needed, use the `gray` pseudo-hue with an explicit tone value
- Allowing tone to shift a named gray's L would make names meaningless aliases for `gray`

**Implications:**
- `expandTugColor()` named gray path: look up inherent tone from `NAMED_GRAYS`, compute L via gray formula, return `oklch(L 0 0 / alpha)`
- Parser warning logic (tier 2): warn on both intensity > 0 AND tone when explicitly provided
- `--tug-color(paper, t: 80)` expands to `oklch(0.22 0 0)` with a tone-ignored warning
- `--tug-color(paper, a: 50)` expands to `oklch(0.22 0 0 / 0.5)` — alpha IS honored

#### [D04] Picker Fixes are Primarily CSS (DECIDED) {#d04-picker-css-only}

**Decision:** The compact hue popover fixes are primarily CSS changes. Minor Radix prop adjustments (e.g., adding `collisionPadding`) are permitted, but no component architecture changes.

**Rationale:**
- The issues are purely visual: label visibility, width constraint, swatch wrapping
- The component structure (Radix Popover, TugHueStrip) is sound
- CSS-focused fixes minimize risk and review surface; small prop tweaks improve positioning without architectural impact

**Implications:**
- Changes primarily in gallery-theme-generator-content.css and possibly tug-hue-strip.css
- Minor prop additions in gallery-theme-generator-content.tsx (collisionPadding only)
- No test changes needed for the picker fixes (visual verification only)

---

### Specification {#specification}

#### Named Gray Mapping {#named-gray-mapping}

**Table T01: Named Gray Tone Mapping** {#t01-gray-mapping}

| Name | Tone | L Value (oklch) | CSS Variable |
|------|------|-----------------|-------------|
| black | 0 | 0 | --tug-black |
| paper | 10 | 0.22 | --tug-gray-paper |
| linen | 20 | 0.29 | --tug-gray-linen |
| parchment | 30 | 0.36 | --tug-gray-parchment |
| vellum | 40 | 0.43 | --tug-gray-vellum |
| graphite | 50 | 0.5 | --tug-gray-graphite |
| carbon | 60 | 0.592 | --tug-gray-carbon |
| charcoal | 70 | 0.684 | --tug-gray-charcoal |
| ink | 80 | 0.776 | --tug-gray-ink |
| pitch | 90 | 0.868 | --tug-gray-pitch |
| white | 100 | 1 | --tug-white |

#### Achromatic Adjacency Sequence {#achromatic-adjacency-sequence}

**List L01: Achromatic Linear Sequence** {#l01-achromatic-sequence}

The achromatic sequence is a linear (non-wrapping) list:

`black, paper, linen, parchment, vellum, graphite, carbon, charcoal, ink, pitch, white`

Adjacent pairs: black-paper, paper-linen, linen-parchment, parchment-vellum, vellum-graphite, graphite-carbon, carbon-charcoal, charcoal-ink, ink-pitch, pitch-white (10 pairs, 20 hyphenated names since both directions are valid).

**Adjacency resolution formula:** For achromatic pair A-B where A is the dominant (first) name:
- Look up L_A and L_B from the achromatic sequence
- Blended L = (2/3) * L_A + (1/3) * L_B
- C = 0 (always achromatic), h = 0

Example: `paper-linen` → L = (2/3)(0.22) + (1/3)(0.29) = 0.2433; `linen-paper` → L = (2/3)(0.29) + (1/3)(0.22) = 0.2667

#### Transparent Behavior {#transparent-behavior}

**Spec S01: Transparent Color Semantics** {#s01-transparent-semantics}

- `--tug-color(transparent)` → `oklch(0 0 0 / 0)`
- `--tug-color(transparent, i: 50)` → `oklch(0 0 0 / 0)` + warning: "intensity is ignored for 'transparent' (always oklch(0 0 0 / 0))"
- `--tug-color(transparent, t: 50)` → `oklch(0 0 0 / 0)` + warning: "tone is ignored for 'transparent' (always oklch(0 0 0 / 0))"
- `--tug-color(transparent, a: 50)` → `oklch(0 0 0 / 0)` + warning: "alpha is ignored for 'transparent' (always oklch(0 0 0 / 0))"
- Transparent cannot participate in adjacency (not in ring, not in achromatic sequence)
- `--tug-color(paper-transparent)` → hard error: "'paper' and 'transparent' are not adjacent"

#### Color Count Summary {#color-count-summary}

**Table T02: Color Vocabulary Counts** {#t02-color-counts}

| Category | Base | Hyphenated | Total |
|----------|------|------------|-------|
| Chromatic (circular ring) | 48 | 96 | 144 |
| Achromatic (linear, no wrap) | 11 | 20 | 31 |
| Transparent | 1 | 0 | 1 |
| **Total** | **60** | **116** | **176** |

---

### Compatibility / Migration / Rollout (Optional) {#rollout}

- **Compatibility policy**: CSS variable names change from `--tug-gray-NN` to `--tug-gray-{name}`. This is a breaking change for any CSS that references the old names.
- **Migration plan**:
  - All references in the codebase are updated in the same commit
  - No external consumers are known
  - The `gray` pseudo-hue with numeric tone continues to work unchanged
- **Rollout plan**: Ship in a single PR; no feature gates needed.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes are to existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `NAMED_GRAYS` | const map | `tugdeck/src/components/tugways/palette-engine.ts` | Map from descriptive name to tone value: `{ paper: 10, linen: 20, ... }` |
| `ACHROMATIC_SEQUENCE` | const array | `tugdeck/src/components/tugways/palette-engine.ts` | Linear sequence: `["black", "paper", "linen", ..., "pitch", "white"]` |
| `ACHROMATIC_L_VALUES` | const map | `tugdeck/src/components/tugways/palette-engine.ts` | Map from achromatic name to L value |
| `resolveAchromaticAdjacency` | function | `tugdeck/src/components/tugways/palette-engine.ts` | Compute blended L for achromatic hyphenated pair |
| `isAchromaticAdjacent` | function | `tugdeck/src/components/tugways/palette-engine.ts` | Check if two achromatic names are adjacent in the linear sequence |
| `KNOWN_HUES` | const set (modified) | `tugdeck/postcss-tug-color.ts` | Add 9 named grays + `transparent` |
| `expandTugColor` | function (modified) | `tugdeck/postcss-tug-color.ts` | Handle transparent, named grays, and achromatic adjacency |
| `GRAY_STEPS` | const (modified) | `tugdeck/src/components/tugways/cards/gallery-palette-content.tsx` | Use named grays instead of numeric tones |
| `SlotParser` | type (modified) | `tugdeck/tug-color-parser.ts` | Add optional `achromaticSequence` parameter |
| `SLOT_DISPATCH` | const (modified) | `tugdeck/tug-color-parser.ts` | Forward `achromaticSequence` from color slot to `parseColorTokens()` |
| `parseColorTokens` | function (modified) | `tugdeck/tug-color-parser.ts` | Accept `achromaticSequence`; implement ring-then-achromatic fallback adjacency validation |
| `parseTugColor` | function (modified) | `tugdeck/tug-color-parser.ts` | Add optional `achromaticSequence` parameter; three-tier warning logic for transparent/named grays/existing achromatics |
| `generateGrayRamp` | function (modified) | `tugdeck/scripts/generate-tug-palette.ts` | Output `--tug-gray-paper` instead of `--tug-gray-10`, etc. |

---

### Documentation Plan {#documentation-plan}

- [ ] Update module-level JSDoc in `tugdeck/src/components/tugways/palette-engine.ts` to mention named grays and achromatic adjacency
- [ ] Update module-level JSDoc in `tugdeck/postcss-tug-color.ts` to list transparent and named gray keywords
- [ ] Update module-level JSDoc in `tugdeck/tug-color-parser.ts` to document the 60-name vocabulary

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify named gray parsing, transparent expansion, achromatic adjacency resolution | Core parser and PostCSS logic |
| **Integration** | Verify end-to-end CSS variable generation with new names | generate-tug-palette.ts output |
| **Drift Prevention** | Verify named gray oklch values match old numeric gray values exactly | Prevent visual regression |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add Named Gray Constants to Palette Engine {#step-1}

**Commit:** `feat: add named gray constants and achromatic sequence to palette engine`

**References:** [D01] Named grays replace numeric grays, [D03] Achromatic linear adjacency, Table T01, List L01, (#named-gray-mapping, #achromatic-adjacency-sequence)

**Artifacts:**
- `NAMED_GRAYS` constant map in `tugdeck/src/components/tugways/palette-engine.ts`
- `ACHROMATIC_SEQUENCE` constant array in `tugdeck/src/components/tugways/palette-engine.ts`
- `ACHROMATIC_L_VALUES` constant map in `tugdeck/src/components/tugways/palette-engine.ts`
- `resolveAchromaticAdjacency()` function in `tugdeck/src/components/tugways/palette-engine.ts`
- `isAchromaticAdjacent()` function in `tugdeck/src/components/tugways/palette-engine.ts`

**Tasks:**
- [ ] Add `NAMED_GRAYS` record mapping name to tone: `{ paper: 10, linen: 20, parchment: 30, vellum: 40, graphite: 50, carbon: 60, charcoal: 70, ink: 80, pitch: 90 }`
- [ ] Add `ACHROMATIC_SEQUENCE` ordered array: `["black", "paper", "linen", "parchment", "vellum", "graphite", "carbon", "charcoal", "ink", "pitch", "white"]`. Note: the `gray` pseudo-hue is intentionally excluded — it is a continuous tone accessor (any lightness via tone parameter), not a fixed-lightness named gray. It does not participate in achromatic adjacency
- [ ] Add `ACHROMATIC_L_VALUES` record mapping each achromatic name to its L value (computed from the gray tone formula with canonical L=0.5): black=0, paper=0.22, linen=0.29, parchment=0.36, vellum=0.43, graphite=0.5, carbon=0.592, charcoal=0.684, ink=0.776, pitch=0.868, white=1
- [ ] Add `resolveAchromaticAdjacency(a: string, b: string): number` that returns `(2/3)*L_A + (1/3)*L_B`
- [ ] Add `isAchromaticAdjacent(a: string, b: string): boolean` that checks distance=1 in ACHROMATIC_SEQUENCE (no wrap)
- [ ] Export all new symbols

**Tests:**
- [ ] `NAMED_GRAYS` has exactly 9 entries with correct tone values
- [ ] `ACHROMATIC_SEQUENCE` has 11 entries in correct order
- [ ] `ACHROMATIC_L_VALUES` values match independently computed L values using the piecewise formula (L_DARK + min(tone,50)*(0.5 - L_DARK)/50 + max(tone-50,0)*(L_LIGHT - 0.5)/50) for each tone. Note: `grayOklch()` is a local function in gallery-palette-content.tsx and is not exported, so tests must recompute L values directly
- [ ] `resolveAchromaticAdjacency("paper", "linen")` returns approximately 0.2433
- [ ] `resolveAchromaticAdjacency("linen", "paper")` returns approximately 0.2667
- [ ] `isAchromaticAdjacent("paper", "linen")` returns true
- [ ] `isAchromaticAdjacent("paper", "parchment")` returns false (distance=2)
- [ ] `isAchromaticAdjacent("black", "white")` returns false (not adjacent despite being endpoints)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/palette-engine.test.ts`

---

#### Step 2: Add Named Grays and Transparent to Parser {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add named grays and transparent to tug-color parser`

**References:** [D01] Named grays replace numeric grays, [D02] Transparent as special-case color, [D03] Achromatic linear adjacency, [D06] Named grays have fixed lightness, Spec S01, (#transparent-behavior, #named-gray-mapping)

**Artifacts:**
- Extended `SlotParser` type, `SLOT_DISPATCH.color`, and `parseColorTokens()` in `tugdeck/tug-color-parser.ts` to thread `achromaticSequence` parameter
- Modified `parseColorTokens()` adjacency validation to fall back from ring to achromatic sequence
- Extended `parseTugColor()` signature with `achromaticSequence` parameter in `tugdeck/tug-color-parser.ts`
- Restructured warning logic in `parseTugColor()` with three-tier conditional for transparent, named grays, and existing achromatics

**Tasks:**
- [ ] The parser itself does not maintain KNOWN_HUES; it receives them as a parameter. The changes here are to the adjacency validation plumbing, warning logic, and public signature
- [ ] Extend `parseTugColor()` signature with an optional `achromaticSequence?: readonly string[]` parameter (after the existing `adjacencyRing` parameter)
- [ ] Extend the `SlotParser` type (line 539) to add an optional `achromaticSequence?: readonly string[]` parameter after `adjacencyRing`
- [ ] Update `SLOT_DISPATCH.color` (line 548) to forward `achromaticSequence` through to `parseColorTokens()`
- [ ] Extend `parseColorTokens()` signature (line 301) to accept an optional `achromaticSequence?: readonly string[]` parameter
- [ ] Modify `parseColorTokens()` adjacency validation (lines 390-413) to implement fallback logic: first try ring adjacency (existing code); if ring check fails because one or both names are not in the ring, try the achromatic sequence as a fallback — check distance=1 in the linear sequence (no wrap). Only produce a hard error if NEITHER ring nor achromatic adjacency matches. The error message should say "not adjacent" without specifying "hue ring" when both checks fail
- [ ] Inside `parseTugColor()`, forward the `achromaticSequence` parameter through to `SLOT_DISPATCH` calls (both labeled and positional paths)
- [ ] Update the `isAchromatic` guard variable (line 717) to include named grays and transparent. This variable gates the chromatic-specific warnings ("intensity=0 and tone=0 produce pure black", "intensity=0 and tone=100 produce pure white") so they do not fire for achromatic colors. Updated definition: `const isAchromatic = colorName === "black" || colorName === "white" || colorName === "gray" || colorName === "transparent" || (achromaticSequence != null && achromaticSequence.includes(colorName))`. This ensures named grays like paper skip the chromatic warning block entirely, preventing spurious warnings
- [ ] Restructure the achromatic-specific warning logic in `parseTugColor()` as a three-tier conditional after the existing chromatic warning block. The ordering prevents double-handling because each tier is mutually exclusive:
  1. **Transparent check (first):** If `colorName === "transparent"`, warn on ANY explicitly provided argument (intensity, tone, or alpha) with "X is ignored for 'transparent' (always oklch(0 0 0 / 0))". This is different from other achromatics because transparent ignores all three args, not just intensity. Note: transparent is NOT in the achromatic sequence, so tier 2 will not match it
  2. **Named gray check (second):** If the color name is in ACHROMATIC_SEQUENCE but is NOT one of the existing three achromatics (black, white, gray) — i.e., it is one of the 9 named grays (paper through pitch). Per [D06], named grays have fixed lightness, so warn on: (a) intensity explicitly provided and > 0 with "intensity is ignored for '{name}' (always C=0)", AND (b) tone explicitly provided with "tone is ignored for '{name}' (fixed L={value})". Implementation: check `achromaticSequence?.includes(colorName) && colorName !== "black" && colorName !== "white" && colorName !== "gray"`
  3. **Existing black/white/gray check (third):** Keep the existing `isAchromatic` logic for black, white, and gray unchanged
- [ ] Update module-level JSDoc to document the expanded vocabulary and new parameter

**Tests:**
Tests construct their own `knownHues` set that includes all 48 chromatic hues, black, white, gray, 9 named grays, and transparent.

- [ ] `parseTugColor("paper", knownHues)` succeeds with name="paper"
- [ ] `parseTugColor("transparent", knownHues)` succeeds with name="transparent"
- [ ] `parseTugColor("paper, i: 50", knownHues)` produces intensity-ignored warning
- [ ] `parseTugColor("paper, t: 80", knownHues)` produces tone-ignored warning
- [ ] `parseTugColor("transparent, i: 50", knownHues)` produces intensity-ignored warning
- [ ] `parseTugColor("transparent, t: 50", knownHues)` produces tone-ignored warning
- [ ] `parseTugColor("transparent, a: 50", knownHues)` produces alpha-ignored warning
- [ ] All named grays parse without error when included in knownHues
- [ ] `parseTugColor("paper, i: 0, t: 0", knownHues)` produces tone-ignored warning but does NOT produce spurious chromatic "intensity=0 and tone=0 produce pure black" warning (the updated isAchromatic guard suppresses it)
- [ ] `parseTugColor("paper-linen", knownHues, undefined, ADJACENCY_RING, achromaticSeq)` succeeds with adjacentName="linen" (passes ADJACENCY_RING so ring check runs first, fails for achromatics, then falls back to achromatic sequence check)
- [ ] `parseTugColor("paper-parchment", knownHues, undefined, ADJACENCY_RING, achromaticSeq)` produces hard error (not adjacent in ring OR achromatic sequence)
- [ ] `parseTugColor("paper-transparent", knownHues, undefined, ADJACENCY_RING, achromaticSeq)` produces hard error (transparent not in ring or achromatic sequence)
- [ ] `parseTugColor("black-paper", knownHues, undefined, ADJACENCY_RING, achromaticSeq)` succeeds with adjacentName="paper" (exercises ring-then-achromatic fallback for black endpoint)
- [ ] `parseTugColor("cobalt-indigo", knownHues, undefined, ADJACENCY_RING, achromaticSeq)` succeeds via ring adjacency (chromatic path unchanged)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tug-color-parser.test.ts`

---

#### Step 3: Update PostCSS Plugin for Named Grays, Transparent, and Achromatic Adjacency {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat: expand PostCSS plugin for named grays, transparent, and achromatic adjacency`

**References:** [D01] Named grays replace numeric grays, [D02] Transparent as special-case color, [D03] Achromatic linear adjacency, [D06] Named grays have fixed lightness, Table T01, Spec S01, List L01, (#named-gray-mapping, #transparent-behavior, #achromatic-adjacency-sequence)

**Artifacts:**
- Updated `KNOWN_HUES` set in `tugdeck/postcss-tug-color.ts`
- Updated `expandTugColor()` function in `tugdeck/postcss-tug-color.ts`
- Achromatic adjacency validation and resolution in expansion

**Tasks:**
- [ ] Add all 9 named grays and `transparent` to KNOWN_HUES set
- [ ] Import `NAMED_GRAYS`, `ACHROMATIC_SEQUENCE`, `resolveAchromaticAdjacency` from palette-engine in `tugdeck/postcss-tug-color.ts`
- [ ] In `expandTugColor()`, restructure the early-return ordering. The existing code has early returns for black (line 155) and white (line 158) that fire before any adjacency check. This means `{name: "black", adjacentName: "paper"}` would hit the black early return and ignore the adjacency entirely. The correct ordering of checks in `expandTugColor()` is:
  1. **Achromatic adjacency (FIRST):** If `color.adjacentName` is present AND both `color.name` and `color.adjacentName` are in `ACHROMATIC_SEQUENCE`, call `resolveAchromaticAdjacency(color.name, color.adjacentName)` to get the blended L value. Return `oklch(blendedL 0 0 / alpha)` immediately. This MUST come before the black/white/transparent/named-gray early returns, otherwise endpoint pairs like black-paper and pitch-white would be silently broken
  2. **Transparent:** If `color.name === "transparent"`, return `oklch(0 0 0 / 0)` regardless of i/t/a values
  3. **Black/white:** Existing early returns for black (L=0) and white (L=1), unchanged
  4. **Named grays:** If `color.name` is in `NAMED_GRAYS`, look up the inherent tone, compute L from that tone using the gray piecewise formula (canonical L=0.5), return `oklch(L 0 0 / alpha)`. Intensity and tone parameters are ignored per [D06]
  5. **Gray pseudo-hue:** Existing gray handling, unchanged
  6. **Chromatic hues:** Existing chromatic path (with chromatic adjacency), unchanged
- [ ] Pass `ACHROMATIC_SEQUENCE` as the `achromaticSequence` parameter when calling `parseTugColor()` from the PostCSS plugin, so the parser validates achromatic adjacency alongside ring adjacency
- [ ] Ensure transparent is rejected from adjacency: `parseTugColor("paper-transparent", ...)` should produce a hard error (transparent is not in ACHROMATIC_SEQUENCE)
- [ ] Achromatic adjacency with presets (e.g., `paper-linen-dark`) should be rejected by the parser. Presets define intensity/tone overrides, but achromatic adjacency resolves to a fixed blended L and ignores intensity/tone. The existing parser code already records the preset on the TugColorValue, but `expandTugColor()` should warn if a preset is present on an achromatic adjacency pair

**Tests:**
- [ ] `--tug-color(paper)` expands to `oklch(0.22 0 0)` (fixed L from inherent tone 10)
- [ ] `--tug-color(pitch)` expands to `oklch(0.868 0 0)` (fixed L from inherent tone 90)
- [ ] `--tug-color(paper, t: 80)` expands to `oklch(0.22 0 0)` with tone-ignored warning (tone does not shift named gray L per [D06])
- [ ] `--tug-color(paper, i: 50, t: 80)` expands to `oklch(0.22 0 0)` with both intensity-ignored and tone-ignored warnings
- [ ] `--tug-color(transparent)` expands to `oklch(0 0 0 / 0)`
- [ ] `--tug-color(transparent, a: 50)` expands to `oklch(0 0 0 / 0)` (alpha ignored for transparent)
- [ ] `--tug-color(paper-linen)` expands to `oklch(0.2433 0 0)` (approximately, achromatic adjacency bypasses chromatic path)
- [ ] `--tug-color(linen-paper)` expands to `oklch(0.2667 0 0)` (approximately)
- [ ] `--tug-color(black-paper)` expands to `oklch(0.0733 0 0)` approximately (L = (2/3)*0 + (1/3)*0.22; verifies achromatic adjacency fires before the black early return)
- [ ] `--tug-color(paper-black)` expands to `oklch(0.1467 0 0)` approximately (L = (2/3)*0.22 + (1/3)*0)
- [ ] `--tug-color(pitch-white)` expands to `oklch(0.912 0 0)` approximately (L = (2/3)*0.868 + (1/3)*1; verifies achromatic adjacency fires before the white early return)
- [ ] `--tug-color(white-pitch)` expands to `oklch(0.956 0 0)` approximately (L = (2/3)*1 + (1/3)*0.868)
- [ ] `--tug-color(paper-transparent)` produces a build error
- [ ] `--tug-color(paper-parchment)` produces a build error (not adjacent, distance=2)
- [ ] `--tug-color(paper, a: 50)` expands to `oklch(0.22 0 0 / 0.5)` (alpha IS honored for named grays)
- [ ] `--tug-color(paper-linen, a: 50)` expands to `oklch(0.2433 0 0 / 0.5)` approximately (alpha honored silently for achromatic adjacency, consistent with chromatic adjacency behavior — no warnings)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/postcss-tug-color.test.ts`

---

#### Step 4: Update CSS Variable Generation {#step-4}

**Depends on:** #step-3

**Commit:** `feat: rename gray CSS variables from numeric to named`

**References:** [D01] Named grays replace numeric grays, [D05] Drop gray endpoint variables, Table T01, Risk R01, (#named-gray-mapping, #rollout)

**Artifacts:**
- Updated `tugdeck/scripts/generate-tug-palette.ts` to emit `--tug-gray-paper` through `--tug-gray-pitch`
- Updated `tugdeck/styles/tug-palette.css` with new variable names
- Updated `tugdeck/src/__tests__/palette-engine.test.ts` gray ramp assertions
- Updated any references in `tugdeck/styles/tug-base.css` or theme files

**Tasks:**
- [ ] Import `NAMED_GRAYS` from palette-engine in `tugdeck/scripts/generate-tug-palette.ts` and use it to iterate over the named gray entries instead of hardcoded numeric tone values
- [ ] Update `generate-tug-palette.ts` to use named grays: emit `--tug-gray-paper` instead of `--tug-gray-10`, etc.
- [ ] Remove `--tug-gray-0` and `--tug-gray-100` from the generator output entirely (per [D05]); `--tug-black` and `--tug-white` remain as the only endpoint variables
- [ ] Run `bun run generate:palette` to regenerate tug-palette.css
- [ ] Grep the entire codebase for `--tug-gray-10` through `--tug-gray-90` and update all references to use the new names
- [ ] Verify with grep that no CSS files outside tug-palette.css referenced `--tug-gray-0` or `--tug-gray-100`
- [ ] Update comments in tug-palette.css to reference named grays
- [ ] Update palette-engine.test.ts: the "tug-palette.css -- gray tone ramp and anchors" describe block asserts on `--tug-gray-0`, `--tug-gray-10`, `--tug-gray-100`. Rewrite these assertions to match the new named variables (`--tug-gray-paper` through `--tug-gray-pitch`) and verify the absence of `--tug-gray-0`/`--tug-gray-100`

**Tests:**
- [ ] Generated tug-palette.css contains `--tug-gray-paper` through `--tug-gray-pitch`
- [ ] Generated tug-palette.css does NOT contain `--tug-gray-10` through `--tug-gray-90`
- [ ] Generated tug-palette.css does NOT contain `--tug-gray-0` or `--tug-gray-100`
- [ ] oklch values in the generated file match Table T01 exactly
- [ ] palette-engine.test.ts gray ramp tests pass with new variable names

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run generate:palette`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && grep -c 'tug-gray-paper' styles/tug-palette.css` returns 1
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && grep -c 'tug-gray-10' styles/tug-palette.css` returns 0
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/palette-engine.test.ts`

---

#### Step 5: Update Gallery Palette Achromatic Strip {#step-5}

**Depends on:** #step-1, #step-4

**Commit:** `feat: update achromatic strip to use named grays`

**References:** [D01] Named grays replace numeric grays, Table T01, (#named-gray-mapping)

**Artifacts:**
- Updated `GRAY_STEPS` in `tugdeck/src/components/tugways/cards/gallery-palette-content.tsx`
- Updated `TugAchromaticStrip` labels and data attributes in `tugdeck/src/components/tugways/cards/gallery-palette-content.tsx`

**Tasks:**
- [ ] Replace `GRAY_STEPS = [0, 10, 20, ..., 100]` with a structure that maps tone to name: use NAMED_GRAYS from palette-engine plus black (0) and white (100)
- [ ] Update `TugAchromaticStrip` to display descriptive names as labels instead of `gray-10`, `gray-20`, etc.
- [ ] Set `data-name` attribute to the descriptive name (paper, linen, etc.) instead of "gray"
- [ ] Keep the achromatic strip visually identical (same oklch values, same swatch order)
- [ ] Update gallery-palette-content.test.tsx: the T-ACHROMATIC-TEN test asserts `data-name="gray"` for middle swatches (e.g., `swatches[4].getAttribute("data-name")`). Update these assertions to expect the descriptive names (e.g., "vellum" for index 4)

**Tests:**
- [ ] Achromatic strip renders 11 swatches (black + 9 named + white)
- [ ] Labels show "paper", "linen", etc. instead of "gray-10", "gray-20"
- [ ] data-name attributes use descriptive names (paper, linen, parchment, etc.)
- [ ] Updated gallery-palette-content tests pass

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/gallery-palette-content.test.tsx`

---

#### Step 6: Integration Checkpoint — Color Palette System {#step-6}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Named grays replace numeric grays, [D02] Transparent as special-case color, [D03] Achromatic linear adjacency, Table T02, (#success-criteria, #color-count-summary)

**Tasks:**
- [ ] Verify all palette engine, parser, and PostCSS tests pass together
- [ ] Verify the full test suite passes
- [ ] Verify `bun run generate:palette` produces clean output with named grays
- [ ] Count total named colors: verify 60 basic names (48 + 11 + 1), 176 extended (144 + 31 + 1)

**Tests:**
- [ ] Full test suite passes

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run generate:palette`

---

#### Step 7: Fix Compact Hue Popover CSS {#step-7}

**Depends on:** #step-6

**Commit:** `fix: compact hue popover label hiding, width, and swatch wrapping`

**References:** [D04] Picker fixes are CSS-only, (#context)

**Artifacts:**
- Updated `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css`

**Tasks:**
- [ ] Add explicit CSS rule to hide rotated labels inside the popover: `.gtg-compact-hue-popover .tug-hue-strip__label { display: none; }`
- [ ] Reduce the popover strip padding-bottom since labels are hidden: `.gtg-compact-hue-popover .tug-hue-strip { padding-bottom: 4px; }` (already set, verify)
- [ ] Verify `max-width: 360px` and `overflow: hidden` are sufficient to constrain the popover; adjust if needed
- [ ] Optionally reduce swatch size inside popover to fit ~12 per row in ~300px width: `.gtg-compact-hue-popover .tug-hue-strip__swatch { width: 14px; height: 20px; }`
- [ ] Verify Radix Popover positioning props (side, align, sideOffset, collisionPadding) are set correctly in the component — the current code already has `side="bottom" align="start" sideOffset={4}`; add `collisionPadding={8}` if missing

**Tests:**
- [ ] Visual verification: popover opens without rotated labels visible
- [ ] Visual verification: swatches wrap cleanly within the constrained width
- [ ] Visual verification: popover does not overflow the viewport

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] Visual inspection in browser dev mode

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Complete named grayscale vocabulary (paper through pitch), transparent keyword, achromatic adjacency, and clean compact hue popover — bringing the TugColor system to 60 basic / 176 extended named colors.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All 9 named grays parse and expand correctly (unit tests pass)
- [ ] Transparent parses and expands to `oklch(0 0 0 / 0)` with appropriate warnings (unit tests pass)
- [ ] Achromatic adjacency resolves correctly in both directions (unit tests pass)
- [ ] CSS variables use `--tug-gray-{name}` format (`bun run generate:palette` clean)
- [ ] Gallery achromatic strip shows descriptive names (test + visual)
- [ ] Compact hue popover is visually clean (visual inspection)
- [ ] Full test suite passes (`bun test`)

**Acceptance tests:**
- [ ] `bun test` — all tests pass
- [ ] `bun run generate:palette` — clean output with named gray variables
- [ ] Visual inspection of achromatic strip and compact hue popover in browser

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Deprecation warnings for old `gray-10` through `gray-90` numeric forms in the parser
- [ ] IDE autocomplete integration for named grays and transparent
- [ ] Named gray presets (e.g., paper-light, graphite-dark)

| Checkpoint | Verification |
|------------|--------------|
| Named grays parse | `bun test src/__tests__/tug-color-parser.test.ts` |
| Transparent works | `bun test src/__tests__/postcss-tug-color.test.ts` |
| CSS vars renamed | `grep 'tug-gray-paper' styles/tug-palette.css` |
| Full suite green | `bun test` |
