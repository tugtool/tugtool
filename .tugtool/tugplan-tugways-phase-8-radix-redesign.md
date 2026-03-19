<!-- tugplan-skeleton v2 -->

## Tugways Phase 8 -- Radix Foundation & Control State Visual Identity {#phase-8-radix-redesign}

**Purpose:** Replace shadcn with direct Radix primitives as the component foundation, define a token-driven control state visual language where every control property (bg, fg, border, icon) responds independently to rest/hover/active states, and build the Tugways component library across sub-phases (8a--8i) covering components, chrome, alerts, inspectors, and dock.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-11 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

shadcn was adopted as a convenience layer over Radix. In practice, it has become a liability. shadcn components ship with Tailwind utility strings (now converted to semantic CSS in `shadcn-base.css`, but still carrying shadcn's design opinions). Every Tug component must override these opinions. The current architecture is: Radix primitive -> shadcn wrapper in `components/ui/` -> Tug wrapper in `components/tugways/`. With direct Radix wrapping, this collapses to: Radix primitive -> Tug component. One layer instead of two. Phase 7d already prohibits installing new shadcn components. We removed Tailwind. The shadcn CLI is incompatible with our build. Only 2 shadcn components are actively used in app code (Button and DropdownMenu); `scaffold.test.tsx` also imports shadcn Button directly. The `cn()` utility in `lib/utils.ts` depends only on `clsx` and is retained. There is no path forward with shadcn.

The current tugdeck frontend is approximately 9700 lines of TypeScript/CSS across ~60 source files. The transport, settings, layout engine, card layer, and chrome layers are all retained. The `components/ui/` shadcn layer (~600 lines, 13 files) and `shadcn-base.css` (~25KB) are removed. Radix primitives provide exactly what we need: accessible by default (ARIA roles, keyboard navigation, focus management), unstyled (zero visual opinions), composable (compound component patterns), and presence management (enter/exit animations via `data-state`). We already have 10 Radix packages installed.

#### Strategy {#strategy}

- Remove shadcn entirely before building anything new (clean foundation first)
- Define the control state visual language on TugButton as the reference implementation, then apply it to all subsequent components
- Build the card title bar early (Phase 8c) with basic close -- defer close confirmation until the alert system exists in Phase 8g
- Build form controls one at a time interactively, tuning styles in the Component Gallery before moving to the next control
- Converge on alerts (Phase 8g) which depends on both form controls and the title bar
- Build inspectors and dock last, as they depend on the full component library
- Every component follows the same CSS pattern: `--tug-base-control-{variant}-{property}-{state}` tokens, per-component CSS file

#### Success Criteria (Measurable) {#success-criteria}

> Make these falsifiable. Avoid "works well".

- Zero shadcn imports in production code after Step 1 (`grep -r "components/ui" tugdeck/src/ --include="*.tsx" --include="*.ts"` returns 0 results, excluding `_archive/`)
- All 31 components render correctly in the Component Gallery across all three themes (Brio, Bluenote, Harmony)
- All form controls pass WCAG 2.1 AA keyboard navigation (Tab, Shift+Tab, Enter, Escape, Arrow keys as applicable)
- `bun run build` succeeds with zero warnings
- All existing tests pass (`bun test`)
- Window-shade collapse persists across reloads (serialize collapsed state, reload, verify collapsed cards remain collapsed)
- `tugAlert()` returns a Promise that resolves to the clicked button role
- Inspector panels update when focused card changes (switch focus, verify inspector reflects new card's properties)
- Dock placement persists across reloads (change dock edge, reload, verify dock appears on the correct edge)

#### Scope {#scope}

1. Remove all shadcn artifacts (components/ui/, shadcn-base.css, components.json, CVA)
2. Define and implement the control state visual language: token-driven bg/fg/border/icon across rest/hover/active states
3. Build Tug components across 6 tiers (form controls, display/feedback, navigation/overlay, data display, visualization, compositions) — one at a time, interactively tuned
4. Rebuild card title bar with window-shade collapse, token-driven controls, close confirmation
5. Full alert system (TugAlert, TugSheet, TugConfirmPopover, TugToast)
6. Inspector panels (color picker, font picker, coordinate inspector, inspector panel)
7. Dock rewrite with three button types and edge placement

#### Non-goals (Explicitly out of scope) {#non-goals}

- Card content rebuild (Phase 9 -- depends on component library existing, agnostic to implementation layer)
- Responder chain infrastructure changes beyond modal support (Phase 5x -- already built); Step 7 adds `modalScope` and node suspension specifically for TugAlert and TugSheet
- Mutation model or observable properties changes (Phase 5x -- already built)
- New card types (Phase 9)
- Mobile or touch interaction patterns

#### Dependencies / Prerequisites {#dependencies}

- Phase 7d (Glitch Reduction) is complete -- provides stable rendering foundation
- Phase 5x infrastructure (responder chain, mutation model, observable properties, palette engine) is complete
- 10 Radix packages already installed
- Sonner library to be installed in Step 7 for toast integration

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` in `.cargo/config.toml` for tugcode; zero-warning builds for tugdeck)
- Never use npm -- always use bun for package management
- Never call `root.render()` after initial mount (Rules of Tugways D40, D42)
- Read external state with `useSyncExternalStore` only (Rules of Tugways D40)
- Use `useLayoutEffect` for registrations that events depend on (Rules of Tugways D41)
- Appearance changes go through CSS and DOM, never React state (Rules of Tugways D08, D09)
- React 19.2.4 -- verify all lifecycle behavior against React 19 semantics

#### Assumptions {#assumptions}

- Radix primitives are stable and will not have breaking changes during Phase 8
- The control state token model works across all three themes (Brio dark, Bluenote dark, Harmony light) with per-theme token overrides only
- Sonner integrates cleanly with our CSS token system for toast styling
- The existing 10 Radix packages cover the majority of needed primitives; only a few new packages need to be installed

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

> Open questions are tracked work. If a question remains open at phase-end, explicitly defer it with a rationale and a follow-up plan.

#### [Q01] Gradient exception for accent buttons (RESOLVED) {#q01-accent-gradient}

**Question:** Should accent-colored controls (primary buttons) use a very subtle (<5% opacity) top-to-bottom gradient for richer appearance?

**Resolution:** RESOLVED — No gradients. The control state model uses flat color tokens for all states. Depth comes from progressive lightening across rest → hover → active, not from gradients or shadows. This was decided during the TugButton restyle work that established the retronow-inspired aesthetic.

#### [Q02] Always-confirm vs conditional close confirmation (OPEN) {#q02-close-confirm-policy}

**Question:** Should every closable card always show a confirmation popover on close, or should only cards with unsaved state require confirmation?

**Why it matters:** Always-confirm is safer but adds friction. Conditional-confirm requires a notion of "unsaved state" in the card model, which does not exist yet.

**Options (if known):**
- Always confirm (Phase 8g ships this)
- Conditional confirm (requires card model extension, deferred to Phase 9)

**Plan to resolve:** Ship always-confirm in Phase 8g. Revisit in Phase 9 when card content is rebuilt and unsaved-state tracking can be added.

**Resolution:** OPEN -- shipping always-confirm as the pragmatic default

#### [Q03] Sonner styling integration (OPEN) {#q03-sonner-styling}

**Question:** How deeply do we customize Sonner's toast styling? Do we use Sonner's built-in theming, or do we override everything with our own CSS?

**Why it matters:** Sonner ships with its own styling. If we override everything, we take on maintenance. If we use Sonner's theming, we may fight it when our design diverges.

**Options (if known):**
- Full CSS override with `--tug-toast-*` tokens
- Sonner theme mode with minimal overrides

**Plan to resolve:** Spike during Step 7, evaluate visual quality across themes.

**Resolution:** OPEN

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Radix breaking change during Phase 8 | med | low | Pin Radix versions in package.json | Any Radix major version release |
| Control state styling doesn't feel tactile enough | med | low | Tune token values interactively in Component Gallery | Negative visual review during component tuning |
| Card-scoped modality diverges from Radix defaults | med | med | Implement manual inert scoping in TugSheet | TugSheet focus trapping breaks other cards |
| Component count (31) causes scope creep | high | med | Strict tier ordering; defer Tier 5 visualization if needed | Step 5 exceeds time estimate by 2x |

**Risk R01: Radix API surface mismatch** {#r01-radix-mismatch}

- **Risk:** Some Radix primitives may not expose the hooks or props needed for our control state styling or action-phase integration.
- **Mitigation:** Audit all Radix primitives we plan to wrap (Table T01 in Deep Dives) before building. Identify gaps early. For gaps, use Radix's `asChild` pattern or build as originals.
- **Residual risk:** One or two components may need to be reclassified from wrapper to original mid-implementation.

**Risk R02: Performance regression from transition CSS** {#r02-transition-perf}

- **Risk:** The `transition` pattern on bg/fg/border/icon for every interactive control could cause paint overhead in cards with many form controls.
- **Mitigation:** Keep transitions short (80ms). Measure paint time in Chrome DevTools during component tuning. Disable transitions when `prefers-reduced-motion` is set.
- **Residual risk:** Cards with 20+ form controls may need reduced transition properties.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] Radix-direct wrapping replaces shadcn (DECIDED) {#d01-radix-direct}

**Decision:** Components wrap Radix primitives directly. No intermediate shadcn layer.

**Rationale:**
- shadcn's opinionated styling fights our design system -- every Tug component must override shadcn defaults
- The `components/ui/` layer adds unnecessary indirection (Radix -> shadcn -> Tug becomes Radix -> Tug)
- shadcn CLI is incompatible with our build (Tailwind removed, shadcn ecosystem assumes Tailwind)
- Only 2 of 13 shadcn components are actively used (Button, DropdownMenu)

**Implications:**
- `components/ui/` directory is deleted entirely
- `shadcn-base.css` (~25KB) is deleted
- `components.json` is deleted
- `class-variance-authority` dependency is removed if no longer referenced
- All Tug components import Radix primitives directly

#### [D02] Three component kinds (DECIDED) {#d02-component-kinds}

**Decision:** Tugways components fall into exactly three kinds: wrappers, compositions, and originals.

**Rationale:**
- Clear taxonomy prevents ambiguity about how to build a new component
- Maps directly to our Radix dependency: wrappers use one primitive, compositions assemble multiple, originals use none

**The three kinds:**

1. **Wrappers** -- a Radix primitive wrapped with tugways opinions. The Radix primitive is the internal implementation; the Tug component is the public API. Examples: TugButton (wraps Radix Slot), TugSelect (wraps Radix Select), TugCheckbox (wraps Radix Checkbox).

2. **Compositions** -- multiple Radix primitives assembled into a higher-level component that has no single Radix equivalent. Examples: TugSearchBar (Input + Button), TugChatInput (Textarea + Button x 2), TugButtonGroup (Button x N).

3. **Originals** -- components that have no Radix primitive equivalent, built from scratch. Examples: TugBadge, TugSpinner, TugKeyboard, TugSparkline, TugTable, gauges.

**Implications:**
- Each new component must be classified as one of these three kinds
- The kind determines the implementation approach and which Radix packages (if any) are needed
- Table T01 in Deep Dives classifies every component

#### [D03] Component file organization (DECIDED) {#d03-file-org}

**Decision:** `components/tugways/` is the single public API directory. App code imports from `components/tugways/` only.

**Rationale:**
- Single import path eliminates confusion about where components live
- No private `ui/` layer -- shadcn has been removed
- Tug components wrap Radix primitives directly, with our own opinions, subtypes, and conventions on top

**File structure:**

```
components/
  tugways/      # Tug-prefixed components (public API)
    tug-button.tsx
    tug-button.css
    tug-input.tsx
    tug-input.css
    tug-select.tsx
    tug-select.css
    ...
```

**Implications:**
- Each component gets its own `.tsx` and `.css` file pair
- CSS file uses `--tug-<component>-*` tokens (see [D05])
- No barrel exports -- import individual components by path

#### [D04] Token-driven control state model (DECIDED, REVISED) {#d04-control-state-model}

**Decision:** Interactive controls use a token-driven control state visual language. Every visual property (background, foreground/text, border, icon) has independent tokens for rest, hover, and active states per variant (primary, secondary, ghost, destructive). States lighten progressively: rest (darkest) → hover → active (lightest).

**Rationale:**
- The original 2.5D elevation model (box-shadow, translateY press-down, top-edge highlights) was replaced after hands-on tuning showed that flat, token-driven color states are more tuneable, more consistent across themes, and avoid paint/composite overhead from layered shadows
- Every visual property is independently adjustable per state — changing one token visibly changes the control appearance
- The retronow design reference (pill-shaped buttons, all-caps labels, colored borders) established the aesthetic direction

**The control state model:**

```
Token naming: --tug-base-control-{variant}-{property}-{state}

Variants: primary, secondary, ghost, destructive
Properties: bg, fg, border, icon
States: rest, hover, active (+ disabled for bg)

Example for ghost variant:
  --tug-base-control-ghost-bg-rest:     transparent
  --tug-base-control-ghost-bg-hover:    subtle white overlay
  --tug-base-control-ghost-bg-active:   stronger white overlay
  --tug-base-control-ghost-fg-rest:     muted text
  --tug-base-control-ghost-fg-hover:    brighter text
  --tug-base-control-ghost-fg-active:   brightest text
  --tug-base-control-ghost-border-rest: transparent
  --tug-base-control-ghost-border-hover: subtle border appears
  --tug-base-control-ghost-border-active: stronger border
  --tug-base-control-ghost-icon-rest:   muted icon
  --tug-base-control-ghost-icon-hover:  brighter icon
  --tug-base-control-ghost-icon-active: brightest icon
```

**Core principles:**
- Controls respond to interaction through color, not depth — no box-shadow elevation, no translateY press-down
- Progressive lightening from rest → hover → active provides clear state feedback
- Every property is independently tuneable via tokens — change one token, see one change
- Pill-shaped buttons (border-radius: 999px), all-caps labels, colored borders per the retronow aesthetic
- Variant borders come from tokens, not a generic bordered class

**CSS implementation (established on TugButton):**
- `background-color` transitions through rest/hover/active tokens
- `color` (text/fg) transitions through rest/hover/active tokens
- `border-color` transitions through rest/hover/active tokens
- `svg { color }` (icon) transitions through rest/hover/active tokens
- `transition: background-color 80ms ease, color 80ms ease, border-color 80ms ease`
- All values driven by `--tug-base-control-{variant}-*` tokens in `tug-base.css`

**Design constraints:**
- No box-shadow elevation on controls (cards have their own shadow system; controls use color states only)
- No gradients on control faces
- No translateY press-down animation
- Disabled controls: reduced opacity via `--tug-base-control-disabled-opacity`, pointer-events: none
- Focus ring via `outline`, independent of state colors
- `prefers-reduced-motion` disables transitions

**Implications:**
- Every interactive Tug component follows this CSS pattern
- Control state tokens are defined in `tug-base.css` under "Control Surface Tokens"
- Theme overrides in `bluenote.css` and `harmony.css` override the same stateful tokens
- Component CSS files (e.g., `tug-button.css`) wire `var()` references to the tokens — no hardcoded colors

#### [D05] Component token naming (DECIDED) {#d05-token-naming}

**Decision:** Component tokens use `--tug-<component>-<property>` naming. The `--tug-comp-*` prefix is banned.

**Rationale:**
- `--tug-comp-*` is confusingly similar to CSS "computed" style
- `--tug-<component>-*` is clear and self-documenting
- `base` is the special root-level component that all others inherit from

**Token pattern:**

```css
/* Control state tokens in tug-base.css (per variant × property × state) */
--tug-base-control-{variant}-bg-rest:
--tug-base-control-{variant}-bg-hover:
--tug-base-control-{variant}-bg-active:
--tug-base-control-{variant}-bg-disabled:
--tug-base-control-{variant}-fg-rest:
--tug-base-control-{variant}-fg-hover:
--tug-base-control-{variant}-fg-active:
--tug-base-control-{variant}-border-rest:
--tug-base-control-{variant}-border-hover:
--tug-base-control-{variant}-border-active:
--tug-base-control-{variant}-icon-rest:
--tug-base-control-{variant}-icon-hover:
--tug-base-control-{variant}-icon-active:

/* Variants: primary, secondary, ghost, destructive */
/* Component CSS wires var() references to these tokens */
```

**Implications:**
- Every Tug component defines `--tug-<name>-*` tokens in its CSS file
- Base tokens live in `tug-base.css`
- Theme overrides live in `bluenote.css` and `harmony.css`
- The existing `tug-comp-tokens.css` file and all `--tug-comp-*` references (~83 occurrences across `tug-comp-tokens.css`, `tug-button.css`, `tug-tab-bar.css`, `tugcard.css`, `tug-dropdown.css`, `style-inspector-overlay.ts`) must be migrated to the `--tug-<component>-*` naming and the file deleted as part of Step 1 (clean foundation)

#### [D06] Four modal categories (DECIDED) {#d06-four-modal-categories}

**Decision:** The alert/dialog system has exactly four categories: TugAlert (app-modal), TugSheet (card-modal), TugConfirmPopover (button-local), and TugToast (non-blocking).

**Rationale:**
- Maps directly from Apple's AppKit modal model (NSAlert, NSWindow.beginSheet, NSPopover, Notification Center)
- Each category has different responder chain impact, focus behavior, and visual treatment
- Covers all modal interaction needs without overlap

**Category mapping:**

| Category | Apple equivalent | Scope | Chain impact | Focus |
|----------|-----------------|-------|-------------|-------|
| **TugAlert** | `NSAlert.runModal()` | Entire app | Chain blocked | Trapped in dialog |
| **TugSheet** | `NSWindow.beginSheet()` | Single card | Card's node suspended | Trapped in sheet |
| **TugConfirmPopover** | iPad `confirmationDialog` | Button-local | None | Moves to popover |
| **TugToast** | Notification center | None | None | Never steals focus |

**TugAlert -- App-Modal Alert:**

Blocks the entire application. Uses Radix AlertDialog (sets `role="alertdialog"`, prevents overlay-click dismissal). The responder chain manager enters `modalScope: "app"` -- all `dispatch()` calls to the main chain are refused. Global shortcuts (Cmd+Q) are blocked. Escape dismisses the alert.

Imperative, Promise-based API:

```tsx
const response = await tugAlert({
  title: "Delete project?",
  message: "This action cannot be undone.",
  style: "warning",                              // "informational" | "warning" | "critical"
  buttons: [
    { label: "Delete", role: "destructive" },    // red text, not the default
    { label: "Cancel", role: "cancel" },          // bold, default (Enter key)
  ],
});
// response === "Delete" | "Cancel"
```

A `TugAlertHost` component (rendered once, at the app root) listens for alert requests and manages the AlertDialog state. The `tugAlert()` function posts a request and returns a Promise that resolves when the user clicks a button.

**Button roles** (modeled on `UIAlertAction.Style` and Apple HIG):
- `"destructive"` -- red text, `variant="destructive"`. Signals danger. Never the default button.
- `"cancel"` -- the safe choice. Responds to Escape. When a `"destructive"` button is present, Cancel becomes the default button: `variant="primary"` (accent fill), registered via `setDefaultButton`, responds to Enter (see [D10]).
- `"default"` -- the affirmative action. When no `"destructive"` button is present, this is the default button. When a `"destructive"` button is present, uses `variant="secondary"`.

**Alert styles** (modeled on `NSAlert.Style`):
- `"informational"` -- app icon. Notice about a current or impending event.
- `"warning"` -- caution badge. User should be aware of consequences.
- `"critical"` -- caution icon. Potential data loss or system damage.

**TugSheet -- Card-Modal Dialog:**

Blocks a single card. Other cards remain interactive. The card's responder node is marked `suspended`. Actions dispatched from within the card's subtree are blocked. Focus is trapped within the card's sheet content. The sheet renders within the card's bounds using Radix Dialog with `container` prop targeting the root `.tugcard` element (not `.tugcard-content`, because the overlay must cover both header and content). Tugcard exposes a ref to its root div for this purpose. TugSheetHost renders as a direct child of `.tugcard` (sibling of header, accessory, and content) with `position: absolute; inset: 0`. Overlay is scoped to the card, not the viewport.

Imperative API:

```tsx
const response = await tugSheet(cardId, {
  title: "Close this card?",
  message: "You have unsaved changes.",
  buttons: [
    { label: "Close Without Saving", role: "destructive" },
    { label: "Cancel", role: "cancel" },
  ],
});
```

**TugConfirmPopover -- Button-Anchored Confirmation:**

A small popover graphically tied to a button that compels the user to move their mouse and click again to confirm. Not modal in the responder chain sense. Uses Radix Popover internally.

When to use: close-button confirmation on cards, delete-item buttons, any single-button destructive action where a full alert is too heavy.

Declarative component API:

```tsx
<TugConfirmPopover
  onConfirm={() => closeCard(cardId)}
  message="Close this card?"
  confirmLabel="Close"
  confirmVariant="destructive"
>
  <TugButton subtype="icon" icon={<X />} aria-label="Close card" />
</TugConfirmPopover>
```

Focus moves to the popover on open. The confirm button is registered as the default button via `setDefaultButton` (see [D10]). Escape closes the popover. Tab can move out of it (transient behavior, matching `NSPopover.Behavior.transient`).

**TugToast -- Non-Blocking Notification:**

Fire-and-forget notifications via Sonner. Never steals focus. Auto-dismiss with configurable duration. Tone variants (good/warn/alert/info).

```tsx
// App root
<TugToaster position="bottom-right" theme="system" duration={4000} />

// Anywhere
tugToast.success("Build succeeded");
tugToast.error("Connection lost");
tugToast.promise(deployBuild(), {
  loading: "Deploying...",
  success: "Deployed successfully",
  error: (err) => `Deploy failed: ${err.message}`,
});
```

**Implications:**
- TugAlertHost renders once at app root
- TugSheetHost renders inside each Tugcard
- TugConfirmPopover is the standard pattern for destructive button actions
- Sonner is a new dependency for toasts

#### [D07] Window-shade collapse (DECIDED) {#d07-window-shade}

**Decision:** Cards collapse to title bar height (~28px) via CSS height transition. Content is hidden (CSS `overflow: hidden`), not unmounted (React). State is preserved.

**Rationale:**
- Classic Mac OS "window shade" from System 7 through Mac OS 9 -- a proven interaction pattern
- CSS-only collapse preserves internal card state (terminal sessions, scroll positions, form values)
- Persisted in `CardState` so collapsed cards survive reload

**Specification:**

State is stored in `CardState` (the layout tree's per-card state object). The `collapsed?: boolean` field already exists in `layout-tree.ts` and serialization already handles it. Step 3 wires the UI to this existing field rather than adding a new one.

```ts
interface CardState {
  position: { x: number; y: number };
  size: { width: number; height: number };
  collapsed: boolean;  // collapse state (already exists in layout-tree.ts)
}
```

Control: a chevron button in the title bar. Chevron points down when expanded (collapse available), up when collapsed (expand available). Uses `ChevronDown` / `ChevronUp` from lucide-react.

```
Expanded:  [icon] TERMINAL    [...] [v] [x]
Collapsed: [icon] TERMINAL    [...] [^] [x]
```

CardFrame behavior when collapsed:
1. Height animates from `size.height` to `CARD_TITLE_BAR_HEIGHT` (28px) + border using `--td-duration-moderate` and `--td-easing-standard`
2. Content area has `overflow: hidden`, height goes to 0. Content is NOT unmounted.
3. Resize handles hidden when collapsed. Drag remains active.
4. Card collapses downward in place (top edge stays, bottom edge moves up).

Double-click on title bar toggles collapse (secondary gesture, matching macOS behavior).

**Implications:**
- `collapsed` field already exists in `CardState` (`layout-tree.ts`) and serialization already handles it; Step 3 wires the UI
- Collapsed cards participate in snap sets normally (using collapsed height)
- Expanding restores previous height

#### [D08] Three dock button types (DECIDED) {#d08-dock-button-types}

**Decision:** The dock has three kinds of buttons: card toggle, command, and popout menu.

**Rationale:**
- The dock currently only has card-toggle buttons -- this is too limiting
- Command buttons allow direct actions without card intermediaries
- Popout menus group related commands (settings, theme selector)

**Button types:**

| Type | Click behavior | Visual indicator | Example |
|------|---------------|-----------------|---------|
| **Card toggle** | Show/focus/toggle a card | Badge count | Terminal, Git, Files |
| **Command** | Execute an action directly | None (or brief flash) | Future test-case buttons |
| **Popout menu** | Open a floating menu anchored to the button | Caret/chevron | Settings, grouped commands |

**Card toggle buttons** -- click shows the card if hidden, focuses it if visible but not key, or toggles it off if already key. Badge counts display notification state. Top group in the dock.

**Command buttons** -- click fires a callback immediately. No popover, no menu. Can optionally wrap in `TugConfirmPopover` for destructive commands. Below card toggles in the dock.

**Popout menu buttons** -- open a floating menu using Radix DropdownMenu, positioned to the side of the dock opposite its edge (dock on right -> menu opens left). Menu `side` and `align` props adjust automatically based on dock placement.

**Implications:**
- Dock layout is defined as a typed `DockConfig` configuration object
- Each button specifies its type, icon, label, action, and optional badge
- Dock buttons dispatch actions through the responder chain (no direct DeckManager coupling)

#### [D09] Dock placement (DECIDED) {#d09-dock-placement}

**Decision:** The dock can be positioned on any edge of the canvas. Right is the default. Placement is persisted in the settings API.

**Rationale:**
- Users have different screen layouts and preferences
- Right-edge default matches common IDE patterns (VS Code activity bar)

**Placement options:**

| Placement | Layout | Menu direction |
|-----------|--------|---------------|
| Right | Vertical, 48px wide, fixed to right edge | Menus open left |
| Left | Vertical, 48px wide, fixed to left edge | Menus open right |
| Top | Horizontal, 48px tall, fixed to top edge | Menus open below |
| Bottom | Horizontal, 48px tall, fixed to bottom edge | Menus open above |

The dock is always a flexbox: `flex-col` for vertical placements (left/right), `flex-row` for horizontal (top/bottom). The canvas area (`DeckCanvas`) adjusts its inset to account for dock position and dimensions.

**Implications:**
- Dock position props computed from `dockPlacement` setting
- DropdownMenu `side` prop flips based on placement
- Dock placement stored in settings API alongside theme

#### [D10] Default button (DECIDED) {#d10-default-button}

**Decision:** In dialogs, alerts, sheets, and popovers, one button is the default button -- the button activated by the Enter key. The default button uses `variant="primary"` (accent fill). The responder chain handles default button registration.

**Rationale:**
- Fundamental interaction pattern from Apple's HIG
- The accent fill (`--td-accent`) is the visual affordance that communicates which button Enter will activate
- Consistent keyboard interaction across all modal contexts

**Mechanism:**

A container registers its default button via `setDefaultButton(buttonRef)` on the `ResponderChainManager`. When Enter is pressed:

1. If a native `<button>` has DOM focus, the browser's default behavior fires (focused button wins)
2. If a text input or textarea has DOM focus, Enter is consumed by the input
3. Otherwise, the responder chain checks for a registered default button and activates it via synthetic click

Registration API:

```tsx
responderChain.setDefaultButton(buttonRef);   // register
responderChain.clearDefaultButton(buttonRef); // unregister (idempotent)
```

**Destructive variant:** Bold danger fill (`--td-danger`), white text (`--td-text-inverse`). Never the default button. Hover/active use `filter: brightness()`.

**Interaction with alert button roles:** The `"cancel"` role maps to the default button when a `"destructive"` button is present (Cancel gets `variant="primary"`, registered as default). When no destructive button, the affirmative action is the default. The `"destructive"` role never becomes the default button.

**Implications:**
- Every modal context (alert, sheet, popover) must register its default button on mount and clear on unmount
- Only one default button per modal scope

---

### Deep Dives {#deep-dives}

> Structured analysis critical for implementation alignment.

#### Control State Visual Language {#control-state-spec}

The complete control state specification. This is the CSS recipe that every interactive Tug component follows.

**Token design -- in `tug-base.css` under "Control Surface Tokens":**

```css
/* Per variant: bg, fg, border, icon × rest/hover/active (+ bg-disabled) */
/* States lighten progressively: rest (darkest) → hover → active (lightest) */

--tug-base-control-ghost-bg-rest:      transparent;
--tug-base-control-ghost-bg-hover:     --tug-color(white, i: 0, t: 100, a: 10);
--tug-base-control-ghost-bg-active:    --tug-color(white, i: 0, t: 100, a: 20);
--tug-base-control-ghost-fg-rest:      --tug-color(cobalt, i: 5, t: 66);
--tug-base-control-ghost-fg-hover:     --tug-color(cobalt, i: 15, t: 80);
--tug-base-control-ghost-fg-active:    --tug-color(cobalt, i: 35, t: 94);
--tug-base-control-ghost-border-rest:  transparent;
--tug-base-control-ghost-border-hover: --tug-color(cobalt, i: 20, t: 60);
--tug-base-control-ghost-border-active:--tug-color(cobalt, i: 20, t: 60);
--tug-base-control-ghost-icon-rest:    --tug-color(cobalt+7, i: 7, t: 37);
--tug-base-control-ghost-icon-hover:   --tug-color(cobalt+7, i: 7, t: 65);
--tug-base-control-ghost-icon-active:  --tug-color(cobalt+7, i: 27, t: 80);
/* Same pattern for primary, secondary, destructive */
```

Per-theme overrides in `bluenote.css` and `harmony.css` override the same stateful tokens.

**Reference CSS implementation (TugButton, established):**

```css
.tug-button-ghost {
  background-color: var(--tug-base-control-ghost-bg-rest);
  color: var(--tug-base-control-ghost-fg-rest);
  border-color: var(--tug-base-control-ghost-border-rest);
}
.tug-button-ghost svg {
  color: var(--tug-base-control-ghost-icon-rest);
}
.tug-button-ghost:hover:not(:disabled):not([aria-disabled="true"]) {
  background-color: var(--tug-base-control-ghost-bg-hover);
  color: var(--tug-base-control-ghost-fg-hover);
  border-color: var(--tug-base-control-ghost-border-hover);
}
.tug-button-ghost:hover:not(:disabled):not([aria-disabled="true"]) svg {
  color: var(--tug-base-control-ghost-icon-hover);
}
.tug-button-ghost:active:not(:disabled):not([aria-disabled="true"]) {
  background-color: var(--tug-base-control-ghost-bg-active);
  color: var(--tug-base-control-ghost-fg-active);
  border-color: var(--tug-base-control-ghost-border-active);
}
.tug-button-ghost:active:not(:disabled):not([aria-disabled="true"]) svg {
  color: var(--tug-base-control-ghost-icon-active);
}
```

**Control vs content convention:** Interactive controls (buttons, inputs, switches, sliders, toggles, checkboxes, radio buttons) get the full control state treatment. Content elements (text, labels, separators, badges, status indicators) stay static — no state transitions.

#### Complete Radix Audit {#radix-audit}

**Table T01: Radix primitive-to-component mapping** {#t01-radix-mapping}

| Radix Primitive | Tug Component | Phase | Status |
|----------------|---------------|-------|--------|
| Accordion | TugAccordion | 8e | NEW |
| Alert Dialog | TugAlertDialog | 8g | NEW |
| Aspect Ratio | -- | -- | Skip (CSS `aspect-ratio` sufficient) |
| Avatar | TugAvatar | 8d | NEW |
| Checkbox | TugCheckbox | 8d | Tier 1 form control |
| Collapsible | -- | -- | Skip (card window-shade uses own mechanism) |
| Context Menu | TugContextMenu | 8e | NEW |
| Dialog | TugDialog | 8e | NEW |
| Dropdown Menu | TugDropdown | 8a | Rewritten (exists) |
| Form | -- | -- | Skip (we handle form state ourselves) |
| Hover Card | -- | -- | Skip (tooltips suffice) |
| Label | TugLabel | 8d | Tier 1 form control |
| Menubar | -- | -- | Skip (Mac native menu bar) |
| Navigation Menu | -- | -- | Skip (not applicable to card-based UI) |
| Popover | TugPopover | 8d | NEW |
| Progress | TugProgress | 8d | Tier 2 display |
| Radio Group | TugRadioGroup | 8d | Tier 1 form control |
| Scroll Area | TugScrollArea | 8e | NEW |
| Select | TugSelect | 8d | Tier 1 form control |
| Separator | TugSeparator | 8d | Tier 2 display |
| Slider | TugSlider | 8d | Tier 1 form control |
| Switch | TugSwitch | 8d | Tier 1 form control |
| Tabs | -- | -- | Skip (TugTabBar has own implementation) |
| Toast | TugToast | 8g | Via Sonner |
| Toggle | TugToggle | 8d | NEW |
| Toggle Group | TugToggleGroup | 8e | NEW |
| Toolbar | TugToolbar | 8e | NEW |
| Tooltip | TugTooltip | 8e | NEW |
| Visually Hidden | -- | -- | Use directly as utility, no wrapper |

#### Component Library Inventory {#component-inventory}

**Table T02: Complete component inventory (31 components)** {#t02-component-inventory}

**Tier 1 -- Form Controls (9 components)**

| Component | Kind | Wraps (Radix) | What it adds |
|-----------|------|--------------|-------------|
| TugInput | Wrapper | -- (native `<input>`) | Validation states, error styling, `--tug-input-*` tokens, control state colors |
| TugTextarea | Wrapper | -- (native `<textarea>`) | Auto-resize, char count, error state, control state colors |
| TugSelect | Wrapper | `@radix-ui/react-select` | Tugways variants, token-based trigger and popover |
| TugCheckbox | Wrapper | `@radix-ui/react-checkbox` | Label integration, mixed state, control state colors |
| TugRadioGroup | Wrapper | `@radix-ui/react-radio-group` | Group label, horizontal/vertical, control state colors |
| TugSwitch | Wrapper | `@radix-ui/react-switch` | Label position, size variants, control state track/thumb |
| TugSlider | Wrapper | `@radix-ui/react-slider` | Value display, range labels, tick marks, action phases |
| TugLabel | Wrapper | `@radix-ui/react-label` | Required indicator, helper text slot |
| TugToggle | Wrapper | `@radix-ui/react-toggle` | Two-state with control state pressed/unpressed colors |

Note: TugInput and TugTextarea wrap native elements, not Radix primitives. They still get full control state treatment.

**Tier 2 -- Display & Feedback (8 components)**

| Component | Kind | Notes |
|-----------|----------|-------|
| TugBadge | Original | Tone variants (good/warn/alert/info), pill shape, count mode |
| TugSpinner | Original | Size variants, replaces loading prop visuals |
| TugProgress | Wrapper | Horizontal bar, percentage, indeterminate mode |
| TugSkeleton | Original | Shimmer placeholder, `background-attachment: fixed` sync |
| TugSeparator | Wrapper | Horizontal/vertical, label slot |
| TugKeyboard | Original | Keyboard shortcut chip, keycap appearance |
| TugAvatar | Wrapper | Image + fallback initials, size variants |
| TugStatusIndicator | Original | Tone-colored dot + text |

**Tier 3 -- Navigation & Overlay (5 components)**

| Component | Kind | Wraps (Radix) | Notes |
|-----------|------|--------------|-------|
| TugTooltip | Wrapper | `@radix-ui/react-tooltip` | Hover labels, keyboard shortcut display |
| TugDropdown | Wrapper | `@radix-ui/react-dropdown-menu` | Rewritten in 8a |
| TugScrollArea | Wrapper | `@radix-ui/react-scroll-area` | Themed scrollbar, autohide |
| TugContextMenu | Wrapper | `@radix-ui/react-context-menu` | Right-click menus for cards |
| TugPopover | Wrapper | `@radix-ui/react-popover` | General anchored overlay |

**Tier 4 -- Data Display (3 components)**

| Component | Kind | Notes |
|-----------|----------|-------|
| TugTable | Original | Header/row/cell, sortable columns, stripe option |
| TugStatCard | Original | Key-value metric (label + large number + trend) |
| TugDialog | Wrapper | General-purpose dialog (not alert/sheet) |

**Tier 5 -- Data Visualization (3 originals)**

| Component | Kind | Notes |
|-----------|----------|-------|
| TugSparkline | Original | SVG inline chart: area, line, column, bar variants |
| TugLinearGauge | Original | Horizontal gauge with needle, thresholds, tick marks |
| TugArcGauge | Original | Radial gauge with needle, arc fill, center readout |

**Tier 6 -- Compositions (3 components)**

| Component | Kind | Composes | Notes |
|-----------|------|----------|-------|
| TugButtonGroup | Composition | TugButton x N | Connected button row, shared border radius |
| TugChatInput | Composition | TugTextarea + TugButton x 2 | Submit + attachment, Enter to submit |
| TugSearchBar | Composition | TugInput + TugButton | Search field with action button |

**Additional Radix-based (counted in tiers above):**

| Component | Kind | Wraps (Radix) | Notes |
|-----------|------|--------------|-------|
| TugAccordion | Wrapper | `@radix-ui/react-accordion` | Collapsible content sections |
| TugToggleGroup | Wrapper | `@radix-ui/react-toggle-group` | Exclusive/multi toggle row |
| TugToolbar | Wrapper | `@radix-ui/react-toolbar` | Grouped controls with arrow key nav |

**Total count:**

| Category | Count |
|----------|-------|
| Radix wrappers | 17 |
| Original (no Radix) | 11 |
| Compositions | 3 |
| **Total** | **31** |

#### Retronow Design Reference {#retronow-reference}

The `roadmap/retronow/` directory contains the canonical design mockups and style references for the tugways design system. All phase work must consult these resources when designing components, layouts, and visual treatments.

**Table T03: Retronow resource inventory** {#t03-retronow-resources}

| Resource | Path | What It Provides |
|----------|------|------------------|
| **Component Pack Page** | `components/retronow/RetronowComponentPackPage.tsx` | Full-page mockup showing wrapper-style component interactions: tabs, dialogs, buttons, sliders, inputs, textareas, selects, radio groups, checkboxes, card canvas, toasts, ArcGauge. Primary reference for component gallery layout. |
| **Control Pack** | `components/retronow/RetronowControlPack.tsx` | Compact control showcase: input, textarea, combo, button, slider, radio, checkbox, address bar. Reference for control layout and grouping. |
| **Deck Canvas** | `components/retronow/RetronowDeckCanvas.tsx` | Card deck canvas with drag, resize, snap. Reference for card frame, header, canvas layout. |
| **Class Recipes** | `components/retronow/retronow-classes.ts` | Central class recipes: shell, panel, button, input, textarea, tabs, card, cardHeader, cardBody, cardCanvas. Reference for consistent styling patterns. |
| **Component CSS** | `styles/retronow-components.css` | Full CSS: titlebar, tabs, buttons, fields, sliders, panels, popups, screens, gauges, scrollbars, dialog, toast, typography. Three theme variants. |
| **Deck CSS** | `styles/retronow-deck.css` | Card/canvas system styles: visible grid, snap affordances, resize handles, card frames. |
| **Design Tokens** | `styles/retronow-tokens.css` | Three-theme token system (`--rn-*`): surfaces, text, accents (8-color palette), borders, shadows, spacing, radii, fonts, depths. |
| **Unified Review** | `mockups/retronow-unified-review.html` | Browser-openable all-in-one review page. |
| **Style Mockup** | `mockups/retronow-style-mockup.html` | Standalone style exploration mockup. |
| **Component Pack Mockup** | `mockups/retronow-component-pack-mockup.html` | Browser-openable component pack preview. |

**How to use:**

- **New components:** Consult `RetronowComponentPackPage.tsx` and `RetronowControlPack.tsx` for layout patterns and interactive control grouping. The retronow "AppButton wraps Radix primitives directly" pattern is exactly the pattern tugways follows.
- **Component Gallery:** The retronow component pack page is the direct inspiration. Its tabbed layout (controls, workspace, diagnostics, custom gauges), panel grouping, and interactive toggle patterns guide gallery expansion.
- **CSS:** Consult `retronow-components.css` for CSS structure -- how controls are themed across light/dark/brio variants. The tugways equivalent uses `var(--td-*)` semantic tokens instead of `var(--rn-*)`, but structural patterns are the same.
- **Tokens:** Consult `retronow-tokens.css` for naming scheme and palette structure. The 8-accent-color system and surface layering directly informed tugways token design.
- **Card frames:** Consult `RetronowDeckCanvas.tsx`, `retronow-deck.css`, and class recipes for card shell, header, and body patterns.

---

### Specification {#specification}

#### Component Token Naming Convention {#token-convention}

**Spec S01: Token naming rules** {#s01-token-naming}

All component tokens follow: `--tug-<component>-<property>[-<state>]`

- `<component>`: lowercase component name without `Tug` prefix (e.g., `button`, `input`, `select`)
- `<property>`: the CSS property or semantic role (e.g., `face`, `highlight`, `shadow`, `border`)
- `<state>`: optional interactive state suffix (e.g., `hover`, `active`, `disabled`)
- `base` is the reserved root-level component name

Examples:
- `--tug-base-control-ghost-bg-rest` -- ghost button background at rest
- `--tug-base-control-ghost-fg-hover` -- ghost button text color on hover
- `--tug-base-control-primary-border-active` -- primary button border when pressed
- `--tug-input-border-focus` -- input border when focused

The `--tug-comp-*` prefix is **banned**.

#### CSS Patterns {#css-patterns}

**Spec S02: Control state CSS pattern** {#s02-control-state-css}

Every interactive component follows this token-driven state pattern. All four visual properties (bg, fg, border, icon) transition independently through rest → hover → active:

```css
.tug-<component>-<variant> {
  background-color: var(--tug-base-control-<variant>-bg-rest);
  color: var(--tug-base-control-<variant>-fg-rest);
  border-color: var(--tug-base-control-<variant>-border-rest);
  transition: background-color 80ms ease, color 80ms ease, border-color 80ms ease;
}
.tug-<component>-<variant> svg {
  color: var(--tug-base-control-<variant>-icon-rest);
}

.tug-<component>-<variant>:hover:not(:disabled) {
  background-color: var(--tug-base-control-<variant>-bg-hover);
  color: var(--tug-base-control-<variant>-fg-hover);
  border-color: var(--tug-base-control-<variant>-border-hover);
}
.tug-<component>-<variant>:hover:not(:disabled) svg {
  color: var(--tug-base-control-<variant>-icon-hover);
}

.tug-<component>-<variant>:active:not(:disabled) {
  background-color: var(--tug-base-control-<variant>-bg-active);
  color: var(--tug-base-control-<variant>-fg-active);
  border-color: var(--tug-base-control-<variant>-border-active);
}
.tug-<component>-<variant>:active:not(:disabled) svg {
  color: var(--tug-base-control-<variant>-icon-active);
}
```

No box-shadow elevation, no translateY press-down. Inputs use field tokens (`--tug-base-field-*`) rather than control tokens.

#### File Organization {#file-organization}

**Spec S03: Component file structure** {#s03-file-structure}

```
tugdeck/src/components/tugways/
  tug-button.tsx          # component implementation
  tug-button.css          # component styles with --tug-button-* tokens
  tug-input.tsx
  tug-input.css
  tug-select.tsx
  tug-select.css
  tug-alert-host.tsx      # app-level alert host
  tug-sheet.tsx           # card-modal sheet
  tug-confirm-popover.tsx # button-anchored confirmation
  tug-toast.tsx           # toast wrapper around Sonner
  ...                     # one .tsx + .css pair per component
```

Title bar is merged into `tug-card.tsx`. Chrome components remain in `components/chrome/`:

```
tugdeck/src/components/tugways/
  tug-card.tsx            # Tugcard + CardTitleBar (merged)
  tug-card.css            # card + title bar styles

tugdeck/src/components/chrome/
  card-frame.tsx          # card container with collapse handling
  dock.tsx                # dock with three button types
  dock.css
  dock-config.ts          # DockConfig type and defaults
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New packages {#new-packages}

**List L01: Radix packages to install** {#l01-radix-packages}

| Package | Phase | Purpose |
|---------|-------|---------|
| `@radix-ui/react-accordion` | 8e | TugAccordion |
| `@radix-ui/react-alert-dialog` | 8g | TugAlertHost |
| `@radix-ui/react-avatar` | 8d | TugAvatar |
| `@radix-ui/react-label` | 8d | TugLabel |
| `@radix-ui/react-popover` | 8e | TugPopover, TugConfirmPopover |
| `@radix-ui/react-progress` | 8d | TugProgress |
| `@radix-ui/react-separator` | 8d | TugSeparator |
| `@radix-ui/react-slider` | 8d | TugSlider |
| `@radix-ui/react-toggle` | 8d | TugToggle |
| `@radix-ui/react-toggle-group` | 8e | TugToggleGroup |
| `@radix-ui/react-toolbar` | 8e | TugToolbar |
| `@radix-ui/react-context-menu` | 8e | TugContextMenu |

#### New files {#new-files}

| File | Phase | Purpose |
|----------|-------|-----------|
| `tugdeck/src/components/tugways/tug-input.tsx` | 8d | Text input wrapper |
| `tugdeck/src/components/tugways/tug-input.css` | 8d | Input styles |
| `tugdeck/src/components/tugways/tug-textarea.tsx` | 8d | Textarea wrapper |
| `tugdeck/src/components/tugways/tug-textarea.css` | 8d | Textarea styles |
| `tugdeck/src/components/tugways/tug-select.tsx` | 8d | Select wrapper |
| `tugdeck/src/components/tugways/tug-select.css` | 8d | Select styles |
| `tugdeck/src/components/tugways/tug-checkbox.tsx` | 8d | Checkbox wrapper |
| `tugdeck/src/components/tugways/tug-checkbox.css` | 8d | Checkbox styles |
| `tugdeck/src/components/tugways/tug-radio-group.tsx` | 8d | Radio group wrapper |
| `tugdeck/src/components/tugways/tug-radio-group.css` | 8d | Radio group styles |
| `tugdeck/src/components/tugways/tug-switch.tsx` | 8d | Switch wrapper |
| `tugdeck/src/components/tugways/tug-switch.css` | 8d | Switch styles |
| `tugdeck/src/components/tugways/tug-slider.tsx` | 8d | Slider wrapper |
| `tugdeck/src/components/tugways/tug-slider.css` | 8d | Slider styles |
| `tugdeck/src/components/tugways/tug-label.tsx` | 8d | Label wrapper |
| `tugdeck/src/components/tugways/tug-label.css` | 8d | Label styles |
| `tugdeck/src/components/tugways/tug-toggle.tsx` | 8d | Toggle wrapper |
| `tugdeck/src/components/tugways/tug-toggle.css` | 8d | Toggle styles |
| `tugdeck/src/components/tugways/tug-badge.tsx` | 8d | Badge component |
| `tugdeck/src/components/tugways/tug-badge.css` | 8d | Badge styles |
| `tugdeck/src/components/tugways/tug-spinner.tsx` | 8d | Loading spinner |
| `tugdeck/src/components/tugways/tug-spinner.css` | 8d | Spinner styles |
| `tugdeck/src/components/tugways/tug-progress.tsx` | 8d | Progress bar |
| `tugdeck/src/components/tugways/tug-progress.css` | 8d | Progress styles |
| `tugdeck/src/components/tugways/tug-skeleton.tsx` | 8d | Skeleton placeholder (already exists -- enhance with `--tug-skeleton-*` tokens) |
| `tugdeck/src/components/tugways/tug-skeleton.css` | 8d | Skeleton styles (already exists -- enhance) |
| `tugdeck/src/components/tugways/tug-separator.tsx` | 8d | Separator wrapper |
| `tugdeck/src/components/tugways/tug-separator.css` | 8d | Separator styles |
| `tugdeck/src/components/tugways/tug-keyboard.tsx` | 8d | Keyboard shortcut chip |
| `tugdeck/src/components/tugways/tug-keyboard.css` | 8d | Keyboard styles |
| `tugdeck/src/components/tugways/tug-avatar.tsx` | 8d | Avatar wrapper |
| `tugdeck/src/components/tugways/tug-avatar.css` | 8d | Avatar styles |
| `tugdeck/src/components/tugways/tug-status-indicator.tsx` | 8d | Status dot + text |
| `tugdeck/src/components/tugways/tug-status-indicator.css` | 8d | Status indicator styles |
| `tugdeck/src/components/tugways/tug-tooltip.tsx` | 8e | Tooltip wrapper |
| `tugdeck/src/components/tugways/tug-tooltip.css` | 8e | Tooltip styles |
| `tugdeck/src/components/tugways/tug-scroll-area.tsx` | 8e | Scroll area wrapper |
| `tugdeck/src/components/tugways/tug-scroll-area.css` | 8e | Scroll area styles |
| `tugdeck/src/components/tugways/tug-context-menu.tsx` | 8e | Context menu wrapper |
| `tugdeck/src/components/tugways/tug-context-menu.css` | 8e | Context menu styles |
| `tugdeck/src/components/tugways/tug-popover.tsx` | 8e | Popover wrapper |
| `tugdeck/src/components/tugways/tug-popover.css` | 8e | Popover styles |
| `tugdeck/src/components/tugways/tug-accordion.tsx` | 8e | Accordion wrapper |
| `tugdeck/src/components/tugways/tug-accordion.css` | 8e | Accordion styles |
| `tugdeck/src/components/tugways/tug-toggle-group.tsx` | 8e | Toggle group wrapper |
| `tugdeck/src/components/tugways/tug-toggle-group.css` | 8e | Toggle group styles |
| `tugdeck/src/components/tugways/tug-toolbar.tsx` | 8e | Toolbar wrapper |
| `tugdeck/src/components/tugways/tug-toolbar.css` | 8e | Toolbar styles |
| `tugdeck/src/components/tugways/tug-table.tsx` | 8e | Data table |
| `tugdeck/src/components/tugways/tug-table.css` | 8e | Table styles |
| `tugdeck/src/components/tugways/tug-stat-card.tsx` | 8e | Stat card display |
| `tugdeck/src/components/tugways/tug-stat-card.css` | 8e | Stat card styles |
| `tugdeck/src/components/tugways/tug-dialog.tsx` | 8e | General dialog wrapper |
| `tugdeck/src/components/tugways/tug-dialog.css` | 8e | Dialog styles |
| `tugdeck/src/components/tugways/tug-sparkline.tsx` | 8e | SVG sparkline chart |
| `tugdeck/src/components/tugways/tug-sparkline.css` | 8e | Sparkline styles |
| `tugdeck/src/components/tugways/tug-linear-gauge.tsx` | 8e | Linear gauge |
| `tugdeck/src/components/tugways/tug-linear-gauge.css` | 8e | Linear gauge styles |
| `tugdeck/src/components/tugways/tug-arc-gauge.tsx` | 8e | Arc/radial gauge |
| `tugdeck/src/components/tugways/tug-arc-gauge.css` | 8e | Arc gauge styles |
| `tugdeck/src/components/tugways/tug-button-group.tsx` | 8f | Connected button row |
| `tugdeck/src/components/tugways/tug-button-group.css` | 8f | Button group styles |
| `tugdeck/src/components/tugways/tug-chat-input.tsx` | 8f | Chat input composition |
| `tugdeck/src/components/tugways/tug-chat-input.css` | 8f | Chat input styles |
| `tugdeck/src/components/tugways/tug-search-bar.tsx` | 8f | Search bar composition |
| `tugdeck/src/components/tugways/tug-search-bar.css` | 8f | Search bar styles |
| `tugdeck/src/components/tugways/tug-alert-host.tsx` | 8g | App-level alert host |
| `tugdeck/src/components/tugways/tug-sheet.tsx` | 8g | Card-modal sheet |
| `tugdeck/src/components/tugways/tug-confirm-popover.tsx` | 8g | Button-anchored confirmation |
| `tugdeck/src/components/tugways/tug-toast.tsx` | 8g | Toast via Sonner |
| `tugdeck/styles/tug-alert.css` | 8g | Alert/sheet/toast styles |
| `tugdeck/src/components/tugways/tug-color-picker.tsx` | 8h | Color picker |
| `tugdeck/src/components/tugways/tug-font-picker.tsx` | 8h | Font picker |
| `tugdeck/src/components/tugways/tug-coordinate-inspector.tsx` | 8h | Coordinate inspector |
| `tugdeck/src/components/tugways/tug-inspector-panel.tsx` | 8h | Inspector container |
| `tugdeck/styles/tug-inspector.css` | 8h | Inspector styles |
| `tugdeck/src/components/chrome/dock.tsx` | 8i | Dock rewrite |
| `tugdeck/src/components/chrome/dock.css` | 8i | Dock styles |
| `tugdeck/src/components/chrome/dock-config.ts` | 8i | DockConfig type + defaults |

#### Files deleted {#files-deleted}

| File | Phase | Reason |
|----------|-------|-----------|
| `tugdeck/src/components/ui/*.tsx` (13 files) | 8a | shadcn wrappers removed |
| `tugdeck/styles/shadcn-base.css` | 8a | shadcn stylesheet removed |
| `tugdeck/components.json` | 8a | shadcn config removed |
| `tugdeck/styles/tug-comp-tokens.css` | 8a | Legacy `--tug-comp-*` tokens migrated to `--tug-<component>-*` |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `roadmap/design-system-concepts.md` -- remove shadcn references from D05, D06, D07 and Concept 2; describe direct Radix wrapping
- [ ] Update `roadmap/tugways-implementation-strategy.md` -- update all phase descriptions for Radix-direct approach
- [ ] Update `CLAUDE.md` -- remove any shadcn references if present
- [ ] Document the control state token pattern as a Rule of Tugways in `design-system-concepts.md`
- [ ] Document the "control vs content" CSS convention (which elements get control state tokens, which stay static)
- [ ] Add all 31 components to the Component Gallery with interactive demos

---

### Test Plan Concepts {#test-plan-concepts}

> Describe the kinds of tests that prove the spec. Leave the actual enumeration of tests to the Execution Steps below.

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual component rendering, prop handling, state management | Every Tug component, token resolution |
| **Integration** | Test component interactions (alert flow, inspector focus-change, dock button dispatch) | Cross-component workflows |
| **Accessibility** | Verify keyboard navigation, ARIA roles, focus management | Every interactive component |
| **Visual regression** | Verify control state styling renders correctly across themes | After establishing the token pattern |
| **Build verification** | Verify zero shadcn imports, clean build, no warnings | After shadcn excision and every subsequent step |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **Phase dependency graph** (Steps 4 and 5 are order-independent -- either can proceed without the other's output -- but both modify `package.json` and the Component Gallery, so they should be done sequentially to avoid merge conflicts):
>
> ```
> Step 1 (8a: Shadcn Excision)
>     |
>     v
> Step 2 (8b: Control State Visual Language)
>     |
>     +--------------------+
>     v                    v
> Step 3 (8c:          Step 4 + Step 5 (order-independent):
> Card Frame &         8d: Form Controls & Core Display
> Title Bar)           8e: Navigation, Data Display & Viz
>     |                    |
>     |                    v
>     |                Step 6 (8f: Compound Components)
>     |                    |
>     +--------+-----------+
>              v
>          Step 7 (8g: Alerts)
>              |
>              v
>          Step 8 (8h: Inspector Panels)
>              |
>              v
>          Step 9 (8i: Dock)
> ```

#### Step 1: Shadcn Excision {#step-1}

**Commit:** `refactor(tugdeck): remove shadcn layer, wrap Radix primitives directly`

**References:** [D01] Radix-direct wrapping replaces shadcn, [D03] Component file organization, Table T01, (#context, #radix-audit)

**Artifacts:**
- Rewritten `tug-button.tsx` and `tug-button.css` (plain `<button>` with Radix Slot for `asChild` polymorphism; variant CSS sufficient to pass existing tests; control state tokens wired in Step 2)
- Rewritten `tug-dropdown.tsx` and `tug-dropdown.css` (wraps `@radix-ui/react-dropdown-menu` directly)
- Deleted `components/ui/` directory (13 files)
- Deleted `styles/shadcn-base.css`
- Deleted `components.json`
- Deleted `styles/tug-comp-tokens.css` (legacy `--tug-comp-*` tokens migrated to `--tug-<component>-*`)
- Updated `css-imports.ts` (removed shadcn-base.css import)
- Updated `globals.css` (removed tug-comp-tokens.css import)
- Updated `scaffold.test.tsx`
- Updated all files referencing `--tug-comp-*` tokens
- Updated documentation files
- Retained `lib/utils.ts` (`cn()` utility depends only on `clsx`, not shadcn)

**Tasks:**
- [ ] Rewrite TugButton as a plain `<button>` element with Radix Slot for `asChild` polymorphism (Slot is a polymorphism utility, not a button primitive); remove CVA dependency if unused elsewhere. Step 1 TugButton needs variant CSS sufficient to pass existing tests -- control state styling is added in Step 2. CSS properties to extract from shadcn into `tug-button.css`: padding per size (sm/md/lg), font-size per size, height per size (sm=36px, md=40px, lg=44px), background-color per variant at rest/hover/active/disabled (primary uses `--tug-base-accent-cool-default`, secondary uses default surface, ghost transparent, destructive uses `--tug-base-accent-danger`), border per variant (existing `tug-button-bordered` class), color per variant (primary/destructive use `--tug-base-fg-inverse`), icon-subtype square dimensions per size, disabled opacity (0.5). The existing `tug-button.css` already has variant hover/active/disabled rules -- preserve and extend these
- [ ] Rewrite TugDropdown to use `@radix-ui/react-dropdown-menu` directly (import primitives from `@radix-ui/react-dropdown-menu` instead of `components/ui/dropdown-menu`); move all styling to `tug-dropdown.css`
- [ ] Verify TugDropdown blink animation works after shadcn removal: the WAAPI blink reads computed `--tug-base-surface-default` and `--tug-base-motion-easing-standard` values, then dispatches synthetic Escape to close the menu. These CSS variable reads depend on the menu item DOM element existing with the correct computed styles -- test that the selection blink plays and menu closes correctly with the new direct Radix imports
- [ ] Delete all 13 files in `components/ui/`
- [ ] Delete `styles/shadcn-base.css` (~25KB)
- [ ] Delete `components.json`
- [ ] Remove `class-variance-authority` from `package.json` if no longer referenced
- [ ] Relocate any still-needed animation keyframes from shadcn-base.css into relevant Tug component CSS files as `tug-*` named keyframes
- [ ] Update `css-imports.ts` to remove the shadcn-base.css import (the import is in `css-imports.ts`, not `globals.css`)
- [ ] Migrate all `--tug-comp-*` tokens to `--tug-<component>-*` naming. Run `grep -r "tug-comp-" tugdeck/src/ tugdeck/styles/ --include="*.css" --include="*.ts" --include="*.tsx"` to find all references. Files requiring content changes: `tug-comp-tokens.css` (84 occurrences, deleted after migration), `style-inspector-overlay.ts` (31), `tugcard.css` (9), `tug-tab-bar.css` (7), `style-inspector-overlay.test.ts` (7), `tug-dropdown.css` (5), `gallery-cascade-inspector-content.tsx` (4), `tug-button.css` (1), `tug-tokens.css` (1), `globals.css` (1 -- the @import). `shadcn-base.css` (1 occurrence) is deleted separately. Delete `styles/tug-comp-tokens.css`; remove its `@import` from `globals.css`
- [ ] Update `scripts/check-legacy-tokens.sh`: (a) add a `run_grep` call for `tug-comp-` as a legacy pattern so CI catches any regressions, and (b) change the FAIL message on line 87 from "Migrate to --tug-base-* or --tug-comp-* naming" to "Migrate to --tug-base-* or --tug-<component>-* naming" -- `--tug-comp-*` is banned per [D05]
- [ ] Retain `lib/utils.ts` (`cn()` utility) -- it depends only on `clsx`, not shadcn; do not delete it
- [ ] Update `scaffold.test.tsx` (currently imports Button from `ui/`)
- [ ] Update `design-system-concepts.md` -- remove shadcn references from D05, D06, D07 and Concept 2
- [ ] Update `tugways-implementation-strategy.md` -- update phase descriptions
- [ ] Update `CLAUDE.md` if any shadcn references exist

**Tests:**
- [ ] `bun run build` succeeds with zero warnings
- [ ] `bun test` -- all existing tests pass
- [ ] TugButton renders and responds to click in all variants
- [ ] TugDropdown opens, shows items, handles selection
- [ ] TugDropdown blink animation plays on item selection and menu closes after blink completes
- [ ] No `components/ui` imports exist in production source (excluding `_archive/`)

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] `grep -r "components/ui" tugdeck/src/ --include="*.tsx" --include="*.ts" | grep -v _archive` returns empty
- [ ] `grep -r "tug-comp-" tugdeck/src/ tugdeck/styles/ --include="*.css" --include="*.ts" --include="*.tsx"` returns empty

---

#### Step 2: Control State Visual Language {#step-2}

**Depends on:** #step-1

**Status:** COMPLETE (merged via semantic-token-vocabulary and semantic-token-migration plans, plus interactive tuning)

**What was done:**
- Defined complete `--tug-base-control-{variant}-{property}-{state}` token taxonomy in `tug-base.css` — 4 variants × 4 properties × 3 states = 48 control tokens plus disabled variants
- Implemented retronow-inspired TugButton styling: pill shape (border-radius: 999px), all-caps labels, colored borders, progressive lightening through rest → hover → active
- Wired all hover/active CSS rules to stateful tokens for bg, fg, border-color, and icon color
- Theme overrides in `bluenote.css` and `harmony.css` updated to stateful token names
- Q01 resolved: no gradients — color states provide all visual feedback
- TugButton gallery card shows all variants × sizes × states for interactive tuning

---

#### Step 3: Card Frame & Title Bar {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): card title bar with control state styling and window-shade collapse`

**References:** [D04] Token-driven control state model, [D07] Window-shade collapse, (#control-state-spec)

**Artifacts:**
- `CardTitleBar` component merged into `tug-card.tsx` (not a separate file). CardTitleBar props interface:
  - `title: string` -- display title (from effectiveMeta.title)
  - `icon?: string` -- lucide icon name (from effectiveMeta.icon); CardHeader renders the icon via lucide-react lookup
  - `closable?: boolean` -- whether to show close button (default true; from effectiveMeta.closable)
  - `collapsed: boolean` -- current collapse state
  - `onCollapse: () => void` -- toggle collapse callback
  - `onClose?: () => void` -- close callback (omitted when closable is false)
  - `onDragStart?: (event: React.PointerEvent) => void` -- header pointerdown for drag initiation
  - Close button pointer-capture behavior (`setPointerCapture`/`pointerup` hit-test pattern) transfers into CardHeader as internal implementation; the `onClose` callback fires only on confirmed pointer-up-inside or keyboard Enter/Space
- New `tug-card.css` with control state styles for title bar controls
- Updated `card-frame.tsx` with collapsed height handling
- Updated `deck-manager.ts` with collapse state management
- Updated `serialization.ts` with collapsed state persistence
- Title bar demo in Component Gallery

**Tasks:**
- [ ] Implement window-shade collapse: CSS height transition to `CARD_TITLE_BAR_HEIGHT` (28px) + border; wire existing `collapsed?: boolean` field in `CardState` (already in `layout-tree.ts`)
- [ ] Add collapse/expand toggle via chevron icon (`ChevronDown`/`ChevronUp` from lucide-react) replacing current `Minus` icon
- [ ] Change menu icon from `EllipsisVertical` to `Ellipsis` (horizontal)
- [ ] Implement basic close button (closes immediately, no confirmation -- deferred to Step 7). Note: the current close button uses `setPointerCapture` on `pointerdown` to suppress browser focus/selection side effects. When Step 7 wraps this button in `TugConfirmPopover`, the pointer capture may conflict with Radix Popover's focus management -- Step 7 must verify that pointer capture is released before the popover opens, or switch the close button to a standard click handler
- [ ] Title bar control buttons are literal ghost buttons (`tug-button tug-button-ghost tug-button-icon-sm`); title bar surface stays flat
- [ ] Wire collapse state into DeckManager: collapsed cards use collapsed height in snap sets; expanding restores previous height
- [ ] Persist collapsed state: wire serialization to read/write `collapsed` field in `CardState`
- [ ] Implement double-click on title bar to toggle collapse
- [ ] Hide resize handles when collapsed; keep drag active
- [ ] Add title bar demo to Component Gallery (collapse toggle, menu, close in all three themes)

**Tests:**
- [ ] Clicking chevron collapses card to title bar height
- [ ] Clicking chevron again expands card to previous height
- [ ] Collapsed state persists across page reload
- [ ] Close button removes the card
- [ ] Double-click on title bar toggles collapse
- [ ] Resize handles are hidden when collapsed
- [ ] Collapsed cards can still be dragged

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] Collapse a card, reload page, verify card is still collapsed
- [ ] Title bar buttons use ghost control state tokens (visual review)

---

#### Step 4: Form Controls & Core Display {#step-4}

**Depends on:** #step-2

**Approach: Interactive, one component at a time.** The original plan called for building all 17 Tier 1-2 components in one step. In practice, each control needs hands-on style tuning in the Component Gallery before moving to the next. The process for each component is:

1. Build the component (`.tsx` + `.css`) using `--tug-base-control-*` tokens
2. Add a gallery section with all variants/states
3. Tune token values interactively until the look is right across all themes
4. Write tests
5. Commit, then move to the next component

**References:** [D02] Three component kinds, [D04] Token-driven control state model, [D05] Component token naming, Table T02, (#component-inventory, #radix-audit, #control-state-spec, #token-convention)

**Component build order** (prioritized by downstream need and complexity):

| Order | Component | Kind | Notes |
|-------|-----------|------|-------|
| 1 | TugInput | Wrapper (native) | Most-needed form control; validation states, field tokens |
| 2 | TugLabel | Wrapper (Radix) | Pairs with TugInput; required indicator, helper text |
| 3 | TugCheckbox | Wrapper (Radix) | Mixed state, control state colors |
| 4 | TugSwitch | Wrapper (Radix) | Track/thumb with control state tokens |
| 5 | TugSelect | Wrapper (Radix) | Token-based trigger and popover |
| 6 | TugSlider | Wrapper (Radix) | Value display, action phases |
| 7 | TugRadioGroup | Wrapper (Radix) | Group label, layout options |
| 8 | TugTextarea | Wrapper (native) | Auto-resize, char count |
| 9 | TugToggle | Wrapper (Radix) | Pressed/unpressed control state colors |
| 10 | TugSeparator | Wrapper (Radix) | Simple; horizontal/vertical |
| 11 | TugBadge | Original | Tone variants, pill shape |
| 12 | TugSpinner | Original | Size variants |
| 13 | TugProgress | Wrapper (Radix) | Bar, percentage, indeterminate |
| 14 | TugSkeleton | Enhance existing | Update to `--tug-skeleton-*` tokens |
| 15 | TugKeyboard | Original | Keycap chip |
| 16 | TugAvatar | Wrapper (Radix) | Image + fallback initials |
| 17 | TugStatusIndicator | Original | Tone-colored dot + text |

**Per-component tasks (repeated for each):**
- [ ] Build `.tsx` and `.css` using `--tug-base-control-*` stateful tokens
- [ ] Add gallery section with variants, sizes, states (rest/hover/active/disabled)
- [ ] Tune styles interactively in Component Gallery
- [ ] Write unit tests (renders, keyboard nav, accessibility)
- [ ] Commit

**Install Radix packages as needed:** `@radix-ui/react-label`, `@radix-ui/react-slider`, `@radix-ui/react-toggle`, `@radix-ui/react-avatar`, `@radix-ui/react-progress`, `@radix-ui/react-separator`

**Tests (per component):**
- [ ] Renders without errors
- [ ] Keyboard navigation works (Tab, Enter, Space, Arrow keys as appropriate)
- [ ] Control state tokens resolve correctly across all themes
- [ ] Disabled state shows reduced opacity, no interaction

**Checkpoint (after all components):**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] All Tier 1-2 components visible in Component Gallery

---

#### Step 5: Navigation, Data Display & Visualization {#step-5}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): build Tier 3-5 Tug components and additional Radix wrappers`

**References:** [D02] Three component kinds, [D04] Token-driven control state model, Table T01, Table T02, List L01, Spec S02, (#component-inventory, #radix-audit)

**Artifacts:**
- 5 Tier 3 navigation/overlay components (TugTooltip, TugScrollArea, TugContextMenu, TugPopover, TugDialog); note: TugDropdown was already rewritten in Step 1
- 2 Tier 4 data display components (TugTable, TugStatCard)
- 3 Tier 5 visualization components (TugSparkline, TugLinearGauge, TugArcGauge)
- 3 additional Radix-based components (TugAccordion, TugToggleGroup, TugToolbar)
- New Radix packages installed
- All added to Component Gallery

**Tasks:**
- [ ] Install Radix packages: `@radix-ui/react-accordion`, `@radix-ui/react-popover`, `@radix-ui/react-toggle-group`, `@radix-ui/react-toolbar`, `@radix-ui/react-context-menu`
- [ ] Build TugTooltip (wraps Radix Tooltip: hover labels, keyboard shortcut display)
- [ ] Build TugScrollArea (wraps Radix ScrollArea: themed scrollbar, autohide)
- [ ] Build TugContextMenu (wraps Radix ContextMenu: right-click menus for cards)
- [ ] Build TugPopover (wraps Radix Popover: general anchored overlay)
- [ ] Build TugDialog (wraps Radix Dialog: general-purpose dialog)
- [ ] Build TugTable (original: header/row/cell, sortable columns, stripe option)
- [ ] Build TugStatCard (original: key-value metric with label + large number + trend)
- [ ] Build TugSparkline (original: SVG inline chart with area, line, column, bar variants)
- [ ] Build TugLinearGauge (original: horizontal gauge with needle, thresholds, tick marks)
- [ ] Build TugArcGauge (original: radial gauge with needle, arc fill, center readout)
- [ ] Build TugAccordion (wraps Radix Accordion: collapsible content sections)
- [ ] Build TugToggleGroup (wraps Radix ToggleGroup: exclusive/multi toggle row, token-driven states)
- [ ] Build TugToolbar (wraps Radix Toolbar: grouped controls with arrow key navigation)
- [ ] Apply control state tokens on trigger elements for navigation/overlay components
- [ ] Build SVG-based visualization components with theme-token-aware styling
- [ ] Add all to Component Gallery; write tests

**Tests:**
- [ ] TugTooltip shows on hover, hides on mouse leave
- [ ] TugContextMenu opens on right-click with correct items
- [ ] TugScrollArea shows themed scrollbar
- [ ] TugTable sorts columns on header click
- [ ] TugSparkline renders SVG with correct data points
- [ ] TugAccordion expands/collapses sections
- [ ] TugToolbar supports arrow key navigation between grouped controls
- [ ] All visualization components render with theme tokens

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] All Tier 3-5 and additional Radix-based components from this step visible in Component Gallery (TugDropdown already rewritten in Step 1, not rebuilt here)
- [ ] Component Gallery shows all components built so far across Steps 1, 4, and 5 (everything except the 3 Tier 6 compositions from Step 6)

---

#### Step 6: Compound Components & Gallery Completion {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `feat(tugdeck): build composition components, complete Component Gallery`

**References:** [D02] Three component kinds, Table T02, (#component-inventory, #retronow-reference)

**Artifacts:**
- 3 composition components (TugButtonGroup, TugChatInput, TugSearchBar)
- Reorganized Component Gallery with tabbed sections by tier
- Gallery dogfoods TugAccordion, TugToggleGroup, TugToolbar for its own UI

**Tasks:**
- [ ] Build TugButtonGroup (composition: connected button row with shared border radius)
- [ ] Build TugChatInput (composition: TugTextarea + TugButton x 2, Enter to submit)
- [ ] Build TugSearchBar (composition: TugInput + TugButton)
- [ ] Organize gallery into tabbed sections by tier
- [ ] Each section shows all components in all variants, all states (rest/hover/focus/active/disabled), all three themes
- [ ] Add interactive controls for toggling variants, sizes, states
- [ ] Gallery dogfoods TugAccordion, TugToggleGroup, TugToolbar for its own UI

**Tests:**
- [ ] TugButtonGroup renders connected buttons with shared border radius
- [ ] TugChatInput submits on Enter, shows attachment button
- [ ] TugSearchBar triggers search on button click and Enter
- [ ] Component Gallery tab navigation works
- [ ] Gallery renders all 31 components without errors

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] Full 31-component library visible in Component Gallery
- [ ] Gallery uses its own components (accordion, toggle group, toolbar) for navigation

---

#### Step 7: Alerts {#step-7}

**Depends on:** #step-3, #step-6

**Commit:** `feat(tugdeck): alert system with TugAlert, TugSheet, TugConfirmPopover, TugToast`

**References:** [D06] Four modal categories, [D07] Window-shade collapse, [D10] Default button, (#d06-four-modal-categories, #d10-default-button)

**Artifacts:**
- `tug-alert-host.tsx` -- app root alert host
- `tug-sheet.tsx` -- card-modal sheet
- `tug-confirm-popover.tsx` -- button-anchored confirmation
- `tug-toast.tsx` -- Sonner-based toasts
- `tug-alert.css` -- styles for all alert components
- Updated `responder-chain-manager.ts` -- added `modalScope` property and node suspension support
- Updated `tug-card.tsx` -- TugConfirmPopover wired onto close button in CardTitleBar
- Alert/sheet/popover/toast demos in Component Gallery

**Tasks:**
- [ ] Install `@radix-ui/react-alert-dialog` (not in package.json yet)
- [ ] Install `sonner` (not in package.json yet)
- [ ] Add `modalScope` property to `ResponderChainManager`: `null` (normal), `"app"` (TugAlert blocks all dispatch), or a card ID (TugSheet blocks that card's subtree)
- [ ] Add `suspended` flag to `ResponderNode`: when true, `dispatch()` calls targeting this node's subtree are refused
- [ ] Modify `dispatch()` to check `modalScope` -- when `modalScope === "app"`, return `false` (callers already handle `false` as "not handled"). During app-modal scope, the alert's own default button mechanism still works because it uses direct click dispatch, not the responder chain walk
- [ ] Modify `dispatchTo()` to check node `suspended` flag -- when the target node or an ancestor is suspended, return `false`. The `setDefaultButton` mechanism for the alert/sheet's own buttons operates independently of the suspended check (the default button is registered on the alert/sheet's own scope, not on a suspended node)
- [ ] Build TugAlertHost: mount at app root, render AlertDialog instances driven by imperative queue; on open, set `modalScope: "app"` on the responder chain; on close, clear it
- [ ] Implement `tugAlert()`: imperative Promise API returning the clicked button role; supports `default`, `cancel`, `destructive` button roles
- [ ] Build TugSheet: card-modal dialog using Radix Dialog with `container` prop for scoped rendering. The container target must be the root `.tugcard` element (not `.tugcard-content`) so the overlay covers both header and content -- this requires Tugcard to expose a ref to its root div. TugSheetHost renders as a direct child of `.tugcard` (sibling of header, accessory, and content), using `position: absolute; inset: 0` to overlay the entire card. On open, mark card's responder node as `suspended`; on close, clear it
- [ ] Implement `tugSheet()`: imperative Promise API scoped to a card ID
- [ ] Build TugConfirmPopover: wraps Radix Popover, declarative component API with `onConfirm`, `message`, `confirmLabel`, `confirmVariant` props
- [ ] Build TugToast: Sonner integration with tone variants (good/warn/alert/info), auto-dismiss, configurable duration
- [ ] Wire close confirmation into title bar: card close button from Step 3 now wrapped in `TugConfirmPopover`; click X -> popover appears -> click "Close" or Enter -> card closes
- [ ] Wire default button mechanism: alerts and sheets register default button via `setDefaultButton`; when destructive button present, cancel is default; when no destructive, affirmative is default
- [ ] Implement alert styles: `"informational"`, `"warning"`, `"critical"` with appropriate icon treatment
- [ ] Resolve [Q02] by shipping always-confirm and noting conditional-confirm as Phase 9 work
- [ ] Resolve [Q03] by spiking Sonner styling integration
- [ ] Add all alert/sheet/popover/toast components to Component Gallery with interactive demos

**Tests:**
- [ ] `tugAlert()` returns Promise that resolves to clicked button label
- [ ] Alert blocks responder chain: `dispatch()` returns `false` when `modalScope === "app"`; alert's own default button still activates via Enter
- [ ] TugSheet blocks only the target card's responder node: `dispatchTo()` returns `false` for suspended node; other cards dispatch normally; sheet's own default button still activates
- [ ] TugConfirmPopover opens on trigger click, closes on Escape/click-away
- [ ] TugConfirmPopover confirm button fires `onConfirm`
- [ ] Close button on card title bar shows confirmation popover
- [ ] Default button responds to Enter in alerts, sheets, and popovers
- [ ] Destructive button is never the default
- [ ] TugToast appears and auto-dismisses
- [ ] TugToast never steals focus

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] Alert flow: trigger alert -> respond -> verify Promise resolves with correct value
- [ ] Close confirmation flow: click X -> popover -> confirm -> card closes
- [ ] Toast flow: fire toast -> verify it appears -> verify it auto-dismisses

---

#### Step 8: Inspector Panels {#step-8}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): inspector panels with color picker, font picker, coordinate inspector`

**References:** [D04] Token-driven control state model, [D05] Component token naming, Spec S02, (#component-inventory)

**Artifacts:**
- `tug-color-picker.tsx` -- hue/saturation/brightness, opacity, hex/RGB input, swatch history
- `tug-font-picker.tsx` -- font family, size, weight/style toggles
- `tug-coordinate-inspector.tsx` -- x/y/width/height with scrub-on-drag
- `tug-inspector-panel.tsx` -- container that hosts inspector sections
- `tug-inspector.css` -- inspector styles
- Inspector demos in Component Gallery

**Tasks:**
- [ ] Build TugColorPicker (original): hue/saturation/brightness wheel or strip, opacity slider, hex/RGB input, swatch history; emits `setColor` action with `begin/change/commit/cancel` phases; uses MutationTransaction for live preview during `change` phase
- [ ] Build TugFontPicker (original): font family dropdown (system fonts), font size TugSlider, weight/style toggles; emits `setFontSize`, `setFontFamily`, `setFontWeight` actions with phases
- [ ] Build TugCoordinateInspector (original): x/y/width/height number fields with scrub-on-drag (drag the label to scrub the value); emits `setPosition`, `setSize` actions with phases; reads from PropertyStore
- [ ] Build TugInspectorPanel (composition): container hosting inspector sections; reads `PropertyStore.getSchema()` from focused card; dynamically renders controls; registers as responder node; uses explicit-target dispatch to send edits to focused card
- [ ] Wire focus-change response: when focused card changes, inspector reads new card's PropertyStore schema; if no PropertyStore, shows "No inspectable properties"
- [ ] Add all inspector components to Component Gallery with interactive demos

**Tests:**
- [ ] TugColorPicker scrub previews live with MutationTransaction, commit persists, cancel reverts
- [ ] TugFontPicker changes cascade through CSS
- [ ] TugCoordinateInspector reflects current values and updates on external changes
- [ ] TugInspectorPanel shows controls for focused card's properties
- [ ] Switching focused card updates inspector contents
- [ ] Card with no PropertyStore shows "No inspectable properties"

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] Color picker: drag hue slider -> see live preview on target -> release -> value persisted
- [ ] Inspector: focus card A -> see A's properties -> focus card B -> see B's properties

---

#### Step 9: Dock {#step-9}

**Depends on:** #step-7

**Commit:** `feat(tugdeck): dock rewrite with three button types and edge placement`

**References:** [D08] Three dock button types, [D09] Dock placement, [D04] Token-driven control state model, Spec S02, (#d08-dock-button-types, #d09-dock-placement, #control-state-spec)

**Artifacts:**
- `dock.tsx` -- full rewrite with three button types
- `dock.css` -- dock styles with control state tokens
- `components/chrome/dock-config.ts` -- DockConfig type and default configuration
- Dock demo in Component Gallery

**Tasks:**
- [ ] Rewrite dock from scratch with three button types: card toggle, command, popout menu
- [ ] Define `DockConfig` type: typed configuration object where each button specifies type, icon, label, action, optional badge
- [ ] Implement card toggle buttons: show/focus/toggle card; badge count display
- [ ] Implement command buttons: fire callback immediately on click
- [ ] Implement popout menu buttons: open TugDropdown anchored to dock button; menu position adjusts based on dock edge
- [ ] Implement dock placement: right (default), left, top, bottom; persist in settings API
- [ ] Compute dock CSS from placement setting: `flex-col` for vertical, `flex-row` for horizontal; canvas inset adjusts
- [ ] Apply control state tokens to dock buttons; active state (card visible) uses accent-colored indicator
- [ ] Add TugTooltip hover labels on each dock button (label + keyboard shortcut)
- [ ] Wire dock button actions through responder chain (no direct DeckManager coupling)
- [ ] Add dock demo to Component Gallery

**Tests:**
- [ ] Card toggle button creates/focuses/toggles card
- [ ] Command button fires callback on click
- [ ] Popout menu opens anchored to button, on correct side based on dock placement
- [ ] Dock renders correctly on all four edges
- [ ] Dock placement persists across reload
- [ ] Dock buttons show tooltips on hover
- [ ] Dock buttons dispatch through responder chain

**Checkpoint:**
- [ ] `bun run build` exits 0
- [ ] `bun test` exits 0
- [ ] Dock on right edge: menu opens left; switch to bottom: menu opens above
- [ ] Change dock placement, reload, verify dock appears on correct edge
- [ ] All three button types functional in demo

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** Complete 31-component Tugways library built on Radix primitives with control state visual language, full alert system, inspector panels, and dock -- replacing shadcn entirely.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero shadcn imports in production code (`grep -r "components/ui" tugdeck/src/ --include="*.tsx" --include="*.ts" | grep -v _archive` returns empty)
- [ ] All 31 components render in Component Gallery across all three themes
- [ ] `bun run build` exits 0 with zero warnings
- [ ] `bun test` exits 0 with all tests passing
- [ ] Window-shade collapse persists across reloads
- [ ] `tugAlert()` Promise resolves with correct button role
- [ ] Close confirmation popover works on card title bar close button
- [ ] Inspector panels update when focused card changes
- [ ] Dock supports all three button types and all four edge placements
- [ ] Dock placement persists across reloads

**Acceptance tests:**
- [ ] Full alert flow: `tugAlert({ title: "Test", buttons: [{ label: "OK", role: "default" }] })` resolves to `"OK"`
- [ ] Full sheet flow: `tugSheet(cardId, { title: "Test", buttons: [...] })` resolves correctly
- [ ] Full confirm flow: click close X -> popover -> confirm -> card closes
- [ ] Full toast flow: `tugToast.success("Test")` -> toast appears -> auto-dismisses
- [ ] Full inspector flow: focus card -> inspector shows properties -> edit value -> value persists
- [ ] Full dock flow: click card toggle -> card appears; click popout -> menu opens on correct side

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Conditional close confirmation (only for cards with unsaved state) -- requires card model extension in Phase 9
- [ ] Additional dock button types (e.g., mode toggles, drag-to-reorder)
- [ ] Component library npm packaging for external use
- [ ] Phase 9: Card Rebuild -- uses the component library built here
- [ ] Accessibility audit beyond WCAG 2.1 AA keyboard navigation

| Checkpoint | Verification |
|------------|--------------|
| shadcn fully removed | `grep -r "shadcn\|components/ui" tugdeck/src/ --include="*.tsx" --include="*.ts" \| grep -v _archive` returns empty |
| 31 components built | Component Gallery renders all 31 without errors |
| Control state visual language | TugButton in all three themes shows correct rest/hover/active token colors |
| Alert system complete | All four modal categories functional |
| Inspector panels work | Focus-change updates inspector |
| Dock rewrite complete | Three button types + four edge placements |
