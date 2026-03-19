<!-- tugplan-skeleton v2 -->

## Phase 3: Build Independent Recipes {#independent-recipes}

**Purpose:** Transform `LIGHT_FORMULAS` from a spread-based override of `DARK_FORMULAS` into a complete, self-contained 200-field recipe, resolve all `[phase-3-bug]` contrast exceptions, remove the `BASE_FORMULAS`/`LIGHT_OVERRIDES` abstraction, and regenerate CSS documentation — so that both brio (dark) and harmony (light) pass contrast validation with zero exceptions beyond documented design choices.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | phase-3-independent-recipes |
| Last updated | 2026-03-18 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The theme system's `LIGHT_FORMULAS` is defined as `{ ...BASE_FORMULAS, ...LIGHT_OVERRIDES }` where `BASE_FORMULAS === DARK_FORMULAS`. This makes the light recipe structurally "dark, but change these things" rather than a complete, independent definition of how to render a light theme. Phase 2 (PR #140) built the contrast engine infrastructure — two-pass composited enforcement, parameterized recipe test loop, shared exception module — that makes it possible to validate and calibrate independent recipes. The `[phase-3-bug]` items documented in `contrast-exceptions.ts` are the ground truth for what must be fixed.

`DARK_FORMULAS` is already a complete, annotated 200-field object and needs only verification that its annotations are complete. The primary work is expanding `LIGHT_OVERRIDES` (126 fields) into a full standalone `LIGHT_FORMULAS` object with all 200 fields explicitly set, then calibrating values until all `[phase-3-bug]` exceptions are resolved.

#### Strategy {#strategy}

- Verify DARK_FORMULAS annotations are complete; no new formula work on the dark side.
- Build standalone LIGHT_FORMULAS by expanding every field from DARK_FORMULAS with explicit light-mode design rationale — not by spreading.
- Calibrate LIGHT_FORMULAS iteratively using the Phase 2 contrast engine and `audit-tokens.ts` tooling.
- Resolve every `[phase-3-bug]` item in `contrast-exceptions.ts` — either by formula calibration or, if blocked, by documenting the structural constraint and tagging for engine-work follow-up.
- Remove `BASE_FORMULAS`, `DARK_OVERRIDES`, and `LIGHT_OVERRIDES` after recipes are standalone.
- Update all test files: replace spread-based imports with direct formula object references.
- Regenerate CSS documentation as a final cleanup step.

#### Success Criteria (Measurable) {#success-criteria}

- `bun test` passes with zero `[phase-3-bug]` entries remaining in `contrast-exceptions.ts` (`grep '\[phase-3-bug\]' contrast-exceptions.ts` returns 0 lines)
- `LIGHT_FORMULAS` is a literal object with 200 explicitly-set fields (no object spread, no `...BASE_FORMULAS`)
- `BASE_FORMULAS`, `DARK_OVERRIDES`, and `LIGHT_OVERRIDES` exports are removed from `theme-derivation-engine.ts`
- No test file imports `BASE_FORMULAS`, `DARK_OVERRIDES`, or `LIGHT_OVERRIDES`
- `bun run audit:tokens lint` exits 0
- `bun run audit:tokens verify` exits 0
- `bun test` passes (all 1886+ tests)

#### Scope {#scope}

1. Verify DARK_FORMULAS annotation completeness
2. Build standalone LIGHT_FORMULAS (all 200 fields, explicit values and rationale)
3. Calibrate LIGHT_FORMULAS to resolve all `[phase-3-bug]` contrast exceptions
4. Remove BASE_FORMULAS, DARK_OVERRIDES, LIGHT_OVERRIDES abstractions
5. Update EXAMPLE_RECIPES to use direct formula references
6. Clean up test files: update imports, replace spread references
7. Regenerate CSS documentation (`audit-tokens inject --apply` + `verify`)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Formula de-duplication (reducing 200 fields to ~13 semantic decisions) — that is Phase 4
- Dark/stark and light/stark recipe variants — Phase 4
- Theme Generator slider improvements — Phase 4
- Token renaming or CSS structural changes — completed in Phases 1/1.5
- Engine architecture changes (new formula paths, new derivation strategies)

#### Dependencies / Prerequisites {#dependencies}

