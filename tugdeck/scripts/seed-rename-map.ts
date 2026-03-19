/**
 * seed-rename-map.ts — Complete 373-entry seed map for Phase 3.5A (post-rename).
 *
 * This file contains SEED_RENAME_MAP, a Record<string, string> mapping every
 * --tug-base-{name} short name to itself. After the Phase 3.5A rename was applied
 * (Step 7), all tokens are now at their final six-slot names. All entries are
 * identity mappings (name === name) confirming rename completion.
 *
 * Imported by audit-tokens.ts for the rename-map subcommand.
 *
 * Naming convention — all structured tokens use the six-slot format:
 *   <plane>-<component>-<constituent>-<emphasis>-<role>-<state>
 *       plane:       element | surface
 *       component:   global | control | tab | tabClose | tone | field | badge | selection | checkmark | toggle | radio | overlay | highlight
 *       constituent: (element) text | icon | border | shadow | divider | fill | thumb | dot
 *                    (surface) primary | track
 *       emphasis:    normal | filled | outlined | ghost | tinted
 *       role:        plain | default | accent | action | option | danger | agent | data | success | caution | ...
 *       state:       rest | hover | active | focus | disabled | readOnly | mixed | inactive | collapsed
 *                    (all tokens have a state; non-interactive and default-state tokens use `rest`)
 *   - Non-color tokens: identity mapping (unchanged)
 */

