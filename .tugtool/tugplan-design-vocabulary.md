<!-- tugplan-skeleton v2 -->

## Phase 3.5B: Design Vocabulary — Semantic Text Types, Contrast Roles, Recipe Inputs {#phase-35b}

**Purpose:** Establish the design vocabulary for the element plane — semantic text types, updated contrast roles, a card title token, and restructured recipe color inputs — completing the naming convention bridge from Phase 3.5A.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | phase-35b-design-vocabulary |
| Last updated | 2026-03-19 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current theme system treats all text as a single category. The same global text token (`element-global-text-normal-default-rest`) drives card titles, body prose, button labels, and status text. But these serve different design purposes and need independent hue, tone, and contrast control. Phase 3.5A established a systematic naming convention for tokens; this phase completes the picture by defining the semantic text types that drive element plane hue selection and contrast role assignment.

The `ThemeRecipe` interface currently uses a flat structure mixing surface and element concerns — `canvas`, `cardBg`, `text`, `borderTint`, `cardFrame`, `link` — with no separation between planes. The recipe inputs must be reorganized to reflect the surface/element/role architecture established in the naming convention.

#### Strategy {#strategy}

- Define four semantic text types (content, control, display, informational) as the vocabulary for element plane hue selection and contrast role assignment.
- Replace the current three-role contrast system (`body-text`, `ui-component`, `subdued-text`) with a four-role system (`content`, `control`, `display`, `informational`), keeping `decorative` unchanged.
- Restructure `ThemeRecipe` from flat fields to nested `surface`/`element`/`role` groups, removing derived values (`cardFrame`, `link`) and adding new element hues.
- Add a dedicated card title token with its own derivation rule, using the `display` element hue.
- Update all downstream consumers: `resolveHueSlots()`, derivation rules, pairing map, Theme Generator UI, `@tug-pairings` blocks, contrast exceptions.
- Hard break on `cardFrame` and `link` — derive `cardFrame` from `element.border` and derive `link`/`interactive` from `role.action` directly.

#### Success Criteria (Measurable) {#success-criteria}

- `bun run audit:tokens lint` passes with zero errors (all token names valid, no orphans)
- `bun run audit:tokens pairings` passes (all CSS pairings covered in the pairing map)
- `bun run audit:tokens inject --apply` produces no diff (blocks are up to date)
- `bun run audit:tokens verify` passes (all `@tug-pairings` blocks match the map)
- `bun test` passes for all theme-related test suites (derivation engine, accessibility, contrast, export/import, gallery)
- `CONTRAST_THRESHOLDS` map has exactly five roles: `content` (75), `control` (60), `display` (60), `informational` (60), `decorative` (15)
- `ContrastRole` type has five members: `content`, `control`, `display`, `informational`, `decorative`
- `ThemeRecipe` interface has nested `surface`, `element`, `role` groups with 2 + 6 + 7 = 15 hue inputs
- Card title uses its own token (`element-cardTitle-text-normal-plain-rest`) with the `display` element hue
- `EXAMPLE_RECIPES.brio` and `EXAMPLE_RECIPES.harmony` use the new nested structure

#### Scope {#scope}

1. Define semantic text types in code and design documentation
2. Replace contrast role vocabulary and update thresholds
3. Restructure `ThemeRecipe` interface (flat to nested surface/element/role), update `EXAMPLE_RECIPES` (brio and harmony), update `resolveHueSlots()`, and update Theme Generator UI — all in one atomic step to avoid build-breaking intermediate states (the gallery component constructs ThemeRecipe objects and is not excluded from tsc)
4. Update test files for the new recipe structure (test files are excluded from tsc by tsconfig)
5. Add derivation rules for new element hues (control, display, informational, decorative)
6. Add card title token with `display` hue
7. Update pairing map to use new four-role vocabulary
8. Update `@tug-pairings` blocks and contrast exception sets

#### Non-goals (Explicitly out of scope) {#non-goals}

- Migration of persisted/serialized `ThemeRecipe` JSON — this is a hard break, not a migration
- Formula field renaming (that is Phase 3.5C)
- New `DerivationFormulas` fields for the new element hues — the new slots reuse existing formula constants and differ only in which hue slot they reference
- Dark/stark and light/stark recipe variants (Phase 4)
- Emphasis-level formula de-duplication (Phase 4)

#### Dependencies / Prerequisites {#dependencies}

- Phase 3.5A token naming convention must be complete and merged
- Phase 2 contrast engine (two-pass composited enforcement) must be complete and merged

#### Constraints {#constraints}

- All readable text contrast roles must maintain thresholds >= 60 — no reduced thresholds for display or any other text type
- The `decorative` role (threshold 15) is the only role permitted below 60
- `bun run audit:tokens` invariants are non-negotiable gates per D81 (Rules of Tugways)
- Warnings are errors — TypeScript compilation must produce zero warnings

#### Assumptions {#assumptions}

