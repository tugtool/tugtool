# Tugways Component Library Roadmap

*Complete inventory of existing components, planned builds, and implementation order.*

## Archived Documents

The following documents are superseded by this roadmap:

- `.tugtool/tugplan-tugways-phase-8-radix-redesign.md` — Original Phase 8 plan. Component inventory and design decisions are incorporated here. Infrastructure decisions (D01-D07) remain valid as historical reference.
- `roadmap/step-4-interactive-build-guide.md` — Original Step 4 build guide. Build-order and token patterns are incorporated here.
- `roadmap/archive/tugways-implementation-strategy.md` — Original implementation strategy. Already archived.

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
| tug-value-input | Original | Compact editable value display with imperative DOM management [L06]. Formatted display, select-all on focus, type-to-replace, arrow key increment, validate on commit. | ✅ |

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
| 1 | tug-slider | Wrapper | `@radix-ui/react-slider` | Track/thumb, value display, range labels | High |
| 2 | tug-radio-group | Wrapper | `@radix-ui/react-radio-group` | Group label, horizontal/vertical layout | High |
| 3 | tug-textarea | Wrapper (native) | `<textarea>` | Auto-resize, char count, field tokens | High |

**Removed:** tug-select (covered by tug-popup-button), tug-toggle (covered by tug-checkbox/tug-switch), tug-toggle-group (row of toggles — unnecessary given existing controls).

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
| 14 | tug-context-menu | Wrapper | `@radix-ui/react-context-menu` | Right-click menus for cards | Medium |
| 15 | tug-popover | Wrapper | `@radix-ui/react-popover` | General anchored overlay | Medium |

**Removed:** tug-scroll-area (native browser scrollbars are sufficient; Windows polish is not a priority).

## Planned Components — Alerts & Modals

Four-category modal system modeled on AppKit (NSAlert, beginSheet, NSPopover, Notification Center).

| # | Component | Kind | Scope | Key Features | Priority |
|---|-----------|------|-------|--------------|----------|
| 17 | tug-alert | Wrapper (Radix AlertDialog) | App-modal | Promise-based API, button roles, alert styles | High |
| 18 | tug-sheet | Wrapper (Radix Dialog) | Card-modal | Scoped to single card, responder suspension | High |
| 19 | tug-confirm-popover | Wrapper (Radix Popover) | Button-local | Destructive action confirmation | High |
| 20 | tug-bulletin | Original (may wrap Sonner) | Non-blocking | Fire-and-forget, tone variants, auto-dismiss | Medium |

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
| 30 | tug-search-bar | Composition | TugInput + TugButton | Search field with action button | Medium |
| 31 | tug-toolbar | Wrapper (Radix) | Grouped controls with arrow key nav | Low |

## New Component Ideas

*Components not in the original Phase 8 plan.*

| # | Component | Kind | Description | Priority |
|---|-----------|------|-------------|----------|
| 32 | tug-segmented-choice | Original | Mutually exclusive segment picker modeled on Apple's UISegmentedControl. Horizontal row of connected segments with sliding selection indicator. Unified visual frame with active segment highlight that slides between options. | High |
| 33 | tug-box | Original | Container providing visual grouping (optional border, optional label) and functional grouping (enable/disable all contained controls with one prop). Nestable — disabled outer box cascades to all inner boxes and controls. Modeled on HTML `<fieldset>` semantics with recursive disable propagation via React context. | High |
| 34 | tug-rich-text | Wrapper (Monaco) | Monaco editor in a tugways component. Token-driven theming, standard props interface, integration with card content system. | High |
| 35 | tug-bulletin | Original (may wrap Sonner) | Non-blocking notification system. Fire-and-forget alerts with tone variants, auto-dismiss, configurable duration. Our name for what others call "toast." | Medium |
| 36 | tug-markdown | Original | High-performance markdown/MDX renderer for LLM and agent responses. Three layers: (1) standard CommonMark/GFM rendering with token-driven typography, (2) full MDX support for embedded React components, (3) "MDX+" custom parsing extensions for tugways-specific formatting (agent output, code diffs, plan steps, tool results, etc.). Must handle streaming content (incremental rendering as tokens arrive), large documents without jank, and syntax-highlighted code blocks via tug-rich-text integration. The primary display surface for all AI-generated content in the app. | High |
| 37 | tug-prompt-input | Original | Rich input field for composing prompts and conversational text. History navigation, typeahead/suggestions, completions, multi-line expansion. Distinct from tug-input (basic field) and tug-textarea (plain multi-line) — prompt-input is the full interactive authoring field. | High |
| 38 | tug-prompt-entry | Composition | Integrated prompt composition surface. Composes tug-prompt-input + submit button + progress indicator + utility buttons. The complete "enter a prompt" experience. Pairs with tug-markdown on the output side: prompt-entry is where text goes in, markdown is where responses come out. | High |

---

## Implementation Groups

*Ordered by dependency and downstream need. Each group is built one component at a time, interactively tuned in the Component Gallery.*

### Group A: Remaining Form Controls

Settings card and card content need these. Slider, radio, textarea are the most-requested missing controls. Segmented choice and box provide selection and grouping patterns needed across all card UIs.

- tug-slider
- tug-radio-group
- tug-segmented-choice
- tug-box
- tug-textarea

### Group B: Display Essentials

Used everywhere — separators in layouts, spinners for loading states, tooltips for discoverability.

- tug-separator
- tug-spinner
- tug-tooltip
- tug-accordion

### Group C: Alert System

Card close confirmation, destructive action guards, and notifications depend on this.

- tug-alert
- tug-sheet
- tug-confirm-popover
- tug-bulletin

### Group D: Rich Content & Compositions

Markdown renderer and rich text editor are core to card content — tug-markdown is the primary display surface for all AI-generated content. Chat input needs textarea (Group A). Context menus need menu infrastructure (done).

- tug-markdown
- tug-rich-text
- tug-prompt-input
- tug-prompt-entry
- tug-search-bar
- tug-button-group
- tug-context-menu
- tug-popover

### Group E: Data Display & Feedback

Table, progress, avatars needed for card content.

- tug-table
- tug-progress
- tug-dialog
- tug-keyboard
- tug-avatar
- tug-status-indicator
- tug-stat-card

### Group F: Data Visualization

Specialized components for analytics cards. No downstream dependencies.

- tug-sparkline
- tug-linear-gauge
- tug-arc-gauge
- tug-toolbar

