<!-- tugplan v2 -->

## Phase 3.5A: Standardize Element/Surface Token Naming {#phase-token-rename}

**Purpose:** Rename all ~373 `--tug-base-*` tokens to the finalized six-slot naming convention (`<plane>-<component>-<constituent>-<emphasis>-<role>-<state>`), eliminating terminology fragmentation and making element/surface classification mechanical.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | phase-3.5a-token-rename |
| Last updated | 2026-03-19 |
<!-- Revision: overviewer feedback round -->

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current token naming system uses overlapping conventions — `fg-*`, `bg-*`, `control-*-fg-*`, `tab-fg-*`, `tone-*-fg` — making it impossible to mechanically determine whether a token is an element (visible mark) or surface (thing behind it). This blocks reliable automated contrast pairing extraction. Phase 3.5-tooling (now merged) built the rename infrastructure (`rename-map`, `rename --apply`, `rename --verify`). Phase 3.5A executes the actual rename using that tooling.

The seed rename map (`tugdeck/scripts/seed-rename-map.ts`) was written before the naming convention was finalized. It uses draft slot ordering (constituent in slot 5), omits `-rest` for stateless tokens, uses a `chromatic-*` escape hatch for 32 tokens, and has terminology mismatches (`channel` instead of `constituent`). Step 0 updates the seed map to match the finalized convention before any rename execution.

#### Strategy {#strategy}

- Update the seed rename map first (Steps 1-4) to match the finalized six-slot convention before touching any consumer files.
- Generate, preview, and apply the rename mechanically using the audit-tokens tooling — no manual find-and-replace.
- Update tooling scripts (`generate-tug-tokens.ts`, `audit-tokens.ts`) to recognize new `element-`/`surface-` prefixes before regenerating derived files — tooling must understand new names before it processes them.
- Regenerate all derived files (generated CSS, pairing blocks) after tooling is updated to keep the system consistent.
- Verify completeness with `rename --verify` to confirm zero stale references remain.
- Run full verification gates (lint, pairings, verify, tests) after every logical phase.
- Update all documentation as a final step — the phase is not done until docs reflect the new names.
- Commit incrementally: seed map update, rename execution, tooling updates, regeneration, doc updates.

#### Success Criteria (Measurable) {#success-criteria}

- `bun run audit:tokens rename --verify --map token-rename-map.json` exits 0 with zero stale references (`grep -c "old name" output == 0`)
- `bun run audit:tokens lint` exits 0 with zero violations
- `bun run audit:tokens pairings` exits 0 with zero unresolved pairings
- `bun run audit:tokens verify` exits 0 (map-to-CSS consistency)
- `bun test` passes all tests
- Every `--tug-base-*` token in the codebase follows the six-slot pattern `<plane>-<component>-<constituent>-<emphasis>-<role>-<state>`
- No `chromatic-*` token names remain anywhere in the codebase
- Documentation references use new token names and element/surface vocabulary

#### Scope {#scope}

1. Update `seed-rename-map.ts` to finalized six-slot convention (slot reorder, `-rest` suffix, semantic fixes, chromatic-to-six-slot conversion)
2. Generate and apply the mechanical rename across all ~80+ files (including ~16 test files with token references)
3. Update `derivation-rules.ts` template literal base strings that construct ~209 token names dynamically and are not caught by `rename --apply`
4. Update tooling scripts (`generate-tug-tokens.ts` grouping/sorting, `audit-tokens.ts` classification/chromatic removal) to recognize new naming prefixes
5. Regenerate derived files (generated CSS, `@tug-pairings` blocks)
6. Verify rename completeness and run full verification gates
7. Update all documentation (roadmaps, design-system-concepts.md, code comments) to use new names and element/surface vocabulary

#### Non-goals (Explicitly out of scope) {#non-goals}

- Adding new tokens or removing existing tokens — this is a pure rename
- Changing derivation formulas, contrast thresholds, or recipe definitions
- Phase 3.5B work (semantic text types, contrast roles, recipe input restructuring)
- Changing component alias token names (`--tug-card-*`, `--tug-tab-*`) beyond updating their `var()` references to point to renamed base tokens

#### Dependencies / Prerequisites {#dependencies}

- Phase 3.5-tooling fully merged on main with all `audit-tokens` subcommands functional (`rename-map`, `rename --map`, `rename --verify`, `rename --stats`)
- Current `seed-rename-map.ts` has all 373 entries (527 lines)

#### Constraints {#constraints}

- All six slots must always be present — no shortcuts, no omissions
- `-rest` is the state for all non-interactive and default-state tokens
- `disabled` is always a state, never a role; disabled tokens use role=`plain`
- `selected`, `highlighted`, `on`, `off`, `mixed` are roles, not states
- `fill` is an element constituent for solid-color visual marks
- `track` is a surface constituent; `thumb` and `dot` are element constituents
- Shadow sizes (`xs`, `md`, `lg`, `xl`) are roles
- No `chromatic-*` escape hatch — all tokens use six-slot convention

#### Assumptions {#assumptions}

- The `audit-tokens rename --apply` command handles all file types (CSS, TypeScript, test files) for static string token references without manual intervention. It uses word-boundary-aware regex that matches any occurrence of `--tug-base-{old-name}` regardless of surrounding context (CSS declarations, `var()` references, TypeScript string literals, comments) — it does not selectively target specific patterns
- The `audit-tokens rename --apply` does NOT update template literal base strings in `derivation-rules.ts` — these construct ~209 token names dynamically (e.g., `` `--tug-base-control-filled-${role}` ``) and require manual update
- The `audit-tokens rename --verify` command checks all files that could contain token references
- Generated files (`tug-base-generated.css`, `harmony.css`) are fully regenerated by `bun run generate:tokens`
- `@tug-pairings` blocks are regenerated by `bun run audit:tokens inject --apply`
- The `rename --apply` tool's `EXCLUDED_FILES` set (which excludes `audit-tokens.ts` and `seed-rename-map.ts`) means those files must be updated manually in dedicated steps
- `generate-tug-tokens.ts` is NOT in `EXCLUDED_FILES` — `rename --apply` will process it and update any full token name string matches. However, the prefix-matching logic in `getGroup()`, `parseControlToken()`, etc. uses partial prefixes (`bg-`, `fg-`, etc.) that will not be matched by rename. Step 8 handles these manual prefix-logic updates.

---

### Design Decisions {#design-decisions}

#### [D01] All tokens use six-slot convention with no exceptions (DECIDED) {#d01-six-slot-mandatory}

**Decision:** Every structured token follows `<plane>-<component>-<constituent>-<emphasis>-<role>-<state>` with all six slots always present. The `chromatic-*` three-slot convention is eliminated.

**Rationale:**
- Uniform slot count makes mechanical parsing reliable — any tool can split on `-` and know the meaning of each position
- Eliminates the need for special-case handling of chromatic tokens in tooling
- The roadmap explicitly mandates "No shortcuts, no omissions, no exceptions"

**Implications:**
- All 32 formerly-chromatic tokens (toggle tracks, thumbs, radio dots, overlays, highlights, tone fills, accent fills, field tone fills) get proper six-slot names
- Toggle tracks are surfaces (`surface-toggle-track-normal-on-rest`); thumbs and dots are elements (`element-toggle-thumb-normal-plain-rest`)
- Overlays and highlights are surfaces (`surface-overlay-primary-normal-dim-rest`)
- Tone/accent/field-tone fills are elements with `fill` constituent (`element-tone-fill-normal-accent-rest`)