export const SEED_RENAME_MAP: Record<string, string> = {
  // ---------------------------------------------------------------------------
  // SURFACE — global (10 tokens)
  // ---------------------------------------------------------------------------
  "surface-global-primary-normal-app-rest": "surface-global-primary-normal-app-rest",
  "surface-global-primary-normal-canvas-rest": "surface-global-primary-normal-canvas-rest",
  "surface-global-primary-normal-default-rest": "surface-global-primary-normal-default-rest",
  "surface-global-primary-normal-raised-rest": "surface-global-primary-normal-raised-rest",
  "surface-global-primary-normal-overlay-rest": "surface-global-primary-normal-overlay-rest",
  "surface-global-primary-normal-sunken-rest": "surface-global-primary-normal-sunken-rest",
  "surface-global-primary-normal-inset-rest": "surface-global-primary-normal-inset-rest",
  "surface-global-primary-normal-content-rest": "surface-global-primary-normal-content-rest",
  "surface-global-primary-normal-screen-rest": "surface-global-primary-normal-screen-rest",
  "surface-global-primary-normal-control-rest": "surface-global-primary-normal-control-rest",

  // ---------------------------------------------------------------------------
  // ELEMENT — global text, icon, border, divider, shadow (31 tokens)
  // ---------------------------------------------------------------------------
  "element-global-text-normal-default-rest": "element-global-text-normal-default-rest",
  "element-global-text-normal-muted-rest": "element-global-text-normal-muted-rest",
  "element-global-text-normal-subtle-rest": "element-global-text-normal-subtle-rest",
  "element-global-text-normal-plain-disabled": "element-global-text-normal-plain-disabled",
  "element-global-text-normal-inverse-rest": "element-global-text-normal-inverse-rest",
  "element-global-text-normal-placeholder-rest": "element-global-text-normal-placeholder-rest",
  "element-global-text-normal-link-rest": "element-global-text-normal-link-rest",
  "element-global-text-normal-link-hover": "element-global-text-normal-link-hover",
  "element-global-text-normal-onAccent-rest": "element-global-text-normal-onAccent-rest",
  "element-global-text-normal-onDanger-rest": "element-global-text-normal-onDanger-rest",
  "element-global-text-normal-onSuccess-rest": "element-global-text-normal-onSuccess-rest",
  "element-global-text-normal-onCaution-rest": "element-global-text-normal-onCaution-rest",
  "element-global-icon-normal-active-rest": "element-global-icon-normal-active-rest",
  "element-global-icon-normal-default-rest": "element-global-icon-normal-default-rest",
  "element-global-icon-normal-plain-disabled": "element-global-icon-normal-plain-disabled",
  "element-global-icon-normal-muted-rest": "element-global-icon-normal-muted-rest",
  "element-global-icon-normal-onAccent-rest": "element-global-icon-normal-onAccent-rest",
  "element-global-border-normal-default-rest": "element-global-border-normal-default-rest",
  "element-global-border-normal-muted-rest": "element-global-border-normal-muted-rest",
  "element-global-border-normal-strong-rest": "element-global-border-normal-strong-rest",
  "element-global-border-normal-inverse-rest": "element-global-border-normal-inverse-rest",
  "element-global-border-normal-accent-rest": "element-global-border-normal-accent-rest",
  "element-global-border-normal-danger-rest": "element-global-border-normal-danger-rest",
  "element-global-divider-normal-default-rest": "element-global-divider-normal-default-rest",
  "element-global-divider-normal-muted-rest": "element-global-divider-normal-muted-rest",
  "element-global-divider-normal-separator-rest": "element-global-divider-normal-separator-rest",
  "element-global-shadow-normal-xs-rest": "element-global-shadow-normal-xs-rest",
  "element-global-shadow-normal-md-rest": "element-global-shadow-normal-md-rest",
  "element-global-shadow-normal-lg-rest": "element-global-shadow-normal-lg-rest",
  "element-global-shadow-normal-xl-rest": "element-global-shadow-normal-xl-rest",
  "element-global-shadow-normal-overlay-rest": "element-global-shadow-normal-overlay-rest",

  // ---------------------------------------------------------------------------
  // SURFACE — tone (7 tokens)
  // ---------------------------------------------------------------------------
  "surface-tone-primary-normal-accent-rest": "surface-tone-primary-normal-accent-rest",
  "surface-tone-primary-normal-active-rest": "surface-tone-primary-normal-active-rest",
  "surface-tone-primary-normal-agent-rest": "surface-tone-primary-normal-agent-rest",
  "surface-tone-primary-normal-caution-rest": "surface-tone-primary-normal-caution-rest",
  "surface-tone-primary-normal-danger-rest": "surface-tone-primary-normal-danger-rest",
  "surface-tone-primary-normal-data-rest": "surface-tone-primary-normal-data-rest",
  "surface-tone-primary-normal-success-rest": "surface-tone-primary-normal-success-rest",

  // ---------------------------------------------------------------------------
  // ELEMENT — tone (21 tokens: accent, active, agent, caution, danger, data, success × text/icon/border)
  // ---------------------------------------------------------------------------
  "element-tone-text-normal-accent-rest": "element-tone-text-normal-accent-rest",
  "element-tone-icon-normal-accent-rest": "element-tone-icon-normal-accent-rest",
  "element-tone-border-normal-accent-rest": "element-tone-border-normal-accent-rest",
  "element-tone-text-normal-active-rest": "element-tone-text-normal-active-rest",
  "element-tone-icon-normal-active-rest": "element-tone-icon-normal-active-rest",
  "element-tone-border-normal-active-rest": "element-tone-border-normal-active-rest",
  "element-tone-text-normal-agent-rest": "element-tone-text-normal-agent-rest",
  "element-tone-icon-normal-agent-rest": "element-tone-icon-normal-agent-rest",
  "element-tone-border-normal-agent-rest": "element-tone-border-normal-agent-rest",
  "element-tone-text-normal-caution-rest": "element-tone-text-normal-caution-rest",
  "element-tone-icon-normal-caution-rest": "element-tone-icon-normal-caution-rest",
  "element-tone-border-normal-caution-rest": "element-tone-border-normal-caution-rest",
  "element-tone-text-normal-danger-rest": "element-tone-text-normal-danger-rest",
  "element-tone-icon-normal-danger-rest": "element-tone-icon-normal-danger-rest",
  "element-tone-border-normal-danger-rest": "element-tone-border-normal-danger-rest",
  "element-tone-text-normal-data-rest": "element-tone-text-normal-data-rest",
  "element-tone-icon-normal-data-rest": "element-tone-icon-normal-data-rest",
  "element-tone-border-normal-data-rest": "element-tone-border-normal-data-rest",
  "element-tone-text-normal-success-rest": "element-tone-text-normal-success-rest",
  "element-tone-icon-normal-success-rest": "element-tone-icon-normal-success-rest",
  "element-tone-border-normal-success-rest": "element-tone-border-normal-success-rest",

  // ---------------------------------------------------------------------------
  // SURFACE — selection (2 tokens)
  // ---------------------------------------------------------------------------
  "surface-selection-primary-normal-plain-rest": "surface-selection-primary-normal-plain-rest",
  "surface-selection-primary-normal-plain-inactive": "surface-selection-primary-normal-plain-inactive",

  // ---------------------------------------------------------------------------
  // ELEMENT — selection (1 token)
  // ---------------------------------------------------------------------------
  "element-selection-text-normal-plain-rest": "element-selection-text-normal-plain-rest",

  // ---------------------------------------------------------------------------
  // SURFACE — tab (5 tokens)
  // ---------------------------------------------------------------------------
  "surface-tab-primary-normal-plain-active": "surface-tab-primary-normal-plain-active",
  "surface-tab-primary-normal-plain-collapsed": "surface-tab-primary-normal-plain-collapsed",
  "surface-tab-primary-normal-plain-hover": "surface-tab-primary-normal-plain-hover",
  "surface-tab-primary-normal-plain-inactive": "surface-tab-primary-normal-plain-inactive",
  "surface-tabClose-primary-normal-plain-hover": "surface-tabClose-primary-normal-plain-hover",

  // ---------------------------------------------------------------------------
  // ELEMENT — tab (4 tokens)
  // ---------------------------------------------------------------------------
  "element-tab-text-normal-plain-active": "element-tab-text-normal-plain-active",
  "element-tab-text-normal-plain-hover": "element-tab-text-normal-plain-hover",
  "element-tab-text-normal-plain-rest": "element-tab-text-normal-plain-rest",
  "element-tabClose-text-normal-plain-hover": "element-tabClose-text-normal-plain-hover",

  // ---------------------------------------------------------------------------
  // SURFACE — control: disabled, highlighted, selected (5 tokens)
  // ---------------------------------------------------------------------------
  "surface-control-primary-normal-plain-disabled": "surface-control-primary-normal-plain-disabled",
  "surface-control-primary-normal-highlighted-rest": "surface-control-primary-normal-highlighted-rest",
  "surface-control-primary-normal-selected-rest": "surface-control-primary-normal-selected-rest",
  "surface-control-primary-normal-selected-hover": "surface-control-primary-normal-selected-hover",
  "surface-control-primary-normal-selected-disabled": "surface-control-primary-normal-selected-disabled",

  // ---------------------------------------------------------------------------
  // ELEMENT — control: disabled, highlighted, selected (8 tokens)
  // ---------------------------------------------------------------------------
  "element-control-text-normal-plain-disabled": "element-control-text-normal-plain-disabled",
  "element-control-icon-normal-plain-disabled": "element-control-icon-normal-plain-disabled",
  "element-control-border-normal-plain-disabled": "element-control-border-normal-plain-disabled",
  "element-control-shadow-normal-plain-disabled": "element-control-shadow-normal-plain-disabled",
  "element-control-text-normal-highlighted-rest": "element-control-text-normal-highlighted-rest",
  "element-control-border-normal-highlighted-rest": "element-control-border-normal-highlighted-rest",
  "element-control-text-normal-selected-rest": "element-control-text-normal-selected-rest",
  "element-control-border-normal-selected-rest": "element-control-border-normal-selected-rest",

  // ---------------------------------------------------------------------------
  // SURFACE — control-filled (7 roles × 3 states = 21 tokens)
  // Roles: accent, action, agent, caution, danger, data, success
  // ---------------------------------------------------------------------------
  "surface-control-primary-filled-accent-rest": "surface-control-primary-filled-accent-rest",
  "surface-control-primary-filled-accent-hover": "surface-control-primary-filled-accent-hover",
  "surface-control-primary-filled-accent-active": "surface-control-primary-filled-accent-active",
  "surface-control-primary-filled-action-rest": "surface-control-primary-filled-action-rest",
  "surface-control-primary-filled-action-hover": "surface-control-primary-filled-action-hover",
  "surface-control-primary-filled-action-active": "surface-control-primary-filled-action-active",
  "surface-control-primary-filled-agent-rest": "surface-control-primary-filled-agent-rest",
  "surface-control-primary-filled-agent-hover": "surface-control-primary-filled-agent-hover",
  "surface-control-primary-filled-agent-active": "surface-control-primary-filled-agent-active",
  "surface-control-primary-filled-caution-rest": "surface-control-primary-filled-caution-rest",
  "surface-control-primary-filled-caution-hover": "surface-control-primary-filled-caution-hover",
  "surface-control-primary-filled-caution-active": "surface-control-primary-filled-caution-active",
  "surface-control-primary-filled-danger-rest": "surface-control-primary-filled-danger-rest",
  "surface-control-primary-filled-danger-hover": "surface-control-primary-filled-danger-hover",
  "surface-control-primary-filled-danger-active": "surface-control-primary-filled-danger-active",
  "surface-control-primary-filled-data-rest": "surface-control-primary-filled-data-rest",
  "surface-control-primary-filled-data-hover": "surface-control-primary-filled-data-hover",
  "surface-control-primary-filled-data-active": "surface-control-primary-filled-data-active",
  "surface-control-primary-filled-success-rest": "surface-control-primary-filled-success-rest",
  "surface-control-primary-filled-success-hover": "surface-control-primary-filled-success-hover",
  "surface-control-primary-filled-success-active": "surface-control-primary-filled-success-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-filled text (7 roles × 3 states = 21 tokens)
  // ---------------------------------------------------------------------------
  "element-control-text-filled-accent-rest": "element-control-text-filled-accent-rest",
  "element-control-text-filled-accent-hover": "element-control-text-filled-accent-hover",
  "element-control-text-filled-accent-active": "element-control-text-filled-accent-active",
  "element-control-text-filled-action-rest": "element-control-text-filled-action-rest",
  "element-control-text-filled-action-hover": "element-control-text-filled-action-hover",
  "element-control-text-filled-action-active": "element-control-text-filled-action-active",
  "element-control-text-filled-agent-rest": "element-control-text-filled-agent-rest",
  "element-control-text-filled-agent-hover": "element-control-text-filled-agent-hover",
  "element-control-text-filled-agent-active": "element-control-text-filled-agent-active",
  "element-control-text-filled-caution-rest": "element-control-text-filled-caution-rest",
  "element-control-text-filled-caution-hover": "element-control-text-filled-caution-hover",
  "element-control-text-filled-caution-active": "element-control-text-filled-caution-active",
  "element-control-text-filled-danger-rest": "element-control-text-filled-danger-rest",
  "element-control-text-filled-danger-hover": "element-control-text-filled-danger-hover",
  "element-control-text-filled-danger-active": "element-control-text-filled-danger-active",
  "element-control-text-filled-data-rest": "element-control-text-filled-data-rest",
  "element-control-text-filled-data-hover": "element-control-text-filled-data-hover",
  "element-control-text-filled-data-active": "element-control-text-filled-data-active",
  "element-control-text-filled-success-rest": "element-control-text-filled-success-rest",
  "element-control-text-filled-success-hover": "element-control-text-filled-success-hover",
  "element-control-text-filled-success-active": "element-control-text-filled-success-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-filled icon (7 roles × 3 states = 21 tokens)
  // ---------------------------------------------------------------------------
  "element-control-icon-filled-accent-rest": "element-control-icon-filled-accent-rest",
  "element-control-icon-filled-accent-hover": "element-control-icon-filled-accent-hover",
  "element-control-icon-filled-accent-active": "element-control-icon-filled-accent-active",
  "element-control-icon-filled-action-rest": "element-control-icon-filled-action-rest",
  "element-control-icon-filled-action-hover": "element-control-icon-filled-action-hover",
  "element-control-icon-filled-action-active": "element-control-icon-filled-action-active",
  "element-control-icon-filled-agent-rest": "element-control-icon-filled-agent-rest",
  "element-control-icon-filled-agent-hover": "element-control-icon-filled-agent-hover",
  "element-control-icon-filled-agent-active": "element-control-icon-filled-agent-active",
  "element-control-icon-filled-caution-rest": "element-control-icon-filled-caution-rest",
  "element-control-icon-filled-caution-hover": "element-control-icon-filled-caution-hover",
  "element-control-icon-filled-caution-active": "element-control-icon-filled-caution-active",
  "element-control-icon-filled-danger-rest": "element-control-icon-filled-danger-rest",
  "element-control-icon-filled-danger-hover": "element-control-icon-filled-danger-hover",
  "element-control-icon-filled-danger-active": "element-control-icon-filled-danger-active",
  "element-control-icon-filled-data-rest": "element-control-icon-filled-data-rest",
  "element-control-icon-filled-data-hover": "element-control-icon-filled-data-hover",
  "element-control-icon-filled-data-active": "element-control-icon-filled-data-active",
  "element-control-icon-filled-success-rest": "element-control-icon-filled-success-rest",
  "element-control-icon-filled-success-hover": "element-control-icon-filled-success-hover",
  "element-control-icon-filled-success-active": "element-control-icon-filled-success-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-filled border (7 roles × 3 states = 21 tokens)
  // ---------------------------------------------------------------------------
  "element-control-border-filled-accent-rest": "element-control-border-filled-accent-rest",
  "element-control-border-filled-accent-hover": "element-control-border-filled-accent-hover",
  "element-control-border-filled-accent-active": "element-control-border-filled-accent-active",
  "element-control-border-filled-action-rest": "element-control-border-filled-action-rest",
  "element-control-border-filled-action-hover": "element-control-border-filled-action-hover",
  "element-control-border-filled-action-active": "element-control-border-filled-action-active",
  "element-control-border-filled-agent-rest": "element-control-border-filled-agent-rest",
  "element-control-border-filled-agent-hover": "element-control-border-filled-agent-hover",
  "element-control-border-filled-agent-active": "element-control-border-filled-agent-active",
  "element-control-border-filled-caution-rest": "element-control-border-filled-caution-rest",
  "element-control-border-filled-caution-hover": "element-control-border-filled-caution-hover",
  "element-control-border-filled-caution-active": "element-control-border-filled-caution-active",
  "element-control-border-filled-danger-rest": "element-control-border-filled-danger-rest",
  "element-control-border-filled-danger-hover": "element-control-border-filled-danger-hover",
  "element-control-border-filled-danger-active": "element-control-border-filled-danger-active",
  "element-control-border-filled-data-rest": "element-control-border-filled-data-rest",
  "element-control-border-filled-data-hover": "element-control-border-filled-data-hover",
  "element-control-border-filled-data-active": "element-control-border-filled-data-active",
  "element-control-border-filled-success-rest": "element-control-border-filled-success-rest",
  "element-control-border-filled-success-hover": "element-control-border-filled-success-hover",
  "element-control-border-filled-success-active": "element-control-border-filled-success-active",

  // ---------------------------------------------------------------------------
  // SURFACE — control-outlined (3 roles × 3 states = 9 tokens)
  // Roles: action, option, agent
  // ---------------------------------------------------------------------------
  "surface-control-primary-outlined-action-rest": "surface-control-primary-outlined-action-rest",
  "surface-control-primary-outlined-action-hover": "surface-control-primary-outlined-action-hover",
  "surface-control-primary-outlined-action-active": "surface-control-primary-outlined-action-active",
  "surface-control-primary-outlined-option-rest": "surface-control-primary-outlined-option-rest",
  "surface-control-primary-outlined-option-hover": "surface-control-primary-outlined-option-hover",
  "surface-control-primary-outlined-option-active": "surface-control-primary-outlined-option-active",
  "surface-control-primary-outlined-agent-rest": "surface-control-primary-outlined-agent-rest",
  "surface-control-primary-outlined-agent-hover": "surface-control-primary-outlined-agent-hover",
  "surface-control-primary-outlined-agent-active": "surface-control-primary-outlined-agent-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-outlined text (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "element-control-text-outlined-action-rest": "element-control-text-outlined-action-rest",
  "element-control-text-outlined-action-hover": "element-control-text-outlined-action-hover",
  "element-control-text-outlined-action-active": "element-control-text-outlined-action-active",
  "element-control-text-outlined-option-rest": "element-control-text-outlined-option-rest",
  "element-control-text-outlined-option-hover": "element-control-text-outlined-option-hover",
  "element-control-text-outlined-option-active": "element-control-text-outlined-option-active",
  "element-control-text-outlined-agent-rest": "element-control-text-outlined-agent-rest",
  "element-control-text-outlined-agent-hover": "element-control-text-outlined-agent-hover",
  "element-control-text-outlined-agent-active": "element-control-text-outlined-agent-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-outlined icon (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "element-control-icon-outlined-action-rest": "element-control-icon-outlined-action-rest",
  "element-control-icon-outlined-action-hover": "element-control-icon-outlined-action-hover",
  "element-control-icon-outlined-action-active": "element-control-icon-outlined-action-active",
  "element-control-icon-outlined-option-rest": "element-control-icon-outlined-option-rest",
  "element-control-icon-outlined-option-hover": "element-control-icon-outlined-option-hover",
  "element-control-icon-outlined-option-active": "element-control-icon-outlined-option-active",
  "element-control-icon-outlined-agent-rest": "element-control-icon-outlined-agent-rest",
  "element-control-icon-outlined-agent-hover": "element-control-icon-outlined-agent-hover",
  "element-control-icon-outlined-agent-active": "element-control-icon-outlined-agent-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-outlined border (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "element-control-border-outlined-action-rest": "element-control-border-outlined-action-rest",
  "element-control-border-outlined-action-hover": "element-control-border-outlined-action-hover",
  "element-control-border-outlined-action-active": "element-control-border-outlined-action-active",
  "element-control-border-outlined-option-rest": "element-control-border-outlined-option-rest",
  "element-control-border-outlined-option-hover": "element-control-border-outlined-option-hover",
  "element-control-border-outlined-option-active": "element-control-border-outlined-option-active",
  "element-control-border-outlined-agent-rest": "element-control-border-outlined-agent-rest",
  "element-control-border-outlined-agent-hover": "element-control-border-outlined-agent-hover",
  "element-control-border-outlined-agent-active": "element-control-border-outlined-agent-active",

  // ---------------------------------------------------------------------------
  // SURFACE — control-ghost (3 roles × 3 states = 9 tokens)
  // Roles: action, option, danger
  // ---------------------------------------------------------------------------
  "surface-control-primary-ghost-action-rest": "surface-control-primary-ghost-action-rest",
  "surface-control-primary-ghost-action-hover": "surface-control-primary-ghost-action-hover",
  "surface-control-primary-ghost-action-active": "surface-control-primary-ghost-action-active",
  "surface-control-primary-ghost-option-rest": "surface-control-primary-ghost-option-rest",
  "surface-control-primary-ghost-option-hover": "surface-control-primary-ghost-option-hover",
  "surface-control-primary-ghost-option-active": "surface-control-primary-ghost-option-active",
  "surface-control-primary-ghost-danger-rest": "surface-control-primary-ghost-danger-rest",
  "surface-control-primary-ghost-danger-hover": "surface-control-primary-ghost-danger-hover",
  "surface-control-primary-ghost-danger-active": "surface-control-primary-ghost-danger-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-ghost text (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "element-control-text-ghost-action-rest": "element-control-text-ghost-action-rest",
  "element-control-text-ghost-action-hover": "element-control-text-ghost-action-hover",
  "element-control-text-ghost-action-active": "element-control-text-ghost-action-active",
  "element-control-text-ghost-option-rest": "element-control-text-ghost-option-rest",
  "element-control-text-ghost-option-hover": "element-control-text-ghost-option-hover",
  "element-control-text-ghost-option-active": "element-control-text-ghost-option-active",
  "element-control-text-ghost-danger-rest": "element-control-text-ghost-danger-rest",
  "element-control-text-ghost-danger-hover": "element-control-text-ghost-danger-hover",
  "element-control-text-ghost-danger-active": "element-control-text-ghost-danger-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-ghost icon (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "element-control-icon-ghost-action-rest": "element-control-icon-ghost-action-rest",
  "element-control-icon-ghost-action-hover": "element-control-icon-ghost-action-hover",
  "element-control-icon-ghost-action-active": "element-control-icon-ghost-action-active",
  "element-control-icon-ghost-option-rest": "element-control-icon-ghost-option-rest",
  "element-control-icon-ghost-option-hover": "element-control-icon-ghost-option-hover",
  "element-control-icon-ghost-option-active": "element-control-icon-ghost-option-active",
  "element-control-icon-ghost-danger-rest": "element-control-icon-ghost-danger-rest",
  "element-control-icon-ghost-danger-hover": "element-control-icon-ghost-danger-hover",
  "element-control-icon-ghost-danger-active": "element-control-icon-ghost-danger-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-ghost border (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "element-control-border-ghost-action-rest": "element-control-border-ghost-action-rest",
  "element-control-border-ghost-action-hover": "element-control-border-ghost-action-hover",
  "element-control-border-ghost-action-active": "element-control-border-ghost-action-active",
  "element-control-border-ghost-option-rest": "element-control-border-ghost-option-rest",
  "element-control-border-ghost-option-hover": "element-control-border-ghost-option-hover",
  "element-control-border-ghost-option-active": "element-control-border-ghost-option-active",
  "element-control-border-ghost-danger-rest": "element-control-border-ghost-danger-rest",
  "element-control-border-ghost-danger-hover": "element-control-border-ghost-danger-hover",
  "element-control-border-ghost-danger-active": "element-control-border-ghost-danger-active",

  // ---------------------------------------------------------------------------
  // SURFACE — field (5 tokens)
  // ---------------------------------------------------------------------------
  "surface-field-primary-normal-plain-rest": "surface-field-primary-normal-plain-rest",
  "surface-field-primary-normal-plain-hover": "surface-field-primary-normal-plain-hover",
  "surface-field-primary-normal-plain-focus": "surface-field-primary-normal-plain-focus",
  "surface-field-primary-normal-plain-disabled": "surface-field-primary-normal-plain-disabled",
  "surface-field-primary-normal-plain-readOnly": "surface-field-primary-normal-plain-readOnly",

  // ---------------------------------------------------------------------------
  // ELEMENT — field text (6 tokens)
  // ---------------------------------------------------------------------------
  "element-field-text-normal-plain-rest": "element-field-text-normal-plain-rest",
  "element-field-text-normal-plain-disabled": "element-field-text-normal-plain-disabled",
  "element-field-text-normal-label-rest": "element-field-text-normal-label-rest",
  "element-field-text-normal-placeholder-rest": "element-field-text-normal-placeholder-rest",
  "element-field-text-normal-plain-readOnly": "element-field-text-normal-plain-readOnly",
  "element-field-text-normal-required-rest": "element-field-text-normal-required-rest",

  // ---------------------------------------------------------------------------
  // ELEMENT — field border (7 tokens)
  // ---------------------------------------------------------------------------
  "element-field-border-normal-plain-rest": "element-field-border-normal-plain-rest",
  "element-field-border-normal-plain-hover": "element-field-border-normal-plain-hover",
  "element-field-border-normal-plain-active": "element-field-border-normal-plain-active",
  "element-field-border-normal-plain-disabled": "element-field-border-normal-plain-disabled",
  "element-field-border-normal-plain-readOnly": "element-field-border-normal-plain-readOnly",
  "element-field-border-normal-danger-rest": "element-field-border-normal-danger-rest",
  "element-field-border-normal-success-rest": "element-field-border-normal-success-rest",

  // ---------------------------------------------------------------------------
  // SURFACE — badge (7 tokens)
  // Roles: accent, action, agent, caution, danger, data, success
  // ---------------------------------------------------------------------------
  "surface-badge-primary-tinted-accent-rest": "surface-badge-primary-tinted-accent-rest",
  "surface-badge-primary-tinted-action-rest": "surface-badge-primary-tinted-action-rest",
  "surface-badge-primary-tinted-agent-rest": "surface-badge-primary-tinted-agent-rest",
  "surface-badge-primary-tinted-caution-rest": "surface-badge-primary-tinted-caution-rest",
  "surface-badge-primary-tinted-danger-rest": "surface-badge-primary-tinted-danger-rest",
  "surface-badge-primary-tinted-data-rest": "surface-badge-primary-tinted-data-rest",
  "surface-badge-primary-tinted-success-rest": "surface-badge-primary-tinted-success-rest",

  // ---------------------------------------------------------------------------
  // ELEMENT — badge text (7 tokens)
  // ---------------------------------------------------------------------------
  "element-badge-text-tinted-accent-rest": "element-badge-text-tinted-accent-rest",
  "element-badge-text-tinted-action-rest": "element-badge-text-tinted-action-rest",
  "element-badge-text-tinted-agent-rest": "element-badge-text-tinted-agent-rest",
  "element-badge-text-tinted-caution-rest": "element-badge-text-tinted-caution-rest",
  "element-badge-text-tinted-danger-rest": "element-badge-text-tinted-danger-rest",
  "element-badge-text-tinted-data-rest": "element-badge-text-tinted-data-rest",
  "element-badge-text-tinted-success-rest": "element-badge-text-tinted-success-rest",

  // ---------------------------------------------------------------------------
  // ELEMENT — badge border (7 tokens)
  // ---------------------------------------------------------------------------
  "element-badge-border-tinted-accent-rest": "element-badge-border-tinted-accent-rest",
  "element-badge-border-tinted-action-rest": "element-badge-border-tinted-action-rest",
  "element-badge-border-tinted-agent-rest": "element-badge-border-tinted-agent-rest",
  "element-badge-border-tinted-caution-rest": "element-badge-border-tinted-caution-rest",
  "element-badge-border-tinted-danger-rest": "element-badge-border-tinted-danger-rest",
  "element-badge-border-tinted-data-rest": "element-badge-border-tinted-data-rest",
  "element-badge-border-tinted-success-rest": "element-badge-border-tinted-success-rest",

  // ---------------------------------------------------------------------------
  // ELEMENT — checkmark, toggle (4 tokens)
  // ---------------------------------------------------------------------------
  "element-checkmark-icon-normal-plain-rest": "element-checkmark-icon-normal-plain-rest",
  "element-checkmark-icon-normal-plain-mixed": "element-checkmark-icon-normal-plain-mixed",
  "element-toggle-icon-normal-plain-disabled": "element-toggle-icon-normal-plain-disabled",
  "element-toggle-icon-normal-plain-mixed": "element-toggle-icon-normal-plain-mixed",

  // ---------------------------------------------------------------------------
  // FORMERLY CHROMATIC — 32 tokens (now six-slot convention, identity mappings)
  // All tokens from Table T01 in the plan are now at their final six-slot names.
  // ---------------------------------------------------------------------------
  "element-global-fill-normal-accent-rest": "element-global-fill-normal-accent-rest",
  "element-global-fill-normal-accentCool-rest": "element-global-fill-normal-accentCool-rest",
  "element-global-fill-normal-accentSubtle-rest": "element-global-fill-normal-accentSubtle-rest",
  "element-tone-fill-normal-accent-rest": "element-tone-fill-normal-accent-rest",
  "element-tone-fill-normal-active-rest": "element-tone-fill-normal-active-rest",
  "element-tone-fill-normal-agent-rest": "element-tone-fill-normal-agent-rest",
  "element-tone-fill-normal-data-rest": "element-tone-fill-normal-data-rest",
  "element-tone-fill-normal-success-rest": "element-tone-fill-normal-success-rest",
  "element-tone-fill-normal-caution-rest": "element-tone-fill-normal-caution-rest",
  "element-tone-fill-normal-danger-rest": "element-tone-fill-normal-danger-rest",
  "surface-highlight-primary-normal-hover-rest": "surface-highlight-primary-normal-hover-rest",
  "surface-highlight-primary-normal-dropTarget-rest": "surface-highlight-primary-normal-dropTarget-rest",
  "surface-highlight-primary-normal-preview-rest": "surface-highlight-primary-normal-preview-rest",
  "surface-highlight-primary-normal-inspectorTarget-rest": "surface-highlight-primary-normal-inspectorTarget-rest",
  "surface-highlight-primary-normal-snapGuide-rest": "surface-highlight-primary-normal-snapGuide-rest",
  "surface-highlight-primary-normal-flash-rest": "surface-highlight-primary-normal-flash-rest",
  "surface-overlay-primary-normal-dim-rest": "surface-overlay-primary-normal-dim-rest",
  "surface-overlay-primary-normal-scrim-rest": "surface-overlay-primary-normal-scrim-rest",
  "surface-overlay-primary-normal-highlight-rest": "surface-overlay-primary-normal-highlight-rest",
  "surface-toggle-track-normal-off-rest": "surface-toggle-track-normal-off-rest",
  "surface-toggle-track-normal-off-hover": "surface-toggle-track-normal-off-hover",
  "surface-toggle-track-normal-on-rest": "surface-toggle-track-normal-on-rest",
  "surface-toggle-track-normal-on-hover": "surface-toggle-track-normal-on-hover",
  "surface-toggle-track-normal-plain-disabled": "surface-toggle-track-normal-plain-disabled",
  "surface-toggle-track-normal-mixed-rest": "surface-toggle-track-normal-mixed-rest",
  "surface-toggle-track-normal-mixed-hover": "surface-toggle-track-normal-mixed-hover",
  "element-toggle-thumb-normal-plain-rest": "element-toggle-thumb-normal-plain-rest",
  "element-toggle-thumb-normal-plain-disabled": "element-toggle-thumb-normal-plain-disabled",
  "element-radio-dot-normal-plain-rest": "element-radio-dot-normal-plain-rest",
  "element-field-fill-normal-danger-rest": "element-field-fill-normal-danger-rest",
  "element-field-fill-normal-caution-rest": "element-field-fill-normal-caution-rest",
  "element-field-fill-normal-success-rest": "element-field-fill-normal-success-rest",

  // ---------------------------------------------------------------------------
  // NON-COLOR — identity mappings (48 tokens: unchanged)
  // These tokens are non-color (size, radius, space, font, motion, etc.)
  // and are not renamed in Phase 3.5A.
  // ---------------------------------------------------------------------------
  "motion-duration-fast": "motion-duration-fast",
  "motion-duration-glacial": "motion-duration-glacial",
  "motion-duration-instant": "motion-duration-instant",
  "motion-duration-moderate": "motion-duration-moderate",
  "motion-duration-slow": "motion-duration-slow",
  "motion-easing-enter": "motion-easing-enter",
  "motion-easing-exit": "motion-easing-exit",
  "motion-easing-standard": "motion-easing-standard",
  "space-2xl": "space-2xl",
  "space-2xs": "space-2xs",
  "space-lg": "space-lg",
  "space-md": "space-md",
  "space-sm": "space-sm",
  "space-xl": "space-xl",
  "space-xs": "space-xs",
  "radius-2xl": "radius-2xl",
  "radius-2xs": "radius-2xs",
  "radius-lg": "radius-lg",
  "radius-md": "radius-md",
  "radius-sm": "radius-sm",
  "radius-xl": "radius-xl",
  "radius-xs": "radius-xs",
  "chrome-height": "chrome-height",
  "icon-size-2xs": "icon-size-2xs",
  "icon-size-lg": "icon-size-lg",
  "icon-size-md": "icon-size-md",
  "icon-size-sm": "icon-size-sm",
  "icon-size-xl": "icon-size-xl",
  "icon-size-xs": "icon-size-xs",
  "font-family-mono": "font-family-mono",
  "font-family-sans": "font-family-sans",
  "font-size-2xl": "font-size-2xl",
  "font-size-2xs": "font-size-2xs",
  "font-size-lg": "font-size-lg",
  "font-size-md": "font-size-md",
  "font-size-sm": "font-size-sm",
  "font-size-xl": "font-size-xl",
  "font-size-xs": "font-size-xs",
  "line-height-2xl": "line-height-2xl",
  "line-height-2xs": "line-height-2xs",
  "line-height-lg": "line-height-lg",
  "line-height-md": "line-height-md",
  "line-height-normal": "line-height-normal",
  "line-height-sm": "line-height-sm",
  "line-height-tight": "line-height-tight",
  "line-height-xl": "line-height-xl",
  "line-height-xs": "line-height-xs",
  "control-disabled-opacity": "control-disabled-opacity",
};
