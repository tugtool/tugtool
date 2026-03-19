<!-- tugplan-skeleton v2 -->

## 48-Color Hyphenated Palette {#hyphenated-palette}

**Purpose:** Replace arithmetic hue offsets with a 48 named color + hyphenated adjacency system (144 expressible hues), preceded by relaxing test tolerances to perceptual thresholds so the migration lands cleanly without fixture churn.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current `--tug-color()` system uses arithmetic hue offsets (`red+5.2`, `cobalt-8`, `violet+5`) to reach hue angles between the 24 named colors. These offsets leak implementation details (degree arithmetic) into the design API, are meaningless in design conversations, and make the parser unnecessarily complex. Meanwhile, the test infrastructure uses exact string matching for ground truth and binary pass/fail for contrast thresholds — precision levels that will cause cascading fixture breakage from the sub-3-degree hue shifts the palette migration introduces.

This plan executes in two phases: Phase 1 relaxes test tolerances to perceptual thresholds (independently valuable, and a prerequisite for clean migration), then Phase 2 replaces offset syntax with a 48 named color + hyphenated adjacency system yielding 144 expressible hues at approximately 2.5-degree average spacing.

#### Strategy {#strategy}

- Phase 1 first: convert BRIO_GROUND_TRUTH from exact string comparison to OKLCH delta-E < 0.02 tolerance, and add a 5 Lc marginal band to KNOWN_BELOW_THRESHOLD filtering. These changes are independently valuable and prevent fixture churn during Phase 2.
- Phase 2 is a clean break: no deprecation period, no backward compatibility. All offset references are mechanically converted using the migration mapping, then offset syntax is deleted from the parser.
- Expand HUE_FAMILIES from 24 to 48 entries with the 24 new intermediate colors from the proposal table. All chroma caps and canonical L values are re-derived from the gamut boundary, not interpolated.
- Add ADJACENCY_RING as a hardcoded ordered array with build-time ascending-angle assertion. Non-adjacent pairs are hard errors at parse time.
- Per-tier hue offsets (fgTierAngle(7), surfaceTierAngle(10), etc.) are replaced by ring-position lookups via resolveHyphenatedHue — the engine maps each offset to the nearest named or hyphenated hue expression.
- Presets (`light`, `dark`, `intense`, `muted`, `canonical`) are checked before the color ring during parsing, so disambiguation is unambiguous with no lookahead.

#### Success Criteria (Measurable) {#success-criteria}

- All existing tests pass (`cd tugdeck && bun test`) after Phase 1 tolerance changes, with no new KNOWN_BELOW_THRESHOLD entries required
- After Phase 2, zero occurrences of `+` token type or `IDENT MINUS NUMBER` offset pattern in the parser
- After Phase 2, all `--tug-color()` calls in the codebase use only base names, hyphenated adjacency, or preset syntax — verified by `grep -P 'tug-color\([^)]*[+]\d' tugdeck/` returning zero matches
- BRIO_GROUND_TRUTH fixture uses OKLCH L/C/h triples with all delta-E values < 0.02
- 48 entries in HUE_FAMILIES, 144 expressible hue points in the vocabulary
- `bun test` passes end-to-end after full migration

#### Scope {#scope}

1. Phase 1: BRIO_GROUND_TRUTH delta-E tolerance conversion in `theme-derivation-engine.test.ts`
2. Phase 1: KNOWN_BELOW_THRESHOLD marginal band (5 Lc) in both test files
3. Phase 1: Collapse stale KNOWN_BELOW_THRESHOLD entries that fall within the marginal band
4. Phase 2: Expand HUE_FAMILIES to 48 colors in `palette-engine.ts`
5. Phase 2: Add ADJACENCY_RING, `resolveHyphenatedHue()`, updated `formatHueRef()` in `palette-engine.ts`
6. Phase 2: Re-derive MAX_CHROMA_FOR_HUE, MAX_P3_CHROMA_FOR_HUE, and DEFAULT_CANONICAL_L for 24 new hues
7. Phase 2: Add 24 new canonical_l values to `tug-color-canonical.json`
8. Phase 2: Remove offset syntax from `tug-color-parser.ts` and `postcss-tug-color.ts`, add adjacency resolution
9. Phase 2: Remove `offset` from ThemeRecipe type, replace per-tier offset functions with ring-position lookups in `theme-derivation-engine.ts`
10. Phase 2: Mechanically migrate all offset references using the migration mapping
11. Phase 2: Rewrite parser and PostCSS tests for adjacency syntax
12. Phase 2: Regenerate `tugdeck/styles/tug-palette.css` via `bun run generate:palette` for all 48 hues

#### Non-goals (Explicitly out of scope) {#non-goals}

- `tug-palette-anchors.json` — legacy/docs only, not imported by `palette-engine.ts`; excluded per user decision
- Backward compatibility or deprecation period for offset syntax
- Changes to the I/T/A (Intensity/Tone/Alpha) axes — orthogonal to hue naming
- Changes to gamut safety infrastructure (`findMaxChroma`, `isInSRGBGamut`, `isInP3Gamut`)
- New preset names beyond the existing five

#### Dependencies / Prerequisites {#dependencies}

- Phase 1 (test tolerance relaxation) must complete before Phase 2 begins
- The 24 new hue names and angles from the proposal table (`roadmap/48-color-hyphenated-palette.md`) are final
- `LC_MARGINAL_DELTA` (value 5) is already exported from `theme-accessibility.ts`

#### Constraints {#constraints}

- Chroma caps and canonical L values for new hues must be re-derived via `_deriveChromaCaps` — the sRGB gamut boundary is irregular in OKLCH, so interpolation between neighbors produces incorrect values
- The `ADJACENCY_RING` build-time assertion must throw at module load time if angles are not in ascending order
- Non-adjacent pair detection must reject at parse time in both the PostCSS plugin and the runtime parser
- All 48 color names must be single lowercase words with no hyphens (hyphens reserved for adjacency syntax)

#### Assumptions {#assumptions}

- The 24 new hue names and angles from the proposal table are final and will be hardcoded as-is
- The ADJACENCY_RING build-time assertion will be a TypeScript top-level assertion that throws at module load time
- Non-adjacent pair detection is based on ring distance > 1 in the ADJACENCY_RING array
- The clean-break migration converts all offset syntax mechanically, then deletes offset support
- The 24 new canonical_l values will be derived programmatically using `_deriveChromaCaps`
- `gallery-theme-generator-content.test.tsx` gets only the KNOWN_BELOW_THRESHOLD marginal band change (no BRIO_GROUND_TRUTH fixture in that file)

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the anchor and reference conventions defined in `tugplan-skeleton.md`. All headings that are cited use explicit `{#anchor}` suffixes. Steps cite decisions by `[DNN]`, specs by `Spec SNN`, tables by `Table TNN`, and section anchors by `#anchor`.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarifying questions were resolved during the clarification phase:

- Ground truth format: OKLCH delta-E (resolved via user answer, reflected in [D01])
- Tier offset strategy: map to nearest named ring position (resolved via user answer, reflected in [D08])
- Anchors JSON scope: excluded (resolved via user answer, reflected in non-goals)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Gamut boundary irregularity causes incorrect chroma caps for new hues | high | low | All caps re-derived via `_deriveChromaCaps`, never interpolated [D07] | Any new hue produces out-of-gamut colors |
| Migration mapping introduces perceptible color shifts | med | low | All deltas verified < 3 degrees per proposal table; delta-E tolerance absorbs remainder | Visual QA reveals noticeable shift |
| Ring-position lookups for tier offsets produce different hue than original offset | med | med | Verify each tier mapping against Brio ground truth within delta-E 0.02 tolerance | T-BRIO-MATCH test fails |