#### [D02] Constituent moves to slot 3 (DECIDED) {#d02-constituent-slot-3}

**Decision:** The constituent slot moves from position 5 (draft convention) to position 3 (finalized convention), placing it immediately after component.

**Rationale:**
- Reads more naturally: `element-control-text-filled-accent-rest` (what component, what part, how styled) vs `element-control-filled-accent-text-rest` (what component, how styled, what part)
- Groups structural identity (plane-component-constituent) before visual modifiers (emphasis-role-state)

**Implications:**
- Every non-identity entry in `seed-rename-map.ts` (~340 entries) must have its new-name slot order updated
- The header comment in `seed-rename-map.ts` must document the corrected slot order

#### [D03] State slot is always present with `-rest` as default (DECIDED) {#d03-rest-always-present}

**Decision:** Every token has a state slot. Non-interactive tokens and interactive tokens in their default state use `-rest`.

**Rationale:**
- Guarantees exactly six slots in every token name, making mechanical parsing trivial
- Eliminates ambiguity about whether a five-slot name is missing state or has a different structure

**Implications:**
- ~90 currently-stateless entries in the seed map gain `-rest` suffix
- Shadow tokens become `element-global-shadow-normal-xs-rest` (not `element-global-shadow-normal-plain-shadow-xs`)

#### [D04] Shadow sizes are roles, not constituents (DECIDED) {#d04-shadow-size-as-role}

**Decision:** Shadow size values (`xs`, `md`, `lg`, `xl`, `overlay`) occupy the role slot. The constituent is `shadow`.

**Rationale:**
- Shadow sizes describe the visual weight/purpose of the shadow, which aligns with role semantics
- Keeps constituent as a structural part-of-component concept (`text`, `icon`, `border`, `shadow`, `divider`, `fill`)

**Implications:**
- `shadow-xs` becomes `element-global-shadow-normal-xs-rest` (constituent=`shadow`, role=`xs`)
- `shadow-overlay` becomes `element-global-shadow-normal-overlay-rest`

#### [D05] Disabled is always a state; on/off/mixed/selected/highlighted are roles (DECIDED) {#d05-state-role-separation}

**Decision:** `disabled` is always a state. `on`, `off`, `mixed`, `selected`, `highlighted` are roles (persistent visual treatments), not states.

**Rationale:**
- Disabled is an interaction state that overrides appearance uniformly regardless of semantic role
- Selected/highlighted/on/off/mixed describe persistent visual treatments that combine cleanly with interaction states (e.g., `surface-control-primary-normal-selected-hover`)

**Implications:**
- `fg-disabled` becomes `element-global-text-normal-plain-disabled` (role=`plain`, state=`disabled`)
- `control-disabled-*` becomes `*-normal-plain-disabled`
- `toggle-track-on-hover` becomes `surface-toggle-track-normal-on-hover` (role=`on`, state=`hover`)
- `control-selected-disabled-bg` becomes `surface-control-primary-normal-selected-disabled` (role=`selected`, state=`disabled`)

#### [D06] Link-hover decomposes into role and state (DECIDED) {#d06-link-hover-decomposition}

**Decision:** The compound `linkHover` is decomposed: `link` is the role, `hover` is the state. `fg-link-hover` becomes `element-global-text-normal-link-hover`.

**Rationale:**
- The naming convention requires state to be in the state slot, not compounded into the role
- `link` + `hover` is a natural decomposition: the role is "link text" and the interaction state is "hover"

**Implications:**
- The seed map entry for `fg-link-hover` changes from `element-global-normal-linkHover-text` to `element-global-text-normal-link-hover`

#### [D07] Field label/placeholder/required are roles (DECIDED) {#d07-field-text-roles}

**Decision:** Within field text tokens, `label`, `placeholder`, and `required` are roles. `disabled` and `readOnly` are states.

**Rationale:**
- Label, placeholder, and required describe what kind of text is displayed — a persistent characteristic, not an interaction state
- Disabled and readOnly are interaction states that the field enters/leaves

**Implications:**
- `field-fg-label` becomes `element-field-text-normal-label-rest`
- `field-fg-disabled` becomes `element-field-text-normal-plain-disabled`
- `field-fg-readOnly` becomes `element-field-text-normal-plain-readOnly`

#### [D08] Terminology standardization: channel becomes constituent (DECIDED) {#d08-channel-to-constituent}

**Decision:** The term `channel` in the seed map header comment is replaced with `constituent` to match the finalized naming convention.

**Rationale:**
- The roadmap uses `constituent` consistently
- `constituent` better describes what the slot means: a structural sub-part of a component

**Implications:**
- Header comment in `seed-rename-map.ts` updated to use `constituent` terminology
- The slot is documented as slot 3 (after component, before emphasis)

#### [D09] Tooling must be updated before regeneration (DECIDED) {#d09-tooling-before-regen}

**Decision:** After `rename --apply` replaces token references across consumer files, `generate-tug-tokens.ts` and `audit-tokens.ts` must be manually updated to recognize new `element-`/`surface-` prefixes before any derived files are regenerated.

**Rationale:**
- `rename --apply` excludes `audit-tokens.ts` and `seed-rename-map.ts` from its file scan (via `EXCLUDED_FILES`)
- `generate-tug-tokens.ts` contains `getGroup()` (lines 88-122) with old prefix matching (`bg-`, `fg-`, `control-disabled-`, etc.) and `parseControlToken()`/`EMPHASIS_ROLE_PATTERN` regexes that hardcode old naming patterns — these will misroute renamed tokens into wrong groups or the `other` bucket
- `audit-tokens.ts` contains `CHROMATIC_TOKENS` set, `classifyToken()` with chromatic branch, `TokenClass` including `chromatic`, and `RENAME_MAP` with old mappings — these will produce incorrect classification after rename
- Running `bun run generate:tokens` or `bun run audit:tokens` with stale tooling would produce incorrectly grouped CSS or false classification results

**Implications:**
- A dedicated step updates `generate-tug-tokens.ts` grouping/sorting logic after rename-apply but before regeneration
- A dedicated step updates `audit-tokens.ts` classification, removes chromatic code paths, and updates internal `RENAME_MAP`
- An integration checkpoint verifies both tooling scripts work correctly with new token names before regeneration proceeds

#### [D10] derivation-rules.ts template literals require manual update (DECIDED) {#d10-derivation-rules-manual}

**Decision:** After `rename --apply` updates static token strings across the codebase, `derivation-rules.ts` must be manually updated in a dedicated step because its ~209 dynamically-constructed token names use template literal base strings that regex-based rename cannot match.

**Rationale:**
- `derivation-rules.ts` is the upstream source of truth for `deriveTheme()` — it defines all 373 token names (164 static + ~209 via template literals)
- Template literals like `` `--tug-base-control-filled-${role}` `` expand to full token names at runtime, but the file content contains `${base}-bg-rest` fragments that do not match the rename tool's regex patterns
- If template literal bases are not updated, `deriveTheme()` will output OLD token names while all consumer files expect NEW names, causing a silent mismatch

**Implications:**
- 7 template-literal-generating functions must be updated: `semanticToneFamilyRules()`, `filledRoleRules()`, `outlinedFgRules()`, `outlinedOptionBorderRules()`, `ghostFgRules()`, `ghostDangerRules()`, `badgeTintedRoleRules()`
- Each function's `base` string must change from old prefix (e.g., `--tug-base-control-filled-${role}`) to new six-slot prefix (e.g., `` `--tug-base-element-control-text-filled-${role}` `` for fg tokens, etc.)
- The 164 static string references will be caught by `rename --apply` in Step 7
- The template literal updates are done in the same step (Step 7 Part B) to avoid a known-broken commit where `deriveTheme()` would output old token names

