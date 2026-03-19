/**
 * Authoritative element/surface pairing map — Theme Generator accessibility engine.
 *
 * Declares which element tokens must be contrast-checked against which
 * surface tokens. Derived from component CSS usage across all 23 component CSS
 * files in tugways/ and tugways/cards/ per the Step 2 pairing audit.
 *
 * This map is the single source of truth for contrast validation [D03].
 * Both the derivation engine (auto-adjustment) and the contrast dashboard
 * (display) consume the same map.
 *
 * Role classification follows Table T01 (perceptual contrast thresholds normative, WCAG informational):
 *   "body-text"    — contrast 75 / 4.5:1 WCAG AA (14px / 400wt body text)
 *   "subdued-text" — contrast 45 / 3:1 WCAG AA (intentionally reduced hierarchy: muted/placeholder/read-only)
 *   "large-text"   — contrast 60 / 3:1 WCAG AA (18px+ / 700wt headings or button labels)
 *   "ui-component" — contrast 30 / 3:1 WCAG AA (icons, borders, non-text elements)
 *   "decorative"   — no minimum (structural dividers, decorative accents)
 *
 * @module components/tugways/element-surface-pairing-map
 */

export type ContrastRole =
  | "body-text"
  | "subdued-text"
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
 * that governs minimum contrast requirements. Perceptual contrast is the normative
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
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-app-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-canvas-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-inset-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-content-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-screen-rest",
    role: "body-text",
  },

  // Muted text (secondary text, labels) — subdued-text: intentionally below body-text contrast 75
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-inset-rest",
    role: "subdued-text",
  },

  // Subtle text (tertiary, metadata) — subdued-text: intentionally below body-text contrast 75
  {
    element: "--tug-base-element-global-text-normal-subtle-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-subtle-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-subtle-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-subtle-rest",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "subdued-text",
  },

  // Disabled text — decorative (no minimum requirement)
  {
    element: "--tug-base-element-global-text-normal-plain-disabled",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-global-text-normal-plain-disabled",
    surface: "--tug-base-surface-control-primary-normal-plain-disabled",
    role: "decorative",
  },

  // Inverse text (on dark/accent overlays)
  {
    element: "--tug-base-element-global-text-normal-inverse-rest",
    surface: "--tug-base-surface-global-primary-normal-screen-rest",
    role: "body-text",
  },

  // Placeholder text (form fields) — subdued-text: intentionally below body-text contrast 75
  {
    element: "--tug-base-element-global-text-normal-placeholder-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-placeholder-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-hover",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-placeholder-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-focus",
    role: "subdued-text",
  },

  // Link text
  {
    element: "--tug-base-element-global-text-normal-link-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-link-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-link-rest",
    surface: "--tug-base-surface-global-primary-normal-content-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-link-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-link-hover",
    surface: "--tug-base-surface-global-primary-normal-content-rest",
    role: "body-text",
  },

  // =========================================================================
  // onAccent / onDanger / onWarning / onSuccess — text on semantic backgrounds
  // =========================================================================
  {
    element: "--tug-base-element-global-text-normal-onAccent-rest",
    surface: "--tug-base-element-global-fill-normal-accent-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-global-text-normal-onDanger-rest",
    surface: "--tug-base-element-tone-fill-normal-danger-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-global-text-normal-onCaution-rest",
    surface: "--tug-base-element-tone-fill-normal-caution-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-global-text-normal-onSuccess-rest",
    surface: "--tug-base-element-tone-fill-normal-success-rest",
    role: "large-text",
  },

  // =========================================================================
  // Icon pairings — ui-component role (3:1 WCAG AA)
  // =========================================================================
  {
    element: "--tug-base-element-global-icon-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-icon-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-icon-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-icon-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "ui-component",
  },

  {
    element: "--tug-base-element-global-icon-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-icon-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "ui-component",
  },

  {
    element: "--tug-base-element-global-icon-normal-plain-disabled",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-global-icon-normal-plain-disabled",
    surface: "--tug-base-surface-control-primary-normal-plain-disabled",
    role: "decorative",
  },

  {
    element: "--tug-base-element-global-icon-normal-active-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-icon-normal-active-rest",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "ui-component",
  },

  {
    element: "--tug-base-element-global-icon-normal-onAccent-rest",
    surface: "--tug-base-element-global-fill-normal-accent-rest",
    role: "ui-component",
  },
  // =========================================================================
  // Control — Filled Accent (button labels + icons on filled accent bg)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-filled-accent-rest",
    surface: "--tug-base-surface-control-primary-filled-accent-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-accent-hover",
    surface: "--tug-base-surface-control-primary-filled-accent-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-accent-active",
    surface: "--tug-base-surface-control-primary-filled-accent-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-filled-accent-rest",
    surface: "--tug-base-surface-control-primary-filled-accent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-accent-hover",
    surface: "--tug-base-surface-control-primary-filled-accent-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-accent-active",
    surface: "--tug-base-surface-control-primary-filled-accent-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Active (button labels + icons on filled active bg)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-filled-action-rest",
    surface: "--tug-base-surface-control-primary-filled-action-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-action-hover",
    surface: "--tug-base-surface-control-primary-filled-action-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-action-active",
    surface: "--tug-base-surface-control-primary-filled-action-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-filled-action-rest",
    surface: "--tug-base-surface-control-primary-filled-action-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-action-hover",
    surface: "--tug-base-surface-control-primary-filled-action-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-action-active",
    surface: "--tug-base-surface-control-primary-filled-action-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Danger (button labels + icons on filled danger bg)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-filled-danger-rest",
    surface: "--tug-base-surface-control-primary-filled-danger-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-danger-hover",
    surface: "--tug-base-surface-control-primary-filled-danger-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-danger-active",
    surface: "--tug-base-surface-control-primary-filled-danger-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-filled-danger-rest",
    surface: "--tug-base-surface-control-primary-filled-danger-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-danger-hover",
    surface: "--tug-base-surface-control-primary-filled-danger-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-danger-active",
    surface: "--tug-base-surface-control-primary-filled-danger-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Agent (button labels + icons on filled agent bg)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-filled-agent-rest",
    surface: "--tug-base-surface-control-primary-filled-agent-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-agent-hover",
    surface: "--tug-base-surface-control-primary-filled-agent-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-agent-active",
    surface: "--tug-base-surface-control-primary-filled-agent-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-filled-agent-rest",
    surface: "--tug-base-surface-control-primary-filled-agent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-agent-hover",
    surface: "--tug-base-surface-control-primary-filled-agent-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-agent-active",
    surface: "--tug-base-surface-control-primary-filled-agent-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Data (data/teal bg with light text)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-filled-data-rest",
    surface: "--tug-base-surface-control-primary-filled-data-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-data-hover",
    surface: "--tug-base-surface-control-primary-filled-data-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-data-active",
    surface: "--tug-base-surface-control-primary-filled-data-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-filled-data-rest",
    surface: "--tug-base-surface-control-primary-filled-data-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-data-hover",
    surface: "--tug-base-surface-control-primary-filled-data-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-data-active",
    surface: "--tug-base-surface-control-primary-filled-data-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Success (success/green bg with light text)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-filled-success-rest",
    surface: "--tug-base-surface-control-primary-filled-success-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-success-hover",
    surface: "--tug-base-surface-control-primary-filled-success-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-success-active",
    surface: "--tug-base-surface-control-primary-filled-success-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-filled-success-rest",
    surface: "--tug-base-surface-control-primary-filled-success-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-success-hover",
    surface: "--tug-base-surface-control-primary-filled-success-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-success-active",
    surface: "--tug-base-surface-control-primary-filled-success-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Filled Caution (caution/yellow bg with light text)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-filled-caution-rest",
    surface: "--tug-base-surface-control-primary-filled-caution-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-caution-hover",
    surface: "--tug-base-surface-control-primary-filled-caution-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-filled-caution-active",
    surface: "--tug-base-surface-control-primary-filled-caution-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-filled-caution-rest",
    surface: "--tug-base-surface-control-primary-filled-caution-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-caution-hover",
    surface: "--tug-base-surface-control-primary-filled-caution-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-filled-caution-active",
    surface: "--tug-base-surface-control-primary-filled-caution-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Action (default button style [D04])
  // =========================================================================
  {
    element: "--tug-base-element-control-text-outlined-action-rest",
    surface: "--tug-base-surface-control-primary-outlined-action-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-outlined-action-hover",
    surface: "--tug-base-surface-control-primary-outlined-action-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-outlined-action-active",
    surface: "--tug-base-surface-control-primary-outlined-action-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-outlined-action-rest",
    surface: "--tug-base-surface-control-primary-outlined-action-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-outlined-action-hover",
    surface: "--tug-base-surface-control-primary-outlined-action-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-outlined-action-active",
    surface: "--tug-base-surface-control-primary-outlined-action-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Agent
  // =========================================================================
  {
    element: "--tug-base-element-control-text-outlined-agent-rest",
    surface: "--tug-base-surface-control-primary-outlined-agent-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-outlined-agent-hover",
    surface: "--tug-base-surface-control-primary-outlined-agent-hover",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-outlined-agent-active",
    surface: "--tug-base-surface-control-primary-outlined-agent-active",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-outlined-agent-rest",
    surface: "--tug-base-surface-control-primary-outlined-agent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-outlined-agent-hover",
    surface: "--tug-base-surface-control-primary-outlined-agent-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-outlined-agent-active",
    surface: "--tug-base-surface-control-primary-outlined-agent-active",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Active (fg/icon over surface-default)
  // Ghost bg-rest is transparent; effective background is the parent surface.
  // =========================================================================
  {
    element: "--tug-base-element-control-text-ghost-action-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-ghost-action-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-ghost-action-active",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-ghost-action-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-ghost-action-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-ghost-action-active",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Danger (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-ghost-danger-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-ghost-danger-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-ghost-danger-active",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-ghost-danger-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-ghost-danger-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-ghost-danger-active",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Outlined Option (fg/icon over surface-default; bg-rest transparent)
  // The option role uses a transparent bg-rest so fg/icon are checked against
  // the parent surface. bg-hover/active are semi-transparent overlays (excluded).
  // =========================================================================
  {
    element: "--tug-base-element-control-text-outlined-option-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-outlined-option-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-outlined-option-active",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-outlined-option-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-outlined-option-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-outlined-option-active",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Ghost Option (fg/icon over surface-default; bg-rest transparent)
  // Same pattern as ghost-action: transparent bg-rest, semi-transparent hover/active.
  // =========================================================================
  {
    element: "--tug-base-element-control-text-ghost-option-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-ghost-option-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-text-ghost-option-active",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "large-text",
  },
  {
    element: "--tug-base-element-control-icon-ghost-option-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-ghost-option-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-icon-ghost-option-active",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Control — Selected / Highlighted states
  // =========================================================================
  {
    element: "--tug-base-element-control-text-normal-selected-rest",
    surface: "--tug-base-surface-control-primary-normal-selected-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-control-text-normal-highlighted-rest",
    surface: "--tug-base-surface-control-primary-normal-highlighted-rest",
    role: "body-text",
  },

  // =========================================================================
  // Field tokens — text on field backgrounds
  // =========================================================================
  {
    element: "--tug-base-element-field-text-normal-plain-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-field-text-normal-plain-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-hover",
    role: "body-text",
  },
  {
    element: "--tug-base-element-field-text-normal-plain-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-focus",
    role: "body-text",
  },
  {
    element: "--tug-base-element-field-text-normal-plain-disabled",
    surface: "--tug-base-surface-field-primary-normal-plain-disabled",
    role: "decorative",
  },
  {
    element: "--tug-base-element-field-text-normal-plain-readOnly",
    surface: "--tug-base-surface-field-primary-normal-plain-readOnly",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-field-text-normal-label-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-element-field-text-normal-placeholder-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-field-text-normal-required-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  // =========================================================================
  // Semantic tone — foreground text on tone backgrounds
  // tone-*-bg tokens have alpha 12-15%; parentSurface triggers alpha compositing
  // before contrast measurement so the measured contrast reflects actual rendering
  // (the composited tone-*-bg over surface-default). Spec S02. [D04]
  // =========================================================================
  {
    element: "--tug-base-element-tone-text-normal-success-rest",
    surface: "--tug-base-surface-tone-primary-normal-success-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-text-normal-success-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-text-normal-caution-rest",
    surface: "--tug-base-surface-tone-primary-normal-caution-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-text-normal-caution-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-text-normal-danger-rest",
    surface: "--tug-base-surface-tone-primary-normal-danger-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-text-normal-danger-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-text-normal-accent-rest",
    surface: "--tug-base-surface-tone-primary-normal-accent-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-text-normal-accent-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-text-normal-active-rest",
    surface: "--tug-base-surface-tone-primary-normal-active-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-text-normal-active-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-text-normal-agent-rest",
    surface: "--tug-base-surface-tone-primary-normal-agent-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-text-normal-agent-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-text-normal-data-rest",
    surface: "--tug-base-surface-tone-primary-normal-data-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-text-normal-data-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Semantic tone — icon tokens on surfaces and tone backgrounds
  // =========================================================================
  {
    element: "--tug-base-element-tone-icon-normal-accent-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-accent-rest",
    surface: "--tug-base-surface-tone-primary-normal-accent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-active-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-active-rest",
    surface: "--tug-base-surface-tone-primary-normal-active-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-agent-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-agent-rest",
    surface: "--tug-base-surface-tone-primary-normal-agent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-data-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-data-rest",
    surface: "--tug-base-surface-tone-primary-normal-data-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-success-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-success-rest",
    surface: "--tug-base-surface-tone-primary-normal-success-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-caution-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-caution-rest",
    surface: "--tug-base-surface-tone-primary-normal-caution-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-danger-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-icon-normal-danger-rest",
    surface: "--tug-base-surface-tone-primary-normal-danger-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Accent — decorative (guide lines, underlines, state indicators)
  // =========================================================================
  {
    element: "--tug-base-element-global-fill-normal-accent-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accent-rest",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "ui-component",
  },
  // =========================================================================
  // Selection text on selection background
  // selection-bg has alpha 40%; parentSurface composites it over surface-default
  // before measuring contrast against the opaque selection-fg. Spec S02. [D04]
  // =========================================================================
  {
    element: "--tug-base-element-selection-text-normal-plain-rest",
    surface: "--tug-base-surface-selection-primary-normal-plain-rest",
    role: "body-text",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },

  // =========================================================================
  // Cross-control disabled contract — disabled fg/icon over disabled bg
  // Classified as decorative per WCAG (disabled elements have no requirement)
  // =========================================================================
  {
    element: "--tug-base-element-control-text-normal-plain-disabled",
    surface: "--tug-base-surface-control-primary-normal-plain-disabled",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-icon-normal-plain-disabled",
    surface: "--tug-base-surface-control-primary-normal-plain-disabled",
    role: "decorative",
  },

  // =========================================================================
  // Toggle — thumb and icon tokens on toggle track backgrounds
  // =========================================================================
  {
    element: "--tug-base-element-toggle-thumb-normal-plain-rest",
    surface: "--tug-base-surface-toggle-track-normal-on-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-toggle-thumb-normal-plain-rest",
    surface: "--tug-base-surface-toggle-track-normal-on-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-toggle-thumb-normal-plain-rest",
    surface: "--tug-base-surface-toggle-track-normal-off-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-toggle-thumb-normal-plain-rest",
    surface: "--tug-base-surface-toggle-track-normal-off-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-toggle-thumb-normal-plain-disabled",
    surface: "--tug-base-surface-toggle-track-normal-plain-disabled",
    role: "decorative",
  },
  {
    element: "--tug-base-element-toggle-icon-normal-plain-disabled",
    surface: "--tug-base-surface-toggle-track-normal-plain-disabled",
    role: "decorative",
  },
  {
    element: "--tug-base-element-toggle-icon-normal-plain-mixed",
    surface: "--tug-base-surface-toggle-track-normal-mixed-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-toggle-icon-normal-plain-mixed",
    surface: "--tug-base-surface-toggle-track-normal-mixed-hover",
    role: "ui-component",
  },

  // =========================================================================
  // Checkmark and radio — over control primary / secondary backgrounds
  // =========================================================================
  {
    element: "--tug-base-element-checkmark-icon-normal-plain-rest",
    surface: "--tug-base-surface-control-primary-filled-accent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-checkmark-icon-normal-plain-rest",
    surface: "--tug-base-element-global-fill-normal-accent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-checkmark-icon-normal-plain-mixed",
    surface: "--tug-base-surface-control-primary-outlined-action-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-radio-dot-normal-plain-rest",
    surface: "--tug-base-surface-control-primary-filled-accent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-radio-dot-normal-plain-rest",
    surface: "--tug-base-element-global-fill-normal-accent-rest",
    role: "ui-component",
  },

  // --- Tab Chrome ---
  // tab-fg-rest over tab bar background.
  // The tab bar bg token is tab-bg-inactive (an opaque tinted color); surface-sunken
  // captures the design-intent baseline for detached/collapsed contexts.
  {
    element: "--tug-base-element-tab-text-normal-plain-rest",
    surface: "--tug-base-surface-tab-primary-normal-plain-inactive",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-tab-text-normal-plain-rest",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "subdued-text",
  },
  // tab-fg-active over active tab background
  {
    element: "--tug-base-element-tab-text-normal-plain-active",
    surface: "--tug-base-surface-tab-primary-normal-plain-active",
    role: "body-text",
  },
  // tab-fg-hover over hover highlight (semi-transparent over tab-bg-inactive).
  // Also paired with surface-sunken for the design-intent baseline.
  {
    element: "--tug-base-element-tab-text-normal-plain-hover",
    surface: "--tug-base-surface-tab-primary-normal-plain-inactive",
    role: "body-text",
  },
  {
    element: "--tug-base-element-tab-text-normal-plain-hover",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "body-text",
  },
  // close button hover fg over close bg hover (semi-transparent over tab-bg-inactive).
  {
    element: "--tug-base-element-tabClose-text-normal-plain-hover",
    surface: "--tug-base-surface-tab-primary-normal-plain-inactive",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tabClose-text-normal-plain-hover",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "ui-component",
  },
  // fg-muted over tab bar background (add-tab [+] and overflow trigger text)
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-surface-tab-primary-normal-plain-inactive",
    role: "ui-component",
  },

  // --- Badge Tinted fg on tinted bg ---
  // badge-tinted-*-bg has alpha 15%; parentSurface composites the bg over
  // surface-default before measuring contrast against the opaque fg element. Spec S02. [D04]
  {
    element: "--tug-base-element-badge-text-tinted-accent-rest",
    surface: "--tug-base-surface-badge-primary-tinted-accent-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-text-tinted-action-rest",
    surface: "--tug-base-surface-badge-primary-tinted-action-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-text-tinted-agent-rest",
    surface: "--tug-base-surface-badge-primary-tinted-agent-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-text-tinted-data-rest",
    surface: "--tug-base-surface-badge-primary-tinted-data-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-text-tinted-danger-rest",
    surface: "--tug-base-surface-badge-primary-tinted-danger-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-text-tinted-success-rest",
    surface: "--tug-base-surface-badge-primary-tinted-success-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-text-tinted-caution-rest",
    surface: "--tug-base-surface-badge-primary-tinted-caution-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },

  // --- Badge Tinted border on surface-default --- (Step 4)
  // badge-tinted-*-border has alpha 35%; the border element is composited over
  // surface-default before measuring contrast against surface-default. Spec S02. [D04]
  // These pairs were deferred from Step 3 because they require compositing.
  {
    element: "--tug-base-element-badge-border-tinted-accent-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-border-tinted-action-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-border-tinted-agent-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-border-tinted-data-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-border-tinted-danger-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-border-tinted-success-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-badge-border-tinted-caution-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },

  // =========================================================================
  // Toggle track visibility — track against parent surface (Step 3)
  // Checks whether the toggle track itself is visible against the surface it
  // sits on. "on" and hover states are the primary actionable signals;
  // "off" and "mixed" states are intentionally lower-contrast to signal
  // the inactive/indeterminate state (see KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS).
  // =========================================================================
  {
    element: "--tug-base-surface-toggle-track-normal-on-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-on-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-off-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-off-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-mixed-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-mixed-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-on-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-on-hover",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-off-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-off-hover",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-mixed-hover",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-mixed-hover",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Input field border visibility — 3×3 cross-product (Step 3)
  // A field can render any border state over any bg state as interactions
  // happen (e.g. focus border over hover bg during the transition). All 9
  // combinations are tracked so the pipeline catches any that fall below contrast 30.
  // field-border-rest and field-border-hover are intentionally subtle in dark
  // mode (see KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS); field-border-active uses
  // a vivid accent color that passes contrast 30 across all bg states.
  // =========================================================================
  {
    element: "--tug-base-element-field-border-normal-plain-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-focus",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-hover",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-hover",
    surface: "--tug-base-surface-field-primary-normal-plain-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-hover",
    surface: "--tug-base-surface-field-primary-normal-plain-focus",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-active",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-active",
    surface: "--tug-base-surface-field-primary-normal-plain-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-active",
    surface: "--tug-base-surface-field-primary-normal-plain-focus",
    role: "ui-component",
  },

  // =========================================================================
  // Validation border visibility — border against field-bg-rest (Step 3)
  // Danger and success validation borders use vivid signal colors that pass contrast 30.
  // =========================================================================
  {
    element: "--tug-base-element-field-border-normal-danger-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-field-border-normal-success-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Outlined button border visibility (Step 3)
  // bg-rest is transparent (not in resolved map, so validateThemeContrast skips
  // those pairs); hover and active bg tokens are chromatic and pass contrast 30.
  // =========================================================================
  {
    element: "--tug-base-element-control-border-outlined-action-rest",
    surface: "--tug-base-surface-control-primary-outlined-action-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-border-outlined-action-hover",
    surface: "--tug-base-surface-control-primary-outlined-action-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-border-outlined-action-active",
    surface: "--tug-base-surface-control-primary-outlined-action-active",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-border-outlined-agent-rest",
    surface: "--tug-base-surface-control-primary-outlined-agent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-border-outlined-agent-hover",
    surface: "--tug-base-surface-control-primary-outlined-agent-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-control-border-outlined-agent-active",
    surface: "--tug-base-surface-control-primary-outlined-agent-active",
    role: "ui-component",
  },

  // =========================================================================
  // Separator / divider visibility — border against surface (Step 3)
  // border-default and border-muted are very subtle separators in dark mode;
  // both are below contrast 30 by design (see KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS).
  // =========================================================================
  {
    element: "--tug-base-element-global-border-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-border-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-border-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-border-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Focus indicator pairs — accent-cool-default against all surfaces (Step 5)
  //
  // accent-cool-default (cobalt-intense) is the universal focus ring color.
  // All 9 surfaces that can contain focusable elements are covered with
  // role "ui-component" (contrast 30 threshold). surface-screen is included
  // because tooltips (--tug-tooltip-bg: var(--tug-base-surface-global-primary-normal-screen-rest))
  // can contain focusable elements. [D05]
  //
  // Focused-vs-unfocused state comparison pairs use role "decorative"
  // because perceptual contrast is designed for element-on-area contrast, not border-vs-border
  // comparisons. These pairs are informational only and do not gate the pipeline. [D05]
  // =========================================================================
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-app-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-raised-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-inset-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-content-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-sunken-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-screen-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "ui-component",
  },
  // Focused-vs-unfocused comparisons: informational only (decorative role).
  // Perceptual contrast measures element-on-area contrast; border-vs-border results are
  // unreliable as a gate. These appear in the dashboard for visual review. [D05]
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-element-field-border-normal-plain-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-element-control-border-outlined-action-rest",
    role: "decorative",
  },

  // =========================================================================
  // Step 5 additions — pairings discovered in the Step 2 audit that were
  // absent from the map. Grouped by discovery context.
  // =========================================================================

  // --- Card title bar / tab chrome (tug-card.css, tug-tab.css) ---
  // THE primary gap: .tugcard-title (fg-default) renders on .tugcard-title-bar
  // background (tab-bg-active when card-frame[data-focused="true"]).
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-tab-primary-normal-plain-active",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-tab-primary-normal-plain-inactive",
    role: "body-text",
  },
  {
    element: "--tug-base-element-global-icon-normal-active-rest",
    surface: "--tug-base-surface-tab-primary-normal-plain-active",
    role: "ui-component",
  },
  // fg-subtle used for inactive-state card title-bar icon
  {
    element: "--tug-base-element-global-text-normal-subtle-rest",
    surface: "--tug-base-surface-tab-primary-normal-plain-inactive",
    role: "ui-component",
  },
  // Tab overflow badge: CSS sets color: var(--tug-base-surface-global-primary-normal-default-rest) directly
  // over the accent-default badge background (tug-tab.css:283).
  {
    element: "--tug-base-surface-global-primary-normal-default-rest",
    surface: "--tug-base-element-global-fill-normal-accent-rest",
    role: "ui-component",
  },

  // --- Canvas / preview surfaces (gallery-theme-generator-content.css) ---
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-canvas-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-subtle-rest",
    surface: "--tug-base-surface-global-primary-normal-canvas-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-element-global-text-normal-link-rest",
    surface: "--tug-base-surface-global-primary-normal-canvas-rest",
    role: "body-text",
  },

  // --- Surface inset — subtle text (gallery-popup-button.css) ---
  {
    element: "--tug-base-element-global-text-normal-subtle-rest",
    surface: "--tug-base-surface-global-primary-normal-inset-rest",
    role: "subdued-text",
  },

  // --- Surface control — text (gallery-card.css, gallery-palette-content.css,
  //     tug-tab.css, gallery-theme-generator-content.css) ---
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-control-rest",
    role: "body-text",
  },
  // fg-muted on surface-control: code comment text in code block
  // (tug-code.css: --tug-codeBlock-bg = surface-control)
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-control-rest",
    role: "body-text",
  },

  // --- Accent-subtle as background — active UI states ---
  // fg-onAccent on accent-subtle: active preset button (gtg-preset-btn--active)
  // accent-subtle has alpha 15%; parentSurface composites it over surface-default
  // before contrast measurement. [D04]
  {
    element: "--tug-base-element-global-text-normal-onAccent-rest",
    surface: "--tug-base-element-global-fill-normal-accentSubtle-rest",
    role: "ui-component",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  // fg-default on accent-subtle: menu selected/checked item background
  // accent-subtle has alpha 15%; parentSurface composites over surface-default. [D04]
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-element-global-fill-normal-accentSubtle-rest",
    role: "body-text",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },

  // --- Semantic tone backgrounds as surfaces ---
  // fg-default on tone-caution-bg: autofix suggestion list items (gallery-theme-generator-content.css)
  {
    element: "--tug-base-element-global-text-normal-default-rest",
    surface: "--tug-base-surface-tone-primary-normal-caution-rest",
    role: "body-text",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  // tone-danger (chromatic) as fg on surface-overlay: danger menu item text (tug-menu.css)
  // Classified as body-text: the user must read this label to understand the destructive
  // action; it is readable label text regardless of the chromatic signal intent.
  {
    element: "--tug-base-element-tone-fill-normal-danger-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "body-text",
  },
  // tone-danger (chromatic) as fg on surface-default: ghost/outlined danger badge text (tug-badge.css)
  {
    element: "--tug-base-element-tone-fill-normal-danger-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },

  // --- Checkmark / toggle track pairings (tug-checkbox.css) ---
  // checkmark-fg on toggle-track-on: checkmark icon on checked checkbox background
  {
    element: "--tug-base-element-checkmark-icon-normal-plain-rest",
    surface: "--tug-base-surface-toggle-track-normal-on-rest",
    role: "ui-component",
  },
  // checkmark-fg-mixed on toggle-track-mixed: indeterminate dash on mixed checkbox background
  {
    element: "--tug-base-element-checkmark-icon-normal-plain-mixed",
    surface: "--tug-base-surface-toggle-track-normal-mixed-rest",
    role: "ui-component",
  },

  // --- Dock button badge (tug-dock.css) ---
  // fg-inverse on tone-danger (chromatic): dock notification badge text
  {
    element: "--tug-base-element-global-text-normal-inverse-rest",
    surface: "--tug-base-element-tone-fill-normal-danger-rest",
    role: "ui-component",
  },

  // --- Neutral badge: divider-default used as background (tug-dialog.css) ---
  // divider-default is an element token normally; here it is used as badge-neutral-bg.
  // fg-muted renders over this dual-use surface.
  {
    element: "--tug-base-element-global-text-normal-muted-rest",
    surface: "--tug-base-element-global-divider-normal-default-rest",
    role: "ui-component",
  },

  // --- Dock background = field-bg-focus (tug-dock.css) ---
  // fg-subtle used for dock button icons over the dock background (field-bg-focus)
  {
    element: "--tug-base-element-global-text-normal-subtle-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-focus",
    role: "ui-component",
  },

  // =========================================================================
  // Filled button borders — border on own filled background (Step 6 additions)
  // These borders sit on their own filled bg; the border token is a slightly
  // darker/lighter variant of the fill at the same chromatic hue. The border is
  // a subtle outline accent — decorative. Hover/active variants have inherently
  // low contrast against their bg (same hue, adjacent tone), so they are
  // classified decorative (threshold 15) not ui-component (threshold 30).
  // =========================================================================
  // Filled accent
  {
    element: "--tug-base-element-control-border-filled-accent-rest",
    surface: "--tug-base-surface-control-primary-filled-accent-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-filled-accent-hover",
    surface: "--tug-base-surface-control-primary-filled-accent-hover",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-control-border-filled-accent-active",
    surface: "--tug-base-surface-control-primary-filled-accent-active",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  // Filled action
  {
    element: "--tug-base-element-control-border-filled-action-rest",
    surface: "--tug-base-surface-control-primary-filled-action-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-filled-action-hover",
    surface: "--tug-base-surface-control-primary-filled-action-hover",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-control-border-filled-action-active",
    surface: "--tug-base-surface-control-primary-filled-action-active",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  // Filled danger
  {
    element: "--tug-base-element-control-border-filled-danger-rest",
    surface: "--tug-base-surface-control-primary-filled-danger-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-filled-danger-hover",
    surface: "--tug-base-surface-control-primary-filled-danger-hover",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-control-border-filled-danger-active",
    surface: "--tug-base-surface-control-primary-filled-danger-active",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  // Filled agent
  {
    element: "--tug-base-element-control-border-filled-agent-rest",
    surface: "--tug-base-surface-control-primary-filled-agent-rest",
    role: "decorative",
  },
  // Filled data
  {
    element: "--tug-base-element-control-border-filled-data-rest",
    surface: "--tug-base-surface-control-primary-filled-data-rest",
    role: "decorative",
  },
  // Filled success
  {
    element: "--tug-base-element-control-border-filled-success-rest",
    surface: "--tug-base-surface-control-primary-filled-success-rest",
    role: "decorative",
  },
  // Filled caution
  {
    element: "--tug-base-element-control-border-filled-caution-rest",
    surface: "--tug-base-surface-control-primary-filled-caution-rest",
    role: "decorative",
  },

  // =========================================================================
  // Ghost button fg and border on own ghost backgrounds (Step 6 additions)
  // Ghost bg-rest is transparent; hover/active bg tokens have alpha 10-20%.
  // The resolved contrast against the raw semi-transparent bg is low (< 15) by
  // construction — the actual visual contrast is measured against the composited
  // parent surface (always passing). These pairings are decorative: the bg token
  // documents the rendering surface but does not represent the effective contrast.
  // =========================================================================
  // Ghost action
  {
    element: "--tug-base-element-control-text-ghost-action-rest",
    surface: "--tug-base-surface-control-primary-ghost-action-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-action-rest",
    surface: "--tug-base-surface-control-primary-ghost-action-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-text-ghost-action-hover",
    surface: "--tug-base-surface-control-primary-ghost-action-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-action-hover",
    surface: "--tug-base-surface-control-primary-ghost-action-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-text-ghost-action-active",
    surface: "--tug-base-surface-control-primary-ghost-action-active",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-action-active",
    surface: "--tug-base-surface-control-primary-ghost-action-active",
    role: "decorative",
  },
  // Ghost danger
  {
    element: "--tug-base-element-control-text-ghost-danger-rest",
    surface: "--tug-base-surface-control-primary-ghost-danger-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-danger-rest",
    surface: "--tug-base-surface-control-primary-ghost-danger-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-text-ghost-danger-hover",
    surface: "--tug-base-surface-control-primary-ghost-danger-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-danger-hover",
    surface: "--tug-base-surface-control-primary-ghost-danger-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-text-ghost-danger-active",
    surface: "--tug-base-surface-control-primary-ghost-danger-active",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-danger-active",
    surface: "--tug-base-surface-control-primary-ghost-danger-active",
    role: "decorative",
  },
  // Ghost option
  {
    element: "--tug-base-element-control-text-ghost-option-rest",
    surface: "--tug-base-surface-control-primary-ghost-option-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-option-rest",
    surface: "--tug-base-surface-control-primary-ghost-option-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-text-ghost-option-hover",
    surface: "--tug-base-surface-control-primary-ghost-option-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-option-hover",
    surface: "--tug-base-surface-control-primary-ghost-option-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-text-ghost-option-active",
    surface: "--tug-base-surface-control-primary-ghost-option-active",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-ghost-option-active",
    surface: "--tug-base-surface-control-primary-ghost-option-active",
    role: "decorative",
  },

  // =========================================================================
  // Outlined option button fg and border on own bg (Step 6 additions)
  // bg-rest is transparent; hover/active bg have alpha 10-20% (same as ghost).
  // Same decorative classification rationale as ghost buttons above.
  // =========================================================================
  {
    element: "--tug-base-element-control-text-outlined-option-rest",
    surface: "--tug-base-surface-control-primary-outlined-option-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-outlined-option-rest",
    surface: "--tug-base-surface-control-primary-outlined-option-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-text-outlined-option-hover",
    surface: "--tug-base-surface-control-primary-outlined-option-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-outlined-option-hover",
    surface: "--tug-base-surface-control-primary-outlined-option-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-text-outlined-option-active",
    surface: "--tug-base-surface-control-primary-outlined-option-active",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-border-outlined-option-active",
    surface: "--tug-base-surface-control-primary-outlined-option-active",
    role: "decorative",
  },
  {
    element: "--tug-base-element-control-icon-outlined-option-active",
    surface: "--tug-base-surface-control-primary-outlined-option-active",
    role: "decorative",
  },

  // =========================================================================
  // Tab-specific pairings (Step 6 additions)
  // =========================================================================
  // border-default used as the separator line between inactive tabs
  {
    element: "--tug-base-element-global-border-normal-default-rest",
    surface: "--tug-base-surface-tab-primary-normal-plain-inactive",
    role: "ui-component",
  },
  // Tab hover state — tab-bg-hover has alpha 8%, same semi-transparent pattern
  {
    element: "--tug-base-element-tab-text-normal-plain-hover",
    surface: "--tug-base-surface-tab-primary-normal-plain-hover",
    role: "decorative",
  },
  // Tab close button hover — tab-close-bg-hover has alpha 12%, decorative
  {
    element: "--tug-base-element-tabClose-text-normal-plain-hover",
    surface: "--tug-base-surface-tabClose-primary-normal-plain-hover",
    role: "decorative",
  },
  // Tab bar surface-control: add/overflow buttons and border accents
  {
    element: "--tug-base-element-global-border-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-control-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-global-fill-normal-accent-rest",
    surface: "--tug-base-surface-global-primary-normal-control-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Badge tinted borders on tinted backgrounds (Step 6 additions)
  // The border-* token sits on the tinted bg of each badge variant.
  // =========================================================================
  {
    element: "--tug-base-element-badge-border-tinted-accent-rest",
    surface: "--tug-base-surface-badge-primary-tinted-accent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-badge-border-tinted-action-rest",
    surface: "--tug-base-surface-badge-primary-tinted-action-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-badge-border-tinted-agent-rest",
    surface: "--tug-base-surface-badge-primary-tinted-agent-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-badge-border-tinted-data-rest",
    surface: "--tug-base-surface-badge-primary-tinted-data-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-badge-border-tinted-danger-rest",
    surface: "--tug-base-surface-badge-primary-tinted-danger-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-badge-border-tinted-success-rest",
    surface: "--tug-base-surface-badge-primary-tinted-success-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-badge-border-tinted-caution-rest",
    surface: "--tug-base-surface-badge-primary-tinted-caution-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Tone borders on tone backgrounds (Step 6 additions)
  // tone-*-border sits on the matching tone-*-bg (alpha 12-15%) for tinted
  // badge/chip outlines. The bg token is semi-transparent; parentSurface is
  // set to surface-default for compositing. Role decorative: the border is a
  // subtle tinted halo — visual reinforcement, not a contrast-critical boundary.
  // =========================================================================
  {
    element: "--tug-base-element-tone-border-normal-accent-rest",
    surface: "--tug-base-surface-tone-primary-normal-accent-rest",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-border-normal-active-rest",
    surface: "--tug-base-surface-tone-primary-normal-active-rest",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-border-normal-agent-rest",
    surface: "--tug-base-surface-tone-primary-normal-agent-rest",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-border-normal-data-rest",
    surface: "--tug-base-surface-tone-primary-normal-data-rest",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-border-normal-danger-rest",
    surface: "--tug-base-surface-tone-primary-normal-danger-rest",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-border-normal-success-rest",
    surface: "--tug-base-surface-tone-primary-normal-success-rest",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-tone-border-normal-caution-rest",
    surface: "--tug-base-surface-tone-primary-normal-caution-rest",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },

  // =========================================================================
  // Chromatic tone tokens used as foreground on surface-default (Step 6 additions)
  // Ghost/outlined badge ghost variants use chromatic tone tokens as text/icon color
  // over surface-default (transparent bg over surface-default parent).
  // =========================================================================
  {
    element: "--tug-base-element-global-text-normal-inverse-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-fill-normal-accent-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-fill-normal-data-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-fill-normal-success-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-element-tone-fill-normal-caution-rest",
    surface: "--tug-base-surface-global-primary-normal-default-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Checkbox chromatic self-pairings (Step 6 additions)
  // These are cases where a chromatic toggle-track token is used as both the
  // background-color and border-color of the same rule. The border is a
  // stylistic outline that is the same hue as the fill — decorative.
  // =========================================================================
  {
    element: "--tug-base-surface-toggle-track-normal-on-hover",
    surface: "--tug-base-surface-toggle-track-normal-on-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-mixed-hover",
    surface: "--tug-base-surface-toggle-track-normal-mixed-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-surface-toggle-track-normal-plain-disabled",
    surface: "--tug-base-surface-toggle-track-normal-plain-disabled",
    role: "decorative",
  },

  // =========================================================================
  // Input field border variants on field backgrounds (Step 6 additions)
  // disabled and readOnly borders are intentionally subtle — same structural
  // constraint as field-border-rest/hover (already in KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS
  // in the test). parentSurface set to surface-default so enforceContrastFloor
  // skips these during derivation (they render over a parent surface, not directly
  // composited — the border sits on the field bg which sits on surface-default).
  // =========================================================================
  {
    element: "--tug-base-element-field-border-normal-plain-disabled",
    surface: "--tug-base-surface-field-primary-normal-plain-disabled",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-base-element-field-border-normal-plain-readOnly",
    surface: "--tug-base-surface-field-primary-normal-plain-readOnly",
    role: "decorative",
    parentSurface: "--tug-base-surface-global-primary-normal-default-rest",
  },
  // field-tone-caution used as a subtle warning tint border on the rest-state bg
  {
    element: "--tug-base-element-field-fill-normal-caution-rest",
    surface: "--tug-base-surface-field-primary-normal-plain-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Gallery card surface-control pairings (Step 6 additions)
  // accent-cool-default appears over surface-control in gallery demo areas.
  // border-default on surface-control is already declared in the tab section above.
  // =========================================================================
  {
    element: "--tug-base-element-global-fill-normal-accentCool-rest",
    surface: "--tug-base-surface-global-primary-normal-control-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Additional surface pairings from gallery components (Step 6 additions)
  // =========================================================================
  // border-muted on surface-inset (gallery-popup-button.css)
  {
    element: "--tug-base-element-global-border-normal-muted-rest",
    surface: "--tug-base-surface-global-primary-normal-inset-rest",
    role: "ui-component",
  },
  // border-default on surface-inset (gallery-palette-content.css)
  {
    element: "--tug-base-element-global-border-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-inset-rest",
    role: "ui-component",
  },
  // border-default on bg-canvas (gallery-theme-generator-content.css)
  {
    element: "--tug-base-element-global-border-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-canvas-rest",
    role: "ui-component",
  },
  // border-default on surface-overlay (tug-menu.css dropdown panel border)
  {
    element: "--tug-base-element-global-border-normal-default-rest",
    surface: "--tug-base-surface-global-primary-normal-overlay-rest",
    role: "ui-component",
  },
  // accent-default on accent-subtle (gallery-theme-generator-content.css: mode btn active)
  {
    element: "--tug-base-element-global-fill-normal-accent-rest",
    surface: "--tug-base-element-global-fill-normal-accentSubtle-rest",
    role: "ui-component",
  },

];

