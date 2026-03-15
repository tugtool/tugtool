/**
 * Authoritative element/surface pairing map — Theme Generator accessibility engine.
 *
 * Declares which element tokens must be contrast-checked against which
 * surface tokens. Derived from component CSS usage in tug-button.css,
 * tug-card.css, tug-tab.css, tug-menu.css, tug-dialog.css, and the base
 * token definitions in tug-base.css.
 *
 * This map is the single source of truth for contrast validation [D03].
 * Both the derivation engine (auto-adjustment) and the contrast dashboard
 * (display) consume the same map.
 *
 * Role classification follows Table T01 (Lc thresholds normative, WCAG informational):
 *   "body-text"    — Lc 75 / 4.5:1 WCAG AA (14px / 400wt body text)
 *   "large-text"   — Lc 60 / 3:1 WCAG AA (18px+ / 700wt headings or button labels)
 *   "ui-component" — Lc 30 / 3:1 WCAG AA (icons, borders, non-text elements)
 *   "decorative"   — no minimum (structural dividers, decorative accents)
 *
 * @module components/tugways/element-surface-pairing-map
 */

export type ContrastRole =
  | "body-text"
  | "large-text"
  | "ui-component"
  | "decorative";

export interface ElementSurfacePairing {
  element: string;
  surface: string;
  role: ContrastRole;
  /** Optional parent surface for semi-transparent token compositing (Phase 4). */
  parentSurface?: string;
}

/**
 * Authoritative element/surface pairing map.
 *
 * Each entry declares an element token, a surface token, and the contrast role
 * that governs minimum contrast requirements. Lc (SA98G-based) is the normative
 * gate; WCAG 2.x ratio is retained as informational secondary data.
 *
 * Pairs are sourced from component CSS files and tug-base.css token usage.
 * All token names are CSS custom property names (with the `--` prefix).
 */
