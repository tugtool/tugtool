# Token Inventory Baseline

**Purpose:** Authoritative snapshot of all `--tug-base-*` tokens extracted from `styles/themes/brio.css` as of 2026-03-18, with classification status for the token audit and pairing extraction plan.

**Source:** `tugdeck/styles/themes/brio.css`

**Total token count:** 373

---

## Classification Summary

| Category | Count |
|----------|-------|
| Non-color (excluded from element/surface/chromatic classification) | 49 |
| Surface (background) | 80 |
| Element (foreground) | 206 |
| Chromatic (dual-use) | 32 |
| Unclassified (require rename — will become element after Step 4) | 6 |
| **Total** | **373** |

Post-rename classification: Surface 80, Element 212, Chromatic 32, Non-color 49 = 373.

---

## Classification Logic

Per [Spec S01](../.tugtool/tugplan-token-audit-pairing.md#s01-classification):

**Phase 1 — Non-color exclusion.** Tokens matching any of these patterns are excluded from color classification:
- Name contains `motion-`, `space-`, `radius-`, `font-`, `chrome-height`, `icon-size-` (i.e., `size-`), `line-height-`, `opacity`
- Value is an invariant non-color string (`control-disabled-shadow: none`)

**Phase 2 — Color classification:**
- **Surface:** name contains `-bg-`, ends in `-bg`, or contains `-surface-`
- **Element:** name contains `-fg-`, ends in `-fg`, contains `-border-`, ends in `-border`, contains `-divider-`, ends in `-divider`, contains `-shadow-`, ends in `-shadow`, contains `-icon-`, or ends in `-icon` (excluding `icon-size-*`)
- **Chromatic (explicit enumeration):** `accent-default`, `accent-cool-default`, `accent-subtle`; bare `tone-*` (7 families); `highlight-*` (6); `overlay-*` (3); `toggle-track-*` (7); `toggle-thumb`, `toggle-thumb-disabled`; `radio-dot`; `field-tone-*` (3)

**Classification note on `-bg$` suffix:** The spec text says `-bg-` (with trailing dash) but tokens ending in `-bg` (e.g., `badge-tinted-accent-bg`, `control-selected-bg`) are stated as "already classifiable" in D01. The classification must treat `-bg$` (name ending in `-bg`) as a surface suffix in addition to `-bg-` (mid-name segment).

---

## Tokens Requiring Rename (Unclassified Under Current Phase 2 Regex)

The following 6 tokens are currently unclassifiable by the Phase 2 regex. Plus `field-fg` requires rename for consistency (it matches `-fg$` but lacks a state suffix). This gives the ~7 rename candidates from Table T01.

| Current Token | Issue | Planned New Name | Post-rename Category |
|---------------|-------|-----------------|---------------------|
| `--tug-base-field-fg` | Matches `-fg$` but lacks state suffix (inconsistent with `field-fg-disabled`, `field-fg-readOnly`) | `--tug-base-field-fg-default` | element |
| `--tug-base-field-placeholder` | No `-fg-` or `-border-` segment | `--tug-base-field-fg-placeholder` | element |
| `--tug-base-field-label` | No `-fg-` or `-border-` segment | `--tug-base-field-fg-label` | element |
| `--tug-base-field-required` | No `-fg-` or `-border-` segment | `--tug-base-field-fg-required` | element |
| `--tug-base-checkmark` | No `-fg-` or `-icon-` segment | `--tug-base-checkmark-fg` | element |
| `--tug-base-checkmark-mixed` | No `-fg-` or `-icon-` segment | `--tug-base-checkmark-fg-mixed` | element |
| `--tug-base-separator` | No `-border-` or `-divider-` segment | `--tug-base-divider-separator` | element |

**True unclassified count: 6** (`field-fg` is classifiable but inconsistently named, hence it is counted separately above).
**Rename candidate count: 7** (matches expected ~7 from Table T01).

---

## Non-Color Tokens (49 total)

These tokens are excluded from color classification (Phase 1).

### Motion (8)
- `--tug-base-motion-duration-fast`
- `--tug-base-motion-duration-glacial`
- `--tug-base-motion-duration-instant`
- `--tug-base-motion-duration-moderate`
- `--tug-base-motion-duration-slow`
- `--tug-base-motion-easing-enter`
- `--tug-base-motion-easing-exit`
- `--tug-base-motion-easing-standard`

### Space (7)
- `--tug-base-space-2xl`
- `--tug-base-space-2xs`
- `--tug-base-space-lg`
- `--tug-base-space-md`
- `--tug-base-space-sm`
- `--tug-base-space-xl`
- `--tug-base-space-xs`

### Radius (7)
- `--tug-base-radius-2xl`
- `--tug-base-radius-2xs`
- `--tug-base-radius-lg`
- `--tug-base-radius-md`
- `--tug-base-radius-sm`
- `--tug-base-radius-xl`
- `--tug-base-radius-xs`

### Chrome (1)
- `--tug-base-chrome-height`

### Icon Size (6)
- `--tug-base-icon-size-2xs`
- `--tug-base-icon-size-lg`
- `--tug-base-icon-size-md`
- `--tug-base-icon-size-sm`
- `--tug-base-icon-size-xl`
- `--tug-base-icon-size-xs`

### Font (9)
- `--tug-base-font-family-mono`
- `--tug-base-font-family-sans`
- `--tug-base-font-size-2xl`
- `--tug-base-font-size-2xs`
- `--tug-base-font-size-lg`
- `--tug-base-font-size-md`
- `--tug-base-font-size-sm`
- `--tug-base-font-size-xl`
- `--tug-base-font-size-xs`

### Line Height (9) — invariant typography values
- `--tug-base-line-height-2xl`
- `--tug-base-line-height-2xs`
- `--tug-base-line-height-lg`
- `--tug-base-line-height-md`
- `--tug-base-line-height-normal`
- `--tug-base-line-height-sm`
- `--tug-base-line-height-tight`
- `--tug-base-line-height-xl`
- `--tug-base-line-height-xs`

### Control — Non-color Properties (2)
- `--tug-base-control-disabled-opacity` — opacity scalar (name contains `opacity`)
- `--tug-base-control-disabled-shadow` — value is `none` (invariant non-color string)

---

## Surface Tokens (80 total)

All tokens with `-bg-` as a mid-name segment, ending in `-bg`, or with `-surface-` in the name.

### Background — app/canvas (2)
- `--tug-base-bg-app`
- `--tug-base-bg-canvas`

### Surface — semantic layers (8)
- `--tug-base-surface-content`
- `--tug-base-surface-control`
- `--tug-base-surface-default`
- `--tug-base-surface-inset`
- `--tug-base-surface-overlay`
- `--tug-base-surface-raised`
- `--tug-base-surface-screen`
- `--tug-base-surface-sunken`

### Tab Background (5)
- `--tug-base-tab-bg-active`
- `--tug-base-tab-bg-collapsed`
- `--tug-base-tab-bg-hover`
- `--tug-base-tab-bg-inactive`
- `--tug-base-tab-close-bg-hover`

### Control — Disabled Background (1)
- `--tug-base-control-disabled-bg`

### Control — Filled Backgrounds (21) — 7 variants × 3 states
- `--tug-base-control-filled-accent-bg-active`
- `--tug-base-control-filled-accent-bg-hover`
- `--tug-base-control-filled-accent-bg-rest`
- `--tug-base-control-filled-action-bg-active`
- `--tug-base-control-filled-action-bg-hover`
- `--tug-base-control-filled-action-bg-rest`
- `--tug-base-control-filled-agent-bg-active`
- `--tug-base-control-filled-agent-bg-hover`
- `--tug-base-control-filled-agent-bg-rest`
- `--tug-base-control-filled-caution-bg-active`
- `--tug-base-control-filled-caution-bg-hover`
- `--tug-base-control-filled-caution-bg-rest`
- `--tug-base-control-filled-danger-bg-active`
- `--tug-base-control-filled-danger-bg-hover`
- `--tug-base-control-filled-danger-bg-rest`
- `--tug-base-control-filled-data-bg-active`
- `--tug-base-control-filled-data-bg-hover`
- `--tug-base-control-filled-data-bg-rest`
- `--tug-base-control-filled-success-bg-active`
- `--tug-base-control-filled-success-bg-hover`
- `--tug-base-control-filled-success-bg-rest`

### Control — Ghost Backgrounds (9)
- `--tug-base-control-ghost-action-bg-active`
- `--tug-base-control-ghost-action-bg-hover`
- `--tug-base-control-ghost-action-bg-rest`
- `--tug-base-control-ghost-danger-bg-active`
- `--tug-base-control-ghost-danger-bg-hover`
- `--tug-base-control-ghost-danger-bg-rest`
- `--tug-base-control-ghost-option-bg-active`
- `--tug-base-control-ghost-option-bg-hover`
- `--tug-base-control-ghost-option-bg-rest`

### Control — Outlined Backgrounds (9)
- `--tug-base-control-outlined-action-bg-active`
- `--tug-base-control-outlined-action-bg-hover`
- `--tug-base-control-outlined-action-bg-rest`
- `--tug-base-control-outlined-agent-bg-active`
- `--tug-base-control-outlined-agent-bg-hover`
- `--tug-base-control-outlined-agent-bg-rest`
- `--tug-base-control-outlined-option-bg-active`
- `--tug-base-control-outlined-option-bg-hover`
- `--tug-base-control-outlined-option-bg-rest`

### Control — Highlighted/Selected Backgrounds (4)
- `--tug-base-control-highlighted-bg`
- `--tug-base-control-selected-bg`
- `--tug-base-control-selected-bg-hover`
- `--tug-base-control-selected-disabled-bg`

### Field Background (5)
- `--tug-base-field-bg-disabled`
- `--tug-base-field-bg-focus`
- `--tug-base-field-bg-hover`
- `--tug-base-field-bg-readOnly`
- `--tug-base-field-bg-rest`

### Selection Background (2)
- `--tug-base-selection-bg`
- `--tug-base-selection-bg-inactive`

### Badge Tinted Background (7)
- `--tug-base-badge-tinted-accent-bg`
- `--tug-base-badge-tinted-action-bg`
- `--tug-base-badge-tinted-agent-bg`
- `--tug-base-badge-tinted-caution-bg`
- `--tug-base-badge-tinted-danger-bg`
- `--tug-base-badge-tinted-data-bg`
- `--tug-base-badge-tinted-success-bg`

### Tone Background (7)
- `--tug-base-tone-accent-bg`
- `--tug-base-tone-active-bg`
- `--tug-base-tone-agent-bg`
- `--tug-base-tone-caution-bg`
- `--tug-base-tone-danger-bg`
- `--tug-base-tone-data-bg`
- `--tug-base-tone-success-bg`

---

## Element Tokens (206 currently classified; 212 post-rename)

All tokens with `-fg-`, `-fg$`, `-border-`, `-border$`, `-divider-`, `-divider$`, `-shadow-`, `-shadow$`, `-icon-`, or `-icon$` in the name (excluding `icon-size-*`).

### Foreground — General (12)
- `--tug-base-fg-default`
- `--tug-base-fg-disabled`
- `--tug-base-fg-inverse`
- `--tug-base-fg-link`
- `--tug-base-fg-link-hover`
- `--tug-base-fg-muted`
- `--tug-base-fg-onAccent`
- `--tug-base-fg-onCaution`
- `--tug-base-fg-onDanger`
- `--tug-base-fg-onSuccess`
- `--tug-base-fg-placeholder`
- `--tug-base-fg-subtle`

### Icon — General (5)
- `--tug-base-icon-active`
- `--tug-base-icon-default`
- `--tug-base-icon-disabled`
- `--tug-base-icon-muted`
- `--tug-base-icon-onAccent`

### Border — General (6)
- `--tug-base-border-accent`
- `--tug-base-border-danger`
- `--tug-base-border-default`
- `--tug-base-border-inverse`
- `--tug-base-border-muted`
- `--tug-base-border-strong`

### Divider (2)
- `--tug-base-divider-default`
- `--tug-base-divider-muted`

### Shadow (5)
- `--tug-base-shadow-lg`
- `--tug-base-shadow-md`
- `--tug-base-shadow-overlay`
- `--tug-base-shadow-xl`
- `--tug-base-shadow-xs`

### Tab — Foreground (4)
- `--tug-base-tab-fg-active`
- `--tug-base-tab-fg-hover`
- `--tug-base-tab-fg-rest`
- `--tug-base-tab-close-fg-hover`

### Control — Disabled Foreground and Icon (2)
- `--tug-base-control-disabled-fg`
- `--tug-base-control-disabled-icon`

### Control — Disabled Border (1)
- `--tug-base-control-disabled-border`

### Control — Filled Foreground, Border, Icon (63) — 7 variants × 3 props × 3 states
- `--tug-base-control-filled-accent-fg-active`
- `--tug-base-control-filled-accent-fg-hover`
- `--tug-base-control-filled-accent-fg-rest`
- `--tug-base-control-filled-accent-border-active`
- `--tug-base-control-filled-accent-border-hover`
- `--tug-base-control-filled-accent-border-rest`
- `--tug-base-control-filled-accent-icon-active`
- `--tug-base-control-filled-accent-icon-hover`
- `--tug-base-control-filled-accent-icon-rest`
- `--tug-base-control-filled-action-fg-active`
- `--tug-base-control-filled-action-fg-hover`
- `--tug-base-control-filled-action-fg-rest`
- `--tug-base-control-filled-action-border-active`
- `--tug-base-control-filled-action-border-hover`
- `--tug-base-control-filled-action-border-rest`
- `--tug-base-control-filled-action-icon-active`
- `--tug-base-control-filled-action-icon-hover`
- `--tug-base-control-filled-action-icon-rest`
- `--tug-base-control-filled-agent-fg-active`
- `--tug-base-control-filled-agent-fg-hover`
- `--tug-base-control-filled-agent-fg-rest`
- `--tug-base-control-filled-agent-border-active`
- `--tug-base-control-filled-agent-border-hover`
- `--tug-base-control-filled-agent-border-rest`
- `--tug-base-control-filled-agent-icon-active`
- `--tug-base-control-filled-agent-icon-hover`
- `--tug-base-control-filled-agent-icon-rest`
- `--tug-base-control-filled-caution-fg-active`
- `--tug-base-control-filled-caution-fg-hover`
- `--tug-base-control-filled-caution-fg-rest`
- `--tug-base-control-filled-caution-border-active`
- `--tug-base-control-filled-caution-border-hover`
- `--tug-base-control-filled-caution-border-rest`
- `--tug-base-control-filled-caution-icon-active`
- `--tug-base-control-filled-caution-icon-hover`
- `--tug-base-control-filled-caution-icon-rest`
- `--tug-base-control-filled-danger-fg-active`
- `--tug-base-control-filled-danger-fg-hover`
- `--tug-base-control-filled-danger-fg-rest`
- `--tug-base-control-filled-danger-border-active`
- `--tug-base-control-filled-danger-border-hover`
- `--tug-base-control-filled-danger-border-rest`
- `--tug-base-control-filled-danger-icon-active`
- `--tug-base-control-filled-danger-icon-hover`
- `--tug-base-control-filled-danger-icon-rest`
- `--tug-base-control-filled-data-fg-active`
- `--tug-base-control-filled-data-fg-hover`
- `--tug-base-control-filled-data-fg-rest`
- `--tug-base-control-filled-data-border-active`
- `--tug-base-control-filled-data-border-hover`
- `--tug-base-control-filled-data-border-rest`
- `--tug-base-control-filled-data-icon-active`
- `--tug-base-control-filled-data-icon-hover`
- `--tug-base-control-filled-data-icon-rest`
- `--tug-base-control-filled-success-fg-active`
- `--tug-base-control-filled-success-fg-hover`
- `--tug-base-control-filled-success-fg-rest`
- `--tug-base-control-filled-success-border-active`
- `--tug-base-control-filled-success-border-hover`
- `--tug-base-control-filled-success-border-rest`
- `--tug-base-control-filled-success-icon-active`
- `--tug-base-control-filled-success-icon-hover`
- `--tug-base-control-filled-success-icon-rest`

### Control — Ghost Foreground, Border, Icon (27)
- `--tug-base-control-ghost-action-fg-active`
- `--tug-base-control-ghost-action-fg-hover`
- `--tug-base-control-ghost-action-fg-rest`
- `--tug-base-control-ghost-action-border-active`
- `--tug-base-control-ghost-action-border-hover`
- `--tug-base-control-ghost-action-border-rest`
- `--tug-base-control-ghost-action-icon-active`
- `--tug-base-control-ghost-action-icon-hover`
- `--tug-base-control-ghost-action-icon-rest`
- `--tug-base-control-ghost-danger-fg-active`
- `--tug-base-control-ghost-danger-fg-hover`
- `--tug-base-control-ghost-danger-fg-rest`
- `--tug-base-control-ghost-danger-border-active`
- `--tug-base-control-ghost-danger-border-hover`
- `--tug-base-control-ghost-danger-border-rest`
- `--tug-base-control-ghost-danger-icon-active`
- `--tug-base-control-ghost-danger-icon-hover`
- `--tug-base-control-ghost-danger-icon-rest`
- `--tug-base-control-ghost-option-fg-active`
- `--tug-base-control-ghost-option-fg-hover`
- `--tug-base-control-ghost-option-fg-rest`
- `--tug-base-control-ghost-option-border-active`
- `--tug-base-control-ghost-option-border-hover`
- `--tug-base-control-ghost-option-border-rest`
- `--tug-base-control-ghost-option-icon-active`
- `--tug-base-control-ghost-option-icon-hover`
- `--tug-base-control-ghost-option-icon-rest`

### Control — Outlined Foreground, Border, Icon (27)
- `--tug-base-control-outlined-action-fg-active`
- `--tug-base-control-outlined-action-fg-hover`
- `--tug-base-control-outlined-action-fg-rest`
- `--tug-base-control-outlined-action-border-active`
- `--tug-base-control-outlined-action-border-hover`
- `--tug-base-control-outlined-action-border-rest`
- `--tug-base-control-outlined-action-icon-active`
- `--tug-base-control-outlined-action-icon-hover`
- `--tug-base-control-outlined-action-icon-rest`
- `--tug-base-control-outlined-agent-fg-active`
- `--tug-base-control-outlined-agent-fg-hover`
- `--tug-base-control-outlined-agent-fg-rest`
- `--tug-base-control-outlined-agent-border-active`
- `--tug-base-control-outlined-agent-border-hover`
- `--tug-base-control-outlined-agent-border-rest`
- `--tug-base-control-outlined-agent-icon-active`
- `--tug-base-control-outlined-agent-icon-hover`
- `--tug-base-control-outlined-agent-icon-rest`
- `--tug-base-control-outlined-option-fg-active`
- `--tug-base-control-outlined-option-fg-hover`
- `--tug-base-control-outlined-option-fg-rest`
- `--tug-base-control-outlined-option-border-active`
- `--tug-base-control-outlined-option-border-hover`
- `--tug-base-control-outlined-option-border-rest`
- `--tug-base-control-outlined-option-icon-active`
- `--tug-base-control-outlined-option-icon-hover`
- `--tug-base-control-outlined-option-icon-rest`

### Control — Highlighted/Selected Foreground and Border (4)
- `--tug-base-control-highlighted-border`
- `--tug-base-control-highlighted-fg`
- `--tug-base-control-selected-border`
- `--tug-base-control-selected-fg`

### Field — Foreground (currently classified: 2; post-rename: 6)
Currently classified as element (match `-fg$` or `-fg-`):
- `--tug-base-field-fg` *(inconsistently named; will rename to `field-fg-default`)*
- `--tug-base-field-fg-disabled`
- `--tug-base-field-fg-readOnly`

Post-rename additions (currently unclassified):
- `--tug-base-field-fg-placeholder` *(rename from `field-placeholder`)*
- `--tug-base-field-fg-label` *(rename from `field-label`)*
- `--tug-base-field-fg-required` *(rename from `field-required`)*
- `--tug-base-field-fg-default` *(rename from `field-fg`)*

### Field — Border (7)
- `--tug-base-field-border-active`
- `--tug-base-field-border-danger`
- `--tug-base-field-border-disabled`
- `--tug-base-field-border-hover`
- `--tug-base-field-border-readOnly`
- `--tug-base-field-border-rest`
- `--tug-base-field-border-success`

### Selection — Foreground (1)
- `--tug-base-selection-fg`

### Badge Tinted — Border and Foreground (14)
- `--tug-base-badge-tinted-accent-border`
- `--tug-base-badge-tinted-accent-fg`
- `--tug-base-badge-tinted-action-border`
- `--tug-base-badge-tinted-action-fg`
- `--tug-base-badge-tinted-agent-border`
- `--tug-base-badge-tinted-agent-fg`
- `--tug-base-badge-tinted-caution-border`
- `--tug-base-badge-tinted-caution-fg`
- `--tug-base-badge-tinted-danger-border`
- `--tug-base-badge-tinted-danger-fg`
- `--tug-base-badge-tinted-data-border`
- `--tug-base-badge-tinted-data-fg`
- `--tug-base-badge-tinted-success-border`
- `--tug-base-badge-tinted-success-fg`

### Tone — Border, Foreground, Icon (21)
- `--tug-base-tone-accent-border`
- `--tug-base-tone-accent-fg`
- `--tug-base-tone-accent-icon`
- `--tug-base-tone-active-border`
- `--tug-base-tone-active-fg`
- `--tug-base-tone-active-icon`
- `--tug-base-tone-agent-border`
- `--tug-base-tone-agent-fg`
- `--tug-base-tone-agent-icon`
- `--tug-base-tone-caution-border`
- `--tug-base-tone-caution-fg`
- `--tug-base-tone-caution-icon`
- `--tug-base-tone-danger-border`
- `--tug-base-tone-danger-fg`
- `--tug-base-tone-danger-icon`
- `--tug-base-tone-data-border`
- `--tug-base-tone-data-fg`
- `--tug-base-tone-data-icon`
- `--tug-base-tone-success-border`
- `--tug-base-tone-success-fg`
- `--tug-base-tone-success-icon`

### Toggle — Icon (2)
- `--tug-base-toggle-icon-disabled`
- `--tug-base-toggle-icon-mixed`

### Checkmark (post-rename only)
- `--tug-base-checkmark-fg` *(rename from `checkmark`)*
- `--tug-base-checkmark-fg-mixed` *(rename from `checkmark-mixed`)*

### Divider — Separator (post-rename only)
- `--tug-base-divider-separator` *(rename from `separator`)*

---

## Unclassified Tokens (6 — require rename for Phase 2 regex compliance)

These tokens exist in the current system and cannot be classified by the Phase 2 regex as written. They require a rename to become classifiable.

| Current Token | Reason Unclassifiable | Rename Target |
|---------------|----------------------|---------------|
| `--tug-base-field-placeholder` | No `-fg-` segment | `--tug-base-field-fg-placeholder` |
| `--tug-base-field-label` | No `-fg-` segment | `--tug-base-field-fg-label` |
| `--tug-base-field-required` | No `-fg-` segment | `--tug-base-field-fg-required` |
| `--tug-base-checkmark` | No `-fg-` or `-icon-` segment | `--tug-base-checkmark-fg` |
| `--tug-base-checkmark-mixed` | No `-fg-` or `-icon-` segment | `--tug-base-checkmark-fg-mixed` |
| `--tug-base-separator` | No `-border-` or `-divider-` segment | `--tug-base-divider-separator` |

Additionally, `--tug-base-field-fg` is classifiable (matches `-fg$`) but is renamed for naming consistency.

---

## Chromatic Tokens (32 total)

Dual-use tokens that are used as both foreground and background depending on context. Explicitly enumerated per Spec S01. These are NOT renamed.

### Accent (3)
- `--tug-base-accent-default`
- `--tug-base-accent-cool-default`
- `--tug-base-accent-subtle`

### Tone — Bare chromatic values (7)
These are the raw chromatic color values. Siblings `tone-*-bg`, `tone-*-fg`, `tone-*-border`, `tone-*-icon` are classified as surface or element, not chromatic.
- `--tug-base-tone-accent`
- `--tug-base-tone-active`
- `--tug-base-tone-agent`
- `--tug-base-tone-caution`
- `--tug-base-tone-danger`
- `--tug-base-tone-data`
- `--tug-base-tone-success`

### Highlight (6)
- `--tug-base-highlight-dropTarget`
- `--tug-base-highlight-flash`
- `--tug-base-highlight-hover`
- `--tug-base-highlight-inspectorTarget`
- `--tug-base-highlight-preview`
- `--tug-base-highlight-snapGuide`

### Overlay (3)
- `--tug-base-overlay-dim`
- `--tug-base-overlay-highlight`
- `--tug-base-overlay-scrim`

### Toggle Track (7)
- `--tug-base-toggle-track-disabled`
- `--tug-base-toggle-track-mixed`
- `--tug-base-toggle-track-mixed-hover`
- `--tug-base-toggle-track-off`
- `--tug-base-toggle-track-off-hover`
- `--tug-base-toggle-track-on`
- `--tug-base-toggle-track-on-hover`

### Toggle Thumb (2)
- `--tug-base-toggle-thumb`
- `--tug-base-toggle-thumb-disabled`

### Radio (1)
- `--tug-base-radio-dot`

### Field Tone (3)
These are chromatic signal values used in field validation UI. Not renamed.
- `--tug-base-field-tone-caution`
- `--tug-base-field-tone-danger`
- `--tug-base-field-tone-success`

---

## Count Verification

| Category | Pre-rename count | Post-rename count |
|----------|-----------------|------------------|
| Non-color | 49 | 49 |
| Surface | 80 | 80 |
| Element | 206 | 212 |
| Chromatic | 32 | 32 |
| Unclassified | 6 | 0 |
| **Total** | **373** | **373** |

Pre-rename: 49 + 80 + 206 + 32 + 6 = 373. ✓
Post-rename: 49 + 80 + 212 + 32 + 0 = 373. ✓

The 6 unclassified tokens become 6 element tokens after rename. Plus `field-fg` → `field-fg-default` adds another element rename, totaling 7 rename candidates from Table T01.
