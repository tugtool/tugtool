<!-- tugplan-skeleton v2 -->

## Form and Selection Control Alignment {#form-selection-alignment}

**Purpose:** Align form field validation tokens and selection controls (TugCheckbox, TugSwitch) to the 7-role color system, completing the migration started by Plan 1 (tone families) and Plan 2 (button emphasis x role).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-13 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Plan 1 established 7 uniform tone families (`--tug-base-tone-{role}`) in the theme derivation engine and `tug-base.css`. Plan 2 wired TugButton and TugBadge to an emphasis x role prop system backed by `--tug-base-control-{emphasis}-{role}-*` tokens. However, two areas remain disconnected from the role system:

1. **Form field validation tokens** still use legacy names (`--tug-base-field-border-focus`, `--tug-base-field-border-invalid`, etc.) that do not clearly link to the tone families they derive from. The derivation engine already generates them from role hues (active, danger, success, caution), but the naming obscures this lineage.

2. **Selection controls** (TugCheckbox and TugSwitch) are hardcoded to accent (orange) for their on-state color. They cannot express role-specific semantics (e.g. a "danger" toggle for destructive settings or an "agent" checkbox for AI features).

#### Strategy {#strategy}

- Rename field validation tokens to make their tone-family derivation explicit -- purely a naming change, no formula changes.
- Remove only genuinely unused field tokens (field-helper, field-meta, field-counter, field-limit, field-dirty) that are not present in the derivation engine or any CSS consumer. Keep readOnly tokens which are actively consumed by `tug-input.css`.
- Add an optional `role` prop to TugCheckbox and TugSwitch using inline CSS custom property injection with fallback -- the same mechanism as TugBadge's role system.
- Update the theme generator UI to expose 7 role hue pickers and an emphasis x role preview section.
- Sequence work so token renames land first (stable foundation), then selection controls, then UI.

#### Success Criteria (Measurable) {#success-criteria}

- Zero references to old field validation token names (`--tug-base-field-border-focus`, `--tug-base-field-border-invalid`, `--tug-base-field-border-valid`, `--tug-base-field-warning`, `--tug-base-field-error`, `--tug-base-field-success`) remain in CSS or TS files (`grep` returns 0)
- Zero references to removed tokens (`field-helper`, `field-meta`, `field-counter`, `field-limit`, `field-dirty`) remain in any source file including tests
- `TugCheckbox role="danger"` renders with `--tug-base-tone-danger` as the checked background color (verified by test)
- `TugSwitch role="agent"` renders with `--tug-base-tone-agent` as the on-state track color (verified by test)
- Theme generator displays 7 HueSelector strips (one per role) and an emphasis x role preview grid
- `bun test` passes with zero failures

#### Scope {#scope}

1. Rename 6 field validation tokens in derivation engine, `tug-base.css`, `tug-input.css`, `harmony.css`, gallery components, and tests
2. Remove 5 unused field tokens from any test expectations or documentation that reference them
3. Add `role` prop to TugCheckbox with inline CSS custom property injection
4. Add `role` prop to TugSwitch with inline CSS custom property injection
5. Update `tug-checkbox.css` and `tug-switch.css` to reference the injectable custom property with fallback
6. Add 7 role HueSelector strips to the theme generator UI
7. Add emphasis x role preview section to the theme generator UI

#### Non-goals (Explicitly out of scope) {#non-goals}

- TugRadio component (does not exist yet)
- TugToggle component (does not exist yet)
- Emphasis prop on TugCheckbox/TugSwitch (only role is added; emphasis is a future concern)
- Changing the derivation formulas for field tokens (rename only)
- Adding new role-specific field background or foreground tokens

#### Dependencies / Prerequisites {#dependencies}

- Plan 1 (seven-role-tone-families): tone family tokens must exist in `tug-base.css` and the derivation engine
- Plan 2 (button-emphasis-role): TugButton and TugBadge must already use the emphasis x role system, establishing the `TugBadgeRole` type union as the canonical 7-role type

#### Constraints {#constraints}

- All colors must use `var(--tug-base-*)` semantic tokens exclusively -- no hardcoded hex values
- Appearance changes flow through CSS custom properties, never React state (Rules of Tugways)
- The `role` prop type must match `TugBadgeRole`: `"accent" | "action" | "agent" | "data" | "success" | "caution" | "danger"`
- React 19.2.4 semantics apply (not React 18)

#### Assumptions {#assumptions}

- The 7 tone family tokens (`--tug-base-tone-accent` through `--tug-base-tone-danger`) already exist and are correctly derived
- The inline CSS custom property injection pattern (`style={{ '--tug-toggle-on-color': 'var(--tug-base-tone-{role})' }}`) works reliably across all target browsers
- `tug-input.css` is the primary CSS consumer of field border validation tokens; `gallery-label-content.tsx` and `gallery-marquee-content.tsx` consume `field-error`, `field-success`, and `field-warning` as icon colors

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the skeleton v2 anchor and reference conventions. All headings that are cited use explicit `{#anchor}` tags. Steps cite decisions, specs, and anchors in their `**References:**` lines.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All design decisions are resolved by user answers and prerequisite plans.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token rename breaks a CSS consumer missed during audit | med | low | Grep for all old token names in full codebase; run visual regression | Build or test fails after rename step |
| Inline CSS custom property not inherited through Shadow DOM | low | low | Tugways does not use Shadow DOM; verify with Radix primitives | Radix checkbox/switch renders in shadow root in future version |