export const ELEMENT_SURFACE_PAIRING_MAP: ElementSurfacePairing[] = [
  // =========================================================================
  // Core surface / text pairings
  // Body text on all primary surfaces
  // =========================================================================
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-bg-app",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-bg-canvas",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-surface-raised",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-surface-overlay",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-surface-sunken",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-surface-inset",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-surface-content",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-surface-screen",
    role: "body-text",
  },

  // Muted text (secondary text, labels)
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-raised",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-overlay",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-sunken",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-inset",
    role: "body-text",
  },

  // Subtle text (tertiary, metadata)
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-raised",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-overlay",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-sunken",
    role: "body-text",
  },

  // Disabled text — decorative (no minimum requirement)
  {
    element: "--tug-base-fg-disabled",
    surface: "--tug-base-surface-default",
    role: "decorative",
  },
  {
    element: "--tug-base-fg-disabled",
    surface: "--tug-base-control-disabled-bg",
    role: "decorative",
  },

  // Inverse text (on dark/accent overlays)
  {
    element: "--tug-base-fg-inverse",
    surface: "--tug-base-surface-screen",
    role: "body-text",
  },

  // Placeholder text (form fields)
  {
    element: "--tug-base-fg-placeholder",
    surface: "--tug-base-field-bg-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-placeholder",
    surface: "--tug-base-field-bg-hover",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-placeholder",
    surface: "--tug-base-field-bg-focus",
    role: "body-text",
  },

  // Link text
  {
    element: "--tug-base-fg-link",
    surface: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-link",
    surface: "--tug-base-surface-overlay",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-link",
    surface: "--tug-base-surface-content",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-link-hover",
    surface: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-link-hover",
    surface: "--tug-base-surface-content",
    role: "body-text",
  },

  // =========================================================================
  // onAccent / onDanger / onWarning / onSuccess — text on semantic backgrounds
  // =========================================================================
  {
    element: "--tug-base-fg-onAccent",
    surface: "--tug-base-accent-default",
    role: "large-text",
  },
  {
    element: "--tug-base-fg-onDanger",
    surface: "--tug-base-tone-danger",
    role: "large-text",
  },
  {
    element: "--tug-base-fg-onCaution",
    surface: "--tug-base-tone-caution",
    role: "large-text",
  },
  {
    element: "--tug-base-fg-onSuccess",
    surface: "--tug-base-tone-success",
    role: "large-text",
  },

  // =========================================================================
  // Icon pairings — ui-component role (3:1 WCAG AA)
  // =========================================================================
  {
    element: "--tug-base-icon-default",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-icon-default",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    element: "--tug-base-icon-default",
    surface: "--tug-base-surface-overlay",
    role: "ui-component",
  },
  {
    element: "--tug-base-icon-default",
    surface: "--tug-base-surface-sunken",
    role: "ui-component",
  },

  {
    element: "--tug-base-icon-muted",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-icon-muted",
    surface: "--tug-base-surface-overlay",
    role: "ui-component",
  },

  {
    element: "--tug-base-icon-disabled",
    surface: "--tug-base-surface-default",
    role: "decorative",
  },
  {
    element: "--tug-base-icon-disabled",
    surface: "--tug-base-control-disabled-bg",
    role: "decorative",
  },

  {
    element: "--tug-base-icon-active",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-icon-active",
    surface: "--tug-base-surface-sunken",
    role: "ui-component",
  },

  {
    element: "--tug-base-icon-onAccent",
    surface: "--tug-base-accent-default",
    role: "ui-component",
  },
  // =========================================================================
  // Control — Filled Accent (button labels + icons on filled accent bg)
  // =========================================================================
  {
    element: "--tug-base-control-filled-accent-fg-rest",
    surface: "--tug-base-control-filled-accent-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-accent-fg-hover",
    surface: "--tug-base-control-filled-accent-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-accent-fg-active",
    surface: "--tug-base-control-filled-accent-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-accent-icon-rest",
    surface: "--tug-base-control-filled-accent-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-accent-icon-hover",
    surface: "--tug-base-control-filled-accent-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-accent-icon-active",
    surface: "--tug-base-control-filled-accent-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Active (button labels + icons on filled active bg)
  // =========================================================================
  {
    element: "--tug-base-control-filled-action-fg-rest",
    surface: "--tug-base-control-filled-action-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-action-fg-hover",
    surface: "--tug-base-control-filled-action-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-action-fg-active",
    surface: "--tug-base-control-filled-action-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-action-icon-rest",
    surface: "--tug-base-control-filled-action-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-action-icon-hover",
    surface: "--tug-base-control-filled-action-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-action-icon-active",
    surface: "--tug-base-control-filled-action-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Danger (button labels + icons on filled danger bg)
  // =========================================================================
  {
    element: "--tug-base-control-filled-danger-fg-rest",
    surface: "--tug-base-control-filled-danger-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-danger-fg-hover",
    surface: "--tug-base-control-filled-danger-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-danger-fg-active",
    surface: "--tug-base-control-filled-danger-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-danger-icon-rest",
    surface: "--tug-base-control-filled-danger-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-danger-icon-hover",
    surface: "--tug-base-control-filled-danger-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-danger-icon-active",
    surface: "--tug-base-control-filled-danger-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Agent (button labels + icons on filled agent bg)
  // =========================================================================
  {
    element: "--tug-base-control-filled-agent-fg-rest",
    surface: "--tug-base-control-filled-agent-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-agent-fg-hover",
    surface: "--tug-base-control-filled-agent-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-agent-fg-active",
    surface: "--tug-base-control-filled-agent-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-agent-icon-rest",
    surface: "--tug-base-control-filled-agent-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-agent-icon-hover",
    surface: "--tug-base-control-filled-agent-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-agent-icon-active",
    surface: "--tug-base-control-filled-agent-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Data (data/teal bg with light text)
  // =========================================================================
  {
    element: "--tug-base-control-filled-data-fg-rest",
    surface: "--tug-base-control-filled-data-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-data-fg-hover",
    surface: "--tug-base-control-filled-data-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-data-fg-active",
    surface: "--tug-base-control-filled-data-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-data-icon-rest",
    surface: "--tug-base-control-filled-data-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-data-icon-hover",
    surface: "--tug-base-control-filled-data-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-data-icon-active",
    surface: "--tug-base-control-filled-data-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Success (success/green bg with light text)
  // =========================================================================
  {
    element: "--tug-base-control-filled-success-fg-rest",
    surface: "--tug-base-control-filled-success-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-success-fg-hover",
    surface: "--tug-base-control-filled-success-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-success-fg-active",
    surface: "--tug-base-control-filled-success-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-success-icon-rest",
    surface: "--tug-base-control-filled-success-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-success-icon-hover",
    surface: "--tug-base-control-filled-success-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-success-icon-active",
    surface: "--tug-base-control-filled-success-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Caution (caution/yellow bg with light text)
  // =========================================================================
  {
    element: "--tug-base-control-filled-caution-fg-rest",
    surface: "--tug-base-control-filled-caution-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-caution-fg-hover",
    surface: "--tug-base-control-filled-caution-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-caution-fg-active",
    surface: "--tug-base-control-filled-caution-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-filled-caution-icon-rest",
    surface: "--tug-base-control-filled-caution-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-caution-icon-hover",
    surface: "--tug-base-control-filled-caution-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-filled-caution-icon-active",
    surface: "--tug-base-control-filled-caution-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Action (default button style [D04])
  // =========================================================================
  {
    element: "--tug-base-control-outlined-action-fg-rest",
    surface: "--tug-base-control-outlined-action-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-action-fg-hover",
    surface: "--tug-base-control-outlined-action-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-action-fg-active",
    surface: "--tug-base-control-outlined-action-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-action-icon-rest",
    surface: "--tug-base-control-outlined-action-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-action-icon-hover",
    surface: "--tug-base-control-outlined-action-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-action-icon-active",
    surface: "--tug-base-control-outlined-action-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Agent
  // =========================================================================
  {
    element: "--tug-base-control-outlined-agent-fg-rest",
    surface: "--tug-base-control-outlined-agent-bg-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-agent-fg-hover",
    surface: "--tug-base-control-outlined-agent-bg-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-agent-fg-active",
    surface: "--tug-base-control-outlined-agent-bg-active",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-agent-icon-rest",
    surface: "--tug-base-control-outlined-agent-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-agent-icon-hover",
    surface: "--tug-base-control-outlined-agent-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-agent-icon-active",
    surface: "--tug-base-control-outlined-agent-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Active (fg/icon over surface-default)
  // Ghost bg-rest is transparent; effective background is the parent surface.
  // =========================================================================
  {
    element: "--tug-base-control-ghost-action-fg-rest",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-action-fg-hover",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-action-fg-active",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-action-icon-rest",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-ghost-action-icon-hover",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-ghost-action-icon-active",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Danger (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    element: "--tug-base-control-ghost-danger-fg-rest",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-danger-fg-hover",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-danger-fg-active",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-danger-icon-rest",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-ghost-danger-icon-hover",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-ghost-danger-icon-active",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Option (fg/icon over surface-default; bg-rest transparent)
  // The option role uses a transparent bg-rest so fg/icon are checked against
  // the parent surface. bg-hover/active are semi-transparent overlays (excluded).
  // =========================================================================
  {
    element: "--tug-base-control-outlined-option-fg-rest",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-option-fg-hover",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-option-fg-active",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-outlined-option-icon-rest",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-option-icon-hover",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-option-icon-active",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Option (fg/icon over surface-default; bg-rest transparent)
  // Same pattern as ghost-action: transparent bg-rest, semi-transparent hover/active.
  // =========================================================================
  {
    element: "--tug-base-control-ghost-option-fg-rest",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-option-fg-hover",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-option-fg-active",
    surface: "--tug-base-surface-default",
    role: "large-text",
  },
  {
    element: "--tug-base-control-ghost-option-icon-rest",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-ghost-option-icon-hover",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-ghost-option-icon-active",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Selected / Highlighted states
  // =========================================================================
  {
    element: "--tug-base-control-selected-fg",
    surface: "--tug-base-control-selected-bg",
    role: "body-text",
  },
  {
    element: "--tug-base-control-highlighted-fg",
    surface: "--tug-base-control-highlighted-bg",
    role: "body-text",
  },

  // =========================================================================
  // Field tokens — text on field backgrounds
  // =========================================================================
  {
    element: "--tug-base-field-fg",
    surface: "--tug-base-field-bg-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-field-fg",
    surface: "--tug-base-field-bg-hover",
    role: "body-text",
  },
  {
    element: "--tug-base-field-fg",
    surface: "--tug-base-field-bg-focus",
    role: "body-text",
  },
  {
    element: "--tug-base-field-fg-disabled",
    surface: "--tug-base-field-bg-disabled",
    role: "decorative",
  },
  {
    element: "--tug-base-field-fg-readOnly",
    surface: "--tug-base-field-bg-readOnly",
    role: "body-text",
  },
  {
    element: "--tug-base-field-label",
    surface: "--tug-base-surface-default",
    role: "body-text",
  },
  // =========================================================================
  // Semantic tone — foreground text on tone backgrounds
  // =========================================================================
  {
    element: "--tug-base-tone-success-fg",
    surface: "--tug-base-tone-success-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-success-fg",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-caution-fg",
    surface: "--tug-base-tone-caution-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-caution-fg",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-danger-fg",
    surface: "--tug-base-tone-danger-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-danger-fg",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-accent-fg",
    surface: "--tug-base-tone-accent-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-accent-fg",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-active-fg",
    surface: "--tug-base-tone-active-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-active-fg",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-agent-fg",
    surface: "--tug-base-tone-agent-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-agent-fg",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-data-fg",
    surface: "--tug-base-tone-data-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-data-fg",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Semantic tone — icon tokens on surfaces and tone backgrounds
  // =========================================================================
  {
    element: "--tug-base-tone-accent-icon",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-accent-icon",
    surface: "--tug-base-tone-accent-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-active-icon",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-active-icon",
    surface: "--tug-base-tone-active-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-agent-icon",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-agent-icon",
    surface: "--tug-base-tone-agent-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-data-icon",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-data-icon",
    surface: "--tug-base-tone-data-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-success-icon",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-success-icon",
    surface: "--tug-base-tone-success-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-caution-icon",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-caution-icon",
    surface: "--tug-base-tone-caution-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-danger-icon",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-danger-icon",
    surface: "--tug-base-tone-danger-bg",
    role: "ui-component",
  },

  // =========================================================================
  // Accent — decorative (guide lines, underlines, state indicators)
  // =========================================================================
  {
    element: "--tug-base-accent-default",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-default",
    surface: "--tug-base-surface-sunken",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Selection text on selection background
  // =========================================================================
  {
    element: "--tug-base-selection-fg",
    surface: "--tug-base-selection-bg",
    role: "body-text",
  },

  // =========================================================================
  // Cross-control disabled contract — disabled fg/icon over disabled bg
  // Classified as decorative per WCAG (disabled elements have no requirement)
  // =========================================================================
  {
    element: "--tug-base-control-disabled-fg",
    surface: "--tug-base-control-disabled-bg",
    role: "decorative",
  },
  {
    element: "--tug-base-control-disabled-icon",
    surface: "--tug-base-control-disabled-bg",
    role: "decorative",
  },

  // =========================================================================
  // Toggle — thumb and icon tokens on toggle track backgrounds
  // =========================================================================
  {
    element: "--tug-base-toggle-thumb",
    surface: "--tug-base-toggle-track-on",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-thumb",
    surface: "--tug-base-toggle-track-on-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-thumb",
    surface: "--tug-base-toggle-track-off",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-thumb",
    surface: "--tug-base-toggle-track-off-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-thumb-disabled",
    surface: "--tug-base-toggle-track-disabled",
    role: "decorative",
  },
  {
    element: "--tug-base-toggle-icon-disabled",
    surface: "--tug-base-toggle-track-disabled",
    role: "decorative",
  },
  {
    element: "--tug-base-toggle-icon-mixed",
    surface: "--tug-base-toggle-track-mixed",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-icon-mixed",
    surface: "--tug-base-toggle-track-mixed-hover",
    role: "ui-component",
  },

  // =========================================================================
  // Checkmark and radio — over control primary / secondary backgrounds
  // =========================================================================
  {
    element: "--tug-base-checkmark",
    surface: "--tug-base-control-filled-accent-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-checkmark",
    surface: "--tug-base-accent-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-checkmark-mixed",
    surface: "--tug-base-control-outlined-action-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-radio-dot",
    surface: "--tug-base-control-filled-accent-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-radio-dot",
    surface: "--tug-base-accent-default",
    role: "ui-component",
  },

  // --- Tab Chrome ---
  // tab-fg-rest over tab bar background (surface-sunken)
  {
    element: "--tug-base-tab-fg-rest",
    surface: "--tug-base-surface-sunken",
    role: "body-text",
  },
  // tab-fg-active over active tab background
  {
    element: "--tug-base-tab-fg-active",
    surface: "--tug-base-tab-bg-active",
    role: "body-text",
  },
  // tab-fg-hover over hover highlight (semi-transparent, pair with sunken)
  {
    element: "--tug-base-tab-fg-hover",
    surface: "--tug-base-surface-sunken",
    role: "body-text",
  },
  // close button hover fg over close bg hover
  {
    element: "--tug-base-tab-close-fg-hover",
    surface: "--tug-base-surface-sunken",
    role: "ui-component",
  },

  // --- Badge Tinted ---
  // tinted fg over tinted bg (semi-transparent bg — pair fg against both the
  // tinted bg token and surface-default for accurate contrast measurement)
  {
    element: "--tug-base-badge-tinted-accent-fg",
    surface: "--tug-base-badge-tinted-accent-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-action-fg",
    surface: "--tug-base-badge-tinted-action-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-agent-fg",
    surface: "--tug-base-badge-tinted-agent-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-data-fg",
    surface: "--tug-base-badge-tinted-data-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-danger-fg",
    surface: "--tug-base-badge-tinted-danger-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-success-fg",
    surface: "--tug-base-badge-tinted-success-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-caution-fg",
    surface: "--tug-base-badge-tinted-caution-bg",
    role: "ui-component",
  },

];