- The new nested `ThemeRecipe` structure is not backward compatible with saved JSON themes or URL-serialized recipes; migration of persisted recipes is out of scope for this phase
- The derivation engine's `DARK_FORMULAS` and `LIGHT_FORMULAS` objects do not need new formula fields for the new element hues — the new slots reuse existing formula constants and differ only in which hue slot they reference
- The `decorative` contrast role (threshold 15) is retained unchanged and is not renamed
- `design-system-concepts.md` changes are documentation only and do not require code changes or test updates
- Current `large-text` pairings are reclassified to `control` — the semantic intent (interactive element labels at large size) maps to the control text type

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors, stable labels, `**Depends on:**` lines, and `**References:**` lines per the skeleton contract. All anchors are kebab-case, no phase numbers. See skeleton for full rules.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] Four semantic text types govern element plane hue selection (DECIDED) {#d01-semantic-text-types}

**Decision:** All text tokens are classified into four semantic types — `content`, `control`, `display`, `informational` — which determine both the element plane hue slot and the contrast role assigned in the pairing map.

**Rationale:**
- The current system uses a single `text` hue for all text tokens, preventing independent color control for different text purposes
- The four types map cleanly to the Phase 3.5A naming convention component axis (global, control, cardTitle, badge)
- Each type has a distinct design purpose: content is prose, control is interactive labels, display is titles/headers, informational is metadata/muted text

**Implications:**
- Every text token must be classified into exactly one of the four types
- The pairing map must assign each text token a role matching its semantic type
- New element hue slots must be added for `control`, `display`, `informational` (and `decorative` for non-text)

#### [D02] All text-type contrast roles maintain high thresholds (DECIDED) {#d02-contrast-thresholds}

**Decision:** All four text-type contrast roles use thresholds >= 60: `content` = 75, `control` = 60, `display` = 60, `informational` = 60. Only `decorative` (non-text ornamental elements) uses threshold 15.

**Rationale:**
- All readable text must have high contrast — card titles must be as legible as body text
- Reducing any text threshold below 60 would compromise legibility
- The `decorative` role is the only appropriate place for reduced contrast because it covers non-text visual marks where contrast is not a legibility concern

**Implications:**
- The `informational` role threshold is 60, not 30 as originally proposed in the roadmap — muted/placeholder text must still be readable
- Some current `subdued-text` (threshold 45) pairings may need tone adjustments to meet the new 60 threshold
- Contrast exception sets must be reviewed after the threshold change

#### [D03] Hard break on ThemeRecipe structure (DECIDED) {#d03-hard-break}

**Decision:** Remove `cardFrame` and `link` entirely from `ThemeRecipe`. Derive `cardFrame` from `element.border` and derive `link`/`interactive` hue from `role.action` directly. Replace the flat hue fields with nested `surface`/`element`/`role` groups.

**Rationale:**
- `cardFrame` is visually an extension of the border system and should not be a separate recipe input
- `link` is text that signals action — its hue comes directly from `role.action`. **Visual change:** Link color will shift from the current explicit cyan (`link: "cyan"` in `EXAMPLE_RECIPES.brio` and `.harmony`) to the `role.action` hue (e.g., `"blue"` in brio). This is intentional — cyan was an arbitrary default; using the action role hue integrates links with the overall semantic color system
- The flat structure mixes planes; the nested structure aligns with the naming convention

**Implications:**
- All code that reads `recipe.cardBg`, `recipe.text`, `recipe.link`, `recipe.cardFrame`, `recipe.borderTint` must be updated to the new paths
- `resolveHueSlots()` must derive `frame` from `element.border` and `interactive` from `role.action` instead of reading them from recipe fields
- The Theme Generator UI must remove the `cardFrame` and `link` hue pickers and replace with derived indicators

#### [D04] Element plane hue strategy: direct recipe inputs with default conventions (DECIDED) {#d04-hue-strategy}

**Decision:** All element hue slots (`control`, `display`, `informational`, `decorative`) are direct recipe inputs read by `resolveHueSlots()`. There is no automatic shifting or derivation — the recipe values are used as-is. The default conventions are: `control` matches content hue, `display` is a warmer hue than content (baked into `EXAMPLE_RECIPES` values — e.g., `"indigo"` at 260 for content `"cobalt"` at 250), `informational` matches `surface.canvas`, `decorative` is near-neutral.

**Rationale:**
- Control text is interactive but should read as part of the same typographic family as content
- Display text (titles, headers) benefits from a subtle warmth shift to distinguish from body text without jarring contrast — the shift is baked into the recipe value (e.g., `"indigo"` at 260 vs `"cobalt"` at 250), not computed at runtime, so recipe authors have full control
- Informational text (metadata, placeholders) blends with the surface — using the canvas hue makes it recede visually
- Decorative marks are structural, not communicative — near-neutral prevents them from competing with semantic content

**Implications:**
- `resolveHueSlots()` reads each element hue directly from the recipe — no automatic computation or shifting
- `EXAMPLE_RECIPES.brio` and `EXAMPLE_RECIPES.harmony` set `element.display` to `"indigo"` (260 degrees), which is +10 degrees warmer than `element.content` (`"cobalt"` at 250 degrees) — the closest clean base hue name to the ~15 degree shift convention. This shift is a recipe authoring convention, not engine behavior

#### [D05] Large-text pairings reclassified to control (DECIDED) {#d05-large-text-reclassification}

**Decision:** All current `large-text` role pairings in the pairing map are reclassified to `control`. The `large-text` role is removed.

**Rationale:**
- The current `large-text` pairings are button labels, tab labels, and other interactive control text — the semantic intent is `control`, not a size-based category
- Size-based contrast roles mix presentation concerns with semantic purpose
- The new four-role vocabulary is purely semantic: content, control, display, informational

**Implications:**
- The `ContrastRole` type loses `large-text` and gains `content`, `control`, `display`, `informational`
- The `CONTRAST_THRESHOLDS` map changes from `large-text: 60` to `control: 60` (same threshold value)
- Test assertions referencing `large-text` must be updated

#### [D06] Card title gets its own token and display hue (DECIDED) {#d06-card-title-token}

**Decision:** Create `element-cardTitle-text-normal-plain-rest` with its own derivation rule using the `display` element hue. Update `tug-card.css` to use this token for `.tugcard-title`.

**Rationale:**
- The card title currently shares the global default text token, giving it no independent color control
- Card titles are "display" text — they are titles, not body prose or interactive labels
- An independent token allows the pairing map to assign the `display` contrast role specifically to card titles

**Implications:**
- A new derivation rule must be added to `derivation-rules.ts`
- A new entry in the pairing map for the card title token on tab surfaces
- `tug-card.css` must reference the new token via a CSS custom property
- `@tug-pairings` and `@tug-renders-on` annotations must be updated

---

### Specification {#specification}

#### Terminology {#terminology}

**Table T01: Semantic Text Types** {#t01-semantic-text-types}

| Type | Purpose | Examples | Element hue source | Contrast role |
|------|---------|---------|-------------------|---------------|
| `content` | Prose, body text, descriptions | Card body, paragraphs, list items | `element.content` | `content` (75) |
| `control` | Interactive element labels | Button text, menu items, tab labels | `element.control` | `control` (60) |
| `display` | Titles, headers, emphasis | Card titles, section headers, hero text | `element.display` | `display` (60) |
| `informational` | Status, metadata, secondary | Badges, timestamps, placeholders, muted text | `element.informational` | `informational` (60) |

**Table T02: Contrast Role Vocabulary** {#t02-contrast-roles}

| Role | Threshold | Purpose | Current equivalent |
|------|-----------|---------|-------------------|
| `content` | 75 | Primary prose text | `body-text` (75) |
| `control` | 60 | Interactive element labels | `large-text` (60) |
| `display` | 60 | Titles, headers | *(new)* |
| `informational` | 60 | Muted/metadata text | `subdued-text` was 45, raised to 60 |
| `decorative` | 15 | Non-text ornamental marks | `decorative` (15, unchanged) |

**Table T03: ThemeRecipe Restructuring** {#t03-recipe-restructuring}

| Old field | New path | Notes |
|-----------|----------|-------|
| `cardBg.hue` | `surface.card` | Intentional flattening: the old `{ hue: string }` wrapper is removed; the new field is a plain string |
| `canvas` | `surface.canvas` | Was optional, now required in group |
| `text.hue` | `element.content` | Intentional flattening: the old `{ hue: string }` wrapper is removed; the new field is a plain string |
| *(new)* | `element.control` | Matches content hue by default |
| *(new)* | `element.display` | `"indigo"` (260) — closest base hue to content + 15 degrees |
| *(new)* | `element.informational` | Matches canvas hue by default |
| `borderTint` | `element.border` | Renamed |
| *(new)* | `element.decorative` | Near-neutral by default |
| `cardFrame` | *(removed — derived)* | Derived from `element.border` |
| `link` | *(removed — derived)* | Derived from `role.action` |
| `accent` | `role.accent` | Moved into group |
| `active` | `role.action` | Renamed to `action` |
| `destructive` | `role.danger` | Renamed to `danger` |
| `agent` | `role.agent` | Moved into group |
| `data` | `role.data` | Moved into group |
| `success` | `role.success` | Moved into group |
| `caution` | `role.caution` | Moved into group |

**Table T04: Pairing Map Role Reassignment** {#t04-pairing-role-reassignment}

| Token pattern | Old role | New role |
|---------------|----------|----------|
| Global default text on surfaces | `body-text` | `content` |
| Muted/subtle/placeholder text | `subdued-text` | `informational` |
| Button/tab/control fg tokens | `large-text` | `control` |
| Card title token (new) | *(none)* | `display` |
| Control icons (button, tab, menu, checkbox, toggle, radio icons) | `ui-component` | `control` |
| Control borders (field borders, outlined control borders) | `ui-component` | `control` |
| Structural borders (global default border, muted border) | `ui-component` | `informational` |
| Badge borders and badge text | `ui-component` | `informational` |
| Tone fills and tone icons (semantic signal indicators) | `ui-component` | `informational` |
| Muted/subtle text tokens (onAccent, inverse, muted, subtle) | `ui-component` | `informational` |
| Toggle tracks and thumbs | `ui-component` | `control` |
| Accent fills (global fill tokens) | `ui-component` | `informational` |
| Decorative dividers, canvas grid | `decorative` | `decorative` |

**Table T05: Derivation Rule hueSlot Mapping** {#t05-hue-slot-mapping}

| Token pattern | Current hueSlot | New hueSlot | Notes |
|---------------|----------------|-------------|-------|
| `element-global-text-normal-default-rest` | `txt` | `content` | Primary body text — renamed slot |
| `element-global-text-normal-muted-rest` | `txt` | `informational` | Muted text uses informational hue |
| `element-global-text-normal-subtle-rest` | `txt` | `informational` | Subtle text uses informational hue |
| `element-global-text-normal-onAccent-rest` | `txt` | `content` | Text on accent surfaces — keeps content hue |
| `element-global-text-normal-inverse-rest` | `txt` | `content` | Inverse text — keeps content hue |
| `element-global-icon-normal-default-rest` | `txt` | `control` | Default icon — interactive context |
| `element-global-icon-normal-muted-rest` | `txt` | `informational` | Muted icon uses informational hue |
| `element-global-icon-normal-active-rest` | `txt` | `control` | Active icon — interactive context |
| `element-global-border-normal-default-rest` | `border` | `border` | No change — border slot unchanged |
| `element-global-border-normal-muted-rest` | `border` | `border` | No change — border slot unchanged |
| `element-control-*` tokens | `txt` or semantic | `control` | Control element tokens use control hue |
| `element-cardTitle-text-normal-plain-rest` | *(new)* | `display` | New card title token |
| `element-badge-*` tokens | semantic | *(unchanged)* | Badge tokens use semantic role hues |
| `element-tone-*` tokens | semantic | *(unchanged)* | Tone tokens use semantic role hues |

**Spec S01: New ThemeRecipe Interface** {#s01-recipe-interface}

```typescript
export interface ThemeRecipe {
  name: string;
  description: string;
  mode: "dark" | "light";

  surface: {
    canvas: string;
    card: string;
  };

  element: {
    content: string;
    control: string;
    display: string;
    informational: string;
    border: string;
    decorative: string;
  };

  role: {
    accent: string;
    action: string;
    agent: string;
    data: string;
    success: string;
    caution: string;
    danger: string;
  };

  surfaceContrast?: number;
  signalIntensity?: number;
  warmth?: number;
  formulas?: DerivationFormulas;
}
```

**Spec S02: Derived Values** {#s02-derived-values}

| Value | Derivation | Implementation in resolveHueSlots() |
|-------|------------|-------------------------------------|
| Frame hue | Same hue as `element.border` | `resolveSlot(recipe.element.border)` — same slot, no new formula needed; formulas control tone/intensity differentiation |
| Interactive/link hue | Use `role.action` hue directly | `resolveSemanticSlot(recipe.role.action)` — the interactive slot resolves from the action role hue alone, not from a combination of two hues. The old `recipe.link` field is removed; `role.action` replaces it as the single source of the interactive/link hue |

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Raising `informational` threshold from 45 to 60 causes many contrast failures | med | high | Review all `subdued-text` pairings; adjust formula tones if needed; update exception sets | More than 10 new contrast failures after threshold change |
| Reclassifying 181 `ui-component` pairings (threshold 30) to `control`/`informational` (threshold 60) causes mass contrast failures | high | high | Split pairings by semantic intent; audit each category before reclassification; adjust formula tones; update exception sets | More than 20 new contrast failures after role reassignment |
| Removing `cardFrame`/`link` from recipe breaks Theme Generator state management | med | med | Systematic grep for all recipe field references before removal; update in single step | TypeScript compilation errors after recipe change |
| New element hue slots produce unexpected colors in edge-case hue families | low | low | Test with multiple hue families beyond indigo-violet; verify +15 degree shift stays in gamut | Visual inspection of non-default recipes |

**Risk R01: Informational threshold increase** {#r01-informational-threshold}

- **Risk:** Raising `informational` (was `subdued-text`) from threshold 45 to 60 may cause many current pairings to fail contrast checks, especially muted/placeholder text.
- **Mitigation:**
  - Audit all current `subdued-text` pairings to identify which ones fall between 45 and 60
  - Adjust formula tone values (`fgMutedTone`, `fgSubtleTone`, `fgPlaceholderTone`) if needed to meet 60
  - Update contrast exception sets to remove entries that are now covered or add new justified exceptions
- **Residual risk:** Some muted text tones may need to be lighter/darker than current design intent to meet threshold 60.

**Risk R02: UI-component threshold doubling** {#r02-ui-component-threshold}

- **Risk:** All 181 `ui-component` pairings currently pass at threshold 30. Reclassifying them to `control` (60) or `informational` (60) doubles the contrast requirement. Muted icon tiers, structural borders, and subtle accent fills likely pass at 30 but fail at 60. This is a far larger threshold jump than the `subdued-text` to `informational` increase.
- **Mitigation:**
  - In Step 1, classify each `ui-component` pairing by semantic intent: interactive control elements (icons on buttons/tabs, field borders, toggle parts) get `control`; structural/informational elements (global borders, badge borders/text, tone fills/icons, accent fills, muted/subtle text) get `informational`
  - Run `bun test -- --grep "contrast"` after each batch of reassignments to identify failures early
  - For pairings that fail at 60, evaluate whether the formula tone should be adjusted (preferred) or an exception added (justified only if the design intent requires reduced contrast)
  - Document the count of pairings moved to each new role and the count of resulting contrast failures in the commit message
- **Residual risk:** Some muted icon and subtle border tones may need formula adjustments that change their visual appearance slightly to meet threshold 60.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

*No open questions. All clarifications have been resolved through user answers and design decisions.*

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| *(none)* | All changes are to existing files |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ContrastRole` | type | `element-surface-pairing-map.ts` | Replace 5 members: `content`, `control`, `display`, `informational`, `decorative` |
| `CONTRAST_THRESHOLDS` | const | `theme-accessibility.ts` | New keys: `content: 75`, `control: 60`, `display: 60`, `informational: 60`, `decorative: 15` |
| `WCAG_CONTRAST_THRESHOLDS` | const | `theme-accessibility.ts` | New keys matching `ContrastRole` values |
| `ThemeRecipe` | interface | `theme-derivation-engine.ts` | Restructured: nested `surface`, `element`, `role` groups |
| `EXAMPLE_RECIPES.brio` | const | `theme-derivation-engine.ts` | Updated to new nested structure |
| `EXAMPLE_RECIPES.harmony` | const | `theme-derivation-engine.ts` | Updated to new nested structure |
| `resolveHueSlots()` | function | `theme-derivation-engine.ts` | Read from nested recipe; derive `frame` and `interactive` |
| `ContrastResult.role` | field | `theme-derivation-engine.ts` | Update type to new `ContrastRole` |
| `element-cardTitle-text-normal-plain-rest` | token | `derivation-rules.ts` | New derivation rule using `display` hue slot |
| `--tug-card-title-fg` | CSS property | `tug-card.css` | New alias referencing card title token |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `design-system-concepts.md` with semantic text type definitions and contrast role table
- [ ] Update JSDoc comments in `theme-derivation-engine.ts` header to reflect new `ThemeRecipe` structure
- [ ] Update JSDoc comments in `element-surface-pairing-map.ts` header to reflect new role vocabulary
- [ ] Update JSDoc comments in `theme-accessibility.ts` to reference new threshold values

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify derivation produces correct hue for each text type | New hue slot tests, threshold checks |
| **Integration** | Verify contrast validation with new roles end-to-end | `validateThemeContrast()` with new pairing map |
| **Golden / Contract** | Verify token output matches expected structure | `deriveTheme()` output token count, token names |
| **Drift Prevention** | Catch regressions in contrast results across recipes | Parameterized recipe test loop |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Update ContrastRole type, CONTRAST_THRESHOLDS, and pairing map roles {#step-1}

**Commit:** `feat(theme): replace contrast role vocabulary and reassign pairing map entries`

**References:** [D01] Four semantic text types, [D02] All text-type contrast roles maintain high thresholds, [D05] Large-text reclassification, Table T02 (#t02-contrast-roles), Table T04 (#t04-pairing-role-reassignment), Risk R02 (#r02-ui-component-threshold)

**Artifacts:**
- Modified `element-surface-pairing-map.ts` — `ContrastRole` type and all `role` fields in `ELEMENT_SURFACE_PAIRING_MAP`
- Modified `theme-accessibility.ts` — `CONTRAST_THRESHOLDS`, `WCAG_CONTRAST_THRESHOLDS`, JSDoc
- Modified `theme-derivation-engine.ts` — `ContrastResult.role` type

**Tasks:**
- [ ] Replace `ContrastRole` type in `element-surface-pairing-map.ts`: remove `body-text`, `subdued-text`, `large-text`, `ui-component`; add `content`, `control`, `display`, `informational`; keep `decorative`
- [ ] Update `CONTRAST_THRESHOLDS` in `theme-accessibility.ts`: `content: 75`, `control: 60`, `display: 60`, `informational: 60`, `decorative: 15`
- [ ] Update `WCAG_CONTRAST_THRESHOLDS` to use new role keys
- [ ] Update `ContrastResult.role` type in `theme-derivation-engine.ts` to match new `ContrastRole`
- [ ] Update all role string literals in comments/JSDoc that reference old role names, including extensive JSDoc in `theme-accessibility.ts` (lines referencing `body-text`, `subdued-text`, `large-text`, `ui-component`)
- [ ] Replace every `role: "body-text"` with `role: "content"` for global default text pairings in `ELEMENT_SURFACE_PAIRING_MAP`
- [ ] Replace every `role: "subdued-text"` with `role: "informational"` for muted/subtle/placeholder pairings
- [ ] Replace every `role: "large-text"` with `role: "control"` for button/tab/control fg pairings
- [ ] Classify each `role: "ui-component"` pairing by semantic intent per Table T04: interactive control elements (control icons on buttons/tabs/menus, field borders, outlined control borders, checkbox/toggle/radio parts, tabClose text) get `role: "control"`; structural/informational elements (global borders, badge borders/text, tone fills/icons, accent fills, muted/subtle/onAccent/inverse text tokens) get `role: "informational"`
- [ ] Run `bun test -- --grep "contrast"` after reassignment to identify failures caused by threshold doubling (30 to 60) per Risk R02; document failure count
- [ ] Keep every `role: "decorative"` unchanged
- [ ] Update section comments in the pairing map to use new role vocabulary

**Tests:**
- [ ] Verify `CONTRAST_THRESHOLDS` has exactly 5 keys with correct values
- [ ] Verify `ContrastRole` type accepts new values and rejects old values (TypeScript compilation)
- [ ] Verify all entries in `ELEMENT_SURFACE_PAIRING_MAP` use only valid `ContrastRole` values (TypeScript compilation)
- [ ] Count of pairings unchanged — same number of entries, just role reassignment

**Checkpoint:**
- [ ] TypeScript compiles with zero errors: `cd tugdeck && npx tsc --noEmit` (note: `tsconfig.json` excludes `**/*.test.ts` and `**/*.test.tsx`, so test assertion mismatches do not block this checkpoint — those are fixed in Step 2)
- [ ] `bun run audit:tokens lint` passes

---

#### Step 2: Update contrast exception sets and test assertions {#step-2}

**Depends on:** #step-1

**Commit:** `fix(theme): update contrast exceptions and test assertions for new role vocabulary`

**References:** [D02] Contrast thresholds, [D05] Large-text reclassification, Risk R01 (#r01-informational-threshold)

**Artifacts:**
- Modified `contrast-exceptions.ts` — role name strings in exception entries
- Modified `theme-accessibility.test.ts` — role name assertions
- Modified `theme-derivation-engine.test.ts` — role name assertions
- Modified `contrast-dashboard.test.tsx` — role name assertions
- Modified `gallery-theme-generator-content.test.tsx` — role name assertions
- `src/__tests__/debug-contrast.test.ts` — uses dynamic `CONTRAST_THRESHOLDS` lookup so requires no changes

**Tasks:**
- [ ] Update all role string literals in `contrast-exceptions.ts` from old names to new names
- [ ] Update all test assertions that reference contrast role names across the test suite
- [ ] Review exception sets: remove entries that are now resolved by threshold changes; add justified exceptions for pairings that fail at the new `informational` threshold of 60 (was `subdued-text` at 45)
- [ ] Update any test expectations for contrast pass/fail counts that change due to threshold adjustments

**Tests:**
- [ ] All existing contrast tests pass with updated role names
- [ ] Exception set sizes are verified (documented justification for any new exceptions)

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "contrast"` passes
- [ ] `cd tugdeck && bun test -- --grep "accessibility"` passes

---

#### Step 3: Integration Checkpoint — Contrast Role Migration {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `N/A (verification only)`

**References:** [D01] Semantic text types, [D02] Contrast thresholds, [D05] Large-text reclassification, (#success-criteria)

**Tasks:**
- [ ] Verify the full contrast role migration is complete and consistent

**Tests:**
- [ ] All theme-related tests pass end-to-end

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit`
- [ ] `cd tugdeck && bun test`
- [ ] `bun run audit:tokens lint`
- [ ] `bun run audit:tokens pairings`

---

#### Step 4: Restructure ThemeRecipe interface, EXAMPLE_RECIPES, resolveHueSlots, ResolvedHueSlots, and Theme Generator UI {#step-4}

**Depends on:** #step-3

**Commit:** `feat(theme): restructure ThemeRecipe to nested surface/element/role groups`

**References:** [D03] Hard break on ThemeRecipe, [D04] Hue strategy, Spec S01 (#s01-recipe-interface), Spec S02 (#s02-derived-values), Table T03 (#t03-recipe-restructuring)

**Artifacts:**
- Modified `theme-derivation-engine.ts` — `ThemeRecipe` interface, `EXAMPLE_RECIPES`, `resolveHueSlots()` function, `ResolvedHueSlots` type
- Modified `gallery-theme-generator-content.tsx` — hue picker groupings, state management, recipe construction, `validateRecipeJson()`

Note: `gallery-theme-generator-content.tsx` constructs `ThemeRecipe` objects and is NOT excluded from `tsc --noEmit` (only `**/*.test.ts` and `**/*.test.tsx` are excluded by `tsconfig.json`). The gallery component MUST be updated in this step alongside the interface change to avoid a build-breaking intermediate state.

**Tasks:**

*ThemeRecipe interface and EXAMPLE_RECIPES:*
- [ ] Replace the `ThemeRecipe` interface with the nested structure from Spec S01
- [ ] Update `EXAMPLE_RECIPES.brio`: `surface.canvas: "indigo-violet"`, `surface.card: "indigo-violet"`, `element.content: "cobalt"`, `element.control: "cobalt"`, `element.display: "indigo"` (indigo is at 260 degrees, +10 from cobalt at 250 — the closest clean base hue to the +15 convention per [D04]), `element.informational: "indigo-violet"`, `element.border: "indigo-violet"`, `element.decorative: "gray"`, `role.accent: "orange"`, `role.action: "blue"`, `role.agent` / `role.data` / `role.success` / `role.caution` / `role.danger` carry forward existing default hue values
- [ ] Update `EXAMPLE_RECIPES.harmony`: same structure with light mode formulas; `surface.canvas: "indigo-violet"`, `surface.card: "indigo-violet"`, `element.content: "cobalt"`, `element.control: "cobalt"`, `element.display: "indigo"`, `element.informational: "indigo-violet"`, `element.border: "indigo-violet"`, `element.decorative: "gray"`, same role hues as brio, `formulas: LIGHT_FORMULAS`
- [ ] Remove `cardFrame` and `link` from the interface entirely

*resolveHueSlots() and ResolvedHueSlots — must be updated in the same step as the interface to avoid a build-breaking intermediate state:*
- [ ] Update recipe field reads: `recipe.cardBg.hue` becomes `recipe.surface.card`, `recipe.text.hue` becomes `recipe.element.content`, `recipe.canvas` becomes `recipe.surface.canvas`, `recipe.borderTint` becomes `recipe.element.border`
- [ ] Derive `cardFrame` slot from `recipe.element.border` (same hue as border, formulas control tone/intensity)
- [ ] Derive `interactive` slot: use `recipe.role.action` as the interactive hue (see Spec S02); the existing `interactive` slot already resolves from a single hue — change it from reading `recipe.link` to reading `recipe.role.action`
- [ ] Add new hue slot resolution for `control` (from `recipe.element.control`), `display` (from `recipe.element.display`), `informational` (from `recipe.element.informational`), `decorative` (from `recipe.element.decorative`) — all read directly from the recipe, no automatic shifting
- [ ] Add `control`, `display`, `informational`, `decorative` fields to the `ResolvedHueSlots` interface
- [ ] Remove reads of `recipe.cardFrame` and `recipe.link`

*gallery-theme-generator-content.tsx — all four recipe field read sites (must be updated atomically with the interface):*
- [ ] Update the `runDerive` callback: change recipe construction from flat fields to nested `surface`/`element`/`role` structure
- [ ] Update the `currentRecipe` useMemo: change recipe assembly from flat fields to nested structure
- [ ] Update the `handleRecipeImported` handler: change recipe field destructuring from flat to nested paths
- [ ] Update the `loadPreset` handler: change recipe field reads from flat to nested paths
- [ ] Rename state variables: `cardBgHue` to `cardHue`, `cardFrameHue` removed (derived), `borderTintHue` to `borderHue`, `linkHue` removed (derived); add new state variables for `controlHue`, `displayHue`, `informationalHue`, `decorativeHue`
- [ ] Rewrite `validateRecipeJson()` to validate the new nested structure (check for `surface.canvas`, `surface.card`, `element.content`, etc. instead of old flat `cardBg`, `text` fields)
- [ ] Update `runDerive` parameter list: replace the individual flat hue/knob parameters with the new nested recipe fields — remove `cardFrame` and `link` params, add `controlHue`, `displayHue`, `informationalHue`, `decorativeHue` params; update the `ThemeRecipe` construction inside the callback to use nested `surface`/`element`/`role` structure
- [ ] Update `handleSliderChange` parameter list: mirror the same parameter changes as `runDerive` — it accepts the same individual parameters and forwards them to `runDerive`
- [ ] Update the `useEffect` call site: change the `runDerive(...)` invocation to pass the new parameter list matching the updated signature; update the dependency array to reference new state variables (`controlHue`, `displayHue`, `informationalHue`, `decorativeHue`) and remove `cardFrameHue`, `linkHue`
- [ ] Update all three `MoodSlider` `onChange` calls: each calls `handleSliderChange` with the full parameter list — update to match the new signature
- [ ] Rewrite `STRUCTURAL_TOKENS` map in `gallery-theme-generator-content.tsx`: remove `cardFrame` and `link` keys; rename `cardBg` to `card` (value: `--tug-base-surface-global-primary-normal-default-rest`), rename `borderTint` to `border` (value: `--tug-base-element-global-border-normal-default-rest`), rename `text` to `content` (value: `--tug-base-element-global-text-normal-default-rest`), add `control` (value: `--tug-base-element-global-icon-normal-default-rest`), `display` (value: `--tug-base-element-cardTitle-text-normal-plain-rest` — available after Step 6, use the global default text token as placeholder until then), `informational` (value: `--tug-base-element-global-text-normal-muted-rest`), `decorative` (value: `--tug-base-element-global-border-normal-muted-rest`); split into `SURFACE_TOKENS` and `ELEMENT_TOKENS` sub-maps if the UI column split warrants it
- [ ] Update Theme Generator UI: replace "Structural" column with "Surface" and "Element" columns; update hue picker groupings and `DEFAULT_RECIPE` reference
- [ ] Remove `cardFrame` and `link` hue pickers; add derived-value indicators for frame and link

**Tests:**
- [ ] TypeScript compilation validates the new interface shape
- [ ] `EXAMPLE_RECIPES.brio` and `EXAMPLE_RECIPES.harmony` conform to the new interface
- [ ] `resolveHueSlots()` returns correct angles for all new slots
- [ ] Frame slot angle matches border slot angle
- [ ] Interactive slot uses `role.action` hue (not a separate recipe field)
- [ ] Display slot reads directly from `recipe.element.display` (no automatic +15 shift)
- [ ] `validateRecipeJson()` accepts valid nested recipes and rejects old flat recipes
- [ ] Theme Generator renders with the new column layout

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit`

---

#### Step 5: Update test files for new ThemeRecipe structure {#step-5}

**Depends on:** #step-4

**Commit:** `test(theme): update test files for nested ThemeRecipe structure`

**References:** [D03] Hard break on ThemeRecipe, Spec S01 (#s01-recipe-interface), Table T03 (#t03-recipe-restructuring)

Note: Test files (`**/*.test.ts`, `**/*.test.tsx`) are excluded from `tsc --noEmit` by `tsconfig.json`, so they do not block the Step 4 checkpoint. They are updated separately here to keep the Step 4 commit focused on production code.

**Artifacts:**
- Modified `theme-derivation-engine.test.ts` — all `ThemeRecipe` construction sites updated to nested structure
- Modified `gallery-theme-generator-content.test.tsx` — all `ThemeRecipe` construction sites updated to nested structure
- Modified `theme-export-import.test.tsx` — all `ThemeRecipe` construction sites and `validateRecipeJson` test assertions updated

**Tasks:**
- [ ] Update all `ThemeRecipe` construction sites in `theme-derivation-engine.test.ts` to use nested structure
- [ ] Update all `ThemeRecipe` construction sites in `gallery-theme-generator-content.test.tsx` to use nested structure
- [ ] Update all recipe construction and `validateRecipeJson` assertions in `theme-export-import.test.tsx` to use nested structure

**Tests:**
- [ ] All test files constructing `ThemeRecipe` objects compile and pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "gallery-theme-generator"` passes
- [ ] `cd tugdeck && bun test -- --grep "export-import"` passes
- [ ] `cd tugdeck && bun test -- --grep "derivation"` passes

---

#### Step 6: Add derivation rules for new element hues and card title token {#step-6}

**Depends on:** #step-5

**Commit:** `feat(theme): add derivation rules for control/display/informational/decorative hues and card title token`

**References:** [D01] Semantic text types, [D04] Hue strategy, [D06] Card title token, Table T05 (#t05-hue-slot-mapping)

**Artifacts:**
- Modified `derivation-rules.ts` — new rule entries for element hue tokens
- Modified `tug-card.css` — card title token reference
- New CSS custom property `--tug-card-title-fg` aliasing the card title token

**Tasks:**
- [ ] Add derivation rule for `element-cardTitle-text-normal-plain-rest` using the `display` hue slot with appropriate tone and intensity (same pattern as existing `element-global-text-normal-default-rest` but using `display` hue)
- [ ] Update `filledFg()` helper in `derivation-rules.ts`: change `hueSlot: "txt"` to `hueSlot: "control"` — this helper generates rules for all filled control text and icon tokens (16+ tokens across roles). Note: in current `EXAMPLE_RECIPES`, `element.control` matches `element.content` (both `"cobalt"`), so resolved hue angles are identical — this is a semantic no-op for current recipes, enabling future divergence
- [ ] Update `outlinedFg()` helper in `derivation-rules.ts`: change `hueSlot: "txt"` to `hueSlot: "control"` — this helper generates rules for all outlined/ghost control text and icon tokens (22+ tokens across roles). Same semantic no-op rationale as `filledFg()`
- [ ] Update individual non-helper derivation rules per Table T05: change `hueSlot: "txt"` to `"control"` for global icon tokens (`element-global-icon-*`), change to `"informational"` for muted/subtle text tokens (`element-global-text-normal-muted-rest`, `element-global-text-normal-subtle-rest`), keep `"content"` for default/onAccent/inverse text tokens
- [ ] Review remaining `hueSlot: "txt"` references in `derivation-rules.ts` — any token that is not content text (prose/body), control text (interactive labels), or already using a semantic slot should be reassigned to the appropriate new slot per Table T05
- [ ] Add `--tug-card-title-fg` CSS custom property in `tug-card.css` referencing `--tug-base-element-cardTitle-text-normal-plain-rest`
- [ ] Update `.tugcard-title` `color` to use `var(--tug-card-title-fg)` instead of `var(--tug-card-title-bar-fg)`. Note: `--tug-card-title-bar-fg` remains defined in `tug-card.css` — it is still used by other title-bar elements (close button, menu button, chevron) and must not be removed
- [ ] Update `@tug-renders-on` annotation on `.tugcard-title` to reference the new token

**Tests:**
- [ ] `deriveTheme(EXAMPLE_RECIPES.brio)` produces a token for `element-cardTitle-text-normal-plain-rest`
- [ ] Card title token uses a different hue than body text token (display vs content)

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit`
- [ ] `cd tugdeck && bun test` (hue slot changes in `filledFg()`/`outlinedFg()` alter resolved values when control and content hues diverge in test recipes; run full tests to catch any derivation regressions)
- [ ] `bun run audit:tokens lint`

---

#### Step 7: Add card title pairing and update pairing map for new token {#step-7}

**Depends on:** #step-6

**Commit:** `feat(theme): add card title token pairings to contrast map`

**References:** [D06] Card title token, Table T04 (#t04-pairing-role-reassignment)

**Artifacts:**
- Modified `element-surface-pairing-map.ts` — new pairings for card title token

**Tasks:**
- [ ] Add pairing entries for `element-cardTitle-text-normal-plain-rest` on `surface-tab-primary-normal-plain-active` with role `display`
- [ ] Add pairing entries for `element-cardTitle-text-normal-plain-rest` on `surface-tab-primary-normal-plain-inactive` with role `display`
- [ ] Remove or update old pairings that used `element-global-text-normal-default-rest` on tab surfaces with `body-text` role for the card title context (now covered by the new token)

**Tests:**
- [ ] Pairing map contains entries for the new card title token
- [ ] `validateThemeContrast()` checks the card title against tab surfaces

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit`
- [ ] `bun run audit:tokens pairings`

---

#### Step 8: Update @tug-pairings blocks and contrast exceptions {#step-8}

**Depends on:** #step-6, #step-7

**Commit:** `chore(theme): regenerate @tug-pairings blocks and update exceptions for new roles`

**References:** [D02] Contrast thresholds, Risk R01 (#r01-informational-threshold), (#success-criteria)

**Artifacts:**
- Modified CSS files — `@tug-pairings` blocks regenerated
- Modified `contrast-exceptions.ts` — final exception set review

**Tasks:**
- [ ] Run `bun run audit:tokens inject --apply` to regenerate all `@tug-pairings` blocks
- [ ] Review the diff — verify new card title token appears in `tug-card.css` block
- [ ] Grep all CSS files for old role names (`body-text`, `subdued-text`, `large-text`, `ui-component`) and confirm zero matches: `grep -r "body-text\|subdued-text\|large-text\|ui-component" tugdeck/src/components/tugways/*.css tugdeck/src/components/tugways/cards/*.css` should return no results
- [ ] Review contrast exception sets: identify any new failures from the `informational` threshold increase (45 to 60) that were not caught in Step 2
- [ ] Add justified exceptions for any legitimate design-choice pairings that fail at the higher threshold
- [ ] Run `bun run generate:tokens` to regenerate `tug-base.css` with the new card title token

**Tests:**
- [ ] `@tug-pairings` blocks are consistent with the pairing map
- [ ] No unexpected contrast failures

**Checkpoint:**
- [ ] `bun run audit:tokens inject --apply` produces no diff (idempotent)
- [ ] `bun run audit:tokens verify`
- [ ] `bun run audit:tokens lint`
- [ ] `bun run audit:tokens pairings`

---

#### Step 9: Update design-system-concepts.md {#step-9}

**Depends on:** #step-1

**Commit:** `docs: add semantic text types and updated contrast roles to design system concepts`

**References:** [D01] Semantic text types, [D02] Contrast thresholds, Table T01 (#t01-semantic-text-types), Table T02 (#t02-contrast-roles)

**Artifacts:**
- Modified `roadmap/design-system-concepts.md` — semantic text type definitions and contrast role table

**Tasks:**
- [ ] Add a "Semantic Text Types" section defining content, control, display, informational with purpose and examples
- [ ] Update the contrast roles section to use the new four-role vocabulary with thresholds
- [ ] Remove references to `body-text`, `subdued-text`, `large-text`, `ui-component` role names

**Tests:**
- [ ] Documentation-only change; no code tests required

**Checkpoint:**
- [ ] File is well-formed Markdown with no broken links

---

#### Step 10: Final Integration Checkpoint {#step-10}

**Depends on:** #step-3, #step-5, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** [D01] Semantic text types, [D02] Contrast thresholds, [D03] Hard break, [D04] Hue strategy, [D05] Large-text reclassification, [D06] Card title token, (#success-criteria)

**Tasks:**
- [ ] Verify all success criteria are met
- [ ] Visual inspection of Theme Generator with both brio and harmony recipes
- [ ] Verify card title uses display hue (visually distinct from body text)

**Tests:**
- [ ] Full test suite passes

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit`
- [ ] `cd tugdeck && bun test`
- [ ] `bun run audit:tokens lint`
- [ ] `bun run audit:tokens pairings`
- [ ] `bun run audit:tokens inject --apply` (no diff)
- [ ] `bun run audit:tokens verify`
- [ ] `bun run generate:tokens` (no unexpected diff)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A theme system with semantic text type vocabulary, four-role contrast enforcement, restructured recipe inputs, and an independent card title token — completing the design vocabulary layer of the element plane.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `ContrastRole` type has five members: `content`, `control`, `display`, `informational`, `decorative`
- [ ] `CONTRAST_THRESHOLDS` map: `content: 75`, `control: 60`, `display: 60`, `informational: 60`, `decorative: 15`
- [ ] `ThemeRecipe` uses nested `surface`/`element`/`role` structure with 15 hue inputs
- [ ] `EXAMPLE_RECIPES.brio` and `EXAMPLE_RECIPES.harmony` use new structure
- [ ] Card title has its own token with `display` hue and `display` contrast role
- [ ] `cardFrame` and `link` are derived, not recipe inputs
- [ ] Theme Generator UI shows Surface/Element/Roles groupings
- [ ] All audit-tokens commands pass
- [ ] Full test suite passes

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run audit:tokens lint` — zero errors
- [ ] `bun run audit:tokens pairings` — all CSS pairings covered
- [ ] `bun run audit:tokens verify` — all `@tug-pairings` blocks consistent
- [ ] `bun run audit:tokens inject --apply` — no diff

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 3.5C: Spell out formula field abbreviations
- [ ] Phase 4: Recipe clarity and generator improvements (emphasis-level de-duplication, stark recipes)
- [ ] Migration utility for persisted ThemeRecipe JSON (if needed)
- [ ] Extend card title token pattern to other display-type headings (section headers, hero text)

| Checkpoint | Verification |
|------------|--------------|
| Contrast role migration | `ContrastRole` type and `CONTRAST_THRESHOLDS` use new vocabulary |
| Recipe restructuring | `ThemeRecipe` has nested `surface`/`element`/`role` groups |
| Card title independence | Card title token exists and uses `display` hue |
| Audit-tokens gate | All four `audit:tokens` subcommands pass |
| Full test suite | `bun test` passes |
