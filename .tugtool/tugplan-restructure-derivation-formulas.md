## Restructure DerivationFormulas by Semantic Decision Groups {#restructure-derivation-formulas}

**Purpose:** Reorder the fields within the `DerivationFormulas` interface and `DARK_FORMULAS` constant so they are grouped by the 23 semantic decision groups, with banner-style section header comments describing each group's purpose and dark-vs-light polarity.

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

Part 2 of the Semantic Formula Architecture (now merged) annotated every field in `DerivationFormulas` with `@semantic <group>` JSDoc tags, linking each field to one of 23 semantic decision groups. The module JSDoc table at lines 46-233 of `theme-derivation-engine.ts` enumerates all 23 groups in a deliberate sequence. However, the fields within the interface are still organized by their old token-category grouping (surface tones, foreground tones, text intensities, etc.) rather than by semantic decision. This means a recipe author looking at the interface sees fields from the same semantic group scattered across multiple sections.

Part 3 of the roadmap calls for reordering the fields so they are physically grouped by semantic decision group, with section header comments describing each group. This is a pure structural reorder — no fields added or removed, no behavioral change, identical token output.

#### Strategy {#strategy}

- Use the module JSDoc table order (lines 46-233) as the canonical group ordering — all 23 groups in the sequence already established there.
- Reorder fields within `DerivationFormulas` so each semantic group forms a contiguous block.
- Add two-line banner comments before each group: `// ===== Group Name =====` followed by a description line noting what the group controls and its dark-vs-light polarity.
- Preserve all existing `@semantic` JSDoc tags exactly as-is on each field.
- Reorder the corresponding fields in `DARK_FORMULAS` to match the new interface order.
- Verify token output is byte-identical before and after.

#### Success Criteria (Measurable) {#success-criteria}

- All fields in `DerivationFormulas` are grouped by semantic decision, matching the module JSDoc table order (`git diff` shows only reordering and new section comments, no field additions or removals)
- All fields in `DARK_FORMULAS` are in the same order as `DerivationFormulas` (`git diff` confirms matching order)
- `bun run generate:tokens` produces identical output (diff of `tug-base.css` is empty)
- `cd tugdeck && bun test` passes with no failures
- TypeScript compiles with no errors (`cd tugdeck && bun run build` or `bunx tsc --noEmit`)

#### Scope {#scope}

1. Reorder fields within the `DerivationFormulas` interface by semantic decision group
2. Add banner + description + polarity section comments before each group
3. Reorder fields within `DARK_FORMULAS` to match the interface order
4. Remove old token-category section comments that are superseded by the new semantic group banners

#### Non-goals (Explicitly out of scope) {#non-goals}

- Adding or removing any fields from `DerivationFormulas` or `DARK_FORMULAS`
- Changing any field values in `DARK_FORMULAS`
- Modifying the `@semantic` JSDoc tags (these are preserved as-is from Part 2)
- Reordering `BASE_FORMULAS` (it is an alias for `DARK_FORMULAS`, not independent)
- Reordering `DARK_OVERRIDES` (currently empty)
- Any changes to `derivation-rules.ts` or other files

#### Dependencies / Prerequisites {#dependencies}

- Part 1 (named formula builders + recipe rename) is merged
- Part 2 (semantic layer annotations) is merged — all `@semantic` tags are in place
- The module JSDoc table (lines 46-233) is the authoritative group ordering

#### Constraints {#constraints}

- Token output must be byte-identical before and after — this is a pure structural reorder
- TypeScript interface field order has no runtime effect, but `DARK_FORMULAS` object literal field order must match for readability
- Only one file is modified: `theme-derivation-engine.ts`

#### Assumptions {#assumptions}

- The 23 semantic decision groups in the module JSDoc table are complete and cover all fields in `DerivationFormulas`
- `BASE_FORMULAS = DARK_FORMULAS` is an alias, so reordering `DARK_FORMULAS` automatically reorders `BASE_FORMULAS`
- `DARK_OVERRIDES` is empty and requires no reordering

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Field accidentally dropped during reorder | high | low | Snapshot token output before and diff after; TypeScript compiler will also flag missing fields | Token diff is non-empty or tsc reports errors |
| Field accidentally duplicated during reorder | med | low | TypeScript compiler rejects duplicate fields in interfaces and object literals | tsc reports duplicate property error |