---

### Specification {#specification}

#### Naming Convention Specification {#naming-convention-spec}

**Spec S01: Six-Slot Token Name Format** {#s01-six-slot-format}

```
<plane>-<component>-<constituent>-<emphasis>-<role>-<state>
```

| Slot | Position | Values |
|------|----------|--------|
| plane | 1 | `element`, `surface` |
| component | 2 | `global`, `control`, `tab`, `tabClose`, `tone`, `field`, `badge`, `selection`, `checkmark`, `toggle`, `radio`, `overlay`, `highlight` |
| constituent | 3 | Element: `text`, `icon`, `border`, `shadow`, `divider`, `fill`, `thumb`, `dot`. Surface: `primary`, `track` |
| emphasis | 4 | `normal`, `filled`, `outlined`, `ghost`, `tinted` |
| role | 5 | `default`, `muted`, `subtle`, `accent`, `action`, `danger`, `success`, `caution`, `agent`, `data`, `active`, `plain`, `selected`, `highlighted`, `on`, `off`, `mixed`, `link`, `inverse`, `onAccent`, `onDanger`, `onSuccess`, `onCaution`, `placeholder`, `label`, `required`, `strong`, `separator`, `xs`, `md`, `lg`, `xl`, `overlay`, `dim`, `scrim`, `highlight`, `hover`, `dropTarget`, `preview`, `inspectorTarget`, `snapGuide`, `flash`, `app`, `canvas`, `raised`, `sunken`, `inset`, `content`, `screen`, `control`, `accentCool`, `accentSubtle` |
| state | 6 | `rest`, `hover`, `active`, `focus`, `disabled`, `readOnly`, `mixed`, `inactive`, `collapsed` |

> **Note on dual-slot values:** `hover` appears in both the role slot (for highlight surfaces like `surface-highlight-primary-normal-hover-rest`, where `hover` is the persistent visual purpose of that surface) and the state slot (for interaction states like `element-global-text-normal-link-hover`, where `hover` is a transient user-interaction state). Similarly, `mixed` appears as both a role (toggle tracks: `surface-toggle-track-normal-mixed-rest`) and a state (checkmarks: `element-checkmark-icon-normal-plain-mixed`). The slot determines the semantic meaning: role = what the token visually represents; state = what interaction condition is active.

**Spec S02: Seed Map Update Requirements** {#s02-seed-map-updates}

Changes to `tugdeck/scripts/seed-rename-map.ts`:

1. **Header comment**: Update slot order to `<plane>-<component>-<constituent>-<emphasis>-<role>-<state>`. Rename `channel` to `constituent`. Remove "(omitted for stateless)" from state description.
2. **Slot reorder**: All ~340 non-identity entries — move constituent from slot 5 to slot 3.
3. **Add `-rest`**: All ~90 stateless entries gain `-rest` suffix.
4. **Semantic fixes**: `linkHover` decomposition, `disabled` as state with `plain` role, `selected`/`highlighted` as roles with `rest` state, field `label`/`placeholder`/`required` as roles.
5. **Chromatic conversion**: All 32 `chromatic-*` entries replaced with six-slot names per the roadmap rename tables.

**Spec S03: generate-tug-tokens.ts Tooling Updates** {#s03-generate-tokens-updates}

Changes to `tugdeck/scripts/generate-tug-tokens.ts` after rename:

1. **`getGroup()` (lines 88-122)**: Rewrite prefix matching for new `element-`/`surface-` naming. Old prefixes (`bg-`, `fg-`, `icon-`, `border-`, `divider-`, `shadow-`, `overlay-`, `accent-`, `tone-`, `selection-`, `highlight-`, `tab-`, `control-disabled-`, `control-surface*`, `field-`, `toggle-`) must be replaced with equivalent routing based on plane/component/constituent extracted from the six-slot name.
2. **`parseControlToken()` (lines 44-55)**: Update regex to match new pattern `--tug-base-(element|surface)-control-<constituent>-<emphasis>-<role>-<state>` instead of old `--tug-base-control-<emphasis>-<role>-<property>-<state>`.
3. **`EMPHASIS_ROLE_PATTERN` (lines 41-42)**: Update regex to match new control token format.
4. **`GROUP_ORDER` and `GROUP_LABELS`**: Update group names and labels to reflect new naming (e.g., `bg` -> `surface-global`, `fg` -> `element-text`, or a simplified grouping by plane+component).

**Spec S04: audit-tokens.ts Tooling Updates** {#s04-audit-tokens-updates}

Changes to `tugdeck/scripts/audit-tokens.ts` after rename:

1. **`CHROMATIC_TOKENS` set (lines 76-116)**: Remove entirely — no chromatic tokens exist after rename.
2. **`TokenClass` type (line 73)**: Remove `chromatic` variant, leaving `"element" | "surface" | "non-color"`.
3. **`classifyToken()` (lines 132-187)**: Remove chromatic branch (lines 140-141). Update surface detection from `bg-`/`surface-` prefix matching to `surface-` prefix matching on the new names. Update element detection from `fg-`/`border-`/`divider-`/`shadow-`/`icon-`/`checkmark` prefix matching to `element-` prefix matching on the new names.
4. **`RENAME_MAP` (lines 778+)**: Remove entirely — the hardcoded fallback is superseded by the seed-rename-map as the single source of truth for rename mappings. After the phase completes all tokens use six-slot names and no legacy rename mapping is needed.
5. **`validateRenameMap()` (line 1617+)**: Update the comment at line 1615 that references "D03 chromatic naming" — there is no chromatic-specific code path to remove, just the comment that references the obsolete chromatic convention.

**Spec S05: derivation-rules.ts Template Literal Updates** {#s05-derivation-rules-updates}

Changes to `tugdeck/src/components/tugways/derivation-rules.ts` after rename:

1. **`semanticToneFamilyRules()` (line ~593)**: The single-base-plus-suffix pattern (`base` + `-bg`, `-fg`, etc.) cannot produce correct six-slot names because different suffixes map to different planes and constituents. Refactor to construct each key individually. The bare base token (e.g., `--tug-base-tone-accent`) is a chromatic fill token and becomes `--tug-base-element-tone-fill-normal-${family}-rest`. The suffixed tokens become full six-slot names: `-bg` becomes `--tug-base-surface-tone-primary-normal-${family}-rest`, `-fg` becomes `--tug-base-element-tone-text-normal-${family}-rest`, `-border` becomes `--tug-base-element-tone-border-normal-${family}-rest`, `-icon` becomes `--tug-base-element-tone-icon-normal-${family}-rest`. The caution-bg override (line ~614) has a static key that `rename --apply` will update to `--tug-base-surface-tone-primary-normal-caution-rest`; verify correctness rather than manually updating.
2. **`filledRoleRules()` (line ~861)**: Base string changes from `` `--tug-base-control-filled-${role}` ``. Suffixes like `-bg-rest`, `-fg-rest`, `-border-rest`, `-icon-rest` become six-slot names with appropriate plane/constituent (e.g., `-bg-rest` becomes `--tug-base-surface-control-primary-filled-${role}-rest`, `-fg-rest` becomes `--tug-base-element-control-text-filled-${role}-rest`).
3. **`outlinedFgRules()` (line ~914)**: Same pattern as filled, with `outlined` emphasis. Constructs bg/fg/border/icon token names for outlined action, agent, and option roles.
4. **`outlinedOptionBorderRules()` (line ~940)**: Overrides the border tokens for the outlined-option role with neutral txt-hue borders. Base string `--tug-base-control-outlined-option` produces 3 border tokens (`-border-rest`, `-border-hover`, `-border-active`) that must become six-slot names with `element-control-border-outlined-option-{state}` pattern. (Borders are element constituents per Spec S01, not surfaces.)
5. **`ghostFgRules()` (line ~988)**: Same pattern as filled, with `ghost` emphasis. Constructs bg/fg/border/icon token names for ghost action and option roles.
6. **`ghostDangerRules()` (line ~1022)**: Constructs all 12 tokens for ghost-danger (bg/fg/border/icon × rest/hover/active). Base string `--tug-base-control-ghost-danger` must become six-slot names following the same pattern as other ghost roles but with `danger` role.
7. **`badgeTintedRoleRules()` (line ~1397)**: Base string changes from `` `--tug-base-badge-tinted-${role}` ``. Suffixes become six-slot names with `badge` component and `tinted` emphasis.

Each function currently constructs token names by concatenating a base with suffixes like `-bg-rest`, `-fg-rest`, `-border-rest`, `-icon-rest`. After the update, each key must be a valid six-slot token name matching Spec S01. For functions where suffixes map to different planes (e.g., `-bg` -> `surface-`, `-fg` -> `element-`), the single-base-plus-suffix pattern must be abandoned in favor of constructing each key individually. For functions where all suffixes share the same plane prefix (e.g., `filledRoleRules` where bg/fg/border/icon all derive from a common control pattern), a restructured base-plus-suffix approach may still work. Total: 7 template-literal-generating functions.

**Table T01: Chromatic Token Conversions** {#t01-chromatic-conversions}

| Old seed map entry | New six-slot name |
|--------------------|-------------------|
| `chromatic-toggle-trackOff` | `surface-toggle-track-normal-off-rest` |
| `chromatic-toggle-trackOffHover` | `surface-toggle-track-normal-off-hover` |
| `chromatic-toggle-trackOn` | `surface-toggle-track-normal-on-rest` |
| `chromatic-toggle-trackOnHover` | `surface-toggle-track-normal-on-hover` |
| `chromatic-toggle-trackDisabled` | `surface-toggle-track-normal-plain-disabled` |
| `chromatic-toggle-trackMixed` | `surface-toggle-track-normal-mixed-rest` |
| `chromatic-toggle-trackMixedHover` | `surface-toggle-track-normal-mixed-hover` |
| `chromatic-toggle-thumb` | `element-toggle-thumb-normal-plain-rest` |
| `chromatic-toggle-thumbDisabled` | `element-toggle-thumb-normal-plain-disabled` |
| `chromatic-radio-dot` | `element-radio-dot-normal-plain-rest` |
| `chromatic-overlay-dim` | `surface-overlay-primary-normal-dim-rest` |
| `chromatic-overlay-scrim` | `surface-overlay-primary-normal-scrim-rest` |
| `chromatic-overlay-highlight` | `surface-overlay-primary-normal-highlight-rest` |
| `chromatic-highlight-hover` | `surface-highlight-primary-normal-hover-rest` |
| `chromatic-highlight-dropTarget` | `surface-highlight-primary-normal-dropTarget-rest` |
| `chromatic-highlight-preview` | `surface-highlight-primary-normal-preview-rest` |
| `chromatic-highlight-inspectorTarget` | `surface-highlight-primary-normal-inspectorTarget-rest` |
| `chromatic-highlight-snapGuide` | `surface-highlight-primary-normal-snapGuide-rest` |
| `chromatic-highlight-flash` | `surface-highlight-primary-normal-flash-rest` |
| `chromatic-tone-accent` | `element-tone-fill-normal-accent-rest` |
| `chromatic-tone-active` | `element-tone-fill-normal-active-rest` |
| `chromatic-tone-agent` | `element-tone-fill-normal-agent-rest` |
| `chromatic-tone-data` | `element-tone-fill-normal-data-rest` |
| `chromatic-tone-success` | `element-tone-fill-normal-success-rest` |
| `chromatic-tone-caution` | `element-tone-fill-normal-caution-rest` |
| `chromatic-tone-danger` | `element-tone-fill-normal-danger-rest` |
| `chromatic-global-accentDefault` | `element-global-fill-normal-accent-rest` |
| `chromatic-global-accentCoolDefault` | `element-global-fill-normal-accentCool-rest` |
| `chromatic-global-accentSubtle` | `element-global-fill-normal-accentSubtle-rest` |
| `chromatic-field-toneDanger` | `element-field-fill-normal-danger-rest` |
| `chromatic-field-toneCaution` | `element-field-fill-normal-caution-rest` |
| `chromatic-field-toneSuccess` | `element-field-fill-normal-success-rest` |

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Missed stale references after rename | high | low | `rename --verify` catches all stale refs | Verify exits non-zero |
| Seed map entry mismatch with roadmap tables | high | med | Diff seed map against roadmap tables before proceeding | `rename-map` validation errors |
| Generated CSS diverges from expected output | med | low | `generate:tokens` + `audit:tokens verify` catches inconsistencies | Verify or lint failures |
| Tooling scripts have stale prefix logic post-rename | high | high | Dedicated tooling update steps before regeneration | `generate:tokens` or `audit:tokens` produce incorrect output |
| derivation-rules.ts template literals produce old names after rename | high | high | Dedicated step updates all 7 template-literal generators | `deriveTheme()` output has old names |
| Documentation references outdated | low | med | Dedicated documentation step with systematic search | PR review finds old names |

**Risk R01: Seed map produces incorrect rename targets** {#r01-seed-map-errors}

- **Risk:** If the seed map update introduces errors (wrong slot ordering, missing entries, typos), the rename will propagate incorrect names across the entire codebase.
- **Mitigation:**
  - Run `bun run audit:tokens rename-map` after seed map update to validate all entries
  - Run `bun run audit:tokens lint` to verify generated names conform to naming rules
  - Preview with `rename --stats` and dry-run `rename` before `--apply`
- **Residual risk:** Semantic correctness (right role vs right state) cannot be fully validated by tooling — requires human review of the roadmap tables.

**Risk R02: Rename tool misses files or references** {#r02-missed-references}

- **Risk:** Some token references might exist in files the rename tool does not scan (e.g., newly added files, documentation, files outside `tugdeck/`).
- **Mitigation:**
  - `rename --verify` scans all project files for stale references
  - Documentation update step (Step 13) manually searches for old names in docs
  - Codebase-wide `grep -r` across `roadmap/` and `docs/` directories catches references outside `tugdeck/`
- **Residual risk:** Files outside the project directory are not checked.

**Risk R03: Tooling produces incorrect output with new token names** {#r03-tooling-stale-logic}

- **Risk:** `generate-tug-tokens.ts` and `audit-tokens.ts` contain hardcoded prefix matching (`bg-`, `fg-`, `control-disabled-`, etc.) and chromatic classification logic. After rename, all tokens start with `element-` or `surface-`, causing `getGroup()` to misroute most tokens to the `other` bucket and `classifyToken()` to produce incorrect classifications.
- **Mitigation:**
  - Dedicated steps (Steps 8-9) update tooling scripts before any regeneration occurs
  - Integration checkpoint (Step 10) verifies tooling works correctly with new names before proceeding to regeneration
- **Residual risk:** Edge cases in grouping logic may produce unexpected CSS ordering; mitigated by visual inspection of generated output.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Update seed-rename-map.ts header comment and terminology {#step-1}

**Commit:** `refactor(tokens): update seed-rename-map header to finalized convention`

**References:** [D02] Constituent slot 3, [D03] Rest always present, [D08] Channel to constituent, Spec S02, (#naming-convention-spec)

**Artifacts:**
- Updated header comment in `tugdeck/scripts/seed-rename-map.ts`

**Tasks:**
- [ ] Update the slot order in the header comment from `<plane>-<component>-<emphasis>-<role>-<channel>-<state>` to `<plane>-<component>-<constituent>-<emphasis>-<role>-<state>`
- [ ] Rename `channel` to `constituent` in the header comment and all slot descriptions
- [ ] Update constituent values list: `text | icon | border | shadow | divider | fill | thumb | dot` for elements, `primary | track` for surfaces
- [ ] Remove "(omitted for stateless)" from the state line; replace with note that `rest` is always present
- [ ] Remove the `chromatic-*` convention line (line 19) from the header comment
- [ ] Remove the "(or three-slot for chromatic)" parenthetical from the file description comment (lines 5-6)
- [ ] Update the component list to include `radio`, `overlay`, `highlight`

**Tests:**
- [ ] `bun test` passes (no functional changes yet, just comments)

**Checkpoint:**
- [ ] `bun test`
- [ ] Visual inspection: header comment matches Spec S02 terminology

---

#### Step 2: Reorder slots and add -rest to all seed map entries {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tokens): reorder constituent to slot 3 and add -rest state`

**References:** [D02] Constituent slot 3, [D03] Rest always present, Spec S01, Spec S02, (#s01-six-slot-format)

**Artifacts:**
- All ~340 non-identity entries in `seed-rename-map.ts` updated with constituent in slot 3 and `-rest` suffix where missing

**Tasks:**
- [ ] For every non-identity entry, move the constituent (currently slot 5) to slot 3 in the new name
- [ ] For every entry currently missing a state slot (~90 entries), append `-rest`
- [ ] Apply the mechanical slot reorder to ALL entries uniformly, including entries that will need semantic reclassification in Step 3 (shadow tokens, linkHover, disabled tokens, selected/highlighted tokens, field text tokens). These entries will have temporarily semantically-incorrect but structurally-consistent six-slot names. Step 3 corrects the semantics on top of the already-reordered structure.
- [ ] Verify every new-name value has exactly six hyphen-separated segments (or compound segments with camelCase). Note: six-segment count is necessary but not sufficient — compound camelCase values like `selectedDisabled` may pass the count check but still need semantic decomposition (e.g., `selected` as role, `disabled` as state). Semantic correctness is addressed in Step 3.

**Tests:**
- [ ] `bun run audit:tokens rename-map` exits 0 with zero validation errors

**Checkpoint:**
- [ ] `bun run audit:tokens rename-map`
- [ ] `bun run audit:tokens lint`
- [ ] `bun test`

---

#### Step 3: Apply semantic fixes to seed map entries {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tokens): apply semantic fixes — disabled-as-state, link-hover decomposition`

**References:** [D05] State-role separation, [D06] Link-hover decomposition, [D07] Field text roles, [D04] Shadow size as role, Spec S02, (#s02-seed-map-updates)

**Artifacts:**
- Semantic corrections in `seed-rename-map.ts` for `linkHover`, disabled tokens, selected/highlighted tokens, field text tokens, shadow tokens

**Tasks:**
- [ ] `fg-link-hover`: change from `element-global-text-normal-linkHover-rest` to `element-global-text-normal-link-hover` (role=`link`, state=`hover`)
- [ ] `fg-disabled`: change to `element-global-text-normal-plain-disabled` (role=`plain`, state=`disabled`)
- [ ] `icon-disabled`: change to `element-global-icon-normal-plain-disabled`
- [ ] All `control-disabled-*` entries: set role=`plain`, state=`disabled`
- [ ] All `control-highlighted-*` entries: set role=`highlighted`, state=`rest`
- [ ] All `control-selected-*` entries: set role=`selected`, appropriate state (`rest`, `hover`, or `disabled`)
- [ ] `control-selected-disabled-bg`: role=`selected`, state=`disabled` (no compound needed)
- [ ] `field-fg-default`: change to `element-field-text-normal-plain-rest` (role=`plain`, not `default`)
- [ ] `field-fg-label`: role=`label`, state=`rest`
- [ ] `field-fg-placeholder`: role=`placeholder`, state=`rest`
- [ ] `field-fg-required`: role=`required`, state=`rest`
- [ ] `field-fg-disabled`: role=`plain`, state=`disabled`
- [ ] `field-fg-readOnly`: role=`plain`, state=`readOnly`
- [ ] `checkmark-fg-mixed`: role=`plain`, state=`mixed`
- [ ] `toggle-icon-mixed`: role=`plain`, state=`mixed`
- [ ] Shadow tokens: constituent=`shadow`, role=size value (`xs`, `md`, `lg`, `xl`, `overlay`), state=`rest`. Before/after examples:
  - `shadow-xs` -> `element-global-shadow-normal-xs-rest` (constituent=`shadow`, role=`xs`, state=`rest`)
  - `shadow-md` -> `element-global-shadow-normal-md-rest`
  - `shadow-lg` -> `element-global-shadow-normal-lg-rest`
  - `shadow-xl` -> `element-global-shadow-normal-xl-rest`
  - `shadow-overlay` -> `element-global-shadow-normal-overlay-rest`

**Tests:**
- [ ] `bun run audit:tokens rename-map` exits 0

**Checkpoint:**
- [ ] `bun run audit:tokens rename-map`
- [ ] `bun run audit:tokens lint`
- [ ] `bun test`

---

#### Step 4: Convert all chromatic tokens to six-slot names {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(tokens): convert all 32 chromatic tokens to six-slot convention`

**References:** [D01] Six-slot mandatory, Table T01, Spec S01, (#t01-chromatic-conversions, #d01-six-slot-mandatory)

**Artifacts:**
- All 32 `chromatic-*` entries in `seed-rename-map.ts` replaced with six-slot names per Table T01

**Tasks:**
- [ ] Replace all 7 toggle track entries with `surface-toggle-track-normal-{role}-{state}` names
- [ ] Replace toggle thumb entries with `element-toggle-thumb-normal-plain-{state}` names
- [ ] Replace radio dot entry with `element-radio-dot-normal-plain-rest`
- [ ] Replace 3 overlay entries with `surface-overlay-primary-normal-{role}-rest` names
- [ ] Replace 6 highlight entries with `surface-highlight-primary-normal-{role}-rest` names
- [ ] Replace 7 tone fill entries with `element-tone-fill-normal-{role}-rest` names
- [ ] Replace 3 accent fill entries with `element-global-fill-normal-{role}-rest` names
- [ ] Replace 3 field tone entries with `element-field-fill-normal-{role}-rest` names
- [ ] Verify zero `chromatic-*` entries remain in the seed map data entries
- [ ] Update the CHROMATIC section comment header (line ~438) to reflect that these tokens are now six-slot convention (e.g., rename to `FORMERLY CHROMATIC — 32 tokens (now six-slot convention)` or remove the "three-slot convention" description)

**Tests:**
- [ ] `bun run audit:tokens rename-map` exits 0
- [ ] `grep "chromatic" tugdeck/scripts/seed-rename-map.ts | grep -v "^[[:space:]]*//"` returns empty (zero chromatic references in data entries; comments may still reference the term historically)

**Checkpoint:**
- [ ] `bun run audit:tokens rename-map`
- [ ] `bun run audit:tokens lint`
- [ ] `bun test`

---

#### Step 5: Seed Map Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Six-slot mandatory, [D02] Constituent slot 3, [D03] Rest always present, Spec S01, Spec S02, Table T01, (#success-criteria)

**Tasks:**
- [ ] Verify every new-name in the seed map has exactly six slots matching the `<plane>-<component>-<constituent>-<emphasis>-<role>-<state>` pattern
- [ ] Verify zero `chromatic-*` entries remain
- [ ] Verify the seed map has all 373 entries (count non-identity entries)
- [ ] Diff the seed map new-name values against the roadmap rename tables to confirm alignment
- [ ] Generate the rename map JSON and spot-check representative tokens from each category (global text, control, tab, tone, field, badge, selection, toggle, overlay, highlight)

**Tests:**
- [ ] `bun run audit:tokens rename-map` exits 0 (full validation pass)

**Checkpoint:**
- [ ] `bun run audit:tokens rename-map`
- [ ] `bun run audit:tokens rename-map --json > /tmp/verify-map.json && wc -l /tmp/verify-map.json`
- [ ] `bun run audit:tokens lint`
- [ ] `bun test`

---

#### Step 6: Generate and preview the rename map {#step-6}

**Depends on:** #step-5

**Commit:** `N/A (verification only)`

**References:** Spec S01, (#strategy, #success-criteria)

**Tasks:**
- [ ] Generate the complete rename map: `bun run audit:tokens rename-map --json > token-rename-map.json`
- [ ] Review stats: `bun run audit:tokens rename --map token-rename-map.json --stats`
- [ ] Run dry-run preview: `bun run audit:tokens rename --map token-rename-map.json`
- [ ] Review the dry-run output for surprises — verify file count (~80+), token count (~373), and replacement patterns look correct
- [ ] Spot-check that component CSS files show expected `var()` reference updates
- [ ] Spot-check that TypeScript files show expected string key updates

**Tests:**
- [ ] `bun run audit:tokens rename --map token-rename-map.json` dry-run exits 0 with expected file/token counts

**Checkpoint:**
- [ ] `bun run audit:tokens rename-map --json > token-rename-map.json` exits 0
- [ ] `bun run audit:tokens rename --map token-rename-map.json --stats` shows expected blast radius
- [ ] `bun run audit:tokens rename --map token-rename-map.json` dry-run exits 0

---

#### Step 7: Apply the rename and update derivation-rules.ts template literals {#step-7}

**Depends on:** #step-6

**Commit:** `refactor(tokens): apply Phase 3.5A six-slot token rename across codebase`

**References:** [D01] Six-slot mandatory, [D09] Tooling before regen, [D10] Derivation rules manual update, Spec S01, Spec S05, Risk R02, (#scope, #success-criteria, #s05-derivation-rules-updates, #d10-derivation-rules-manual)

**Artifacts:**
- All ~80+ files updated with renamed tokens: CSS custom property names, `var()` references, `@tug-renders-on` annotations, component alias definitions, TypeScript string keys, test assertions
- High-impact files include `element-surface-pairing-map.ts` and `contrast-exceptions.ts` which contain extensive token name references
- 164 static string references in `tugdeck/src/components/tugways/derivation-rules.ts` updated by `rename --apply`
- Updated template literal base strings in `derivation-rules.ts` for all 7 rule-generator functions: `semanticToneFamilyRules()`, `filledRoleRules()`, `outlinedFgRules()`, `outlinedOptionBorderRules()`, `ghostFgRules()`, `ghostDangerRules()`, `badgeTintedRoleRules()` (~209 dynamically-constructed token names now produce correct six-slot names)
- ~16 test files under `tugdeck/src/__tests__/` with token name references in assertions

> **Note:** The rename-apply and template literal updates are combined in a single commit to avoid a known-broken intermediate state where `deriveTheme()` would output old token names while consumer files expect new ones. After this step, `generate-tug-tokens.ts` and `audit-tokens.ts` still have stale prefix logic. Do not run `bun run generate:tokens` or `bun run audit:tokens` (except `rename --verify`) until Steps 8 and 9 are complete.

**Tasks:**

*Part A — Mechanical rename:*
- [ ] Apply the rename: `bun run audit:tokens rename --map token-rename-map.json --apply`
- [ ] Review the apply output for error count (should be 0)
- [ ] Verify that `element-surface-pairing-map.ts` was updated (contains pairing definitions referencing token names)
- [ ] Verify that `contrast-exceptions.ts` was updated (contains token name references in test exceptions)
- [ ] Verify that `derivation-rules.ts` had its 164 static string references updated (the `"--tug-base-..."` strings, not the template literal bases)
- [ ] Spot-check at least 2 test files (e.g., `theme-derivation-engine.test.ts`, `theme-accessibility.test.ts`) to confirm token name references were updated
- [ ] Spot-check `derivation-rules.ts` for any `var()` cross-references that construct token names inline (e.g., surface-control rules referencing `var(--tug-base-control-...)`) — verify these were caught by `rename --apply` or flag for manual update in Part B

*Part B — Template literal updates (must be in same commit):*
- [ ] Update `semanticToneFamilyRules()` (~line 593): this function currently uses a single `base` + suffix pattern, but after rename the suffixes map to different planes and constituents (`-bg` -> `surface-tone-primary-...`, `-fg` -> `element-tone-text-...`, the bare base -> `element-tone-fill-...`). The single-base-plus-suffix pattern cannot produce correct six-slot names. Refactor to construct each key individually: the bare base token becomes `--tug-base-element-tone-fill-normal-${family}-rest`, `-bg` becomes `--tug-base-surface-tone-primary-normal-${family}-rest`, `-fg` becomes `--tug-base-element-tone-text-normal-${family}-rest`, `-border` becomes `--tug-base-element-tone-border-normal-${family}-rest`, `-icon` becomes `--tug-base-element-tone-icon-normal-${family}-rest`. The caution-bg override (line ~614) has a static key `--tug-base-tone-caution-bg` that will already be renamed to `--tug-base-surface-tone-primary-normal-caution-rest` by `rename --apply` in Part A (since `rename --apply` uses word-boundary-aware regex matching all occurrences). Verify in Part B that the override key was correctly renamed rather than manually updating it.
- [ ] Update `filledRoleRules()` (~line 861): change base from `` `--tug-base-control-filled-${role}` `` and update suffix concatenations (`-bg-rest`, `-bg-hover`, `-bg-active`, `-fg-rest`, `-fg-hover`, `-fg-active`, `-border-rest`, `-border-hover`, `-border-active`, `-icon-rest`, `-icon-hover`, `-icon-active`) to produce six-slot names with appropriate plane (`element` for fg/icon, `surface` for bg) and constituent (`text` for fg, `primary` for bg, `border`, `icon`)
- [ ] Update `outlinedFgRules()` (~line 914): same pattern as filled, with `outlined` emphasis
- [ ] Update `outlinedOptionBorderRules()` (~line 940): update base string `--tug-base-control-outlined-option` so 3 border token concatenations produce six-slot names with `element-control-border-outlined-option-{state}` pattern (borders are element constituents, not surfaces)
- [ ] Update `ghostFgRules()` (~line 988): same pattern as filled, with `ghost` emphasis
- [ ] Update `ghostDangerRules()` (~line 1022): update base string `--tug-base-control-ghost-danger` so all 12 token concatenations produce six-slot names
- [ ] Update `badgeTintedRoleRules()` (~line 1397): change base from `` `--tug-base-badge-tinted-${role}` `` and update suffixes to produce six-slot names with `badge` component and `tinted` emphasis
- [ ] Verify that every template literal concatenation produces a name matching the `<plane>-<component>-<constituent>-<emphasis>-<role>-<state>` pattern from Spec S01
- [ ] Verify that the total token count output by `deriveTheme()` is still 373

**Tests:**
- [ ] `bun run audit:tokens rename --verify --map token-rename-map.json` exits 0 (zero stale references in files scanned by verify)
- [ ] `bun test` passes (derivation engine tests exercise `deriveTheme()` and will fail if token names are malformed)

> **Lint gap acknowledgment:** `bun run audit:tokens lint` is intentionally deferred until Step 12. After this step, `classifyToken()` in `audit-tokens.ts` still uses old prefix logic, so lint would produce incorrect classifications. As a substitute, manually spot-check 5 representative token names from `deriveTheme()` output spanning different categories (global text, control surface, tone fill, toggle track, badge) to confirm they match Spec S01 six-slot format.

**Checkpoint:**
- [ ] `bun run audit:tokens rename --verify --map token-rename-map.json`
- [ ] `bun test`
- [ ] Verify `deriveTheme()` output token names are all six-slot by running a test or script that enumerates output keys
- [ ] Manual spot-check: pick 5 representative `deriveTheme()` output keys (one each from global text, control surface, tone fill, toggle track, badge categories) and verify each follows the `<plane>-<component>-<constituent>-<emphasis>-<role>-<state>` pattern

---

#### Step 8: Update generate-tug-tokens.ts for new naming convention {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(tokens): update generate-tug-tokens.ts grouping for element/surface prefixes`

**References:** [D01] Six-slot mandatory, [D09] Tooling before regen, Spec S03, (#s03-generate-tokens-updates)

**Artifacts:**
- Rewritten `getGroup()` function in `tugdeck/scripts/generate-tug-tokens.ts`
- Updated `parseControlToken()` and `EMPHASIS_ROLE_PATTERN` regex
- Updated `GROUP_ORDER` and `GROUP_LABELS` arrays

**Tasks:**
- [ ] Rewrite `getGroup()` to route tokens by new `element-`/`surface-` prefixes: extract plane, component, and constituent from six-slot name, then map to groups based on component (e.g., `element-global-text-*` -> text group, `surface-control-*` -> control-surface group, `element-tone-fill-*` -> tone group)
- [ ] Update `EMPHASIS_ROLE_PATTERN` regex from `^--tug-base-control-(filled|outlined|ghost)-(accent|...)` to match new format `^--tug-base-(element|surface)-control-\w+-(filled|outlined|ghost)-`
- [ ] Update `parseControlToken()` regex to extract emphasis, role, constituent, and state from new six-slot control token names
- [ ] Update `controlTokenSort()` if needed to handle the new parsed structure
- [ ] Update `GROUP_ORDER` array to reflect new group names
- [ ] Update `GROUP_LABELS` record to match new group names with human-readable labels
- [ ] Preserve non-color token grouping (`motion-`, `space-`, `radius-`, `chrome-`, `icon-size-`, `font-`, `line-height-`) which are unaffected by the rename
- [ ] Handle `control-disabled-opacity` (now renamed to its six-slot equivalent) as a non-color token — it is an identity mapping that `getGroup()` must route to the non-color/structural group, not to an element/surface color group
- [ ] Add explicit badge token routing in `getGroup()` — badge tokens (e.g., `element-badge-*`, `surface-badge-*`) currently have no explicit route and fall through to `other` or `EMPHASIS_ROLE_PATTERN`; add a route for badge component tokens to a dedicated `badge` group or merge them into an appropriate existing group

**Tests:**
- [ ] `bun run generate:tokens` completes without errors
- [ ] Generated `tug-base-generated.css` contains all ~373 tokens (no tokens dropped into wrong groups or missing)
- [ ] Generated CSS has zero tokens in an "Other" group (all tokens properly routed)

**Checkpoint:**
- [ ] `bun run generate:tokens`
- [ ] `grep -c "Other" tugdeck/styles/tug-base-generated.css` returns 0 (no miscategorized tokens)
- [ ] `bun test`

---

#### Step 9: Update audit-tokens.ts classification and remove chromatic code paths {#step-9}

**Depends on:** #step-7

**Commit:** `refactor(tokens): update audit-tokens.ts classification for element/surface naming`

**References:** [D01] Six-slot mandatory, [D09] Tooling before regen, Spec S04, (#s04-audit-tokens-updates)

**Artifacts:**
- Removed `CHROMATIC_TOKENS` set from `tugdeck/scripts/audit-tokens.ts`
- Simplified `TokenClass` type (removed `chromatic`)
- Rewritten `classifyToken()` for new prefix matching
- Removed legacy hardcoded `RENAME_MAP`
- Updated `validateRenameMap()` to remove chromatic validation

**Tasks:**
- [ ] Remove the `CHROMATIC_TOKENS` set (lines 76-116) entirely
- [ ] Update `TokenClass` type from `"element" | "surface" | "chromatic" | "non-color"` to `"element" | "surface" | "non-color"`
- [ ] Rewrite `classifyToken()`: after non-color check, classify by new prefix — tokens starting with `element-` are elements, tokens starting with `surface-` are surfaces (simple prefix match replaces the complex old logic)
- [ ] Remove the legacy hardcoded `RENAME_MAP` (lines 778+) entirely — after this phase completes, all tokens use six-slot names and the seed-rename-map is the single source of truth for rename mappings; the hardcoded fallback is no longer needed
- [ ] Update `validateRenameMap()` to remove the D03 chromatic naming comment (line ~1615) — there is no chromatic-specific code path, just the comment referencing the obsolete convention
- [ ] Update the file header comment (line 7) to remove "chromatic" from the classification list
- [ ] Search for any remaining `chromatic` string references in `audit-tokens.ts` and remove/update them

**Tests:**
- [ ] `bun run audit:tokens tokens` runs without errors and classifies all tokens as element, surface, or non-color (zero chromatic, zero unclassified)
- [ ] `bun test` passes

**Checkpoint:**
- [ ] `bun run audit:tokens tokens`
- [ ] `bun run audit:tokens rename-map`
- [ ] `bun test`

---

#### Step 10: Tooling Integration Checkpoint {#step-10}

**Depends on:** #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** [D09] Tooling before regen, [D10] Derivation rules manual update, Spec S03, Spec S04, Spec S05, Risk R03, (#success-criteria)

**Tasks:**
- [ ] Verify `derivation-rules.ts` template literals produce correct six-slot token names (all 373 tokens from `deriveTheme()` match Spec S01) — already verified in Step 7 checkpoint, re-confirm here
- [ ] Verify `generate-tug-tokens.ts` groups all tokens correctly with no `other` bucket overflow
- [ ] Verify `audit-tokens.ts` classifies all tokens as element, surface, or non-color with zero chromatic or unclassified results
- [ ] Verify all three updated scripts produce consistent output with the renamed token names

**Tests:**
- [ ] `bun run generate:tokens` produces correctly grouped CSS
- [ ] `bun run audit:tokens tokens` shows zero chromatic/unclassified tokens

**Checkpoint:**
- [ ] `bun run generate:tokens`
- [ ] `bun run audit:tokens tokens`
- [ ] `bun run audit:tokens rename-map`
- [ ] `bun test`

---

#### Step 11: Regenerate derived files {#step-11}

**Depends on:** #step-10

**Commit:** `build(tokens): regenerate derived CSS and pairing blocks after rename`

**References:** [D09] Tooling before regen, Spec S01, (#assumptions)

**Artifacts:**
- Regenerated `@tug-pairings` blocks in component CSS
- Regenerated `tug-base-generated.css` and `harmony.css`

**Tasks:**
- [ ] Regenerate pairing blocks: `bun run audit:tokens inject --apply`
- [ ] Regenerate token CSS: `bun run generate:tokens`
- [ ] Verify no unexpected diff — the regenerated files should use new token names consistently

> **Ordering note:** `inject --apply` runs before `generate:tokens` because inject reads `@tug-renders-on` annotations from component CSS (which already have renamed token names from Step 7) and writes `@tug-pairings` blocks. It does not depend on the generated CSS. `generate:tokens` reads `deriveTheme()` output (updated in Step 7) and writes `tug-base-generated.css`. The two operations are independent and can run in either order, but inject-first is preferred so that any pairing block updates are visible before regenerating the base CSS.

**Tests:**
- [ ] `bun run audit:tokens verify` exits 0 (map-to-CSS consistency)

**Checkpoint:**
- [ ] `bun run audit:tokens inject --apply`
- [ ] `bun run generate:tokens`
- [ ] `bun run audit:tokens verify`
- [ ] `bun run audit:tokens lint`

---

#### Step 12: Full Verification Gates {#step-12}

**Depends on:** #step-7, #step-8, #step-9, #step-11

**Commit:** `N/A (verification only)`

**References:** [D01] Six-slot mandatory, Risk R01, Risk R02, Risk R03, (#success-criteria)

**Tasks:**
- [ ] Run all verification gates in sequence
- [ ] Verify zero stale references to old token names
- [ ] Verify zero `chromatic-*` references remain in the codebase

**Tests:**
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun run audit:tokens pairings` exits 0
- [ ] `bun run audit:tokens verify` exits 0
- [ ] `bun run audit:tokens rename --verify --map token-rename-map.json` exits 0
- [ ] `bun test` passes all tests

**Checkpoint:**
- [ ] `bun run audit:tokens lint`
- [ ] `bun run audit:tokens pairings`
- [ ] `bun run audit:tokens verify`
- [ ] `bun run audit:tokens rename --verify --map token-rename-map.json`
- [ ] `bun test`

---

#### Step 13: Update documentation {#step-13}

**Depends on:** #step-12

**Commit:** `docs(tokens): update all documentation to six-slot naming convention`

**References:** [D01] Six-slot mandatory, [D08] Channel to constituent, Spec S01, (#scope)

**Artifacts:**
- Updated `roadmap/design-system-concepts.md` with element/surface vocabulary rule in Rules of Tugways
- Updated any remaining documentation files referencing old token names

**Tasks:**
- [ ] Search all documentation files for old token name patterns (`fg-`, `bg-app`, `bg-canvas`, `control-*-fg-*`, `control-*-bg-*`, `tab-fg-*`, `tab-bg-*`, `tone-*-fg`, `tone-*-bg`, `field-fg-*`, `field-bg-*`, `badge-tinted-*-fg`, `badge-tinted-*-bg`, `shadow-xs`, `shadow-md`, `shadow-lg`, `shadow-xl`, `toggle-track-*`, `toggle-thumb`, `chromatic-*`)
- [ ] Update all references to use new six-slot names
- [ ] Search for "foreground/background" or "fg/bg" terminology in design docs and update to "element/surface" where appropriate
- [ ] Add a rule to the Rules of Tugways in `roadmap/design-system-concepts.md` establishing element/surface as the canonical vocabulary for contrast and pairing discussions
- [ ] Update code comments in `seed-rename-map.ts` section headers to reflect the new convention if any remain from pre-rename era
- [ ] Verify `roadmap/theme-system-overhaul.md` token tables still make sense (these are historical reference — the "Current" column shows old names, "Proposed" shows new names; no changes needed to the tables themselves, but any prose referencing tokens by name should use new names)

**Tests:**
- [ ] `grep -r "chromatic-" roadmap/ docs/` returns no results
- [ ] `grep -r "\\-\\-tug-base-fg-" roadmap/ docs/` returns no results (old `fg-*` pattern)
- [ ] `grep -r "\\-\\-tug-base-bg-" roadmap/ docs/` returns no results (old `bg-*` pattern)

**Checkpoint:**
- [ ] Documentation search for old token patterns returns zero results
- [ ] Codebase-wide `grep -r "\\-\\-tug-base-fg-\\|\\-\\-tug-base-bg-\\|chromatic-" roadmap/ docs/` returns zero results
- [ ] `bun run audit:tokens lint`
- [ ] `bun test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** All ~373 `--tug-base-*` tokens renamed to the finalized six-slot convention (`<plane>-<component>-<constituent>-<emphasis>-<role>-<state>`) across the entire codebase — including `derivation-rules.ts` template literals — with all tooling updated and documentation reflecting new names and element/surface vocabulary.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `bun run audit:tokens rename --verify --map token-rename-map.json` exits 0 (zero stale references)
- [ ] `bun run audit:tokens lint` exits 0 (zero violations)
- [ ] `bun run audit:tokens pairings` exits 0 (zero unresolved)
- [ ] `bun run audit:tokens verify` exits 0 (map-to-CSS consistency)
- [ ] `bun test` passes all tests
- [ ] Zero `chromatic-*` token names in codebase (`grep -r "chromatic-" tugdeck/` returns empty)
- [ ] Every `--tug-base-*` token follows six-slot pattern
- [ ] Rules of Tugways includes element/surface vocabulary rule
- [ ] `generate-tug-tokens.ts` groups all tokens by new naming convention (zero `other` bucket overflow)
- [ ] `audit-tokens.ts` classifies all color tokens as element or surface (zero chromatic/unclassified)
- [ ] `derivation-rules.ts` template literals produce six-slot token names (`deriveTheme()` output keys all match Spec S01)

**Acceptance tests:**
- [ ] Pick 5 representative tokens from different categories, verify CSS custom property name, `var()` references, and TypeScript keys all use the new name
- [ ] Verify a component CSS file (e.g., `tug-card.css`) uses new `var(--tug-base-element-*)` and `var(--tug-base-surface-*)` references
- [ ] Verify generated `tug-base-generated.css` contains only new token names
- [ ] Verify `bun run audit:tokens tokens` output shows zero `chromatic` classifications

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 3.5B: Semantic text types, contrast roles, recipe input restructuring
- [ ] Automated CI check to prevent introduction of non-conforming token names
- [ ] Component alias token rename (e.g., `--tug-card-*` to follow a similar convention)

| Checkpoint | Verification |
|------------|--------------|
| Seed map updated | `bun run audit:tokens rename-map` exits 0 |
| Rename applied | `bun run audit:tokens rename --verify --map token-rename-map.json` exits 0 |
| derivation-rules.ts updated | `deriveTheme()` output keys all match six-slot pattern; `bun test` passes |
| Tooling updated | `bun run generate:tokens` and `bun run audit:tokens tokens` produce correct output |
| Derived files regenerated | `bun run audit:tokens verify` exits 0 |
| Full gates pass | `bun run audit:tokens lint && bun run audit:tokens pairings && bun test` |
| Docs updated | Zero old token names in documentation files |
