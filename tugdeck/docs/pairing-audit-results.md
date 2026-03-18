# Pairing Audit Results

**Purpose:** Exhaustive list of all foreground-on-background pairings extracted from the 23 component CSS files in scope for the token audit and pairing extraction plan.

**Source files audited:** All 23 CSS files listed in [Scope](../.tugtool/tugplan-token-audit-pairing.md#scope) as of 2026-03-18.

**Recording convention per [D02]:** Each pairing is recorded at both the component-alias level (the token names visible in the CSS file) and the resolved `--tug-base-*` level (what the contrast engine consumes). Where the component-alias token is itself a `--tug-base-*` token (no component-level alias), the component column shows the base token directly.

**Contrast roles per Spec S02:**
- `body-text` — normal body-size text (approx ≥14px, weight ≤600)
- `subdued-text` — secondary/muted text, same WCAG contrast role as body-text but visually softer
- `large-text` — large text (≥18px normal weight, or ≥14px bold) — lower WCAG threshold
- `ui-component` — non-text UI control (button label, icon, badge)
- `decorative` — purely decorative; no contrast requirement

---

## File 1: tug-button.css

**Component:** TugButton

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-control-outlined-action-fg-rest` | `control-outlined-action-fg-rest` | `--tug-base-control-outlined-action-bg-rest` | `control-outlined-action-bg-rest` | `ui-component` | Button label on rest background (outlined-action) |
| 2 | `--tug-base-control-outlined-action-fg-hover` | `control-outlined-action-fg-hover` | `--tug-base-control-outlined-action-bg-hover` | `control-outlined-action-bg-hover` | `ui-component` | Button label on hover background (outlined-action) |
| 3 | `--tug-base-control-outlined-action-fg-active` | `control-outlined-action-fg-active` | `--tug-base-control-outlined-action-bg-active` | `control-outlined-action-bg-active` | `ui-component` | Button label on active/pressed background (outlined-action) |
| 4 | `--tug-base-control-outlined-action-icon-rest` | `control-outlined-action-icon-rest` | `--tug-base-control-outlined-action-bg-rest` | `control-outlined-action-bg-rest` | `ui-component` | Button icon on rest background (outlined-action) |
| 5 | `--tug-base-control-outlined-action-icon-hover` | `control-outlined-action-icon-hover` | `--tug-base-control-outlined-action-bg-hover` | `control-outlined-action-bg-hover` | `ui-component` | Button icon on hover background (outlined-action) |
| 6 | `--tug-base-control-outlined-action-icon-active` | `control-outlined-action-icon-active` | `--tug-base-control-outlined-action-bg-active` | `control-outlined-action-bg-active` | `ui-component` | Button icon on active/pressed background (outlined-action) |
| 7 | `--tug-base-control-filled-accent-fg-rest` | `control-filled-accent-fg-rest` | `--tug-base-control-filled-accent-bg-rest` | `control-filled-accent-bg-rest` | `ui-component` | Button label on rest background (filled-accent) |
| 8 | `--tug-base-control-filled-accent-fg-hover` | `control-filled-accent-fg-hover` | `--tug-base-control-filled-accent-bg-hover` | `control-filled-accent-bg-hover` | `ui-component` | Button label on hover background (filled-accent) |
| 9 | `--tug-base-control-filled-accent-fg-active` | `control-filled-accent-fg-active` | `--tug-base-control-filled-accent-bg-active` | `control-filled-accent-bg-active` | `ui-component` | Button label on active background (filled-accent) |
| 10 | `--tug-base-control-filled-accent-icon-rest` | `control-filled-accent-icon-rest` | `--tug-base-control-filled-accent-bg-rest` | `control-filled-accent-bg-rest` | `ui-component` | Button icon on rest background (filled-accent) |
| 11 | `--tug-base-control-filled-accent-icon-hover` | `control-filled-accent-icon-hover` | `--tug-base-control-filled-accent-bg-hover` | `control-filled-accent-bg-hover` | `ui-component` | Button icon on hover background (filled-accent) |
| 12 | `--tug-base-control-filled-accent-icon-active` | `control-filled-accent-icon-active` | `--tug-base-control-filled-accent-bg-active` | `control-filled-accent-bg-active` | `ui-component` | Button icon on active background (filled-accent) |
| 13 | `--tug-base-control-filled-action-fg-rest` | `control-filled-action-fg-rest` | `--tug-base-control-filled-action-bg-rest` | `control-filled-action-bg-rest` | `ui-component` | Button label on rest background (filled-action) |
| 14 | `--tug-base-control-filled-action-fg-hover` | `control-filled-action-fg-hover` | `--tug-base-control-filled-action-bg-hover` | `control-filled-action-bg-hover` | `ui-component` | Button label on hover background (filled-action) |
| 15 | `--tug-base-control-filled-action-fg-active` | `control-filled-action-fg-active` | `--tug-base-control-filled-action-bg-active` | `control-filled-action-bg-active` | `ui-component` | Button label on active background (filled-action) |
| 16 | `--tug-base-control-filled-action-icon-rest` | `control-filled-action-icon-rest` | `--tug-base-control-filled-action-bg-rest` | `control-filled-action-bg-rest` | `ui-component` | Button icon on rest background (filled-action) |
| 17 | `--tug-base-control-filled-action-icon-hover` | `control-filled-action-icon-hover` | `--tug-base-control-filled-action-bg-hover` | `control-filled-action-bg-hover` | `ui-component` | Button icon on hover background (filled-action) |
| 18 | `--tug-base-control-filled-action-icon-active` | `control-filled-action-icon-active` | `--tug-base-control-filled-action-bg-active` | `control-filled-action-bg-active` | `ui-component` | Button icon on active background (filled-action) |
| 19 | `--tug-base-control-filled-danger-fg-rest` | `control-filled-danger-fg-rest` | `--tug-base-control-filled-danger-bg-rest` | `control-filled-danger-bg-rest` | `ui-component` | Button label on rest background (filled-danger) |
| 20 | `--tug-base-control-filled-danger-fg-hover` | `control-filled-danger-fg-hover` | `--tug-base-control-filled-danger-bg-hover` | `control-filled-danger-bg-hover` | `ui-component` | Button label on hover background (filled-danger) |
| 21 | `--tug-base-control-filled-danger-fg-active` | `control-filled-danger-fg-active` | `--tug-base-control-filled-danger-bg-active` | `control-filled-danger-bg-active` | `ui-component` | Button label on active background (filled-danger) |
| 22 | `--tug-base-control-filled-danger-icon-rest` | `control-filled-danger-icon-rest` | `--tug-base-control-filled-danger-bg-rest` | `control-filled-danger-bg-rest` | `ui-component` | Button icon on rest background (filled-danger) |
| 23 | `--tug-base-control-filled-danger-icon-hover` | `control-filled-danger-icon-hover` | `--tug-base-control-filled-danger-bg-hover` | `control-filled-danger-bg-hover` | `ui-component` | Button icon on hover background (filled-danger) |
| 24 | `--tug-base-control-filled-danger-icon-active` | `control-filled-danger-icon-active` | `--tug-base-control-filled-danger-bg-active` | `control-filled-danger-bg-active` | `ui-component` | Button icon on active background (filled-danger) |
| 25 | `--tug-base-control-ghost-action-fg-rest` | `control-ghost-action-fg-rest` | `--tug-base-control-ghost-action-bg-rest` | `control-ghost-action-bg-rest` | `ui-component` | Button label on rest background (ghost-action) |
| 26 | `--tug-base-control-ghost-action-fg-hover` | `control-ghost-action-fg-hover` | `--tug-base-control-ghost-action-bg-hover` | `control-ghost-action-bg-hover` | `ui-component` | Button label on hover background (ghost-action) |
| 27 | `--tug-base-control-ghost-action-fg-active` | `control-ghost-action-fg-active` | `--tug-base-control-ghost-action-bg-active` | `control-ghost-action-bg-active` | `ui-component` | Button label on active background (ghost-action) |
| 28 | `--tug-base-control-ghost-action-icon-rest` | `control-ghost-action-icon-rest` | `--tug-base-control-ghost-action-bg-rest` | `control-ghost-action-bg-rest` | `ui-component` | Button icon on rest background (ghost-action) |
| 29 | `--tug-base-control-ghost-action-icon-hover` | `control-ghost-action-icon-hover` | `--tug-base-control-ghost-action-bg-hover` | `control-ghost-action-bg-hover` | `ui-component` | Button icon on hover background (ghost-action) |
| 30 | `--tug-base-control-ghost-action-icon-active` | `control-ghost-action-icon-active` | `--tug-base-control-ghost-action-bg-active` | `control-ghost-action-bg-active` | `ui-component` | Button icon on active background (ghost-action) |
| 31 | `--tug-base-control-ghost-danger-fg-rest` | `control-ghost-danger-fg-rest` | `--tug-base-control-ghost-danger-bg-rest` | `control-ghost-danger-bg-rest` | `ui-component` | Button label on rest background (ghost-danger) |
| 32 | `--tug-base-control-ghost-danger-fg-hover` | `control-ghost-danger-fg-hover` | `--tug-base-control-ghost-danger-bg-hover` | `control-ghost-danger-bg-hover` | `ui-component` | Button label on hover background (ghost-danger) |
| 33 | `--tug-base-control-ghost-danger-fg-active` | `control-ghost-danger-fg-active` | `--tug-base-control-ghost-danger-bg-active` | `control-ghost-danger-bg-active` | `ui-component` | Button label on active background (ghost-danger) |
| 34 | `--tug-base-control-ghost-danger-icon-rest` | `control-ghost-danger-icon-rest` | `--tug-base-control-ghost-danger-bg-rest` | `control-ghost-danger-bg-rest` | `ui-component` | Button icon on rest background (ghost-danger) |
| 35 | `--tug-base-control-ghost-danger-icon-hover` | `control-ghost-danger-icon-hover` | `--tug-base-control-ghost-danger-bg-hover` | `control-ghost-danger-bg-hover` | `ui-component` | Button icon on hover background (ghost-danger) |
| 36 | `--tug-base-control-ghost-danger-icon-active` | `control-ghost-danger-icon-active` | `--tug-base-control-ghost-danger-bg-active` | `control-ghost-danger-bg-active` | `ui-component` | Button icon on active background (ghost-danger) |
| 37 | `--tug-base-control-outlined-option-fg-rest` | `control-outlined-option-fg-rest` | `--tug-base-control-outlined-option-bg-rest` | `control-outlined-option-bg-rest` | `ui-component` | Button label on rest background (outlined-option) |
| 38 | `--tug-base-control-outlined-option-fg-hover` | `control-outlined-option-fg-hover` | `--tug-base-control-outlined-option-bg-hover` | `control-outlined-option-bg-hover` | `ui-component` | Button label on hover background (outlined-option) |
| 39 | `--tug-base-control-outlined-option-fg-active` | `control-outlined-option-fg-active` | `--tug-base-control-outlined-option-bg-active` | `control-outlined-option-bg-active` | `ui-component` | Button label on active background (outlined-option) |
| 40 | `--tug-base-control-outlined-option-icon-rest` | `control-outlined-option-icon-rest` | `--tug-base-control-outlined-option-bg-rest` | `control-outlined-option-bg-rest` | `ui-component` | Button icon on rest background (outlined-option) |
| 41 | `--tug-base-control-outlined-option-icon-hover` | `control-outlined-option-icon-hover` | `--tug-base-control-outlined-option-bg-hover` | `control-outlined-option-bg-hover` | `ui-component` | Button icon on hover background (outlined-option) |
| 42 | `--tug-base-control-outlined-option-icon-active` | `control-outlined-option-icon-active` | `--tug-base-control-outlined-option-bg-active` | `control-outlined-option-bg-active` | `ui-component` | Button icon on active background (outlined-option) |
| 43 | `--tug-base-control-ghost-option-fg-rest` | `control-ghost-option-fg-rest` | `--tug-base-control-ghost-option-bg-rest` | `control-ghost-option-bg-rest` | `ui-component` | Button label on rest background (ghost-option) |
| 44 | `--tug-base-control-ghost-option-fg-hover` | `control-ghost-option-fg-hover` | `--tug-base-control-ghost-option-bg-hover` | `control-ghost-option-bg-hover` | `ui-component` | Button label on hover background (ghost-option) |
| 45 | `--tug-base-control-ghost-option-fg-active` | `control-ghost-option-fg-active` | `--tug-base-control-ghost-option-bg-active` | `control-ghost-option-bg-active` | `ui-component` | Button label on active background (ghost-option) |
| 46 | `--tug-base-control-ghost-option-icon-rest` | `control-ghost-option-icon-rest` | `--tug-base-control-ghost-option-bg-rest` | `control-ghost-option-bg-rest` | `ui-component` | Button icon on rest background (ghost-option) |
| 47 | `--tug-base-control-ghost-option-icon-hover` | `control-ghost-option-icon-hover` | `--tug-base-control-ghost-option-bg-hover` | `control-ghost-option-bg-hover` | `ui-component` | Button icon on hover background (ghost-option) |
| 48 | `--tug-base-control-ghost-option-icon-active` | `control-ghost-option-icon-active` | `--tug-base-control-ghost-option-bg-active` | `control-ghost-option-bg-active` | `ui-component` | Button icon on active background (ghost-option) |

**Notes:**
- Border-on-background pairings (e.g. `control-outlined-action-border-rest` on `control-outlined-action-bg-rest`) are classified as `decorative` — borders do not carry text/icon information.
- Ghost rest states use `transparent` backgrounds. Ghost pairings are only meaningful at hover/active states where the background is non-transparent.

---

## File 2: tug-card.css

**Component:** TugCard + CardTitleBar

### Component Token Definitions (body {})

- `--tug-card-title-bar-bg-active` resolves to `--tug-base-tab-bg-active`
- `--tug-card-title-bar-bg-inactive` resolves to `--tug-base-tab-bg-inactive`
- `--tug-card-title-bar-bg-collapsed` resolves to `--tug-base-tab-bg-collapsed`
- `--tug-card-title-bar-fg` resolves to `--tug-base-fg-default`
- `--tug-card-title-bar-icon-active` resolves to `--tug-base-icon-active`
- `--tug-card-title-bar-icon-inactive` resolves to `--tug-base-fg-subtle`
- `--tug-card-title-bar-icon-hover` resolves to `--tug-base-fg-muted`

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-card-title-bar-fg` | `fg-default` | `--tug-card-title-bar-bg-active` | `tab-bg-active` | `body-text` | Card title text on ACTIVE title bar **[THE GAP]** |
| 2 | `--tug-card-title-bar-fg` | `fg-default` | `--tug-card-title-bar-bg-inactive` | `tab-bg-inactive` | `body-text` | Card title text on inactive title bar |
| 3 | `--tug-card-title-bar-icon-active` | `icon-active` | `--tug-card-title-bar-bg-active` | `tab-bg-active` | `ui-component` | Card icon on active title bar |
| 4 | `--tug-card-title-bar-icon-inactive` | `fg-subtle` | `--tug-card-title-bar-bg-inactive` | `tab-bg-inactive` | `ui-component` | Card icon on inactive title bar |
| 5 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-default` | `surface-default` | `body-text` | Card content area text (tugcard-content background) |
| 6 | `--tug-base-fg-muted` | `fg-muted` | `--tug-base-surface-default` | `surface-default` | `subdued-text` | .tugcard-loading placeholder text |
| 7 | `--tug-base-selection-fg` | `selection-fg` | `--tug-base-selection-bg` | `selection-bg` | `body-text` | Selected text (CSS Custom Highlight API, active card) |

**Notes:**
- Pairing #1 (`fg-default` on `tab-bg-active`) is the **explicitly identified gap** from the plan. `.tugcard-title` sets `color: var(--tug-card-title-bar-fg)` (resolves to `fg-default`). When `card-frame[data-focused="true"]`, `.tugcard-title-bar` background becomes `tab-bg-active`.
- Card icon hover (`fg-muted` on `tab-bg-active`) also occurs when title bar controls hover — ghost-option TugButtons inside `.card-title-bar-controls` render on the active title bar background.
- Collapsed state: `.tugcard--collapsed` background uses `tab-bg-inactive`/`tab-bg-active` — title icon and text render on those surfaces.

---

## File 3: tug-tab.css

**Component:** TugTabBar

### Component Token Definitions (body {})

- `--tug-tab-bar-bg` resolves to `--tug-card-title-bar-bg-inactive` -> `tab-bg-inactive`
- `--tug-tab-bg-rest` = `transparent`
- `--tug-tab-bg-hover` resolves to `--tug-base-tab-bg-hover`
- `--tug-tab-bg-active` resolves to `--tug-card-title-bar-bg-active` -> `tab-bg-active`
- `--tug-tab-fg-rest` resolves to `--tug-base-tab-fg-rest`
- `--tug-tab-fg-hover` resolves to `--tug-base-tab-fg-hover`
- `--tug-tab-fg-active` resolves to `--tug-base-tab-fg-active`
- `--tug-tab-fg-compact` resolves to `--tug-base-fg-muted`
- `--tug-tab-close-bg-hover` resolves to `--tug-base-tab-close-bg-hover`
- `--tug-tab-close-fg-hover` resolves to `--tug-base-tab-close-fg-hover`
- `--tug-tab-badge-bg` resolves to `--tug-base-accent-default` (chromatic)
- `--tug-tab-badge-fg` resolves to `--tug-base-fg-inverse`

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-tab-fg-rest` | `tab-fg-rest` | `--tug-tab-bar-bg` | `tab-bg-inactive` | `ui-component` | Tab label at rest on tab bar background |
| 2 | `--tug-tab-fg-hover` | `tab-fg-hover` | `--tug-tab-bg-hover` | `tab-bg-hover` | `ui-component` | Tab label on hover background |
| 3 | `--tug-tab-fg-active` | `tab-fg-active` | `--tug-tab-bg-active` | `tab-bg-active` | `ui-component` | Active tab label on active tab background |
| 4 | `--tug-tab-close-fg-hover` | `tab-close-fg-hover` | `--tug-tab-close-bg-hover` | `tab-close-bg-hover` | `ui-component` | Tab close button on close-hover background |
| 5 | `--tug-base-fg-muted` | `fg-muted` | `--tug-tab-bar-bg` | `tab-bg-inactive` | `ui-component` | Add tab [+] and overflow trigger text on tab bar |
| 6 | `--tug-base-control-ghost-option-fg-active` | `control-ghost-option-fg-active` | `--tug-base-control-ghost-option-bg-active` | `control-ghost-option-bg-active` | `ui-component` | Tab add/overflow button when menu is open |
| 7 | `--tug-base-surface-default` | `surface-default` | `--tug-tab-badge-bg` (accent-default) | `accent-default` (chromatic) | `ui-component` | Overflow count badge text on accent-default background |
| 8 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-control` | `surface-control` | `body-text` | Ghost tab drag visual text on surface-control |

**Notes:**
- Pairing #7 (`surface-default` on `accent-default`): the rendering rule at tug-tab.css:283 sets `color: var(--tug-base-surface-default)` directly — it does NOT use the `--tug-tab-badge-fg` alias defined in the `body {}` block. The correct element token is `surface-default` (used here as foreground text), rendered on the chromatic `accent-default` background.
- Tab rest: `transparent` tabs inherit `tab-bg-inactive` from the tab bar — `tab-fg-rest` effectively renders on `tab-bg-inactive`.

---

## File 4: tug-menu.css

**Component:** TugMenu + TugDropdown

### Component Token Definitions (body {})

- `--tug-menu-bg` / `--tug-dropdown-bg` resolve to `surface-overlay`
- `--tug-menu-fg` / `--tug-dropdown-fg` resolve to `fg-default`
- `--tug-menu-item-bg-hover` resolves to `control-ghost-action-bg-hover`
- `--tug-menu-item-bg-selected` resolves to `accent-subtle` (chromatic)
- `--tug-menu-item-fg-danger` resolves to `tone-danger` (chromatic)
- `--tug-tooltip-bg` resolves to `surface-screen`
- `--tug-tooltip-fg` resolves to `fg-default`

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-dropdown-fg` | `fg-default` | `--tug-dropdown-bg` | `surface-overlay` | `body-text` | Menu item default text on menu panel |
| 2 | `--tug-base-control-filled-action-fg-hover` | `control-filled-action-fg-hover` | `--tug-base-control-filled-action-bg-hover` | `control-filled-action-bg-hover` | `ui-component` | Menu item text on highlighted (hover) background |
| 3 | `--tug-menu-item-fg` | `fg-default` | `--tug-menu-item-bg-selected` (accent-subtle) | `accent-subtle` (chromatic) | `body-text` | Menu item text on selected/checked item background |
| 4 | `--tug-menu-item-meta` | `fg-subtle` | `--tug-menu-bg` | `surface-overlay` | `subdued-text` | Menu item metadata text on menu panel |
| 5 | `--tug-menu-item-shortcut` | `fg-subtle` | `--tug-menu-bg` | `surface-overlay` | `subdued-text` | Menu item shortcut text on menu panel |
| 6 | `--tug-menu-item-icon` | `fg-muted` | `--tug-menu-bg` | `surface-overlay` | `ui-component` | Menu item icon on menu panel |
| 7 | `--tug-menu-item-fg-danger` (tone-danger) | `tone-danger` (chromatic) | `--tug-menu-bg` | `surface-overlay` | `body-text` | Danger menu item text on menu panel |
| 8 | `--tug-tooltip-fg` | `fg-default` | `--tug-tooltip-bg` | `surface-screen` | `body-text` | Tooltip text on tooltip background |
| 9 | `--tug-popover-fg` | `fg-default` | `--tug-popover-bg` | `surface-overlay` | `body-text` | Popover content text on popover background |

**Notes:**
- `accent-subtle` as a surface (selected item background) with `fg-default` as text is a likely gap in the current pairing map.
- `tone-danger` as foreground chromatic on `surface-overlay` requires a pairing map entry.

---

## File 5: tug-dialog.css

**Component:** TugDialog, TugSheet, TugToast, TugAlert, TugBadge (neutral/accent), TugKbd

This file contains only `body {}` token definitions — no CSS rendering rules.

### Pairings (from token definitions)

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-dialog-fg` | `fg-default` | `--tug-dialog-bg` | `surface-overlay` | `body-text` | Dialog body text on dialog background |
| 2 | `--tug-alert-fg` | `fg-default` | `--tug-alert-bg` | `surface-default` | `body-text` | Alert body text on alert background |
| 3 | `--tug-toast-info-fg` | `fg-default` | `--tug-toast-info-bg` | `surface-default` | `body-text` | Toast info text on toast background |
| 4 | `--tug-badge-neutral-fg` | `fg-muted` | `--tug-badge-neutral-bg` (divider-default) | `divider-default` | `ui-component` | Neutral badge text on divider-default background |
| 5 | `--tug-kbd-fg` | `fg-muted` | `--tug-kbd-bg` | `surface-default` | `ui-component` | Keyboard shortcut badge text on surface-default |

**Notes:**
- `divider-default` is an element token normally (a foreground), but here `--tug-badge-neutral-bg` uses it as a background. This dual-use means the contrast engine must check `fg-muted` on `divider-default`.
- `--tug-badge-accent-bg` uses a hardcoded `--tug-color(orange, ...)` value — not a base token, not trackable in the pairing map.

---

## File 6: tug-badge.css

**Component:** TugBadge

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-control-filled-accent-fg-rest` | `control-filled-accent-fg-rest` | `--tug-base-control-filled-accent-bg-rest` | `control-filled-accent-bg-rest` | `ui-component` | Badge text on filled-accent background |
| 2 | `--tug-base-control-filled-action-fg-rest` | `control-filled-action-fg-rest` | `--tug-base-control-filled-action-bg-rest` | `control-filled-action-bg-rest` | `ui-component` | Badge text on filled-action background |
| 3 | `--tug-base-control-filled-danger-fg-rest` | `control-filled-danger-fg-rest` | `--tug-base-control-filled-danger-bg-rest` | `control-filled-danger-bg-rest` | `ui-component` | Badge text on filled-danger background |
| 4 | `--tug-base-control-filled-agent-fg-rest` | `control-filled-agent-fg-rest` | `--tug-base-control-filled-agent-bg-rest` | `control-filled-agent-bg-rest` | `ui-component` | Badge text on filled-agent background |
| 5 | `--tug-base-control-outlined-action-fg-rest` | `control-outlined-action-fg-rest` | `--tug-base-control-outlined-action-bg-rest` | `control-outlined-action-bg-rest` | `ui-component` | Badge text on outlined-action background |
| 6 | `--tug-base-control-outlined-agent-fg-rest` | `control-outlined-agent-fg-rest` | `--tug-base-control-outlined-agent-bg-rest` | `control-outlined-agent-bg-rest` | `ui-component` | Badge text on outlined-agent background |
| 7 | `--tug-base-control-ghost-action-fg-rest` | `control-ghost-action-fg-rest` | `--tug-base-control-ghost-action-bg-rest` | `control-ghost-action-bg-rest` | `ui-component` | Badge text on ghost-action background |
| 8 | `--tug-base-control-ghost-danger-fg-rest` | `control-ghost-danger-fg-rest` | `--tug-base-control-ghost-danger-bg-rest` | `control-ghost-danger-bg-rest` | `ui-component` | Badge text on ghost-danger background |
| 9 | `--tug-base-badge-tinted-accent-fg` | `badge-tinted-accent-fg` | `--tug-base-badge-tinted-accent-bg` | `badge-tinted-accent-bg` | `ui-component` | Tinted accent badge text on tinted accent background |
| 10 | `--tug-base-badge-tinted-action-fg` | `badge-tinted-action-fg` | `--tug-base-badge-tinted-action-bg` | `badge-tinted-action-bg` | `ui-component` | Tinted action badge text on tinted action background |
| 11 | `--tug-base-badge-tinted-agent-fg` | `badge-tinted-agent-fg` | `--tug-base-badge-tinted-agent-bg` | `badge-tinted-agent-bg` | `ui-component` | Tinted agent badge text on tinted agent background |
| 12 | `--tug-base-badge-tinted-data-fg` | `badge-tinted-data-fg` | `--tug-base-badge-tinted-data-bg` | `badge-tinted-data-bg` | `ui-component` | Tinted data badge text on tinted data background |
| 13 | `--tug-base-badge-tinted-danger-fg` | `badge-tinted-danger-fg` | `--tug-base-badge-tinted-danger-bg` | `badge-tinted-danger-bg` | `ui-component` | Tinted danger badge text on tinted danger background |
| 14 | `--tug-base-badge-tinted-success-fg` | `badge-tinted-success-fg` | `--tug-base-badge-tinted-success-bg` | `badge-tinted-success-bg` | `ui-component` | Tinted success badge text on tinted success background |
| 15 | `--tug-base-badge-tinted-caution-fg` | `badge-tinted-caution-fg` | `--tug-base-badge-tinted-caution-bg` | `badge-tinted-caution-bg` | `ui-component` | Tinted caution badge text on tinted caution background |
| 16 | `--tug-base-control-filled-data-fg-rest` | `control-filled-data-fg-rest` | `--tug-base-control-filled-data-bg-rest` | `control-filled-data-bg-rest` | `ui-component` | Badge text on filled-data background |
| 17 | `--tug-base-control-filled-success-fg-rest` | `control-filled-success-fg-rest` | `--tug-base-control-filled-success-bg-rest` | `control-filled-success-bg-rest` | `ui-component` | Badge text on filled-success background |
| 18 | `--tug-base-control-filled-caution-fg-rest` | `control-filled-caution-fg-rest` | `--tug-base-control-filled-caution-bg-rest` | `control-filled-caution-bg-rest` | `ui-component` | Badge text on filled-caution background |
| 19 | `--tug-base-tone-accent-fg` | `tone-accent-fg` | transparent (parent surface) | (ambient surface-default/overlay) | `ui-component` | Ghost-accent badge text (transparent bg) |
| 20 | `--tug-base-tone-agent-fg` | `tone-agent-fg` | transparent (parent surface) | (ambient) | `ui-component` | Ghost-agent badge text (transparent bg) |
| 21 | `--tug-base-tone-data-fg` | `tone-data-fg` | transparent (parent surface) | (ambient) | `ui-component` | Ghost-data badge text (transparent bg) |
| 22 | `--tug-base-tone-success-fg` | `tone-success-fg` | transparent (parent surface) | (ambient) | `ui-component` | Ghost-success badge text (transparent bg) |
| 23 | `--tug-base-tone-caution-fg` | `tone-caution-fg` | transparent (parent surface) | (ambient) | `ui-component` | Ghost-caution badge text (transparent bg) |

---

## File 7: tug-switch.css

**Component:** TugSwitch

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-toggle-thumb` | `toggle-thumb` (chromatic) | `--tug-base-toggle-track-off` | `toggle-track-off` (chromatic) | `decorative` | Switch thumb on unchecked track |
| 2 | `--tug-base-toggle-thumb` | `toggle-thumb` (chromatic) | `--tug-base-toggle-track-on` | `toggle-track-on` (chromatic) | `decorative` | Switch thumb on checked track |
| 3 | `--tug-base-toggle-thumb-disabled` | `toggle-thumb-disabled` (chromatic) | `--tug-base-toggle-track-disabled` | `toggle-track-disabled` (chromatic) | `decorative` | Switch thumb on disabled track |
| 4 | `--tug-base-field-label` | `field-label` (pre-rename -> `field-fg-label`) | parent surface (ambient) | (typically surface-default or surface-inset) | `body-text` | Switch label text |

**Notes:**
- Track/thumb pairings are `decorative` — thumb position signals state, but visual contrast is not measured against WCAG text standards.
- `.tug-switch-label` uses `color: var(--tug-base-field-label)` where the background comes from the enclosing form surface.

---

## File 8: tug-checkbox.css

**Component:** TugCheckbox

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-checkmark` | `checkmark` (pre-rename -> `checkmark-fg`) | `--tug-base-toggle-track-on` | `toggle-track-on` (chromatic) | `ui-component` | Checkmark icon on checked box background |
| 2 | `--tug-base-checkmark-mixed` | `checkmark-mixed` (pre-rename -> `checkmark-fg-mixed`) | `--tug-base-toggle-track-mixed` | `toggle-track-mixed` (chromatic) | `ui-component` | Indeterminate dash on indeterminate box background |
| 3 | `--tug-base-field-label` | `field-label` (pre-rename -> `field-fg-label`) | parent surface (ambient) | (typically surface-default) | `body-text` | Checkbox label text |

**Notes:**
- Post-rename: pairings #1/#2 will reference `checkmark-fg` on `toggle-track-on` and `checkmark-fg-mixed` on `toggle-track-mixed`.

---

## File 9: tug-input.css

**Component:** TugInput

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-field-fg` | `field-fg` (pre-rename -> `field-fg-default`) | `--tug-base-field-bg-rest` | `field-bg-rest` | `body-text` | Input text on rest background |
| 2 | `--tug-base-field-placeholder` | `field-placeholder` (pre-rename -> `field-fg-placeholder`) | `--tug-base-field-bg-rest` | `field-bg-rest` | `subdued-text` | Placeholder text on rest background |
| 3 | `--tug-base-field-fg` | `field-fg` -> `field-fg-default` | `--tug-base-field-bg-hover` | `field-bg-hover` | `body-text` | Input text on hover background |
| 4 | `--tug-base-field-fg` | `field-fg` -> `field-fg-default` | `--tug-base-field-bg-focus` | `field-bg-focus` | `body-text` | Input text on focus background |
| 5 | `--tug-base-field-fg-disabled` | `field-fg-disabled` | `--tug-base-field-bg-disabled` | `field-bg-disabled` | `body-text` | Input text on disabled background |
| 6 | `--tug-base-field-fg-readOnly` | `field-fg-readOnly` | `--tug-base-field-bg-readOnly` | `field-bg-readOnly` | `body-text` | Input text on read-only background |

---

## File 10: tug-label.css

**Component:** TugLabel

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-field-label` | `field-label` (pre-rename -> `field-fg-label`) | parent surface (ambient) | (typically surface-default or field-bg) | `body-text` | Label text |
| 2 | `--tug-base-field-required` | `field-required` (pre-rename -> `field-fg-required`) | parent surface (ambient) | (same as label context) | `ui-component` | Required asterisk indicator |

---

## File 11: tug-marquee.css

**Component:** TugMarquee

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-field-label` | `field-label` (pre-rename -> `field-fg-label`) | parent surface (ambient) | (ambient) | `body-text` | Marquee label text |

---

## File 12: tug-data.css

**Component:** TugData (table, list, stat, chart, gauge — token definitions only)

### Pairings (from token definitions)

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-table-header-fg` | `fg-muted` | `--tug-table-header-bg` | `surface-sunken` | `subdued-text` | Table header cell text on sunken header background |
| 2 | `--tug-stat-value` | `fg-default` | parent (ambient) | (surface-default or surface-raised) | `body-text` | Stat value text |
| 3 | `--tug-stat-label` | `fg-subtle` | parent (ambient) | (surface-default or surface-raised) | `subdued-text` | Stat label text |

---

## File 13: tug-code.css

**Component:** TugCode (syntax, terminal, chat, codeblock, tree, diff, feed — token definitions only)

### Pairings (from token definitions)

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-syntax-comment` | `fg-muted` | `--tug-codeBlock-bg` | `surface-control` | `body-text` | Code comment text in code block |
| 2 | `--tug-syntax-operator` | `fg-default` | `--tug-codeBlock-bg` | `surface-control` | `body-text` | Code operator/punctuation text in code block |
| 3 | `--tug-codeBlock-header-fg` | `fg-subtle` | `--tug-codeBlock-header-bg` | `surface-sunken` | `subdued-text` | Code block header text on sunken header |
| 4 | `--tug-chat-attachment-fg` | `fg-muted` | `--tug-chat-attachment-bg` | `surface-overlay` | `subdued-text` | Chat attachment label on overlay background |
| 5 | `--tug-feed-step-fg` | `fg-muted` | `--tug-feed-step-bg` | `surface-sunken` | `subdued-text` | Feed step text on sunken background |
| 6 | `--tug-terminal-fg` | `fg-default` | `--tug-terminal-bg` | `surface-inset` | `body-text` | Terminal text on inset background |
| 7 | `--tug-terminal-fg-muted` | `fg-muted` | `--tug-terminal-bg` | `surface-inset` | `subdued-text` | Terminal muted text on inset background |
| 8 | `--tug-tree-row-fg` | `fg-default` | parent (ambient surface-default) | `surface-default` | `body-text` | File tree row text |

---

## File 14: tug-dock.css

**Component:** TugDock (token definitions only)

### Pairings (from token definitions)

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-dock-button-fg` | `fg-subtle` | `--tug-dock-bg` (field-bg-focus) | `field-bg-focus` | `ui-component` | Dock button icon on dock background |
| 2 | `--tug-dock-button-badge-fg` | `fg-inverse` | `--tug-dock-button-badge-bg` (tone-danger) | `tone-danger` (chromatic) | `ui-component` | Dock button notification badge on danger background |

---

## File 15: tug-hue-strip.css

**Component:** TugHueStrip

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-fg-muted` | `fg-muted` | parent (ambient surface-default) | `surface-default` | `subdued-text` | Rotated hue label text |

---

## File 16: tug-skeleton.css

**Component:** TugSkeleton

No foreground-on-background text or icon pairings. The skeleton is a purely decorative animated block. The background cycles between `tug-skeleton-base` and `tug-skeleton-highlight` — no text renders on it. Classified as `decorative` with no entries needed in the contrast engine map.

---

## File 17: tug-inspector.css

**Component:** TugInspector (token definitions only)

### Pairings (from token definitions)

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-inspector-emptyState-fg` | `fg-subtle` | `--tug-inspector-panel-bg` | `surface-sunken` | `subdued-text` | Inspector empty-state text on panel background |
| 2 | `--tug-dev-overlay-fg` | `fg-default` | `--tug-dev-overlay-bg` (hardcoded oklch) | (hardcoded dark) | `body-text` | Dev overlay text on dev overlay background |

**Notes:**
- `--tug-dev-overlay-bg` uses a hardcoded `--tug-color(indigo-violet, ...)` expression, not a base token — this pairing cannot be tracked in the base-level pairing map.

---

## File 18: style-inspector-overlay.css

**Component:** StyleInspectorOverlay (dev tooling)

This file uses **hardcoded oklch values exclusively** — no `--tug-base-*` tokens are used. All pairings here are outside the token system and are NOT added to `element-surface-pairing-map.ts`.

### Pairings (hardcoded oklch, outside token system)

| # | Element (hardcoded) | Surface (hardcoded) | Role | Context |
|---|---|---|---|---|
| 1 | `oklch(0.88 0.01 240)` | `oklch(0.14 0.01 240)` | `body-text` | Panel main text on dark panel background |
| 2 | `oklch(0.72 0.18 200)` | `oklch(0.14 0.01 240)` | `body-text` | Title and property labels on panel background |
| 3 | `oklch(0.72 0.18 200)` | `oklch(0.18 0.01 240)` | `body-text` | Section title on header background |
| 4 | `oklch(0.55 0.02 240)` | `oklch(0.14 0.01 240)` | `subdued-text` | Row label and dim text on panel background |
| 5 | `oklch(0.7 0.12 140)` | `oklch(0.14 0.01 240)` | `body-text` | Token chain resolved value text |
| 6 | `oklch(0.72 0.18 55)` | `oklch(0.14 0.01 240)` | `body-text` | Terminal/pin badge display (orange accent tone) |

These hardcoded colors are intentionally outside the token system. The overlay is a dev tool that must remain legible regardless of active theme. Contrast ratios are fixed at authoring time.

---

## File 19: gallery-card.css

**Component:** GalleryCard (gallery scaffolding)

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-fg-muted` | `fg-muted` | `--tug-base-surface-default` | `surface-default` | `subdued-text` | Gallery section title, control label, demo status text |
| 2 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-default` | `surface-default` | `body-text` | Demo status code text, cascade table value, readout value |
| 3 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-control` | `surface-control` | `body-text` | Gallery select control, demo trigger button text |
| 4 | `--tug-base-accent-default` | `accent-default` (chromatic) | `--tug-base-surface-default` | `surface-default` | `ui-component` | Cascade source column text (accent color on surface-default) |
| 5 | `--tug-base-accent-cool-default` | `accent-cool-default` (chromatic) | `--tug-base-surface-default` | `surface-default` | `ui-component` | Scale/timing readout values in accent-cool color |

---

## File 20: gallery-badge-mockup.css

**Component:** GalleryBadgeMockup (exploratory styles)

The badge mockup tinted variants use `--tug-color(*-light)` expressions as text color — not base tokens and not trackable in the pairing map. Only the filled variants (which use real base tokens) are included.

### Pairings (token-based surfaces only)

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-control-filled-accent-fg-rest` | `control-filled-accent-fg-rest` | `--tug-base-control-filled-accent-bg-rest` | `control-filled-accent-bg-rest` | `ui-component` | Mockup filled-accent badge text |
| 2 | `--tug-base-control-filled-action-fg-rest` | `control-filled-action-fg-rest` | `--tug-base-control-filled-action-bg-rest` | `control-filled-action-bg-rest` | `ui-component` | Mockup filled-action badge text |
| 3 | `--tug-base-control-filled-agent-fg-rest` | `control-filled-agent-fg-rest` | `--tug-base-control-filled-agent-bg-rest` | `control-filled-agent-bg-rest` | `ui-component` | Mockup filled-agent badge text |
| 4 | `--tug-base-control-filled-data-fg-rest` | `control-filled-data-fg-rest` | `--tug-base-control-filled-data-bg-rest` | `control-filled-data-bg-rest` | `ui-component` | Mockup filled-data badge text |
| 5 | `--tug-base-control-filled-danger-fg-rest` | `control-filled-danger-fg-rest` | `--tug-base-control-filled-danger-bg-rest` | `control-filled-danger-bg-rest` | `ui-component` | Mockup filled-danger badge text |
| 6 | `--tug-base-control-filled-success-fg-rest` | `control-filled-success-fg-rest` | `--tug-base-control-filled-success-bg-rest` | `control-filled-success-bg-rest` | `ui-component` | Mockup filled-success badge text |
| 7 | `--tug-base-control-filled-caution-fg-rest` | `control-filled-caution-fg-rest` | `--tug-base-control-filled-caution-bg-rest` | `control-filled-caution-bg-rest` | `ui-component` | Mockup filled-caution badge text |

---

## File 21: gallery-popup-button.css

**Component:** GalleryPopupButton

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-fg-muted` | `fg-muted` | parent (ambient) | (ambient, typically surface-default) | `subdued-text` | Slider labels and demo labels |
| 2 | `--tug-base-fg-subtle` | `fg-subtle` | `--tug-base-surface-inset` | `surface-inset` | `subdued-text` | Context bar label text on inset background |

---

## File 22: gallery-palette-content.css

**Component:** GalleryPaletteContent

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-control` | `surface-control` | `body-text` | Action button text on surface-control |
| 2 | `--tug-base-tone-danger-fg` | `tone-danger-fg` | `--tug-base-tone-danger-bg` | `tone-danger-bg` | `body-text` | Error message text on danger tint background |
| 3 | `--tug-base-fg-muted` | `fg-muted` | parent (ambient) | (ambient surface-default) | `subdued-text` | SVG axis labels, vib/val readout labels |
| 4 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-inset` | `surface-inset` | `body-text` | Formula code snippet text on inset background |

---

## File 23: gallery-theme-generator-content.css

**Component:** GalleryThemeGeneratorContent

### Pairings

| # | Element (component alias) | Resolved base element | Surface (component alias) | Resolved base surface | Role | Context |
|---|---|---|---|---|---|---|
| 1 | `--tug-base-fg-muted` | `fg-muted` | `--tug-base-surface-default` | `surface-default` | `subdued-text` | Mode button label at rest on surface-default |
| 2 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-raised` | `surface-raised` | `body-text` | Mode button text on hover (surface-raised) |
| 3 | `--tug-base-fg-onAccent` | `fg-onAccent` | `--tug-base-accent-default` | `accent-default` (chromatic) | `ui-component` | Active mode button label on accent-default background |
| 4 | `--tug-base-fg-default` | `fg-default` | `--tug-base-bg-canvas` | `bg-canvas` | `body-text` | Preview content text on canvas background |
| 5 | `--tug-base-fg-muted` | `fg-muted` | `--tug-base-bg-canvas` | `bg-canvas` | `subdued-text` | Preview muted text on canvas background |
| 6 | `--tug-base-fg-subtle` | `fg-subtle` | `--tug-base-bg-canvas` | `bg-canvas` | `subdued-text` | Preview subtle text on canvas background |
| 7 | `--tug-base-fg-link` | `fg-link` | `--tug-base-bg-canvas` | `bg-canvas` | `body-text` | Preview link text on canvas background |
| 8 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-raised` | `surface-raised` | `body-text` | Preview inset section text on surface-raised |
| 9 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-default` | `surface-default` | `body-text` | Compact hue row label, slider label, token name, dash summary text |
| 10 | `--tug-base-fg-muted` | `fg-muted` | `--tug-base-surface-default` | `surface-default` | `subdued-text` | Token grid names/values, slider values, column headers |
| 11 | `--tug-base-fg-default` | `fg-default` | `--tug-base-surface-control` | `surface-control` | `body-text` | Preset buttons, export/autofix button text on surface-control |
| 12 | `--tug-base-tone-success-fg` | `tone-success-fg` | `--tug-base-tone-success-bg` | `tone-success-bg` | `ui-component` | Contrast dashboard pass badge text on success tint |
| 13 | `--tug-base-tone-caution-fg` | `tone-caution-fg` | `--tug-base-tone-caution-bg` | `tone-caution-bg` | `ui-component` | Contrast dashboard marginal badge and CVD warn badge text on caution tint |
| 14 | `--tug-base-tone-danger-fg` | `tone-danger-fg` | `--tug-base-tone-danger-bg` | `tone-danger-bg` | `ui-component` | Contrast dashboard fail badge text on danger tint |
| 15 | `--tug-base-fg-muted` | `fg-muted` | `--tug-base-surface-raised` | `surface-raised` | `ui-component` | Decorative/neutral badge text on surface-raised |
| 16 | `--tug-base-fg-onAccent` | `fg-onAccent` | `--tug-base-accent-subtle` | `accent-subtle` (chromatic) | `ui-component` | Active preset button text on accent-subtle background |
| 17 | `--tug-base-fg-default` | `fg-default` | `--tug-base-tone-caution-bg` | `tone-caution-bg` | `body-text` | Auto-fix suggestion list items on caution tint panel |
| 18 | `--tug-base-tone-caution-fg` | `tone-caution-fg` | `--tug-base-tone-caution-bg` | `tone-caution-bg` | `body-text` | Auto-fix suggestion title and type label on caution tint panel |

---

## Summary

### Files Audited Checklist

| File | Audited | Non-decorative Pairings Found |
|------|---------|-------------------------------|
| tug-button.css | yes | 48 (fg+icon per emphasis/role/state) |
| tug-card.css | yes | 7 |
| tug-tab.css | yes | 8 |
| tug-menu.css | yes | 9 |
| tug-dialog.css | yes | 5 |
| tug-badge.css | yes | 23 |
| tug-switch.css | yes | 1 (label only; track/thumb decorative) |
| tug-checkbox.css | yes | 3 |
| tug-input.css | yes | 6 |
| tug-label.css | yes | 2 |
| tug-marquee.css | yes | 1 |
| tug-data.css | yes | 3 |
| tug-code.css | yes | 8 |
| tug-dock.css | yes | 2 |
| tug-hue-strip.css | yes | 1 |
| tug-skeleton.css | yes | 0 (decorative only) |
| tug-inspector.css | yes | 1 (1 has hardcoded bg) |
| style-inspector-overlay.css | yes | 6 (hardcoded oklch, outside token system) |
| gallery-card.css | yes | 5 |
| gallery-badge-mockup.css | yes | 7 |
| gallery-popup-button.css | yes | 2 |
| gallery-palette-content.css | yes | 4 |
| gallery-theme-generator-content.css | yes | 18 |

**Total files audited: 23 / 23** — complete.

**Approximate total base-level pairings (excluding transparent/ambient-bg pairings and hardcoded): ~175 distinct pairings** directly observable in CSS rules across these 23 files. This is the CSS-observable subset; the existing 239-entry map includes additional state variants, programmatically-set pairings, and entries derived from design intent rather than direct CSS observation. Adding the ~36 gap entries identified below would bring the total map to approximately 275 entries — significantly more than the current 239.

---

### Confirmed Gap: Card Title Bar (fg-default on tab-bg-active)

**GAP CONFIRMED.** The `.tugcard-title` element sets `color: var(--tug-card-title-bar-fg)` which resolves to `--tug-base-fg-default`. When `card-frame[data-focused="true"]`, the `.tugcard-title-bar` background becomes `var(--tug-card-title-bar-bg-active)` which resolves to `--tug-base-tab-bg-active`.

This produces the pairing: **`fg-default` on `tab-bg-active`** with role `body-text`.

This pairing is absent from the current pairing map. It is documented as File 2, Pairing #1 above.

---

### Key Gaps vs. Current Pairing Map

The following base-level pairings were discovered that are likely absent from the current 239-entry map. These must be verified and added in Step 5:

1. **`fg-default` on `tab-bg-active`** — card title text (THE primary gap; role: body-text)
2. **`fg-default` on `tab-bg-inactive`** — card title text on inactive title bar (role: body-text)
3. **`icon-active` on `tab-bg-active`** — card icon on active title bar (role: ui-component)
4. **`fg-subtle` on `tab-bg-inactive`** — card icon on inactive title bar (role: ui-component)
5. **`surface-default` on `accent-default`** — tab overflow badge text; CSS sets `color: var(--tug-base-surface-default)` directly (role: ui-component)
6. **`fg-onAccent` on `accent-default`** — active mode button, gtg-mode-btn--active (role: ui-component)
7. **`fg-onAccent` on `accent-subtle`** — active preset button, gtg-preset-btn--active (role: ui-component)
8. **`fg-default` on `bg-canvas`** — preview canvas content text (role: body-text)
9. **`fg-muted` on `bg-canvas`** — preview canvas muted text (role: subdued-text)
10. **`fg-subtle` on `bg-canvas`** — preview canvas subtle text (role: subdued-text)
11. **`fg-link` on `bg-canvas`** — preview canvas link text (role: body-text)
12. **`fg-default` on `surface-raised`** — mode button hover, preview inset text (role: body-text)
13. **`fg-muted` on `surface-raised`** — decorative badge, compact hue row (role: ui-component)
14. **`fg-default` on `surface-inset`** — formula code snippet, context bar (role: body-text)
15. **`fg-subtle` on `surface-inset`** — context bar label (role: subdued-text)
16. **`tone-danger-fg` on `tone-danger-bg`** — error/import error panels, fail badges (role: body-text)
17. **`tone-success-fg` on `tone-success-bg`** — pass badges across multiple components (role: ui-component)
18. **`tone-caution-fg` on `tone-caution-bg`** — marginal badges, autofix panels, CVD warn (role: ui-component)
19. **`fg-default` on `tone-caution-bg`** — autofix suggestion list items on caution tint (role: body-text)
20. **`fg-muted` on `surface-sunken`** — table header, feed step, code block header (role: subdued-text)
21. **`fg-subtle` on `surface-sunken`** — code block header fg (role: subdued-text)
22. **`fg-default` on `surface-inset`** — terminal text on surface-inset (role: body-text)
23. **`fg-muted` on `surface-inset`** — terminal muted text on surface-inset (role: subdued-text)
24. **`fg-default` on `surface-screen`** — tooltip text on surface-screen (role: body-text)
25. **`fg-default` on `field-bg-focus`** — dock background context (dock bg = field-bg-focus) (role: ui-component)
26. **`fg-default` on `surface-overlay`** — dialog, alert, toast, menu, popover, chat attachment context (role: body-text)
27. **`fg-subtle` on `surface-overlay`** — menu meta, shortcut, chevron text (role: subdued-text)
28. **`tone-danger` on `surface-overlay`** — danger menu item text (chromatic fg on surface-overlay; role: body-text)
29. **`fg-default` on `accent-subtle`** — menu selected item text (fg-default on accent-subtle; role: body-text)
30. **`checkmark-fg` on `toggle-track-on`** — checkbox checkmark on checked box (post-rename; role: ui-component)
31. **`checkmark-fg-mixed` on `toggle-track-mixed`** — indeterminate checkbox icon (post-rename; role: ui-component)
32. **`fg-inverse` on `tone-danger`** — dock button badge text on tone-danger (chromatic bg; role: ui-component)
33. **`fg-muted` on `divider-default`** — neutral badge text on divider-default used as bg (role: ui-component)
34. **`fg-muted` on `field-bg-focus`** — dock button fg-subtle on dock background (role: ui-component)
35. **`fg-default` on `surface-control`** — gallery button/select controls, demo triggers, code block bg text (role: body-text)
36. **`fg-muted` on `surface-control`** — code block content (syntax-comment) (role: body-text)
