/**
 * seed-rename-map.ts — Complete 373-entry seed map for the Phase 3.5A rename.
 *
 * This file contains SEED_RENAME_MAP, a Record<string, string> mapping every
 * existing --tug-base-{old} short name to its new six-slot (or three-slot for
 * chromatic) short name. Identity mappings (old === new) are used for non-color
 * tokens that are not renamed.
 *
 * Imported by audit-tokens.ts for the rename-map subcommand.
 *
 * Naming conventions:
 *   - Structured element/surface tokens: <plane>-<component>-<emphasis>-<role>-<channel>-<state>
 *       plane: element | surface
 *       component: global | control | tab | tabClose | tone | field | badge | selection | checkmark | toggle
 *       emphasis: normal | filled | outlined | ghost | tinted
 *       role: plain | default | accent | action | option | danger | agent | data | success | caution | ...
 *       channel: text | icon | border | shadow | divider | primary | secondary
 *       state: (omitted for stateless) | rest | hover | active | focus | disabled | readOnly | ...
 *   - Chromatic tokens: chromatic-<component>-<descriptor>
 *   - Non-color tokens: identity mapping (unchanged)
 */

export const SEED_RENAME_MAP: Record<string, string> = {
  // ---------------------------------------------------------------------------
  // SURFACE — global (9 tokens)
  // ---------------------------------------------------------------------------
  "bg-app": "surface-global-normal-app-primary",
  "bg-canvas": "surface-global-normal-canvas-primary",
  "surface-default": "surface-global-normal-default-primary",
  "surface-raised": "surface-global-normal-raised-primary",
  "surface-overlay": "surface-global-normal-overlay-primary",
  "surface-sunken": "surface-global-normal-sunken-primary",
  "surface-inset": "surface-global-normal-inset-primary",
  "surface-content": "surface-global-normal-content-primary",
  "surface-screen": "surface-global-normal-screen-primary",
  "surface-control": "surface-global-normal-control-primary",

  // ---------------------------------------------------------------------------
  // ELEMENT — global text, icon, border, divider, shadow (28 tokens)
  // ---------------------------------------------------------------------------
  "fg-default": "element-global-normal-default-text",
  "fg-muted": "element-global-normal-muted-text",
  "fg-subtle": "element-global-normal-subtle-text",
  "fg-disabled": "element-global-normal-disabled-text",
  "fg-inverse": "element-global-normal-inverse-text",
  "fg-placeholder": "element-global-normal-placeholder-text",
  "fg-link": "element-global-normal-link-text",
  "fg-link-hover": "element-global-normal-linkHover-text",
  "fg-onAccent": "element-global-normal-onAccent-text",
  "fg-onDanger": "element-global-normal-onDanger-text",
  "fg-onSuccess": "element-global-normal-onSuccess-text",
  "fg-onCaution": "element-global-normal-onCaution-text",
  "icon-active": "element-global-normal-active-icon",
  "icon-default": "element-global-normal-default-icon",
  "icon-disabled": "element-global-normal-disabled-icon",
  "icon-muted": "element-global-normal-muted-icon",
  "icon-onAccent": "element-global-normal-onAccent-icon",
  "border-default": "element-global-normal-default-border",
  "border-muted": "element-global-normal-muted-border",
  "border-strong": "element-global-normal-strong-border",
  "border-inverse": "element-global-normal-inverse-border",
  "border-accent": "element-global-normal-accent-border",
  "border-danger": "element-global-normal-danger-border",
  "divider-default": "element-global-normal-default-divider",
  "divider-muted": "element-global-normal-muted-divider",
  "divider-separator": "element-global-normal-separator-divider",
  "shadow-xs": "element-global-normal-plain-shadow-xs",
  "shadow-md": "element-global-normal-plain-shadow-md",
  "shadow-lg": "element-global-normal-plain-shadow-lg",
  "shadow-xl": "element-global-normal-plain-shadow-xl",
  "shadow-overlay": "element-global-normal-overlay-shadow",

  // ---------------------------------------------------------------------------
  // SURFACE — tone (7 tokens)
  // ---------------------------------------------------------------------------
  "tone-accent-bg": "surface-tone-normal-accent-primary",
  "tone-active-bg": "surface-tone-normal-active-primary",
  "tone-agent-bg": "surface-tone-normal-agent-primary",
  "tone-caution-bg": "surface-tone-normal-caution-primary",
  "tone-danger-bg": "surface-tone-normal-danger-primary",
  "tone-data-bg": "surface-tone-normal-data-primary",
  "tone-success-bg": "surface-tone-normal-success-primary",

  // ---------------------------------------------------------------------------
  // ELEMENT — tone (28 tokens: accent, active, agent, caution, danger, data, success × fg/icon/border)
  // ---------------------------------------------------------------------------
  "tone-accent-fg": "element-tone-normal-accent-text",
  "tone-accent-icon": "element-tone-normal-accent-icon",
  "tone-accent-border": "element-tone-normal-accent-border",
  "tone-active-fg": "element-tone-normal-active-text",
  "tone-active-icon": "element-tone-normal-active-icon",
  "tone-active-border": "element-tone-normal-active-border",
  "tone-agent-fg": "element-tone-normal-agent-text",
  "tone-agent-icon": "element-tone-normal-agent-icon",
  "tone-agent-border": "element-tone-normal-agent-border",
  "tone-caution-fg": "element-tone-normal-caution-text",
  "tone-caution-icon": "element-tone-normal-caution-icon",
  "tone-caution-border": "element-tone-normal-caution-border",
  "tone-danger-fg": "element-tone-normal-danger-text",
  "tone-danger-icon": "element-tone-normal-danger-icon",
  "tone-danger-border": "element-tone-normal-danger-border",
  "tone-data-fg": "element-tone-normal-data-text",
  "tone-data-icon": "element-tone-normal-data-icon",
  "tone-data-border": "element-tone-normal-data-border",
  "tone-success-fg": "element-tone-normal-success-text",
  "tone-success-icon": "element-tone-normal-success-icon",
  "tone-success-border": "element-tone-normal-success-border",

  // ---------------------------------------------------------------------------
  // SURFACE — selection (2 tokens)
  // ---------------------------------------------------------------------------
  "selection-bg": "surface-selection-normal-plain-primary",
  "selection-bg-inactive": "surface-selection-normal-plain-primary-inactive",

  // ---------------------------------------------------------------------------
  // ELEMENT — selection (1 token)
  // ---------------------------------------------------------------------------
  "selection-fg": "element-selection-normal-plain-text",

  // ---------------------------------------------------------------------------
  // SURFACE — tab (5 tokens)
  // ---------------------------------------------------------------------------
  "tab-bg-active": "surface-tab-normal-plain-primary-active",
  "tab-bg-collapsed": "surface-tab-normal-plain-primary-collapsed",
  "tab-bg-hover": "surface-tab-normal-plain-primary-hover",
  "tab-bg-inactive": "surface-tab-normal-plain-primary-inactive",
  "tab-close-bg-hover": "surface-tabClose-normal-plain-primary-hover",

  // ---------------------------------------------------------------------------
  // ELEMENT — tab (4 tokens)
  // ---------------------------------------------------------------------------
  "tab-fg-active": "element-tab-normal-plain-text-active",
  "tab-fg-hover": "element-tab-normal-plain-text-hover",
  "tab-fg-rest": "element-tab-normal-plain-text-rest",
  "tab-close-fg-hover": "element-tabClose-normal-plain-text-hover",

  // ---------------------------------------------------------------------------
  // SURFACE — control: disabled, highlighted, selected (5 tokens)
  // ---------------------------------------------------------------------------
  "control-disabled-bg": "surface-control-normal-disabled-primary",
  "control-highlighted-bg": "surface-control-normal-highlighted-primary",
  "control-selected-bg": "surface-control-normal-selected-primary",
  "control-selected-bg-hover": "surface-control-normal-selected-primary-hover",
  "control-selected-disabled-bg": "surface-control-normal-selectedDisabled-primary",

  // ---------------------------------------------------------------------------
  // ELEMENT — control: disabled, highlighted, selected (8 tokens)
  // ---------------------------------------------------------------------------
  "control-disabled-fg": "element-control-normal-disabled-text",
  "control-disabled-icon": "element-control-normal-disabled-icon",
  "control-disabled-border": "element-control-normal-disabled-border",
  "control-disabled-shadow": "element-control-normal-disabled-shadow",
  "control-highlighted-fg": "element-control-normal-highlighted-text",
  "control-highlighted-border": "element-control-normal-highlighted-border",
  "control-selected-fg": "element-control-normal-selected-text",
  "control-selected-border": "element-control-normal-selected-border",

  // ---------------------------------------------------------------------------
  // SURFACE — control-filled (7 roles × 3 states = 21 tokens)
  // Roles: accent, action, agent, caution, danger, data, success
  // ---------------------------------------------------------------------------
  "control-filled-accent-bg-rest": "surface-control-filled-accent-primary-rest",
  "control-filled-accent-bg-hover": "surface-control-filled-accent-primary-hover",
  "control-filled-accent-bg-active": "surface-control-filled-accent-primary-active",
  "control-filled-action-bg-rest": "surface-control-filled-action-primary-rest",
  "control-filled-action-bg-hover": "surface-control-filled-action-primary-hover",
  "control-filled-action-bg-active": "surface-control-filled-action-primary-active",
  "control-filled-agent-bg-rest": "surface-control-filled-agent-primary-rest",
  "control-filled-agent-bg-hover": "surface-control-filled-agent-primary-hover",
  "control-filled-agent-bg-active": "surface-control-filled-agent-primary-active",
  "control-filled-caution-bg-rest": "surface-control-filled-caution-primary-rest",
  "control-filled-caution-bg-hover": "surface-control-filled-caution-primary-hover",
  "control-filled-caution-bg-active": "surface-control-filled-caution-primary-active",
  "control-filled-danger-bg-rest": "surface-control-filled-danger-primary-rest",
  "control-filled-danger-bg-hover": "surface-control-filled-danger-primary-hover",
  "control-filled-danger-bg-active": "surface-control-filled-danger-primary-active",
  "control-filled-data-bg-rest": "surface-control-filled-data-primary-rest",
  "control-filled-data-bg-hover": "surface-control-filled-data-primary-hover",
  "control-filled-data-bg-active": "surface-control-filled-data-primary-active",
  "control-filled-success-bg-rest": "surface-control-filled-success-primary-rest",
  "control-filled-success-bg-hover": "surface-control-filled-success-primary-hover",
  "control-filled-success-bg-active": "surface-control-filled-success-primary-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-filled fg (7 roles × 3 states = 21 tokens)
  // ---------------------------------------------------------------------------
  "control-filled-accent-fg-rest": "element-control-filled-accent-text-rest",
  "control-filled-accent-fg-hover": "element-control-filled-accent-text-hover",
  "control-filled-accent-fg-active": "element-control-filled-accent-text-active",
  "control-filled-action-fg-rest": "element-control-filled-action-text-rest",
  "control-filled-action-fg-hover": "element-control-filled-action-text-hover",
  "control-filled-action-fg-active": "element-control-filled-action-text-active",
  "control-filled-agent-fg-rest": "element-control-filled-agent-text-rest",
  "control-filled-agent-fg-hover": "element-control-filled-agent-text-hover",
  "control-filled-agent-fg-active": "element-control-filled-agent-text-active",
  "control-filled-caution-fg-rest": "element-control-filled-caution-text-rest",
  "control-filled-caution-fg-hover": "element-control-filled-caution-text-hover",
  "control-filled-caution-fg-active": "element-control-filled-caution-text-active",
  "control-filled-danger-fg-rest": "element-control-filled-danger-text-rest",
  "control-filled-danger-fg-hover": "element-control-filled-danger-text-hover",
  "control-filled-danger-fg-active": "element-control-filled-danger-text-active",
  "control-filled-data-fg-rest": "element-control-filled-data-text-rest",
  "control-filled-data-fg-hover": "element-control-filled-data-text-hover",
  "control-filled-data-fg-active": "element-control-filled-data-text-active",
  "control-filled-success-fg-rest": "element-control-filled-success-text-rest",
  "control-filled-success-fg-hover": "element-control-filled-success-text-hover",
  "control-filled-success-fg-active": "element-control-filled-success-text-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-filled icon (7 roles × 3 states = 21 tokens)
  // ---------------------------------------------------------------------------
  "control-filled-accent-icon-rest": "element-control-filled-accent-icon-rest",
  "control-filled-accent-icon-hover": "element-control-filled-accent-icon-hover",
  "control-filled-accent-icon-active": "element-control-filled-accent-icon-active",
  "control-filled-action-icon-rest": "element-control-filled-action-icon-rest",
  "control-filled-action-icon-hover": "element-control-filled-action-icon-hover",
  "control-filled-action-icon-active": "element-control-filled-action-icon-active",
  "control-filled-agent-icon-rest": "element-control-filled-agent-icon-rest",
  "control-filled-agent-icon-hover": "element-control-filled-agent-icon-hover",
  "control-filled-agent-icon-active": "element-control-filled-agent-icon-active",
  "control-filled-caution-icon-rest": "element-control-filled-caution-icon-rest",
  "control-filled-caution-icon-hover": "element-control-filled-caution-icon-hover",
  "control-filled-caution-icon-active": "element-control-filled-caution-icon-active",
  "control-filled-danger-icon-rest": "element-control-filled-danger-icon-rest",
  "control-filled-danger-icon-hover": "element-control-filled-danger-icon-hover",
  "control-filled-danger-icon-active": "element-control-filled-danger-icon-active",
  "control-filled-data-icon-rest": "element-control-filled-data-icon-rest",
  "control-filled-data-icon-hover": "element-control-filled-data-icon-hover",
  "control-filled-data-icon-active": "element-control-filled-data-icon-active",
  "control-filled-success-icon-rest": "element-control-filled-success-icon-rest",
  "control-filled-success-icon-hover": "element-control-filled-success-icon-hover",
  "control-filled-success-icon-active": "element-control-filled-success-icon-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-filled border (7 roles × 3 states = 21 tokens)
  // ---------------------------------------------------------------------------
  "control-filled-accent-border-rest": "element-control-filled-accent-border-rest",
  "control-filled-accent-border-hover": "element-control-filled-accent-border-hover",
  "control-filled-accent-border-active": "element-control-filled-accent-border-active",
  "control-filled-action-border-rest": "element-control-filled-action-border-rest",
  "control-filled-action-border-hover": "element-control-filled-action-border-hover",
  "control-filled-action-border-active": "element-control-filled-action-border-active",
  "control-filled-agent-border-rest": "element-control-filled-agent-border-rest",
  "control-filled-agent-border-hover": "element-control-filled-agent-border-hover",
  "control-filled-agent-border-active": "element-control-filled-agent-border-active",
  "control-filled-caution-border-rest": "element-control-filled-caution-border-rest",
  "control-filled-caution-border-hover": "element-control-filled-caution-border-hover",
  "control-filled-caution-border-active": "element-control-filled-caution-border-active",
  "control-filled-danger-border-rest": "element-control-filled-danger-border-rest",
  "control-filled-danger-border-hover": "element-control-filled-danger-border-hover",
  "control-filled-danger-border-active": "element-control-filled-danger-border-active",
  "control-filled-data-border-rest": "element-control-filled-data-border-rest",
  "control-filled-data-border-hover": "element-control-filled-data-border-hover",
  "control-filled-data-border-active": "element-control-filled-data-border-active",
  "control-filled-success-border-rest": "element-control-filled-success-border-rest",
  "control-filled-success-border-hover": "element-control-filled-success-border-hover",
  "control-filled-success-border-active": "element-control-filled-success-border-active",

  // ---------------------------------------------------------------------------
  // SURFACE — control-outlined (3 roles × 3 states = 9 tokens)
  // Roles: action, option, agent
  // ---------------------------------------------------------------------------
  "control-outlined-action-bg-rest": "surface-control-outlined-action-primary-rest",
  "control-outlined-action-bg-hover": "surface-control-outlined-action-primary-hover",
  "control-outlined-action-bg-active": "surface-control-outlined-action-primary-active",
  "control-outlined-option-bg-rest": "surface-control-outlined-option-primary-rest",
  "control-outlined-option-bg-hover": "surface-control-outlined-option-primary-hover",
  "control-outlined-option-bg-active": "surface-control-outlined-option-primary-active",
  "control-outlined-agent-bg-rest": "surface-control-outlined-agent-primary-rest",
  "control-outlined-agent-bg-hover": "surface-control-outlined-agent-primary-hover",
  "control-outlined-agent-bg-active": "surface-control-outlined-agent-primary-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-outlined fg (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "control-outlined-action-fg-rest": "element-control-outlined-action-text-rest",
  "control-outlined-action-fg-hover": "element-control-outlined-action-text-hover",
  "control-outlined-action-fg-active": "element-control-outlined-action-text-active",
  "control-outlined-option-fg-rest": "element-control-outlined-option-text-rest",
  "control-outlined-option-fg-hover": "element-control-outlined-option-text-hover",
  "control-outlined-option-fg-active": "element-control-outlined-option-text-active",
  "control-outlined-agent-fg-rest": "element-control-outlined-agent-text-rest",
  "control-outlined-agent-fg-hover": "element-control-outlined-agent-text-hover",
  "control-outlined-agent-fg-active": "element-control-outlined-agent-text-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-outlined icon (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "control-outlined-action-icon-rest": "element-control-outlined-action-icon-rest",
  "control-outlined-action-icon-hover": "element-control-outlined-action-icon-hover",
  "control-outlined-action-icon-active": "element-control-outlined-action-icon-active",
  "control-outlined-option-icon-rest": "element-control-outlined-option-icon-rest",
  "control-outlined-option-icon-hover": "element-control-outlined-option-icon-hover",
  "control-outlined-option-icon-active": "element-control-outlined-option-icon-active",
  "control-outlined-agent-icon-rest": "element-control-outlined-agent-icon-rest",
  "control-outlined-agent-icon-hover": "element-control-outlined-agent-icon-hover",
  "control-outlined-agent-icon-active": "element-control-outlined-agent-icon-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-outlined border (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "control-outlined-action-border-rest": "element-control-outlined-action-border-rest",
  "control-outlined-action-border-hover": "element-control-outlined-action-border-hover",
  "control-outlined-action-border-active": "element-control-outlined-action-border-active",
  "control-outlined-option-border-rest": "element-control-outlined-option-border-rest",
  "control-outlined-option-border-hover": "element-control-outlined-option-border-hover",
  "control-outlined-option-border-active": "element-control-outlined-option-border-active",
  "control-outlined-agent-border-rest": "element-control-outlined-agent-border-rest",
  "control-outlined-agent-border-hover": "element-control-outlined-agent-border-hover",
  "control-outlined-agent-border-active": "element-control-outlined-agent-border-active",

  // ---------------------------------------------------------------------------
  // SURFACE — control-ghost (3 roles × 3 states = 9 tokens)
  // Roles: action, option, danger
  // ---------------------------------------------------------------------------
  "control-ghost-action-bg-rest": "surface-control-ghost-action-primary-rest",
  "control-ghost-action-bg-hover": "surface-control-ghost-action-primary-hover",
  "control-ghost-action-bg-active": "surface-control-ghost-action-primary-active",
  "control-ghost-option-bg-rest": "surface-control-ghost-option-primary-rest",
  "control-ghost-option-bg-hover": "surface-control-ghost-option-primary-hover",
  "control-ghost-option-bg-active": "surface-control-ghost-option-primary-active",
  "control-ghost-danger-bg-rest": "surface-control-ghost-danger-primary-rest",
  "control-ghost-danger-bg-hover": "surface-control-ghost-danger-primary-hover",
  "control-ghost-danger-bg-active": "surface-control-ghost-danger-primary-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-ghost fg (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "control-ghost-action-fg-rest": "element-control-ghost-action-text-rest",
  "control-ghost-action-fg-hover": "element-control-ghost-action-text-hover",
  "control-ghost-action-fg-active": "element-control-ghost-action-text-active",
  "control-ghost-option-fg-rest": "element-control-ghost-option-text-rest",
  "control-ghost-option-fg-hover": "element-control-ghost-option-text-hover",
  "control-ghost-option-fg-active": "element-control-ghost-option-text-active",
  "control-ghost-danger-fg-rest": "element-control-ghost-danger-text-rest",
  "control-ghost-danger-fg-hover": "element-control-ghost-danger-text-hover",
  "control-ghost-danger-fg-active": "element-control-ghost-danger-text-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-ghost icon (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "control-ghost-action-icon-rest": "element-control-ghost-action-icon-rest",
  "control-ghost-action-icon-hover": "element-control-ghost-action-icon-hover",
  "control-ghost-action-icon-active": "element-control-ghost-action-icon-active",
  "control-ghost-option-icon-rest": "element-control-ghost-option-icon-rest",
  "control-ghost-option-icon-hover": "element-control-ghost-option-icon-hover",
  "control-ghost-option-icon-active": "element-control-ghost-option-icon-active",
  "control-ghost-danger-icon-rest": "element-control-ghost-danger-icon-rest",
  "control-ghost-danger-icon-hover": "element-control-ghost-danger-icon-hover",
  "control-ghost-danger-icon-active": "element-control-ghost-danger-icon-active",

  // ---------------------------------------------------------------------------
  // ELEMENT — control-ghost border (3 roles × 3 states = 9 tokens)
  // ---------------------------------------------------------------------------
  "control-ghost-action-border-rest": "element-control-ghost-action-border-rest",
  "control-ghost-action-border-hover": "element-control-ghost-action-border-hover",
  "control-ghost-action-border-active": "element-control-ghost-action-border-active",
  "control-ghost-option-border-rest": "element-control-ghost-option-border-rest",
  "control-ghost-option-border-hover": "element-control-ghost-option-border-hover",
  "control-ghost-option-border-active": "element-control-ghost-option-border-active",
  "control-ghost-danger-border-rest": "element-control-ghost-danger-border-rest",
  "control-ghost-danger-border-hover": "element-control-ghost-danger-border-hover",
  "control-ghost-danger-border-active": "element-control-ghost-danger-border-active",

  // ---------------------------------------------------------------------------
  // SURFACE — field (5 tokens)
  // ---------------------------------------------------------------------------
  "field-bg-rest": "surface-field-normal-plain-primary-rest",
  "field-bg-hover": "surface-field-normal-plain-primary-hover",
  "field-bg-focus": "surface-field-normal-plain-primary-focus",
  "field-bg-disabled": "surface-field-normal-plain-primary-disabled",
  "field-bg-readOnly": "surface-field-normal-plain-primary-readOnly",

  // ---------------------------------------------------------------------------
  // ELEMENT — field text (6 tokens)
  // ---------------------------------------------------------------------------
  "field-fg-default": "element-field-normal-plain-text-default",
  "field-fg-disabled": "element-field-normal-plain-text-disabled",
  "field-fg-label": "element-field-normal-plain-text-label",
  "field-fg-placeholder": "element-field-normal-plain-text-placeholder",
  "field-fg-readOnly": "element-field-normal-plain-text-readOnly",
  "field-fg-required": "element-field-normal-plain-text-required",

  // ---------------------------------------------------------------------------
  // ELEMENT — field border (7 tokens)
  // ---------------------------------------------------------------------------
  "field-border-rest": "element-field-normal-plain-border-rest",
  "field-border-hover": "element-field-normal-plain-border-hover",
  "field-border-active": "element-field-normal-plain-border-active",
  "field-border-disabled": "element-field-normal-plain-border-disabled",
  "field-border-readOnly": "element-field-normal-plain-border-readOnly",
  "field-border-danger": "element-field-normal-danger-border",
  "field-border-success": "element-field-normal-success-border",

  // ---------------------------------------------------------------------------
  // SURFACE — badge (7 tokens)
  // Roles: accent, action, agent, caution, danger, data, success
  // ---------------------------------------------------------------------------
  "badge-tinted-accent-bg": "surface-badge-tinted-accent-primary",
  "badge-tinted-action-bg": "surface-badge-tinted-action-primary",
  "badge-tinted-agent-bg": "surface-badge-tinted-agent-primary",
  "badge-tinted-caution-bg": "surface-badge-tinted-caution-primary",
  "badge-tinted-danger-bg": "surface-badge-tinted-danger-primary",
  "badge-tinted-data-bg": "surface-badge-tinted-data-primary",
  "badge-tinted-success-bg": "surface-badge-tinted-success-primary",

  // ---------------------------------------------------------------------------
  // ELEMENT — badge fg (7 tokens)
  // ---------------------------------------------------------------------------
  "badge-tinted-accent-fg": "element-badge-tinted-accent-text",
  "badge-tinted-action-fg": "element-badge-tinted-action-text",
  "badge-tinted-agent-fg": "element-badge-tinted-agent-text",
  "badge-tinted-caution-fg": "element-badge-tinted-caution-text",
  "badge-tinted-danger-fg": "element-badge-tinted-danger-text",
  "badge-tinted-data-fg": "element-badge-tinted-data-text",
  "badge-tinted-success-fg": "element-badge-tinted-success-text",

  // ---------------------------------------------------------------------------
  // ELEMENT — badge border (7 tokens)
  // ---------------------------------------------------------------------------
  "badge-tinted-accent-border": "element-badge-tinted-accent-border",
  "badge-tinted-action-border": "element-badge-tinted-action-border",
  "badge-tinted-agent-border": "element-badge-tinted-agent-border",
  "badge-tinted-caution-border": "element-badge-tinted-caution-border",
  "badge-tinted-danger-border": "element-badge-tinted-danger-border",
  "badge-tinted-data-border": "element-badge-tinted-data-border",
  "badge-tinted-success-border": "element-badge-tinted-success-border",

  // ---------------------------------------------------------------------------
  // ELEMENT — checkmark, toggle (4 tokens)
  // ---------------------------------------------------------------------------
  "checkmark-fg": "element-checkmark-normal-plain-text",
  "checkmark-fg-mixed": "element-checkmark-normal-mixed-text",
  "toggle-icon-disabled": "element-toggle-normal-disabled-icon",
  "toggle-icon-mixed": "element-toggle-normal-mixed-icon",

  // ---------------------------------------------------------------------------
  // CHROMATIC — 32 tokens (three-slot convention: chromatic-<component>-<descriptor>)
  // From Table T01 in the plan
  // ---------------------------------------------------------------------------
  "accent-default": "chromatic-accent-default",
  "accent-cool-default": "chromatic-accent-coolDefault",
  "accent-subtle": "chromatic-accent-subtle",
  "tone-accent": "chromatic-tone-accent",
  "tone-active": "chromatic-tone-active",
  "tone-agent": "chromatic-tone-agent",
  "tone-data": "chromatic-tone-data",
  "tone-success": "chromatic-tone-success",
  "tone-caution": "chromatic-tone-caution",
  "tone-danger": "chromatic-tone-danger",
  "highlight-hover": "chromatic-highlight-hover",
  "highlight-dropTarget": "chromatic-highlight-dropTarget",
  "highlight-preview": "chromatic-highlight-preview",
  "highlight-inspectorTarget": "chromatic-highlight-inspectorTarget",
  "highlight-snapGuide": "chromatic-highlight-snapGuide",
  "highlight-flash": "chromatic-highlight-flash",
  "overlay-dim": "chromatic-overlay-dim",
  "overlay-scrim": "chromatic-overlay-scrim",
  "overlay-highlight": "chromatic-overlay-highlight",
  "toggle-track-off": "chromatic-toggle-trackOff",
  "toggle-track-off-hover": "chromatic-toggle-trackOffHover",
  "toggle-track-on": "chromatic-toggle-trackOn",
  "toggle-track-on-hover": "chromatic-toggle-trackOnHover",
  "toggle-track-disabled": "chromatic-toggle-trackDisabled",
  "toggle-track-mixed": "chromatic-toggle-trackMixed",
  "toggle-track-mixed-hover": "chromatic-toggle-trackMixedHover",
  "toggle-thumb": "chromatic-toggle-thumb",
  "toggle-thumb-disabled": "chromatic-toggle-thumbDisabled",
  "radio-dot": "chromatic-radio-dot",
  "field-tone-danger": "chromatic-field-toneDanger",
  "field-tone-caution": "chromatic-field-toneCaution",
  "field-tone-success": "chromatic-field-toneSuccess",

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
