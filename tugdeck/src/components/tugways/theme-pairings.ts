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
 * Role classification follows semantic text types (Table T02, perceptual contrast thresholds normative, WCAG informational):
 *   "content"       — contrast 75 / 4.5:1 WCAG AA (prose, body text, descriptions)
 *   "control"       — contrast 60 / 3:1 WCAG AA (interactive element labels, icons, borders)
 *   "display"       — contrast 60 / 3:1 WCAG AA (titles, headers, emphasis)
 *   "informational" — contrast 60 / 3:1 WCAG AA (status, metadata, secondary/muted text)
 *   "decorative"    — no minimum (structural dividers, decorative accents)
 *
 * @module components/tugways/theme-pairings
 */

export type ContrastRole =
  | "content"
  | "control"
  | "display"
  | "informational"
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
  // Canvas grid line — decorative stroke on canvas surface
  // =========================================================================
  {
    // grid-rest is a derived token used as a background-image stroke (barely visible grid)
    // drawn over the canvas surface. Role is "decorative" — no contrast minimum.
    element: "--tug-surface-global-primary-normal-grid-rest",
    surface: "--tug-surface-global-primary-normal-canvas-rest",
    role: "decorative",
  },
  // =========================================================================
  // Core surface / text pairings
  // Body text on all primary surfaces
  // =========================================================================
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-app-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-canvas-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-inset-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-content-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-screen-rest",
    role: "content",
  },

  // Muted text (secondary text, labels) — informational: muted/metadata text
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-inset-rest",
    role: "informational",
  },

  // Subtle text (tertiary, metadata) — informational: muted/metadata text
  {
    element: "--tug-element-global-text-normal-subtle-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-subtle-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-subtle-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-subtle-rest",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "informational",
  },

  // Disabled text — decorative (no minimum requirement)
  {
    element: "--tug-element-global-text-normal-plain-disabled",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-global-text-normal-plain-disabled",
    surface: "--tug-surface-control-primary-normal-plain-disabled",
    role: "decorative",
  },

  // Inverse text (on dark/accent overlays)
  {
    element: "--tug-element-global-text-normal-inverse-rest",
    surface: "--tug-surface-global-primary-normal-screen-rest",
    role: "content",
  },

  // Placeholder text (form fields) — informational: secondary/metadata text in form fields
  {
    element: "--tug-element-global-text-normal-placeholder-rest",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-placeholder-rest",
    surface: "--tug-surface-field-primary-normal-plain-hover",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-placeholder-rest",
    surface: "--tug-surface-field-primary-normal-plain-focus",
    role: "informational",
  },

  // Link text
  {
    element: "--tug-element-global-text-normal-link-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-link-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-link-rest",
    surface: "--tug-surface-global-primary-normal-content-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-link-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-link-hover",
    surface: "--tug-surface-global-primary-normal-content-rest",
    role: "content",
  },

  // =========================================================================
  // onAccent / onDanger / onWarning / onSuccess — text on semantic backgrounds
  // =========================================================================
  {
    element: "--tug-element-global-text-normal-onAccent-rest",
    surface: "--tug-element-global-fill-normal-accent-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-text-normal-onDanger-rest",
    surface: "--tug-element-tone-fill-normal-danger-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-text-normal-onCaution-rest",
    surface: "--tug-element-tone-fill-normal-caution-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-text-normal-onSuccess-rest",
    surface: "--tug-element-tone-fill-normal-success-rest",
    role: "control",
  },

  // =========================================================================
  // Icon pairings — control role (interactive context icons), informational (muted/secondary icons)
  // =========================================================================
  {
    element: "--tug-element-global-icon-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-icon-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-icon-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-icon-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "control",
  },

  {
    element: "--tug-element-global-icon-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-icon-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "informational",
  },

  {
    element: "--tug-element-global-icon-normal-plain-disabled",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-global-icon-normal-plain-disabled",
    surface: "--tug-surface-control-primary-normal-plain-disabled",
    role: "decorative",
  },

  {
    element: "--tug-element-global-icon-normal-active-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-icon-normal-active-rest",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "control",
  },

  {
    element: "--tug-element-global-icon-normal-onAccent-rest",
    surface: "--tug-element-global-fill-normal-accent-rest",
    role: "control",
  },
  // =========================================================================
  // Control — Filled Accent (button labels + icons on filled accent bg)
  // =========================================================================
  {
    element: "--tug-element-control-text-filled-accent-rest",
    surface: "--tug-surface-control-primary-filled-accent-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-accent-hover",
    surface: "--tug-surface-control-primary-filled-accent-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-accent-active",
    surface: "--tug-surface-control-primary-filled-accent-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-accent-rest",
    surface: "--tug-surface-control-primary-filled-accent-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-accent-hover",
    surface: "--tug-surface-control-primary-filled-accent-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-accent-active",
    surface: "--tug-surface-control-primary-filled-accent-active",
    role: "control",
  },

  // =========================================================================
  // Control — Filled Active (button labels + icons on filled active bg)
  // =========================================================================
  {
    element: "--tug-element-control-text-filled-action-rest",
    surface: "--tug-surface-control-primary-filled-action-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-action-hover",
    surface: "--tug-surface-control-primary-filled-action-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-action-active",
    surface: "--tug-surface-control-primary-filled-action-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-action-rest",
    surface: "--tug-surface-control-primary-filled-action-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-action-hover",
    surface: "--tug-surface-control-primary-filled-action-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-action-active",
    surface: "--tug-surface-control-primary-filled-action-active",
    role: "control",
  },

  // =========================================================================
  // Control — Filled Danger (button labels + icons on filled danger bg)
  // =========================================================================
  {
    element: "--tug-element-control-text-filled-danger-rest",
    surface: "--tug-surface-control-primary-filled-danger-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-danger-hover",
    surface: "--tug-surface-control-primary-filled-danger-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-danger-active",
    surface: "--tug-surface-control-primary-filled-danger-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-danger-rest",
    surface: "--tug-surface-control-primary-filled-danger-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-danger-hover",
    surface: "--tug-surface-control-primary-filled-danger-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-danger-active",
    surface: "--tug-surface-control-primary-filled-danger-active",
    role: "control",
  },

  // =========================================================================
  // Control — Filled Agent (button labels + icons on filled agent bg)
  // =========================================================================
  {
    element: "--tug-element-control-text-filled-agent-rest",
    surface: "--tug-surface-control-primary-filled-agent-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-agent-hover",
    surface: "--tug-surface-control-primary-filled-agent-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-agent-active",
    surface: "--tug-surface-control-primary-filled-agent-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-agent-rest",
    surface: "--tug-surface-control-primary-filled-agent-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-agent-hover",
    surface: "--tug-surface-control-primary-filled-agent-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-agent-active",
    surface: "--tug-surface-control-primary-filled-agent-active",
    role: "control",
  },

  // =========================================================================
  // Control — Filled Data (data/teal bg with light text)
  // =========================================================================
  {
    element: "--tug-element-control-text-filled-data-rest",
    surface: "--tug-surface-control-primary-filled-data-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-data-hover",
    surface: "--tug-surface-control-primary-filled-data-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-data-active",
    surface: "--tug-surface-control-primary-filled-data-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-data-rest",
    surface: "--tug-surface-control-primary-filled-data-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-data-hover",
    surface: "--tug-surface-control-primary-filled-data-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-data-active",
    surface: "--tug-surface-control-primary-filled-data-active",
    role: "control",
  },

  // =========================================================================
  // Control — Filled Success (success/green bg with light text)
  // =========================================================================
  {
    element: "--tug-element-control-text-filled-success-rest",
    surface: "--tug-surface-control-primary-filled-success-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-success-hover",
    surface: "--tug-surface-control-primary-filled-success-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-success-active",
    surface: "--tug-surface-control-primary-filled-success-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-success-rest",
    surface: "--tug-surface-control-primary-filled-success-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-success-hover",
    surface: "--tug-surface-control-primary-filled-success-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-success-active",
    surface: "--tug-surface-control-primary-filled-success-active",
    role: "control",
  },

  // =========================================================================
  // Control — Filled Caution (caution/yellow bg with light text)
  // =========================================================================
  {
    element: "--tug-element-control-text-filled-caution-rest",
    surface: "--tug-surface-control-primary-filled-caution-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-caution-hover",
    surface: "--tug-surface-control-primary-filled-caution-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-filled-caution-active",
    surface: "--tug-surface-control-primary-filled-caution-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-caution-rest",
    surface: "--tug-surface-control-primary-filled-caution-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-caution-hover",
    surface: "--tug-surface-control-primary-filled-caution-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-filled-caution-active",
    surface: "--tug-surface-control-primary-filled-caution-active",
    role: "control",
  },

  // =========================================================================
  // Control — Outlined Action (default button style [D04])
  // =========================================================================
  {
    element: "--tug-element-control-text-outlined-action-rest",
    surface: "--tug-surface-control-primary-outlined-action-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-outlined-action-hover",
    surface: "--tug-surface-control-primary-outlined-action-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-outlined-action-active",
    surface: "--tug-surface-control-primary-outlined-action-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-action-rest",
    surface: "--tug-surface-control-primary-outlined-action-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-action-hover",
    surface: "--tug-surface-control-primary-outlined-action-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-action-active",
    surface: "--tug-surface-control-primary-outlined-action-active",
    role: "control",
  },

  // =========================================================================
  // Control — Outlined Agent
  // =========================================================================
  {
    element: "--tug-element-control-text-outlined-agent-rest",
    surface: "--tug-surface-control-primary-outlined-agent-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-outlined-agent-hover",
    surface: "--tug-surface-control-primary-outlined-agent-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-text-outlined-agent-active",
    surface: "--tug-surface-control-primary-outlined-agent-active",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-agent-rest",
    surface: "--tug-surface-control-primary-outlined-agent-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-agent-hover",
    surface: "--tug-surface-control-primary-outlined-agent-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-agent-active",
    surface: "--tug-surface-control-primary-outlined-agent-active",
    role: "control",
  },

  // =========================================================================
  // Control — Outlined Accent
  // =========================================================================
  {
    element: "--tug-element-control-icon-outlined-accent-rest",
    surface: "--tug-surface-control-primary-outlined-accent-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-accent-hover",
    surface: "--tug-surface-control-primary-outlined-accent-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-accent-active",
    surface: "--tug-surface-control-primary-outlined-accent-active",
    role: "control",
  },

  // =========================================================================
  // Control — Outlined Danger
  // =========================================================================
  {
    element: "--tug-element-control-icon-outlined-danger-rest",
    surface: "--tug-surface-control-primary-outlined-danger-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-danger-hover",
    surface: "--tug-surface-control-primary-outlined-danger-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-danger-active",
    surface: "--tug-surface-control-primary-outlined-danger-active",
    role: "control",
  },

  // =========================================================================
  // Control — Outlined Data
  // =========================================================================
  {
    element: "--tug-element-control-icon-outlined-data-rest",
    surface: "--tug-surface-control-primary-outlined-data-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-data-hover",
    surface: "--tug-surface-control-primary-outlined-data-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-data-active",
    surface: "--tug-surface-control-primary-outlined-data-active",
    role: "control",
  },

  // =========================================================================
  // Control — Outlined Success
  // =========================================================================
  {
    element: "--tug-element-control-icon-outlined-success-rest",
    surface: "--tug-surface-control-primary-outlined-success-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-success-hover",
    surface: "--tug-surface-control-primary-outlined-success-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-success-active",
    surface: "--tug-surface-control-primary-outlined-success-active",
    role: "control",
  },

  // =========================================================================
  // Control — Outlined Caution
  // =========================================================================
  {
    element: "--tug-element-control-icon-outlined-caution-rest",
    surface: "--tug-surface-control-primary-outlined-caution-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-caution-hover",
    surface: "--tug-surface-control-primary-outlined-caution-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-caution-active",
    surface: "--tug-surface-control-primary-outlined-caution-active",
    role: "control",
  },

  // =========================================================================
  // Control — Ghost Active (fg/icon over surface-default)
  // Ghost bg-rest is transparent; effective background is the parent surface.
  // =========================================================================
  {
    element: "--tug-element-control-text-ghost-action-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-ghost-action-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-ghost-action-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-action-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-action-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-action-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Ghost Danger (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    element: "--tug-element-control-text-ghost-danger-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-ghost-danger-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-ghost-danger-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-danger-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-danger-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-danger-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Ghost Accent (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    element: "--tug-element-control-icon-ghost-accent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-accent-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-accent-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Ghost Agent (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    element: "--tug-element-control-icon-ghost-agent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-agent-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-agent-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Ghost Data (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    element: "--tug-element-control-icon-ghost-data-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-data-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-data-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Ghost Success (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    element: "--tug-element-control-icon-ghost-success-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-success-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-success-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Ghost Caution (fg/icon over surface-default; bg-rest is transparent)
  // =========================================================================
  {
    element: "--tug-element-control-icon-ghost-caution-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-caution-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-caution-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Outlined Option (fg/icon over surface-default; bg-rest transparent)
  // The option role uses a transparent bg-rest so fg/icon are checked against
  // the parent surface. bg-hover/active are semi-transparent overlays (excluded).
  // =========================================================================
  {
    element: "--tug-element-control-text-outlined-option-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-outlined-option-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-outlined-option-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-option-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-option-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-outlined-option-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Ghost Option (fg/icon over surface-default; bg-rest transparent)
  // Same pattern as ghost-action: transparent bg-rest, semi-transparent hover/active.
  // =========================================================================
  {
    element: "--tug-element-control-text-ghost-option-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-ghost-option-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-text-ghost-option-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-option-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-option-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-icon-ghost-option-active",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },

  // =========================================================================
  // Control — Selected / Highlighted states
  // =========================================================================
  {
    element: "--tug-element-control-text-normal-selected-rest",
    surface: "--tug-surface-control-primary-normal-selected-rest",
    role: "content",
  },
  {
    element: "--tug-element-control-text-normal-highlighted-rest",
    surface: "--tug-surface-control-primary-normal-highlighted-rest",
    role: "content",
  },

  // =========================================================================
  // Field tokens — text on field backgrounds
  // =========================================================================
  {
    element: "--tug-element-field-text-normal-plain-rest",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "content",
  },
  {
    element: "--tug-element-field-text-normal-plain-rest",
    surface: "--tug-surface-field-primary-normal-plain-hover",
    role: "content",
  },
  {
    element: "--tug-element-field-text-normal-plain-rest",
    surface: "--tug-surface-field-primary-normal-plain-focus",
    role: "content",
  },
  {
    element: "--tug-element-field-text-normal-plain-disabled",
    surface: "--tug-surface-field-primary-normal-plain-disabled",
    role: "decorative",
  },
  {
    element: "--tug-element-field-text-normal-plain-readonly",
    surface: "--tug-surface-field-primary-normal-plain-readonly",
    role: "informational",
  },
  {
    element: "--tug-element-field-text-normal-label-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "content",
  },
  {
    element: "--tug-element-field-text-normal-placeholder-rest",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "informational",
  },
  {
    element: "--tug-element-field-text-normal-required-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  // =========================================================================
  // Semantic tone — foreground text on tone backgrounds
  // tone-*-bg tokens have alpha 12-15%; parentSurface triggers alpha compositing
  // before contrast measurement so the measured contrast reflects actual rendering
  // (the composited tone-*-bg over surface-default). Spec S02. [D04]
  // =========================================================================
  {
    element: "--tug-element-tone-text-normal-success-rest",
    surface: "--tug-surface-tone-primary-normal-success-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-text-normal-success-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-text-normal-caution-rest",
    surface: "--tug-surface-tone-primary-normal-caution-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-text-normal-caution-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-text-normal-danger-rest",
    surface: "--tug-surface-tone-primary-normal-danger-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-text-normal-danger-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-text-normal-accent-rest",
    surface: "--tug-surface-tone-primary-normal-accent-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-text-normal-accent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-text-normal-active-rest",
    surface: "--tug-surface-tone-primary-normal-active-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-text-normal-active-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-text-normal-agent-rest",
    surface: "--tug-surface-tone-primary-normal-agent-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-text-normal-agent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-text-normal-data-rest",
    surface: "--tug-surface-tone-primary-normal-data-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-text-normal-data-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },

  // =========================================================================
  // Semantic tone — icon tokens on surfaces and tone backgrounds
  // =========================================================================
  {
    element: "--tug-element-tone-icon-normal-accent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-accent-rest",
    surface: "--tug-surface-tone-primary-normal-accent-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-active-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-active-rest",
    surface: "--tug-surface-tone-primary-normal-active-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-agent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-agent-rest",
    surface: "--tug-surface-tone-primary-normal-agent-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-data-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-data-rest",
    surface: "--tug-surface-tone-primary-normal-data-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-success-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-success-rest",
    surface: "--tug-surface-tone-primary-normal-success-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-caution-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-caution-rest",
    surface: "--tug-surface-tone-primary-normal-caution-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-danger-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-icon-normal-danger-rest",
    surface: "--tug-surface-tone-primary-normal-danger-rest",
    role: "informational",
  },

  // =========================================================================
  // Accent — decorative (guide lines, underlines, state indicators)
  // =========================================================================
  {
    element: "--tug-element-global-fill-normal-accent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-fill-normal-accent-rest",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "informational",
  },
  // =========================================================================
  // Selection text on selection background
  // selection-bg has alpha 40%; parentSurface composites it over surface-default
  // before measuring contrast against the opaque selection-fg. Spec S02. [D04]
  // =========================================================================
  {
    element: "--tug-element-selection-text-normal-plain-rest",
    surface: "--tug-surface-selection-primary-normal-plain-rest",
    role: "content",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },

  // =========================================================================
  // Cross-control disabled contract — disabled fg/icon over disabled bg
  // Classified as decorative per WCAG (disabled elements have no requirement)
  // =========================================================================
  {
    element: "--tug-element-control-text-normal-plain-disabled",
    surface: "--tug-surface-control-primary-normal-plain-disabled",
    role: "decorative",
  },
  {
    element: "--tug-element-control-icon-normal-plain-disabled",
    surface: "--tug-surface-control-primary-normal-plain-disabled",
    role: "decorative",
  },

  // =========================================================================
  // Toggle — thumb and icon tokens on toggle track backgrounds
  // =========================================================================
  {
    element: "--tug-element-toggle-thumb-normal-plain-rest",
    surface: "--tug-surface-toggle-track-normal-on-rest",
    role: "control",
  },
  {
    element: "--tug-element-toggle-thumb-normal-plain-rest",
    surface: "--tug-surface-toggle-track-normal-on-hover",
    role: "control",
  },
  {
    element: "--tug-element-toggle-thumb-normal-plain-rest",
    surface: "--tug-surface-toggle-track-normal-off-rest",
    role: "control",
  },
  {
    element: "--tug-element-toggle-thumb-normal-plain-rest",
    surface: "--tug-surface-toggle-track-normal-off-hover",
    role: "control",
  },
  {
    element: "--tug-element-toggle-thumb-normal-plain-disabled",
    surface: "--tug-surface-toggle-track-normal-plain-disabled",
    role: "decorative",
  },
  {
    element: "--tug-element-toggle-icon-normal-plain-disabled",
    surface: "--tug-surface-toggle-track-normal-plain-disabled",
    role: "decorative",
  },
  {
    element: "--tug-element-toggle-icon-normal-plain-mixed",
    surface: "--tug-surface-toggle-track-normal-mixed-rest",
    role: "control",
  },
  {
    element: "--tug-element-toggle-icon-normal-plain-mixed",
    surface: "--tug-surface-toggle-track-normal-mixed-hover",
    role: "control",
  },

  // =========================================================================
  // Checkmark and radio — over control primary / secondary backgrounds
  // =========================================================================
  {
    element: "--tug-element-checkmark-icon-normal-plain-rest",
    surface: "--tug-surface-control-primary-filled-accent-rest",
    role: "control",
  },
  {
    element: "--tug-element-checkmark-icon-normal-plain-rest",
    surface: "--tug-element-global-fill-normal-accent-rest",
    role: "control",
  },
  {
    element: "--tug-element-checkmark-icon-normal-plain-mixed",
    surface: "--tug-surface-control-primary-outlined-action-rest",
    role: "control",
  },
  {
    element: "--tug-element-radio-dot-normal-plain-rest",
    surface: "--tug-surface-control-primary-filled-accent-rest",
    role: "control",
  },
  {
    element: "--tug-element-radio-dot-normal-plain-rest",
    surface: "--tug-element-global-fill-normal-accent-rest",
    role: "control",
  },

  // --- Tab Chrome ---
  // tab-fg-rest over tab bar background.
  // The tab bar bg token is tab-bg-inactive (an opaque tinted color); surface-sunken
  // captures the design-intent baseline for detached/collapsed contexts.
  {
    element: "--tug-element-tab-text-normal-plain-rest",
    surface: "--tug-surface-tab-primary-normal-plain-inactive",
    role: "informational",
  },
  {
    element: "--tug-element-tab-text-normal-plain-rest",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "informational",
  },
  // tab-fg-active over active tab background
  {
    element: "--tug-element-tab-text-normal-plain-active",
    surface: "--tug-surface-tab-primary-normal-plain-active",
    role: "content",
  },
  // tab-fg-hover over hover highlight (semi-transparent over tab-bg-inactive).
  // Also paired with surface-sunken for the design-intent baseline.
  {
    element: "--tug-element-tab-text-normal-plain-hover",
    surface: "--tug-surface-tab-primary-normal-plain-inactive",
    role: "content",
  },
  {
    element: "--tug-element-tab-text-normal-plain-hover",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "content",
  },
  // close button hover fg over close bg hover (semi-transparent over tab-bg-inactive).
  {
    element: "--tug-element-tab-close-normal-plain-hover",
    surface: "--tug-surface-tab-primary-normal-plain-inactive",
    role: "control",
  },
  {
    element: "--tug-element-tab-close-normal-plain-hover",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "control",
  },
  // fg-muted over tab bar background (add-tab [+] and overflow trigger text)
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-surface-tab-primary-normal-plain-inactive",
    role: "informational",
  },

  // --- Badge Tinted fg on tinted bg ---
  // badge-tinted-*-bg has alpha 15%; parentSurface composites the bg over
  // surface-default before measuring contrast against the opaque fg element. Spec S02. [D04]
  {
    element: "--tug-element-badge-text-tinted-accent-rest",
    surface: "--tug-surface-badge-primary-tinted-accent-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-text-tinted-action-rest",
    surface: "--tug-surface-badge-primary-tinted-action-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-text-tinted-agent-rest",
    surface: "--tug-surface-badge-primary-tinted-agent-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-text-tinted-data-rest",
    surface: "--tug-surface-badge-primary-tinted-data-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-text-tinted-danger-rest",
    surface: "--tug-surface-badge-primary-tinted-danger-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-text-tinted-success-rest",
    surface: "--tug-surface-badge-primary-tinted-success-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-text-tinted-caution-rest",
    surface: "--tug-surface-badge-primary-tinted-caution-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },

  // --- Badge Tinted border on surface-default --- (Step 4)
  // badge-tinted-*-border has alpha 35%; the border element is composited over
  // surface-default before measuring contrast against surface-default. Spec S02. [D04]
  // These pairs were deferred from Step 3 because they require compositing.
  {
    element: "--tug-element-badge-border-tinted-accent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-border-tinted-action-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-border-tinted-agent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-border-tinted-data-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-border-tinted-danger-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-border-tinted-success-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-border-tinted-caution-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },

  // =========================================================================
  // Badge Outlined / Ghost icon tokens (badge-token-split)
  // Icon tokens render identically to the corresponding text tokens but are
  // named with "icon" for CSS currentColor inheritance on SVG elements.
  // Both outlined and ghost badges have transparent surfaces; contrast is
  // measured against surface-default via parentSurface compositing. [D04]
  // =========================================================================
  {
    element: "--tug-element-badge-icon-outlined-accent-rest",
    surface: "--tug-surface-badge-primary-outlined-accent-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-outlined-action-rest",
    surface: "--tug-surface-badge-primary-outlined-action-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-outlined-danger-rest",
    surface: "--tug-surface-badge-primary-outlined-danger-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-outlined-agent-rest",
    surface: "--tug-surface-badge-primary-outlined-agent-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-outlined-data-rest",
    surface: "--tug-surface-badge-primary-outlined-data-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-outlined-success-rest",
    surface: "--tug-surface-badge-primary-outlined-success-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-outlined-caution-rest",
    surface: "--tug-surface-badge-primary-outlined-caution-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-ghost-accent-rest",
    surface: "--tug-surface-badge-primary-ghost-accent-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-ghost-action-rest",
    surface: "--tug-surface-badge-primary-ghost-action-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-ghost-danger-rest",
    surface: "--tug-surface-badge-primary-ghost-danger-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-ghost-agent-rest",
    surface: "--tug-surface-badge-primary-ghost-agent-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-ghost-data-rest",
    surface: "--tug-surface-badge-primary-ghost-data-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-ghost-success-rest",
    surface: "--tug-surface-badge-primary-ghost-success-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-badge-icon-ghost-caution-rest",
    surface: "--tug-surface-badge-primary-ghost-caution-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },

  // =========================================================================
  // Toggle track visibility — track against parent surface (Step 3)
  // Checks whether the toggle track itself is visible against the surface it
  // sits on. "on" and hover states are the primary actionable signals;
  // "off" and "mixed" states are intentionally lower-contrast to signal
  // the inactive/indeterminate state (see KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS).
  // =========================================================================
  {
    element: "--tug-surface-toggle-track-normal-on-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-on-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-off-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-off-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-mixed-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-mixed-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-on-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-on-hover",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-off-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-off-hover",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-mixed-hover",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-surface-toggle-track-normal-mixed-hover",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "control",
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
    element: "--tug-element-field-border-normal-plain-rest",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-plain-rest",
    surface: "--tug-surface-field-primary-normal-plain-hover",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-plain-rest",
    surface: "--tug-surface-field-primary-normal-plain-focus",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-plain-hover",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-plain-hover",
    surface: "--tug-surface-field-primary-normal-plain-hover",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-plain-hover",
    surface: "--tug-surface-field-primary-normal-plain-focus",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-plain-active",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-plain-active",
    surface: "--tug-surface-field-primary-normal-plain-hover",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-plain-active",
    surface: "--tug-surface-field-primary-normal-plain-focus",
    role: "control",
  },

  // =========================================================================
  // Validation border visibility — border against field-bg-rest (Step 3)
  // Danger and success validation borders use vivid role colors that pass contrast 30.
  // =========================================================================
  {
    element: "--tug-element-field-border-normal-danger-rest",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "control",
  },
  {
    element: "--tug-element-field-border-normal-success-rest",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "control",
  },

  // =========================================================================
  // Outlined button border visibility (Step 3)
  // bg-rest is transparent (not in resolved map, so validateThemeContrast skips
  // those pairs); hover and active bg tokens are chromatic and pass contrast 30.
  // =========================================================================
  {
    element: "--tug-element-control-border-outlined-action-rest",
    surface: "--tug-surface-control-primary-outlined-action-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-border-outlined-action-hover",
    surface: "--tug-surface-control-primary-outlined-action-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-border-outlined-action-active",
    surface: "--tug-surface-control-primary-outlined-action-active",
    role: "control",
  },
  {
    element: "--tug-element-control-border-outlined-agent-rest",
    surface: "--tug-surface-control-primary-outlined-agent-rest",
    role: "control",
  },
  {
    element: "--tug-element-control-border-outlined-agent-hover",
    surface: "--tug-surface-control-primary-outlined-agent-hover",
    role: "control",
  },
  {
    element: "--tug-element-control-border-outlined-agent-active",
    surface: "--tug-surface-control-primary-outlined-agent-active",
    role: "control",
  },

  // =========================================================================
  // Separator / divider visibility — border against surface (Step 3)
  // border-default and border-muted are structural layout separators intentionally
  // below contrast 30 by design (see KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS).
  // Classified as "decorative" (threshold 15) to prevent the contrast floor from
  // bumping them toward higher lightness, which would override the subtle visual hierarchy.
  // These are structural dividers, not informational text — "decorative" captures the
  // design intent that these elements are layout cues, not semantic content indicators.
  // =========================================================================
  {
    element: "--tug-element-global-border-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-global-border-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-global-border-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-global-border-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "decorative",
  },

  // =========================================================================
  // Focus indicator pairs — accent-cool-default against all surfaces (Step 5)
  //
  // accent-cool-default (cobalt-intense) is the universal focus ring color.
  // All 9 surfaces that can contain focusable elements are covered with
  // role "control" (contrast 60 threshold). surface-screen is included
  // because tooltips (--tug-tooltip-bg: var(--tug-surface-global-primary-normal-screen-rest))
  // can contain focusable elements. [D05]
  //
  // Focused-vs-unfocused state comparison pairs use role "decorative"
  // because perceptual contrast is designed for element-on-area contrast, not border-vs-border
  // comparisons. These pairs are informational only and do not gate the pipeline. [D05]
  // =========================================================================
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-app-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-raised-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-inset-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-content-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-sunken-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-screen-rest",
    role: "control",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "control",
  },
  // Focused-vs-unfocused comparisons: informational only (decorative role).
  // Perceptual contrast measures element-on-area contrast; border-vs-border results are
  // unreliable as a gate. These appear in the dashboard for visual review. [D05]
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-element-field-border-normal-plain-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-element-control-border-outlined-action-rest",
    role: "decorative",
  },

  // =========================================================================
  // Step 5 additions — pairings discovered in the Step 2 audit that were
  // absent from the map. Grouped by discovery context.
  // =========================================================================

  // --- Card title bar / tab chrome (tug-card.css, tug-tab.css) ---
  // These pairings cover --tug-card-title-bar-fg (fg-default) used by other
  // title-bar elements (icons, labels) on the tab-bar backgrounds. The card
  // title itself (.tugcard-title) now uses its own dedicated token
  // (element-card-title-normal-plain-rest) — see Step 7 additions below.
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-tab-primary-normal-plain-active",
    role: "content",
  },
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-tab-primary-normal-plain-inactive",
    role: "content",
  },
  {
    element: "--tug-element-global-icon-normal-active-rest",
    surface: "--tug-surface-tab-primary-normal-plain-active",
    role: "informational",
  },
  // fg-subtle used for inactive-state card title-bar icon
  {
    element: "--tug-element-global-text-normal-subtle-rest",
    surface: "--tug-surface-tab-primary-normal-plain-inactive",
    role: "informational",
  },
  // Tab overflow badge: CSS sets color: var(--tug-surface-global-primary-normal-default-rest) directly
  // over the accent-default badge background (tug-tab.css:283).
  {
    element: "--tug-surface-global-primary-normal-default-rest",
    surface: "--tug-element-global-fill-normal-accent-rest",
    role: "informational",
  },

  // --- Canvas / preview surfaces (gallery-theme-generator-content.css) ---
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-canvas-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-subtle-rest",
    surface: "--tug-surface-global-primary-normal-canvas-rest",
    role: "informational",
  },
  {
    element: "--tug-element-global-text-normal-link-rest",
    surface: "--tug-surface-global-primary-normal-canvas-rest",
    role: "content",
  },

  // --- Surface inset — subtle text (gallery-popup-button.css) ---
  {
    element: "--tug-element-global-text-normal-subtle-rest",
    surface: "--tug-surface-global-primary-normal-inset-rest",
    role: "informational",
  },

  // --- Surface control — text (gallery-card.css, gallery-palette-content.css,
  //     tug-tab.css, gallery-theme-generator-content.css) ---
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-control-rest",
    role: "content",
  },
  // fg-muted on surface-control: code comment text in code block
  // (tug-code.css: --tug-codeBlock-bg = surface-control)
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-control-rest",
    role: "content",
  },

  // --- Accent-subtle as background — active UI states ---
  // fg-onAccent on accent-subtle: active preset button (gtg-preset-btn--active)
  // accent-subtle has alpha 15%; parentSurface composites it over surface-default
  // before contrast measurement. [D04]
  {
    element: "--tug-element-global-text-normal-onAccent-rest",
    surface: "--tug-element-global-fill-normal-accentSubtle-rest",
    role: "informational",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  // fg-default on accent-subtle: menu selected/checked item background
  // accent-subtle has alpha 15%; parentSurface composites over surface-default. [D04]
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-element-global-fill-normal-accentSubtle-rest",
    role: "content",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },

  // --- Semantic tone backgrounds as surfaces ---
  // fg-default on tone-caution-bg: autofix suggestion list items (gallery-theme-generator-content.css)
  {
    element: "--tug-element-global-text-normal-default-rest",
    surface: "--tug-surface-tone-primary-normal-caution-rest",
    role: "content",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  // tone-danger (chromatic) as fg on surface-overlay: danger menu item text (tug-menu.css)
  // Classified as content: the user must read this label to understand the destructive
  // action; it is readable label text regardless of the chromatic role intent.
  {
    element: "--tug-element-tone-fill-normal-danger-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "content",
  },
  // tone-danger (chromatic) as fg on surface-default: ghost/outlined danger badge text (tug-badge.css)
  {
    element: "--tug-element-tone-fill-normal-danger-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },

  // --- Checkmark / toggle track pairings (tug-checkbox.css) ---
  // checkmark-fg on toggle-track-on: checkmark icon on checked checkbox background
  {
    element: "--tug-element-checkmark-icon-normal-plain-rest",
    surface: "--tug-surface-toggle-track-normal-on-rest",
    role: "control",
  },
  // checkmark-fg-mixed on toggle-track-mixed: indeterminate dash on mixed checkbox background
  // The mixed-state toggle track is intentionally subdued; the dash indicator on it is
  // classified as "decorative" (threshold 15) — the indicator's purpose is structural state
  // signaling via position and shape, not text contrast. Contrast floor must not bump this.
  {
    element: "--tug-element-checkmark-icon-normal-plain-mixed",
    surface: "--tug-surface-toggle-track-normal-mixed-rest",
    role: "decorative",
  },

  // --- Dock button badge (tug-dock.css) ---
  // fg-inverse on tone-danger (chromatic): dock notification badge text
  {
    element: "--tug-element-global-text-normal-inverse-rest",
    surface: "--tug-element-tone-fill-normal-danger-rest",
    role: "informational",
  },

  // --- Neutral badge: divider-default used as background (tug-dialog.css) ---
  // divider-default is an element token normally; here it is used as badge-neutral-bg.
  // fg-muted renders over this dual-use surface.
  {
    element: "--tug-element-global-text-normal-muted-rest",
    surface: "--tug-element-global-divider-normal-default-rest",
    role: "informational",
  },

  // --- Dock background = field-bg-focus (tug-dock.css) ---
  // fg-subtle used for dock button icons over the dock background (field-bg-focus)
  {
    element: "--tug-element-global-text-normal-subtle-rest",
    surface: "--tug-surface-field-primary-normal-plain-focus",
    role: "informational",
  },

  // =========================================================================
  // Filled button borders — border on own filled background (Step 6 additions)
  // These borders sit on their own filled bg; the border token is a slightly
  // darker/lighter variant of the fill at the same chromatic hue. The border is
  // a subtle outline accent — decorative. Hover/active variants have inherently
  // low contrast against their bg (same hue, adjacent tone), so they are
  // classified decorative (threshold 15) not control/informational (threshold 60).
  // =========================================================================
  // Filled accent
  {
    element: "--tug-element-control-border-filled-accent-rest",
    surface: "--tug-surface-control-primary-filled-accent-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-filled-accent-hover",
    surface: "--tug-surface-control-primary-filled-accent-hover",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-control-border-filled-accent-active",
    surface: "--tug-surface-control-primary-filled-accent-active",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  // Filled action
  {
    element: "--tug-element-control-border-filled-action-rest",
    surface: "--tug-surface-control-primary-filled-action-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-filled-action-hover",
    surface: "--tug-surface-control-primary-filled-action-hover",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-control-border-filled-action-active",
    surface: "--tug-surface-control-primary-filled-action-active",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  // Filled danger
  {
    element: "--tug-element-control-border-filled-danger-rest",
    surface: "--tug-surface-control-primary-filled-danger-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-filled-danger-hover",
    surface: "--tug-surface-control-primary-filled-danger-hover",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-control-border-filled-danger-active",
    surface: "--tug-surface-control-primary-filled-danger-active",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  // Filled agent
  {
    element: "--tug-element-control-border-filled-agent-rest",
    surface: "--tug-surface-control-primary-filled-agent-rest",
    role: "decorative",
  },
  // Filled data
  {
    element: "--tug-element-control-border-filled-data-rest",
    surface: "--tug-surface-control-primary-filled-data-rest",
    role: "decorative",
  },
  // Filled success
  {
    element: "--tug-element-control-border-filled-success-rest",
    surface: "--tug-surface-control-primary-filled-success-rest",
    role: "decorative",
  },
  // Filled caution
  {
    element: "--tug-element-control-border-filled-caution-rest",
    surface: "--tug-surface-control-primary-filled-caution-rest",
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
    element: "--tug-element-control-text-ghost-action-rest",
    surface: "--tug-surface-control-primary-ghost-action-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-action-rest",
    surface: "--tug-surface-control-primary-ghost-action-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-text-ghost-action-hover",
    surface: "--tug-surface-control-primary-ghost-action-hover",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-action-hover",
    surface: "--tug-surface-control-primary-ghost-action-hover",
    role: "decorative",
  },
  {
    element: "--tug-element-control-text-ghost-action-active",
    surface: "--tug-surface-control-primary-ghost-action-active",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-action-active",
    surface: "--tug-surface-control-primary-ghost-action-active",
    role: "decorative",
  },
  // Ghost danger
  {
    element: "--tug-element-control-text-ghost-danger-rest",
    surface: "--tug-surface-control-primary-ghost-danger-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-danger-rest",
    surface: "--tug-surface-control-primary-ghost-danger-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-text-ghost-danger-hover",
    surface: "--tug-surface-control-primary-ghost-danger-hover",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-danger-hover",
    surface: "--tug-surface-control-primary-ghost-danger-hover",
    role: "decorative",
  },
  {
    element: "--tug-element-control-text-ghost-danger-active",
    surface: "--tug-surface-control-primary-ghost-danger-active",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-danger-active",
    surface: "--tug-surface-control-primary-ghost-danger-active",
    role: "decorative",
  },
  // Ghost option
  {
    element: "--tug-element-control-text-ghost-option-rest",
    surface: "--tug-surface-control-primary-ghost-option-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-option-rest",
    surface: "--tug-surface-control-primary-ghost-option-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-text-ghost-option-hover",
    surface: "--tug-surface-control-primary-ghost-option-hover",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-option-hover",
    surface: "--tug-surface-control-primary-ghost-option-hover",
    role: "decorative",
  },
  {
    element: "--tug-element-control-text-ghost-option-active",
    surface: "--tug-surface-control-primary-ghost-option-active",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-ghost-option-active",
    surface: "--tug-surface-control-primary-ghost-option-active",
    role: "decorative",
  },

  // =========================================================================
  // Outlined option button fg and border on own bg (Step 6 additions)
  // bg-rest is transparent; hover/active bg have alpha 10-20% (same as ghost).
  // Same decorative classification rationale as ghost buttons above.
  // =========================================================================
  {
    element: "--tug-element-control-text-outlined-option-rest",
    surface: "--tug-surface-control-primary-outlined-option-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-outlined-option-rest",
    surface: "--tug-surface-control-primary-outlined-option-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-control-text-outlined-option-hover",
    surface: "--tug-surface-control-primary-outlined-option-hover",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-outlined-option-hover",
    surface: "--tug-surface-control-primary-outlined-option-hover",
    role: "decorative",
  },
  {
    element: "--tug-element-control-text-outlined-option-active",
    surface: "--tug-surface-control-primary-outlined-option-active",
    role: "decorative",
  },
  {
    element: "--tug-element-control-border-outlined-option-active",
    surface: "--tug-surface-control-primary-outlined-option-active",
    role: "decorative",
  },
  {
    element: "--tug-element-control-icon-outlined-option-active",
    surface: "--tug-surface-control-primary-outlined-option-active",
    role: "decorative",
  },

  // =========================================================================
  // Tab-specific pairings (Step 6 additions)
  // =========================================================================
  // border-default used as the separator line between inactive tabs
  {
    element: "--tug-element-global-border-normal-default-rest",
    surface: "--tug-surface-tab-primary-normal-plain-inactive",
    role: "decorative",
  },
  // Tab hover state — tab-bg-hover has alpha 8%, same semi-transparent pattern
  {
    element: "--tug-element-tab-text-normal-plain-hover",
    surface: "--tug-surface-tab-primary-normal-plain-hover",
    role: "decorative",
  },
  // Tab close button hover — tab-close-bg-hover has alpha 12%, decorative
  {
    element: "--tug-element-tab-close-normal-plain-hover",
    surface: "--tug-surface-tab-close-normal-plain-hover",
    role: "decorative",
  },
  // Tab bar surface-control: add/overflow buttons and border accents
  {
    element: "--tug-element-global-border-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-control-rest",
    role: "decorative",
  },
  {
    element: "--tug-element-global-fill-normal-accent-rest",
    surface: "--tug-surface-global-primary-normal-control-rest",
    role: "informational",
  },

  // =========================================================================
  // Card title token pairings (Step 7 additions)
  // element-card-title-normal-plain-rest renders as .tugcard-title text
  // on both active and inactive tab-bar backgrounds (tug-card.css [D06]).
  // =========================================================================
  {
    element: "--tug-element-card-title-normal-plain-rest",
    surface: "--tug-surface-tab-primary-normal-plain-active",
    role: "display",
  },
  {
    element: "--tug-element-card-title-normal-plain-rest",
    surface: "--tug-surface-tab-primary-normal-plain-inactive",
    role: "display",
  },

  // =========================================================================
  // Badge tinted borders on tinted backgrounds (Step 6 additions)
  // The border-* token sits on the tinted bg of each badge variant.
  // =========================================================================
  {
    element: "--tug-element-badge-border-tinted-accent-rest",
    surface: "--tug-surface-badge-primary-tinted-accent-rest",
    role: "informational",
  },
  {
    element: "--tug-element-badge-border-tinted-action-rest",
    surface: "--tug-surface-badge-primary-tinted-action-rest",
    role: "informational",
  },
  {
    element: "--tug-element-badge-border-tinted-agent-rest",
    surface: "--tug-surface-badge-primary-tinted-agent-rest",
    role: "informational",
  },
  {
    element: "--tug-element-badge-border-tinted-data-rest",
    surface: "--tug-surface-badge-primary-tinted-data-rest",
    role: "informational",
  },
  {
    element: "--tug-element-badge-border-tinted-danger-rest",
    surface: "--tug-surface-badge-primary-tinted-danger-rest",
    role: "informational",
  },
  {
    element: "--tug-element-badge-border-tinted-success-rest",
    surface: "--tug-surface-badge-primary-tinted-success-rest",
    role: "informational",
  },
  {
    element: "--tug-element-badge-border-tinted-caution-rest",
    surface: "--tug-surface-badge-primary-tinted-caution-rest",
    role: "informational",
  },

  // =========================================================================
  // Tone borders on tone backgrounds (Step 6 additions)
  // tone-*-border sits on the matching tone-*-bg (alpha 12-15%) for tinted
  // badge/chip outlines. The bg token is semi-transparent; parentSurface is
  // set to surface-default for compositing. Role decorative: the border is a
  // subtle tinted halo — visual reinforcement, not a contrast-critical boundary.
  // =========================================================================
  {
    element: "--tug-element-tone-border-normal-accent-rest",
    surface: "--tug-surface-tone-primary-normal-accent-rest",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-border-normal-active-rest",
    surface: "--tug-surface-tone-primary-normal-active-rest",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-border-normal-agent-rest",
    surface: "--tug-surface-tone-primary-normal-agent-rest",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-border-normal-data-rest",
    surface: "--tug-surface-tone-primary-normal-data-rest",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-border-normal-danger-rest",
    surface: "--tug-surface-tone-primary-normal-danger-rest",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-border-normal-success-rest",
    surface: "--tug-surface-tone-primary-normal-success-rest",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-tone-border-normal-caution-rest",
    surface: "--tug-surface-tone-primary-normal-caution-rest",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },

  // =========================================================================
  // Chromatic tone tokens used as foreground on surface-default (Step 6 additions)
  // Ghost/outlined badge ghost variants use chromatic tone tokens as text/icon color
  // over surface-default (transparent bg over surface-default parent).
  // =========================================================================
  {
    element: "--tug-element-global-text-normal-inverse-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-fill-normal-accent-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-fill-normal-data-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-fill-normal-success-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },
  {
    element: "--tug-element-tone-fill-normal-caution-rest",
    surface: "--tug-surface-global-primary-normal-default-rest",
    role: "informational",
  },

  // =========================================================================
  // Checkbox chromatic self-pairings (Step 6 additions)
  // These are cases where a chromatic toggle-track token is used as both the
  // background-color and border-color of the same rule. The border is a
  // stylistic outline that is the same hue as the fill — decorative.
  // =========================================================================
  {
    element: "--tug-surface-toggle-track-normal-on-hover",
    surface: "--tug-surface-toggle-track-normal-on-hover",
    role: "decorative",
  },
  {
    element: "--tug-surface-toggle-track-normal-mixed-hover",
    surface: "--tug-surface-toggle-track-normal-mixed-hover",
    role: "decorative",
  },
  {
    element: "--tug-surface-toggle-track-normal-plain-disabled",
    surface: "--tug-surface-toggle-track-normal-plain-disabled",
    role: "decorative",
  },

  // =========================================================================
  // Input field border variants on field backgrounds (Step 6 additions)
  // disabled and readonly borders are intentionally subtle — same structural
  // constraint as field-border-rest/hover (already in KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS
  // in the test). parentSurface set to surface-default so enforceContrastFloor
  // skips these during derivation (they render over a parent surface, not directly
  // composited — the border sits on the field bg which sits on surface-default).
  // =========================================================================
  {
    element: "--tug-element-field-border-normal-plain-disabled",
    surface: "--tug-surface-field-primary-normal-plain-disabled",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  {
    element: "--tug-element-field-border-normal-plain-readonly",
    surface: "--tug-surface-field-primary-normal-plain-readonly",
    role: "decorative",
    parentSurface: "--tug-surface-global-primary-normal-default-rest",
  },
  // field-tone-caution used as a subtle warning tint border on the rest-state bg
  {
    element: "--tug-element-field-fill-normal-caution-rest",
    surface: "--tug-surface-field-primary-normal-plain-rest",
    role: "informational",
  },

  // =========================================================================
  // Gallery card surface-control pairings (Step 6 additions)
  // accent-cool-default appears over surface-control in gallery demo areas.
  // border-default on surface-control is already declared in the tab section above.
  // =========================================================================
  {
    element: "--tug-element-global-fill-normal-accentCool-rest",
    surface: "--tug-surface-global-primary-normal-control-rest",
    role: "control",
  },

  // =========================================================================
  // Additional surface pairings from gallery components (Step 6 additions)
  // =========================================================================
  // border-muted on surface-inset (gallery-popup-button.css)
  {
    element: "--tug-element-global-border-normal-muted-rest",
    surface: "--tug-surface-global-primary-normal-inset-rest",
    role: "decorative",
  },
  // border-default on surface-inset (gallery-palette-content.css)
  {
    element: "--tug-element-global-border-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-inset-rest",
    role: "decorative",
  },
  // border-default on bg-canvas (gallery-theme-generator-content.css)
  {
    element: "--tug-element-global-border-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-canvas-rest",
    role: "decorative",
  },
  // border-default on surface-overlay (tug-menu.css dropdown panel border)
  {
    element: "--tug-element-global-border-normal-default-rest",
    surface: "--tug-surface-global-primary-normal-overlay-rest",
    role: "decorative",
  },
  // accent-default on accent-subtle (gallery-theme-generator-content.css: mode btn active)
  {
    element: "--tug-element-global-fill-normal-accent-rest",
    surface: "--tug-element-global-fill-normal-accentSubtle-rest",
    role: "informational",
  },

  // =========================================================================
  // Dynamic toggle tokens (tug-checkbox.css)
  //
  // --tug-toggle-on-color and --tug-toggle-on-hover-color are runtime-injected
  // CSS custom properties set by TugCheckbox to the role fill color.
  // In the checked state, border-color === background-color — these are
  // self-referential decorative pairings (no contrast requirement).
  // They are not static design tokens and cannot be enforced by evaluateRules.
  // =========================================================================
  {
    element: "--tug-toggle-on-color",
    surface: "--tug-toggle-on-color",
    role: "decorative",
  },
  {
    element: "--tug-toggle-on-hover-color",
    surface: "--tug-toggle-on-hover-color",
    role: "decorative",
  },

];

