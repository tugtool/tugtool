# Tugways Component Library Roadmap

*Complete inventory of existing components, planned builds, and implementation order.*

---

## Completed Components

Components that exist today, audited to compliance with `tuglaws/component-authoring.md` in the Phase 2 quality audit.

### Public Components

| Component | Kind | Description | Gallery Card |
|-----------|------|-------------|:------------:|
| tug-push-button | Compositional | Primary push button (composes internal TugButton) | ✅ |
| tug-popup-button | Compositional | macOS-style popup button (composes TugPopupMenu + TugButton) | ✅ |
| tug-checkbox | Wrapper (Radix) | Checkbox with label, mixed state, roles | ✅ |
| tug-switch | Wrapper (Radix) | Toggle switch with label | ✅ |
| tug-input | Wrapper (native) | Text input with validation, focus ring | ✅ |
| tug-label | Wrapper (Radix) | Text label with ellipsis, max-lines | ✅ |
| tug-badge | Original | Tone variants, tinted/pill, count mode | ✅ |
| tug-skeleton | Original | Shimmer placeholder with pulse animation | ✅ |
| tug-marquee | Original | Scrolling overflow text | ✅ |
| tug-card | Structural | Multi-tab card with title bar, accessory slot, effects | ✅ |
| tug-tab-bar | Structural | Tab strip with overflow, drag, type picker | ✅ |

### Internal Components

| Component | Kind | Description | Composed By |
|-----------|------|-------------|-------------|
| tug-button | Wrapper (Radix) | Core button with emphasis/role/size matrix | TugPushButton, TugPopupButton, TugTabBar |
| tug-popup-menu | Wrapper (Radix) | Headless dropdown menu with blink animation | TugPopupButton, TugTabBar |

### Theme Internals (Not Audited)

| Component | Description |
|-----------|-------------|
| tug-hue-strip | Theme generator hue picker |
| tug-color-strip | Theme generator color strip |

---

## Planned Components — Form Controls

Controls that handle user input. Each wraps a Radix primitive or native element.

| # | Component | Kind | Wraps | Key Features | Priority |
|---|-----------|------|-------|--------------|----------|
| 1 | tug-select | Wrapper | `@radix-ui/react-select` | Trigger + popover, token-styled | High |
| 2 | tug-slider | Wrapper | `@radix-ui/react-slider` | Track/thumb, value display, range labels | High |
| 3 | tug-radio-group | Wrapper | `@radix-ui/react-radio-group` | Group label, horizontal/vertical layout | High |
| 4 | tug-textarea | Wrapper (native) | `<textarea>` | Auto-resize, char count, field tokens | High |
| 5 | tug-toggle | Wrapper | `@radix-ui/react-toggle` | Pressed/unpressed control states | Medium |
| 6 | tug-toggle-group | Wrapper | `@radix-ui/react-toggle-group` | Exclusive/multi toggle row | Medium |

## Planned Components — Display & Feedback

Components that present information or feedback. No user input.

| # | Component | Kind | Key Features | Priority |
|---|-----------|------|--------------|----------|
| 7 | tug-separator | Wrapper (Radix) | Horizontal/vertical, optional label slot | High |
| 8 | tug-spinner | Original | Size variants, replaces ad-hoc loading visuals | High |
| 9 | tug-progress | Wrapper (Radix) | Bar, percentage, indeterminate mode | Medium |
| 10 | tug-keyboard | Original | Keycap chip for shortcut display | Medium |
| 11 | tug-avatar | Wrapper (Radix) | Image + fallback initials, size variants | Medium |
| 12 | tug-status-indicator | Original | Tone-colored dot + text label | Medium |

## Planned Components — Navigation & Overlay

Components that manage layered UI, menus, and scrolling.

| # | Component | Kind | Wraps | Key Features | Priority |
|---|-----------|------|-------|--------------|----------|
| 13 | tug-tooltip | Wrapper | `@radix-ui/react-tooltip` | Hover labels, keyboard shortcut display | High |
| 14 | tug-scroll-area | Wrapper | `@radix-ui/react-scroll-area` | Themed scrollbar, autohide | High |
| 15 | tug-context-menu | Wrapper | `@radix-ui/react-context-menu` | Right-click menus for cards | Medium |
| 16 | tug-popover | Wrapper | `@radix-ui/react-popover` | General anchored overlay | Medium |

## Planned Components — Alerts & Modals

Four-category modal system modeled on AppKit (NSAlert, beginSheet, NSPopover, Notification Center).

