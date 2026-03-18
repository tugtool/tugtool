<!-- tugplan-skeleton v2 -->

## Annotate the Dark Recipe {#annotate-dark-recipe}

**Purpose:** Add inline design rationale comments to every formula field in `DARK_FORMULAS`, explaining why each value was chosen so that humans and LLMs can make informed choices when creating new recipes.

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

Parts 1-3 of the Semantic Formula Architecture are merged. `DARK_FORMULAS` in `theme-derivation-engine.ts` is organized into 23 semantic decision groups with banner comments (e.g., `// ===== Canvas Darkness =====`). Each group has a one-line description of the decision it controls and its dark/light polarity.

What is missing is field-level rationale. `bgAppTone: 5` has no comment explaining *why* 5. `surfaceRaisedTone: 11` has no comment explaining why raised matches sunken. Without these annotations, a recipe author (human or LLM) must reverse-engineer the design intent from bare numbers. Part 4 of the roadmap calls for adding this rationale as inline end-of-line comments on every field.

#### Strategy {#strategy}

- Work through each of the 23 semantic groups in `DARK_FORMULAS` sequentially, adding end-of-line `// comment` annotations to every field
- Comment the first occurrence of a repeated value fully, then use "same across states" shorthand on subsequent identical values within the same group
- For hue slot fields, explain routing rationale (e.g., "canvas slot: app bg uses canvas hue, not atmosphere hue")
- For `null` fields, explain why null is preferred over a hard-coded value
- For numeric tone/intensity values, explain the aesthetic rationale and design intent
- No fields are added or removed, no values change -- this is purely additive inline comments
- Validate that token generation output is identical before and after

#### Success Criteria (Measurable) {#success-criteria}

- Every formula field in `DARK_FORMULAS` (lines ~1000-1267 of `theme-derivation-engine.ts`) has an end-of-line `// comment` (verified by visual inspection and count)
- `bun run generate:tokens` produces identical CSS output before and after (diff the generated token block)
- All existing tests pass: `cd tugdeck && bun test`
- No TypeScript compilation errors: `cd tugdeck && bunx tsc --noEmit`

#### Scope {#scope}

1. Add inline `// comment` annotations to every field in `DARK_FORMULAS` in `tugdeck/src/components/tugways/theme-derivation-engine.ts`
2. Preserve all 23 existing banner comments as-is
3. Verify zero behavioral change via token generation and tests

#### Non-goals (Explicitly out of scope) {#non-goals}

- Annotating `BASE_FORMULAS`, `DARK_OVERRIDES`, or `EXAMPLE_RECIPES` (they are structurally dependent on `DARK_FORMULAS` and need no separate annotation)
- Annotating the `DerivationFormulas` interface (Part 2 already added `@semantic` JSDoc tags there)
- Changing any formula values
- Adding or removing formula fields
- Creating a light recipe (that is Part 5)

#### Dependencies / Prerequisites {#dependencies}

- Parts 1-3 of the Semantic Formula Architecture are merged (confirmed: they are on `main`)
- `DARK_FORMULAS` is organized by 23 semantic groups with banner comments (confirmed in current code)

#### Constraints {#constraints}

- Comments must use end-of-line `// comment` style, not block comments or JSDoc
- Comments must not break TypeScript compilation
- Token output must be byte-identical before and after

#### Assumptions {#assumptions}

- The 23 semantic groups and their banner comments from Part 3 are stable and will not change during this work
- End-of-line comment style (`// comment`) is the correct format per the roadmap Part 4 example

---

### Design Decisions {#design-decisions}

#### [D01] End-of-line inline comments for all annotations (DECIDED) {#d01-inline-comments}

**Decision:** Every formula field gets a `// comment` at the end of the line, matching the style shown in the roadmap Part 4 example.

**Rationale:**
- End-of-line comments keep the value and its rationale on the same line, making it easy to scan
- This matches the existing codebase style for inline annotations
- Block comments or JSDoc would add vertical bulk to an already long constant

**Implications:**
- Comments must be concise (aim for one short phrase per field)
- Long rationale should be condensed to the essential design intent

#### [D02] First-occurrence-full with same-across-states shorthand (DECIDED) {#d02-repeat-shorthand}

