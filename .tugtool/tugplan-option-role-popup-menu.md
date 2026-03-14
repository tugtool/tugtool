<!-- tugplan-skeleton v2 -->

## Option Role and Popup Menu Controls {#option-role-popup-menu}

**Purpose:** Add an `option` role to the emphasis x role matrix for calm configuration controls, decompose TugDropdown into TugPopupMenu (headless) + TugPopupButton (convenience), migrate all call sites, and delete TugDropdown.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | option-role-popup-menu |
| Last updated | 2026-03-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current emphasis x role matrix covers CTA-oriented controls (filled/outlined/ghost x accent/action/danger) but has no fit for configuration controls like popup menus, checkboxes, and switches. Using `outlined-action` makes these controls too loud (strong blue border competing for attention), while `ghost` loses the border entirely. Additionally, TugDropdown owns its trigger button internally, which forces tab bar buttons to fight against unwanted chevrons, squared borders, and open-state highlighting via CSS overrides.

The roadmap proposal in `roadmap/option-role-and-popup-controls.md` defines the solution: a new `option` role for calm/muted styling, and an architectural inversion where the trigger owns the menu instead of the menu owning the trigger.

#### Strategy {#strategy}

- Add `option` role tokens to the theme derivation engine first, establishing the visual foundation before any component work.
- Build TugPopupMenu as a headless behavioral extraction from TugDropdown, preserving the existing blink animation logic and CSS class names to minimize churn.
- Build TugPopupButton as a thin composition of TugPopupMenu + TugButton with option-role defaults.
- Migrate all TugDropdown call sites in a single pass: gallery preview controls to TugPopupButton, tab bar triggers to TugPopupMenu with TugButton ghost-option triggers.
- Delete TugDropdown entirely with no backward-compat shims.
- Update TugCheckbox and TugSwitch to default to role='option' for calmer styling.

#### Success Criteria (Measurable) {#success-criteria}

- All `bun run generate:control-tokens` output includes `outlined-option` and `ghost-option` tokens (24 new tokens: 2 new combinations x 4 properties x 3 states, bringing the total from 11 to 13 emphasis-role combinations).
- Zero imports of `tug-dropdown` remain in the codebase after migration (`grep -r "tug-dropdown" src/` returns nothing).
- Tab bar `+` button renders with no chevron and no `.tug-button-trailing-icon` element in the DOM.
- Gallery preview controls render with `outlined-option` styling (verifiable via computed CSS variable inspection).
- All existing tests pass (`bun run test`), including adapted TugDropdown tests renamed for TugPopupMenu/TugPopupButton.
- The broad `.tug-button[data-state="open"]` CSS fallback rule is removed; only explicit compound selectors handle open-state highlighting.

#### Scope {#scope}

1. Theme derivation engine: generate `outlined-option` and `ghost-option` control tokens.
2. TugButton types and CSS: add `"option"` to `TugButtonRole`, add CSS variant rules.
3. TugPopupMenu component: headless behavioral layer extracted from TugDropdown.
4. TugPopupButton component: convenience composition of TugPopupMenu + TugButton.
5. Open-state CSS: add `outlined-option` and `ghost-option` `data-state="open"` rules; remove broad fallback.
6. Call site migration: gallery preview controls, tab bar triggers, cascade inspector, observable props, gallery dropdown demo.
7. TugDropdown deletion: remove `tug-dropdown.tsx` and all imports.
8. TugCheckbox and TugSwitch: adopt `role='option'` as default for calmer styling.

#### Non-goals (Explicitly out of scope) {#non-goals}

- `filled-option` emphasis variant (contradicts calm visual intent per roadmap).
- New components like TugSegmentedControl, TugRadioGroup, or TugStepper (future follow-on).
- Renaming `tug-dropdown-content` / `tug-dropdown-item` CSS class names (preserved to avoid CSS sweep).

#### Dependencies / Prerequisites {#dependencies}

- Existing emphasis x role matrix infrastructure in theme-derivation-engine.ts.
- TugButton forwardRef + trailingIcon support (already landed in `e3d2f441`).
- Radix `@radix-ui/react-dropdown-menu` already installed.

#### Constraints {#constraints}

- Must run `bun run generate:control-tokens` after editing theme-derivation-engine.ts (per project memory).
- Never use npm; always use bun.
- All appearance changes go through CSS and DOM, never React state (Rules of Tugways D08, D09).
- Warnings are errors; all code must compile cleanly.

#### Assumptions {#assumptions}