**Risk R01: Chroma cap derivation for new hues** {#r01-chroma-caps}

- **Risk:** Interpolating chroma caps between adjacent hues produces values outside the sRGB gamut boundary, causing colors to clip or render incorrectly.
- **Mitigation:** Every new hue angle runs through the full `_deriveChromaCaps` pipeline with binary search against the gamut boundary, identical to how the original 24 hues were derived.
- **Residual risk:** None — the derivation method is the same as the proven originals.

**Risk R02: Per-tier ring-position mapping divergence** {#r02-tier-mapping}

- **Risk:** Replacing `fgTierAngle(7)` (cobalt+7 = 257 degrees) with `indigo-cobalt` (256.7 degrees) changes the resolved OKLCH color enough to affect contrast results.
- **Mitigation:** The 0.3-degree delta is well below perceptual thresholds. Phase 1's delta-E tolerance (< 0.02) in BRIO_GROUND_TRUTH absorbs this. The marginal band in KNOWN_BELOW_THRESHOLD absorbs any Lc shifts.
- **Residual risk:** Tokens very close to the Lc threshold boundary could flip classification, but the 5 Lc marginal band covers this.

---

### Design Decisions {#design-decisions}

#### [D01] BRIO_GROUND_TRUTH uses OKLCH delta-E < 0.02 tolerance (DECIDED) {#d01-oklch-delta-e}

**Decision:** Convert BRIO_GROUND_TRUTH from `--tug-color()` string comparison to OKLCH L/C/h triples with delta-E (Euclidean) < 0.02 tolerance per token.

**Rationale:**
- Below delta-E 0.02, two colors are perceptually indistinguishable under normal viewing conditions
- Exact string matching breaks from sub-pixel drift, floating-point path differences, and the sub-3-degree hue shifts from the palette migration
- The test should catch formula regressions (20+ RGB unit jumps), not imperceptible rounding differences

**Implications:**
- BRIO_GROUND_TRUTH fixture changes from `Record<string, string>` to `Record<string, { L: number; C: number; h: number }>` storing OKLCH triples
- T-BRIO-MATCH test resolves each derived token to OKLCH and computes standard OKLCH Euclidean distance `sqrt(dL^2 + dC^2 + dH^2)` where `dH = 2*sqrt(Ca*Cb)*sin(dh/2)`, asserting < 0.02
- Phase 2 re-derives the OKLCH triples for the new hue vocabulary — the fixture values change but delta-E remains < 0.02

#### [D02] KNOWN_BELOW_THRESHOLD uses 5 Lc marginal band (DECIDED) {#d02-marginal-band}

**Decision:** Apply a 5 Lc marginal tolerance band to the KNOWN_BELOW_THRESHOLD filter using the existing `LC_MARGINAL_DELTA` constant. Tokens within 5 Lc units below their role's threshold pass without needing an exception entry.

**Rationale:**
- Lc 29.5 and Lc 30.5 are perceptually identical; the exception set should track meaningfully below-threshold tokens, not tokens riding the line
- `LC_MARGINAL_DELTA = 5` is already used by the contrast dashboard badge classification
- Prevents small hue shifts from the palette migration flipping tokens between "passing" and "needs exception"

**Implications:**
- T4.1 filter in `theme-derivation-engine.test.ts` changes: only tokens more than 5 Lc below threshold are unexpected failures
- Same change in `gallery-theme-generator-content.test.tsx` `unexpectedFailures` filter
- Stale KNOWN_BELOW_THRESHOLD entries for tokens within the marginal band can be collapsed (removed from the exception set)

#### [D03] 48 named colors with hyphenated adjacency (DECIDED) {#d03-named-colors}

**Decision:** Expand from 24 to 48 named hue families. Any two adjacent colors in the 48-color ring can be hyphenated (A-B = 2/3 angle(A) + 1/3 angle(B)), yielding 144 expressible hue points at approximately 2.5-degree average spacing.

**Rationale:**
- Named colors are meaningful in design conversations; `indigo-cobalt` communicates color character where `cobalt+7` does not
- 144 hue points at 2.5-degree spacing exceeds the perceptual discrimination threshold for adjacent hues in UI context
- Single lowercase word names (from nature/pigment/design vocabulary) keep the namespace clean and collision-free with preset names

**Implications:**
- `HUE_FAMILIES` in `palette-engine.ts` expands from 24 to 48 entries
- Parser accepts `IDENT [MINUS IDENT [MINUS IDENT]]` chains instead of `IDENT [PLUS/MINUS NUMBER]` patterns
- All chroma caps, P3 chroma caps, and canonical L values must be derived for 24 new hue angles

#### [D04] Non-adjacent pairs are hard errors (DECIDED) {#d04-non-adjacent-errors}

**Decision:** Non-adjacent color pairs in hyphenated syntax (e.g., `yellow-blue`) produce a hard error at parse time — both in the PostCSS plugin (build-time error) and the runtime parser (thrown exception). No silent fallback.

**Rationale:**
- Silent fallback would cause hard-to-debug color drift from typos or misunderstandings
- Immediate error feedback keeps the vocabulary honest and catches mistakes at authoring time
- The adjacency constraint is simple to check (ring distance > 1 in ADJACENCY_RING)

**Implications:**
- Parser must validate adjacency after resolving the second ident in a chain
- `postcss-tug-color.ts` propagates parse errors as PostCSS build errors
- Error messages must name both colors and state that they are not adjacent

#### [D05] Presets win disambiguation (DECIDED) {#d05-presets-win}

**Decision:** The five preset names (`light`, `dark`, `intense`, `muted`, `canonical`) are checked before the color ring when parsing the second ident in a chain. Presets always take precedence over color names.

**Rationale:**
- Eliminates lookahead — the parser resolves each ident as it encounters it
- No collision exists today (preset names are adjectives; color names are nouns from nature/pigment vocabulary)
- The constraint is easy to maintain: any future color name must not match a preset name

**Implications:**
- `indigo-intense` resolves as color + preset, not as hyphenated adjacency
- Parser checks presets map first, then ADJACENCY_RING, then reports error
- No base color may share a name with a preset (enforced by naming convention)

#### [D06] ADJACENCY_RING is hardcoded with build-time assertion (DECIDED) {#d06-adjacency-ring}

**Decision:** ADJACENCY_RING is a hardcoded ordered array of the 48 color names defining ring adjacency, with a top-level TypeScript assertion that throws at module load time if entries are not in strictly ascending hue-angle order.

**Rationale:**
- The ring order is an intentional design artifact (curated names, not auto-sorted)
- A single source of truth prevents drift between the ring array and HUE_FAMILIES angle table
- Build-time assertion catches inconsistencies immediately, not at runtime in production

**Implications:**
- `palette-engine.ts` exports `ADJACENCY_RING` as `readonly string[]`
- Top-level code after the declaration iterates the array and asserts `HUE_FAMILIES[ring[i]] < HUE_FAMILIES[ring[i+1]]` for all consecutive pairs (i = 0 to length-2). No wrap-around assertion is needed because berry (355 degrees) > garnet (2.5 degrees) by design — the ring wraps at the 360/0 boundary, and `resolveHyphenatedHue` handles that wrap in its angle math.
- Any addition of new colors requires updating both HUE_FAMILIES and ADJACENCY_RING in lockstep

#### [D07] Chroma caps and canonical L re-derived from gamut boundary (DECIDED) {#d07-chroma-rederived}

**Decision:** MAX_CHROMA_FOR_HUE, MAX_P3_CHROMA_FOR_HUE, and DEFAULT_CANONICAL_L for the 24 new hues are computed via `_deriveChromaCaps` — not interpolated from neighboring hues.

**Rationale:**
- The sRGB gamut boundary is highly irregular in OKLCH; linear interpolation between neighbors can produce chroma caps that are out of gamut
- The L-at-max-chroma curve is non-linear across hue; interpolating canonical L values produces perceptually uneven results
- The existing `_deriveChromaCaps` pipeline and `findMaxChroma` function handle this correctly for arbitrary hue angles

**Implications:**
- Each new hue angle gets a fresh binary search against the gamut boundary
- `tug-color-canonical.json` gains 24 new entries with programmatically derived `canonical_l` values
- The derivation is deterministic and reproducible; results can be verified by running the pipeline

#### [D08] Per-tier hue offsets mapped to nearest named ring position (DECIDED) {#d08-tier-ring-lookup}

**Decision:** Replace per-tier offset functions (`fgTierAngle(7)`, `surfaceTierAngle(10)`, etc.) with ring-position lookups via `resolveHyphenatedHue`. Each offset maps to the nearest named or hyphenated hue expression in the 144-entry vocabulary.

**Rationale:**
- Eliminates the last source of numeric degree offsets in the derivation engine
- With 144 hue points at approximately 2.5-degree average spacing, worst-case quantization error is approximately 1.25 degrees — well below perceptual thresholds
- The mapping is mechanical and verified by the migration mapping table (all deltas < 3 degrees)

**Implications:**
- `fgTierAngle()` and `surfaceTierAngle()` functions are removed
- `fgTierOffsets` and `surfaceTierOffsets` fields are removed from `ModePreset`
- Each tier uses a direct named hue reference (e.g., `indigo-cobalt` instead of `cobalt+7`)
- `formatHueRef` searches the 144-entry vocabulary for the closest match instead of computing numeric offsets

#### [D09] Clean break — offset syntax removed entirely (DECIDED) {#d09-clean-break}

**Decision:** The offset syntax (`cobalt+8`, `violet-6`, `red+5.2`) is removed entirely with no deprecation period. Every offset reference is converted to its named equivalent in a single pass, then the `plus` token type and offset parsing patterns are deleted.

**Rationale:**
- There are no external consumers of `--tug-color()` syntax — it is internal to tugdeck
- The migration mapping table covers all existing offsets with sub-3-degree deltas
- Keeping deprecated syntax adds parser complexity for zero benefit

**Implications:**
- `TugColorValue.offset` field is removed (or always 0)
- `TokenType` loses `"plus"`; `IDENT PLUS NUMBER` and `IDENT MINUS NUMBER` (numeric offset) patterns are deleted
- Any surviving offset syntax after migration is a build error via PostCSS

---

### Deep Dives (Optional) {#deep-dives}

#### The 48-Color Ring {#color-ring}

**Table T01: 48 Named Colors in Ring Order** {#t01-color-ring}

| # | Name | Angle | Origin |
|---|------|------:|--------|
| 1 | garnet | 2.5 | new |
| 2 | cherry | 10 | original |
| 3 | scarlet | 15 | new |
| 4 | coral | 20 | original |
| 5 | crimson | 22.5 | new |
| 6 | red | 25 | original |
| 7 | vermilion | 30 | new |
| 8 | tomato | 35 | original |
| 9 | ember | 40 | new |
| 10 | flame | 45 | original |
| 11 | tangerine | 50 | new |
| 12 | orange | 55 | original |
| 13 | apricot | 60 | new |
| 14 | amber | 65 | original |
| 15 | honey | 70 | new |
| 16 | gold | 75 | original |
| 17 | saffron | 82.5 | new |
| 18 | yellow | 90 | original |
| 19 | chartreuse | 102.5 | new |
| 20 | lime | 115 | original |
| 21 | grass | 127.5 | new |
| 22 | green | 140 | original |
| 23 | jade | 147.5 | new |
| 24 | mint | 155 | original |
| 25 | seafoam | 165 | new |
| 26 | teal | 175 | original |
| 27 | aqua | 187.5 | new |
| 28 | cyan | 200 | original |
| 29 | azure | 207.5 | new |
| 30 | sky | 215 | original |
| 31 | cerulean | 222.5 | new |
| 32 | blue | 230 | original |
| 33 | sapphire | 240 | new |
| 34 | cobalt | 250 | original |
| 35 | indigo | 260 | new |
| 36 | violet | 270 | original |
| 37 | iris | 277.5 | new |
| 38 | purple | 285 | original |
| 39 | grape | 292.5 | new |
| 40 | plum | 300 | original |
| 41 | orchid | 310 | new |
| 42 | pink | 320 | original |
| 43 | peony | 327.5 | new |
| 44 | rose | 335 | original |
| 45 | cerise | 340 | new |
| 46 | magenta | 345 | original |
| 47 | fuchsia | 350 | new |
| 48 | berry | 355 | original |

#### Migration Mapping {#migration-mapping}

**Table T02: Offset-to-Named Migration** {#t02-migration-mapping}

| Current syntax | Angle | New expression | New angle | Delta |
|----------------|------:|----------------|----------:|------:|
| `violet-6` | 264 | `indigo-violet` | 263.3 | 0.7 |
| `cobalt+10` | 260 | `indigo` | 260 | 0 |
| `cobalt+7` | 257 | `indigo-cobalt` | 256.7 | 0.3 |
| `cobalt+8` | 258 | `indigo-cobalt` | 256.7 | 1.3 |
| `cobalt-8` | 242 | `sapphire-cobalt` | 243.3 | 1.3 |
| `violet+5` (fg tier) | 275 | `violet-iris` | 272.5 | 2.5 |
| `violet+5` (tab-bg-active, surfaceTierAngle(5)) | 275 | `violet-iris` | 272.5 | 2.5 |
| `violet-9` | 261 | `indigo` | 260 | 1 |

#### Hyphenated Adjacency Formula {#adjacency-formula}

For any two adjacent colors A and B in the ring:

```
hue(A-B) = (2/3 * angle(A)) + (1/3 * angle(B))
```

The first name is dominant (contributes 2/3). The ring is circular: `berry` (355 degrees) and `garnet` (2.5 degrees) are adjacent, with correct hue wrapping across the 360/0 boundary.

#### Parser Chain Grammar {#parser-grammar}

The color token is parsed as a minus-separated ident chain: `IDENT [MINUS IDENT [MINUS IDENT]]`.

1. **First ident** — must be a known color name (48-color set) or `black`/`white`
2. **Second ident (if present)** — checked in order:
   a. Preset name? (`light`, `dark`, `intense`, `muted`, `canonical`) — apply preset, chain ends
   b. Adjacent color? — compute biased hue, continue to third ident
   c. Known color but not adjacent? — hard error
   d. Unknown ident? — hard error
3. **Third ident (if present)** — must be a preset name. Applies preset to the resolved hyphenated color.

Valid chain forms:
- `indigo` — bare color
- `indigo-intense` — color + preset
- `cobalt-indigo` — hyphenated adjacency
- `cobalt-indigo-intense` — hyphenated adjacency + preset

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Spec S01: TugColorValue after migration** {#s01-tug-color-value}

```typescript
export interface TugColorValue {
  name: string;           // primary color name (from 48-color set)
  adjacentName?: string;  // second color name if hyphenated (must be adjacent)
  preset?: string;        // preset name if specified
}
```

The `offset: number` field is removed entirely. The `name` field holds the primary (dominant) color. When `adjacentName` is present, the resolved hue angle is `(2/3 * angle(name)) + (1/3 * angle(adjacentName))`.

**Spec S02: ThemeRecipe after migration** {#s02-theme-recipe}

```typescript
export interface ThemeRecipe {
  name: string;
  mode: "dark" | "light";
  atmosphere: { hue: string };  // offset field removed
  text: { hue: string };        // offset field removed
  accent?: string;
  active?: string;
  interactive?: string;
  destructive?: string;
  success?: string;
  caution?: string;
  agent?: string;
  data?: string;
  surfaceContrast?: number;
  signalVividity?: number;
  warmth?: number;
}
```

The `offset?: number` fields on `atmosphere` and `text` are removed. Hue values can now be base names (`violet`), hyphenated names (`indigo-violet`), or any valid expression from the 144-entry vocabulary.

**Spec S03: ADJACENCY_RING and resolveHyphenatedHue** {#s03-adjacency-ring}

```typescript
// Ordered array of 48 color names in ascending hue-angle order
export const ADJACENCY_RING: readonly string[] = [
  "garnet", "cherry", "scarlet", "coral", "crimson", "red",
  "vermilion", "tomato", "ember", "flame", "tangerine", "orange",
  "apricot", "amber", "honey", "gold", "saffron", "yellow",
  "chartreuse", "lime", "grass", "green", "jade", "mint",
  "seafoam", "teal", "aqua", "cyan", "azure", "sky",
  "cerulean", "blue", "sapphire", "cobalt", "indigo", "violet",
  "iris", "purple", "grape", "plum", "orchid", "pink",
  "peony", "rose", "cerise", "magenta", "fuchsia", "berry",
];

// Build-time assertion (top-level, throws at module load)
for (let i = 0; i < ADJACENCY_RING.length - 1; i++) {
  const a = HUE_FAMILIES[ADJACENCY_RING[i]];
  const b = HUE_FAMILIES[ADJACENCY_RING[i + 1]];
  if (a >= b) throw new Error(`ADJACENCY_RING order violation: ${ADJACENCY_RING[i]} (${a}) >= ${ADJACENCY_RING[i+1]} (${b})`);
}

// Resolve hyphenated hue: 2/3 dominant + 1/3 secondary, with wrap
export function resolveHyphenatedHue(a: string, b: string): number {
  const angleA = HUE_FAMILIES[a];
  const angleB = HUE_FAMILIES[b];
  // Handle circular wrap for the berry-garnet boundary
  let adjustedB = angleB;
  if (Math.abs(angleA - angleB) > 180) {
    adjustedB = angleB + (angleA > angleB ? 360 : -360);
  }
  return ((2/3) * angleA + (1/3) * adjustedB + 360) % 360;
}
```

**Spec S04: Delta-E comparison for BRIO_GROUND_TRUTH** {#s04-delta-e}

```typescript
// Fixture format: OKLCH triples
const BRIO_GROUND_TRUTH: Record<string, { L: number; C: number; h: number }> = {
  "--tug-base-bg-app": { L: 0.167, C: 0.008, h: 264 },
  // ... one entry per chromatic token
};

// Comparison: standard OKLCH Euclidean distance (CIE delta-E OK)
// Uses the geometric hue-difference formula: 2*sqrt(Ca*Cb)*sin(dh/2)
// This correctly weights hue by chroma — hue shifts at low chroma are negligible.
function oklchDeltaE(a: { L: number; C: number; h: number }, b: { L: number; C: number; h: number }): number {
  const dL = a.L - b.L;
  const dC = a.C - b.C;
  let dh = (a.h - b.h) * (Math.PI / 180); // convert to radians
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  const dH = 2 * Math.sqrt(a.C * b.C) * Math.sin(dh / 2);
  return Math.sqrt(dL * dL + dC * dC + dH * dH);
}
```

The threshold is **0.02**. Context for why 0.02 is correct:
- L values range 0-1, C values range 0-~0.3. A "20+ RGB unit jump" regression corresponds to delta-L of approximately 0.05-0.10.
- At threshold 0.02, the test catches any change of delta-L > 0.02 (approximately 5-8 RGB units) — sensitive enough to catch real regressions while absorbing sub-pixel rounding drift and the sub-3-degree hue shifts from the palette migration (which at typical surface chroma C~0.01-0.02 contribute dH < 0.001).
- The standard formula `2*sqrt(Ca*Cb)*sin(dh/2)` correctly diminishes hue contribution at low chroma, so near-neutral surface tokens (C~0.01) tolerate large hue shifts while vivid accent tokens (C~0.15) are sensitive to hue changes.

---

### Compatibility / Migration / Rollout (Optional) {#rollout}

- **Compatibility policy**: Clean break. No backward compatibility for offset syntax. Internal-only API with no external consumers.
- **Migration plan**:
  - All `--tug-color()` calls with `+` or signed numeric offsets are converted using Table T02 (#t02-migration-mapping)
  - `EXAMPLE_RECIPES.brio.atmosphere` changes from `{ hue: "violet", offset: -6 }` to `{ hue: "indigo-violet" }` (264 degrees maps to `indigo-violet` at 263.3 degrees, delta 0.7)
  - Per-tier offsets in `ModePreset` (`fgTierOffsets`, `surfaceTierOffsets`) are removed; each tier uses a direct named reference
  - After conversion, offset parsing code is deleted from `tug-color-parser.ts` and `postcss-tug-color.ts`
- **Rollout plan**: Single-pass migration in one branch. No feature gate needed (no external consumers). Rollback strategy: revert the branch.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes are modifications to existing files.

#### Symbols to add / modify {#symbols}

**Table T03: Symbol Changes** {#t03-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ADJACENCY_RING` | const array | `palette-engine.ts` | New: 48-element ordered ring |
| `resolveHyphenatedHue(a, b)` | function | `palette-engine.ts` | New: biased hue resolution |
| `HUE_VOCABULARY` | const record | `theme-derivation-engine.ts` | New: precomputed 144-entry name-to-angle map, built at module load |
| `isAdjacent(a, b)` | function | `palette-engine.ts` | New: ring distance check |
| `deriveCanonicalL(hueAngle)` | function | `palette-engine.ts` | New: sweep L to find max-chroma L for canonical_l derivation |
| `HUE_FAMILIES` | const record | `palette-engine.ts` | Modified: expand from 24 to 48 entries |
| `MAX_CHROMA_FOR_HUE` | const record | `palette-engine.ts` | Modified: add 24 new entries |
| `MAX_P3_CHROMA_FOR_HUE` | const record | `palette-engine.ts` | Modified: add 24 new entries |
| `DEFAULT_CANONICAL_L` | const record | `palette-engine.ts` | Modified: add 24 new entries (from JSON) |
| `formatHueRef` | function | `theme-derivation-engine.ts` | Modified: search 144-entry vocabulary |
| `resolveHueAngle` | function | `theme-derivation-engine.ts` | Modified: handle hyphenated names |
| `closestHueName` | function | `theme-derivation-engine.ts` | Modified: search 48+96 vocabulary |
| `fgTierAngle` | function | `theme-derivation-engine.ts` | Removed: replaced by direct named refs |
| `surfaceTierAngle` | function | `theme-derivation-engine.ts` | Removed: replaced by direct named refs |
| `fgTierOffsets` | field | `ModePreset` interface | Removed |
| `surfaceTierOffsets` | field | `ModePreset` interface | Removed |
| `TugColorValue.offset` | field | `tug-color-parser.ts` | Removed |
| `TugColorValue.adjacentName` | field | `tug-color-parser.ts` | New: optional adjacent color |
| `TokenType "plus"` | type member | `tug-color-parser.ts` | Removed |
| `ThemeRecipe.atmosphere.offset` | field | `theme-derivation-engine.ts` | Removed |
| `ThemeRecipe.text.offset` | field | `theme-derivation-engine.ts` | Removed |
| `makeTugColor` hasOffset check | function | `theme-derivation-engine.ts` | Modified: detect hyphenated adjacency vs preset |
| `parseTugColorToken` | function | `theme-accessibility.ts` | Modified: handle hyphenated adjacency hueRef |
| `rebuildTugColorToken` | function | `theme-accessibility.ts` | Modified: handle hyphenated adjacency preset emission |
| `baseHueName` | function | `theme-accessibility.ts` | Modified: extract primary color from hyphenated form |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `roadmap/48-color-hyphenated-palette.md` to mark the proposal as implemented
- [ ] Update inline JSDoc comments in `palette-engine.ts` to reflect 48 hue families
- [ ] Update inline JSDoc comments in `tug-color-parser.ts` to reflect adjacency syntax
- [ ] Update inline JSDoc comments in `theme-derivation-engine.ts` to reflect offset removal

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test OKLCH delta-E computation, adjacency validation, `resolveHyphenatedHue`, `formatHueRef` | Core palette and parser logic |
| **Integration** | Test full `deriveTheme()` pipeline with new vocabulary, PostCSS build | End-to-end token generation |
| **Golden / Contract** | BRIO_GROUND_TRUTH fixture (OKLCH triples), parser round-trip tests | Regression prevention |
| **Drift Prevention** | T4.1/T4.2 contrast tests with marginal band, T-BRIO-MATCH delta-E | Unintended behavior changes |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Convert BRIO_GROUND_TRUTH to OKLCH delta-E comparison {#step-1}

**Commit:** `test: convert BRIO_GROUND_TRUTH to OKLCH ΔE < 0.02 tolerance`

**References:** [D01] OKLCH delta-E tolerance, Spec S04, (#context, #strategy)

**Artifacts:**
- Modified `tugdeck/src/__tests__/theme-derivation-engine.test.ts`: BRIO_GROUND_TRUTH fixture and T-BRIO-MATCH test

**Tasks:**
- [ ] Write an `oklchDeltaE` helper function in the test file (or a shared test utility) implementing the Euclidean distance formula from Spec S04
- [ ] For each entry in the current `BRIO_GROUND_TRUTH` (which stores `--tug-color()` strings), resolve the string to OKLCH L/C/h using the existing `resolveOklch` path from the derivation engine. Record the resulting triple as the new fixture value.
- [ ] Replace the `BRIO_GROUND_TRUTH` fixture type from `Record<string, string>` to `Record<string, { L: number; C: number; h: number }>`
- [ ] Rewrite T-BRIO-MATCH: for each token, resolve the derived value to OKLCH, compute `oklchDeltaE` against the fixture, assert `< 0.02`
- [ ] Keep the existing T-BRIO-MATCH-ROUNDTRIP test that verifies token string round-tripping (if present) — it validates format, not color accuracy
- [ ] Update T-PRESET-NO-REGRESSION (line ~1221): this test currently does exact string comparison `expect(output.tokens[name]).toBe(expected)` against `BRIO_GROUND_TRUTH` entries. Since the fixture is now OKLCH triples, convert this test to use the same delta-E comparison as T-BRIO-MATCH, or remove it as redundant (it was a complementary check to T-BRIO-MATCH, which now subsumes it). If kept, it should verify token count (371) and delta-E < 0.02 for all ground truth entries.

**Tests:**
- [ ] T-BRIO-MATCH passes with delta-E < 0.02 for all chromatic tokens
- [ ] T-PRESET-NO-REGRESSION passes (either converted to delta-E or removed as redundant)
- [ ] No other tests in the file are broken by the fixture format change

**Checkpoint:**
- [ ] `cd tugdeck && bun test --grep "T-BRIO-MATCH"`
- [ ] `cd tugdeck && bun test --grep "derivation-engine"`

---

#### Step 2: Add marginal band to KNOWN_BELOW_THRESHOLD filtering {#step-2}

**Depends on:** #step-1

**Commit:** `test: add 5 Lc marginal band to KNOWN_BELOW_THRESHOLD filtering`

**References:** [D02] Marginal band, (#strategy, #context)

**Artifacts:**
- Modified `tugdeck/src/__tests__/theme-derivation-engine.test.ts`: T4.1 and T4.2 unexpected-failure filters
- Modified `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx`: `unexpectedFailures` filter

**Tasks:**
- [ ] Import `LC_MARGINAL_DELTA` from `theme-accessibility.ts` in both test files (already exported as value 5)
- [ ] In `theme-derivation-engine.test.ts`, modify the T4.1 unexpected-failure filter (around line 570) to add marginal band logic: if a token fails its Lc threshold but is within `LC_MARGINAL_DELTA` units below the threshold, treat it as marginal (not unexpected). Use the pattern from the proposal: compute `margin = threshold - LC_MARGINAL_DELTA`, only flag tokens with `Math.abs(r.lc) < margin`.
- [ ] Apply the same marginal band change to the T4.2 light-mode filter (around line 654)
- [ ] In `gallery-theme-generator-content.test.tsx`, modify the `unexpectedFailures` function (around line 210) with the same marginal band logic
- [ ] Review the current `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` sets in both files. Identify entries where the token's actual Lc value is within the marginal band (i.e., within 5 Lc of the threshold). These entries are now redundant and can be removed.
- [ ] Remove identified stale entries from both KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS sets

**Tests:**
- [ ] T4.1 passes with 0 unexpected failures after marginal band change
- [ ] T4.2 passes with 0 unexpected failures
- [ ] Gallery test T-ACC-1 passes with 0 unexpected failures

**Checkpoint:**
- [ ] `cd tugdeck && bun test --grep "T4.1"`
- [ ] `cd tugdeck && bun test --grep "T4.2"`
- [ ] `cd tugdeck && bun test --grep "gallery-theme-generator"`

---

#### Step 3: Phase 1 Integration Checkpoint {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `N/A (verification only)`

**References:** [D01] OKLCH delta-E, [D02] Marginal band, (#success-criteria)

**Tasks:**
- [ ] Verify all tests pass end-to-end after Phase 1 tolerance changes
- [ ] Verify no new KNOWN_BELOW_THRESHOLD entries were required

**Tests:**
- [ ] Full test suite passes: `cd tugdeck && bun test`

**Checkpoint:**
- [ ] `cd tugdeck && bun test`

---

#### Step 4: Expand HUE_FAMILIES to 48 colors and add ADJACENCY_RING {#step-4}

**Depends on:** #step-3

**Commit:** `feat: expand HUE_FAMILIES to 48 colors, add ADJACENCY_RING`

**References:** [D03] 48 named colors, [D06] ADJACENCY_RING, [D07] Chroma rederived, Table T01, Spec S03, (#color-ring)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/palette-engine.ts`: HUE_FAMILIES, ADJACENCY_RING, resolveHyphenatedHue, isAdjacent, MAX_CHROMA_FOR_HUE, MAX_P3_CHROMA_FOR_HUE
- Modified `roadmap/tug-color-canonical.json`: 24 new canonical_l entries
- Regenerated `tugdeck/styles/tug-palette.css`: expanded from 24 to 48 hue blocks

**Tasks:**
- [ ] Add 24 new entries to `HUE_FAMILIES` in `palette-engine.ts` using angles from Table T01 (#t01-color-ring). Maintain the existing entries unchanged; add new ones in any order (it is a Record, not an array).
- [ ] Add `ADJACENCY_RING` as a `readonly string[]` constant with all 48 names in ascending hue-angle order per Spec S03 (#s03-adjacency-ring)
- [ ] Add the build-time assertion loop that verifies ascending angle order (throws at module load time if violated) per Spec S03
- [ ] Implement `resolveHyphenatedHue(a: string, b: string): number` per Spec S03 — computes `(2/3 * angle(a)) + (1/3 * angle(b))` with circular wrap handling
- [ ] Implement `isAdjacent(a: string, b: string): boolean` — returns true if a and b are consecutive in ADJACENCY_RING (ring distance = 1, accounting for circularity)
- [ ] Run `_deriveChromaCaps` for each of the 24 new hue angles to compute MAX_CHROMA_FOR_HUE entries. Add results to the existing `MAX_CHROMA_FOR_HUE` record. Use the same `isInSRGBGamut` check and `DEFAULT_LC_PARAMS.cMax` cap as the original 24.
- [ ] Run `_deriveChromaCaps` with `isInP3Gamut` (no cap) for each new angle to compute MAX_P3_CHROMA_FOR_HUE entries. Add to the existing record.
- [ ] For each new hue angle, derive the canonical L value programmatically. Note: `_deriveChromaCaps` finds max chroma at a given L — it does not find L. The canonical_l derivation requires the inverse operation: sweep L from 0.5 to 0.95 (in steps of 0.001 or finer), call `findMaxChroma(L, hueAngle)` at each L, and return the L that produces the highest chroma while staying in sRGB gamut. This is a 1D optimization (brute-force sweep is fine at this scale — ~450 iterations per hue). Write a small helper function (e.g., `deriveCanonicalL(hueAngle: number): number`) to perform this sweep. Run it for each of the 24 new hue angles and add the resulting `canonical_l` entries to `tug-color-canonical.json`. Ensure all values are above 0.555 (piecewise min() constraint per existing code comment).
- [ ] Verify that `DEFAULT_CANONICAL_L` (which reads from `tug-color-canonical.json`) now has 48 entries after the JSON update.
- [ ] Export `ADJACENCY_RING`, `resolveHyphenatedHue`, and `isAdjacent` from `palette-engine.ts`
- [ ] Run `cd tugdeck && bun run generate:palette` to regenerate `tugdeck/styles/tug-palette.css` with all 48 hues. The `generate-tug-palette.ts` script iterates `Object.keys(HUE_FAMILIES)` and produces `--tug-{hue}-h`, `--tug-{hue}-canonical-l`, and `--tug-{hue}-peak-c` CSS custom properties for each hue. Verify the output has 48 hue blocks (not 24).

**Tests:**
- [ ] Unit test: `ADJACENCY_RING` has 48 entries matching `Object.keys(HUE_FAMILIES).length`
- [ ] Unit test: `resolveHyphenatedHue("yellow", "chartreuse")` returns approximately 94.2 degrees
- [ ] Unit test: `resolveHyphenatedHue("berry", "garnet")` handles wrap correctly (approximately 357.5 degrees)
- [ ] Unit test: `isAdjacent("yellow", "chartreuse")` returns true; `isAdjacent("yellow", "blue")` returns false
- [ ] Unit test: all 24 new MAX_CHROMA_FOR_HUE values are positive and <= DEFAULT_LC_PARAMS.cMax
- [ ] Existing tests still pass (the 24 original colors are unchanged)

**Checkpoint:**
- [ ] `cd tugdeck && bun test --grep "palette-engine"`
- [ ] `cd tugdeck && bun test --grep "derivation-engine"`

---

#### Step 5: Update tug-color-parser for adjacency syntax {#step-5}

**Depends on:** #step-4

**Commit:** `feat: replace offset syntax with hyphenated adjacency in tug-color-parser`

**References:** [D03] 48 named colors, [D04] Non-adjacent errors, [D05] Presets win, [D09] Clean break, Spec S01, (#parser-grammar)

**Artifacts:**
- Modified `tugdeck/tug-color-parser.ts`: token types, parsing logic, TugColorValue interface
- Modified `tugdeck/src/__tests__/tug-color-parser.test.ts`: rewritten offset tests

**Tasks:**
- [ ] Update `TugColorValue` interface: remove `offset: number`, add `adjacentName?: string` per Spec S01 (#s01-tug-color-value)
- [ ] Remove `"plus"` from `TokenType` union. The tokenizer no longer needs to emit plus tokens.
- [ ] In the tokenizer, remove the branch that produces `plus` tokens for `+` characters. A `+` in the input should now produce an error.
- [ ] Rewrite the color parsing logic to handle the `IDENT [MINUS IDENT [MINUS IDENT]]` chain grammar per the parser grammar (#parser-grammar):
  - First ident: must be a known color (48-color set via `knownHues` parameter, plus `black`/`white`)
  - Second ident after minus: check presets first [D05], then adjacency [D04], error if non-adjacent or unknown
  - Third ident after minus: must be a preset name; error otherwise
- [ ] Pass adjacency information as a parameter to `parseTugColor`, matching the existing `knownHues` parameter pattern. Add an `adjacencyRing?: readonly string[]` parameter; when provided, the parser validates adjacency. This keeps the parser decoupled from palette-engine.ts.
- [ ] Update error messages for non-adjacent pairs to name both colors and state they are not adjacent
- [ ] Update `parseTugColor`'s `knownHues` parameter handling: callers must now pass the 48-color set
- [ ] Rewrite parser tests in `tug-color-parser.test.ts`:
  - Remove all offset tests (positive integer, negative integer, fractional, etc.)
  - Add adjacency tests: `cobalt-indigo` resolves adjacentName correctly, `indigo-intense` resolves as preset, `cobalt-indigo-intense` resolves both
  - Add non-adjacent error tests: `yellow-blue` produces error
  - Add three-ident tests: `cobalt-indigo-muted` works, `cobalt-indigo-blue` errors
  - Update `KNOWN_HUES` set to include all 48 colors

**Tests:**
- [ ] Parser accepts all valid forms: bare, preset, adjacency, adjacency+preset
- [ ] Parser rejects non-adjacent pairs with clear error message
- [ ] Parser rejects `+` in input (no plus token)
- [ ] All existing non-offset parser tests still pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test --grep "tug-color-parser"`

---

#### Step 6: Update postcss-tug-color for adjacency syntax {#step-6}

**Depends on:** #step-5

**Commit:** `feat: update postcss-tug-color for hyphenated adjacency resolution`

**References:** [D04] Non-adjacent errors, [D09] Clean break, (#parser-grammar)

**Artifacts:**
- Modified `tugdeck/postcss-tug-color.ts`: hue resolution logic
- Modified `tugdeck/src/__tests__/postcss-tug-color.test.ts`: rewritten offset tests

**Tasks:**
- [ ] Update `postcss-tug-color.ts` to handle `TugColorValue.adjacentName`: when present, resolve hue angle via `resolveHyphenatedHue` instead of adding a numeric offset
- [ ] Remove offset-based hue resolution code (the `HUE_FAMILIES[name] + offset` pattern)
- [ ] Ensure parse errors (including non-adjacent pair errors) propagate as PostCSS warnings/errors that fail the build
- [ ] Update the `expandTugColor` function (or equivalent) to accept the new `TugColorValue` shape. For hyphenated adjacency hues: use `DEFAULT_CANONICAL_L[primaryColorName]` for canonical_l (the primary/dominant color, matching how the existing offset code path uses `DEFAULT_CANONICAL_L[colorName]`), and compute peakC dynamically via `findMaxChroma(canonicalL, resolvedAngle) * PEAK_C_SCALE` at the resolved hyphenated angle (matching the existing offset code path at line ~174-175 of postcss-tug-color.ts)
- [ ] Rewrite PostCSS tests: remove offset-related test cases, add adjacency resolution tests, add non-adjacent error tests

**Tests:**
- [ ] PostCSS resolves `--tug-color(cobalt-indigo, i: 7, t: 37)` to correct OKLCH values
- [ ] PostCSS rejects `--tug-color(yellow-blue)` with build error
- [ ] All existing non-offset PostCSS tests still pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test --grep "postcss-tug-color"`

---

#### Step 7: Migrate theme-derivation-engine to named hues {#step-7}

**Depends on:** #step-6

**Commit:** `feat: replace offset syntax with named hues in theme-derivation-engine`

**References:** [D08] Tier ring lookup, [D09] Clean break, Spec S02, Table T02, (#migration-mapping)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts`: ThemeRecipe, ModePreset, resolveHueAngle, formatHueRef, makeTugColor, per-tier hue derivation, EXAMPLE_RECIPES
- Modified `tugdeck/src/components/tugways/theme-accessibility.ts`: parseTugColorToken, rebuildTugColorToken, baseHueName

**Tasks:**
- [ ] Remove `offset?: number` from `ThemeRecipe.atmosphere` and `ThemeRecipe.text` per Spec S02 (#s02-theme-recipe)
- [ ] Update `EXAMPLE_RECIPES.brio`: change `atmosphere: { hue: "violet", offset: -6 }` to `atmosphere: { hue: "indigo-violet" }` per Table T02 (violet-6 at 264 degrees maps to indigo-violet at 263.3 degrees)
- [ ] Remove `fgTierOffsets` and `surfaceTierOffsets` fields from the `ModePreset` interface
- [ ] Remove those fields from `DARK_PRESET` and `LIGHT_PRESET` objects
- [ ] Remove `fgTierAngle()` and `surfaceTierAngle()` helper functions
- [ ] Replace all dark-mode per-tier offset computations with direct named hue references using the migration mapping:
  - `fgTierAngle(0)` (cobalt, 250 degrees) → `"cobalt"` (no change)
  - `fgTierAngle(7)` (cobalt+7, 257 degrees) → `"indigo-cobalt"` (256.7 degrees)
  - `fgTierAngle(8)` (cobalt+8, 258 degrees) → `"indigo-cobalt"` (256.7 degrees)
  - `fgTierAngle(-8)` (cobalt-8, 242 degrees) → `"sapphire-cobalt"` (243.3 degrees)
  - `surfaceTierAngle(0)` (violet, 270 degrees) → `"violet"` (no change)
  - `txtBaseAngle+10` (cobalt+10, 260 degrees) → `"indigo"` (260 degrees)
  - `surfaceTierAngle(5)` (violet+5, 275 degrees, dark-mode tab-bg-active) → `"violet-iris"` (272.5 degrees)
- [ ] For light-mode dynamic offset patterns (`borderStrongLightAngle = atmBaseAngle - 5` and `selInactAngle = atmBaseAngle - 20`): keep the numeric angle arithmetic internally (these offsets are relative to the recipe's atmosphere hue, which varies per theme). The updated `formatHueRef()` (which searches the 144-entry vocabulary) will produce named output for these angles. No pre-resolution to ring positions needed — the arithmetic stays internal, and all emitted `--tug-color()` strings use named forms.
- [ ] Update `resolveHueAngle()` to handle hyphenated names: if the hue string contains a hyphen and the second segment is not a preset, split and call `resolveHyphenatedHue`. Remove the `offset` parameter.
- [ ] Build a precomputed `HUE_VOCABULARY: Record<string, number>` with 144 entries (48 base names + 96 hyphenated pairs) at module load time. Iterate ADJACENCY_RING to generate all adjacent pairs, compute their angles via `resolveHyphenatedHue`, and merge with the 48 base entries from HUE_FAMILIES. This is computed once and reused by `formatHueRef` and `closestHueName`.
- [ ] Update `formatHueRef()` to search the precomputed 144-entry `HUE_VOCABULARY` for the closest match, returning the named form instead of computing `name+N` offsets
- [ ] Update `closestHueName()` to search the 48-color set (it currently searches 24)
- [ ] Update `resolveOklch()` callers: for tokens using hyphenated hue refs, pass the primary (dominant) color name as the `hueName` parameter to `resolveOklch` and `setChromatic`. This ensures `DEFAULT_CANONICAL_L` and `MAX_CHROMA_FOR_HUE` are looked up using the primary color name (e.g., for `"indigo-cobalt"`, pass `"indigo"` as hueName). The same convention applies to `peakC` lookup: use the primary color's `MAX_CHROMA_FOR_HUE` entry. This mirrors the existing offset behavior where `DEFAULT_CANONICAL_L[colorName]` uses the base name.
- [ ] Update `makeTugColor()` (line ~500): replace the `hasOffset` check (`hueRef.includes("+") || /[a-z]-\d/.test(hueRef)`) with logic that correctly identifies hyphenated adjacency names. After migration, hueRefs like `indigo-cobalt` are not offsets — they are valid base forms that can take preset suffixes. The preset emission path (`--tug-color(indigo-cobalt-light)`) must produce valid 3-segment parser input.
- [ ] Update `parseTugColorToken()` in `theme-accessibility.ts` (line ~352): the current preset regex `^([a-z]+)-(light|dark|intense|muted)$` only matches single-word hue names. After migration, tokens like `--tug-color(cobalt-indigo-light)` need parsing. Use a **last-segment-wins** strategy: split `hueStr` on hyphens, check if the last segment is a known preset name (`light`/`dark`/`intense`/`muted`/`canonical`), and if so, join the remaining segments as the hueRef. Examples: `"cobalt-indigo-light"` splits to hueRef=`"cobalt-indigo"` + preset=`"light"`; `"cobalt-indigo"` has no preset match on the last segment, so hueRef=`"cobalt-indigo"` with no preset.
- [ ] Update `rebuildTugColorToken()` in `theme-accessibility.ts` (line ~399): the `hasOffset` regex must be updated to match the new `makeTugColor()` logic so preset emission works correctly for hyphenated hue names. Also fix pre-existing bug: the muted preset check uses `ri === 20 && rt === 50` but `TUG_COLOR_PRESETS.muted` is `{intensity: 50, tone: 42}`. Correct to `ri === 50 && rt === 42` to match the authoritative preset definition in `palette-engine.ts`.
- [ ] Update `baseHueName()` in `theme-accessibility.ts` (line ~429): currently splits on `[+-]` to strip offset. After migration, hyphens separate color names, not offsets. Update to extract the primary (first) color name from a hyphenated adjacency form.
- [ ] Verify ACHROMATIC_ADJACENT_HUES set: `"indigo"` is already present (no change needed). Consider whether other new colors in the blue-violet range (`sapphire`, `iris`, `cerulean`) belong in this set for warmth-bias purposes — they are near the achromatic-adjacent zone. Add any that fall within the violet-cobalt-blue-purple region of the ring.

**Tests:**
- [ ] T-BRIO-MATCH still passes (delta-E < 0.02 from Step 1 absorbs the sub-3-degree shifts)
- [ ] T2.1 token count unchanged
- [ ] T4.1 / T4.2 contrast tests pass
- [ ] Round-trip test: `makeTugColor("indigo-cobalt", 20, 85)` produces `--tug-color(indigo-cobalt-light)` which `parseTugColor` can parse back to the same values

**Checkpoint:**
- [ ] `cd tugdeck && bun test --grep "derivation-engine"`

---

#### Step 8: Update BRIO_GROUND_TRUTH fixture for new vocabulary {#step-8}

**Depends on:** #step-7

**Commit:** `test: re-derive BRIO_GROUND_TRUTH OKLCH triples for new hue vocabulary`

**References:** [D01] OKLCH delta-E, [D08] Tier ring lookup, Spec S04, (#migration-mapping)

**Artifacts:**
- Modified `tugdeck/src/__tests__/theme-derivation-engine.test.ts`: updated OKLCH fixture values

**Tasks:**
- [ ] Run `deriveTheme(EXAMPLE_RECIPES.brio)` with the migrated engine from Step 7
- [ ] For each chromatic token in the output, resolve to OKLCH L/C/h and record as the new fixture value in BRIO_GROUND_TRUTH
- [ ] Verify all delta-E values between old and new fixtures are < 0.02 (the sub-3-degree hue shifts from the migration should produce imperceptible color differences)
- [ ] Update fixture comments to use new hue syntax (e.g., `indigo-cobalt` instead of `cobalt+7`)

**Tests:**
- [ ] T-BRIO-MATCH passes with delta-E < 0.02 for all tokens against the new fixture

**Checkpoint:**
- [ ] `cd tugdeck && bun test --grep "T-BRIO-MATCH"`

---

#### Step 9: Regenerate CSS tokens {#step-9}

**Depends on:** #step-7

**Commit:** `build: regenerate tug-base tokens with named hue vocabulary`

**References:** [D09] Clean break, (#rollout)

**Artifacts:**
- Modified `tugdeck/styles/tug-base.css`: regenerated token block (all offset references become named)

**Tasks:**
- [ ] Run `cd tugdeck && bun run generate:tokens` to regenerate the `--tug-base-*` token block in `tug-base.css`
- [ ] Verify the generated output contains no `+` offset syntax — all hue references should be bare names or hyphenated adjacency
- [ ] Spot-check a few key tokens against the migration mapping (e.g., `cobalt+7` should now be `indigo-cobalt`)

**Tests:**
- [ ] No `+` characters in `--tug-color()` calls within the generated block
- [ ] Token count in the generated block is unchanged

**Checkpoint:**
- [ ] `grep -c 'tug-color.*+[0-9]' tugdeck/styles/tug-base.css` returns 0
- [ ] `cd tugdeck && bun test`

---

#### Step 10: Full Integration Checkpoint {#step-10}

**Depends on:** #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** [D01] OKLCH delta-E, [D03] 48 named colors, [D09] Clean break, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all tests pass end-to-end
- [ ] Verify zero occurrences of offset syntax in the codebase
- [ ] Verify HUE_FAMILIES has 48 entries
- [ ] Verify ADJACENCY_RING has 48 entries
- [ ] Verify `tug-color-canonical.json` has 48 hue entries

**Tests:**
- [ ] Full test suite passes: `cd tugdeck && bun test`
- [ ] No offset syntax in codebase: `grep -rP 'tug-color\([^)]*\+\d' tugdeck/` returns no matches

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `grep -rP 'tug-color\([^)]*\+\d' tugdeck/` returns no matches
- [ ] `grep -c '"plus"' tugdeck/tug-color-parser.ts` returns 0

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A 48-color named hue system with hyphenated adjacency (144 expressible hues), perceptual test tolerances, and zero offset syntax remaining in the codebase.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cd tugdeck && bun test` passes with zero failures
- [ ] HUE_FAMILIES contains 48 entries with correct angles per Table T01
- [ ] ADJACENCY_RING contains 48 entries in ascending angle order with build-time assertion
- [ ] BRIO_GROUND_TRUTH uses OKLCH delta-E < 0.02 comparison (no string matching)
- [ ] KNOWN_BELOW_THRESHOLD uses 5 Lc marginal band
- [ ] Zero occurrences of `plus` token type in parser
- [ ] Zero occurrences of numeric hue offsets in `--tug-color()` calls
- [ ] `tug-color-canonical.json` has 48 hue entries with derived canonical_l values
- [ ] Non-adjacent pairs produce hard errors in both parser and PostCSS plugin

**Acceptance tests:**
- [ ] T-BRIO-MATCH: all chromatic tokens within delta-E 0.02
- [ ] T4.1: 0 unexpected failures (dark mode, with marginal band)
- [ ] T4.2: 0 unexpected failures (light mode, with marginal band)
- [ ] Parser: `parseTugColor("cobalt-indigo", KNOWN_48)` succeeds with adjacentName="indigo"
- [ ] Parser: `parseTugColor("yellow-blue", KNOWN_48)` fails with non-adjacent error
- [ ] PostCSS: `--tug-color(cobalt-indigo, i: 7, t: 37)` resolves correctly
- [ ] PostCSS: `--tug-color(red+5)` fails (offset syntax removed)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Update `tug-palette-anchors.json` to 48 colors (currently excluded as legacy/docs only)
- [ ] Add gallery card showing all 48 colors with hyphenated variants
- [ ] Explore additional preset names for common hyphenated pairs
- [ ] Consider exposing the 144-hue vocabulary as a design tool / picker

| Checkpoint | Verification |
|------------|--------------|
| Phase 1 complete | `cd tugdeck && bun test` passes after Steps 1-3 |
| Phase 2 palette expansion | `cd tugdeck && bun test --grep "palette-engine"` after Step 4 |
| Phase 2 parser migration | `cd tugdeck && bun test --grep "tug-color-parser"` after Step 5 |
| Phase 2 full migration | `cd tugdeck && bun test` after Step 10 |