**Risk R01: Dropped or duplicated field during reorder** {#r01-dropped-field}

- **Risk:** A field could be accidentally omitted or duplicated when manually reordering 200 fields.
- **Mitigation:**
  - Snapshot `bun run generate:tokens` output before the change
  - Run `bunx tsc --noEmit` after the change to catch structural errors
  - Diff token output after the change to confirm byte-identical results
- **Residual risk:** None — TypeScript and token diff provide complete coverage.

---

### Design Decisions {#design-decisions}

#### [D01] Group order follows module JSDoc table (DECIDED) {#d01-group-order}

**Decision:** The 23 semantic groups are ordered to match the existing Semantic Decision Groups table in the module JSDoc (lines 46-233 of theme-derivation-engine.ts).

**Rationale:**
- The table was written in a deliberate sequence during Part 2, moving from foundational decisions (canvas, surfaces) through text, borders, controls, and finally dispatch/override groups
- Using the same order in the interface means the JSDoc table serves as a table of contents for the interface

**Implications:**
- Fields that were previously adjacent under token-category grouping (e.g., all surface tones together) may now be separated if they belong to different semantic groups — but in practice, fields within the same group tend to cluster naturally

#### [D02] Banner + description + polarity comment style (DECIDED) {#d02-banner-style}

**Decision:** Each semantic group is introduced with a two-line comment block: a banner line with `=====` delimiters and the group name, followed by a description line noting what it controls and the dark-vs-light polarity of typical values.

**Rationale:**
- The banner line provides a strong visual separator when scanning the interface
- The polarity note gives a recipe author immediate context for what values to expect in dark vs. light recipes
- Matches the style already used in the roadmap document (Part 3 section)

**Implications:**
- Old token-category section comments (e.g., `// Surface tone anchors`, `// Foreground tone anchors`) are replaced by the new semantic group banners
- The `@semantic` JSDoc tags on each field remain as the machine-readable grouping; the banner comments are the human-readable grouping

#### [D03] Preserve existing JSDoc tags exactly (DECIDED) {#d03-preserve-jsdoc}

**Decision:** All `@semantic` JSDoc tags from Part 2 are preserved verbatim. Only the section-level comments change; field-level documentation is untouched.

**Rationale:**
- The `@semantic` tags are the machine-readable grouping mechanism and must remain stable
- Any tool that parses `@semantic` tags should see no change

**Implications:**
- The banner comment group name and the `@semantic` tag group name will match for every field within a section

#### [D04] tabBgActiveHueSlot / tabBgInactiveHueSlot grouped by @semantic tag, not JSDoc table (DECIDED) {#d04-tab-hue-slot-grouping}

**Decision:** The `tabBgActiveHueSlot` and `tabBgInactiveHueSlot` fields are placed in the `hue-slot-dispatch` group (matching their `@semantic hue-slot-dispatch` tags), not in `tab-style` (where the module JSDoc table currently lists them). The module JSDoc table is updated to move these two fields from the `tab-style` entry to the `hue-slot-dispatch` entry.

**Rationale:**
- [D03] establishes that `@semantic` tags are the authoritative grouping mechanism and must not be modified in this phase
- These fields are string hue-slot keys (like all other fields in `hue-slot-dispatch`), not tone/intensity values — they belong with the other hue-slot dispatch fields
- The module JSDoc table listing them under `tab-style` was a classification error in Part 2; the `@semantic` tags on the fields themselves are correct

**Implications:**
- The `tab-style` group in the module JSDoc table loses these two fields, leaving only `tabFgActiveTone`
- The `hue-slot-dispatch` group gains two fields in its enumeration
- The `tab-style` group in the interface and `DARK_FORMULAS` contains only `tabFgActiveTone`

---

### Specification {#specification}

#### Semantic Group Order {#semantic-group-order}

**Table T01: Canonical semantic group order** {#t01-group-order}

The following is the canonical order of the 23 semantic decision groups, matching the module JSDoc table. Each group name is followed by the banner description and polarity note.

| # | Group | Banner description | Polarity note |
|---|-------|--------------------|---------------|
| 1 | canvas-darkness | How dark/light the app background is | Dark: tones 5-10. Light: tones 90-95 |
| 2 | surface-layering | How surfaces stack visually above the canvas | Dark: ascending from ~6. Light: descending from ~95 |
| 3 | surface-coloring | How much chroma surfaces carry | Dark: I 2-7. Light: I 3-8 |
| 4 | text-brightness | How bright primary and inverse text is | Dark: near 100. Light: near 0 |
| 5 | text-hierarchy | How much secondary/tertiary text dims from primary | Dark: descending from 94. Light: ascending from 8 |
| 6 | text-coloring | How much chroma text carries | Dark: I 2-7. Light: I 3-8 |
| 7 | border-visibility | How visible borders and dividers are | Dark: subtle I 4-7. Light: crisp I 6-10 |
| 8 | card-frame-style | How card title bars and tab bars present | Dark: dim tones 15-18. Light: bright tones 85-92 |
| 9 | shadow-depth | How pronounced shadows and overlay tints are | Dark: 20-80% alpha. Light: 10-40% alpha |
| 10 | filled-control-prominence | How bold filled buttons are | Dark: mid-tone bg. Light: same (filled stays vivid) |
| 11 | outlined-control-style | How outlined buttons present across states/modes | Dark: white fg. Light: dark fg |
| 12 | ghost-control-style | How ghost buttons present across states/modes | Dark: white fg. Light: dark fg |
| 13 | badge-style | How tinted badges present | Dark: bright fg on tinted bg. Light: dark fg on tinted bg |
| 14 | icon-style | How icons present in non-control contexts | Dark: bright tones. Light: dark tones |
| 15 | tab-style | How tabs present | Dark: bright active fg. Light: dark active fg |
| 16 | toggle-style | How toggles present | Dark: bright thumb. Light: dark track |
| 17 | field-style | How form fields present | Dark: dark bg tones. Light: light bg tones |
| 18 | hue-slot-dispatch | Which hue slot each surface/fg/icon/border tier reads from | String keys into ResolvedHueSlots |
| 19 | sentinel-hue-dispatch | Which sentinel hue slot hover/active backgrounds use | String keys (__highlight, __verboseHighlight, etc.) |
| 20 | sentinel-alpha | Alpha values for sentinel-dispatched hover/active tokens | Percentage values 5-20 |
| 21 | computed-tone-override | Flat-value overrides for computed tones and formula parameters | number or null |
| 22 | hue-name-dispatch | Named hue values for resolveHueSlots() branch elimination | String hue names |
| 23 | selection-mode | Selection behavior mode flags and parameters | Mode-specific boolean + numeric |

#### Comment Format {#comment-format}

**Spec S01: Banner comment format** {#s01-banner-format}

Each semantic group begins with a comment block in this exact format:

```
  // ===== <Group Display Name> =====
  // <Description of what it controls>. <Polarity note>.
```

Example:
```typescript
  // ===== Canvas Darkness =====
  // How dark/light the app background is. Dark: tones 5-10. Light: tones 90-95.
```

The display name is the human-readable form of the group identifier (e.g., `canvas-darkness` becomes `Canvas Darkness`). The description and polarity are drawn from Table T01.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.**

#### Step 1: Snapshot baseline token output {#step-1}

**Commit:** `N/A (verification only)`

**References:** [D01] Group order follows module JSDoc table, (#success-criteria, #constraints)

**Artifacts:**
- Saved baseline token output for diffing after the reorder

**Tasks:**
- [ ] Run `cd tugdeck && bun run generate:tokens` and save the generated `tug-base.css` content as the baseline
- [ ] Run `bunx tsc --noEmit` to confirm current state compiles cleanly
- [ ] Run `bun test` to confirm current test suite passes
- [ ] Save a count of fields in `DerivationFormulas` (exactly 200 fields) for post-reorder verification

**Tests:**
- [ ] `cd tugdeck && bun test` passes (baseline confirmation)

**Checkpoint:**
- [ ] `cd tugdeck && bun run generate:tokens` succeeds
- [ ] `cd tugdeck && bunx tsc --noEmit` reports no errors
- [ ] `cd tugdeck && bun test` passes

---

#### Step 2: Reorder DerivationFormulas interface and DARK_FORMULAS by semantic group {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): reorder DerivationFormulas and DARK_FORMULAS by semantic decision group`

**References:** [D01] Group order follows module JSDoc table, [D02] Banner + description + polarity comment style, [D03] Preserve existing JSDoc tags exactly, [D04] tabBgActiveHueSlot/tabBgInactiveHueSlot grouped by @semantic tag, Table T01, Spec S01, (#semantic-group-order, #comment-format)

**Artifacts:**
- Modified `DerivationFormulas` interface in `theme-derivation-engine.ts` with fields reordered into 23 semantic groups, each preceded by a banner comment
- Modified `DARK_FORMULAS` constant in `theme-derivation-engine.ts` with fields reordered to match the interface, with matching banner comments
- Updated module JSDoc table: moved `tabBgActiveHueSlot` and `tabBgInactiveHueSlot` from `tab-style` to `hue-slot-dispatch` per [D04]

**Tasks:**
- [ ] Remove the old token-category section comments from `DerivationFormulas` (e.g., `// Surface tone anchors`, `// Surface intensity`, `// Foreground tone anchors`, etc.)
- [ ] For each of the 23 semantic groups in Table T01 order, insert the two-line banner comment per Spec S01 and move all fields tagged with that group's `@semantic` value into the section
- [ ] Place `tabBgActiveHueSlot` and `tabBgInactiveHueSlot` in the `hue-slot-dispatch` group (matching their `@semantic` tags), per [D04]
- [ ] Verify every `@semantic` tag in the interface maps to exactly one of the 23 groups
- [ ] Verify no field was left behind outside a semantic group section
- [ ] Verify no field appears in two groups (the `@semantic` tag is the single source of truth)
- [ ] Remove the old section comments from `DARK_FORMULAS` (e.g., `// Surface tones`, `// Surface intensities`, `// Foreground tones`, etc.)
- [ ] Reorder the fields in `DARK_FORMULAS` to match the field order in the reordered `DerivationFormulas` interface
- [ ] Add the same two-line banner comments before each group in `DARK_FORMULAS`, per Spec S01
- [ ] Verify all field values in `DARK_FORMULAS` are unchanged — only order and comments differ
- [ ] Update the module JSDoc table to move `tabBgActiveHueSlot` and `tabBgInactiveHueSlot` from the `tab-style` entry to the `hue-slot-dispatch` entry

**Tests:**
- [ ] TypeScript compilation passes — `bunx tsc --noEmit` with no errors (catches dropped/duplicated fields)

**Checkpoint:**
- [ ] `cd tugdeck && bunx tsc --noEmit` reports no errors
- [ ] Every field in `DerivationFormulas` is under exactly one semantic group banner (visual inspection)
- [ ] Field order in `DARK_FORMULAS` matches field order in `DerivationFormulas` (visual inspection)

---

#### Step 3: Integration Checkpoint — verify token output is identical {#step-3}

**Depends on:** #step-2

**Commit:** `N/A (verification only)`

**References:** [D01] Group order follows module JSDoc table, Risk R01, (#success-criteria)

**Tasks:**
- [ ] Run `bun run generate:tokens` and diff the resulting `tug-base.css` against the Step 1 baseline
- [ ] Run `bun test` to confirm all tests still pass
- [ ] Verify the field count in `DerivationFormulas` is still exactly 200

**Tests:**
- [ ] `cd tugdeck && bun test` passes with no failures (post-reorder confirmation)

**Checkpoint:**
- [ ] `cd tugdeck && bun run generate:tokens` produces byte-identical `tug-base.css` (diff is empty)
- [ ] `cd tugdeck && bun test` passes with no failures
- [ ] `cd tugdeck && bunx tsc --noEmit` reports no errors

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** `DerivationFormulas` interface and `DARK_FORMULAS` constant fields reordered by the 23 semantic decision groups, with banner comments describing each group's purpose and dark-vs-light polarity. No fields added or removed. Token output identical.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] All fields in `DerivationFormulas` are grouped by semantic decision, in module JSDoc table order (visual inspection of diff)
- [ ] All fields in `DARK_FORMULAS` match the `DerivationFormulas` field order (visual inspection of diff)
- [ ] `bun run generate:tokens` output is byte-identical to before the change (diff of `tug-base.css` is empty)
- [ ] `bunx tsc --noEmit` reports no errors
- [ ] `bun test` passes with no failures

**Acceptance tests:**
- [ ] `cd tugdeck && bun run generate:tokens && git diff --exit-code styles/tug-base.css` exits 0
- [ ] `cd tugdeck && bunx tsc --noEmit` exits 0
- [ ] `cd tugdeck && bun test` exits 0

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Part 4: Annotate DARK_FORMULAS with design rationale comments
- [ ] Part 5: Create a light recipe from a prompt

| Checkpoint | Verification |
|------------|--------------|
| Token output identical | `bun run generate:tokens && git diff --exit-code styles/tug-base.css` |
| TypeScript compiles | `bunx tsc --noEmit` |
| Tests pass | `bun test` |
