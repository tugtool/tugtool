<!-- tugplan-skeleton v2 -->

## Button Hierarchy Refactor {#button-hierarchy-refactor}

**Purpose:** Refactor TugButton into a typographically neutral base, introduce TugPushButton as a thin uppercase wrapper, make TugDropdown own its trigger button, restyle TugBadge for visual distinction, and migrate all call sites (TugTabBar, gallery demos, content files) to the new component hierarchy.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

TugButton currently forces `text-transform: uppercase` and wide `letter-spacing: 0.06em` at the base CSS level. This was appropriate when TugButton only served as standalone push buttons, but TugDropdown triggers, tab bar controls, and other button-like elements need mixed-case text. The `three-state` subtype was a test-only experiment with no real call sites. TugBadge is visually too similar to buttons (same uppercase, same font-weight), making it hard to distinguish informational badges from interactive buttons at a glance.

The current TugDropdown accepts a `trigger` ReactNode prop, requiring callers to manually compose `<TugButton>` with trailing chevron icons. This creates boilerplate and inconsistency. By having TugDropdown own its trigger internally, the API becomes cleaner and the cascade inspector demo continues to work since TugDropdown renders a TugButton underneath.

#### Strategy {#strategy}

- Make CSS-only changes first (strip TugButton base typography, restyle TugBadge, add TugPushButton CSS class) so visual changes land independently of TypeScript API changes.
- Add TugPushButton wrapper component without changing TugButton's type union yet, keeping the project compilable at every step.
- Migrate all TugButton call sites from `subtype="push"` to TugPushButton (or remove the prop for utility buttons) in a single atomic step that also changes the TypeScript type union -- this ensures `bunx tsc --noEmit` passes at the commit boundary.
- Refactor TugDropdown API and migrate all its callers in a single atomic step for the same reason.
- Migrate TugTabBar dropdown triggers to the new TugDropdown API with careful attention to overflow measurement CSS conflicts. Keep the tab close button as a bare `<button>` (see [D08]).
- Update all test suites to match the new component hierarchy.

#### Success Criteria (Measurable) {#success-criteria}

- Zero `subtype="push"` or `subtype="three-state"` references remain in the codebase after migration (`grep` returns no results)
- Zero bare `<button>` elements used as TugDropdown triggers remain in the codebase
- All existing tests pass after migration: `cd tugdeck && bun test`
- TugButton base CSS contains no `text-transform` or `letter-spacing` declarations
- TugBadge CSS has `font-weight: 500`, no `text-transform`, no `letter-spacing`, and `cursor: default`
- TugPushButton exists in `tug-button.tsx` and applies uppercase + letter-spacing via a CSS class

#### Scope {#scope}

1. TugButton: remove three-state subtype entirely, rename `push` to `text`, strip uppercase/letter-spacing from base CSS
2. TugPushButton: new wrapper component in tug-button.tsx
3. TugDropdown: replace `trigger` prop with label/emphasis/role/size/icon props, render own TugButton
4. TugBadge: CSS-only changes for visual distinction
5. TugTabBar: migrate [+] button and overflow button to new TugDropdown API; close button remains bare `<button>`
6. All gallery content files: migrate TugButton usages to TugPushButton or new TugDropdown API
7. All test suites: update to reflect new hierarchy

#### Non-goals (Explicitly out of scope) {#non-goals}

- Creating new emphasis/role combinations beyond the existing set
- Changing the responder chain or action dispatch system
- Modifying the theme derivation engine token structure
- Adding new visual states or animation patterns
- Converting tab close buttons to TugButton (see [D08])

#### Dependencies / Prerequisites {#dependencies}

- Existing TugButton, TugDropdown, TugBadge, TugTabBar components are stable on main
- All current tests pass before starting work

#### Constraints {#constraints}

- React 19.2.4 -- verify any lifecycle assumptions against React 19 semantics
- Rules of Tugways: no `root.render()` after initial mount, `useSyncExternalStore` for external state, `useLayoutEffect` for event-dependent registrations, appearance through CSS/DOM not React state
- Bun for all JS/TypeScript package management (use `bunx` not `npx` for CLI tools)

#### Assumptions {#assumptions}