| # | Component | Kind | Scope | Key Features | Priority |
|---|-----------|------|-------|--------------|----------|
| 17 | tug-alert | Wrapper (Radix AlertDialog) | App-modal | Promise-based API, button roles, alert styles | High |
| 18 | tug-sheet | Wrapper (Radix Dialog) | Card-modal | Scoped to single card, responder suspension | High |
| 19 | tug-confirm-popover | Wrapper (Radix Popover) | Button-local | Destructive action confirmation | High |
| 20 | tug-toast | Integration (Sonner) | Non-blocking | Fire-and-forget, tone variants, auto-dismiss | Medium |

## Planned Components — Data Display

Components for structured data presentation.

| # | Component | Kind | Key Features | Priority |
|---|-----------|------|--------------|----------|
| 21 | tug-table | Original | Header/row/cell, sortable, stripe option | Medium |
| 22 | tug-stat-card | Original | Key-value metric (label + number + trend) | Low |
| 23 | tug-dialog | Wrapper (Radix) | General-purpose dialog (not alert/sheet) | Medium |
| 24 | tug-accordion | Wrapper (Radix) | Collapsible content sections | Low |

## Planned Components — Data Visualization

Custom SVG/Canvas components for charts and gauges.

| # | Component | Kind | Key Features | Priority |
|---|-----------|------|--------------|----------|
| 25 | tug-sparkline | Original | SVG inline chart: area, line, column, bar | Low |
| 26 | tug-linear-gauge | Original | Horizontal gauge with needle, thresholds | Low |
| 27 | tug-arc-gauge | Original | Radial gauge with arc fill, center readout | Low |

## Planned Components — Compositions

Higher-level components assembled from multiple primitives.

| # | Component | Kind | Composes | Key Features | Priority |
|---|-----------|------|----------|--------------|----------|
| 28 | tug-button-group | Composition | TugButton x N | Connected row, shared border radius | Medium |
| 29 | tug-chat-input | Composition | TugTextarea + TugButton x 2 | Submit + attachment, Enter to submit | High |
| 30 | tug-search-bar | Composition | TugInput + TugButton | Search field with action button | Medium |
| 31 | tug-toolbar | Wrapper (Radix) | Grouped controls with arrow key nav | Low |

## New Component Ideas

*Components not in the original Phase 8 plan. To be discussed and prioritized.*

| Component | Kind | Description | Notes |
|-----------|------|-------------|-------|
| | | | |

---

## Implementation Groups

*Ordered by dependency and downstream need. Each group is built one component at a time, interactively tuned in the Component Gallery.*

### Group A: Remaining Form Controls
**Why first:** Settings card and card content need these. Select, slider, radio, textarea are the most-requested missing controls.

Components: tug-select, tug-slider, tug-radio-group, tug-textarea, tug-toggle, tug-toggle-group

### Group B: Display Essentials
**Why second:** Used everywhere — separators in layouts, spinners for loading states, tooltips for discoverability.

Components: tug-separator, tug-spinner, tug-tooltip, tug-scroll-area

### Group C: Alert System
**Why third:** Card close confirmation, destructive action guards, and notifications depend on this.

Components: tug-alert, tug-sheet, tug-confirm-popover, tug-toast

### Group D: Compositions & Navigation
**Why fourth:** Chat input needs textarea (Group A). Search bar needs input (done). Context menus need menu infrastructure (done).

Components: tug-chat-input, tug-search-bar, tug-button-group, tug-context-menu, tug-popover

### Group E: Data Display & Feedback
**Why fifth:** Table, progress, avatars needed for card content.

Components: tug-table, tug-progress, tug-dialog, tug-accordion, tug-keyboard, tug-avatar, tug-status-indicator, tug-stat-card

### Group F: Data Visualization
**Why last:** Specialized components for analytics cards. No downstream dependencies.

Components: tug-sparkline, tug-linear-gauge, tug-arc-gauge, tug-toolbar

---

## Archived Documents

The following documents are superseded by this roadmap:

- `.tugtool/tugplan-tugways-phase-8-radix-redesign.md` — Original Phase 8 plan. Component inventory and design decisions are incorporated here. Infrastructure decisions (D01-D07) remain valid as historical reference.
- `roadmap/step-4-interactive-build-guide.md` — Original Step 4 build guide. Build-order and token patterns are incorporated here.
- `roadmap/archive/tugways-implementation-strategy.md` — Original implementation strategy. Already archived.
