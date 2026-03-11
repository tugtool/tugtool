# Tugways Phase 8 — Radix Foundation & 2.5D Visual Identity

## Summary

This proposal replaces shadcn with direct Radix primitives as the component foundation, defines the full Tug component inventory built on Radix, introduces a "2.5D" visual language called Tugways where controls are tactile objects that float above the canvas surface, and consolidates all Phase 8 work — components, chrome, alerts, inspectors, and dock — into a single phased plan.

The work breaks into nine phases:

- **Phase 8a**: Shadcn Excision — remove all shadcn artifacts, replace with direct Radix wrappers
- **Phase 8b**: Tugways 2.5D Visual Language — define and implement the elevation/light/shadow system
- **Phase 8c**: Card Frame & Title Bar — 2.5D title bar chrome with window-shade collapse (basic close, no confirmation yet)
- **Phase 8d**: Form Controls & Core Display — build all Tier 1–2 Tug components on Radix
- **Phase 8e**: Navigation, Data Display & Visualization — build Tier 3–5 Tug components
- **Phase 8f**: Compound Components & Gallery Completion — compositions, gauges, polish
- **Phase 8g**: Alerts — alert host, sheets, confirm popovers, toasts; wire close confirmation into title bar
- **Phase 8h**: Inspector Panels — color picker, font picker, coordinate inspector, inspector panel
- **Phase 8i**: Dock — rewrite dock from scratch with three button types and edge placement

---

## Motivation

### Why Remove shadcn

shadcn was adopted as a convenience layer over Radix. In practice, it has become a liability:

1. **Opinionated styling fights our design system.** shadcn components ship with Tailwind utility strings (now converted to semantic CSS in `shadcn-base.css`, but still carrying shadcn's design opinions). Every Tug component must override these opinions. This is backwards — we're fighting defaults instead of building from clean primitives.

2. **The "private ui/ layer" adds unnecessary indirection.** The current architecture is: Radix primitive -> shadcn wrapper in `components/ui/` -> Tug wrapper in `components/tugways/`. With direct Radix wrapping, this collapses to: Radix primitive -> Tug component. One layer instead of two.

3. **shadcn CLI is incompatible with our build.** Phase 7d already prohibits installing new shadcn components. We removed Tailwind. The shadcn ecosystem assumes Tailwind. There's no path forward with shadcn.

4. **Only 2 shadcn components are actively used.** Button and DropdownMenu are the only production imports. The other 11 components in `ui/` are dead weight.

### Why Radix Directly

Radix primitives provide exactly what we need and nothing we don't:

- **Accessible by default** — ARIA roles, keyboard navigation, focus management
- **Unstyled** — zero visual opinions, we apply our own CSS from scratch
- **Composable** — compound component patterns (Root/Trigger/Content) that map cleanly to our composition model
- **Presence management** — enter/exit animations via `data-state`, which Rule 14 already depends on

We already have 10 Radix packages installed. The primitives are proven infrastructure.

### The 2.5D Visual Language

The entire computer industry has been stuck in a "flat design" rut for over a decade. Tugways breaks from this with a tactile, 2.5D aesthetic:

**Core principles:**
- **Controls are objects.** Buttons look like buttons. They have physical presence — they float slightly above the canvas surface.
- **Clear definition between controls and content.** You can always tell what's interactive and what's informational.
- **Far-distant top-center light source.** A subtle, consistent light model creates depth without heavy gradients.
- **Hover/rollover response.** Controls lighten or darken on hover, providing immediate feedback.
- **Press interaction.** Controls are "pushed down" toward the canvas on press. The shadow collapses (the control gets closer to the surface), and the top highlight dims.
- **Minimal gradients.** Depth comes from shadows, highlights, and elevation changes — not from gradient fills.
- **Tiny top reflection + larger bottom shadow.** The reflection is a 1px or sub-pixel highlight on the top edge. The shadow is a soft spread beneath the control that "collapses" on press.

**The elevation model:**

```
Light source: top-center, far distant
         ↓↓↓↓↓↓↓↓↓

  ┌──────────────────┐  ← 1px top highlight (reflection)
  │     CONTROL      │  ← slightly lighter face than canvas
  └──────────────────┘
  ░░░░░░░░░░░░░░░░░░░░  ← soft shadow (larger spread)

  [on hover: face lightens slightly]

  [on press:]
  ┌──────────────────┐  ← highlight dims
  │     CONTROL      │  ← face darkens slightly
  └──────────────────┘
  ░░░░░░░░░░░░░░░░░░░░  ← shadow collapses (smaller spread, less offset)
```

**CSS implementation approach:**
- `box-shadow` for the bottom shadow (collapse via transition on `:active`)
- `box-shadow inset` or `border-top` for the top highlight
- `background-color` shift on hover/active (not gradients)
- `transform: translateY(1px)` on active (press down)
- `transition` for smooth state changes
- All values driven by `--tug-base-*` and `--tug-<component>-*` tokens

---

## Phase 8a: Shadcn Excision

**Goal**: Remove all shadcn artifacts. Replace the two active shadcn components (Button, DropdownMenu) with direct Radix wrappers. Delete the `components/ui/` directory. Delete `shadcn-base.css`. Delete `components.json`.

### What to do

1. **Rewrite TugButton** — currently wraps `components/ui/button.tsx` (which wraps Radix Slot). Rewrite to use `@radix-ui/react-slot` directly. Move all styling to `tug-button.css`. Remove CVA (class-variance-authority) dependency if no longer needed elsewhere.

2. **Rewrite TugDropdown** — currently wraps `components/ui/dropdown-menu.tsx` (which wraps `@radix-ui/react-dropdown-menu`). Rewrite to use `@radix-ui/react-dropdown-menu` directly. Move all styling to `tug-dropdown.css`.

3. **Delete `components/ui/`** — all 13 files. None are imported by production code after steps 1–2. Archived card code in `_archive/` that imports from `ui/` stays broken (it's archived).

4. **Delete `styles/shadcn-base.css`** — the 25KB stylesheet of shadcn semantic classes. All styling moves to per-component Tug CSS files.

5. **Delete `components.json`** — the shadcn configuration file.

6. **Remove `class-variance-authority` from dependencies** if no longer referenced.

7. **Remove animation keyframes from shadcn-base.css** — `shadcn-fade-in/out`, `shadcn-zoom-in/out`, `shadcn-slide-in/out`. Relocate any that are still needed (for Radix `data-state` enter/exit) into the relevant Tug component CSS files as `tug-*` named keyframes.

8. **Update `globals.css`** — remove the `shadcn-base.css` import.

9. **Audit and update all documentation** — remove "shadcn" references from:
   - `roadmap/design-system-concepts.md` — update D05, D06, D07 and Concept 2 to describe direct Radix wrapping
   - `roadmap/tugways-implementation-strategy.md` — update all phase descriptions
   - `CLAUDE.md` — if any shadcn references exist
   - Any other roadmap docs that reference the shadcn layer

10. **Update the scaffold test** (`scaffold.test.tsx`) — currently imports Button from `ui/`.

11. **Verify**: all tests pass, app builds, no shadcn references remain in source code (excluding `_archive/` and historical plan files in `.tugtool/`).

### Files deleted
- `tugdeck/src/components/ui/*.tsx` (13 files)
- `tugdeck/styles/shadcn-base.css`
- `tugdeck/components.json`

### Files modified
- `tugdeck/src/components/tugways/tug-button.tsx`
- `tugdeck/src/components/tugways/tug-button.css`
- `tugdeck/src/components/tugways/tug-dropdown.tsx`
- `tugdeck/src/components/tugways/tug-dropdown.css`
- `tugdeck/src/globals.css`
- `tugdeck/package.json` (remove `class-variance-authority` if unused)
- `tugdeck/src/__tests__/scaffold.test.tsx`
- Documentation files (as listed above)

### Result
The `components/ui/` private layer is gone. Tug components wrap Radix primitives directly. One less layer of indirection. ~25KB of dead CSS removed. The shadcn chapter is closed.

---

## Phase 8b: Tugways 2.5D Visual Language

**Goal**: Define the elevation, light, and shadow token system. Implement it on TugButton as the reference component. Establish CSS patterns that all subsequent Tug components will follow.

### Token Design

New tokens in `tug-tokens.css` under the elevation domain:

```css
/* Elevation: the 2.5D light model */
--tug-base-elevation-highlight:       /* top-edge highlight color (light reflection) */
--tug-base-elevation-highlight-hover:  /* brighter on hover */
--tug-base-elevation-highlight-active: /* dims on press */

--tug-base-elevation-shadow:           /* resting shadow */
--tug-base-elevation-shadow-hover:     /* slightly deeper on hover */
--tug-base-elevation-shadow-active:    /* collapsed on press */

--tug-base-elevation-face:             /* control face color */
--tug-base-elevation-face-hover:       /* lightened on hover */
--tug-base-elevation-face-active:      /* darkened on press */

--tug-base-elevation-press-offset:     /* translateY distance on press (e.g., 1px) */
--tug-base-elevation-transition:       /* transition timing for state changes */
```

Per-theme overrides in `bluenote.css` and `harmony.css` — the light model adapts to each theme's surface colors and overall brightness.

### Component Token Pattern

Each Tug component gets `--tug-<component>-*` tokens that reference the base elevation tokens but can be overridden per-component. The `--tug-comp-*` prefix is **banned** — it adds nothing and is confusingly similar to CSS "computed" style. The naming convention is simply `--tug-<component>-<property>`, where `base` is the special root-level component that all others inherit from.

```css
/* Example: tug-button component tokens */
--tug-button-face:       var(--tug-base-elevation-face);
--tug-button-highlight:  var(--tug-base-elevation-highlight);
--tug-button-shadow:     var(--tug-base-elevation-shadow);
/* ...hover and active variants... */
```

### CSS Pattern (reference implementation on TugButton)

```css
.tug-button {
  background-color: var(--tug-button-face);
  box-shadow:
    inset 0 1px 0 0 var(--tug-button-highlight),   /* top reflection */
    0 1px 3px 0 var(--tug-button-shadow);           /* bottom shadow */
  transition: all var(--tug-base-elevation-transition);
}

.tug-button:hover {
  background-color: var(--tug-button-face-hover);
  box-shadow:
    inset 0 1px 0 0 var(--tug-button-highlight-hover),
    0 2px 4px 0 var(--tug-button-shadow-hover);
}

.tug-button:active {
  background-color: var(--tug-button-face-active);
  transform: translateY(var(--tug-base-elevation-press-offset));
  box-shadow:
    inset 0 1px 0 0 var(--tug-button-highlight-active),
    0 0px 1px 0 var(--tug-button-shadow-active);   /* shadow collapses */
}
```

### What to do

1. **Define elevation tokens** in `tug-tokens.css` with Brio defaults.
2. **Define elevation overrides** in `bluenote.css` and `harmony.css`.
3. **Implement 2.5D on TugButton** — the reference implementation that proves the visual language.
4. **Define the "control vs. content" CSS convention** — which elements get elevation treatment (interactive controls) vs. which stay flat (content areas, text, cards themselves). Document this as a Rule of Tugways.
5. **Create a "2.5D States" demo section in the Component Gallery** — shows the elevation model across all interactive states (rest, hover, focus, active, disabled) for TugButton in all variants and all three themes.
6. **Document the elevation pattern** — CSS recipe that every Tug component follows. Add to `design-system-concepts.md`.

### Design Constraints

- **No gradients on control faces.** Depth comes from shadow/highlight, not gradient fills. Exception: accent-colored controls (primary buttons) may use a very subtle (<5% opacity) top-to-bottom gradient for richer appearance.
- **Disabled controls lose elevation.** They go flat — no shadow, no highlight, reduced opacity.
- **Focus ring sits above the elevation layer.** The focus ring (outline) is independent of the shadow/highlight system.
- **Cards themselves do NOT get the 2.5D treatment on their faces.** Cards have their existing shadow system ([D57], [D58]). The 2.5D elevation is for interactive controls *within* cards and the dock.

### Result
The visual language is defined, implemented on the flagship component, and documented. Every subsequent Tug component follows this pattern.

---

## Phase 8c: Card Frame & Title Bar

**Goal**: Rebuild the card title bar with 2.5D visual language. Window-shade collapse, menu icon update, basic close button. Close confirmation is deferred to Phase 8g when the alert system exists.

**References**: Concept 10 ([D27]), retronow titlebar patterns.

### What to do

1. **Implement window-shade collapse** ([D27]) — CSS height transition to title bar height (~28px). Add `collapsed: boolean` to `CardState`. Collapse/expand toggle via chevron icon in the title bar. Collapsed cards show only the title bar; content area is hidden.
2. **Update card header chrome** — change menu icon from `EllipsisVertical` to `Ellipsis` (horizontal). Apply 2.5D elevation treatment to title bar control buttons (close, collapse, menu).
3. **Basic close button** — closes the card immediately without confirmation. Phase 8g wires `TugConfirmPopover` onto this button after the alert system exists.
4. **Title bar 2.5D treatment** — title bar buttons (close, collapse, menu) get the elevation model from Phase 8b. The title bar surface itself stays flat (it's chrome, not a control).
5. **Wire collapse state into DeckManager** — collapsed cards participate in snap sets normally (their frame geometry uses the collapsed height). Expanding a collapsed card restores its previous height.
6. **Persist collapsed state** — `collapsed` field in `CardState` is already defined in `layout-tree.ts` (added in Phase 5f). Wire serialization to read/write it. Cards restore their collapsed/expanded state on reload.
7. **Add title bar demo to Component Gallery** — shows collapse toggle, menu, close in all three themes.

### Files modified
- `tugdeck/src/components/chrome/card-header.tsx` — collapse toggle, menu icon, 2.5D buttons
- `tugdeck/src/components/chrome/card-header.css` — 2.5D elevation styles for title bar controls
- `tugdeck/src/components/chrome/card-frame.tsx` — collapsed height handling
- `tugdeck/src/deck-manager.ts` — collapse state management
- `tugdeck/src/serialization.ts` — collapsed state persistence (if not already wired)

### Result
Title bar is fully functional with window-shade collapse and 2.5D controls. Close works immediately (no confirmation yet — that comes in Phase 8g). Cards remember their collapsed state across reloads.

---

## Phase 8d: Form Controls & Core Display

**Goal**: Build all Tier 1 (form controls) and Tier 2 (display/feedback) components directly on Radix primitives with the 2.5D visual language.

### Radix Primitives to Wrap

The complete inventory of Radix UI primitives and which ones we'll use:

| Radix Primitive | Tug Component | Status |
|----------------|---------------|--------|
| Accordion | TugAccordion | NEW — collapsible content sections |
| Alert Dialog | TugAlertDialog | Phase 8g |
| Aspect Ratio | — | Skip — CSS `aspect-ratio` is sufficient |
| Avatar | TugAvatar | NEW — image + fallback initials |
| Checkbox | TugCheckbox | Tier 1 form control |
| Collapsible | — | Skip — Tugcard window-shade uses its own mechanism |
| Context Menu | TugContextMenu | Phase 8e |
| Dialog | TugDialog | Phase 8e |
| Dropdown Menu | TugDropdown | Already exists (rewritten in 8a) |
| Form | — | Skip — we handle form state ourselves |
| Hover Card | — | Skip — not needed; tooltips suffice |
| Label | TugLabel | Tier 1 form control |
| Menubar | — | Skip — Mac native menu bar handles this |
| Navigation Menu | — | Skip — not applicable to our card-based UI |
| Popover | TugPopover | NEW — general-purpose anchored overlay |
| Progress | TugProgress | Tier 2 display (Radix provides accessible base) |
| Radio Group | TugRadioGroup | Tier 1 form control |
| Scroll Area | TugScrollArea | Phase 8e |
| Select | TugSelect | Tier 1 form control |
| Separator | TugSeparator | Tier 2 display |
| Slider | TugSlider | Tier 1 form control |
| Switch | TugSwitch | Tier 1 form control |
| Tabs | — | Skip — TugTabBar has its own implementation |
| Toast | TugToast | Phase 8g (via Sonner) |
| Toggle | TugToggle | NEW — two-state button |
| Toggle Group | TugToggleGroup | NEW — exclusive/multi toggle row |
| Toolbar | TugToolbar | NEW — grouped controls with arrow key nav |
| Tooltip | TugTooltip | Phase 8e |
| Visually Hidden | — | Use directly as utility, no wrapper needed |

### New Radix Packages to Install

```
@radix-ui/react-accordion
@radix-ui/react-avatar
@radix-ui/react-collapsible  (if TugAccordion needs it internally)
@radix-ui/react-label
@radix-ui/react-popover
@radix-ui/react-progress
@radix-ui/react-separator
@radix-ui/react-slider
@radix-ui/react-toggle
@radix-ui/react-toggle-group
@radix-ui/react-toolbar
```

### Tier 1 — Form Controls (9 components)

All form controls get 2.5D elevation treatment.

| Component | Wraps (Radix) | What it adds |
|-----------|--------------|-------------|
| TugInput | — (native `<input>`) | Validation states, error styling, `--tug-input-*` tokens, 2.5D inset |
| TugTextarea | — (native `<textarea>`) | Auto-resize, char count, error state, 2.5D inset |
| TugSelect | `@radix-ui/react-select` | Tugways variants, 2.5D trigger, token-based popover |
| TugCheckbox | `@radix-ui/react-checkbox` | Label integration, mixed state, 2.5D check target |
| TugRadioGroup | `@radix-ui/react-radio-group` | Group label, horizontal/vertical, 2.5D radio dots |
| TugSwitch | `@radix-ui/react-switch` | Label position, size variants, 2.5D track/thumb |
| TugSlider | `@radix-ui/react-slider` | Value display, range labels, tick marks, action phases |
| TugLabel | `@radix-ui/react-label` | Required indicator, helper text slot |
| TugToggle | `@radix-ui/react-toggle` | Two-state with 2.5D pressed/unpressed |

Note: TugInput and TugTextarea wrap native elements, not Radix primitives (Radix doesn't provide these). They still get full 2.5D treatment — inputs have an "inset" appearance (recessed into the surface, opposite of buttons).

### Tier 2 — Display & Feedback (8 components)

| Component | Kind | Notes |
|-----------|------|-------|
| TugBadge | Original | Tone variants (good/warn/alert/info), pill shape, count mode |
| TugSpinner | Original | Size variants, replaces loading prop visuals |
| TugProgress | Radix wrapper | Horizontal bar, percentage, indeterminate mode |
| TugSkeleton | Original | Shimmer placeholder, `background-attachment: fixed` sync |
| TugSeparator | Radix wrapper | Horizontal/vertical, label slot |
| TugKeyboard | Original | Keyboard shortcut chip, 2.5D keycap appearance |
| TugAvatar | Radix wrapper | Image + fallback initials, size variants |
| TugStatusIndicator | Original | Tone-colored dot + text |

### What to do

1. Install new Radix packages.
2. Build each Tier 1 component directly on its Radix primitive (or native element). Apply 2.5D visual language per the Phase 8b pattern.
3. Build each Tier 2 component. Originals are built from scratch with 2.5D where appropriate (TugKeyboard gets keycap appearance; TugBadge, TugSpinner, TugStatusIndicator are flat/informational).
4. Each component gets its own CSS file (`tug-{name}.css`) using `--tug-<component>-*` tokens.
5. All continuous controls (TugSlider, TugInput, TugTextarea) support `action`/`target` props from [D61]/[D62].
6. Add all components to the Component Gallery with interactive demos.
7. Write tests for each component.

### Result
17 components built. All form controls and core display primitives are available. Settings card can be built.

---

## Phase 8e: Navigation, Data Display & Visualization

**Goal**: Build Tier 3 (navigation/overlay), Tier 4 (data display), and Tier 5 (visualization) components.

### Tier 3 — Navigation & Overlay (5 components)

| Component | Wraps (Radix) | Notes |
|-----------|--------------|-------|
| TugTooltip | `@radix-ui/react-tooltip` | Hover labels, keyboard shortcut display |
| TugDropdown | `@radix-ui/react-dropdown-menu` | Already rewritten in 8a |
| TugScrollArea | `@radix-ui/react-scroll-area` | Themed scrollbar, autohide |
| TugContextMenu | `@radix-ui/react-context-menu` | Right-click menus for cards |
| TugPopover | `@radix-ui/react-popover` | General anchored overlay |

New Radix package: `@radix-ui/react-context-menu` (others already installed).

### Tier 4 — Data Display (4 components)

| Component | Kind | Notes |
|-----------|------|-------|
| TugTable | Original | Header/row/cell, sortable columns, stripe option |
| TugStatCard | Original | Key-value metric (label + large number + trend) |
| TugStatusIndicator | Original | (already in Tier 2) |
| TugDialog | Radix wrapper | General-purpose dialog (not alert/sheet) |

### Tier 5 — Data Visualization (3 originals)

| Component | Kind | Notes |
|-----------|------|-------|
| TugSparkline | Original | SVG inline chart: area, line, column, bar variants |
| TugLinearGauge | Original | Horizontal gauge with needle, thresholds, tick marks |
| TugArcGauge | Original | Radial gauge with needle, arc fill, center readout |

### Additional Components (from Radix inventory)

| Component | Wraps (Radix) | Notes |
|-----------|--------------|-------|
| TugAccordion | `@radix-ui/react-accordion` | Collapsible content sections, settings/inspector panels |
| TugToggleGroup | `@radix-ui/react-toggle-group` | Exclusive/multi toggle button row, 2.5D |
| TugToolbar | `@radix-ui/react-toolbar` | Grouped controls with arrow key navigation |

### What to do

1. Install remaining Radix packages (`react-context-menu`).
2. Build navigation/overlay components with 2.5D on trigger elements.
3. Build data display components.
4. Build visualization components (SVG-based, theme-token-aware).
5. Build additional Radix-based components (Accordion, ToggleGroup, Toolbar).
6. Add all to Component Gallery. Write tests.

### Result
12 additional components. Combined with 8d, the library has 29+ components.

---

## Phase 8f: Compound Components & Gallery Completion

**Goal**: Build composition components, finalize the Component Gallery as a comprehensive design system showcase.

### Compound Components (3 compositions)

| Component | Composes | Notes |
|-----------|----------|-------|
| TugButtonGroup | TugButton x N | Connected button row, shared border radius, 2.5D group elevation |
| TugChatInput | TugTextarea + TugButton x 2 | Submit + attachment, Enter to submit |
| TugSearchBar | TugInput + TugButton | Search field with action button |

### Gallery Completion

1. Organize gallery into tabbed sections by tier.
2. Each section shows all components in all variants, all states (rest/hover/focus/active/disabled), and all three themes.
3. Interactive controls for toggling variants, sizes, and states.
4. The gallery itself dogfoods TugAccordion, TugToggleGroup, TugToolbar, and other components for its own UI.

### Result
The full component library is complete. The Component Gallery is the canonical reference for the Tugways design system.

---

## Phase 8g: Alerts

**Goal**: Full alert and notification system. Wire close confirmation into the title bar built in Phase 8c.

**References**: Concept 9 ([D25], [D26]), Phase 5d1 (default button mechanism).

### What to do

1. **TugAlertHost** — mount at app root. Renders `AlertDialog` (Radix) instances driven by an imperative queue.
2. **`tugAlert()`** — imperative Promise API. Returns the button role the user clicked. Supports multiple button roles (`default`, `cancel`, `destructive`) with configurable labels.
3. **TugSheet** — card-modal dialog. Slides in from an edge, dims the card behind it. Uses Radix Dialog internally.
4. **TugConfirmPopover** — button-local confirmation anchored to the trigger element. Uses Radix Popover internally. "Are you sure?" pattern for destructive actions.
5. **TugToast** — notification toasts via Sonner integration. Tone variants (good/warn/alert/info). Auto-dismiss with configurable duration.
6. **Wire close confirmation into title bar** — the basic close button from Phase 8c now shows a `TugConfirmPopover` when the card has unsaved state or is marked as requiring confirmation. Cards opt in via a `confirmClose` flag or callback on their registration.
7. **Wire default button** — alerts and sheets use the default button mechanism from Phase 5d1. When a destructive button is present, the cancel button is the default (accent-filled, Enter activates it). When no destructive button, the default role button is the default.
8. **Add all alert/sheet/popover/toast components to the Component Gallery** with interactive demos.

### Files created
- `tugdeck/src/components/tugways/tug-alert-host.tsx`
- `tugdeck/src/components/tugways/tug-sheet.tsx`
- `tugdeck/src/components/tugways/tug-confirm-popover.tsx`
- `tugdeck/src/components/tugways/tug-toast.tsx`
- `tugdeck/styles/tug-alert.css`

### Files modified
- `tugdeck/src/components/chrome/card-header.tsx` — wire TugConfirmPopover onto close button

### Result
The alert system is complete. Close confirmation is wired into the title bar. Toasts provide non-modal feedback. The default button pattern ensures safe keyboard interaction with destructive dialogs.

---

## Phase 8h: Inspector Panels

**Goal**: Color picker, font picker, and coordinate inspector panels available as first-class tugways components. Each emits action phases (begin/change/commit/cancel), works with mutation transactions for live preview, and reads/writes via PropertyStore.

**References**: Concepts 19–21 ([D61]–[D69]), Phase 5d2–5d4 infrastructure.

### What to do

1. **TugColorPicker** (original) — hue/saturation/brightness wheel or strip, opacity slider, hex/RGB input, swatch history. Emits `setColor` action with `begin/change/commit/cancel` phases. During `change` phase, uses MutationTransaction for live preview on the target element.
2. **TugFontPicker** (original) — font family dropdown (system fonts), font size TugSlider, weight/style toggles. Emits `setFontSize`, `setFontFamily`, `setFontWeight` actions with phases.
3. **TugCoordinateInspector** (original) — x/y/width/height number fields with scrub-on-drag (drag the label to scrub the value). Emits `setPosition`, `setSize` actions with phases. Fields read from PropertyStore and update on external changes.
4. **TugInspectorPanel** (composition) — container that hosts inspector sections. Reads `PropertyStore.getSchema()` from the focused card and dynamically renders appropriate controls for each property. Registers as a responder node. Uses explicit-target dispatch ([D62]) to send edits to the focused card.
5. **Wire focus-change response** — when the focused card changes, the inspector reads the new card's PropertyStore schema and updates its displayed controls. If the focused card has no PropertyStore, the inspector shows "No inspectable properties."
6. **Add all inspector components to the Component Gallery** with interactive demos.
7. **Verify**: color picker scrub previews live with transaction, commit persists, cancel reverts. Font picker changes cascade through CSS. Coordinate inspector reflects current values and updates on external changes. Inspector works with any card that registers a PropertyStore.

### Files created
- `tugdeck/src/components/tugways/tug-color-picker.tsx`
- `tugdeck/src/components/tugways/tug-font-picker.tsx`
- `tugdeck/src/components/tugways/tug-coordinate-inspector.tsx`
- `tugdeck/src/components/tugways/tug-inspector-panel.tsx`
- `tugdeck/styles/tug-inspector.css`

### Result
Inspector panels are reusable tugways components. Any card that exposes a PropertyStore gets free inspector support. The color/font/coordinate controls are available standalone for use in card content (e.g., a settings card's theme color editor).

---

## Phase 8i: Dock

**Goal**: Rewrite the dock from scratch as the primary UI for creating and managing cards. Replaces Mac menu commands as the main interaction surface.

**References**: Concept 11 ([D28], [D29]).

### What to do

1. **Rewrite Dock from scratch** with three button types ([D28]):
   - **Card toggle** — creates a card if none exists, or focuses/cycles existing cards of that type
   - **Command** — dispatches an action into the responder chain (e.g., "Show Component Gallery")
   - **Popout menu** — opens a TugDropdown anchored to the dock button (e.g., settings, theme selector)
2. **Declarative `DockConfig`** — the dock layout is defined as a typed configuration object. Each button specifies its type, icon, label, action, and optional badge.
3. **Dock placement** ([D29]) — the dock can be positioned on any edge of the canvas (right is default). Placement is persisted.
4. **TugTooltip hover labels** — each dock button shows a tooltip with its label and keyboard shortcut (if any).
5. **2.5D dock buttons** — dock buttons get the elevation model from Phase 8b. Active state (card is visible) uses a distinct visual treatment (e.g., accent-colored indicator).
6. **Wire dock button actions through the responder chain** — dock buttons dispatch actions; the responder chain routes them. No direct DeckManager coupling.
7. **Add dock demo to Component Gallery**.

### Files created
- `tugdeck/src/components/chrome/dock.tsx` — full rewrite
- `tugdeck/src/components/chrome/dock.css` — 2.5D dock styles
- `tugdeck/src/dock-config.ts` — DockConfig type and default configuration

### Result
The dock replaces Mac menu commands as the primary UI for creating and managing cards. Chrome is complete.

---

## Supplementary Custom Components (No Radix Equivalent)

These components have no Radix primitive and are built entirely from scratch:

| Component | Description |
|-----------|-------------|
| TugBadge | Status/count badge with tone variants |
| TugLinearGauge | Horizontal gauge with needle, thresholds, ticks |
| TugArcGauge | Radial/arc gauge with needle, arc fill, center readout |
| TugSparkline | SVG inline charts (area, line, column, bar) |
| TugSpinner | Loading spinner, size variants |
| TugProgress | Progress bar (wraps Radix Progress for a11y, but visual is custom) |
| TugSkeleton | Shimmer placeholder |
| TugKeyboard | Keyboard shortcut keycap chip |
| TugStatCard | Key-value metric display |
| TugStatusIndicator | Tone-colored dot + text |
| TugTable | Data table with sorting |

All custom components follow the same 2.5D token patterns where appropriate (TugKeyboard looks like a physical keycap; gauges and sparklines are flat/informational).

---

## Phase Dependencies

```
Phase 8a: Shadcn Excision
    │
    ▼
Phase 8b: 2.5D Visual Language (TugButton reference impl)
    │
    ├──────────────────────┐
    ▼                      ▼
Phase 8c:              Phase 8d + 8e (parallel):
Card Frame &           Form Controls, Navigation,
Title Bar              Data Display, Viz
(basic close)              │
    │                      ▼
    │                  Phase 8f:
    │                  Compound Components
    │                  & Gallery Completion
    │                      │
    └──────────┬───────────┘
               ▼
           Phase 8g:
           Alerts
           (wires close confirmation into 8c title bar)
               │
               ▼
           Phase 8h:
           Inspector Panels
           (needs form controls from 8d + alerts from 8g)
               │
               ▼
           Phase 8i:
           Dock
           (needs tooltips from 8e, alerts from 8g, everything)
```

**Sequential chain**: 8a → 8b → 8c (title bar ships with basic close).

**Parallel work after 8b**: 8c (card frame) and 8d+8e (components) can proceed in parallel.

**Convergence at 8g**: Alerts need form controls (buttons, etc.) from 8d. Once alerts ship, close confirmation is wired into the title bar from 8c.

**Late phases**: 8h (inspectors) needs form controls + alerts. 8i (dock) needs the full component library, tooltips, and alert infrastructure.

---

## Relationship to Existing Strategy

This proposal **replaces** all Phase 8 content in `tugways-implementation-strategy.md`:
- Old Phase 8a (Alerts + Title Bar + Dock) is split into 8c (title bar), 8g (alerts), and 8i (dock)
- Old Phases 8b, 8c, 8d (component building) are replaced by 8d, 8e, 8f (Radix-direct approach)
- Old Phase 8e (Inspector Panels) becomes 8h

Phases that are **unaffected**:
- All Phase 5x infrastructure — responder chain, mutation model, observable properties, palette engine, etc.
- Phase 9 (Card Rebuild) — depends on component library existing, agnostic to implementation layer

After this proposal is approved, `design-system-concepts.md` and `tugways-implementation-strategy.md` will be updated to reflect the Radix-direct approach, the 2.5D visual language, and the revised phase numbering.

---

## Total Component Count

| Category | Count |
|----------|-------|
| Radix wrappers | 17 |
| Original (no Radix) | 11 |
| Compositions | 3 |
| **Total** | **31** |

This is a superset of the previous 28-component plan, adding TugAccordion, TugToggleGroup, TugToolbar, TugPopover, and TugSearchBar.
