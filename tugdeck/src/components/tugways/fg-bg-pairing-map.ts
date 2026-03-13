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
    fg: "--tug-base-fg-onAccent",
    bg: "--tug-base-accent-strong",
    role: "large-text",
  },
  {
    fg: "--tug-base-fg-onDanger",
    bg: "--tug-base-tone-danger",
    role: "large-text",
  },
  {
    fg: "--tug-base-fg-onWarning",
    bg: "--tug-base-tone-warning",
    role: "large-text",
  },
  {
    fg: "--tug-base-fg-onSuccess",
    bg: "--tug-base-tone-positive",
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
  {
    fg: "--tug-base-icon-onAccent",
    bg: "--tug-base-accent-strong",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Primary variant (button labels + icons on primary bg)
  // =========================================================================
  {
    fg: "--tug-base-control-primary-fg-rest",
    bg: "--tug-base-control-primary-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-primary-fg-hover",
    bg: "--tug-base-control-primary-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-primary-fg-active",
    bg: "--tug-base-control-primary-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-primary-icon-rest",
    bg: "--tug-base-control-primary-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-primary-icon-hover",
    bg: "--tug-base-control-primary-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-primary-icon-active",
    bg: "--tug-base-control-primary-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Secondary variant
  // =========================================================================
  {
    fg: "--tug-base-control-secondary-fg-rest",
    bg: "--tug-base-control-secondary-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-secondary-fg-hover",
    bg: "--tug-base-control-secondary-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-secondary-fg-active",
    bg: "--tug-base-control-secondary-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-secondary-icon-rest",
    bg: "--tug-base-control-secondary-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-secondary-icon-hover",
    bg: "--tug-base-control-secondary-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-secondary-icon-active",
    bg: "--tug-base-control-secondary-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost variant (fg/icon over surface-default, not ghost-bg-rest)
  // Ghost bg-rest is transparent; effective background is the parent surface.
  // =========================================================================
  {
    fg: "--tug-base-control-ghost-fg-rest",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-fg-hover",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-fg-active",
    bg: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-ghost-icon-rest",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-ghost-icon-hover",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-ghost-icon-active",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Destructive variant
  // =========================================================================
  {
    fg: "--tug-base-control-destructive-fg-rest",
    bg: "--tug-base-control-destructive-bg-rest",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-destructive-fg-hover",
    bg: "--tug-base-control-destructive-bg-hover",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-destructive-fg-active",
    bg: "--tug-base-control-destructive-bg-active",
    role: "large-text",
  },
  {
    fg: "--tug-base-control-destructive-icon-rest",
    bg: "--tug-base-control-destructive-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-destructive-icon-hover",
    bg: "--tug-base-control-destructive-bg-hover",
    role: "ui-component",
  },
  {
    fg: "--tug-base-control-destructive-icon-active",
    bg: "--tug-base-control-destructive-bg-active",
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
  {
    fg: "--tug-base-field-helper",
    bg: "--tug-base-surface-default",
    role: "body-text",
  },

  // =========================================================================
  // Semantic tone — foreground text on tone backgrounds
  // =========================================================================
  {
    fg: "--tug-base-tone-positive-fg",
    bg: "--tug-base-tone-positive-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-positive-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-warning-fg",
    bg: "--tug-base-tone-warning-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-warning-fg",
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
    fg: "--tug-base-tone-info-fg",
    bg: "--tug-base-tone-info-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-info-fg",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Semantic tone — icon tokens on surfaces and tone backgrounds
  // =========================================================================
  {
    fg: "--tug-base-tone-positive-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-positive-icon",
    bg: "--tug-base-tone-positive-bg",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-warning-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-warning-icon",
    bg: "--tug-base-tone-warning-bg",
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
  {
    fg: "--tug-base-tone-info-icon",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-tone-info-icon",
    bg: "--tug-base-tone-info-bg",
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
    fg: "--tug-base-accent-default",
    bg: "--tug-base-accent-bg-subtle",
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
  // Avatar — text on avatar background
  // =========================================================================
  {
    fg: "--tug-base-avatar-fg",
    bg: "--tug-base-avatar-bg",
    role: "ui-component",
  },

  // =========================================================================
  // Scrollbar — thumb on track (decorative)
  // =========================================================================
  {
    fg: "--tug-base-scrollbar-thumb",
    bg: "--tug-base-bg-app",
    role: "decorative",
  },
  {
    fg: "--tug-base-scrollbar-thumb-hover",
    bg: "--tug-base-bg-app",
    role: "decorative",
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
    bg: "--tug-base-toggle-track-off",
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

  // =========================================================================
  // Checkmark and radio — over control primary / secondary backgrounds
  // =========================================================================
  {
    fg: "--tug-base-checkmark",
    bg: "--tug-base-control-primary-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-checkmark",
    bg: "--tug-base-accent-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-checkmark-mixed",
    bg: "--tug-base-control-secondary-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-radio-dot",
    bg: "--tug-base-control-primary-bg-rest",
    role: "ui-component",
  },
  {
    fg: "--tug-base-radio-dot",
    bg: "--tug-base-accent-default",
    role: "ui-component",
  },

  // =========================================================================
  // Range — thumb and value label over track/fill and surface
  // =========================================================================
  {
    fg: "--tug-base-range-thumb",
    bg: "--tug-base-range-fill",
    role: "ui-component",
  },
  {
    fg: "--tug-base-range-thumb",
    bg: "--tug-base-range-track",
    role: "ui-component",
  },
  {
    fg: "--tug-base-range-thumb",
    bg: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    fg: "--tug-base-range-thumb-disabled",
    bg: "--tug-base-surface-default",
    role: "decorative",
  },
  {
    fg: "--tug-base-range-value",
    bg: "--tug-base-surface-default",
    role: "body-text",
  },
];