- TugPopupMenu will reuse the existing blink animation logic verbatim from TugDropdown (blinkingRef guard, WAAPI double-blink keyframes, Escape dispatch for close sequencing).
- TugPopupButton will default to emphasis='outlined', role='option', rounded='none', and include ChevronDown as trailingIcon -- these are not configurable per the roadmap spec.
- The `tug-dropdown-content` and `tug-dropdown-item` CSS class names will be preserved in TugPopupMenu to avoid a CSS rename sweep.
- The existing TugDropdownItem interface will be renamed TugPopupMenuItem and re-exported from tug-popup-menu.tsx; tug-dropdown.tsx will be deleted entirely with no re-export shim.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor-name}` anchors on all headings and artifacts that are referenced by execution steps. All anchors are kebab-case, no phase numbers, stable under renumbering.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token formula produces low-contrast option borders | med | med | Visual inspection across all three themes before proceeding | Contrast ratio < 3:1 against surface |
| Blink animation regression during extraction | high | low | Verbatim code lift; existing blink tests adapted | Any test failure in blink-then-select logic |
| Tab bar measurement bootstrap breaks | med | low | Preserve existing button dimensions; verify OVERFLOW_BUTTON_WIDTH | Tab bar overflow calculation is wrong |

**Risk R01: Option token contrast** {#r01-option-contrast}

- **Risk:** Neutral/muted border formulas may produce borders with insufficient contrast against the surface, making controls hard to see.
- **Mitigation:** Use fg-muted hue/intensity for border (same lightness curve as outlined-action but stripped of action-blue chroma). Visually verify across Brio, Bluenote, Harmony themes. Adjust intensity knobs if contrast is insufficient.
- **Residual risk:** Edge-case themes with very low surfaceContrast may still produce subtle borders.

**Risk R02: Migration completeness** {#r02-migration-completeness}

- **Risk:** A TugDropdown import could be missed during migration, leaving broken references after deletion.
- **Mitigation:** Use `grep -r "TugDropdown\|tug-dropdown" src/` as a checkpoint before deletion step.
- **Residual risk:** Dynamic imports or string references could be missed (none currently exist).

---

### Design Decisions {#design-decisions}

#### [D01] Option role uses neutral fg-muted formulas (DECIDED) {#d01-option-neutral-formulas}

**Decision:** The `option` role control tokens use fg-muted hue/intensity for border, fg-default for text, and atmosphere-tinted hover at low opacity -- analogous to outlined-action but stripped of action-blue chroma.

**Rationale:**
- Configuration controls should be visually present but not compete with CTA buttons for attention.
- Neutral formulas ensure the option role works across all themes without introducing a new signal hue.
- The user explicitly chose this strategy over alternatives (dedicated option-gray, atmosphere-hue-shifted).

**Implications:**
- No new hue ref variable needed; reuses existing text and atmosphere refs.
- `outlined-option` border will be subtler than `outlined-action` (no blue chroma).
- `ghost-option` will behave identically to `ghost-action` but with even less border emphasis at rest.

#### [D02] TugPopupMenu takes a single ReactNode trigger prop (DECIDED) {#d02-trigger-api}

**Decision:** TugPopupMenu accepts a `trigger` prop of type `ReactNode`. It wraps this element in a Radix `DropdownMenu.Trigger` with `asChild`, so the caller's element becomes the trigger.

**Rationale:**
- The `asChild` pattern is already used by TugButton and is the standard Radix composition pattern.
- A single ReactNode prop is the simplest API that supports both TugPopupButton (passes a TugButton) and tab bar (passes a custom `<button>`).
- The caller controls all trigger presentation; TugPopupMenu has no opinions about appearance.

**Implications:**
- The trigger element must accept Radix-injected props (ref, data-state, aria-expanded, etc.) -- which any HTML element or forwardRef component does.
- TugPopupButton composes this by passing a `<TugButton>` as the trigger prop.
- Tab bar passes `<TugButton emphasis="ghost" role="option">` elements as triggers -- still TugButton instances, but with ghost-option styling and no chevron. This preserves existing `.tug-button` class assertions in tests and keeps TugButton-specific CSS overrides in tug-tab.css valid.

#### [D03] Remove broad data-state="open" fallback selector (DECIDED) {#d03-remove-open-fallback}

**Decision:** The broad `.tug-button[data-state="open"]` selector in tug-menu.css is removed. Only explicit emphasis-role compound selectors (e.g., `.tug-button-outlined-option[data-state="open"]`) handle open-state highlighting.

**Rationale:**
- The broad fallback applied outlined-action active colors to any TugButton with data-state="open", regardless of its actual emphasis/role. This caused the tab bar's ghost-action triggers to get incorrect blue highlighting.
- Explicit compound selectors ensure each emphasis-role combination gets its own correct open-state colors.
- The user explicitly chose this strategy.

**Implications:**
- New open-state rules must be added for `outlined-option` and `ghost-option`.
- Any future emphasis-role combination that needs open-state highlighting must add its own compound selector.

#### [D04] TugPopupButton defaults are not configurable (DECIDED) {#d04-popup-button-defaults}

**Decision:** TugPopupButton always uses emphasis='outlined', role='option', rounded='none', and ChevronDown as trailingIcon. These are not overridable via props.

**Rationale:**
- TugPopupButton is a macOS-style popup button with a fixed visual identity. Callers who need different trigger appearance use TugPopupMenu directly with their own trigger.
- Removing configuration options simplifies the component and prevents misuse.

**Implications:**
- TugPopupButton props are limited to: label, items, onSelect, size, className, aria-label, data-testid.
- Gallery preview controls that currently use `emphasis="ghost"` will switch to TugPopupButton's `outlined-option` default, changing their visual appearance as intended.

#### [D05] Preserve CSS class names from TugDropdown (DECIDED) {#d05-preserve-css-classes}

**Decision:** TugPopupMenu emits the same `tug-dropdown-content` and `tug-dropdown-item` CSS class names that TugDropdown currently uses.

**Rationale:**
- Avoids a CSS rename sweep across tug-menu.css and any test assertions.
- The class names are internal implementation details, not part of a public API.
- A rename can be done later as a separate cleanup if desired.

**Implications:**
- tug-menu.css does not need to be updated for content/item class names.
- Test assertions checking for `tug-dropdown-content` / `tug-dropdown-item` continue to work.

#### [D06] TugCheckbox and TugSwitch default to role='option' (DECIDED) {#d06-checkbox-switch-option}

**Decision:** TugCheckbox and TugSwitch add `"option"` to their role type and adopt it as the default role (replacing the current `"accent"` default).

**Rationale:**
- Checkboxes and switches are configuration controls, not CTAs. The `option` role provides calmer default styling.
- The user explicitly confirmed this is in scope.
- Existing callers that pass an explicit `role` prop are unaffected.

**Implications:**
- Default appearance of TugCheckbox and TugSwitch changes to use option-role tokens.
- The checkbox/switch role type must be extended to include `"option"`.
- Tests asserting default role behavior need updating.

#### [D07] Tab bar triggers use TugButton with ghost-option role (DECIDED) {#d07-tab-bar-ghost-option}

**Decision:** Tab bar `+` and overflow triggers use `<TugButton emphasis="ghost" role="option">` as the trigger ReactNode passed to TugPopupMenu, rather than plain `<button>` elements.

**Rationale:**
- Existing tests (T17) assert the `+` button carries `.tug-button` class. Switching to plain `<button>` would break these assertions unnecessarily.
- The tug-tab.css overrides (`.tug-tab-bar .tug-tab-add`, `.tug-tab-bar .tug-tab-overflow-btn`) are written for TugButton specificity and would need rewriting for plain buttons.
- `ghost-option` provides the correct calm hover/active styling that the tab bar needs, and the new `ghost-option[data-state="open"]` CSS rule provides proper open-state highlighting.
- No chevron is rendered because TugPopupMenu does not force a trailing icon -- the trigger controls its own presentation.

**Implications:**
- Tab bar tests continue to pass with minimal changes (remove TugDropdown-specific assertions, keep `.tug-button` assertions).
- The `.tug-tab-bar .tug-button-trailing-icon { display: none; }` CSS hack is still removed because TugPopupMenu does not inject a trailing icon.
- Tab bar CSS overrides remain structurally valid; only comment references to TugDropdown need updating.

---

### Specification {#specification}

#### Token Naming {#token-naming}

**Spec S01: Option Role Control Token Names** {#s01-option-tokens}

New tokens follow the existing pattern `--tug-base-control-{emphasis}-{role}-{property}-{state}`:

**Table T01: Outlined-Option Tokens** {#t01-outlined-option-tokens}

| Token | Formula |
|-------|---------|
| `--tug-base-control-outlined-option-bg-rest` | `transparent` |
| `--tug-base-control-outlined-option-bg-hover` | atmosphere-tinted at low opacity (same as outlined-action hover but neutral) |
| `--tug-base-control-outlined-option-bg-active` | atmosphere-tinted at slightly higher opacity |
| `--tug-base-control-outlined-option-fg-rest` | fg-default tone (same as outlined-action fg) |
| `--tug-base-control-outlined-option-fg-hover` | fg-default hover tone |
| `--tug-base-control-outlined-option-fg-active` | fg-default active tone |
| `--tug-base-control-outlined-option-border-rest` | fg-muted hue at muted intensity (neutral, no action-blue chroma) |
| `--tug-base-control-outlined-option-border-hover` | fg-muted hue at slightly higher intensity |
| `--tug-base-control-outlined-option-border-active` | fg-muted hue at active intensity |
| `--tug-base-control-outlined-option-icon-rest` | fg-muted icon tone |
| `--tug-base-control-outlined-option-icon-hover` | fg-muted icon hover tone |
| `--tug-base-control-outlined-option-icon-active` | fg-muted icon active tone |

**Table T02: Ghost-Option Tokens** {#t02-ghost-option-tokens}

| Token | Formula |
|-------|---------|
| `--tug-base-control-ghost-option-bg-rest` | `transparent` |
| `--tug-base-control-ghost-option-bg-hover` | shadow/highlight at low opacity (same as ghost-action hover) |
| `--tug-base-control-ghost-option-bg-active` | shadow/highlight at higher opacity |
| `--tug-base-control-ghost-option-fg-rest` | fg-muted tone (calmer than ghost-action fg) |
| `--tug-base-control-ghost-option-fg-hover` | fg-default hover tone |
| `--tug-base-control-ghost-option-fg-active` | fg-default active tone |
| `--tug-base-control-ghost-option-border-rest` | `transparent` |
| `--tug-base-control-ghost-option-border-hover` | subtle border at low opacity |
| `--tug-base-control-ghost-option-border-active` | subtle border at low opacity |
| `--tug-base-control-ghost-option-icon-rest` | fg-muted icon tone |
| `--tug-base-control-ghost-option-icon-hover` | fg-muted icon hover tone |
| `--tug-base-control-ghost-option-icon-active` | fg-muted icon active tone |

#### Component API {#component-api}

**Spec S02: TugPopupMenuItem Interface** {#s02-popup-menu-item}

```typescript
export interface TugPopupMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}
```

Identical to the current TugDropdownItem interface.

**Spec S03: TugPopupMenuProps** {#s03-popup-menu-props}

```typescript
export interface TugPopupMenuProps {
  trigger: React.ReactNode;
  items: TugPopupMenuItem[];
  onSelect: (id: string) => void;
  align?: "start" | "center" | "end";  // default: "start"
  sideOffset?: number;                  // default: em-based calculation
  "data-testid"?: string;
}
```

**Spec S04: TugPopupButtonProps** {#s04-popup-button-props}

```typescript
export interface TugPopupButtonProps {
  label: React.ReactNode;
  items: TugPopupMenuItem[];
  onSelect: (id: string) => void;
  size?: TugButtonSize;                  // default: "md"
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}
```

TugPopupButton internally creates a TugButton with emphasis="outlined", role="option", rounded="none", and `<ChevronDown size={12} />` as trailingIcon, then passes it as the trigger to TugPopupMenu.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `src/components/tugways/tug-popup-menu.tsx` | Headless popup menu component (TugPopupMenu + TugPopupMenuItem) |
| `src/components/tugways/tug-popup-button.tsx` | Convenience popup button composing TugPopupMenu + TugButton |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugPopupMenuItem` | interface | `tug-popup-menu.tsx` | Replaces TugDropdownItem |
| `TugPopupMenuProps` | interface | `tug-popup-menu.tsx` | Headless menu props with trigger ReactNode |
| `TugPopupMenu` | function component | `tug-popup-menu.tsx` | Headless behavioral layer |
| `TugPopupButtonProps` | interface | `tug-popup-button.tsx` | Convenience component props |
| `TugPopupButton` | function component | `tug-popup-button.tsx` | TugPopupMenu + TugButton composition |
| `TugButtonRole` | type (modify) | `tug-button.tsx` | Add `"option"` to union |
| `TugCheckboxRole` | type (modify) | `tug-checkbox.tsx` | Add `"option"` to union or change default |
| `TugSwitchRole` | type (modify) | `tug-switch.tsx` | Add `"option"` to union or change default |

