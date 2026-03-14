/**
 * Authoritative fg/bg pairing map — Theme Generator accessibility engine.
 *
 * Declares which foreground tokens must be contrast-checked against which
 * background tokens. Derived from component CSS usage in tug-button.css,
 * tug-card.css, tug-tab.css, tug-menu.css, tug-dialog.css, and the base
 * token definitions in tug-base.css.
 *
 * This map is the single source of truth for contrast validation [D03].
 * Both the derivation engine (auto-adjustment) and the contrast dashboard
 * (display) consume the same map.
 *
 * Role classification follows Table T01:
 *   "body-text"    — 4.5:1 WCAG AA (14px / 400wt body text)
 *   "large-text"   — 3:1 WCAG AA (18px+ / 700wt headings or button labels)
 *   "ui-component" — 3:1 WCAG AA (icons, borders, non-text elements)
 *   "decorative"   — no minimum (structural dividers, decorative accents)
 *
 * @module components/tugways/fg-bg-pairing-map
 */

export type ContrastRole =
  | "body-text"
  | "large-text"
  | "ui-component"
  | "decorative";

export interface FgBgPairing {
  fg: string;
  bg: string;
  role: ContrastRole;
}

/**
 * Authoritative foreground/background pairing map.
 *
 * Each entry declares a fg token, a bg token, and the contrast role
 * that governs minimum contrast requirements for WCAG 2.x / APCA checks.
 *
 * Pairs are sourced from component CSS files and tug-base.css token usage.
 * All token names are CSS custom property names (with the `--` prefix).
 */