- Phase 2 contrast engine (PR #140, merged): two-pass composited enforcement, parameterized recipe loop, shared exception module
- `audit-tokens.ts` tooling (PR #139, merged): lint, pairings, inject, verify subcommands
- All 1886 tests passing on main branch

#### Constraints {#constraints}

- `bun run audit:tokens lint` must exit 0 after every step that touches CSS or tokens
- `bun run audit:tokens verify` must confirm map-to-CSS consistency after every step
- `bun test` must pass after every step (with decreasing exception count as bugs are resolved)
- LIGHT_FORMULAS values must be chosen for light-mode design intent, not mechanically inverted from dark

#### Assumptions {#assumptions}

- DARK_FORMULAS already satisfies the "fully annotated, standalone" requirement — no new formula work needed on the dark side beyond verifying annotations are complete
- The 126 fields currently in LIGHT_OVERRIDES already have correct light-mode values; the remaining 74 fields inherited from DARK_FORMULAS need explicit light-mode review and annotation
- The parameterized recipe test loop from Phase 2 will automatically validate both brio and harmony once EXAMPLE_RECIPES is updated
- Any `[phase-3-bug]` items that cannot be resolved by recipe calibration alone will be documented with a clear explanation and tagged for Phase 4 or engine-work follow-up

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] fg-inverse polarity in light mode (OPEN) {#q01-fg-inverse-polarity}

**Question:** `fg-inverse` derives near-white in light mode (L~0.94), creating near-zero contrast against near-white surfaces. Should Phase 3 introduce a mode-aware `fg-inverse` derivation path, or should the exception remain a design-choice?

**Why it matters:** Three `[phase-3-bug]` and `[design-choice]` entries in `contrast-exceptions.ts` relate to `fg-inverse` polarity: `fg-inverse|surface-default`, `fg-inverse|surface-screen`, `fg-inverse|tone-danger`. If the answer is "engine path," this becomes engine work that may belong in Phase 4.

**Options (if known):**
- A: Add a light-mode `fg-inverse` formula field (e.g., `fgInverseToneLight`) that produces near-black in light mode
- B: Keep `fg-inverse` as-is and accept the polarity mismatch as a design-choice exception
- C: Defer to Phase 4 when formula de-duplication introduces mode-aware derivation

**Plan to resolve:** Attempt calibration first (Option A via existing formula fields). If a new derivation path is required, document the constraint and defer to Phase 4.

**Resolution:** OPEN

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Some [phase-3-bug] items require engine changes, not just calibration | med | med | Document the constraint, tag for Phase 4 | More than 3 bugs cannot be resolved by calibration |
| Explicit LIGHT_FORMULAS values drift from DARK_FORMULAS when dark is updated | med | low | Add a test that verifies both recipes have exactly the same field set | First field-count mismatch in CI |
| Light-mode calibration introduces new contrast failures in other pairings | high | med | Run full test suite after every formula change; use parameterized loop | Any new unexpected failure in `bun test` |

**Risk R01: Calibration cascade** {#r01-calibration-cascade}

- **Risk:** Adjusting one formula field to fix a `[phase-3-bug]` item shifts contrast ratios for other pairings, creating new failures.
- **Mitigation:**
  - Run full `bun test` after every individual field change
  - Use `bun run audit:tokens pairings` to trace affected CSS contexts before changing values
  - Make changes in small increments (one semantic group at a time)
- **Residual risk:** Some fields affect many tokens simultaneously; a calibration deadlock may require engine-level changes deferred to Phase 4.

**Risk R02: Incomplete field coverage in standalone LIGHT_FORMULAS** {#r02-incomplete-field-coverage}

- **Risk:** Some of the 74 fields inherited from DARK_FORMULAS may have correct light-mode values by coincidence. Setting them to the same value explicitly could mask a needed calibration.
- **Mitigation:**
  - Review each inherited field's semantic group and design rationale
  - For fields where dark and light values are identical, annotate with rationale explaining why (e.g., "hue dispatch is mode-independent")
  - Run contrast validation after each semantic group is reviewed
- **Residual risk:** Fields that happen to work may need recalibration when Phase 4 introduces stark recipes.

---

### Design Decisions {#design-decisions}

#### [D01] LIGHT_FORMULAS becomes a literal 200-field object (DECIDED) {#d01-literal-light-formulas}

**Decision:** `LIGHT_FORMULAS` will be defined as a complete object literal with all 200 `DerivationFormulas` fields explicitly set — no object spread, no inheritance from `DARK_FORMULAS` or `BASE_FORMULAS`.

**Rationale:**
- The spread pattern (`{ ...BASE_FORMULAS, ...LIGHT_OVERRIDES }`) hides which values are intentional vs inherited, making calibration error-prone
- Independent recipes (the iOS word game model) require each recipe to be a self-contained design specification
- Explicit values with annotations serve as documentation for future recipe authors

**Implications:**
- Every field in LIGHT_FORMULAS must have a design-rationale annotation comment
- Fields where dark and light happen to share the same value still get explicit entries with rationale
- The file will be longer but each value is traceable to a design decision

#### [D02] DARK_FORMULAS annotations are verified, not rewritten (DECIDED) {#d02-dark-annotations-verified}

**Decision:** DARK_FORMULAS is already a complete 200-field annotated object. Phase 3 verifies annotation completeness and moves on — no structural changes to the dark recipe.

**Rationale:**
- The dark recipe was annotated in Parts 1-4 of semantic-formula-architecture
- All dark-mode contrast tests pass with zero unexpected failures
- Rewriting working code creates unnecessary risk

**Implications:**
- Step 1 is a verification step, not a rewrite step
- Any missing annotations discovered are added as a minor fix, not a redesign

#### [D03] All [phase-3-bug] items must be resolved (DECIDED) {#d03-all-bugs-resolved}

**Decision:** Every entry tagged `[phase-3-bug]` in `contrast-exceptions.ts` must be resolved in Phase 3. Resolution means either: (a) the formula calibration fixes the contrast failure and the exception is removed, or (b) the bug requires engine-level changes that are documented with rationale and explicitly deferred to Phase 4 with a tracking tag.

**Rationale:**
- Phase 2 documented these bugs as Phase 3 ground truth
- Leaving unresolved bugs as silent exceptions undermines the contrast engine's value
- The user answer explicitly requires all `[phase-3-bug]` items resolved, including token additions or formula-path additions

**Implications:**
- Some bugs may require adding new formula fields (e.g., `fgInverseToneLight`) to the DerivationFormulas interface
- Any deferred items must have a `[phase-4-engine]` tag and documented rationale, not silent exception entries

#### [D04] BASE_FORMULAS, DARK_OVERRIDES, and LIGHT_OVERRIDES are removed (DECIDED) {#d04-remove-base-overrides}

**Decision:** After both recipes are standalone, remove the `BASE_FORMULAS`, `DARK_OVERRIDES`, and `LIGHT_OVERRIDES` exports. These encode the wrong abstraction (light = dark + patches).

**Rationale:**
- The base/override pattern was scaffolding that became a ceiling
- Keeping dead exports creates confusion about which formula objects are canonical
- Test files that import these create coupling to the old abstraction

**Implications:**
- All imports of `BASE_FORMULAS`, `DARK_OVERRIDES`, `LIGHT_OVERRIDES` must be updated
- EXAMPLE_RECIPES entries must reference `DARK_FORMULAS` and `LIGHT_FORMULAS` directly
- This is a breaking change for any external consumers (none exist currently)

#### [D05] Test file cleanup uses explicit steps (DECIDED) {#d05-test-cleanup-explicit}

**Decision:** Test file cleanup gets explicit execution steps: update imports, replace spread references with direct formula object references, verify no remaining references to removed exports.

**Rationale:**
- User answer explicitly requires explicit test-file cleanup steps
- Spread references in tests (e.g., `{ ...BASE_FORMULAS, ...DARK_OVERRIDES }`) must become `DARK_FORMULAS` directly
- Leaving stale imports causes build failures after the exports are removed

**Implications:**
- Each test file that imports the removed symbols gets reviewed and updated
- A grep-based verification confirms zero remaining references

---

### Deep Dives (Optional) {#deep-dives}

#### Phase-3-Bug Inventory {#bug-inventory}

**Table T01: [phase-3-bug] items in contrast-exceptions.ts** {#t01-bug-inventory}

| Bug ID | Location | Pair / Token | Description | Resolution Strategy |
|--------|----------|-------------|-------------|-------------------|
| B01 | `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` | `tone-danger` | Chromatic hue ceiling prevents reaching contrast 75 | Calibrate `semanticSignalTone` or add dedicated tone-danger formula path |
| B02 | `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` | `field-fg-default` | Light-mode field bg creates contrast constraint ~27-51 | Calibrate `fieldBgRestTone` / `fgDefaultTone` spread |
| B03 | `KNOWN_PAIR_EXCEPTIONS` | `fg-default\|tab-bg-active` | Card title text on active title bar; contrast ~73.6 | Calibrate `cardFrameActiveTone` to increase separation |
| B04 | `KNOWN_PAIR_EXCEPTIONS` | `fg-default\|accent-subtle` | Menu selected item text on 15%-alpha accent tint; composited ~62 | Calibrate accent-subtle alpha or add formula path |
| B05 | `KNOWN_PAIR_EXCEPTIONS` | `fg-default\|tone-caution-bg` | Autofix suggestion text on caution tint; composited ~58 | Calibrate tone-caution-bg alpha |
| B06 | `KNOWN_PAIR_EXCEPTIONS` | `fg-inverse\|tone-danger` | Dock badge text on danger signal bg | Calibrate fg-inverse/tone-danger separation; may need [Q01] resolution |
| B07 | `KNOWN_PAIR_EXCEPTIONS` | `fg-inverse\|surface-default` | Badge ghost/outlined: dark-on-dark in dark mode, white-on-white in light | Mode-aware fg-inverse or component-level fix; relates to [Q01] |
| B08 | `KNOWN_PAIR_EXCEPTIONS` | `tone-danger\|surface-overlay` | Danger menu item label; chromatic hue ceiling | Same strategy as B01 |
| B09 | `LIGHT_MODE_PAIR_EXCEPTIONS` | `fg-default\|bg-app` | bg-app derives too dark when DARK_FORMULAS used in light mode | Root cause: T4.2/T4.4/T4.7 use DARK_FORMULAS in light mode; fix by switching to LIGHT_FORMULAS |
| B10 | `LIGHT_MODE_PAIR_EXCEPTIONS` | `fg-default\|bg-canvas` | Same root cause as B09 | Switch light-mode tests to LIGHT_FORMULAS |
| B11 | `LIGHT_MODE_PAIR_EXCEPTIONS` | `fg-default\|surface-raised` | Same root cause as B09 | Switch light-mode tests to LIGHT_FORMULAS |
| B12 | `LIGHT_MODE_PAIR_EXCEPTIONS` | `fg-default\|surface-overlay` | Same root cause as B09 | Switch light-mode tests to LIGHT_FORMULAS |
| B13 | `LIGHT_MODE_PAIR_EXCEPTIONS` | `fg-default\|surface-sunken` | Same root cause as B09 | Switch light-mode tests to LIGHT_FORMULAS |
| B14 | `LIGHT_MODE_PAIR_EXCEPTIONS` | `fg-default\|surface-screen` | Same root cause as B09 | Switch light-mode tests to LIGHT_FORMULAS |

#### Semantic Groups Requiring Light-Mode Review {#semantic-groups-review}

**Table T02: DerivationFormulas semantic groups and light-mode status** {#t02-semantic-groups}

The 74 fields not in LIGHT_OVERRIDES are inherited from DARK_FORMULAS. These fields need explicit review to determine if the dark value is correct for light mode or needs calibration.

| Semantic Group | Fields in LIGHT_OVERRIDES | Fields Inherited | Review Priority |
|---------------|--------------------------|-----------------|----------------|
| Canvas Darkness | 2 | 0 | Done (all overridden) |
| Surface Layering | 7 | 0 | Done (all overridden) |
| Surface Coloring | 10 | 0 | Done (all overridden) |
| Text Brightness | 2 | 0 | Done (all overridden) |
| Text Hierarchy | 4 | 0 | Done (all overridden) |
| Text Coloring | 7 | 0 | Done (all overridden) |
| Border Visibility | 10 | 0 | Done (all overridden) |
| Card Frame Style | 4 | 0 | Done (all overridden) |
| Shadow Depth | 8 | 0 | Done (all overridden) |
| Filled Control Prominence | 3 | ~8 | Medium — hover/active tone deltas may need light review |
| Outlined Control Style | 16 | ~5 | Medium — border tones and rest-state bg |
| Ghost Control Style | 14 | ~6 | Medium — bg alpha and border values |
| Badge Style | 8 | 0 | Done (all overridden) |
| Icon Style | 3 | ~3 | Low — icon disabled tones |
| Tab Style | 1 | ~3 | Low — rest/hover tones |
| Toggle Style | 3 | ~5 | Low — on-state and alpha values |
| Field Style | 7 | ~3 | Low — placeholder tones |
| Computed Tone Override | 15 | 0 | Done (all overridden) |
| Hue Name Dispatch | 2 | ~8 | Low — hue dispatch is mode-independent |
| Hue Slot Dispatch | 0 | ~10 | Low — slot dispatch is mode-independent |
| Sentinel Dispatch | 0 | ~8 | Low — sentinel alpha is mode-independent |
| Selection Mode | 4 | ~2 | Low — selection active tones |
| Accent/Signal Tones | 0 | ~7 | Medium — on-accent tones may need light calibration |

---

### Specification {#specification}

#### Verification Workflow {#verification-workflow}

**Spec S01: Mandatory verification gates after every formula change** {#s01-verification-gates}

Every step that modifies formula values, CSS tokens, or test files must run this full 5-command sequence in its Checkpoint section before the step is considered complete:

1. `bun run audit:tokens lint` — annotations and aliases still valid (exit 0)
2. `bun run audit:tokens pairings` — verify zero unresolved pairings
3. `bun run audit:tokens inject --apply` — regenerate `@tug-pairings` blocks
4. `bun run audit:tokens verify` — confirm pairing map and CSS blocks are in sync
5. `bun test` — all tests pass

All five commands are mandatory in every step's Checkpoint section. No step may omit any of the five gates.

#### File Inventory {#file-inventory}

**Spec S02: Files modified in this phase** {#s02-file-inventory}

| File | Changes |
|------|---------|
| `tugdeck/src/components/tugways/theme-derivation-engine.ts` | Rewrite LIGHT_FORMULAS as literal; remove BASE_FORMULAS, DARK_OVERRIDES, LIGHT_OVERRIDES; update EXAMPLE_RECIPES |
| `tugdeck/src/__tests__/contrast-exceptions.ts` | Remove `LIGHT_MODE_PAIR_EXCEPTIONS` and `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS` exports entirely (B09-B14 resolved by switching tests to LIGHT_FORMULAS); remove remaining `[phase-3-bug]` entries from `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` and `KNOWN_PAIR_EXCEPTIONS`; review/update `RECIPE_PAIR_EXCEPTIONS.harmony` when B07 is resolved; verify remaining `[design-choice]` entries |
| `tugdeck/src/__tests__/theme-derivation-engine.test.ts` | Update imports: has actual `import { BASE_FORMULAS, ... }` statements that must be removed/replaced |
| `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` | Update string references only (test descriptions mentioning old symbol names); no actual imports of removed symbols |
| `tugdeck/src/__tests__/theme-accessibility.test.ts` | Update imports if referencing removed exports |
| `tugdeck/src/__tests__/contrast-dashboard.test.tsx` | Update imports if referencing removed exports |
| `tugdeck/src/__tests__/theme-export-import.test.tsx` | Update imports if referencing removed exports |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers — add an anchor instead.

#### Step 1: Verify DARK_FORMULAS annotations {#step-1}

<!-- Step 1 has no dependencies (root step) -->

**Commit:** `chore(theme): verify DARK_FORMULAS annotation completeness`

**References:** [D02] DARK_FORMULAS annotations are verified, (#context, #assumptions)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` (minor annotation additions if any fields lack rationale comments)

**Tasks:**
- [ ] Run `bun run audit:tokens tokens` to get the full classified inventory of all 373 `--tug-base-*` tokens (element/surface/chromatic); use this to verify DARK_FORMULAS covers every semantic group that produces tokens
- [ ] Read the complete `DARK_FORMULAS` object in `theme-derivation-engine.ts` (200 fields)
- [ ] Cross-reference the `audit:tokens tokens` output against DARK_FORMULAS fields to confirm every token semantic group has corresponding formula coverage
- [ ] Verify every field has a `@semantic` group tag and a design-rationale comment
- [ ] Run `bun run audit:tokens lint` to check annotation consistency across the full DARK_FORMULAS object
- [ ] Add any missing annotations (expected: very few or none)
- [ ] Confirm DARK_FORMULAS is already a complete literal object (no spread)

**Tests:**
- [ ] `bun test` passes (no changes expected; baseline verification)

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — no unexpected changes
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] Every field in DARK_FORMULAS has a rationale comment (manual review)

---

#### Step 2: Build standalone LIGHT_FORMULAS — surface and canvas groups {#step-2}

**Depends on:** #step-1

**Commit:** `feat(theme): standalone LIGHT_FORMULAS — surface and canvas groups`

**References:** [D01] LIGHT_FORMULAS becomes a literal 200-field object, Table T02, Spec S01, (#strategy, #semantic-groups-review)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — begin building `LIGHT_FORMULAS` as a new literal object; start with surface/canvas semantic groups

**Tasks:**
- [ ] Run `bun run audit:tokens tokens` to identify which tokens belong to the surface and canvas semantic groups; use the element/surface/chromatic classification to understand the token boundaries for these groups
- [ ] Create a new `LIGHT_FORMULAS` constant as a complete `DerivationFormulas` literal object
- [ ] Copy all 200 field names from DARK_FORMULAS as the template structure
- [ ] For the surface and canvas semantic groups (Canvas Darkness, Surface Layering, Surface Coloring): set values from current LIGHT_OVERRIDES with existing rationale
- [ ] For remaining groups: temporarily set values from DARK_FORMULAS with `// [light-review-pending]` comments
- [ ] Keep the old `LIGHT_OVERRIDES`-based `LIGHT_FORMULAS` as `LIGHT_FORMULAS_LEGACY` temporarily for comparison
- [ ] Annotate every field with light-mode design rationale
- [ ] Run `bun run audit:tokens pairings` to verify no pairings were disrupted by the refactor — review the contrast values for all surface token pairings to confirm the refactor is value-identical
- [ ] Run `bun run audit:tokens lint` as a quick sanity check that the new literal object has not broken annotation consistency

**Tests:**
- [ ] `bun test` passes (LIGHT_FORMULAS output must match LIGHT_FORMULAS_LEGACY exactly at this point)
- [ ] Verify deep object equality between `LIGHT_FORMULAS` and `LIGHT_FORMULAS_LEGACY` (all 200 fields identical); additionally confirm `deriveTheme` output is identical when using either object

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — no unexpected changes
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] `LIGHT_FORMULAS` is a complete literal object (no spread operators)
- [ ] Surface/canvas fields have light-mode rationale annotations

---

#### Step 3: Build standalone LIGHT_FORMULAS — text and border groups {#step-3}

**Depends on:** #step-2

**Commit:** `feat(theme): standalone LIGHT_FORMULAS — text and border groups`

**References:** [D01] LIGHT_FORMULAS becomes a literal 200-field object, Table T02, Spec S01, (#semantic-groups-review)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — populate text and border semantic groups with explicit light-mode values and rationale

**Tasks:**
- [ ] Run `bun run audit:tokens tokens` to identify which tokens belong to the text and border semantic groups; use the classification to understand token boundaries and ensure complete coverage
- [ ] For Text Brightness, Text Hierarchy, Text Coloring groups: transfer values from LIGHT_OVERRIDES with rationale
- [ ] For Border Visibility group: transfer values from LIGHT_OVERRIDES with rationale
- [ ] Review inherited fields in these groups (Table T02 "Fields Inherited" column): determine if dark value is correct for light mode
- [ ] Replace `[light-review-pending]` comments with explicit rationale for reviewed fields
- [ ] Run `bun run audit:tokens pairings` to verify no pairings were disrupted — review contrast values for all text-on-surface and border pairings to confirm the refactor is value-identical
- [ ] Run `bun run audit:tokens lint` to verify annotation consistency after text/border group changes

**Tests:**
- [ ] `bun test` passes (output must still match LIGHT_FORMULAS_LEGACY)

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — no unexpected changes
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] Zero `[light-review-pending]` tags in text and border semantic groups

---

#### Step 4: Build standalone LIGHT_FORMULAS — control and component groups {#step-4}

**Depends on:** #step-3

**Commit:** `feat(theme): standalone LIGHT_FORMULAS — control and component groups`

**References:** [D01] LIGHT_FORMULAS becomes a literal 200-field object, Table T02, Spec S01, (#semantic-groups-review)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — populate remaining semantic groups: controls, badges, icons, tabs, toggles, fields, shadows, computed overrides, hue dispatch, selection

**Tasks:**
- [ ] Run `bun run audit:tokens tokens` to identify which tokens belong to control, badge, icon, tab, toggle, field, shadow, and dispatch semantic groups; use the element/surface/chromatic classification to understand token boundaries for each group
- [ ] For each remaining semantic group (Filled Control, Outlined Control, Ghost Control, Badge, Icon, Tab, Toggle, Field, Shadow, Computed Tone, Hue Dispatch, Hue Slot Dispatch, Sentinel Dispatch, Selection): transfer values and rationale
- [ ] Review all inherited fields: for mode-independent groups (Hue Slot Dispatch, Sentinel Dispatch), annotate with "mode-independent: same value as dark because [reason]"
- [ ] Replace all remaining `[light-review-pending]` comments
- [ ] Run `bun run audit:tokens pairings` to verify no pairings were disrupted — review contrast values for all control/component pairings to confirm the refactor is value-identical
- [ ] Run `bun run audit:tokens lint` to verify annotation consistency after all remaining groups are populated

**Tests:**
- [ ] `bun test` passes (output must still match LIGHT_FORMULAS_LEGACY)

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — no unexpected changes
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] Zero `[light-review-pending]` tags remaining in LIGHT_FORMULAS
- [ ] `grep -c 'light-review-pending' theme-derivation-engine.ts` returns 0

---

#### Step 5: Standalone LIGHT_FORMULAS integration checkpoint {#step-5}

**Depends on:** #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] LIGHT_FORMULAS becomes a literal 200-field object, Spec S01, (#success-criteria)

**Tasks:**
- [ ] Verify LIGHT_FORMULAS is a complete 200-field literal with zero spread operators
- [ ] Verify deriveTheme output is unchanged for both brio (using DARK_FORMULAS) and harmony (using new LIGHT_FORMULAS vs LIGHT_FORMULAS_LEGACY)
- [ ] Verify every field has explicit design-rationale annotation

**Tests:**
- [ ] `bun test` passes — confirms LIGHT_FORMULAS and LIGHT_FORMULAS_LEGACY produce identical output
- [ ] `bun run audit:tokens lint` passes — confirms annotation integrity across the full 200-field object

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — no unexpected changes
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] `grep -c '\.\.\.' theme-derivation-engine.ts` within the LIGHT_FORMULAS block returns 0 spread operators
- [ ] Field count matches DARK_FORMULAS field count (200)

---

#### Step 6: Fix light-mode test formulas — resolve B09-B14 by using LIGHT_FORMULAS {#step-6}

**Depends on:** #step-5

**Commit:** `fix(theme): use LIGHT_FORMULAS for light-mode tests — resolve [phase-3-bug] B09-B14`

**References:** [D03] All bugs resolved, Table T01 (B09-B14), Spec S01, (#bug-inventory, #verification-workflow)

**Artifacts:**
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — update T4.2 (brio-light synthetic), T4.4, and T4.7 (stress tests) to use `LIGHT_FORMULAS` when mode is light instead of `DARK_FORMULAS`
- `tugdeck/src/__tests__/contrast-exceptions.ts` — remove `LIGHT_MODE_PAIR_EXCEPTIONS` and `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS` exports entirely; remove all `[phase-3-bug]` B09-B14 entries

**Tasks:**
- [ ] Read test T4.2 (brio-light synthetic variant) in `theme-derivation-engine.test.ts` and identify where it uses `DARK_FORMULAS` with light mode — this is the root cause of B09-B14, not a calibration gap in LIGHT_FORMULAS
- [ ] Read tests T4.4 and T4.7 (stress tests) to find the same pattern: `DARK_FORMULAS` used in light mode
- [ ] Update T4.2 to use `LIGHT_FORMULAS` when the mode is light — LIGHT_FORMULAS already has correct surface tones for light mode, so this eliminates B09-B14 at the root cause
- [ ] Update T4.4 and T4.7 to use `LIGHT_FORMULAS` when the mode is light
- [ ] Remove the `LIGHT_MODE_PAIR_EXCEPTIONS` export from `contrast-exceptions.ts` entirely — no test path will use dark formulas in light mode after this change
- [ ] Remove the `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS` export from `contrast-exceptions.ts` entirely
- [ ] Update any test code that references the removed exception sets to remove those references
- [ ] Run `bun test` to confirm all B09-B14 contrast failures are resolved by the formula switch

**Tests:**
- [ ] `bun test` passes with B09-B14 entries removed
- [ ] No test uses `DARK_FORMULAS` in light mode

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — no unexpected changes
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] `grep -E 'LIGHT_MODE_PAIR_EXCEPTIONS|LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS' tugdeck/src/__tests__/contrast-exceptions.ts` returns 0 matches

---

#### Step 7: Calibrate LIGHT_FORMULAS — resolve element contrast bugs {#step-7}

**Depends on:** #step-6

**Commit:** `fix(theme): calibrate LIGHT_FORMULAS elements — resolve [phase-3-bug] B01-B08`

**References:** [D03] All bugs resolved, Table T01 (B01-B08), [Q01] fg-inverse polarity, Spec S01, Risk R01, (#bug-inventory, #q01-fg-inverse-polarity)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — adjust element formula values; potentially add new formula fields for token-specific paths
- `tugdeck/src/__tests__/contrast-exceptions.ts` — remove resolved `[phase-3-bug]` entries from `KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS` and `KNOWN_PAIR_EXCEPTIONS`; review `RECIPE_PAIR_EXCEPTIONS.harmony` for `fg-inverse|surface-default` overlap with B07 (note: `LIGHT_MODE_PAIR_EXCEPTIONS` and `LIGHT_MODE_BODY_TEXT_PAIR_EXCEPTIONS` were already removed in Step 6)

**Tasks:**
- [ ] Run `bun run audit:tokens pairings` to map ALL CSS contexts for B01-B08 tokens before making any changes — for each bug's token pair (e.g., `tone-danger`, `field-fg-default`, `fg-default|tab-bg-active`), identify every CSS file and selector where that pairing appears, its current contrast ratio, threshold, and role. This replaces manual CSS grep entirely: the pairings output shows you every affected context in <100ms.
- [ ] B01/B08 (tone-danger): run `bun run audit:tokens pairings` and filter for `tone-danger` pairings to see all contexts where tone-danger appears as fg or bg; calibrate `semanticSignalTone` or add a dedicated `toneDangerTone` formula field if the shared field cannot satisfy both accent and danger constraints; run pairings again after the change to verify new contrast ratios
- [ ] B02 (field-fg-default): run `bun run audit:tokens pairings` filtered for `field-fg-default` to see all field pairings; calibrate field bg/fg separation in light mode; run pairings again to verify
- [ ] B03 (fg-default|tab-bg-active): run `bun run audit:tokens pairings` to see the current contrast for this pair and all other pairings involving `tab-bg-active`; calibrate `cardFrameActiveTone` to increase contrast with `fgDefaultTone`; run pairings to confirm the fix and check for cascade; remove resolved entry from `KNOWN_PAIR_EXCEPTIONS`
- [ ] B04 (fg-default|accent-subtle): run `bun run audit:tokens pairings` to see all `accent-subtle` pairings; calibrate accent-subtle alpha or add formula path; run pairings to verify; remove resolved entry from `KNOWN_PAIR_EXCEPTIONS`
- [ ] B05 (fg-default|tone-caution-bg): run `bun run audit:tokens pairings` to see all `tone-caution-bg` pairings; calibrate tone-caution-bg alpha; run pairings to verify; remove resolved entry from `KNOWN_PAIR_EXCEPTIONS`
- [ ] B06/B07 (fg-inverse pairs): run `bun run audit:tokens pairings` to see all `fg-inverse` pairings across all CSS files — this reveals every context where fg-inverse contrast matters; attempt calibration; if a new derivation path is needed, resolve [Q01] and either add `fgInverseToneLight` formula field or document as `[phase-4-engine]`; when B07 (`fg-inverse|surface-default`) is resolved, also review and update `RECIPE_PAIR_EXCEPTIONS.harmony` which carries the same pair tagged `[design-choice]`
- [ ] Run `bun run audit:tokens lint` after each calibration change to verify annotations remain valid
- [ ] Remove resolved entries from `KNOWN_PAIR_EXCEPTIONS` and `RECIPE_PAIR_EXCEPTIONS.harmony` as applicable (note: `LIGHT_MODE_*` exception sets were already removed in Step 6)
- [ ] After each change, run `bun run audit:tokens pairings` to see updated contrast ratios across all affected contexts, then run `bun test` to check for cascade effects (Risk R01)

**Tests:**
- [ ] `bun test` passes with zero `[phase-3-bug]` entries (or documented `[phase-4-engine]` deferrals)

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — regenerate blocks reflecting calibrated values
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] `grep '\[phase-3-bug\]' tugdeck/src/__tests__/contrast-exceptions.ts` returns 0 lines

---

#### Step 8: Calibration integration checkpoint {#step-8}

**Depends on:** #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D03] All bugs resolved, Table T01, Spec S01, (#success-criteria, #bug-inventory)

**Tasks:**
- [ ] Verify zero `[phase-3-bug]` entries remain in `contrast-exceptions.ts`
- [ ] Run `bun run audit:tokens pairings` and review the complete pairing output for both recipes — verify zero unresolved pairings and confirm overall pairing coverage is comprehensive after all calibration changes
- [ ] Verify both brio and harmony pass the parameterized recipe contrast validation loop
- [ ] Verify no new unexpected contrast failures were introduced by calibration

**Tests:**
- [ ] `bun test` passes — confirms both recipes pass contrast validation with zero `[phase-3-bug]` entries
- [ ] `bun run audit:tokens lint` passes — confirms all token annotations remain valid after calibration
- [ ] `bun run audit:tokens verify` passes — confirms pairing map and CSS blocks are in sync

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — no unexpected changes
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] `grep '\[phase-3-bug\]' tugdeck/src/__tests__/contrast-exceptions.ts` returns 0 lines

---

#### Step 9: Remove legacy exports and update all imports atomically {#step-9}

**Depends on:** #step-8

**Commit:** `refactor(theme): remove BASE_FORMULAS/OVERRIDES exports and update all imports`

**References:** [D04] Remove base/overrides, [D05] Test cleanup explicit, Spec S01, Spec S02, (#design-decisions, #success-criteria)

**Artifacts:**
- `tugdeck/src/components/tugways/theme-derivation-engine.ts` — remove `BASE_FORMULAS`, `DARK_OVERRIDES`, `LIGHT_OVERRIDES` exports; remove `LIGHT_FORMULAS_LEGACY`; update `EXAMPLE_RECIPES`
- `tugdeck/src/__tests__/theme-derivation-engine.test.ts` — update imports: remove `BASE_FORMULAS`, `DARK_OVERRIDES`, `LIGHT_OVERRIDES` import statements; replace spread references with direct formula objects
- `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` — update string references (test descriptions mentioning old symbol names)
- `tugdeck/src/__tests__/theme-accessibility.test.ts` — update imports if referencing removed exports
- `tugdeck/src/__tests__/contrast-dashboard.test.tsx` — update imports if referencing removed exports
- `tugdeck/src/__tests__/theme-export-import.test.tsx` — update imports if referencing removed exports

**Tasks:**
- [ ] **Phase A — Update test imports first (before removing exports, so tests still compile):**
  - [ ] In `theme-derivation-engine.test.ts`, replace imports of `BASE_FORMULAS`, `DARK_OVERRIDES`, `LIGHT_OVERRIDES` with `DARK_FORMULAS` and `LIGHT_FORMULAS`
  - [ ] Replace `{ ...BASE_FORMULAS, ...DARK_OVERRIDES }` with `DARK_FORMULAS` in test code
  - [ ] Replace `{ ...BASE_FORMULAS, ...LIGHT_OVERRIDES }` with `LIGHT_FORMULAS` in test code
  - [ ] Replace any `LIGHT_OVERRIDES.fieldName` references with `LIGHT_FORMULAS.fieldName`
  - [ ] In `gallery-theme-generator-content.test.tsx`, update test description strings that mention `LIGHT_OVERRIDES` (e.g., lines like `"Harmony borderSignalTone is 40 (LIGHT_OVERRIDES value, not dark default 50)"`) to reference `LIGHT_FORMULAS` instead
  - [ ] For remaining test files (`theme-accessibility.test.ts`, `contrast-dashboard.test.tsx`, `theme-export-import.test.tsx`): search for imports of removed symbols and update if found
  - [ ] Run `bun test` to confirm all tests still pass with old exports still present
- [ ] **Phase B — Remove legacy exports from engine (imports are already updated):**
  - [ ] Remove the `BASE_FORMULAS` export and its JSDoc
  - [ ] Remove the `DARK_OVERRIDES` export and its JSDoc
  - [ ] Remove the `LIGHT_OVERRIDES` export and its JSDoc
  - [ ] Remove `LIGHT_FORMULAS_LEGACY` (temporary comparison object from Step 2)
  - [ ] Update `EXAMPLE_RECIPES.brio.formulas` from `{ ...BASE_FORMULAS, ...DARK_OVERRIDES }` to `DARK_FORMULAS`
  - [ ] Update `EXAMPLE_RECIPES.harmony.formulas` from `{ ...BASE_FORMULAS, ...LIGHT_OVERRIDES }` to `LIGHT_FORMULAS`
  - [ ] Run `bun test` to confirm all tests pass after removal
- [ ] **Phase C — Verification sweep:**
  - [ ] Run `bun run audit:tokens tokens` to verify all 373 `--tug-base-*` tokens are still classified correctly and no orphaned token references exist after removing the legacy exports
  - [ ] Run `bun run audit:tokens pairings` to verify no pairings were affected by the refactor — contrast ratios should be identical to Step 8 checkpoint values
  - [ ] Run `bun run audit:tokens lint` to confirm annotation consistency after the structural removal
  - [ ] Verify no remaining references to removed symbols in any source or test file

**Tests:**
- [ ] `bun test` passes after Phase A (imports updated, exports still present)
- [ ] `bun test` passes after Phase B (exports removed)

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — no unexpected changes
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] `grep -rE 'BASE_FORMULAS|DARK_OVERRIDES|LIGHT_OVERRIDES' tugdeck/src/ --include='*.ts' --include='*.tsx' | grep -v '^\s*//' | grep -v '^\s*\*'` returns 0 matches (excludes single-line and block comments; test description strings must also be updated per Tasks above)

---

#### Step 10: Regenerate CSS documentation {#step-10}

**Depends on:** #step-9

**Commit:** `docs(theme): regenerate CSS @tug-pairings blocks after recipe changes`

**References:** Spec S01, (#verification-workflow, #success-criteria)

**Artifacts:**
- All 23 component CSS files — regenerated `@tug-pairings` comment blocks

**Tasks:**
- [ ] Run `bun run audit:tokens pairings` to see the final pairing state across all 23 CSS files before regeneration — this provides a before-snapshot of all fg-on-bg pairings, contrast values, and roles
- [ ] Run `bun run audit:tokens inject --apply` to regenerate all `@tug-pairings` blocks from the CSS analysis
- [ ] Run `bun run audit:tokens verify` to cross-check the regenerated pairing map against the CSS blocks — this confirms map-to-CSS consistency after regeneration
- [ ] Run `bun run audit:tokens lint` to confirm zero annotation violations
- [ ] Review any changed `@tug-pairings` blocks to verify they reflect recipe changes correctly

**Tests:**
- [ ] `bun test` — all tests pass

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — idempotent (no further changes)
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass

---

#### Step 11: Final integration checkpoint {#step-11}

**Depends on:** #step-8, #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** [D01] literal LIGHT_FORMULAS, [D03] all bugs resolved, [D04] remove base/overrides, [D05] test cleanup, Spec S01, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all success criteria are met
- [ ] Verify zero `[phase-3-bug]` entries in contrast-exceptions.ts
- [ ] Verify LIGHT_FORMULAS is a complete 200-field literal
- [ ] Verify BASE_FORMULAS, DARK_OVERRIDES, LIGHT_OVERRIDES are removed from all source files
- [ ] Verify no test file imports removed symbols
- [ ] Run full verification suite

**Tests:**
- [ ] `bun test` passes — confirms all 1886+ tests pass end-to-end
- [ ] `bun run audit:tokens lint` passes — confirms annotation integrity
- [ ] `bun run audit:tokens verify` passes — confirms pairing map and CSS blocks are in sync

**Checkpoint:**
- [ ] `bun run audit:tokens lint` — exits 0
- [ ] `bun run audit:tokens pairings` — exits 0
- [ ] `bun run audit:tokens inject --apply` — idempotent (no changes)
- [ ] `bun run audit:tokens verify` — exits 0
- [ ] `bun test` — all tests pass
- [ ] `grep '\[phase-3-bug\]' tugdeck/src/__tests__/contrast-exceptions.ts` returns 0
- [ ] `grep -rE 'BASE_FORMULAS|DARK_OVERRIDES|LIGHT_OVERRIDES' tugdeck/src/` returns 0 (excluding comments)

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** Both brio (dark) and harmony (light) are fully independent, self-contained recipes that pass contrast validation with zero `[phase-3-bug]` exceptions, and the base/override abstraction is removed.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `LIGHT_FORMULAS` is a literal 200-field object with design-rationale annotations (no spread)
- [ ] `BASE_FORMULAS`, `DARK_OVERRIDES`, `LIGHT_OVERRIDES` exports removed from `theme-derivation-engine.ts`
- [ ] Zero `[phase-3-bug]` entries in `contrast-exceptions.ts` (`grep` returns 0)
- [ ] `bun test` passes (all tests)
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun run audit:tokens verify` exits 0
- [ ] No test file imports `BASE_FORMULAS`, `DARK_OVERRIDES`, or `LIGHT_OVERRIDES`

**Acceptance tests:**
- [ ] `bun test` — all 1886+ tests pass
- [ ] Parameterized recipe contrast validation loop passes for both brio and harmony with zero unexpected failures

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 4: Formula de-duplication (reduce 200 fields to ~13 semantic decisions)
- [ ] Phase 4: Dark/stark and light/stark recipe variants
- [ ] Phase 4: Theme Generator slider improvements (expose meaningful recipe parameters)
- [ ] Any `[phase-4-engine]` items deferred from Step 7 (if any bugs required engine-level changes)

| Checkpoint | Verification |
|------------|--------------|
| Standalone LIGHT_FORMULAS | `LIGHT_FORMULAS` is literal object, 200 fields, no spread |
| Zero phase-3-bugs | `grep '\[phase-3-bug\]' contrast-exceptions.ts` returns 0 |
| Clean removal | `grep -rE 'BASE_FORMULAS\|DARK_OVERRIDES\|LIGHT_OVERRIDES' tugdeck/src/` returns 0 |
| Audit tooling green | `bun run audit:tokens lint && bun run audit:tokens verify` both exit 0 |
| All tests pass | `bun test` exits 0 |