- The `push` subtype rename to `text` is purely a TypeScript API change -- no dedicated `.tug-button-push` CSS class exists today, so no CSS renames are needed
- TugPushButton adds only `text-transform: uppercase` and `letter-spacing: 0.06em` via a wrapper CSS class; all other TugButton behavior passes through unchanged
- The new TugDropdown label/emphasis/role/size/icon props mirror corresponding TugButton props; internally TugDropdown calls TugButton with those props plus a hardwired ChevronDown trailingIcon
- The three-state subtype removal means deleting TugButtonState type, state/onStateChange props, all related CSS classes (`.tug-button-three-state`, `.tug-button-state-indicator`, `.tug-button-state-on`, `.tug-button-state-off`, `.tug-button-state-mixed`), and all related test cases -- no migration path
- TugBadge CSS changes are purely CSS file edits with no TSX API changes
- When TugDropdown's `icon` prop is provided, auto-detect and use `icon-text` subtype; otherwise use `text` subtype

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Overflow button badge rendering in new TugDropdown API (DECIDED) {#q01-overflow-badge}

**Question:** The overflow button currently renders `<span className="tug-tab-overflow-badge">+{N}</span>` with distinct badge CSS (min-width: 18px, border-radius, background-color, font-weight: 600). How should this fit the new TugDropdown API?

**Why it matters:** The overflow badge has specialized visual styling (pill shape, colored background, bold text) that serves as a compact count indicator. Converting to a plain text `label` string would lose this distinct badge styling.

**Options (if known):**
- Pass `+{N}` as a plain string label and accept the visual regression
- Pass a ReactNode label containing the styled badge span, preserving the existing badge CSS

**Plan to resolve:** Pass the existing `<span className="tug-tab-overflow-badge">+{count}</span>` as a ReactNode `label` prop. The `label` prop's type is `React.ReactNode` (not `string`), so it accepts JSX elements. This preserves the badge's distinct visual styling without any CSS changes. The `.tug-tab-overflow-badge` CSS continues to work inside the TugButton that TugDropdown renders internally.

**Resolution:** DECIDED (see [D06])

#### [Q02] Add button (+) rendering in new TugDropdown API (DECIDED) {#q02-add-button}

**Question:** The [+] add button currently renders a bare `<button>` with `+` text. How should this fit TugDropdown's new API?

**Why it matters:** This is a TugDropdown trigger with icon-like content (a plus sign), not a normal text label.

**Plan to resolve:** Pass `+` as the `label` prop. The `+` character renders as mixed-case text naturally. Use ghost emphasis, sm size, no icon prop (so it uses `text` subtype). The ChevronDown trailing icon is hidden via CSS in the tab bar context (see [D09]).

**Resolution:** DECIDED (see [D06])

#### [Q03] Tab close button: TugButton or bare button (DECIDED) {#q03-close-button}

**Question:** Should the tab close button be converted to TugButton, or kept as a bare `<button>`?

**Why it matters:** The close button uses `event.stopPropagation()` in its click handler to prevent the tab select event from firing. TugButton's `onClick` signature is `() => void`, so `event.stopPropagation()` is not available. Converting to TugButton requires a workaround (wrapper span with stopPropagation), adding complexity for no functional benefit.

**Options (if known):**
- Keep close button as bare `<button>` (simpler, no workaround needed)
- Convert to TugButton with wrapper span for stopPropagation

**Plan to resolve:** Keep the close button as a bare `<button>`. The close button is a tiny inline control inside each tab, not a dropdown trigger. It already uses CSS styling via `.tug-tab-close` that is specific to the tab bar context. Wrapping it in TugButton plus a stopPropagation shim adds complexity with no user-visible benefit.

**Resolution:** DECIDED (see [D08])

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Wide migration surface introduces regressions | med | med | Step-by-step migration with checkpoint verification at each step | Test failures after any step |
| TugDropdown API change breaks cascade inspector demo | med | low | Cascade inspector uses TugDropdown; since TugDropdown renders TugButton internally, the token chain still works | Cascade inspector visual regression |
| Tab bar overflow measurement breaks after TugButton-based triggers | high | high | Explicit CSS overrides in .tug-tab-add and .tug-tab-overflow-btn to neutralize TugButton's default sizing | Overflow computation gives wrong results |

**Risk R01: Migration surface breadth** {#r01-migration-surface}

- **Risk:** Many files across gallery content need updating; a missed call site could cause runtime errors.
- **Mitigation:** Use `grep` for `subtype="push"`, `subtype="three-state"`, `trigger={`, and bare `<button>` inside TugDropdown patterns to find all call sites before and after migration.
- **Residual risk:** Visual regressions require manual review since CSS changes affect appearance.

**Risk R02: TugDropdown trigger regression** {#r02-dropdown-trigger}

- **Risk:** Removing the `trigger` prop from TugDropdown changes the Radix composition pattern; the ChevronDown icon must render correctly.
- **Mitigation:** TugDropdown internally renders `<DropdownMenuPrimitive.Trigger asChild><TugButton ...></DropdownMenuPrimitive.Trigger>`, preserving the existing Radix asChild pattern. The `triggerRef` measurement callback is passed as TugButton's `ref` prop; Radix's `asChild` with `Trigger` automatically composes its own ref with the child element's ref.
- **Residual risk:** Radix ref forwarding must continue to work; TugButton already supports forwardRef.

**Risk R03: Tab bar overflow measurement CSS conflict** {#r03-overflow-measurement}

- **Risk:** After migrating tab bar buttons to TugDropdown (which renders TugButton internally), two sources of width change threaten overflow measurement: (1) TugButton's default sizing (`.tug-button-size-sm`: height: 1.75rem, padding: 0 1rem) conflicts with existing tab bar CSS; (2) TugDropdown always renders a ChevronDown trailing icon (12px + 0.125rem margin), which the current bare buttons do not have. The `useTabOverflow` hook queries `.tug-tab-add` and `.tug-tab-overflow-btn` via `querySelector` to measure button widths. Changed widths break the overflow algorithm, and the `OVERFLOW_BUTTON_WIDTH` bootstrap constant (40px) may no longer match.
- **Mitigation:** (1) CSS overrides via compound selectors (`.tug-tab-bar .tug-tab-add`, specificity 0,2,0) override TugButton's defaults (0,1,0) without `!important`. (2) The ChevronDown trailing icon is hidden via `.tug-tab-bar .tug-button-trailing-icon { display: none }` per [D09], eliminating extra width. After overrides, verify measured widths match `OVERFLOW_BUTTON_WIDTH` (40px).
- **Residual risk:** The measurement query selectors must target the TugButton element rendered by TugDropdown. Since TugDropdown passes `className` through to TugButton, these selectors find the correct element. TugButton's inline `border-radius` style requires either a `rounded` prop passthrough or a targeted `!important` on that single property.

---

### Design Decisions {#design-decisions}

#### [D01] TugButton becomes a typographically neutral base (DECIDED) {#d01-neutral-base}

**Decision:** Remove `text-transform: uppercase` and `letter-spacing: 0.06em` from the base `.tug-button` CSS class. TugButton renders text as-is (mixed case).

**Rationale:**
- Uppercase is a design choice for standalone action buttons, not a button-infrastructure property
- TugDropdown triggers, tab bar buttons, and other button-like elements need mixed-case text
- Making the base neutral enables TugButton to serve all button-like jobs throughout the system

**Implications:**
- All existing call sites that currently render uppercase text will now render in mixed case unless wrapped in TugPushButton
- TugPushButton wrapper adds uppercase back for standalone action buttons

#### [D02] TugPushButton wraps TugButton with uppercase styling (DECIDED) {#d02-push-button-wrapper}

**Decision:** TugPushButton is a thin wrapper component exported from `tug-button.tsx`. It passes all props through to TugButton and adds a `.tug-push-button` CSS class that applies `text-transform: uppercase` and `letter-spacing: 0.06em`.

**Rationale:**
- Separates the "allcaps action button" design choice from the button infrastructure
- Thin wrapper minimizes code duplication
- Same file export keeps the import path clean

**Implications:**
- All standalone action buttons (gallery controls, palette buttons, animator buttons) must migrate from `<TugButton subtype="push">` to `<TugPushButton>`
- TugPushButton accepts the same props as TugButton (minus subtype, which it does not expose -- it defaults to `text`)

#### [D03] Three-state subtype is deleted entirely (DECIDED) {#d03-delete-three-state}

**Decision:** Remove the `three-state` subtype from TugButton. Delete `TugButtonState` type, `state`/`onStateChange` props, internal state management, three-state click handler, CSS classes, and all related tests.

**Rationale:**
- No real usage exists -- was only a test case
- Simplifies TugButton code and reduces API surface
- If needed in the future, it can be built as a separate component

**Implications:**
- `TugButtonSubtype` type changes from `"push" | "icon" | "icon-text" | "three-state"` to `"text" | "icon" | "icon-text"`
- Gallery card demo that shows three-state buttons is removed/replaced
- All three-state test cases are removed

#### [D04] Rename `push` subtype to `text` (DECIDED) {#d04-rename-push-to-text}

**Decision:** Rename the `push` subtype value from `"push"` to `"text"` in the TugButtonSubtype union. The default subtype changes from `"push"` to `"text"`.

**Rationale:**
- `text` better describes what the subtype does: renders text content (with optional trailing icon)
- `push` was an implementation-era name that does not communicate the subtype's purpose

**Implications:**
- All call sites with `subtype="push"` must be updated to `subtype="text"` or have the prop removed (since `text` is the default)
- No CSS changes needed: no `.tug-button-push` class exists

#### [D05] TugDropdown owns its trigger button (DECIDED) {#d05-dropdown-owns-trigger}

**Decision:** TugDropdown replaces the `trigger` ReactNode prop with `label`, `emphasis`, `role`, `size`, and `icon` props. It renders a TugButton internally with a ChevronDown trailing icon. When `icon` is provided, TugDropdown uses `icon-text` subtype; otherwise `text` subtype.

**Rationale:**
- Eliminates boilerplate: callers no longer need to compose `<TugButton>` with `trailingIcon={<ChevronDown />}`
- Ensures consistent dropdown trigger appearance across the app
- Mixed-case text comes for free since the base TugButton no longer forces uppercase

**Implications:**
- TugDropdownProps changes: `trigger: React.ReactNode` is replaced by `label: React.ReactNode`, `emphasis?`, `role?`, `size?`, `icon?`
- All TugDropdown call sites must migrate to the new prop API
- Radix `<DropdownMenuPrimitive.Trigger asChild>` wraps the internal TugButton; `asChild` automatically composes Radix's internal ref with whatever ref is on the child element (TugButton's forwardRef). TugDropdown passes its `triggerRef` measurement callback as the `ref` prop on TugButton; Radix merges both refs internally.
- No manual ref composition utility is needed -- Radix's `asChild` handles ref merging.

#### [D06] Tab bar dropdown triggers use new TugDropdown API (DECIDED) {#d06-tab-bar-migration}

**Decision:** The [+] add button uses `<TugDropdown label="+" emphasis="ghost" size="sm" className="tug-tab-add" ...>`. The overflow button uses `<TugDropdown label={<span className="tug-tab-overflow-badge">+{count}</span>} emphasis="ghost" size="sm" className="tug-tab-overflow-btn" ...>`. The overflow button passes the styled badge span as a ReactNode label to preserve the existing badge visual treatment (pill shape, colored background, bold text).

**Rationale:**
- Eliminates bare `<button>` elements as dropdown triggers
- Brings tab bar dropdown triggers into the TugButton/TugDropdown component hierarchy
- Passing the badge span as ReactNode label preserves existing badge CSS without changes
- The `className` prop passes tab-bar-specific CSS classes through to the internal TugButton for styling overrides and querySelector measurement

**Implications:**
- CSS classes `.tug-tab-add` and `.tug-tab-overflow-btn` must be updated to override TugButton's default sizing properties (height, width, padding, border-radius) so measured widths remain correct for overflow computation
- The `OVERFLOW_BUTTON_WIDTH` constant (40px) must be verified against the actual rendered width after migration
- data-testid attributes are passed through to TugButton via TugDropdown's `data-testid` prop

#### [D07] TugBadge CSS restyled for visual distinction (DECIDED) {#d07-badge-restyle}

**Decision:** TugBadge CSS changes: `font-weight` from 600 to 500, remove `text-transform: uppercase`, remove `letter-spacing: 0.06em`, add `cursor: default`. No TSX API changes.

**Rationale:**
- Badges must be unmistakably informational/non-interactive, visually distinct from buttons
- Lower font-weight and mixed-case text create clear visual separation
- `cursor: default` reinforces non-interactive nature

**Implications:**
- Pure CSS change in tug-badge.css, no component API changes
- All existing TugBadge usages automatically get the new styling

#### [D09] ChevronDown trailing icon hidden in tab bar context (DECIDED) {#d09-chevron-hidden-tab-bar}

**Decision:** The ChevronDown trailing icon that TugDropdown automatically renders is hidden in the tab bar via CSS: `.tug-tab-bar .tug-button-trailing-icon { display: none }`.

**Rationale:**
- The current [+] and overflow buttons have no chevron indicator; adding one would change their visual character and measured width
- The extra chevron width (12px icon + 0.125rem margin from `.tug-button-trailing-icon`) would invalidate the `OVERFLOW_BUTTON_WIDTH` constant and break overflow measurement
- CSS hiding is the simplest approach: it is scoped to the tab bar context, requires no TugDropdown API changes, and the hidden element has no layout impact (`display: none`)

**Implications:**
- Tab bar dropdown triggers visually lack the chevron affordance that other TugDropdown triggers show
- If a chevron is desired in the future, remove the CSS rule

#### [D10] Tab bar buttons adopt TugButton ghost-action hover (DECIDED) {#d10-tab-bar-hover}

**Decision:** Tab bar add and overflow buttons adopt TugButton's ghost-action hover appearance. The old custom hover rules (`.tug-tab-add:hover` using `var(--tug-base-surface-control)` and `var(--tug-base-fg-default)`, and `.tug-tab-overflow-btn:hover` using the same) are removed.

**Rationale:**
- The purpose of migrating to TugButton/TugDropdown is visual unification; preserving custom hover rules defeats that goal
- The visual difference between ghost-action hover tokens and the old custom tokens is minor
- Removing custom hover rules reduces CSS maintenance surface
- The compound selector overrides for rest-state properties (color, cursor, background-color) persist through hover because TugButton's hover rules do not re-set those exact properties with higher specificity

**Implications:**
- Hover background and text color on tab bar add/overflow buttons will use ghost-action control tokens instead of the old `var(--tug-base-surface-control)` / `var(--tug-base-fg-default)` values
- Transition timing changes from token-based (`var(--tug-base-motion-duration-fast)` with `var(--tug-base-motion-easing-standard)`) to TugButton's hardcoded `80ms ease`. This is acceptable as part of unification -- TugButton's timing is the system standard for button controls.
- If the visual difference is unacceptable after implementation, compound-selector hover and transition overrides can be added in a follow-up

#### [D08] Tab close button remains a bare button element (DECIDED) {#d08-close-button-bare}

**Decision:** The tab close button stays as a bare `<button>` with CSS class `.tug-tab-close`. It is not converted to TugButton.

**Rationale:**
- The close button's click handler uses `event.stopPropagation()` to prevent the parent tab's click-to-select from firing. TugButton's `onClick` signature is `() => void`, so the native event is not available.
- Converting to TugButton would require a wrapper `<span onClick={e => e.stopPropagation()}>` around the TugButton, adding DOM nesting and complexity for no user-visible benefit.
- The close button is a tiny inline control (not a dropdown trigger) with tab-bar-specific CSS styling; it is already well-served by a bare button.

**Implications:**
- The tab close button is an intentional exception to the "no bare buttons" migration goal
- The scope of "zero bare buttons" applies specifically to TugDropdown triggers, not all buttons in the system

---

### Specification {#specification}

#### TugButton Subtype Union (after refactor) {#spec-subtype-union}

**Spec S01: TugButtonSubtype** {#s01-subtype-union}

```typescript
export type TugButtonSubtype = "text" | "icon" | "icon-text";
```

Default: `"text"` (was `"push"`).

#### TugPushButton Props {#spec-pushbutton-props}

**Spec S02: TugPushButtonProps** {#s02-pushbutton-props}

```typescript
export interface TugPushButtonProps extends Omit<TugButtonProps, 'subtype'> {}
```

TugPushButton:
- Passes all props through to TugButton
- Adds `.tug-push-button` CSS class
- Does not expose `subtype` prop (always uses `text` default)

#### TugPushButton CSS {#spec-pushbutton-css}

**Spec S03: TugPushButton CSS class** {#s03-pushbutton-css}

```css
.tug-push-button {
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

#### TugDropdown Props (after refactor) {#spec-dropdown-props}

**Spec S04: TugDropdownProps** {#s04-dropdown-props}

```typescript
export interface TugDropdownProps {
  /** Trigger button label content. Accepts string or ReactNode (e.g., styled badge span). */
  label: React.ReactNode;
  /** Trigger button emphasis. Default: "outlined". */
  emphasis?: TugButtonEmphasis;
  /** Trigger button role. Default: "action". */
  role?: TugButtonRole;
  /** Trigger button size. Default: "md". */
  size?: TugButtonSize;
  /** Optional leading icon for the trigger button. When provided, uses icon-text subtype. */
  icon?: React.ReactNode;
  /** List of items to display in the dropdown. */
  items: TugDropdownItem[];
  /** Called with the selected item's id when an item is clicked. */
  onSelect: (id: string) => void;
  /** Additional CSS class names for the trigger button. */
  className?: string;
  /** aria-label for the trigger button. */
  "aria-label"?: string;
  /** data-testid for the trigger button. */
  "data-testid"?: string;
}
```

#### TugBadge CSS (after refactor) {#spec-badge-css}

**Spec S05: TugBadge base CSS** {#s05-badge-css}

```css
.tug-badge {
  /* ... existing layout properties ... */
  font-weight: 500;        /* was 600 */
  /* text-transform removed */
  /* letter-spacing removed */
  cursor: default;          /* new */
}
```

#### Tab bar CSS overrides for TugButton-based triggers {#spec-tab-css-overrides}

**Spec S06: Tab bar trigger CSS overrides** {#s06-tab-css-overrides}

After migration, `.tug-tab-add` and `.tug-tab-overflow-btn` are applied to TugButton elements (rendered by TugDropdown) rather than bare `<button>` elements. These CSS rules must override TugButton's defaults to maintain identical dimensions for overflow measurement and preserve the current visual appearance.

Override strategy: use compound selectors (e.g., `.tug-tab-bar .tug-tab-add`) instead of `!important`. The compound selector has specificity 0,2,0 which reliably overrides `.tug-button-size-sm` (0,1,0) and `.tug-button-ghost-action` (0,1,0). One exception: TugButton applies `border-radius` via inline `style` attribute (from `ROUNDED_MAP`; size sm defaults to `ROUNDED_MAP['lg']` = `0.5rem` / 8px), which no selector can override -- use `border-radius: 0 !important` as a targeted single-property exception.

Properties to override via `.tug-tab-bar .tug-tab-add` and `.tug-tab-bar .tug-tab-overflow-btn`:

| Property | TugButton default | Tab bar override | Why |
|----------|-------------------|------------------|-----|
| `height` | `1.75rem` (`.tug-button-size-sm`) | `100%` | Fill tab bar height |
| `padding` | `0 1rem` (`.tug-button-size-sm`) | Add: `0 0 5px 0`; Overflow: `0 var(--tug-base-space-sm)` | Preserve current dimensions |
| `border` | `1px solid ...` | `none` | No border in tab bar |
| `border-radius` | `0.5rem` / 8px (inline style via `ROUNDED_MAP['lg']`) | `0 !important` | No pill shape; inline style requires !important |
| `font-size` | `0.75rem` (12px) | Add: `var(--tug-base-font-size-lg)` (~16px); Overflow: `var(--tug-base-font-size-sm)` (~13px) | Preserve current glyph sizes |
| `cursor` | `pointer` | `default` | Tab bar buttons use default cursor |
| `color` | `var(--tug-base-control-ghost-action-fg-rest)` | `var(--tug-base-fg-muted)` | Preserve current muted text color |
| `background-color` | `var(--tug-base-control-ghost-action-bg-rest)` | `transparent` | Preserve current transparent rest state |

Hover states: tab bar buttons adopt TugButton's ghost-action hover behavior per [D10]. The old custom hover rules (`.tug-tab-add:hover`, `.tug-tab-overflow-btn:hover`) are removed. TugButton's ghost-action hover rules apply naturally. The compound selector `cursor: default` persists through hover since TugButton's hover rules do not re-set cursor.

ChevronDown hiding in tab bar context ([D09]):
```css
.tug-tab-bar .tug-button-trailing-icon {
  display: none;
}
```

The `OVERFLOW_BUTTON_WIDTH` constant (40px in `tab-overflow.ts`) must be verified against the actual rendered width after these overrides are applied. If it no longer matches, update the constant.

**Table T01: Call site migration map** {#t01-migration-map}

| File | Current Pattern | New Pattern |
|------|----------------|-------------|
| gallery-card.tsx | 10x `<TugButton subtype="push" ...>` | `<TugPushButton ...>` |
| gallery-card.tsx | `<TugButton subtype="three-state" ...>` | Remove/replace with TugPushButton demo |
| gallery-card.tsx | `ALL_SUBTYPES` array includes `"push"`, `"three-state"` | Update to `["text", "icon", "icon-text"]` |
| gallery-card.tsx | 7x `<TugDropdown trigger={<TugButton ...>}` (emphasis/role/size pickers x3, TugDropdownDemo x1, badge emphasis/role pickers x2, CardTitleBar icon picker x1) | `<TugDropdown label="..." emphasis="ghost" size="sm" ...>` |
| gallery-cascade-inspector-content.tsx | 1x `<TugDropdown trigger={<TugButton ...>}` | `<TugDropdown label="..." emphasis="ghost" size="sm" ...>` |
| gallery-cascade-inspector-content.tsx | 4x `<TugButton subtype="push" ...>` | `<TugPushButton ...>` |
| gallery-scale-timing-content.tsx | 8x `<TugButton subtype="push" ...>` | `<TugPushButton ...>` |
| gallery-animator-content.tsx | 13x `<TugButton subtype="push" ...>` | `<TugPushButton ...>` |
| gallery-palette-content.tsx | `<TugButton ...>` (ghost emphasis, no subtype) | Unchanged -- already uses default subtype |
| gallery-observable-props-content.tsx | 1x `<TugDropdown trigger={<TugButton ...>}` | `<TugDropdown label="..." emphasis="ghost" size="sm" ...>` |
| gallery-theme-generator-content.tsx | `<TugButton ...>` (ghost/outlined, no subtype) | Unchanged -- already uses default subtype, no TugDropdown usage |
| tug-tab-bar.tsx | 2x `<TugDropdown trigger={<button ...>}` ([+] and overflow) | `<TugDropdown label=... emphasis="ghost" size="sm" className=... ...>` |
| tug-tab-bar.tsx | `<button class="tug-tab-close">` | Unchanged -- bare `<button>` kept per [D08] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| None | All changes are to existing files |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugPushButton` | component | `tug-button.tsx` | New wrapper component, exported |
| `TugPushButtonProps` | interface | `tug-button.tsx` | Omits subtype from TugButtonProps |
| `.tug-push-button` | CSS class | `tug-button.css` | Uppercase + letter-spacing |
| `TugButtonSubtype` | type | `tug-button.tsx` | Change from `"push"\|"icon"\|"icon-text"\|"three-state"` to `"text"\|"icon"\|"icon-text"` |
| `TugButtonState` | type | `tug-button.tsx` | Delete |
| `state` | prop | `tug-button.tsx` | Delete from TugButtonProps |
| `onStateChange` | prop | `tug-button.tsx` | Delete from TugButtonProps |
| `TugDropdownProps.trigger` | prop | `tug-dropdown.tsx` | Delete, replace with label/emphasis/role/size/icon |
| `TugDropdownProps.label` | prop | `tug-dropdown.tsx` | New: trigger button label (ReactNode) |
| `TugDropdownProps.emphasis` | prop | `tug-dropdown.tsx` | New: trigger button emphasis |
| `TugDropdownProps.role` | prop | `tug-dropdown.tsx` | New: trigger button role |
| `TugDropdownProps.size` | prop | `tug-dropdown.tsx` | New: trigger button size |
| `TugDropdownProps.icon` | prop | `tug-dropdown.tsx` | New: trigger button icon |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test TugButton subtypes, TugPushButton wrapper, TugDropdown trigger rendering | Core component behavior |
| **Integration** | Test TugTabBar with new TugDropdown API, gallery card rendering | Components working together |
| **Regression** | Verify no three-state or push references remain, all emphasis/role combos still work | Ensuring clean migration |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: CSS-only changes -- neutralize TugButton typography, add TugPushButton class, restyle TugBadge {#step-1}

**Commit:** `style: neutralize TugButton base typography, add TugPushButton class, restyle TugBadge`

**References:** [D01] TugButton neutral base, [D02] TugPushButton wrapper, [D07] TugBadge restyle, Spec S03, Spec S05, (#context, #strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-button.css`
- Modified `tugdeck/src/components/tugways/tug-badge.css`

**Tasks:**
- [ ] In `tug-button.css`: remove `text-transform: uppercase` and `letter-spacing: 0.06em` from `.tug-button` base class
- [ ] In `tug-button.css`: remove the entire "Three-State Subtype" CSS section (`.tug-button-three-state`, `.tug-button-state-indicator`, `.tug-button-state-on`, `.tug-button-state-off`, `.tug-button-state-mixed`)
- [ ] In `tug-button.css`: add `.tug-push-button` class with `text-transform: uppercase` and `letter-spacing: 0.06em` (per Spec S03)
- [ ] In `tug-badge.css`: change `font-weight: 600` to `font-weight: 500` in `.tug-badge` base class
- [ ] In `tug-badge.css`: remove `letter-spacing: 0.06em` from `.tug-badge` base class
- [ ] In `tug-badge.css`: remove `text-transform: uppercase` from `.tug-badge` base class
- [ ] In `tug-badge.css`: add `cursor: default` to `.tug-badge` base class

**Tests:**
- [ ] T01: Existing TugBadge tests still pass (no API changes)
- [ ] T02: Existing TugButton tests still pass (CSS-only changes do not affect RTL test assertions)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tug-badge.test.tsx`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tug-button.test.tsx`

---

#### Step 2: Add TugPushButton wrapper component (TSX only, no type union change yet) {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tug-button): add TugPushButton uppercase wrapper component`

**References:** [D02] TugPushButton wrapper, Spec S02, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-button.tsx` (new export)

**Tasks:**
- [ ] In `tug-button.tsx`: define `TugPushButtonProps` as `Omit<TugButtonProps, 'subtype'>`
- [ ] In `tug-button.tsx`: implement `TugPushButton` as `React.forwardRef` that renders `<TugButton>` with the additional `tug-push-button` className merged via `cn()`
- [ ] Export `TugPushButton` and `TugPushButtonProps`
- [ ] Note: do NOT change `TugButtonSubtype` or remove three-state yet -- the type union stays as-is to keep the project compilable

**Tests:**

Tests T03-T07 are specified here but written to the test file in Step 3 (which modifies `tug-button.test.tsx` as part of the atomic migration). Step 2's checkpoint verifies only that TugPushButton compiles.

- [ ] T03: TugPushButton renders a button element
- [ ] T04: TugPushButton applies `.tug-push-button` class
- [ ] T05: TugPushButton forwards all TugButton props (emphasis, role, size)
- [ ] T06: TugPushButton forwards ref to underlying button element
- [ ] T07: TugPushButton calls onClick when clicked

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`

---

#### Step 3: Atomic TugButton migration -- change type union, remove three-state, migrate all call sites, update tests {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tug-button): remove three-state, rename push to text, migrate all call sites`

**References:** [D03] Delete three-state, [D04] Rename push to text, Spec S01, Table T01, (#strategy, #success-criteria)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-button.tsx`
- Modified `tugdeck/src/__tests__/tug-button.test.tsx`
- Modified `tugdeck/src/components/tugways/cards/gallery-card.tsx`
- Modified `tugdeck/src/components/tugways/cards/gallery-scale-timing-content.tsx`
- Modified `tugdeck/src/components/tugways/cards/gallery-animator-content.tsx`
- Modified `tugdeck/src/components/tugways/cards/gallery-cascade-inspector-content.tsx`

**Tasks:**
- [ ] In `tug-button.tsx`: change `TugButtonSubtype` from `"push" | "icon" | "icon-text" | "three-state"` to `"text" | "icon" | "icon-text"`
- [ ] In `tug-button.tsx`: delete `TugButtonState` type export
- [ ] In `tug-button.tsx`: remove `state`, `onStateChange` from `TugButtonProps` interface
- [ ] In `tug-button.tsx`: change default subtype from `"push"` to `"text"` in the destructuring
- [ ] In `tug-button.tsx`: remove the `useState(state)` / `useEffect` for internalState (three-state internal state management)
- [ ] In `tug-button.tsx`: remove the three-state case from `renderSubtypeContent()` switch
- [ ] In `tug-button.tsx`: remove `ariaPressed` computation and its usage in the JSX
- [ ] In `tug-button.tsx`: remove three-state CSS class generation from `buttonClassName` (`tug-button-three-state`, `tug-button-state-${internalState}`)
- [ ] In `tug-button.tsx`: remove three-state click handler branch from `handleClick`
- [ ] In `tug-button.tsx`: rename `case "push":` to `case "text":` in `renderSubtypeContent()` (or merge into default case)
- [ ] In `tug-button.tsx`: update JSDoc comments to reflect new subtype list (three subtypes: text, icon, icon-text)
- [ ] In `gallery-card.tsx`: update `ALL_SUBTYPES` array from `["push", "icon", "icon-text", "three-state"]` to `["text", "icon", "icon-text"]`
- [ ] In `gallery-card.tsx`: replace all `<TugButton subtype="push" ...>` with `<TugPushButton ...>` (remove subtype prop). Import `TugPushButton`.
- [ ] In `gallery-card.tsx`: remove three-state button demo section (the `<TugButton subtype="three-state" ...>` in ButtonSubtypeDemo)
- [ ] In `gallery-card.tsx`: remove `TugButtonState` import if present
- [ ] In `gallery-scale-timing-content.tsx`: replace all 8 `<TugButton subtype="push" ...>` with `<TugPushButton ...>`. Import `TugPushButton`.
- [ ] In `gallery-animator-content.tsx`: replace all 13 `<TugButton subtype="push" ...>` with `<TugPushButton ...>`. Import `TugPushButton`.
- [ ] In `gallery-cascade-inspector-content.tsx`: replace all 4 `<TugButton subtype="push" ...>` with `<TugPushButton ...>`. Import `TugPushButton`.
- [ ] In `tug-button.test.tsx`: remove entire `TugButton -- three-state subtype` describe block
- [ ] In `tug-button.test.tsx`: update `TugButton -- push subtype` describe block: rename to `TugButton -- text subtype`, remove `subtype: "push"` props (text is default)
- [ ] In `tug-button.test.tsx`: update trailingIcon tests: remove `subtype="push"` props
- [ ] In `tug-button.test.tsx`: add `TugPushButton` describe block with tests T03-T07. Import `TugPushButton`.

**Tests:**
- [ ] T08: `TugButtonSubtype` no longer includes `"push"` or `"three-state"` (TypeScript compilation)
- [ ] T09: `TugButtonState` type no longer exported (TypeScript compilation)
- [ ] T10: All updated TugButton tests pass
- [ ] T11: All new TugPushButton tests pass

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tug-button.test.tsx`
- [ ] `grep -r 'subtype="push"' /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/ --include='*.tsx'` returns no results
- [ ] `grep -r 'subtype="three-state"' /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/ --include='*.tsx'` returns no results

---

#### Step 4: Atomic TugDropdown migration -- refactor API and migrate all callers {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(tug-dropdown): replace trigger prop with label/emphasis/role/size/icon, migrate all callers`

**References:** [D05] TugDropdown owns trigger, Spec S04, Table T01, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-dropdown.tsx`
- Modified `tugdeck/src/__tests__/tug-dropdown.test.tsx`
- Modified `tugdeck/src/components/tugways/cards/gallery-card.tsx`
- Modified `tugdeck/src/components/tugways/cards/gallery-cascade-inspector-content.tsx`
- Modified `tugdeck/src/components/tugways/cards/gallery-observable-props-content.tsx`

**Tasks:**
- [ ] In `tug-dropdown.tsx`: replace `TugDropdownProps.trigger` with `label`, `emphasis?`, `role?`, `size?`, `icon?`, `className?`, `aria-label?`, `data-testid?` props per Spec S04
- [ ] In `tug-dropdown.tsx`: import `TugButton` from `./tug-button` and `ChevronDown` from `lucide-react`
- [ ] In `tug-dropdown.tsx`: import `TugButtonEmphasis`, `TugButtonRole`, `TugButtonSize` types from `./tug-button`
- [ ] In `tug-dropdown.tsx`: change `triggerRef` callback parameter type from `HTMLElement | null` to `HTMLButtonElement | null`. The current type `(node: HTMLElement | null) => void` is not assignable to TugButton's `Ref<HTMLButtonElement>` because callback ref parameters are contravariant. The fix: `const triggerRef = useCallback((node: HTMLButtonElement | null) => { ... }, [])`. The function body only calls `getComputedStyle(node)` which accepts any `Element`, so narrowing to `HTMLButtonElement` is safe.
- [ ] In `tug-dropdown.tsx`: determine subtype as `icon ? "icon-text" : "text"` based on whether `icon` prop is provided
- [ ] In `tug-dropdown.tsx`: render `<DropdownMenuPrimitive.Trigger asChild><TugButton ref={triggerRef} subtype={subtype} emphasis={emphasis} role={role} size={size} icon={icon} trailingIcon={<ChevronDown size={12} />} className={className} aria-label={ariaLabel} data-testid={dataTestId}>{label}</TugButton></DropdownMenuPrimitive.Trigger>`. Radix's `Trigger` with `asChild` automatically composes its own internal ref with TugButton's `ref` prop -- no manual ref merging utility is needed. The `triggerRef` callback (used for sideOffset font-size measurement) is passed directly as the `ref` prop on TugButton.
- [ ] In `tug-dropdown.tsx`: update JSDoc comments
- [ ] In `gallery-card.tsx`: replace all 7 `<TugDropdown trigger={<TugButton ...>}` patterns with `<TugDropdown label="..." emphasis="ghost" size="sm" ...>`. The 7 call sites are: emphasis picker, role picker, size picker (in ButtonSubtypeDemo controls), TugDropdownDemo, badge emphasis picker, badge role picker, and CardTitleBar icon picker.
- [ ] In `gallery-cascade-inspector-content.tsx`: replace 1 `<TugDropdown trigger={<TugButton ...>}` with `<TugDropdown label="..." emphasis="ghost" size="sm" ...>`
- [ ] In `gallery-observable-props-content.tsx`: replace 1 `<TugDropdown trigger={<TugButton ...>}` with `<TugDropdown label="..." emphasis="ghost" size="sm" ...>`
- [ ] In `tug-dropdown.test.tsx`: update `renderDropdown` helper from `trigger={<button>Open</button>}` to `label="Open"`
- [ ] In `tug-dropdown.test.tsx`: add tests T12-T16

**Tests:**
- [ ] T12: TugDropdown renders a TugButton as its trigger (has `.tug-button` class)
- [ ] T13: TugDropdown trigger shows the label text
- [ ] T14: TugDropdown trigger includes ChevronDown trailing icon (`.tug-button-trailing-icon` present)
- [ ] T15: TugDropdown with icon prop uses icon-text subtype (has `.tug-button-icon-text` class)
- [ ] T16: TugDropdown without icon prop uses text subtype (no `.tug-button-icon-text` class)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tug-dropdown.test.tsx`

---

#### Step 5: Migrate TugTabBar dropdown triggers to new TugDropdown API {#step-5}

**Depends on:** #step-4

**Commit:** `refactor(tug-tab-bar): migrate dropdown triggers to new TugDropdown API`

**References:** [D06] Tab bar dropdown migration, [D08] Close button bare, [D09] Chevron hidden in tab bar, [D10] Tab bar hover unification, [D05] TugDropdown owns trigger, Spec S06, Table T01, Risk R03, (#strategy)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-tab-bar.tsx`
- Modified `tugdeck/src/components/tugways/tug-tab.css`

**Tasks:**
- [ ] Replace the [+] add button from `trigger={<button type="button" className="tug-tab-add" ...>+</button>}` to `<TugDropdown label="+" emphasis="ghost" size="sm" className="tug-tab-add" aria-label="Add tab" data-testid="tug-tab-add" ...>`
- [ ] Replace the overflow button from `trigger={<button type="button" className="tug-tab-overflow-btn" ...><span className="tug-tab-overflow-badge">+{count}</span></button>}` to `<TugDropdown label={<span className="tug-tab-overflow-badge">+{overflowTabs.length}</span>} emphasis="ghost" size="sm" className="tug-tab-overflow-btn" aria-label={`${overflowTabs.length} more tabs`} data-testid="tug-tab-overflow-btn" ...>`. The styled badge span is passed as a ReactNode label to preserve the existing `.tug-tab-overflow-badge` CSS (pill shape, colored background, bold text).
- [ ] Keep the close button as a bare `<button>` per [D08] -- no changes to close button rendering
- [ ] In `tug-tab.css`: rewrite `.tug-tab-add` rules using compound selector `.tug-tab-bar .tug-tab-add` (specificity 0,2,0). Override all conflicting TugButton properties per Spec S06 table: `height: 100%`, `padding: 0 0 5px 0`, `border: none`, `border-radius: 0 !important` (inline style exception), `font-size: var(--tug-base-font-size-lg)`, `cursor: default`, `color: var(--tug-base-fg-muted)`, `background-color: transparent`. Keep existing `width: var(--tug-base-chrome-height)` and `flex-shrink: 0`.
- [ ] In `tug-tab.css`: rewrite `.tug-tab-overflow-btn` rules using compound selector `.tug-tab-bar .tug-tab-overflow-btn` (specificity 0,2,0). Override: `height: 100%`, `padding: 0 var(--tug-base-space-sm)`, `border: none`, `border-radius: 0 !important`, `font-size: var(--tug-base-font-size-sm)`, `cursor: default`, `color: var(--tug-base-fg-muted)`, `background-color: transparent`. Keep existing `flex-shrink: 0`.
- [ ] In `tug-tab.css`: remove old hover rules `.tug-tab-add:hover`, `.tug-tab-add[data-state="open"]`, `.tug-tab-overflow-btn:hover` per [D10]. TugButton's ghost-action hover rules apply naturally.
- [ ] In `tug-tab.css`: add chevron hiding rule per [D09]: `.tug-tab-bar .tug-button-trailing-icon { display: none }`. This hides the ChevronDown trailing icon that TugDropdown auto-renders, preserving the current visual appearance and measured widths of tab bar buttons.
- [ ] Verify `useTabOverflow` measurement queries: `.tug-tab-add` selector will find the TugButton element because the `className` prop passes through to TugButton. `.tug-tab-overflow-btn` selector similarly targets the TugButton element. Confirm the DOM structure: TugDropdown renders `<TugButton className="tug-tab-add" ...>` which renders `<button class="tug-button tug-tab-add ...">`. The querySelector `.tug-tab-add` matches this element.
- [ ] Verify `OVERFLOW_BUTTON_WIDTH` (40px in `tab-overflow.ts`) still matches the actual rendered width of the overflow button after CSS overrides. The overflow button's width is determined by `padding: 0 var(--tug-base-space-sm)` + badge content. If this differs from 40px, update the constant.
- [ ] Preserve all data-testid attributes for test compatibility

**Tests:**
- [ ] T17: Tab bar renders [+] button via TugDropdown (button element with `.tug-tab-add` class and data-testid present)
- [ ] T18: Overflow button renders via TugDropdown when overflow tabs exist (button element with `.tug-tab-overflow-btn` class)
- [ ] T19: Overflow badge span (`.tug-tab-overflow-badge`) is rendered inside the trigger button
- [ ] T20: All existing TugTabBar tests still pass (data-testid attributes preserved)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/tug-tab-bar.test.tsx`

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-1, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] TugButton neutral base, [D02] TugPushButton wrapper, [D03] Delete three-state, [D04] Rename push to text, [D05] TugDropdown owns trigger, [D06] Tab bar dropdown migration, [D07] TugBadge restyle, [D08] Close button bare, (#success-criteria)

**Tasks:**
- [ ] Verify zero `subtype="push"` references remain in tsx files
- [ ] Verify zero `subtype="three-state"` references remain in tsx files
- [ ] Verify zero `trigger={` prop references remain in TugDropdown call sites (gallery files and tug-tab-bar.tsx)
- [ ] Verify zero bare `<button>` elements used as TugDropdown triggers in tug-tab-bar.tsx (close button is intentionally bare per [D08], but is not a dropdown trigger)
- [ ] Verify TugButton base CSS has no `text-transform` or `letter-spacing`
- [ ] Verify TugBadge CSS has `font-weight: 500`, no `text-transform`, no `letter-spacing`, `cursor: default`
- [ ] Verify gallery-palette-content.tsx and gallery-theme-generator-content.tsx compile without changes (their TugButton usages use default subtype, no TugDropdown patterns)

**Tests:**
- [ ] All test suites pass: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `grep -r 'subtype="push"' /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/ --include='*.tsx'` returns no results
- [ ] `grep -r 'subtype="three-state"' /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/ --include='*.tsx'` returns no results
- [ ] `grep -rn 'trigger={' /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/components/tugways/tug-tab-bar.tsx /Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/components/tugways/cards/` returns no results

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** TugButton is a typographically neutral base; TugPushButton handles uppercase action buttons; TugDropdown owns its trigger; TugBadge is visually distinct from buttons; all call sites are migrated.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero `subtype="push"` or `subtype="three-state"` references in tsx files (grep verification)
- [ ] Zero bare `<button>` TugDropdown triggers (grep verification)
- [ ] All test suites pass: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] TypeScript compiles cleanly: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`

**Acceptance tests:**
- [ ] T_FINAL_01: `bun test` passes all test files
- [ ] T_FINAL_02: `bunx tsc --noEmit` has zero errors
- [ ] T_FINAL_03: grep for deprecated patterns returns empty

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Visual regression testing with screenshots (manual review)
- [ ] Consider whether TugPushButton should support size presets different from TugButton
- [ ] Consider icon-only TugDropdown variant for compact toolbar contexts
- [ ] Consider converting tab close button to TugButton if onClick signature is changed to accept events in the future

| Checkpoint | Verification |
|------------|--------------|
| All tests pass | `cd tugdeck && bun test` |
| TypeScript clean | `cd tugdeck && bunx tsc --noEmit` |
| No deprecated patterns | grep for `subtype="push"`, `subtype="three-state"`, `trigger={` |