export const FG_BG_PAIRING_MAP: FgBgPairing[] = [
  // =========================================================================
  // Core surface / text pairings
  // Body text on all primary surfaces
  // =========================================================================
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-bg-app",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-bg-canvas",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-surface-raised",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-surface-overlay",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-surface-sunken",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-surface-inset",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-surface-content",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-default",
    bg: "--tug-base-surface-screen",
    role: "body-text",
  },

  // Muted text (secondary text, labels)
  {
    fg: "--tug-base-fg-muted",
    bg: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-muted",
    bg: "--tug-base-surface-raised",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-muted",
    bg: "--tug-base-surface-overlay",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-muted",
    bg: "--tug-base-surface-sunken",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-muted",
    bg: "--tug-base-surface-inset",
    role: "body-text",
  },

  // Subtle text (tertiary, metadata)
  {
    fg: "--tug-base-fg-subtle",
    bg: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-subtle",
    bg: "--tug-base-surface-raised",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-subtle",
    bg: "--tug-base-surface-overlay",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-subtle",
    bg: "--tug-base-surface-sunken",
    role: "body-text",
  },

  // Disabled text — decorative (no minimum requirement)
  {
    fg: "--tug-base-fg-disabled",
    bg: "--tug-base-surface-default",
    role: "decorative",
  },
  {
    fg: "--tug-base-fg-disabled",
    bg: "--tug-base-control-disabled-bg",
    role: "decorative",
  },

  // Inverse text (on dark/accent overlays)
  {
    fg: "--tug-base-fg-inverse",
    bg: "--tug-base-surface-screen",
    role: "body-text",
  },

  // Placeholder text (form fields)
  {
    fg: "--tug-base-fg-placeholder",
    bg: "--tug-base-field-bg-rest",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-placeholder",
    bg: "--tug-base-field-bg-hover",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-placeholder",
    bg: "--tug-base-field-bg-focus",
    role: "body-text",
  },

  // Link text
  {
    fg: "--tug-base-fg-link",
    bg: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-link",
    bg: "--tug-base-surface-overlay",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-link",
    bg: "--tug-base-surface-content",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-link-hover",
    bg: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    fg: "--tug-base-fg-link-hover",
    bg: "--tug-base-surface-content",
    role: "body-text",
  },

  // =========================================================================
  // onAccent / onDanger / onWarning / onSuccess — text on semantic backgrounds
  // =========================================================================
  {
    fg: "--tug-base-fg-onAccent",
    bg: "--tug-base-accent-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-fg-onDanger",
    bg: "--tug-base-tone-danger",
    role: "large-text",
  },
  {
    fg: "--tug-base-fg-onCaution",
    bg: "--tug-base-tone-caution",
    role: "large-text",
  },
  {
    fg: "--tug-base-fg-onSuccess",
    bg: "--tug-base-tone-success",
    role: "large-text",
  },

  // =========================================================================
  // Icon pairings — ui-component role (3:1 WCAG AA)
  // =========================================================================
  {
    fg: "--tug-base-icon-default",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-icon-default",
    bg: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    fg: "--tug-base-icon-default",
    bg: "--tug-base-surface-overlay",
    role: "ui-component",
  },
  {
    fg: "--tug-base-icon-default",
    bg: "--tug-base-surface-sunken",
    role: "ui-component",
  },

  {
    fg: "--tug-base-icon-muted",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-icon-muted",
    bg: "--tug-base-surface-overlay",
    role: "ui-component",
  },

  {
    fg: "--tug-base-icon-disabled",
    bg: "--tug-base-surface-default",
    role: "decorative",
  },
  {
    fg: "--tug-base-icon-disabled",
    bg: "--tug-base-control-disabled-bg",
    role: "decorative",
  },

  {
    fg: "--tug-base-icon-active",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-icon-active",
    bg: "--tug-base-surface-sunken",
    role: "ui-component",
  },

  {
    fg: "--tug-base-icon-onAccent",
    bg: "--tug-base-accent-default",
    role: "ui-component",
  },
  // =========================================================================
  // Control — Filled Accent (button labels + icons on filled accent bg)
  // =========================================================================
  {
    fg: "--tug-base-control-filled-accent-fg-rest",
    bg: "--tug-base-control-filled-accent-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-accent-fg-hover",
    bg: "--tug-base-control-filled-accent-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-accent-fg-active",
    bg: "--tug-base-control-filled-accent-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-accent-icon-rest",
    bg: "--tug-base-control-filled-accent-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-accent-icon-hover",
    bg: "--tug-base-control-filled-accent-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-accent-icon-active",
    bg: "--tug-base-control-filled-accent-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Active (button labels + icons on filled active bg)
  // =========================================================================
  {
    fg: "--tug-base-control-filled-action-fg-rest",
    bg: "--tug-base-control-filled-action-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-action-fg-hover",
    bg: "--tug-base-control-filled-action-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-action-fg-active",
    bg: "--tug-base-control-filled-action-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-action-icon-rest",
    bg: "--tug-base-control-filled-action-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-action-icon-hover",
    bg: "--tug-base-control-filled-action-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-action-icon-active",
    bg: "--tug-base-control-filled-action-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Danger (button labels + icons on filled danger bg)
  // =========================================================================
  {
    fg: "--tug-base-control-filled-danger-fg-rest",
    bg: "--tug-base-control-filled-danger-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-danger-fg-hover",
    bg: "--tug-base-control-filled-danger-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-danger-fg-active",
    bg: "--tug-base-control-filled-danger-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-danger-icon-rest",
    bg: "--tug-base-control-filled-danger-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-danger-icon-hover",
    bg: "--tug-base-control-filled-danger-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-danger-icon-active",
    bg: "--tug-base-control-filled-danger-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Agent (button labels + icons on filled agent bg)
  // =========================================================================
  {
    fg: "--tug-base-control-filled-agent-fg-rest",
    bg: "--tug-base-control-filled-agent-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-agent-fg-hover",
    bg: "--tug-base-control-filled-agent-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-agent-fg-active",
    bg: "--tug-base-control-filled-agent-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-agent-icon-rest",
    bg: "--tug-base-control-filled-agent-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-agent-icon-hover",
    bg: "--tug-base-control-filled-agent-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-agent-icon-active",
    bg: "--tug-base-control-filled-agent-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Data (data/teal bg with light text)
  // =========================================================================
  {
    fg: "--tug-base-control-filled-data-fg-rest",
    bg: "--tug-base-control-filled-data-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-data-fg-hover",
    bg: "--tug-base-control-filled-data-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-data-fg-active",
    bg: "--tug-base-control-filled-data-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-data-icon-rest",
    bg: "--tug-base-control-filled-data-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-data-icon-hover",
    bg: "--tug-base-control-filled-data-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-data-icon-active",
    bg: "--tug-base-control-filled-data-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Success (success/green bg with light text)
  // =========================================================================
  {
    fg: "--tug-base-control-filled-success-fg-rest",
    bg: "--tug-base-control-filled-success-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-success-fg-hover",
    bg: "--tug-base-control-filled-success-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-success-fg-active",
    bg: "--tug-base-control-filled-success-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-success-icon-rest",
    bg: "--tug-base-control-filled-success-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-success-icon-hover",
    bg: "--tug-base-control-filled-success-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-success-icon-active",
    bg: "--tug-base-control-filled-success-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Caution (caution/yellow bg with light text)
  // =========================================================================
  {
    fg: "--tug-base-control-filled-caution-fg-rest",
    bg: "--tug-base-control-filled-caution-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-caution-fg-hover",
    bg: "--tug-base-control-filled-caution-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-caution-fg-active",
    bg: "--tug-base-control-filled-caution-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-filled-caution-icon-rest",
    bg: "--tug-base-control-filled-caution-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-caution-icon-hover",
    bg: "--tug-base-control-filled-caution-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-filled-caution-icon-active",
    bg: "--tug-base-control-filled-caution-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Action (default button style [D04])
  // =========================================================================
  {
    fg: "--tug-base-control-outlined-action-fg-rest",
    bg: "--tug-base-control-outlined-action-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-action-fg-hover",
    bg: "--tug-base-control-outlined-action-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-action-fg-active",
    bg: "--tug-base-control-outlined-action-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-action-icon-rest",
    bg: "--tug-base-control-outlined-action-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-outlined-action-icon-hover",
    bg: "--tug-base-control-outlined-action-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-outlined-action-icon-active",
    bg: "--tug-base-control-outlined-action-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Agent
  // =========================================================================
  {
    fg: "--tug-base-control-outlined-agent-fg-rest",
    bg: "--tug-base-control-outlined-agent-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-agent-fg-hover",
    bg: "--tug-base-control-outlined-agent-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-agent-fg-active",
    bg: "--tug-base-control-outlined-agent-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-agent-icon-rest",
    bg: "--tug-base-control-outlined-agent-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-outlined-agent-icon-hover",
    bg: "--tug-base-control-outlined-agent-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-outlined-agent-icon-active",
    bg: "--tug-base-control-outlined-agent-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Active (fg/icon over surface-default)
  // Ghost bg-rest is transparent; effective background is the parent surface.
  // =========================================================================
  {
    fg: "--tug-base-control-ghost-action-fg-rest",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-action-fg-hover",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-action-fg-active",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-action-icon-rest",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-ghost-action-icon-hover",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-ghost-action-icon-active",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Danger (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    fg: "--tug-base-control-ghost-danger-fg-rest",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-danger-fg-hover",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-danger-fg-active",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-danger-icon-rest",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-ghost-danger-icon-hover",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-ghost-danger-icon-active",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Option (fg/icon over surface-default; bg-rest transparent)
  // The option role uses a transparent bg-rest so fg/icon are checked against
  // the parent surface. bg-hover/active are semi-transparent overlays (excluded).
  // =========================================================================
  {
    fg: "--tug-base-control-outlined-option-fg-rest",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-option-fg-hover",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-option-fg-active",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-outlined-option-icon-rest",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-outlined-option-icon-hover",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-outlined-option-icon-active",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Option (fg/icon over surface-default; bg-rest transparent)
  // Same pattern as ghost-action: transparent bg-rest, semi-transparent hover/active.
  // =========================================================================
  {
    fg: "--tug-base-control-ghost-option-fg-rest",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-option-fg-hover",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-option-fg-active",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-option-icon-rest",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-ghost-option-icon-hover",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-ghost-option-icon-active",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Selected / Highlighted states
  // =========================================================================
  {
    fg: "--tug-base-control-selected-fg",
    bg: "--tug-base-control-selected-bg",
    role: "body-text",
  },
  {
    fg: "--tug-base-control-highlighted-fg",
    bg: "--tug-base-control-highlighted-bg",
    role: "body-text",
  },

  // =========================================================================
  // Field tokens — text on field backgrounds
  // =========================================================================
  {
    fg: "--tug-base-field-fg",
    bg: "--tug-base-field-bg-rest",
    role: "body-text",
  },
  {
    fg: "--tug-base-field-fg",
    bg: "--tug-base-field-bg-hover",
    role: "body-text",
  },
  {
    fg: "--tug-base-field-fg",
    bg: "--tug-base-field-bg-focus",
    role: "body-text",
  },
  {
    fg: "--tug-base-field-fg-disabled",
    bg: "--tug-base-field-bg-disabled",
    role: "decorative",
  },
  {
    fg: "--tug-base-field-fg-readOnly",
    bg: "--tug-base-field-bg-readOnly",
    role: "body-text",
  },
  {
    fg: "--tug-base-field-label",
    bg: "--tug-base-surface-default",
    role: "body-text",
  },
  // =========================================================================
  // Semantic tone — foreground text on tone backgrounds
  // =========================================================================
  {
    fg: "--tug-base-tone-success-fg",
    bg: "--tug-base-tone-success-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-success-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-caution-fg",
    bg: "--tug-base-tone-caution-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-caution-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-danger-fg",
    bg: "--tug-base-tone-danger-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-danger-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-accent-fg",
    bg: "--tug-base-tone-accent-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-accent-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-active-fg",
    bg: "--tug-base-tone-active-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-active-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-agent-fg",
    bg: "--tug-base-tone-agent-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-agent-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-data-fg",
    bg: "--tug-base-tone-data-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-data-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Semantic tone — icon tokens on surfaces and tone backgrounds
  // =========================================================================
  {
    fg: "--tug-base-tone-accent-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-accent-icon",
    bg: "--tug-base-tone-accent-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-active-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-active-icon",
    bg: "--tug-base-tone-active-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-agent-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-agent-icon",
    bg: "--tug-base-tone-agent-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-data-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-data-icon",
    bg: "--tug-base-tone-data-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-success-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-success-icon",
    bg: "--tug-base-tone-success-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-caution-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-caution-icon",
    bg: "--tug-base-tone-caution-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-danger-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-danger-icon",
    bg: "--tug-base-tone-danger-bg",
    role: "ui-component",
  },

  // =========================================================================
  // Accent — decorative (guide lines, underlines, state indicators)
  // =========================================================================
  {
    fg: "--tug-base-accent-default",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-accent-default",
    bg: "--tug-base-surface-sunken",
    role: "ui-component",
  },
  {
    fg: "--tug-base-accent-cool-default",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Selection text on selection background
  // =========================================================================
  {
    fg: "--tug-base-selection-fg",
    bg: "--tug-base-selection-bg",
    role: "body-text",
  },

  // =========================================================================
  // Cross-control disabled contract — disabled fg/icon over disabled bg
  // Classified as decorative per WCAG (disabled elements have no requirement)
  // =========================================================================
  {
    fg: "--tug-base-control-disabled-fg",
    bg: "--tug-base-control-disabled-bg",
    role: "decorative",
  },
  {
    fg: "--tug-base-control-disabled-icon",
    bg: "--tug-base-control-disabled-bg",
    role: "decorative",
  },

  // =========================================================================
  // Toggle — thumb and icon tokens on toggle track backgrounds
  // =========================================================================
  {
    fg: "--tug-base-toggle-thumb",
    bg: "--tug-base-toggle-track-on",
    role: "ui-component",
  },
  {
    fg: "--tug-base-toggle-thumb",
    bg: "--tug-base-toggle-track-on-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-toggle-thumb",
    bg: "--tug-base-toggle-track-off",
    role: "ui-component",
  },
  {
    fg: "--tug-base-toggle-thumb",
    bg: "--tug-base-toggle-track-off-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-toggle-thumb-disabled",
    bg: "--tug-base-toggle-track-disabled",
    role: "decorative",
  },
  {
    fg: "--tug-base-toggle-icon-disabled",
    bg: "--tug-base-toggle-track-disabled",
    role: "decorative",
  },
  {
    fg: "--tug-base-toggle-icon-mixed",
    bg: "--tug-base-toggle-track-mixed",
    role: "ui-component",
  },
  {
    fg: "--tug-base-toggle-icon-mixed",
    bg: "--tug-base-toggle-track-mixed-hover",
    role: "ui-component",
  },

  // =========================================================================
  // Checkmark and radio — over control primary / secondary backgrounds
  // =========================================================================
  {
    fg: "--tug-base-checkmark",
    bg: "--tug-base-control-filled-accent-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-checkmark",
    bg: "--tug-base-accent-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-checkmark-mixed",
    bg: "--tug-base-control-outlined-action-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-radio-dot",
    bg: "--tug-base-control-filled-accent-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-radio-dot",
    bg: "--tug-base-accent-default",
    role: "ui-component",
  },

];