#### Files to delete {#files-to-delete}

| File | Reason |
|------|--------|
| `src/components/tugways/tug-dropdown.tsx` | Replaced by TugPopupMenu + TugPopupButton |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test TugPopupMenu/TugPopupButton render, props, blink logic | Core component behavior |
| **Integration** | Test gallery card and tab bar with new components | Call site migration verification |
| **Golden / Contract** | Verify generated control tokens include option role | Theme derivation engine output |
| **Drift Prevention** | Grep for residual TugDropdown references | Ensure complete deletion |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add option role tokens to theme derivation engine {#step-1}

**Commit:** `feat(theme): add outlined-option and ghost-option control tokens`

**References:** [D01] Option role uses neutral fg-muted formulas, Spec S01, Tables T01-T02, (#token-naming, #context, #strategy)

**Artifacts:**
- Modified `src/components/tugways/theme-derivation-engine.ts` -- new `outlined-option` and `ghost-option` token generation blocks
- Regenerated control token output via `bun run generate:control-tokens`

**Tasks:**
- [ ] Add outlined-option token generation block after the existing outlined-agent block in `deriveTheme()`:
  - bg-rest: `transparent`
  - bg-hover/active: atmosphere-tinted (same formulas as outlined-action but using neutral text refs instead of action-blue)
  - fg-rest/hover/active: same as outlined-action fg (fg-default in light, white in dark)
  - border-rest/hover/active: use `txtRefW`/`txtAngleW` at `txtISubtle` intensity and `fgMutedTone` lightness (neutral border, no action-blue chroma)
  - icon-rest/hover/active: same as outlined-action icon (fg-muted tones)
- [ ] Add ghost-option token generation block after the existing ghost-danger block:
  - bg-rest: `transparent`
  - bg-hover/active: same shadow/highlight formulas as ghost-action
  - fg-rest/hover/active: fg-muted at rest (calmer), fg-default at hover/active
  - border-rest: `transparent`
  - border-hover/active: subtle neutral border (same as ghost-action border)
  - icon-rest/hover/active: same as ghost-action icon
- [ ] Update the token count comment at the top of the file to reflect the 24 new tokens. Note: the existing header comment is already stale -- it says "8 combinations x 4 properties x 3 states = 96 control tokens" but the engine actually has 11 emphasis-role combinations (filled-accent, filled-action, filled-danger, filled-agent, filled-data, filled-success, filled-caution, outlined-action, outlined-agent, ghost-action, ghost-danger) producing 132 emphasis-role control tokens. Fix the stale count while adding the new tokens: 13 combinations (11 + 2 new) producing 156 emphasis-role control tokens. Update the total token count accordingly.
- [ ] Run `bun run generate:control-tokens` to propagate tokens

**Tests:**
- [ ] Existing theme-derivation-engine tests pass
- [ ] Verify generated output includes all 24 new `outlined-option` and `ghost-option` tokens

**Checkpoint:**
- [ ] `bun run generate:control-tokens` completes without errors
- [ ] `bun run test -- --testPathPattern theme-derivation-engine` passes

---

#### Step 2: Add option role to TugButton types and CSS {#step-2}

**Depends on:** #step-1

**Commit:** `feat(button): add option role with outlined-option and ghost-option CSS variants`

**References:** [D01] Option role uses neutral fg-muted formulas, [D03] Remove broad data-state="open" fallback selector, Spec S01, Tables T01-T02, (#token-naming, #component-api)

**Artifacts:**
- Modified `src/components/tugways/tug-button.tsx` -- `"option"` added to `TugButtonRole` type union
- Modified `src/components/tugways/tug-button.css` -- new `.tug-button-outlined-option` and `.tug-button-ghost-option` CSS rules
- Modified `src/components/tugways/tug-menu.css` -- new open-state rules for option variants; removed broad fallback

**Tasks:**
- [ ] Add `"option"` to the `TugButtonRole` type union in `tug-button.tsx`
- [ ] Add `.tug-button-outlined-option` CSS rules in `tug-button.css` consuming `--tug-base-control-outlined-option-*` tokens (rest, hover, active states for bg, fg, border, icon -- same pattern as existing outlined-action rules)
- [ ] Add `.tug-button-ghost-option` CSS rules in `tug-button.css` consuming `--tug-base-control-ghost-option-*` tokens (same pattern as existing ghost-action rules)
- [ ] Add `[aria-disabled="true"].tug-button-outlined-option` and `[aria-disabled="true"].tug-button-ghost-option` to the chain-action disabled selector list in `tug-button.css`
- [ ] Add `.tug-button-outlined-option[data-state="open"]` and `.tug-button-ghost-option[data-state="open"]` rules in `tug-menu.css` using active-state tokens
- [ ] Remove the broad `.tug-button[data-state="open"]` selector from the `tug-menu.css` open-state rules (keep only the explicit compound selectors)

**Tests:**
- [ ] Existing TugButton tests pass
- [ ] Verify `TugButton` renders with class `tug-button-outlined-option` when role="option" emphasis="outlined"

**Checkpoint:**
- [ ] `bun run test -- --testPathPattern tug-button` passes
- [ ] Manual: render a TugButton with role="option" in the gallery and verify muted border styling

---

#### Step 3: Create TugPopupMenu component {#step-3}

**Depends on:** #step-1

**Commit:** `feat(popup-menu): extract headless TugPopupMenu from TugDropdown`

**References:** [D02] TugPopupMenu takes a single ReactNode trigger prop, [D05] Preserve CSS class names from TugDropdown, Spec S02, Spec S03, (#component-api, #strategy)

**Artifacts:**
- New file `src/components/tugways/tug-popup-menu.tsx`

**Tasks:**
- [ ] Create `tug-popup-menu.tsx` with `TugPopupMenuItem` interface (identical to current `TugDropdownItem`)
- [ ] Create `TugPopupMenuProps` interface per Spec S03: `trigger`, `items`, `onSelect`, `align`, `sideOffset`, `data-testid`
- [ ] Implement `TugPopupMenu` function component:
  - Accept `trigger` as ReactNode, wrap in `<DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>`
  - Copy blink animation logic verbatim from TugDropdown (`blinkingRef`, `handleItemSelect`, WAAPI keyframes, Escape dispatch, `.catch()` guard)
  - Copy portal + content rendering with `className="tug-dropdown-content"` (preserved per [D05])
  - Copy item rendering with `className="tug-dropdown-item"` (preserved per [D05])
  - Side offset: use a fixed pixel default (3px) when the `sideOffset` prop is not provided. Drop the em-based font-size measurement entirely. TugDropdown's em-based calculation was a nice-to-have optimization, not a requirement -- 3px works well across all current font sizes (sm/md/lg). Callers that need precise control can pass an explicit `sideOffset` prop. This avoids the complexity of obtaining a DOM ref to the trigger element, which is difficult because: (a) wrapping the trigger in a span breaks Radix's asChild prop merging (data-state, aria-expanded, handlers land on the wrapper instead of the trigger), (b) React.cloneElement is fragile in React 19, and (c) Radix Trigger with asChild does not expose a composable ref prop.
  - Import `tug-menu.css`
- [ ] Export `TugPopupMenu`, `TugPopupMenuItem`, `TugPopupMenuProps`

**Tests:**
- [ ] TugPopupMenu renders without errors when given a trigger element
- [ ] TugPopupMenu blink-then-select logic works (adapt existing TugDropdown blink tests)
- [ ] TugPopupMenu items render with `tug-dropdown-item` class

**Checkpoint:**
- [ ] `bun run test -- --testPathPattern tug-popup-menu` passes (new test file)

---

#### Step 4: Create TugPopupButton component {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `feat(popup-button): add TugPopupButton composing TugPopupMenu + TugButton`

**References:** [D04] TugPopupButton defaults are not configurable, [D02] TugPopupMenu takes a single ReactNode trigger prop, Spec S04, (#component-api, #strategy)

**Artifacts:**
- New file `src/components/tugways/tug-popup-button.tsx`

**Tasks:**
- [ ] Create `TugPopupButtonProps` interface per Spec S04: `label`, `items`, `onSelect`, `size`, `className`, `aria-label`, `data-testid`
- [ ] Implement `TugPopupButton` function component:
  - Construct a `<TugButton>` with `emphasis="outlined"`, `role="option"`, `rounded="none"`, `trailingIcon={<ChevronDown size={12} />}`, passing through `size`, `className`, `aria-label`
  - Pass the TugButton as the `trigger` prop to `<TugPopupMenu>`
  - Pass through `items`, `onSelect`, `data-testid`
- [ ] Export `TugPopupButton`, `TugPopupButtonProps`

**Tests:**
- [ ] TugPopupButton renders a TugButton trigger with class `tug-button-outlined-option`
- [ ] TugPopupButton trigger has ChevronDown trailing icon
- [ ] TugPopupButton trigger has `border-radius: 0` (rounded="none")

**Checkpoint:**
- [ ] `bun run test -- --testPathPattern tug-popup-button` passes (new test file)

---

#### Step 5: Migrate gallery preview controls to TugPopupButton {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(gallery): migrate preview controls from TugDropdown to TugPopupButton`

**References:** [D04] TugPopupButton defaults are not configurable, [D05] Preserve CSS class names from TugDropdown, (#scope, #strategy)

**Artifacts:**
- Modified `src/components/tugways/cards/gallery-card.tsx` -- all TugDropdown imports and usages replaced
- Modified `src/components/tugways/cards/gallery-card.css` -- updated comments referencing TugDropdown, rename `.cg-dropdown-demo` class
- Modified `src/components/tugways/cards/gallery-cascade-inspector-content.tsx` -- TugDropdown replaced
- Modified `src/components/tugways/cards/gallery-observable-props-content.tsx` -- TugDropdown replaced
- Modified `src/components/tugways/style-inspector-overlay.ts` -- updated component-to-token-prefix mapping and token list
- Modified `src/__tests__/gallery-card.test.tsx` -- updated title assertion from "TugDropdown" to "TugPopupButton"

**Tasks:**
- [ ] In `gallery-card.tsx`:
  - Replace `import { TugDropdown }` and `import type { TugDropdownItem }` with imports from `tug-popup-button` and `tug-popup-menu`
  - Migrate gallery button preview controls (Emphasis, Role, Size dropdowns at ~lines 191-230) to `<TugPopupButton>` -- these previously used `emphasis="ghost"`, now they get TugPopupButton's `outlined-option` default
  - Migrate gallery dropdown demo (`TugDropdownDemo` component at ~line 685) to use TugPopupButton; rename to `TugPopupButtonDemo`
  - Migrate `GalleryDropdownContent` and any remaining TugDropdown usages (badge preview controls, icon picker, etc.)
  - Update tab configuration that references "TugDropdown" title to "TugPopupButton"
  - Migrate `TugDropdownItem` type references to `TugPopupMenuItem`
- [ ] In `gallery-card.css`:
  - Update comment "TugDropdown Demo (Phase 5b)" to "TugPopupButton Demo"
  - Rename `.cg-dropdown-demo` class to `.cg-popup-button-demo` and update reference in gallery-card.tsx
  - Update comment "Trigger button for the TugDropdown demo" to reference TugPopupButton
- [ ] In `gallery-cascade-inspector-content.tsx`:
  - Replace TugDropdown import and usage with TugPopupButton
  - Update `INSPECTOR_DEMO_ITEMS` type from `TugDropdownItem[]` to `TugPopupMenuItem[]`
  - Update comments referencing TugDropdown to TugPopupButton/TugPopupMenu
- [ ] In `gallery-observable-props-content.tsx`:
  - Replace TugDropdown import and usage (font family dropdown) with TugPopupButton
- [ ] In `style-inspector-overlay.ts`:
  - No functional changes needed -- TugPopupMenu preserves CSS class names per [D05], so the inspector's `"tug-dropdown"` class-to-prefix mapping and token list remain correct. Update comments referencing TugDropdown to TugPopupMenu.
- [ ] In `gallery-card.test.tsx`:
  - Update `expect(titles).toContain("TugDropdown")` to `expect(titles).toContain("TugPopupButton")`

**Tests:**
- [ ] Existing gallery-card tests pass (with updated component name and title expectations)
- [ ] Gallery renders without console errors

**Checkpoint:**
- [ ] `bun run test -- --testPathPattern gallery` passes
- [ ] No `TugDropdown` imports remain in `src/components/tugways/cards/`

---

#### Step 6: Migrate tab bar to TugPopupMenu with custom triggers {#step-6}

**Depends on:** #step-2, #step-3

**Commit:** `refactor(tab-bar): migrate to TugPopupMenu with TugButton ghost-option triggers`

**References:** [D02] TugPopupMenu takes a single ReactNode trigger prop, [D03] Remove broad data-state="open" fallback selector, [D07] Tab bar triggers use TugButton with ghost-option role, (#scope, #strategy, #context)

**Artifacts:**
- Modified `src/components/tugways/tug-tab-bar.tsx` -- TugDropdown replaced with TugPopupMenu + TugButton ghost-option trigger elements
- Modified `src/components/tugways/tug-tab.css` -- removed trailing-icon hiding hack; updated comments to reference TugPopupMenu; reviewed and simplified override rules
- Modified `src/__tests__/tug-tab-bar.test.tsx` -- updated TugDropdown-specific assertions; kept `.tug-button` class assertions

**Tasks:**
- [ ] In `tug-tab-bar.tsx`:
  - Replace `import { TugDropdown }` and `import type { TugDropdownItem }` with imports from `tug-popup-menu` and `tug-button`
  - For the `+` type picker button (~line 537): create a `<TugButton emphasis="ghost" role="option" size="sm" className="tug-tab-add" aria-label="Add tab" data-testid="tug-tab-add">+</TugButton>` and pass it as `trigger` to `<TugPopupMenu>`. No chevron -- TugPopupMenu does not inject one.
  - For the overflow dropdown (~line 524): create a `<TugButton emphasis="ghost" role="option" size="sm" className="tug-tab-overflow-btn" aria-label="..." data-testid="tug-tab-overflow-btn"><span className="tug-tab-overflow-badge">+{N}</span></TugButton>` and pass it as `trigger` to `<TugPopupMenu>`.
  - Update `TugDropdownItem[]` type annotations to `TugPopupMenuItem[]`
- [ ] In `tug-tab.css`:
  - Remove the `.tug-tab-bar .tug-button-trailing-icon { display: none; }` rule (~line 267-269) -- no longer needed because TugPopupMenu does not inject a trailing icon
  - Update comment block references from [D06] TugDropdown to [D07] TugPopupMenu with ghost-option triggers
  - Remove [D09] ChevronDown hidden comments (no longer applicable)
  - Review `.tug-tab-bar .tug-tab-add` and `.tug-tab-bar .tug-tab-overflow-btn` override rules -- they remain valid because triggers are still TugButton instances with the same className props. Simplify comments to reference TugPopupMenu instead of TugDropdown.
- [ ] In `tug-tab-bar.test.tsx`:
  - Update test T17 description and comments to reference TugPopupMenu instead of TugDropdown
  - Keep `.tug-button` class assertion (still valid -- triggers are TugButton instances)
  - Update any assertions that check for TugDropdown-specific behavior (e.g., emphasis/role propagation)
  - Verify T17-T20 test descriptions reference the new component names

**Tests:**
- [ ] Tab bar renders `+` button with `.tug-button` class and `.tug-tab-add` class (unchanged)
- [ ] Tab bar renders `+` button without a `.tug-button-trailing-icon` element in the DOM
- [ ] Tab bar renders overflow button without a `.tug-button-trailing-icon` element
- [ ] Tab bar overflow measurement and calculation still works correctly
- [ ] Existing tab bar tests pass with adapted descriptions/comments

**Checkpoint:**
- [ ] `bun run test -- --testPathPattern tug-tab-bar` passes
- [ ] No `.tug-button-trailing-icon` elements render inside `.tug-tab-bar`

---

#### Step 7: Delete TugDropdown and update tests {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `refactor: delete TugDropdown, migrate tests to TugPopupMenu/TugPopupButton`

**References:** [D05] Preserve CSS class names from TugDropdown, Risk R02, (#scope, #strategy)

**Artifacts:**
- Deleted `src/components/tugways/tug-dropdown.tsx`
- Modified/renamed `src/__tests__/tug-dropdown.test.tsx` -- tests adapted for TugPopupMenu/TugPopupButton

**Tasks:**
- [ ] Run `grep -r "TugDropdown\|tug-dropdown" src/` to verify no remaining imports (except the test file and CSS class names which are preserved)
- [ ] Delete `src/components/tugways/tug-dropdown.tsx`
- [ ] Adapt `src/__tests__/tug-dropdown.test.tsx`:
  - Rename to `tug-popup-menu.test.tsx` (or create new test files and delete old)
  - Update imports from `tug-dropdown` to `tug-popup-menu` and `tug-popup-button`
  - Update `TugDropdownItem` to `TugPopupMenuItem`
  - Adapt render calls: basic render tests use `<TugPopupMenu trigger={<button>Test</button>} ...>` instead of `<TugDropdown label="Test" ...>`
  - Adapt blink-then-select tests for TugPopupMenu
  - Add TugPopupButton-specific tests (trigger structure with outlined-option class, ChevronDown, rounded="none")
- [ ] Verify no TypeScript compilation errors

**Tests:**
- [ ] All adapted tests pass
- [ ] No `tug-dropdown` imports remain anywhere in `src/` (CSS class names excluded)

**Checkpoint:**
- [ ] `bun run test` passes (full test suite)
- [ ] `grep -r "from.*tug-dropdown" src/` returns zero results

---

#### Step 8: TugCheckbox and TugSwitch adopt option role {#step-8}

**Depends on:** #step-1

**Commit:** `feat(checkbox,switch): default to role='option' for calmer styling`

**References:** [D06] TugCheckbox and TugSwitch default to role='option', (#scope, #strategy)

**Artifacts:**
- Modified `src/components/tugways/tug-checkbox.tsx` -- `"option"` added to `TugCheckboxRole`, default changed
- Modified `src/components/tugways/tug-switch.tsx` -- `"option"` added to `TugSwitchRole`, default changed
- Modified `src/components/tugways/tug-checkbox.css` -- option role token mapping (if needed)
- Modified `src/components/tugways/tug-switch.css` -- option role token mapping (if needed)
- Modified `src/__tests__/tug-checkbox-role.test.tsx` -- updated default-role assertions
- Modified `src/__tests__/tug-switch-role.test.tsx` -- updated default-role assertions

**Tasks:**
- [ ] In `tug-checkbox.tsx`:
  - Define `TugCheckboxRole` independently from `TugBadgeRole` (add a local type union that includes `"option"` alongside the existing 7 badge roles). This avoids coupling the checkbox role system to the badge role system.
  - Do NOT add `"option"` to `ROLE_TONE_MAP` -- the option role does not map to any `--tug-base-tone-{suffix}` token. Instead, restructure the `isRoleColored` guard into three branches:
    1. `role === "option"`: inject `--tug-toggle-on-color: var(--tug-base-fg-muted)` and `--tug-toggle-on-hover-color: var(--tug-base-fg-subtle)` directly, and set `data-role="option"`. These neutral tokens provide calm track colors without signal hue chroma.
    2. `role !== undefined && role !== "accent" && role !== "option"`: use `ROLE_TONE_MAP[role]` to inject `--tug-toggle-on-color: var(--tug-base-tone-{suffix})` and `data-role` as before.
    3. `role === undefined || role === "accent"`: no inline style, no data-role (unchanged behavior).
  - Change the default role from `"accent"` to `"option"` in the destructured props
- [ ] In `tug-switch.tsx`:
  - Same three-branch restructuring as checkbox: option=fg-muted injection, other non-accent roles=tone-map, accent/undefined=no injection. Change default to `"option"`.
- [ ] Verify that option role styling applies correctly to checked/unchecked states -- the neutral fg-muted on-state track should be visually calmer than accent-orange
- [ ] Add a code comment in both components explaining why the option role uses `--tug-base-fg-muted` directly rather than a `--tug-base-tone-*` token: the option role is intentionally neutral/achromatic and does not have a dedicated signal hue in the tone system
- [ ] In `tug-checkbox-role.test.tsx`:
  - Update "no role prop: does NOT inject inline style" test -- with option as default, the no-role-prop case now DOES inject `--tug-toggle-on-color: var(--tug-base-fg-muted)` and `--tug-toggle-on-hover-color: var(--tug-base-fg-subtle)`. Update expectations accordingly.
  - Update "no role prop: does NOT set data-role attribute" test -- with option as default, the checkbox now sets `data-role="option"`. Update expectation.
  - Keep "role=accent" tests unchanged -- explicitly passing accent still suppresses injection (accent remains the CSS-default fallback, `isRoleColored` returns false for accent).
  - Add new test: `role="option"` injects `--tug-toggle-on-color: var(--tug-base-fg-muted)` and sets `data-role="option"`.
- [ ] In `tug-switch-role.test.tsx`:
  - Same assertion updates as checkbox role tests: update no-role-prop expectations, keep explicit accent tests, add option role test.

**Tests:**
- [ ] TugCheckbox renders with option role styling by default (inline style injected, data-role="option")
- [ ] TugSwitch renders with option role styling by default
- [ ] Existing role tests pass with updated expectations (accent explicit still works, danger/action unchanged)

**Checkpoint:**
- [ ] `bun run test -- --testPathPattern "tug-checkbox|tug-switch"` passes

---

#### Step 9: Integration Checkpoint {#step-9}

**Depends on:** #step-7, #step-8

**Commit:** `N/A (verification only)`

**References:** [D01] Option role uses neutral fg-muted formulas, [D02] TugPopupMenu takes a single ReactNode trigger prop, [D03] Remove broad data-state="open" fallback selector, [D04] TugPopupButton defaults are not configurable, [D06] TugCheckbox and TugSwitch default to role='option', (#success-criteria, #scope)

**Tasks:**
- [ ] Verify all success criteria are met:
  - Generated control tokens include outlined-option and ghost-option tokens
  - Zero imports of tug-dropdown remain
  - Tab bar + button renders with no chevron
  - Gallery preview controls render with outlined-option styling
  - Broad .tug-button[data-state="open"] fallback is removed
- [ ] Verify no TypeScript errors across the entire project
- [ ] Verify no console warnings in browser during gallery card interactions
- [ ] Verify the style inspector overlay still highlights popup menu elements correctly (open a TugPopupButton menu in the gallery, activate inspector, confirm tug-dropdown-content tokens are displayed)

**Tests:**
- [ ] Full test suite passes

**Checkpoint:**
- [ ] `bun run test` passes (entire suite)
- [ ] `bun run build` completes without errors or warnings
- [ ] `grep -r "from.*tug-dropdown" src/` returns zero results
- [ ] `grep -r "\.tug-button\[data-state" src/components/tugways/tug-menu.css` returns only explicit compound selectors (no broad fallback)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A complete option role integration with TugPopupMenu/TugPopupButton replacing TugDropdown, providing calm/muted configuration control styling and clean trigger ownership inversion.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] 24 new control tokens (outlined-option + ghost-option) are generated by the theme derivation engine (verify via `bun run generate:control-tokens`)
- [ ] TugDropdown is deleted; zero imports remain (verify via `grep`)
- [ ] TugPopupMenu and TugPopupButton are the sole popup menu components
- [ ] Tab bar + and overflow buttons use TugPopupMenu with custom triggers (no chevrons)
- [ ] Gallery preview controls use TugPopupButton with outlined-option styling
- [ ] TugCheckbox and TugSwitch default to option role
- [ ] All tests pass (`bun run test`)
- [ ] Build succeeds (`bun run build`)

**Acceptance tests:**
- [ ] `bun run test` passes with zero failures
- [ ] `bun run build` completes without errors
- [ ] `grep -r "from.*tug-dropdown" src/` returns zero results

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Rename `tug-dropdown-content` / `tug-dropdown-item` CSS class names to `tug-popup-menu-content` / `tug-popup-menu-item`
- [ ] Add `filled-option` if a use case emerges
- [ ] TugSegmentedControl, TugRadioGroup, TugStepper components using option role
- [ ] Gallery card for TugPopupMenu/TugPopupButton demo (currently reuses dropdown demo slot)
- [ ] Add explicit hover/active CSS rules for `.tug-button-outlined-action` (pre-existing gap: currently relies on base `.tug-button` rules, which works but is inconsistent with other variants that have explicit compound rules)

| Checkpoint | Verification |
|------------|--------------|
| Token generation | `bun run generate:control-tokens` includes 24 option tokens |
| TugDropdown deleted | `grep -r "from.*tug-dropdown" src/` returns nothing |
| Tab bar clean | No `.tug-button-trailing-icon` inside `.tug-tab-bar` |
| Full test suite | `bun run test` passes |
| Build clean | `bun run build` succeeds |
