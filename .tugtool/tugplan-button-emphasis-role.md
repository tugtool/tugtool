<!-- tugplan-skeleton v2 -->

## Button Emphasis x Role and TugBadge {#button-emphasis-role}

**Purpose:** Replace TugButton's 4-variant system (primary/secondary/ghost/destructive) with a 2-axis emphasis x role prop API and build TugBadge with the same system, enabling expressive control styling grounded in the 7-role color system.

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

Plan 1 (seven-role-tone-families, PR #118) established 7 uniform tone families in `tug-base.css` and the theme derivation engine. The current TugButton component uses a 4-variant system (`primary`/`secondary`/`ghost`/`destructive`) that conflates emphasis (how loud) with role (what kind). This makes it impossible to express combinations like "a ghost danger button" or "a filled agent button" -- the two dimensions are locked together.

Plan 2 of the 7-Role Color System proposal separates these axes: emphasis controls volume (filled/outlined/ghost) and role controls domain (accent/active/agent/data/danger). This doubles the expressiveness of the control system while keeping the prop API simple.

#### Strategy {#strategy}

- Generate ~8 common emphasis x role control token combinations in the theme derivation engine and `tug-base.css` before touching any component code.
- Replace TugButton's `variant` prop with `emphasis` + `role` props in a single hard cut -- no deprecation period.
- Update `tug-button.css` to use the new `--tug-base-control-{emphasis}-{role}-{property}-{state}` token naming pattern.
- Migrate all call sites from `variant=` to `emphasis=` + `role=` in a single pass.
- Build TugBadge as a new component sharing the same emphasis x role token system.
- Update the gallery to showcase the full emphasis x role matrix.
- Document dialog/alert button semantic mappings as CSS comments (token-only, no new React components).

#### Success Criteria (Measurable) {#success-criteria}

- Zero references to the old `variant` prop on TugButton remain in the codebase (`grep -r 'variant=' --include='*.tsx' | grep TugButton` returns 0 results)
- Zero references to old control token names (`--tug-base-control-primary-*`, `--tug-base-control-secondary-*`, `--tug-base-control-destructive-*`) remain in any CSS or TS file
- All 8 emphasis x role token combinations generate correctly in `deriveTheme()` output (verified by test)
- TugBadge renders all 3 emphasis levels x 5 button roles (15 combinations) with correct token usage (verified by test)
- `bun test` passes with zero failures
- Gallery card displays the full emphasis x role button matrix and TugBadge matrix

#### Scope {#scope}

1. Theme derivation engine: generate ~96 control tokens for 8 emphasis x role combinations (8 combos x 4 properties x 3 states)
2. `tug-base.css`: replace old 4-variant control tokens with new emphasis x role tokens; add `--tug-base-surface-control` alias
3. TugButton: replace `variant` prop with `emphasis` + `role` props; update CSS class generation
4. `tug-button.css`: rewrite variant blocks to use emphasis x role token names
5. `tug-menu.css`: rewrite variant-aware `[data-state="open"]` blocks to use emphasis x role class names and tokens
6. `fg-bg-pairing-map.ts`: update control token pairings to new names (including checkmark/radio pairings)
7. All TugButton call sites and tests: migrate from `variant=` to `emphasis=` + `role=` in a single commit
8. All non-button CSS/TS consumers of old control tokens: `tug-tab.css`, `tug-menu.css`, `tug-code.css`, `tug-inspector.css`, `gallery-card.css`, `gallery-theme-generator-content.css`, `gallery-palette-content.css`, `style-inspector-overlay.ts`
9. Theme override files: `bluenote.css`, `harmony.css`
10. TugBadge: new component with emphasis x role props, children, size (sm/md/lg), pill shape
11. Gallery: update button showcase and add TugBadge showcase
12. Dialog/alert button mapping: document as CSS comments in `tug-button.css`

#### Non-goals (Explicitly out of scope) {#non-goals}

- New React dialog or alert components (token-only for dialog/alert mappings)
- Form field token changes (Plan 3)
- Selection control role prop (Plan 3)
- Adding emphasis/role props to TugDropdown itself (only migrating TugButton triggers within TugDropdown call sites)
- SUCCESS and CAUTION roles on buttons (these are signal roles; buttons use the 5 domain/danger roles only)

#### Dependencies / Prerequisites {#dependencies}

- Plan 1 (seven-role-tone-families, PR #118) is fully merged on main -- the 7 tone families exist in `tug-base.css` and the derivation engine

#### Constraints {#constraints}

- All colors must use `var(--tug-base-*)` semantic tokens exclusively -- no hardcoded hex values (existing [D04] from TugButton)
- `--tug-base-control-disabled-*` tokens remain unchanged and shared across all emphasis x role combinations
- Existing chain-action mode, `asChild` polymorphism, three-state subtype, loading state, and all other TugButton features must remain functional

#### Assumptions {#assumptions}

- The 8 common emphasis x role combinations are: filled-accent, filled-active, filled-danger, filled-agent, outlined-active, outlined-agent, ghost-active, ghost-danger
- Files in `tugdeck/src/_archive/` are archived code and do not need migration
- TugDropdown trigger call sites use plain `<button>` elements, not TugButton (verified: `gallery-card.tsx` TugDropdownDemo and `gallery-cascade-inspector-content.tsx` both pass `<button type="button" className="cg-demo-trigger">` as trigger, not TugButton)

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All design decisions were resolved via user answers and the reference document.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Hard cut breaks a call site missed during grep | med | low | Exhaustive grep + TypeScript compilation catches all uses | Test failures after migration step |
| Token count doubles (~48 to ~96) increasing CSS size | low | high (expected) | Acceptable tradeoff per proposal; tokens are CSS custom properties (negligible runtime cost) | If CSS file exceeds 30KB |
| Non-button CSS files reference old control tokens as surface colors | high | high (confirmed) | Introduce `--tug-base-surface-control` alias; dedicated step to audit and migrate all non-button consumers | Visual regression in tabs, menus, code blocks |

**Risk R01: Missed call site during hard cut** {#r01-missed-call-site}

- **Risk:** A TugButton call site using the old `variant` prop is missed during migration, causing a runtime error or incorrect styling.
- **Mitigation:**
  - TypeScript compilation will fail if `variant` prop is removed from the interface and any call site still references it
  - Grep for `variant=` across all `.tsx` files before and after migration
  - Gallery visual inspection covers all button subtypes and sizes
- **Residual risk:** None if TypeScript type checking is enforced (it is, via `bun test`)

---

### Design Decisions {#design-decisions}

#### [D01] Hard cut migration: remove variant prop entirely (DECIDED) {#d01-hard-cut}

**Decision:** Remove the `variant` prop from TugButton in a single commit and replace all call sites with `emphasis` + `role` props. No deprecation period or backward-compatible shim.

**Rationale:**
- The codebase is small enough for a complete migration in one pass
- A shim would add complexity and delay cleanup
- TypeScript compilation catches any missed call sites immediately

**Implications:**
- Every file that imports and uses TugButton with `variant=` must be updated in a single step
- Tests must be updated in the same commit

#### [D02] Emphasis x role token naming convention (DECIDED) {#d02-token-naming}

**Decision:** Control tokens follow the pattern `--tug-base-control-{emphasis}-{role}-{property}-{state}` where emphasis is `filled`/`outlined`/`ghost`, role is `accent`/`active`/`agent`/`data`/`danger`, property is `bg`/`fg`/`border`/`icon`, and state is `rest`/`hover`/`active`.

**Rationale:**
- Matches the emphasis x role matrix from the proposal document
- Reads naturally: `control-filled-accent-bg-rest` means "filled accent button, background, at rest"
- Consistent with the existing `--tug-base-control-` prefix

**Implications:**
- Old token names (`control-primary-*`, `control-secondary-*`, `control-ghost-*`, `control-destructive-*`) are fully replaced
- `fg-bg-pairing-map.ts` must update all control token references
- Theme override files (`bluenote.css`, `harmony.css`) may reference old names and need updating

#### [D03] CSS class naming: emphasis-role compound class (DECIDED) {#d03-css-classes}

**Decision:** TugButton uses a single compound CSS class `tug-button-{emphasis}-{role}` (e.g., `tug-button-filled-accent`, `tug-button-ghost-danger`) instead of separate emphasis and role classes.

**Rationale:**
- Each emphasis x role combination has unique token references -- a compound class maps 1:1 to a token set
- Avoids CSS specificity issues from combining two independent classes
- Mirrors the token naming pattern for easy mental mapping

**Implications:**
- CSS file has one block per emphasis x role combination (~8 blocks for the common set)
- The base `.tug-button` class defaults to `outlined-active` styling (replaces old `secondary` default)

#### [D04] TugButton default: emphasis="outlined" role="active" (DECIDED) {#d04-default-emphasis-role}

**Decision:** TugButton defaults to `emphasis="outlined"` and `role="active"` when neither prop is specified.

**Rationale:**
- Maps to the old `secondary` default -- the most common button style
- `outlined-active` is a neutral, low-emphasis interactive button suitable as a default
- Preserves existing visual behavior for call sites that omit variant/emphasis/role

**Implications:**
- The `.tug-button` base class references `outlined-active` tokens
- Call sites that previously used `variant="secondary"` (or omitted variant) need no role/emphasis props

#### [D05] Outlined token derivation from tone families (DECIDED) {#d05-outlined-derivation}

**Decision:** Outlined emphasis derives tokens from the corresponding tone family: `outlined-active` border uses `tone-active-border`, background uses `tone-active-bg`.

**Rationale:**
- Consistent with the role system where each role's tone family provides the visual identity
- Outlined is medium emphasis -- the border carries the role color while background stays subtle

**Implications:**
- The derivation engine uses tone family values as inputs when computing outlined control tokens
- All roles produce consistent outlined styling by referencing their tone family

#### [D06] TugBadge: emphasis + role + size + children API (DECIDED) {#d06-tugbadge-api}

**Decision:** TugBadge accepts `emphasis` (filled/outlined/ghost, default: filled), `role` (any of the 7 roles, default: active), `size` (sm/md/lg, default: sm), and `children` for label content. Pill shape only (border-radius: 9999px).

**Rationale:**
- Shares the emphasis x role system with TugButton for consistency
- Badge roles include all 7 (not just the 5 button roles) because badges label any domain
- Pill shape matches the proven POC badge design from the 7-role validation cards

**Implications:**
- TugBadge uses the same `--tug-base-control-{emphasis}-{role}-*` tokens as TugButton where combinations overlap
- For the 2 signal-only roles (success, caution), TugBadge derives directly from tone families since there are no pre-generated control tokens for those roles

#### [D07] Variant-to-emphasis-role mapping for call site migration (DECIDED) {#d07-variant-mapping}

**Decision:** Call sites are migrated according to the mapping from the proposal: `primary` -> `filled accent`, `secondary` -> `outlined active` (default, can omit both props), `ghost` -> `ghost active`, `destructive` -> `filled danger`.

**Rationale:**
- Directly from the 7-Role Color System proposal's migration table
- Preserves visual equivalence for all existing button uses

**Implications:**
- Call sites with `variant="secondary"` can simply remove the prop (it matches the default)
- Call sites with `variant="primary"` become `emphasis="filled" role="accent"` -- this is an intentional color change from active hue (blue) to accent hue (orange) per the 7-Role proposal. The old "primary" conflated emphasis with the active domain; the new system correctly assigns CTAs to the brand accent color.
- Call sites with `variant="ghost"` become `emphasis="ghost"` (role defaults to active)
- Call sites with `variant="destructive"` become `emphasis="filled" role="danger"`

#### [D08] Introduce --tug-base-surface-control alias for non-button consumers (DECIDED) {#d08-surface-control-alias}

**Decision:** Introduce `--tug-base-surface-control` as a semantic alias that equals `var(--tug-base-control-outlined-active-bg-rest)`. Non-button CSS files that currently use `--tug-base-control-secondary-bg-rest` as a general-purpose surface color (tabs, code blocks, dropdown panels, inspector sections, gallery backgrounds) will reference this alias instead of the raw emphasis x role token.

**Rationale:**
- `--tug-base-control-secondary-bg-rest` is used in 14+ files as a generic surface color, not as a button token. Mechanically renaming to `control-outlined-active-bg-rest` is semantically wrong for tabs and code blocks -- they are not "outlined active" buttons.
- A semantic alias preserves the intent ("surface for interactive chrome") while decoupling from button emphasis x role naming.
- Minimal scope: one alias token defined in `tug-base.css` and the derivation engine.

**Implications:**
- Non-button consumers migrate to `var(--tug-base-surface-control)` instead of the raw emphasis x role token
- The alias is defined in `tug-base.css` and generated by `deriveTheme()` as `var(--tug-base-control-outlined-active-bg-rest)`
- Theme overrides in `bluenote.css` and `harmony.css` that override `control-secondary-bg-rest` should override `surface-control` instead

---

### Specification {#specification}

#### TugButton Prop Changes {#tugbutton-props}

**Spec S01: TugButton emphasis and role props** {#s01-emphasis-role-props}

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `emphasis` | `"filled" \| "outlined" \| "ghost"` | `"outlined"` | Controls visual weight |
| `role` | `"accent" \| "active" \| "agent" \| "data" \| "danger"` | `"active"` | Controls color domain |

The `variant` prop is removed entirely. All other TugButton props remain unchanged.

**Spec S02: CSS class output** {#s02-css-class}

The component generates a compound CSS class: `tug-button-{emphasis}-{role}`. Examples:
- `emphasis="filled" role="accent"` -> class `tug-button-filled-accent`
- `emphasis="ghost" role="active"` -> class `tug-button-ghost-active`
- Default (no props) -> class `tug-button-outlined-active`

**Spec S03: Variant to emphasis x role migration table** {#s03-migration-table}

| Old `variant` | New `emphasis` | New `role` | Notes |
|---------------|---------------|-----------|-------|
| `primary` | `filled` | `accent` | **Intentional color change:** old primary derived from active hue (blue); new filled-accent derives from accent hue (orange). This is the designed behavior per the 7-Role proposal -- CTAs use the brand accent color, not the interactive/active color. |
| `secondary` | `outlined` | `active` | Default -- both props can be omitted |
| `ghost` | `ghost` | `active` | `role` can be omitted (defaults to active) |
| `destructive` | `filled` | `danger` | Red destructive action |

#### Token Structure {#token-structure}

**Spec S04: Control token naming pattern** {#s04-token-naming}

```
--tug-base-control-{emphasis}-{role}-{property}-{state}
```

Where:
- emphasis: `filled` | `outlined` | `ghost`
- role: `accent` | `active` | `agent` | `data` | `danger`
- property: `bg` | `fg` | `border` | `icon`
- state: `rest` | `hover` | `active`

**Table T01: 8 common emphasis x role combinations** {#t01-common-combos}

| # | Emphasis | Role | Use Case | Tokens generated (4 props x 3 states) |
|---|----------|------|----------|---------------------------------------|
| 1 | filled | accent | Primary CTA | 12 |
| 2 | filled | active | Standard interactive | 12 |
| 3 | filled | danger | Destructive action | 12 |
| 4 | filled | agent | AI action | 12 |
| 5 | outlined | active | Secondary action | 12 |
| 6 | outlined | agent | AI secondary action | 12 |
| 7 | ghost | active | Link-like action | 12 |
| 8 | ghost | danger | Subtle destructive | 12 |
| | | | **Total** | **96** |

**Spec S05: Dialog/alert button semantic mapping** {#s05-dialog-mapping}

Documented as CSS comments in `tug-button.css`:

| Button Semantic Role | Emphasis | Role |
|---------------------|----------|------|
| Default/affirmative | filled | accent |
| Cancel (with destructive present) | outlined | active |
| Cancel (standalone) | outlined | active |
| Destructive | filled | danger |

#### TugBadge Component {#tugbadge-spec}

**Spec S06: TugBadge props** {#s06-tugbadge-props}

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `emphasis` | `"filled" \| "outlined" \| "ghost"` | `"filled"` | Controls visual weight |
| `role` | `"accent" \| "active" \| "agent" \| "data" \| "danger" \| "success" \| "caution"` | `"active"` | Controls color domain |
| `size` | `"sm" \| "md" \| "lg"` | `"sm"` | Controls badge dimensions |
| `children` | `React.ReactNode` | required | Badge label content |
| `className` | `string` | `undefined` | Additional CSS class names |

**Spec S07: TugBadge sizing** {#s07-tugbadge-sizing}

| Size | Height | Padding (horizontal) | Font size |
|------|--------|---------------------|-----------|
| sm | 1.25rem (20px) | 0.5rem | 0.625rem (10px) |
| md | 1.5rem (24px) | 0.625rem | 0.6875rem (11px) |
| lg | 1.75rem (28px) | 0.75rem | 0.75rem (12px) |

All sizes use `border-radius: 9999px` (pill shape), `font-weight: 600`, `text-transform: uppercase`, `letter-spacing: 0.06em`.

**Spec S08: TugBadge token usage** {#s08-tugbadge-tokens}

TugBadge token strategy has two tiers:

**Tier 1 -- 5 button roles (accent, active, agent, data, danger):** TugBadge reuses `--tug-base-control-{emphasis}-{role}-*` tokens directly. These are the same tokens generated for TugButton in Table T01. For example, a `filled accent` badge uses `control-filled-accent-bg-rest` for background and `control-filled-accent-fg-rest` for text.

**Tier 2 -- 2 signal-only roles (success, caution):** No pre-generated control tokens exist for these roles. TugBadge derives styling directly from tone families and existing `fg-on{Role}` tokens:

| Emphasis | Property | Source |
|----------|----------|--------|
| filled | bg | `tone-{role}` |
| filled | fg | `fg-on{Role}` (e.g., `fg-onSuccess`, `fg-onCaution` -- role-specific contrast-safe text; caution uses dark text, success uses dark text) |
| filled | border | `tone-{role}` |
| outlined | bg | `tone-{role}-bg` |
| outlined | fg | `fg-default` |
| outlined | border | `tone-{role}-border` |
| ghost | bg | `transparent` |
| ghost | fg | `tone-{role}-fg` |
| ghost | border | `transparent` |

**Spec S09: TugBadge non-Table-T01 button-role combinations** {#s09-badge-non-t01}

For the 7 button-role emphasis x role combinations not covered by Table T01 control tokens, TugBadge CSS derives directly from tone families using the same pattern as Tier 2 signal roles. Badges are display-only (no hover/active states), so only rest-state styling is needed.

| Emphasis | Role | bg | fg | border |
|----------|------|----|----|--------|
| outlined | accent | `tone-accent-bg` | `fg-default` | `tone-accent-border` |
| outlined | danger | `tone-danger-bg` | `fg-default` | `tone-danger-border` |
| outlined | data | `tone-data-bg` | `fg-default` | `tone-data-border` |
| ghost | accent | `transparent` | `tone-accent-fg` | `transparent` |
| ghost | agent | `transparent` | `tone-agent-fg` | `transparent` |
| ghost | data | `transparent` | `tone-data-fg` | `transparent` |
| filled | data | `tone-data` | `fg-onAccent` | `tone-data` |

Note: `filled-data` uses `fg-onAccent` (light text) because data/teal is a dark-bg role in dark mode. If a `fg-onData` token is added in the future, prefer that.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tug-badge.tsx` | TugBadge component |
| `tugdeck/src/components/tugways/tug-badge.css` | TugBadge styles |
| `tugdeck/src/__tests__/tug-badge.test.tsx` | TugBadge unit tests |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `--tug-base-surface-control` | CSS token | `tug-base.css` | Semantic alias for `var(--tug-base-control-outlined-active-bg-rest)` |
| `TugButtonEmphasis` | type | `tug-button.tsx` | `"filled" \| "outlined" \| "ghost"` (replaces `TugButtonVariant`) |
| `TugButtonRole` | type | `tug-button.tsx` | `"accent" \| "active" \| "agent" \| "data" \| "danger"` |
| `TugButtonProps.emphasis` | prop | `tug-button.tsx` | Replaces `variant` |
| `TugButtonProps.role` | prop | `tug-button.tsx` | New prop for color domain |
| `TugBadge` | component | `tug-badge.tsx` | New display component |
| `TugBadgeEmphasis` | type | `tug-badge.tsx` | Same as TugButtonEmphasis |
| `TugBadgeRole` | type | `tug-badge.tsx` | Includes all 7 roles |
| `TugBadgeSize` | type | `tug-badge.tsx` | `"sm" \| "md" \| "lg"` |
| `TugBadgeProps` | interface | `tug-badge.tsx` | emphasis + role + size + children + className |

---

### Documentation Plan {#documentation-plan}

- [ ] Dialog/alert button semantic mapping documented as CSS comments in `tug-button.css` (Spec S05)
- [ ] JSDoc on TugButton updated to reference emphasis x role system instead of 4 variants
- [ ] JSDoc on TugBadge with full prop documentation
- [ ] Gallery card updated to show emphasis x role matrix

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify TugButton renders correct CSS classes for each emphasis x role combination | All 8 common combos + default behavior |
| **Unit** | Verify TugBadge renders correct CSS classes and token references | All emphasis x role x size combinations |
| **Integration** | Verify theme derivation engine produces all 96 control tokens | Token generation correctness |
| **Integration** | Verify fg-bg-pairing-map covers new token names | Contrast checking compatibility |
| **Drift Prevention** | TypeScript compilation ensures no old `variant` references remain | After migration |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **Patterns:**
> - If a step is large, split the work into multiple **flat steps** (`Step N`, `Step N+1`, ...) with separate commits and checkpoints, each with explicit `**Depends on:**` lines.
> - After completing a group of related flat steps, add a lightweight **Integration Checkpoint step** that depends on all constituent steps and verifies they work together. Integration checkpoint steps use `Commit: N/A (verification only)` to signal no separate commit.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Generate emphasis x role control tokens in derivation engine {#step-1}

**Commit:** `feat: generate emphasis x role control tokens in theme derivation engine`

**References:** [D02] Token naming convention, [D05] Outlined token derivation, [D08] Surface control alias, Spec S04, Table T01, (#token-structure, #t01-common-combos)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/theme-derivation-engine.ts` -- replace old `control-primary/secondary/ghost/destructive` token generation with 8 emphasis x role combination generation; generate `--tug-base-surface-control` alias
- Modified `tugdeck/styles/tug-base.css` -- replace old control token definitions with new emphasis x role tokens; add `--tug-base-surface-control` alias; update `--syntax-background` bridge token
- Modified `tugdeck/src/__tests__/theme-derivation-engine.test.ts` -- update token name assertions

**Tasks:**
- [ ] In `deriveTheme()`, replace the 4-variant control token generation block with a loop or function that generates tokens for each of the 8 combinations in Table T01
- [ ] For filled emphasis: derive bg from the role's tone canonical color, fg from text/white, border from tone at higher intensity, icon from fg
- [ ] For outlined emphasis per [D05]: derive bg from `tone-{role}-bg`, fg from default text, border from `tone-{role}-border`, icon from `tone-{role}-icon`
- [ ] For ghost emphasis: derive bg as transparent (rest) / subtle alpha (hover/active), fg from `tone-{role}-fg`, border as transparent, icon from fg
- [ ] Derivation guidance for the 4 new combinations (no old equivalent):
  - `filled-active`: same solid-bg formula as old `control-primary` (which used activeRef/activeAngle), reuse those exact derivation parameters -- this combination preserves the old blue filled button appearance
  - `filled-agent`: same solid-bg formula as filled-active but with agentRef/agentAngle (violet); fg uses light text (txtRefW) since agent is a dark-bg role
  - `outlined-agent`: same border/bg approach as outlined-active but with agentRef/agentAngle; border from `tone-agent-border`, bg from `tone-agent-bg`, fg from default text
  - `ghost-danger`: same transparent-bg approach as ghost-active but fg/icon from `tone-danger-fg`; hover bg uses danger-tinted subtle alpha
- [ ] Generate `--tug-base-surface-control` as `var(--tug-base-control-outlined-active-bg-rest)` per [D08]
- [ ] Update `tug-base.css` hand-authored fallback values to use the new token names matching Table T01
- [ ] In `tug-base.css`, update `--syntax-background: var(--tug-base-control-secondary-bg-rest)` to `--syntax-background: var(--tug-base-surface-control)`
- [ ] Keep shared `--tug-base-control-disabled-*` tokens unchanged (disabled-bg, disabled-fg, disabled-icon, disabled-opacity, disabled-shadow)
- [ ] Drop the 3 per-variant `bg-disabled` aliases (`control-primary-bg-disabled`, `control-secondary-bg-disabled`, `control-destructive-bg-disabled`) -- these are redundant aliases to the shared `control-disabled-bg` token and nothing in `tug-button.css` references them; the CSS disabled state uses `opacity` on the whole button instead
- [ ] Update `theme-derivation-engine.test.ts`: remove the 3 per-variant `bg-disabled` assertions from the STRUCTURAL tokens list
- [ ] Update the derivation engine comment header to reflect new total token count (was 264, will change with new control tokens minus 3 dropped aliases)

**Tests:**
- [ ] Update `theme-derivation-engine.test.ts` to verify all 96 control tokens are present in `deriveTheme()` output
- [ ] Verify `--tug-base-surface-control` is present in output
- [ ] Verify token names match `--tug-base-control-{emphasis}-{role}-{property}-{state}` pattern
- [ ] Update any assertions about total token count

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "derivation"` passes
- [ ] `grep -c "control-filled-accent" tugdeck/styles/tug-base.css` returns > 0
- [ ] `grep -c "control-primary-bg\|control-secondary-bg\|control-ghost-bg\|control-destructive-bg" tugdeck/styles/tug-base.css` returns 0
- [ ] `grep -c "surface-control" tugdeck/styles/tug-base.css` returns > 0

---

#### Step 2: Update fg-bg-pairing-map with new token names {#step-2}

**Depends on:** #step-1

**Commit:** `feat: update fg-bg-pairing-map for emphasis x role control tokens`

**References:** [D02] Token naming convention, Spec S04, Table T01, (#symbol-inventory)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/fg-bg-pairing-map.ts` -- replace all `control-primary/secondary/ghost/destructive` pairings with emphasis x role pairings
- Modified `tugdeck/src/__tests__/theme-accessibility.test.ts` -- update any old token name references
- Modified `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` -- update any old token name references

**Tasks:**
- [ ] Replace all `--tug-base-control-primary-*` pairings with `--tug-base-control-filled-accent-*` (and `filled-active` equivalent)
- [ ] Replace all `--tug-base-control-secondary-*` pairings with `--tug-base-control-outlined-active-*`
- [ ] Replace all `--tug-base-control-ghost-*` pairings with `--tug-base-control-ghost-active-*`
- [ ] Replace all `--tug-base-control-destructive-*` pairings with `--tug-base-control-filled-danger-*`
- [ ] Add pairings for remaining 4 combinations: filled-agent, outlined-agent, ghost-danger, filled-active
- [ ] Update checkmark pairing: `--tug-base-checkmark` bg from `control-primary-bg-rest` to `control-filled-accent-bg-rest`
- [ ] Update radio-dot pairing: `--tug-base-radio-dot` bg from `control-primary-bg-rest` to `control-filled-accent-bg-rest`
- [ ] Update checkmark-mixed pairing: bg from `control-secondary-bg-rest` to `control-outlined-active-bg-rest`
- [ ] Update `style-inspector-overlay.ts`: replace `control-primary-bg-rest` -> `control-filled-accent-bg-rest`, `control-secondary-bg-rest` -> `control-outlined-active-bg-rest`, `control-primary-fg` -> `control-filled-accent-fg-rest`, `control-secondary-fg` -> `control-outlined-active-fg-rest` (the stateless `-fg` names without `-rest` suffix are already broken today -- they reference nonexistent tokens that silently fail; the `-rest` suffixed replacements are the correct fix)
- [ ] Update `theme-accessibility.test.ts` and `gallery-theme-generator-content.test.tsx` if they reference old control token names

**Tests:**
- [ ] Existing contrast/accessibility tests pass with updated pairings
- [ ] Verify pairing count covers all 8 combinations x 4 properties x 3 states

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "pairing|accessibility|contrast"` passes
- [ ] `grep -c "control-primary" tugdeck/src/components/tugways/fg-bg-pairing-map.ts` returns 0
- [ ] `grep -c "control-primary-\|control-secondary-\|control-ghost-bg-\|control-ghost-fg-\|control-ghost-border-\|control-ghost-icon-\|control-destructive-" tugdeck/src/components/tugways/style-inspector-overlay.ts` returns 0

---

#### Step 3: Replace TugButton variant prop with emphasis + role and migrate all call sites {#step-3}

**Depends on:** #step-1

**Commit:** `feat: replace TugButton variant with emphasis + role, migrate all call sites`

**References:** [D01] Hard cut migration, [D03] CSS class naming, [D04] Default emphasis role, [D07] Variant mapping, Spec S01, Spec S02, Spec S03, (#tugbutton-props, #s01-emphasis-role-props, #s02-css-class, #s03-migration-table)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-button.tsx` -- replace `variant` prop with `emphasis` + `role`, update class generation
- Modified `tugdeck/src/components/tugways/tug-button.css` -- replace 4 variant blocks with 8 emphasis x role blocks
- Modified `tugdeck/src/components/tugways/cards/gallery-card.tsx` -- migrate all `variant=` props per Spec S03
- Modified `tugdeck/src/components/tugways/cards/gallery-cascade-inspector-content.tsx` -- migrate TugButton instances
- Modified `tugdeck/src/components/tugways/cards/gallery-animator-content.tsx` -- migrate TugButton instances
- Modified `tugdeck/src/components/tugways/cards/gallery-scale-timing-content.tsx` -- migrate TugButton instances
- Modified `tugdeck/src/__tests__/tug-button.test.tsx` -- update to test emphasis + role props
- Modified `tugdeck/src/__tests__/chain-action-button.test.tsx` -- update single `variant: "secondary"` reference to use emphasis + role

**Tasks:**
- [ ] Remove `TugButtonVariant` type, add `TugButtonEmphasis` and `TugButtonRole` types
- [ ] Replace `variant?: TugButtonVariant` with `emphasis?: TugButtonEmphasis` and `role?: TugButtonRole` in `TugButtonProps`
- [ ] Set defaults: `emphasis = "outlined"`, `role = "active"`
- [ ] Update CSS class generation: replace `tug-button-${variant}` with `tug-button-${emphasis}-${role}`
- [ ] Update `aria-disabled` selector list from variant names to emphasis-role compound names
- [ ] In `tug-button.css`: replace `.tug-button-primary` block with `.tug-button-filled-accent` referencing `--tug-base-control-filled-accent-*` tokens
- [ ] Replace `.tug-button-secondary` block with `.tug-button-outlined-active` tokens
- [ ] Replace `.tug-button-ghost` block with `.tug-button-ghost-active` tokens
- [ ] Replace `.tug-button-destructive` block with `.tug-button-filled-danger` tokens
- [ ] Add CSS blocks for remaining combinations: filled-active, filled-agent, outlined-agent, ghost-danger
- [ ] Update base `.tug-button` class to reference `outlined-active` tokens (the new default)
- [ ] Add dialog/alert semantic mapping CSS comments per Spec S05
- [ ] `gallery-card.tsx`: this file is heavily variant-coupled and requires structural refactoring beyond prop renaming -- replace `ALL_VARIANTS` array and `TugButtonVariant` type references with emphasis x role combination arrays; refactor `previewVariant` state and variant selector dropdown to use separate emphasis/role selectors; update the matrix rendering loop that iterates variants to iterate emphasis x role pairs instead; update all `variant=` props per Spec S03
- [ ] `gallery-cascade-inspector-content.tsx`: update 4 TugButton instances (primary->filled accent, secondary->remove props, ghost->ghost, destructive->filled danger); also update the hardcoded display text `--tug-base-control-primary-bg-rest` in the cascade inspector demo description to use the new token name `--tug-base-control-filled-accent-bg-rest`
- [ ] `gallery-animator-content.tsx`: update all TugButton instances per mapping; for the token selector buttons that toggle `variant={activeToken === token ? "primary" : "secondary"}`, map to `emphasis={activeToken === token ? "filled" : "outlined"} role="active"` (selected/unselected state within the same interactive domain, not an accent vs active distinction)
- [ ] `gallery-scale-timing-content.tsx`: update all TugButton instances per mapping
- [ ] `chain-action-button.test.tsx`: update single `variant: "secondary"` reference to default emphasis + role
- [ ] `tug-button.test.tsx`: rewrite variant tests to test emphasis + role props
- [ ] TugDropdown demo triggers use plain `<button>` elements, not TugButton (verified) -- no migration needed there

**Tests:**
- [ ] TypeScript compilation succeeds with no errors (verifies no missed call sites)
- [ ] `tug-button.test.tsx` tests emphasis + role props; default class is `tug-button-outlined-active`
- [ ] `emphasis="filled" role="accent"` produces class `tug-button-filled-accent`
- [ ] All existing tests pass

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes (full test suite)
- [ ] `grep -c "TugButtonVariant" tugdeck/src/components/tugways/tug-button.tsx` returns 0
- [ ] `grep -rn "variant=" tugdeck/src --include="*.tsx" | grep -i "TugButton\|variant=\"primary\"\|variant=\"secondary\"\|variant=\"ghost\"\|variant=\"destructive\""` returns 0 results (excluding archived code and non-TugButton variant usage)

---

#### Step 4: Migrate non-button CSS and TS consumers of old control tokens {#step-4}

**Depends on:** #step-1

**Commit:** `refactor: migrate non-button consumers to surface-control alias and new token names`

**References:** [D02] Token naming convention, [D08] Surface control alias, Spec S04, (#token-structure)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab.css` -- replace 8 references to `control-secondary-bg-rest` with `surface-control`
- Modified `tugdeck/src/components/tugways/tug-menu.css` -- rewrite 4 variant-aware `[data-state="open"]` blocks to use emphasis-role class names and tokens; replace `control-secondary-bg-rest` in dropdown content panel with `surface-control`
- Modified `tugdeck/src/components/tugways/tug-code.css` -- replace `control-secondary-bg-rest` with `surface-control`
- Modified `tugdeck/src/components/tugways/tug-inspector.css` -- replace `control-secondary-bg-rest` with `surface-control`
- Modified `tugdeck/src/components/tugways/cards/gallery-card.css` -- replace 4 references to `control-secondary-bg-rest` with `surface-control`
- Modified `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css` -- replace 3 references to `control-secondary-bg-rest` with `surface-control`
- Modified `tugdeck/src/components/tugways/cards/gallery-palette-content.css` -- replace `control-secondary-bg-rest` with `surface-control`

**Tasks:**
- [ ] In `tug-tab.css`: replace all `var(--tug-base-control-secondary-bg-rest)` with `var(--tug-base-surface-control)` (8 occurrences)
- [ ] In `tug-menu.css`: rewrite the 4 variant-specific `[data-state="open"]` blocks (`.tug-button-secondary`, `.tug-button-primary`, `.tug-button-ghost`, `.tug-button-destructive`) to use the new compound class names (`.tug-button-outlined-active`, `.tug-button-filled-accent`, `.tug-button-ghost-active`, `.tug-button-filled-danger`) and reference corresponding emphasis x role tokens; also update the bare `.tug-button[data-state="open"]` selector (which pairs with `.tug-button-secondary[data-state="open"]` as the default variant fallback) to reference `control-outlined-active-*` tokens instead of `control-secondary-*`
- [ ] In `tug-menu.css`: update `--tug-menu-item-bg-hover: var(--tug-base-control-ghost-bg-hover)` to `var(--tug-base-control-ghost-active-bg-hover)`
- [ ] In `tug-menu.css`: replace `control-secondary-bg-rest` in `.tug-dropdown-content` with `surface-control`
- [ ] In `tug-code.css`: replace `control-secondary-bg-rest` with `surface-control`
- [ ] In `tug-inspector.css`: replace `control-secondary-bg-rest` with `surface-control`
- [ ] In `gallery-card.css`: replace 4 references to `control-secondary-bg-rest` with `surface-control`
- [ ] In `gallery-theme-generator-content.css`: replace 3 references to `control-secondary-bg-rest` with `surface-control`
- [ ] In `gallery-palette-content.css`: replace `control-secondary-bg-rest` with `surface-control`

**Tests:**
- [ ] No old control token names remain in any of the modified CSS files
- [ ] Visual consistency: tabs, menus, code blocks, inspector should look identical (same underlying color via alias)

**Checkpoint:**
- [ ] `grep -rn "control-secondary-\|control-primary-\|control-ghost-bg-\|control-ghost-fg-\|control-ghost-border-\|control-ghost-icon-\|control-destructive-" tugdeck/src/components/tugways/tug-tab.css tugdeck/src/components/tugways/tug-menu.css tugdeck/src/components/tugways/tug-code.css tugdeck/src/components/tugways/tug-inspector.css` returns 0 results
- [ ] `grep -rn "control-secondary-\|control-primary-\|control-ghost-bg-\|control-ghost-fg-\|control-ghost-border-\|control-ghost-icon-\|control-destructive-" tugdeck/src/components/tugways/cards/gallery-card.css tugdeck/src/components/tugways/cards/gallery-theme-generator-content.css tugdeck/src/components/tugways/cards/gallery-palette-content.css` returns 0 results

---

#### Step 5: Integration checkpoint -- TugButton emphasis x role system {#step-5}

**Depends on:** #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Hard cut migration, [D02] Token naming convention, [D04] Default emphasis role, [D08] Surface control alias, (#success-criteria)

**Tasks:**
- [ ] Verify all old token names are eliminated from CSS and TS files
- [ ] Verify all old variant prop references are eliminated from TSX files
- [ ] Verify derivation engine, pairing map, component, call sites, and non-button consumers are consistent

**Tests:**
- [ ] Full test suite passes

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes
- [ ] `grep -rn "control-primary-\|control-secondary-\|control-ghost-bg-\|control-ghost-fg-\|control-ghost-border-\|control-ghost-icon-\|control-destructive-" tugdeck/src tugdeck/styles` returns 0 results
- [ ] `grep -rn "TugButtonVariant" tugdeck/src` returns 0 results

---

#### Step 6: Build TugBadge component {#step-6}

**Depends on:** #step-1

**Commit:** `feat: add TugBadge component with emphasis x role system`

**References:** [D06] TugBadge API, Spec S06, Spec S07, Spec S08, Spec S09, (#tugbadge-spec, #s06-tugbadge-props, #s07-tugbadge-sizing, #s08-tugbadge-tokens, #s09-badge-non-t01, #new-files)

**Artifacts:**
- New `tugdeck/src/components/tugways/tug-badge.tsx`
- New `tugdeck/src/components/tugways/tug-badge.css`
- New `tugdeck/src/__tests__/tug-badge.test.tsx`

**Tasks:**
- [ ] Create `TugBadgeEmphasis`, `TugBadgeRole`, `TugBadgeSize`, `TugBadgeProps` types per Spec S06
- [ ] Implement `TugBadge` component: render `<span>` with compound class `tug-badge-{emphasis}-{role}`, size class `tug-badge-size-{size}`, pill shape
- [ ] In `tug-badge.css`: define base `.tug-badge` styles (inline-flex, pill, uppercase, font-weight 600, letter-spacing)
- [ ] Define size variants per Spec S07
- [ ] For the 8 Table T01 button-role combos: reference `--tug-base-control-{emphasis}-{role}-*-rest` tokens directly (Spec S08 Tier 1)
- [ ] For the 7 non-Table-T01 button-role combos (outlined-accent, outlined-danger, outlined-data, ghost-accent, ghost-agent, ghost-data, filled-data): derive CSS from tone-family tokens per Spec S09's explicit mapping table; add a CSS comment on the `.tug-badge-filled-data` block noting that `fg-onAccent` is a workaround for the missing `fg-onData` token -- replace with `fg-onData` if added in the future
- [ ] For the 2 signal-only roles (success, caution): derive from tone families and `fg-on{Role}` tokens per Spec S08 Tier 2
- [ ] Write tests: verify CSS class generation for each emphasis x role x size combination
- [ ] Verify correct token references in rendered output

**Tests:**
- [ ] Test default props produce `tug-badge-filled-active tug-badge-size-sm`
- [ ] Test all 3 emphasis x 7 role combinations render correct class names
- [ ] Test all 3 sizes render correct size class

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "TugBadge"` passes
- [ ] `tug-badge.css` contains no hardcoded color values

---

#### Step 7: Update gallery to showcase emphasis x role matrix and TugBadge {#step-7}

**Depends on:** #step-3, #step-6

**Commit:** `feat: update gallery with emphasis x role button matrix and TugBadge showcase`

**References:** [D03] CSS class naming, [D06] TugBadge API, Spec S01, Spec S06, (#success-criteria)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-card.tsx` -- updated button matrix and new TugBadge section
- Modified `tugdeck/src/components/tugways/cards/gallery-card.css` if needed for badge gallery styling

**Tasks:**
- [ ] Update button gallery section to display the full emphasis x role matrix (8 combinations across all sizes)
- [ ] Replace variant selector dropdown/controls with emphasis and role selectors
- [ ] Add TugBadge gallery section showing all emphasis x role combinations
- [ ] Register a gallery tab or section for TugBadge if appropriate
- [ ] Update `gallery-card.test.tsx` for new gallery structure

**Tests:**
- [ ] Gallery renders without errors
- [ ] All 8 button emphasis x role combinations are visible in the gallery
- [ ] TugBadge section shows all emphasis x role combinations

**Checkpoint:**
- [ ] `cd tugdeck && bun test -- --grep "gallery"` passes
- [ ] Visual inspection: gallery shows emphasis x role matrix for buttons and badges

---

#### Step 8: Update theme override files {#step-8}

**Depends on:** #step-1

**Commit:** `feat: update theme overrides for emphasis x role control tokens`

**References:** [D02] Token naming convention, [D08] Surface control alias, Spec S04, (#constraints)

**Artifacts:**
- Modified `tugdeck/styles/bluenote.css` -- update 3 `control-secondary-bg-*` overrides (rest/hover/active) to `surface-control` or equivalent emphasis x role names
- Modified `tugdeck/styles/harmony.css` -- update 9 `control-secondary-*` overrides (bg x3, fg x3, border x3) and 4 `control-ghost-*` overrides to emphasis x role equivalents

**Tasks:**
- [ ] In `bluenote.css`: replace `--tug-base-control-secondary-bg-rest` override with `--tug-base-surface-control` per [D08]; replace `--tug-base-control-secondary-bg-hover` and `--tug-base-control-secondary-bg-active` with `--tug-base-control-outlined-active-bg-hover` and `--tug-base-control-outlined-active-bg-active` (bluenote.css only overrides these 3 control tokens)
- [ ] In `harmony.css`: replace `--tug-base-control-secondary-bg-rest` override with `--tug-base-surface-control` per [D08]; replace `--tug-base-control-secondary-bg-hover` and `--tug-base-control-secondary-bg-active` with `--tug-base-control-outlined-active-bg-hover` and `--tug-base-control-outlined-active-bg-active`
- [ ] In `harmony.css`: replace 3 secondary fg overrides: `--tug-base-control-secondary-fg-rest/hover/active` -> `--tug-base-control-outlined-active-fg-rest/hover/active`
- [ ] In `harmony.css`: replace 3 secondary border overrides: `--tug-base-control-secondary-border-rest/hover/active` -> `--tug-base-control-outlined-active-border-rest/hover/active`
- [ ] In `harmony.css`: replace 4 ghost overrides with emphasis x role equivalents: `--tug-base-control-ghost-bg-hover` -> `--tug-base-control-ghost-active-bg-hover`, `--tug-base-control-ghost-fg-rest` -> `--tug-base-control-ghost-active-fg-rest`, `--tug-base-control-ghost-fg-hover` -> `--tug-base-control-ghost-active-fg-hover`, `--tug-base-control-ghost-fg-active` -> `--tug-base-control-ghost-active-fg-active`
- [ ] Grep both files for any remaining old control token names (`control-primary`, `control-secondary`, `control-ghost-bg`, `control-ghost-fg`, `control-destructive`) and verify none remain

**Tests:**
- [ ] Theme switching produces correct control colors in both bluenote and harmony themes

**Checkpoint:**
- [ ] `grep -c "control-primary-\|control-secondary-\|control-ghost-bg-\|control-ghost-fg-\|control-ghost-border-\|control-ghost-icon-\|control-destructive-" tugdeck/styles/bluenote.css tugdeck/styles/harmony.css` returns 0 for each file
- [ ] `cd tugdeck && bun test` passes

---

#### Step 9: Final integration checkpoint {#step-9}

**Depends on:** #step-5, #step-7, #step-8

**Commit:** `N/A (verification only)`

**References:** [D01] Hard cut migration, [D02] Token naming convention, [D06] TugBadge API, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Full test suite passes
- [ ] No references to old variant system remain anywhere in the codebase
- [ ] TugBadge component exists and is tested
- [ ] Gallery showcases the full emphasis x role matrix
- [ ] Theme overrides are consistent with new token names

**Tests:**
- [ ] Full test suite

**Checkpoint:**
- [ ] `cd tugdeck && bun test` passes with 0 failures
- [ ] `grep -rn "TugButtonVariant\|control-primary-\|control-secondary-\|control-ghost-bg-\|control-ghost-fg-\|control-ghost-border-\|control-ghost-icon-\|control-destructive-\|variant=\"primary\"\|variant=\"secondary\"\|variant=\"ghost\"\|variant=\"destructive\"" tugdeck/src tugdeck/styles` returns 0 results (excluding _archive)
- [ ] `grep -rn "TugBadge" tugdeck/src/components/tugways/tug-badge.tsx` returns > 0

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** TugButton uses a 2-axis emphasis x role prop API with 8 pre-generated token combinations, all call sites are migrated, and TugBadge is built with the same system.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `TugButtonVariant` type no longer exists (TypeScript compilation verifies)
- [ ] TugButton accepts `emphasis` and `role` props per Spec S01
- [ ] All 96 control tokens generate correctly in `deriveTheme()` (test verifies)
- [ ] `fg-bg-pairing-map.ts` covers all new token pairings (test verifies)
- [ ] TugBadge component renders all emphasis x role x size combinations (test verifies)
- [ ] Zero references to old variant prop or old token names in non-archived code
- [ ] `cd tugdeck && bun test` passes with 0 failures

**Acceptance tests:**
- [ ] `bun test` full suite passes
- [ ] Gallery visual inspection shows emphasis x role matrix for buttons and badges
- [ ] Theme switching (brio/bluenote/harmony) produces correct control colors

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Plan 3: Form and selection control alignment (field token rename, selection control role prop)
- [ ] Additional emphasis x role combinations beyond the initial 8 (e.g., outlined-accent, ghost-agent) as demand emerges
- [ ] Remove POC 7-role artifacts (`poc-seven-role.css`, `poc-seven-role-cards.tsx`) once Plan 2 is complete

| Checkpoint | Verification |
|------------|--------------|
| Token generation | `bun test -- --grep "derivation"` passes |
| Pairing map | `bun test -- --grep "pairing\|accessibility"` passes |
| TugButton migration | `grep TugButtonVariant` returns 0 |
| TugBadge | `bun test -- --grep "TugBadge"` passes |
| Full suite | `bun test` passes |