**Decision:** For groups where multiple fields share the same value across interaction states (rest/hover/active), comment the first occurrence with full rationale and mark subsequent ones with "same across states" or similar shorthand.

**Rationale:**
- Reduces repetitive text without losing information
- A recipe author needs to understand the design intent once, then recognize the pattern

**Implications:**
- The first field in a repeated-value group carries the full rationale
- Subsequent fields say e.g., `// same across states` or `// same as rest`

#### [D03] Hue slot comments explain routing rationale (DECIDED) {#d03-hue-routing}

**Decision:** Hue slot string fields (e.g., `bgAppHueSlot: "canvas"`) get comments explaining *why* that slot was chosen, not just restating the value.

**Rationale:**
- Hue slot choices are the most opaque part of the formula set -- a recipe author needs to know *why* bgApp reads from the canvas hue rather than the atmosphere hue
- User answer specifies this: "canvas slot: app bg uses the canvas hue, not the atmosphere hue"

**Implications:**
- Each hue slot field's comment describes the routing decision (e.g., "app bg uses canvas hue for seamless base" rather than just "canvas")

#### [D04] Null fields explain why null is preferred (DECIDED) {#d04-null-rationale}

**Decision:** Fields with `null` values get comments explaining why null is preferred over a hard-coded value.

**Rationale:**
- Null fields delegate to computed or derived values; the rationale for this delegation is important design knowledge
- User answer: "null: let formula derive from surfaceInset; avoids hard-coding a tone that must stay in sync"

**Implications:**
- Each null field's comment explains what the null delegates to and why hard-coding would be fragile

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Comment accidentally breaks syntax | low | low | TypeScript compilation check | tsc reports errors |
| Token output changes | high | very low | Diff generated tokens before/after | generate:tokens diff |