**Risk R01: Token Rename Breakage** {#r01-token-rename-breakage}

- **Risk:** A CSS or TS file outside the known set references an old field validation token name and silently falls back to `initial`.
- **Mitigation:**
  - Full codebase grep for each old token name before and after rename
  - Visual check of input validation states in the gallery
  - Test coverage for derived token presence
- **Residual risk:** Third-party or user-authored CSS outside the repo could reference old names, but this is acceptable for an internal design system.

---

### Design Decisions {#design-decisions}

#### [D01] Field validation tokens renamed to reflect tone-family derivation (DECIDED) {#d01-field-token-rename}

**Decision:** Rename six field validation tokens to make their tone-family source explicit:
- `--tug-base-field-border-focus` becomes `--tug-base-field-border-active` (derived from tone-active)
- `--tug-base-field-border-invalid` becomes `--tug-base-field-border-danger` (derived from tone-danger)
- `--tug-base-field-border-valid` becomes `--tug-base-field-border-success` (derived from tone-success)
- `--tug-base-field-warning` becomes `--tug-base-field-tone-caution` (derived from tone-caution; used as both border color in `tug-input.css` and icon color in gallery components)
- `--tug-base-field-error` becomes `--tug-base-field-tone-danger` (derived from tone-danger, non-border usage)
- `--tug-base-field-success` becomes `--tug-base-field-tone-success` (derived from tone-success, non-border usage)

**Rationale:**
- Aligns naming with the 7-role vocabulary used everywhere else in the token system
- Makes derivation lineage self-documenting
- The derivation engine already uses the role hues to generate these values; the rename makes the connection visible
- Including `field-error` and `field-success` avoids a confusing mix of renamed border tokens coexisting with unrenamed non-border tokens that derive from the same hues

**Implications:**
- CSS consumers (`tug-input.css`) must update border token references; `tug-input.css` will reference `field-tone-caution` for its warning border color, which is semantically acceptable since the derivation engine generates a single token for both border and icon usage
- Non-CSS consumers (`gallery-label-content.tsx`, `gallery-marquee-content.tsx`) must update `field-error`/`field-success`/`field-warning` references
- Static fallbacks in `tug-base.css` must update (all 6 tokens at lines 494-496, 501-503)
- Override in `harmony.css` must update (`field-warning` to `field-tone-caution`)
- Test expectations that enumerate token names must update

#### [D02] Remove only genuinely unused field tokens (DECIDED) {#d02-remove-unused-tokens}

**Decision:** Remove `field-helper`, `field-meta`, `field-counter`, `field-limit`, and `field-dirty` tokens. Keep `field-bg-readOnly`, `field-fg-readOnly`, and `field-border-readOnly`.

**Rationale:**
- The five removed tokens do not appear in the derivation engine or any CSS file -- they are dead entries only present in test expectations
- The readOnly tokens ARE actively consumed by `tug-input.css` and generated by the derivation engine

**Implications:**
- Test files that list expected token names must drop the 5 removed tokens
- No CSS or derivation engine changes needed for the removal itself

#### [D03] Selection control role via inline CSS custom property injection (DECIDED) {#d03-role-injection}

**Decision:** Add an optional `role` prop to TugCheckbox and TugSwitch. The component uses a `ROLE_TONE_MAP` to resolve the role name to the correct tone token name (bridging the `action`/`active` naming split), then injects inline CSS custom properties (`--tug-toggle-on-color`, `--tug-toggle-on-hover-color`) set to `var(--tug-base-tone-{mapped})`. The CSS rules reference these properties with fallbacks to the global tokens. A `data-role` attribute is set on the root element so CSS can gate role-specific hover behavior.

**Rationale:**
- TugBadge and TugButton use CSS class composition (`tug-badge-${emphasis}-${role}`) backed by per-combo token names. Toggle controls differ: they have no emphasis axis, and only two color properties need to change (on-state background/border). Inline CSS custom property injection is simpler here -- it avoids generating 7 CSS class blocks for a single property swap.
- Zero-re-render theme switching preserved: CSS custom property chain handles the indirection
- No new CSS classes needed per role -- a single CSS `var()` with fallback covers all 7 roles
- Default behavior (no role prop) falls back to accent, matching current behavior
- The `ROLE_TONE_MAP` lookup is necessary because the prop API uses `"action"` (matching TugBadgeRole) but the tone tokens use `"active"` (i.e., `--tug-base-tone-active`, not `--tug-base-tone-action`)

**Implications:**
- `tug-checkbox.css` and `tug-switch.css` change `var(--tug-base-toggle-track-on)` to `var(--tug-toggle-on-color, var(--tug-base-toggle-track-on))`
- The on-hover variant uses `--tug-toggle-on-hover-color` with fallback to `--tug-base-toggle-track-on-hover`; role-specific hover is injected inline using `color-mix()` to lighten the tone color, gated by `[data-role]` CSS selector
- Component TSX files gain a `role` prop, a `ROLE_TONE_MAP` constant, inject `style` with computed custom properties, and set `data-role` attribute

#### [D04] Role prop type is the 7-role union from TugBadgeRole (DECIDED) {#d04-role-type}

**Decision:** The `role` prop on TugCheckbox and TugSwitch accepts the same `TugBadgeRole` type: `"accent" | "action" | "agent" | "data" | "success" | "caution" | "danger"`. Default is `"accent"` (matching current accent-orange on-state).

**Rationale:**
- Reuses the canonical type from TugBadge, avoiding type proliferation
- 6 of 7 roles map directly to `--tug-base-tone-{role}` tokens; the `"action"` role maps to `--tug-base-tone-active` via `ROLE_TONE_MAP`
- Default of "accent" preserves backward compatibility for existing usage without a role prop

**Implications:**
- Import `TugBadgeRole` from `tug-badge.tsx` or define a shared `TugRole` type
- Both TugCheckbox and TugSwitch must include `ROLE_TONE_MAP` to resolve the action/active naming split. Define the map in each file for now; extract to a shared module (e.g., `tug-role-utils.ts`) when a third consumer appears

**Table T04: Role-to-Tone-Token Mapping** {#t04-role-tone-map}

| Role Prop Value | Tone Token Suffix | Example Token |
|----------------|-------------------|---------------|
| `accent` | `accent` | `--tug-base-tone-accent` |
| `action` | `active` | `--tug-base-tone-active` |
| `agent` | `agent` | `--tug-base-tone-agent` |
| `data` | `data` | `--tug-base-tone-data` |
| `success` | `success` | `--tug-base-tone-success` |
| `caution` | `caution` | `--tug-base-tone-caution` |
| `danger` | `danger` | `--tug-base-tone-danger` |

#### [D05] Theme generator gains 7 role hue pickers and emphasis x role preview (DECIDED) {#d05-theme-generator-ui}

**Decision:** Add 7 HueSelector strips to the theme generator (one per role: accent, active, agent, data, success, caution, danger) and a new emphasis x role preview section showing buttons and badges in all combinations.

**Rationale:**
- Gives theme authors direct control over each role's hue
- The emphasis x role preview validates that all combinations produce legible, distinguishable results
- HueSelector strips are consistent with the existing atmosphere/text selectors

**Implications:**
- Recipe state management needs 7 new hue fields (or wires existing recipe fields like `accent`, `active`, `destructive`, etc.)
- The preview section renders a matrix of TugButton and TugBadge components
- The preview section is separate from the existing token grid and contrast dashboard

---

### Specification {#specification}

#### Token Rename Mapping {#token-rename-mapping}

**Table T01: Field Validation Token Renames** {#t01-token-renames}

| Old Name | New Name | Derived From |
|----------|----------|-------------|
| `--tug-base-field-border-focus` | `--tug-base-field-border-active` | tone-active |
| `--tug-base-field-border-invalid` | `--tug-base-field-border-danger` | tone-danger |
| `--tug-base-field-border-valid` | `--tug-base-field-border-success` | tone-success |
| `--tug-base-field-warning` | `--tug-base-field-tone-caution` | tone-caution (used as both border and icon color) |
| `--tug-base-field-error` | `--tug-base-field-tone-danger` | tone-danger (non-border, icon color usage) |
| `--tug-base-field-success` | `--tug-base-field-tone-success` | tone-success (non-border, icon color usage) |

**Table T02: Tokens to Remove** {#t02-tokens-remove}

| Token | Reason |
|-------|--------|
| `--tug-base-field-helper` | Not in derivation engine or any CSS consumer |
| `--tug-base-field-meta` | Not in derivation engine or any CSS consumer |
| `--tug-base-field-counter` | Not in derivation engine or any CSS consumer |
| `--tug-base-field-limit` | Not in derivation engine or any CSS consumer |
| `--tug-base-field-dirty` | Not in derivation engine or any CSS consumer |

**Table T03: Tokens to Keep (readOnly)** {#t03-tokens-keep}

| Token | Consumer |
|-------|----------|
| `--tug-base-field-bg-readOnly` | `tug-input.css`, derivation engine |
| `--tug-base-field-fg-readOnly` | `tug-input.css`, derivation engine |
| `--tug-base-field-border-readOnly` | `tug-input.css`, derivation engine |

#### Selection Control Role Injection {#role-injection-spec}

**Spec S01: Inline CSS Custom Property Injection** {#s01-inline-injection}

When a `role` prop is provided (and is not `"accent"`, the default):

1. The component resolves the role name to a tone token suffix using `ROLE_TONE_MAP` (Table T04). This is necessary because the prop value `"action"` maps to tone token suffix `"active"` (i.e., `--tug-base-tone-active`, not `--tug-base-tone-action` which does not exist).

2. The component injects two inline CSS custom properties via the `style` prop on the Radix root element:
   - `--tug-toggle-on-color: var(--tug-base-tone-{mapped})`
   - `--tug-toggle-on-hover-color: color-mix(in oklch, var(--tug-base-tone-{mapped}), white 15%)`

3. The component sets `data-role={role}` on the Radix root element so CSS can gate role-specific hover behavior via the `[data-role]` selector.

4. The CSS rules change from:
   ```css
   /* Before */
   background-color: var(--tug-base-toggle-track-on);
   /* After */
   background-color: var(--tug-toggle-on-color, var(--tug-base-toggle-track-on));
   ```

5. **Checkbox-specific:** `tug-checkbox.css` sets both `background-color` AND `border-color` to the track-on token on checked and indeterminate states. Both properties must use the `var(--tug-toggle-on-color, ...)` fallback pattern. The switch CSS only sets `background-color` (no border on the track), so it only needs the background change.

6. When no `role` prop is set or `role="accent"`, no inline style is injected and no `data-role` attribute is set. The CSS fallback resolves to the global `--tug-base-toggle-track-on` token (which is already accent-derived).

**Spec S02: Role Prop Hover Handling** {#s02-role-hover}

The on-hover state for role-colored controls uses inline `color-mix()` injection gated by a `[data-role]` CSS selector:

1. When `role` is set (non-accent), the component injects `--tug-toggle-on-hover-color` with a `color-mix(in oklch, var(--tug-base-tone-{mapped}), white 15%)` value. This provides a lightened variant for hover without needing pre-generated per-role hover tokens.

2. The CSS hover rule for role-colored controls uses a `[data-role]` selector to apply the role-specific hover color only when a role is set:
   ```css
   /* Default hover (no role) — uses pre-computed hover token */
   .tug-switch[data-state="checked"]:hover:not(:disabled):not([data-disabled]):not([data-role]) {
     background-color: var(--tug-base-toggle-track-on-hover);
   }
   /* Role hover — uses injected color-mix value */
   .tug-switch[data-state="checked"][data-role]:hover:not(:disabled):not([data-disabled]) {
     background-color: var(--tug-toggle-on-hover-color);
   }
   ```

3. This approach avoids two problems with `filter: brightness()`: (a) CSS cannot conditionally apply a filter based on whether a custom property is set, so brightness would double-modify the default hover case; (b) `filter: brightness()` on the root element would brighten all descendants including the checkmark/thumb icon.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

No new files. All changes modify existing files.

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ROLE_TONE_MAP` | const record | `tug-checkbox.tsx`, `tug-switch.tsx` | Maps role prop values to tone token suffixes (Table T04); duplicated in both files, extract to shared module when a third consumer appears |
| `TugCheckboxRole` | type alias | `tug-checkbox.tsx` | Re-exports or mirrors `TugBadgeRole` |
| `role` | prop | `TugCheckboxProps` | Optional, default `"accent"` |
| `TugSwitchRole` | type alias | `tug-switch.tsx` | Re-exports or mirrors `TugBadgeRole` |
| `role` | prop | `TugSwitchProps` | Optional, default `"accent"` |
| `--tug-toggle-on-color` | CSS custom property | `tug-checkbox.css`, `tug-switch.css` | Injected inline, fallback to global token |
| `--tug-toggle-on-hover-color` | CSS custom property | `tug-checkbox.css`, `tug-switch.css` | Injected inline via `color-mix()` for hover state |
| `data-role` | HTML attribute | `tug-checkbox.tsx`, `tug-switch.tsx` | Set on root element; gates role-specific CSS hover rules |

---

### Documentation Plan {#documentation-plan}

- [ ] Update inline JSDoc comments in `tug-checkbox.tsx` and `tug-switch.tsx` to document the `role` prop
- [ ] Update CSS file header comments to reflect renamed tokens
- [ ] Add inline comments in the derivation engine noting the rename

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify token rename in derivation engine output | Token rename step |
| **Unit** | Verify role prop renders correct inline CSS custom property | Selection control steps |
| **Integration** | Verify TugCheckbox/TugSwitch with role prop renders correctly | After role prop implementation |
| **Drift Prevention** | Verify old token names are absent from codebase | After each rename step |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Rename field validation tokens in derivation engine and CSS {#step-1}

<!-- Step 1 has no dependencies (it is the root) -->

**Commit:** `refactor: rename field validation tokens to role-based names`

**References:** [D01] Field validation tokens renamed, Table T01, (#token-rename-mapping, #context)

**Artifacts:**
- Modified `theme-derivation-engine.ts`: rename 6 `setChromatic` calls (4 border tokens + field-error + field-success)
- Modified `tug-input.css`: update 4 `var()` references (focus, invalid, valid, warning)
- Modified `tug-base.css`: rename all 6 static fallback entries -- border tokens at lines 494-496 (`field-border-focus`, `field-border-invalid`, `field-border-valid`) and non-border tokens at lines 501-503 (`field-error`, `field-warning`, `field-success`)
- Modified `harmony.css`: rename `--tug-base-field-warning` override (line 157) to `--tug-base-field-tone-caution`
- Modified `gallery-label-content.tsx`: update `iconColor` references from `field-warning`, `field-error`, `field-success` to new names
- Modified `gallery-marquee-content.tsx`: update `iconColor` reference from `field-success` to new name
- Modified `step8-roundtrip-integration.test.ts`: update `field-warning` assertion to new name

Note on test file scope: `theme-derivation-engine.test.ts`, `gallery-theme-generator-content.test.tsx`, and `contrast-dashboard.test.tsx` do NOT reference any of the 6 old field validation token names being renamed (verified by grep -- they only reference `field-helper`, handled in Step 2). The only test file affected by the rename is `step8-roundtrip-integration.test.ts` (which references `field-warning`). The catch-all grep task confirms completeness.

**Tasks:**
- [ ] In `theme-derivation-engine.ts`, rename `--tug-base-field-border-focus` to `--tug-base-field-border-active`
- [ ] In `theme-derivation-engine.ts`, rename `--tug-base-field-border-invalid` to `--tug-base-field-border-danger`
- [ ] In `theme-derivation-engine.ts`, rename `--tug-base-field-border-valid` to `--tug-base-field-border-success`
- [ ] In `theme-derivation-engine.ts`, rename `--tug-base-field-warning` to `--tug-base-field-tone-caution`
- [ ] In `theme-derivation-engine.ts`, rename `--tug-base-field-error` to `--tug-base-field-tone-danger`
- [ ] In `theme-derivation-engine.ts`, rename `--tug-base-field-success` to `--tug-base-field-tone-success`
- [ ] In `tug-input.css`, update `.tug-input:focus` to use `--tug-base-field-border-active`
- [ ] In `tug-input.css`, update `.tug-input-invalid` to use `--tug-base-field-border-danger`
- [ ] In `tug-input.css`, update `.tug-input-valid` to use `--tug-base-field-border-success`
- [ ] In `tug-input.css`, update `.tug-input-warning` to use `--tug-base-field-tone-caution`
- [ ] In `tug-base.css`, rename all 6 static fallback entries: `field-border-focus` to `field-border-active`, `field-border-invalid` to `field-border-danger`, `field-border-valid` to `field-border-success` (lines 494-496), `field-error` to `field-tone-danger`, `field-warning` to `field-tone-caution`, `field-success` to `field-tone-success` (lines 501-503)
- [ ] In `harmony.css`, rename `--tug-base-field-warning` override (line 157) to `--tug-base-field-tone-caution`
- [ ] In `gallery-label-content.tsx`, update `iconColor="var(--tug-base-field-warning)"` to `iconColor="var(--tug-base-field-tone-caution)"`
- [ ] In `gallery-label-content.tsx`, update `iconColor="var(--tug-base-field-error)"` to `iconColor="var(--tug-base-field-tone-danger)"`
- [ ] In `gallery-label-content.tsx`, update `iconColor="var(--tug-base-field-success)"` to `iconColor="var(--tug-base-field-tone-success)"`
- [ ] In `gallery-marquee-content.tsx`, update `iconColor="var(--tug-base-field-success)"` to `iconColor="var(--tug-base-field-tone-success)"`
- [ ] In `step8-roundtrip-integration.test.ts`, update `--tug-base-field-warning` assertion to `--tug-base-field-tone-caution`
- [ ] Grep full codebase for all 6 old token names; fix any remaining references

**Tests:**
- [ ] `theme-derivation-engine.test.ts` passes with new token names in expected output
- [ ] Grep for all 6 old names returns zero results

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `grep -r 'field-border-focus\|field-border-invalid\|field-border-valid\|field-warning\|field-error\|field-success' --include='*.css' --include='*.ts' --include='*.tsx' tugdeck/` returns 0 results (searches both `src/` and `styles/`; note: new names like `field-border-success` and `field-tone-success` will NOT match this pattern because the grep targets exact old substrings)

---

#### Step 2: Remove unused field tokens from test expectations {#step-2}

**Depends on:** #step-1

**Commit:** `chore: remove unused field token references (helper, meta, counter, limit, dirty)`

**References:** [D02] Remove only genuinely unused field tokens, Table T02, Table T03, (#context)

**Artifacts:**
- Modified test files: remove `--tug-base-field-helper` from expected token lists (this is the only one of the 5 that actually appears in the codebase)
- No derivation engine or CSS changes (tokens were already absent from production code)

Note: Of the 5 tokens listed in Table T02, only `field-helper` has actual references in the codebase (in 3 test files). The other 4 (`field-meta`, `field-counter`, `field-limit`, `field-dirty`) are already absent from all source files. The grep checkpoint confirms all 5 are gone.

**Tasks:**
- [ ] In `theme-derivation-engine.test.ts`, remove `--tug-base-field-helper` from expected token lists (and any of the other 4 if present)
- [ ] In `gallery-theme-generator-content.test.tsx`, remove `--tug-base-field-helper` from expected token lists
- [ ] In `contrast-dashboard.test.tsx`, remove `--tug-base-field-helper` from expected token lists
- [ ] Grep codebase for all 5 removed token names to confirm zero remaining references

**Tests:**
- [ ] All tests pass with removed token expectations
- [ ] Grep for removed token names returns zero results

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `grep -r 'field-helper\|field-meta\|field-counter\|field-limit\|field-dirty' --include='*.ts' --include='*.tsx' --include='*.css' tugdeck/src/` returns 0 results

---

#### Step 3: Add role prop to TugCheckbox {#step-3}

**Depends on:** #step-2

**Commit:** `feat: add role prop to TugCheckbox for 7-role color system`

**References:** [D03] Selection control role via inline CSS custom property injection, [D04] Role prop type, Spec S01, Spec S02, (#role-injection-spec, #strategy)

**Artifacts:**
- Modified `tug-checkbox.tsx`: add `role` prop to `TugCheckboxProps`, inject inline CSS custom properties
- Modified `tug-checkbox.css`: update checked/indeterminate/hover rules to use `var(--tug-toggle-on-color, var(--tug-base-toggle-track-on))`
- New or modified test: verify role prop renders correct inline styles

**Tasks:**
- [ ] Add `TugCheckboxRole` type alias (or import `TugBadgeRole`) in `tug-checkbox.tsx`
- [ ] Add `ROLE_TONE_MAP` constant mapping role prop values to tone token suffixes (Table T04): `{ accent: 'accent', action: 'active', agent: 'agent', data: 'data', success: 'success', caution: 'caution', danger: 'danger' }`
- [ ] Add `role?: TugCheckboxRole` to `TugCheckboxProps` interface
- [ ] When `role` is set and not `"accent"`, resolve tone suffix via `ROLE_TONE_MAP[role]`, then compute inline style object: `{ '--tug-toggle-on-color': 'var(--tug-base-tone-{mapped})', '--tug-toggle-on-hover-color': 'color-mix(in oklch, var(--tug-base-tone-{mapped}), white 15%)' }`
- [ ] Pass computed style to `CheckboxPrimitive.Root` via `style` prop (merge with any existing style)
- [ ] Set `data-role={role}` attribute on `CheckboxPrimitive.Root` when role is set and not `"accent"`
- [ ] In `tug-checkbox.css`, change BOTH `background-color` AND `border-color` from `var(--tug-base-toggle-track-on)` to `var(--tug-toggle-on-color, var(--tug-base-toggle-track-on))` in `.tug-checkbox[data-state="checked"]` rules (checkbox sets both properties, unlike switch which only sets background)
- [ ] In `tug-checkbox.css`, split checked hover rule into two, both with `:not(:disabled):not([data-disabled])` guards: (a) `.tug-checkbox[data-state="checked"]:hover:not(:disabled):not([data-disabled]):not([data-role])` uses `var(--tug-base-toggle-track-on-hover)` for default hover; (b) `.tug-checkbox[data-state="checked"][data-role]:hover:not(:disabled):not([data-disabled])` uses `var(--tug-toggle-on-hover-color)` for role-colored hover. Both rules also set `border-color` to match.
- [ ] Apply same fallback pattern to indeterminate state rules using `var(--tug-toggle-on-color, var(--tug-base-toggle-track-mixed))` for role-aware mixed state. Decision: indeterminate inherits the role color so it reads as "partially in this role" rather than reverting to the neutral mixed color. This keeps checked and indeterminate visually consistent within a role.
- [ ] Split indeterminate hover rule with `[data-role]` gating and `:not(:disabled):not([data-disabled])` guards, same pattern as checked hover

**Tests:**
- [ ] Test: `TugCheckbox role="danger"` renders with `--tug-toggle-on-color` style property set to `var(--tug-base-tone-danger)` and `data-role="danger"` attribute
- [ ] Test: `TugCheckbox role="action"` renders with `--tug-toggle-on-color` set to `var(--tug-base-tone-active)` (verifies ROLE_TONE_MAP lookup)
- [ ] Test: `TugCheckbox` without role prop does NOT inject inline style or `data-role` attribute
- [ ] Test: `TugCheckbox role="accent"` does NOT inject inline style (accent is the default)

**Checkpoint:**
- [ ] `bun test` passes
- [ ] Gallery checkbox card visually shows role-colored checkboxes

---

#### Step 4: Add role prop to TugSwitch {#step-4}

**Depends on:** #step-2

**Commit:** `feat: add role prop to TugSwitch for 7-role color system`

**References:** [D03] Selection control role via inline CSS custom property injection, [D04] Role prop type, Spec S01, Spec S02, (#role-injection-spec, #strategy)

**Artifacts:**
- Modified `tug-switch.tsx`: add `role` prop to `TugSwitchProps`, inject inline CSS custom properties
- Modified `tug-switch.css`: update checked/hover rules to use `var(--tug-toggle-on-color, var(--tug-base-toggle-track-on))`
- New or modified test: verify role prop renders correct inline styles

**Tasks:**
- [ ] Add `TugSwitchRole` type alias (or import `TugBadgeRole`) in `tug-switch.tsx`
- [ ] Add `ROLE_TONE_MAP` constant (same as TugCheckbox, Table T04) -- duplicate in this file for now; extract to a shared module when a third consumer appears
- [ ] Add `role?: TugSwitchRole` to `TugSwitchProps` interface
- [ ] When `role` is set and not `"accent"`, resolve tone suffix via `ROLE_TONE_MAP[role]`, then compute inline style object: `{ '--tug-toggle-on-color': 'var(--tug-base-tone-{mapped})', '--tug-toggle-on-hover-color': 'color-mix(in oklch, var(--tug-base-tone-{mapped}), white 15%)' }`
- [ ] Pass computed style to `SwitchPrimitive.Root` via `style` prop
- [ ] Set `data-role={role}` attribute on `SwitchPrimitive.Root` when role is set and not `"accent"`
- [ ] In `tug-switch.css`, change `var(--tug-base-toggle-track-on)` to `var(--tug-toggle-on-color, var(--tug-base-toggle-track-on))` in checked state rule
- [ ] In `tug-switch.css`, split checked hover rule into two, both with `:not(:disabled):not([data-disabled])` guards: (a) `.tug-switch[data-state="checked"]:hover:not(:disabled):not([data-disabled]):not([data-role])` uses `var(--tug-base-toggle-track-on-hover)` for default hover; (b) `.tug-switch[data-state="checked"][data-role]:hover:not(:disabled):not([data-disabled])` uses `var(--tug-toggle-on-hover-color)` for role-colored hover

**Tests:**
- [ ] Test: `TugSwitch role="agent"` renders with `--tug-toggle-on-color` style property set to `var(--tug-base-tone-agent)` and `data-role="agent"` attribute
- [ ] Test: `TugSwitch role="action"` renders with `--tug-toggle-on-color` set to `var(--tug-base-tone-active)` (verifies ROLE_TONE_MAP lookup)
- [ ] Test: `TugSwitch` without role prop does NOT inject inline style or `data-role` attribute
- [ ] Test: `TugSwitch role="accent"` does NOT inject inline style

**Checkpoint:**
- [ ] `bun test` passes
- [ ] Gallery switch card visually shows role-colored switches

---

#### Step 5: Selection Control Integration Checkpoint {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D03] Selection control role via inline CSS custom property injection, [D04] Role prop type, (#success-criteria)

**Tasks:**
- [ ] Verify TugCheckbox and TugSwitch both accept all 7 roles without visual defects
- [ ] Verify default (no role prop) behavior unchanged from pre-plan state
- [ ] Verify hover states work correctly for each role

**Tests:**
- [ ] All checkbox and switch tests pass
- [ ] Gallery shows both controls in all 7 roles side by side

**Checkpoint:**
- [ ] `bun test` passes
- [ ] Visual inspection of gallery checkbox and switch cards confirms correct role colors

---

#### Step 6: Add role hue pickers to theme generator {#step-6}

**Depends on:** #step-1

**Commit:** `feat: add 7 role hue selectors to theme generator`

**References:** [D05] Theme generator gains 7 role hue pickers, (#strategy, #scope)

**Artifacts:**
- Modified `gallery-theme-generator-content.tsx`: add 7 HueSelector strips for role hues
- Modified recipe state: wire role hue selections to ThemeRecipe fields (`accent`, `active`, `agent`, `data`, `success`, `caution`, `destructive`)
- Modified `gallery-theme-generator-content.css`: layout styles for role hue selectors section

**Tasks:**
- [ ] Add 7 state variables for role hues (e.g., `accentHue`, `activeHue`, `agentHue`, `dataHue`, `successHue`, `cautionHue`, `dangerHue`), initialized from the default recipe. Note the naming mismatch: `recipe.destructive` maps to the "danger" role in the UI. The 7 recipe-to-state mappings are: `recipe.accent` -> accentHue, `recipe.active` -> activeHue, `recipe.agent` -> agentHue, `recipe.data` -> dataHue, `recipe.success` -> successHue, `recipe.caution` -> cautionHue, `recipe.destructive` -> dangerHue
- [ ] Extend `runDerive()` signature to accept 7 role hue parameters and include them in the ThemeRecipe it constructs (e.g., `accent: accentHueParam, active: activeHueParam, ...`). All 7 fields map to existing optional ThemeRecipe properties.
- [ ] Add the 7 role hue state variables to the non-debounced `useEffect` dependency array (alongside `mode`, `atmosphereHue`, `textHue`). HueSelectors are discrete clicks, not continuous drags, so they do not need debounce.
- [ ] Update `currentRecipe` useMemo to include all 7 role hue state variables in both the assembled recipe object and the dependency array
- [ ] Update `handleRecipeImported` to set all 7 role hue state variables from the imported recipe (e.g., `setDangerHue(r.destructive ?? DEFAULT_RECIPE.destructive ?? 'red')`)
- [ ] Update `loadPreset` to set all 7 role hue state variables from the preset recipe
- [ ] Add 7 HueSelector components in a new "Role Hues" section, each wired to its state setter. Label the danger HueSelector as "Danger" in the UI (not "Destructive") to match the 7-role vocabulary
- [ ] Add CSS layout for the role hue section (consistent with atmosphere/text hue sections)

**Tests:**
- [ ] Test: changing a role hue updates the derived theme output
- [ ] Test: default role hues match the recipe defaults

**Checkpoint:**
- [ ] `bun test` passes
- [ ] Theme generator visually shows 7 role hue strips

---

#### Step 7: Add emphasis x role preview section to theme generator {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `feat: add emphasis x role preview section to theme generator`

**References:** [D05] Theme generator gains emphasis x role preview, (#success-criteria, #scope)

**Artifacts:**
- Modified `gallery-theme-generator-content.tsx`: add emphasis x role preview grid
- Modified `gallery-theme-generator-content.css`: layout styles for preview grid

**Tasks:**
- [ ] Add a new "Emphasis x Role Preview" section below the role hue selectors
- [ ] Render a grid of TugButton components: 3 emphasis levels x 7 roles = 21 buttons
- [ ] Render a grid of TugBadge components: 3 emphasis levels x 7 roles = 21 badges
- [ ] Optionally render TugCheckbox and TugSwitch examples with each role
- [ ] Style the preview grid with clear row/column labels

**Tests:**
- [ ] Test: preview section renders all emphasis x role combinations
- [ ] Test: preview section updates when role hues change

**Checkpoint:**
- [ ] `bun test` passes
- [ ] Theme generator visually shows the full emphasis x role matrix

---

#### Step 8: Final Integration Checkpoint {#step-8}

**Depends on:** #step-5, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Field validation tokens renamed, [D02] Remove unused tokens, [D03] Role injection, [D04] Role type, [D05] Theme generator UI, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run full test suite
- [ ] Verify all success criteria are met
- [ ] Verify no old token names remain in codebase
- [ ] Verify no removed token names remain in codebase
- [ ] Visual inspection of gallery: inputs, checkboxes, switches, theme generator

**Tests:**
- [ ] `bun test` passes with zero failures

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `grep -r 'field-border-focus\|field-border-invalid\|field-border-valid\|field-warning\|field-error\|field-success' --include='*.css' --include='*.ts' --include='*.tsx' tugdeck/` returns 0 results (searches both `src/` and `styles/`)
- [ ] `grep -r 'field-helper\|field-meta\|field-counter\|field-limit\|field-dirty' --include='*.ts' --include='*.tsx' --include='*.css' tugdeck/` returns 0 results
- [ ] Theme generator role hue pickers and emphasis x role preview section are functional

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Form field validation tokens aligned to 7-role naming, TugCheckbox and TugSwitch gain a `role` prop for role-colored on-states, and the theme generator exposes role hue pickers with emphasis x role preview.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero references to old field validation token names in codebase (grep verification)
- [ ] Zero references to removed unused tokens in codebase (grep verification)
- [ ] `TugCheckbox role="danger"` renders danger-colored checked state (test verification)
- [ ] `TugSwitch role="agent"` renders agent-colored on-state (test verification)
- [ ] Theme generator displays 7 HueSelector strips and emphasis x role preview (visual verification)
- [ ] `bun test` passes with zero failures

**Acceptance tests:**
- [ ] `bun test` full suite green
- [ ] Visual regression: input validation states render correctly with renamed tokens
- [ ] Visual regression: checkbox and switch role colors match tone family expectations

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] TugRadio component with role prop (new component, future plan)
- [ ] TugToggle component with role prop (new component, future plan)
- [ ] Emphasis prop on TugCheckbox/TugSwitch (filled/outlined/ghost checkbox/switch)
- [ ] Per-role hover tokens in the derivation engine (replacing brightness filter approach)
- [ ] Role-aware field background tinting (e.g., danger field gets a subtle red background)
- [ ] Fix pre-existing bug: `gallery-card.tsx` line 1051 includes `"active"` in a `TugBadgeRole[]` array, but `TugBadgeRole` uses `"action"` not `"active"` (unrelated to this plan)

| Checkpoint | Verification |
|------------|--------------|
| Token renames complete | `grep` for old names returns 0 |
| Unused tokens removed | `grep` for removed names returns 0 |
| Checkbox role works | `TugCheckbox role="danger"` test passes |
| Switch role works | `TugSwitch role="agent"` test passes |
| Theme generator updated | Visual inspection confirms hue pickers and preview grid |
| Full suite green | `bun test` exits 0 |