**Risk R01: Accidental syntax break** {#r01-syntax-break}

- **Risk:** A misplaced comment or unclosed string could cause a TypeScript compilation error.
- **Mitigation:** Run `bunx tsc --noEmit` after every batch of annotations. The checkpoint step verifies compilation.
- **Residual risk:** None -- TypeScript compilation is a hard gate.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Capture baseline token output {#step-1}

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #constraints)

**Artifacts:**
- Baseline token snapshot (saved to a temp file for diffing)

**Tasks:**
- [ ] Run `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run generate:tokens` and capture the current state of `tugdeck/styles/tug-base.css` (the generated token block between `@generated:tokens:begin` and `@generated:tokens:end`)
- [ ] Save a copy of the generated block for later comparison (e.g., `cp styles/tug-base.css /tmp/tug-base-before.css`)
- [ ] Run `bunx tsc --noEmit` to confirm clean baseline
- [ ] Run `bun test` to confirm all tests pass

**Tests:**
- [ ] N/A -- baseline capture only, no code changes

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` exits 0
- [ ] Baseline CSS snapshot saved for comparison

---

#### Step 2: Annotate Canvas Darkness, Surface Layering, and Surface Coloring groups {#step-2}

**Depends on:** #step-1

**Commit:** `docs(theme): annotate dark recipe surface groups with design rationale`

**References:** [D01] End-of-line inline comments, [D02] First-occurrence-full shorthand, [D03] Hue slot routing rationale, (#context, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` -- inline comments on all fields in the Canvas Darkness, Surface Layering, and Surface Coloring groups

**Tasks:**
- [ ] Add end-of-line `// comment` to each field in the `===== Canvas Darkness =====` group (2 fields: `bgAppTone`, `bgCanvasTone`)
  - Example: `bgAppTone: 5, // near-black: deep immersive app background`
- [ ] Add end-of-line `// comment` to each field in the `===== Surface Layering =====` group (7 fields: `surfaceSunkenTone` through `surfaceScreenTone`)
  - Explain the tone stacking logic and why raised matches sunken in the dark recipe
- [ ] Add end-of-line `// comment` to each field in the `===== Surface Coloring =====` group (10 fields: `atmI` through `bgAppSurfaceI`)
  - Explain the low-chroma rationale for dark surfaces

**Tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` -- confirms comments do not break syntax

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0

---

#### Step 3: Annotate Text Brightness, Text Hierarchy, and Text Coloring groups {#step-3}

**Depends on:** #step-2

**Commit:** `docs(theme): annotate dark recipe text groups with design rationale`

**References:** [D01] End-of-line inline comments, [D02] First-occurrence-full shorthand, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` -- inline comments on all fields in the Text Brightness, Text Hierarchy, and Text Coloring groups

**Tasks:**
- [ ] Add end-of-line `// comment` to each field in the `===== Text Brightness =====` group (2 fields: `fgDefaultTone`, `fgInverseTone`)
- [ ] Add end-of-line `// comment` to each field in the `===== Text Hierarchy =====` group (4 fields: `fgMutedTone` through `fgPlaceholderTone`)
  - Explain the wide hierarchy spread and what each tier signals
- [ ] Add end-of-line `// comment` to each field in the `===== Text Coloring =====` group (7 fields: `txtI` through `fgOnSuccessI`)
  - Explain low-chroma text rationale

**Tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` -- confirms comments do not break syntax

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0

---

#### Step 4: Annotate Border Visibility, Card Frame, and Shadow Depth groups {#step-4}

**Depends on:** #step-3

**Commit:** `docs(theme): annotate dark recipe border, card frame, and shadow groups`

**References:** [D01] End-of-line inline comments, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` -- inline comments on all fields in the Border Visibility, Card Frame Style, and Shadow Depth groups

**Tasks:**
- [ ] Add end-of-line `// comment` to each field in the `===== Border Visibility =====` group (7 fields: `borderIBase` through `dividerMutedI`)
- [ ] Add end-of-line `// comment` to each field in the `===== Card Frame Style =====` group (4 fields: `cardFrameActiveI` through `cardFrameInactiveTone`)
- [ ] Add end-of-line `// comment` to each field in the `===== Shadow Depth =====` group (8 fields: `shadowXsAlpha` through `overlayHighlightAlpha`)

**Tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` -- confirms comments do not break syntax

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0

---

#### Step 5: Annotate Filled, Outlined, and Ghost Control groups {#step-5}

**Depends on:** #step-4

**Commit:** `docs(theme): annotate dark recipe control groups with design rationale`

**References:** [D01] End-of-line inline comments, [D02] First-occurrence-full shorthand, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` -- inline comments on all fields in the Filled Control Prominence, Outlined Control Style, and Ghost Control Style groups

**Tasks:**
- [ ] Add end-of-line `// comment` to each field in the `===== Filled Control Prominence =====` group (3 fields: `filledBgDarkTone` through `filledBgActiveTone`)
- [ ] Add end-of-line `// comment` to each field in the `===== Outlined Control Style =====` group (21 fields: `outlinedFgRestTone` through `outlinedBgActiveAlphaValue`)
  - Comment the first dark-mode field fully; mark `*Light` variants with "light-mode counterpart: same intent, inverted polarity"
  - Apply [D02] same-across-states shorthand for repeated rest/hover/active values
- [ ] Add end-of-line `// comment` to each field in the `===== Ghost Control Style =====` group (24 fields: `ghostFgRestTone` through `ghostIconActiveILight`)
  - Same pattern: first occurrence full, then same-across-states, light variants note inverted polarity

**Tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` -- confirms comments do not break syntax

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0

---

#### Step 6: Annotate Badge, Icon, Tab, Toggle, and Field groups {#step-6}

**Depends on:** #step-5

**Commit:** `docs(theme): annotate dark recipe badge, icon, tab, toggle, and field groups`

**References:** [D01] End-of-line inline comments, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` -- inline comments on all fields in the Badge Style, Icon Style, Tab Style, Toggle Style, and Field Style groups

**Tasks:**
- [ ] Add end-of-line `// comment` to each field in the `===== Badge Style =====` group (8 fields: `badgeTintedFgI` through `badgeTintedBorderAlpha`)
- [ ] Add end-of-line `// comment` to each field in the `===== Icon Style =====` group (3 fields: `iconActiveTone` through `iconMutedTone`)
- [ ] Add end-of-line `// comment` to each field in the `===== Tab Style =====` group (1 field: `tabFgActiveTone`)
- [ ] Add end-of-line `// comment` to each field in the `===== Toggle Style =====` group (3 fields: `toggleTrackOnHoverTone` through `toggleTrackDisabledI`)
- [ ] Add end-of-line `// comment` to each field in the `===== Field Style =====` group (8 fields: `fieldBgRestTone` through `disabledBorderI`)

**Tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` -- confirms comments do not break syntax

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0

---

#### Step 7: Annotate Hue Slot Dispatch, Sentinel Hue Dispatch, Sentinel Alpha, Computed Tone Override, Hue Name Dispatch, and Selection Mode groups {#step-7}

**Depends on:** #step-6

**Commit:** `docs(theme): annotate dark recipe dispatch, sentinel, override, and selection groups`

**References:** [D01] End-of-line inline comments, [D03] Hue slot routing rationale, [D04] Null field rationale, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` -- inline comments on all fields in the remaining 6 groups

**Tasks:**
- [ ] Add end-of-line `// comment` to each field in the `===== Hue Slot Dispatch =====` group (30 fields: `bgAppHueSlot` through `tabBgInactiveHueSlot`)
  - Each comment explains why this surface/element reads from its chosen hue slot per [D03]
- [ ] Add end-of-line `// comment` to each field in the `===== Sentinel Hue Dispatch =====` group (9 fields: `outlinedBgHoverHueSlot` through `highlightHoverHueSlot`)
  - Explain why sentinel hue slots are used for hover/active states
- [ ] Add end-of-line `// comment` to each field in the `===== Sentinel Alpha =====` group (11 fields: `tabBgHoverAlpha` through `ghostDangerBgActiveAlpha`)
- [ ] Add end-of-line `// comment` to each field in the `===== Computed Tone Override =====` group (15 fields: `dividerDefaultToneOverride` through `borderStrongToneValue`)
  - For `null` fields, explain why null is preferred per [D04]
- [ ] Add end-of-line `// comment` to each field in the `===== Hue Name Dispatch =====` group (7 fields: `surfScreenHue` through `selectionInactiveHue`)
  - Explain the specific hue choice rationale
- [ ] Add end-of-line `// comment` to each field in the `===== Selection Mode =====` group (4 fields: `selectionInactiveSemanticMode` through `selectionBgInactiveAlpha`)

**Tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` -- confirms comments do not break syntax

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0

---

#### Step 8: Final verification checkpoint {#step-8}

**Depends on:** #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #constraints)

**Tasks:**
- [ ] Run `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run generate:tokens` and diff the generated token block against the baseline snapshot from Step 1
- [ ] Verify the diff is empty (zero behavioral change)
- [ ] Run `bun test` to confirm all tests still pass
- [ ] Visually confirm every field in `DARK_FORMULAS` has an end-of-line comment (scan lines ~1000-1267)

**Tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` -- full test suite confirms no regressions

**Checkpoint:**
- [ ] `diff /tmp/tug-base-before.css /Users/kocienda/Mounts/u/src/tugtool/tugdeck/styles/tug-base.css` shows no changes in the generated token block
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` exits 0
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** `DARK_FORMULAS` in `theme-derivation-engine.ts` fully annotated with design rationale inline comments on every formula field, organized by the 23 semantic decision groups.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Every formula field in `DARK_FORMULAS` has an end-of-line `// comment` (visual inspection)
- [ ] All 23 semantic groups are annotated -- none skipped
- [ ] Token generation output is byte-identical before and after (`bun run generate:tokens` + diff)
- [ ] TypeScript compiles cleanly (`bunx tsc --noEmit` exits 0)
- [ ] All tests pass (`bun test` exits 0)

**Acceptance tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` exits 0
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` exits 0
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run generate:tokens` produces identical output

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Part 5: Create a Light Recipe from a Prompt (uses these annotations as the example for LLM recipe generation)
- [ ] Consider annotating `BASE_FORMULAS` separately if it diverges from `DARK_FORMULAS` in the future

| Checkpoint | Verification |
|------------|--------------|
| TypeScript compiles | `bunx tsc --noEmit` exits 0 |
| Tests pass | `bun test` exits 0 |
| Token output unchanged | `bun run generate:tokens` + diff against baseline |
| All fields annotated | Visual inspection of DARK_FORMULAS block |
