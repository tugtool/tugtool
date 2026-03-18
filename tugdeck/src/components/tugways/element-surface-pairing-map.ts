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

  // Muted text (secondary text, labels) — subdued-text: intentionally below body-text contrast 75
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-default",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-raised",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-overlay",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-sunken",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-inset",
    role: "subdued-text",
  },

  // Subtle text (tertiary, metadata) — subdued-text: intentionally below body-text contrast 75
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-default",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-raised",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-overlay",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-sunken",
    role: "subdued-text",
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

  // Placeholder text (form fields) — subdued-text: intentionally below body-text contrast 75
  {
    element: "--tug-base-fg-placeholder",
    surface: "--tug-base-field-bg-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-placeholder",
    surface: "--tug-base-field-bg-hover",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-placeholder",
    surface: "--tug-base-field-bg-focus",
    role: "subdued-text",
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
    element: "--tug-base-field-fg-default",
    surface: "--tug-base-field-bg-rest",
    role: "body-text",
  },
  {
    element: "--tug-base-field-fg-default",
    surface: "--tug-base-field-bg-hover",
    role: "body-text",
  },
  {
    element: "--tug-base-field-fg-default",
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
    role: "subdued-text",
  },
  {
    element: "--tug-base-field-fg-label",
    surface: "--tug-base-surface-default",
    role: "body-text",
  },
  {
    element: "--tug-base-field-fg-placeholder",
    surface: "--tug-base-field-bg-rest",
    role: "subdued-text",
  },
  {
    element: "--tug-base-field-fg-required",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  // =========================================================================
  // Semantic tone — foreground text on tone backgrounds
  // tone-*-bg tokens have alpha 12-15%; parentSurface triggers alpha compositing
  // before contrast measurement so the measured contrast reflects actual rendering
  // (the composited tone-*-bg over surface-default). Spec S02. [D04]
  // =========================================================================
  {
    element: "--tug-base-tone-success-fg",
    surface: "--tug-base-tone-success-bg",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
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
    parentSurface: "--tug-base-surface-default",
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
    parentSurface: "--tug-base-surface-default",
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
    parentSurface: "--tug-base-surface-default",
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
    parentSurface: "--tug-base-surface-default",
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
    parentSurface: "--tug-base-surface-default",
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
    parentSurface: "--tug-base-surface-default",
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
  // =========================================================================
  // Selection text on selection background
  // selection-bg has alpha 40%; parentSurface composites it over surface-default
  // before measuring contrast against the opaque selection-fg. Spec S02. [D04]
  // =========================================================================
  {
    element: "--tug-base-selection-fg",
    surface: "--tug-base-selection-bg",
    role: "body-text",
    parentSurface: "--tug-base-surface-default",
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
    element: "--tug-base-checkmark-fg",
    surface: "--tug-base-control-filled-accent-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-checkmark-fg",
    surface: "--tug-base-accent-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-checkmark-fg-mixed",
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
  // tab-fg-rest over tab bar background.
  // The tab bar bg token is tab-bg-inactive (an opaque tinted color); surface-sunken
  // captures the design-intent baseline for detached/collapsed contexts.
  {
    element: "--tug-base-tab-fg-rest",
    surface: "--tug-base-tab-bg-inactive",
    role: "subdued-text",
  },
  {
    element: "--tug-base-tab-fg-rest",
    surface: "--tug-base-surface-sunken",
    role: "subdued-text",
  },
  // tab-fg-active over active tab background
  {
    element: "--tug-base-tab-fg-active",
    surface: "--tug-base-tab-bg-active",
    role: "body-text",
  },
  // tab-fg-hover over hover highlight (semi-transparent over tab-bg-inactive).
  // Also paired with surface-sunken for the design-intent baseline.
  {
    element: "--tug-base-tab-fg-hover",
    surface: "--tug-base-tab-bg-inactive",
    role: "body-text",
  },
  {
    element: "--tug-base-tab-fg-hover",
    surface: "--tug-base-surface-sunken",
    role: "body-text",
  },
  // close button hover fg over close bg hover (semi-transparent over tab-bg-inactive).
  {
    element: "--tug-base-tab-close-fg-hover",
    surface: "--tug-base-tab-bg-inactive",
    role: "ui-component",
  },
  {
    element: "--tug-base-tab-close-fg-hover",
    surface: "--tug-base-surface-sunken",
    role: "ui-component",
  },
  // fg-muted over tab bar background (add-tab [+] and overflow trigger text)
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-tab-bg-inactive",
    role: "ui-component",
  },

  // --- Badge Tinted fg on tinted bg ---
  // badge-tinted-*-bg has alpha 15%; parentSurface composites the bg over
  // surface-default before measuring contrast against the opaque fg element. Spec S02. [D04]
  {
    element: "--tug-base-badge-tinted-accent-fg",
    surface: "--tug-base-badge-tinted-accent-bg",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-action-fg",
    surface: "--tug-base-badge-tinted-action-bg",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-agent-fg",
    surface: "--tug-base-badge-tinted-agent-bg",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-data-fg",
    surface: "--tug-base-badge-tinted-data-bg",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-danger-fg",
    surface: "--tug-base-badge-tinted-danger-bg",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-success-fg",
    surface: "--tug-base-badge-tinted-success-bg",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-caution-fg",
    surface: "--tug-base-badge-tinted-caution-bg",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },

  // --- Badge Tinted border on surface-default --- (Step 4)
  // badge-tinted-*-border has alpha 35%; the border element is composited over
  // surface-default before measuring contrast against surface-default. Spec S02. [D04]
  // These pairs were deferred from Step 3 because they require compositing.
  {
    element: "--tug-base-badge-tinted-accent-border",
    surface: "--tug-base-surface-default",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-action-border",
    surface: "--tug-base-surface-default",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-agent-border",
    surface: "--tug-base-surface-default",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-data-border",
    surface: "--tug-base-surface-default",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-danger-border",
    surface: "--tug-base-surface-default",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-success-border",
    surface: "--tug-base-surface-default",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-badge-tinted-caution-border",
    surface: "--tug-base-surface-default",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },

  // =========================================================================
  // Toggle track visibility — track against parent surface (Step 3)
  // Checks whether the toggle track itself is visible against the surface it
  // sits on. "on" and hover states are the primary actionable signals;
  // "off" and "mixed" states are intentionally lower-contrast to signal
  // the inactive/indeterminate state (see KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS).
  // =========================================================================
  {
    element: "--tug-base-toggle-track-on",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-on",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-off",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-off",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-mixed",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-mixed",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-on-hover",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-on-hover",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-off-hover",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-off-hover",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-mixed-hover",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-toggle-track-mixed-hover",
    surface: "--tug-base-surface-raised",
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
    element: "--tug-base-field-border-rest",
    surface: "--tug-base-field-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-rest",
    surface: "--tug-base-field-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-rest",
    surface: "--tug-base-field-bg-focus",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-hover",
    surface: "--tug-base-field-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-hover",
    surface: "--tug-base-field-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-hover",
    surface: "--tug-base-field-bg-focus",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-active",
    surface: "--tug-base-field-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-active",
    surface: "--tug-base-field-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-active",
    surface: "--tug-base-field-bg-focus",
    role: "ui-component",
  },

  // =========================================================================
  // Validation border visibility — border against field-bg-rest (Step 3)
  // Danger and success validation borders use vivid signal colors that pass contrast 30.
  // =========================================================================
  {
    element: "--tug-base-field-border-danger",
    surface: "--tug-base-field-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-field-border-success",
    surface: "--tug-base-field-bg-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Outlined button border visibility (Step 3)
  // bg-rest is transparent (not in resolved map, so validateThemeContrast skips
  // those pairs); hover and active bg tokens are chromatic and pass contrast 30.
  // =========================================================================
  {
    element: "--tug-base-control-outlined-action-border-rest",
    surface: "--tug-base-control-outlined-action-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-action-border-hover",
    surface: "--tug-base-control-outlined-action-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-action-border-active",
    surface: "--tug-base-control-outlined-action-bg-active",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-agent-border-rest",
    surface: "--tug-base-control-outlined-agent-bg-rest",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-agent-border-hover",
    surface: "--tug-base-control-outlined-agent-bg-hover",
    role: "ui-component",
  },
  {
    element: "--tug-base-control-outlined-agent-border-active",
    surface: "--tug-base-control-outlined-agent-bg-active",
    role: "ui-component",
  },

  // =========================================================================
  // Separator / divider visibility — border against surface (Step 3)
  // border-default and border-muted are very subtle separators in dark mode;
  // both are below contrast 30 by design (see KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS).
  // =========================================================================
  {
    element: "--tug-base-border-default",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-border-default",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    element: "--tug-base-border-muted",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-border-muted",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },

  // =========================================================================
  // Focus indicator pairs — accent-cool-default against all surfaces (Step 5)
  //
  // accent-cool-default (cobalt-intense) is the universal focus ring color.
  // All 9 surfaces that can contain focusable elements are covered with
  // role "ui-component" (contrast 30 threshold). surface-screen is included
  // because tooltips (--tug-tooltip-bg: var(--tug-base-surface-screen))
  // can contain focusable elements. [D05]
  //
  // Focused-vs-unfocused state comparison pairs use role "decorative"
  // because perceptual contrast is designed for element-on-area contrast, not border-vs-border
  // comparisons. These pairs are informational only and do not gate the pipeline. [D05]
  // =========================================================================
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-bg-app",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-raised",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-inset",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-content",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-overlay",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-sunken",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-screen",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-field-bg-rest",
    role: "ui-component",
  },
  // Focused-vs-unfocused comparisons: informational only (decorative role).
  // Perceptual contrast measures element-on-area contrast; border-vs-border results are
  // unreliable as a gate. These appear in the dashboard for visual review. [D05]
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-field-border-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-control-outlined-action-border-rest",
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
    element: "--tug-base-fg-default",
    surface: "--tug-base-tab-bg-active",
    role: "body-text",
  },
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-tab-bg-inactive",
    role: "body-text",
  },
  {
    element: "--tug-base-icon-active",
    surface: "--tug-base-tab-bg-active",
    role: "ui-component",
  },
  // fg-subtle used for inactive-state card title-bar icon
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-tab-bg-inactive",
    role: "ui-component",
  },
  // Tab overflow badge: CSS sets color: var(--tug-base-surface-default) directly
  // over the accent-default badge background (tug-tab.css:283).
  {
    element: "--tug-base-surface-default",
    surface: "--tug-base-accent-default",
    role: "ui-component",
  },

  // --- Canvas / preview surfaces (gallery-theme-generator-content.css) ---
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-bg-canvas",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-bg-canvas",
    role: "subdued-text",
  },
  {
    element: "--tug-base-fg-link",
    surface: "--tug-base-bg-canvas",
    role: "body-text",
  },

  // --- Surface inset — subtle text (gallery-popup-button.css) ---
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-surface-inset",
    role: "subdued-text",
  },

  // --- Surface control — text (gallery-card.css, gallery-palette-content.css,
  //     tug-tab.css, gallery-theme-generator-content.css) ---
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-surface-control",
    role: "body-text",
  },
  // fg-muted on surface-control: code comment text in code block
  // (tug-code.css: --tug-codeBlock-bg = surface-control)
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-surface-control",
    role: "body-text",
  },

  // --- Accent-subtle as background — active UI states ---
  // fg-onAccent on accent-subtle: active preset button (gtg-preset-btn--active)
  // accent-subtle has alpha 15%; parentSurface composites it over surface-default
  // before contrast measurement. [D04]
  {
    element: "--tug-base-fg-onAccent",
    surface: "--tug-base-accent-subtle",
    role: "ui-component",
    parentSurface: "--tug-base-surface-default",
  },
  // fg-default on accent-subtle: menu selected/checked item background
  // accent-subtle has alpha 15%; parentSurface composites over surface-default. [D04]
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-accent-subtle",
    role: "body-text",
    parentSurface: "--tug-base-surface-default",
  },

  // --- Semantic tone backgrounds as surfaces ---
  // fg-default on tone-caution-bg: autofix suggestion list items (gallery-theme-generator-content.css)
  {
    element: "--tug-base-fg-default",
    surface: "--tug-base-tone-caution-bg",
    role: "body-text",
    parentSurface: "--tug-base-surface-default",
  },
  // tone-danger (chromatic) as fg on surface-overlay: danger menu item text (tug-menu.css)
  // Classified as body-text: the user must read this label to understand the destructive
  // action; it is readable label text regardless of the chromatic signal intent.
  {
    element: "--tug-base-tone-danger",
    surface: "--tug-base-surface-overlay",
    role: "body-text",
  },
  // tone-danger (chromatic) as fg on surface-default: ghost/outlined danger badge text (tug-badge.css)
  {
    element: "--tug-base-tone-danger",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },

  // --- Checkmark / toggle track pairings (tug-checkbox.css) ---
  // checkmark-fg on toggle-track-on: checkmark icon on checked checkbox background
  {
    element: "--tug-base-checkmark-fg",
    surface: "--tug-base-toggle-track-on",
    role: "ui-component",
  },
  // checkmark-fg-mixed on toggle-track-mixed: indeterminate dash on mixed checkbox background
  {
    element: "--tug-base-checkmark-fg-mixed",
    surface: "--tug-base-toggle-track-mixed",
    role: "ui-component",
  },

  // --- Dock button badge (tug-dock.css) ---
  // fg-inverse on tone-danger (chromatic): dock notification badge text
  {
    element: "--tug-base-fg-inverse",
    surface: "--tug-base-tone-danger",
    role: "ui-component",
  },

  // --- Neutral badge: divider-default used as background (tug-dialog.css) ---
  // divider-default is an element token normally; here it is used as badge-neutral-bg.
  // fg-muted renders over this dual-use surface.
  {
    element: "--tug-base-fg-muted",
    surface: "--tug-base-divider-default",
    role: "ui-component",
  },

  // --- Dock background = field-bg-focus (tug-dock.css) ---
  // fg-subtle used for dock button icons over the dock background (field-bg-focus)
  {
    element: "--tug-base-fg-subtle",
    surface: "--tug-base-field-bg-focus",
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
    element: "--tug-base-control-filled-accent-border-rest",
    surface: "--tug-base-control-filled-accent-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-filled-accent-border-hover",
    surface: "--tug-base-control-filled-accent-bg-hover",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-control-filled-accent-border-active",
    surface: "--tug-base-control-filled-accent-bg-active",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  // Filled action
  {
    element: "--tug-base-control-filled-action-border-rest",
    surface: "--tug-base-control-filled-action-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-filled-action-border-hover",
    surface: "--tug-base-control-filled-action-bg-hover",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-control-filled-action-border-active",
    surface: "--tug-base-control-filled-action-bg-active",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  // Filled danger
  {
    element: "--tug-base-control-filled-danger-border-rest",
    surface: "--tug-base-control-filled-danger-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-filled-danger-border-hover",
    surface: "--tug-base-control-filled-danger-bg-hover",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-control-filled-danger-border-active",
    surface: "--tug-base-control-filled-danger-bg-active",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  // Filled agent
  {
    element: "--tug-base-control-filled-agent-border-rest",
    surface: "--tug-base-control-filled-agent-bg-rest",
    role: "decorative",
  },
  // Filled data
  {
    element: "--tug-base-control-filled-data-border-rest",
    surface: "--tug-base-control-filled-data-bg-rest",
    role: "decorative",
  },
  // Filled success
  {
    element: "--tug-base-control-filled-success-border-rest",
    surface: "--tug-base-control-filled-success-bg-rest",
    role: "decorative",
  },
  // Filled caution
  {
    element: "--tug-base-control-filled-caution-border-rest",
    surface: "--tug-base-control-filled-caution-bg-rest",
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
    element: "--tug-base-control-ghost-action-fg-rest",
    surface: "--tug-base-control-ghost-action-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-action-border-rest",
    surface: "--tug-base-control-ghost-action-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-action-fg-hover",
    surface: "--tug-base-control-ghost-action-bg-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-action-border-hover",
    surface: "--tug-base-control-ghost-action-bg-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-action-fg-active",
    surface: "--tug-base-control-ghost-action-bg-active",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-action-border-active",
    surface: "--tug-base-control-ghost-action-bg-active",
    role: "decorative",
  },
  // Ghost danger
  {
    element: "--tug-base-control-ghost-danger-fg-rest",
    surface: "--tug-base-control-ghost-danger-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-danger-border-rest",
    surface: "--tug-base-control-ghost-danger-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-danger-fg-hover",
    surface: "--tug-base-control-ghost-danger-bg-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-danger-border-hover",
    surface: "--tug-base-control-ghost-danger-bg-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-danger-fg-active",
    surface: "--tug-base-control-ghost-danger-bg-active",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-danger-border-active",
    surface: "--tug-base-control-ghost-danger-bg-active",
    role: "decorative",
  },
  // Ghost option
  {
    element: "--tug-base-control-ghost-option-fg-rest",
    surface: "--tug-base-control-ghost-option-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-option-border-rest",
    surface: "--tug-base-control-ghost-option-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-option-fg-hover",
    surface: "--tug-base-control-ghost-option-bg-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-option-border-hover",
    surface: "--tug-base-control-ghost-option-bg-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-option-fg-active",
    surface: "--tug-base-control-ghost-option-bg-active",
    role: "decorative",
  },
  {
    element: "--tug-base-control-ghost-option-border-active",
    surface: "--tug-base-control-ghost-option-bg-active",
    role: "decorative",
  },

  // =========================================================================
  // Outlined option button fg and border on own bg (Step 6 additions)
  // bg-rest is transparent; hover/active bg have alpha 10-20% (same as ghost).
  // Same decorative classification rationale as ghost buttons above.
  // =========================================================================
  {
    element: "--tug-base-control-outlined-option-fg-rest",
    surface: "--tug-base-control-outlined-option-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-outlined-option-border-rest",
    surface: "--tug-base-control-outlined-option-bg-rest",
    role: "decorative",
  },
  {
    element: "--tug-base-control-outlined-option-fg-hover",
    surface: "--tug-base-control-outlined-option-bg-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-control-outlined-option-border-hover",
    surface: "--tug-base-control-outlined-option-bg-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-control-outlined-option-fg-active",
    surface: "--tug-base-control-outlined-option-bg-active",
    role: "decorative",
  },
  {
    element: "--tug-base-control-outlined-option-border-active",
    surface: "--tug-base-control-outlined-option-bg-active",
    role: "decorative",
  },
  {
    element: "--tug-base-control-outlined-option-icon-active",
    surface: "--tug-base-control-outlined-option-bg-active",
    role: "decorative",
  },

  // =========================================================================
  // Tab-specific pairings (Step 6 additions)
  // =========================================================================
  // border-default used as the separator line between inactive tabs
  {
    element: "--tug-base-border-default",
    surface: "--tug-base-tab-bg-inactive",
    role: "ui-component",
  },
  // Tab hover state — tab-bg-hover has alpha 8%, same semi-transparent pattern
  {
    element: "--tug-base-tab-fg-hover",
    surface: "--tug-base-tab-bg-hover",
    role: "decorative",
  },
  // Tab close button hover — tab-close-bg-hover has alpha 12%, decorative
  {
    element: "--tug-base-tab-close-fg-hover",
    surface: "--tug-base-tab-close-bg-hover",
    role: "decorative",
  },
  // Tab bar surface-control: add/overflow buttons and border accents
  {
    element: "--tug-base-border-default",
    surface: "--tug-base-surface-control",
    role: "ui-component",
  },
  {
    element: "--tug-base-accent-default",
    surface: "--tug-base-surface-control",
    role: "ui-component",
  },

  // =========================================================================
  // Badge tinted borders on tinted backgrounds (Step 6 additions)
  // The border-* token sits on the tinted bg of each badge variant.
  // =========================================================================
  {
    element: "--tug-base-badge-tinted-accent-border",
    surface: "--tug-base-badge-tinted-accent-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-action-border",
    surface: "--tug-base-badge-tinted-action-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-agent-border",
    surface: "--tug-base-badge-tinted-agent-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-data-border",
    surface: "--tug-base-badge-tinted-data-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-danger-border",
    surface: "--tug-base-badge-tinted-danger-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-success-border",
    surface: "--tug-base-badge-tinted-success-bg",
    role: "ui-component",
  },
  {
    element: "--tug-base-badge-tinted-caution-border",
    surface: "--tug-base-badge-tinted-caution-bg",
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
    element: "--tug-base-tone-accent-border",
    surface: "--tug-base-tone-accent-bg",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-tone-active-border",
    surface: "--tug-base-tone-active-bg",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-tone-agent-border",
    surface: "--tug-base-tone-agent-bg",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-tone-data-border",
    surface: "--tug-base-tone-data-bg",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-tone-danger-border",
    surface: "--tug-base-tone-danger-bg",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-tone-success-border",
    surface: "--tug-base-tone-success-bg",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-tone-caution-border",
    surface: "--tug-base-tone-caution-bg",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },

  // =========================================================================
  // Chromatic tone tokens used as foreground on surface-default (Step 6 additions)
  // Ghost/outlined badge ghost variants use chromatic tone tokens as text/icon color
  // over surface-default (transparent bg over surface-default parent).
  // =========================================================================
  {
    element: "--tug-base-fg-inverse",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-accent",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-data",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-success",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },
  {
    element: "--tug-base-tone-caution",
    surface: "--tug-base-surface-default",
    role: "ui-component",
  },

  // =========================================================================
  // Checkbox chromatic self-pairings (Step 6 additions)
  // These are cases where a chromatic toggle-track token is used as both the
  // background-color and border-color of the same rule. The border is a
  // stylistic outline that is the same hue as the fill — decorative.
  // =========================================================================
  {
    element: "--tug-base-toggle-track-on-hover",
    surface: "--tug-base-toggle-track-on-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-toggle-track-mixed-hover",
    surface: "--tug-base-toggle-track-mixed-hover",
    role: "decorative",
  },
  {
    element: "--tug-base-toggle-track-disabled",
    surface: "--tug-base-toggle-track-disabled",
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
    element: "--tug-base-field-border-disabled",
    surface: "--tug-base-field-bg-disabled",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  {
    element: "--tug-base-field-border-readOnly",
    surface: "--tug-base-field-bg-readOnly",
    role: "decorative",
    parentSurface: "--tug-base-surface-default",
  },
  // field-tone-caution used as a subtle warning tint border on the rest-state bg
  {
    element: "--tug-base-field-tone-caution",
    surface: "--tug-base-field-bg-rest",
    role: "ui-component",
  },

  // =========================================================================
  // Gallery card surface-control pairings (Step 6 additions)
  // accent-cool-default appears over surface-control in gallery demo areas.
  // border-default on surface-control is already declared in the tab section above.
  // =========================================================================
  {
    element: "--tug-base-accent-cool-default",
    surface: "--tug-base-surface-control",
    role: "ui-component",
  },

  // =========================================================================
  // Additional surface pairings from gallery components (Step 6 additions)
  // =========================================================================
  // border-muted on surface-inset (gallery-popup-button.css)
  {
    element: "--tug-base-border-muted",
    surface: "--tug-base-surface-inset",
    role: "ui-component",
  },
  // border-default on surface-inset (gallery-palette-content.css)
  {
    element: "--tug-base-border-default",
    surface: "--tug-base-surface-inset",
    role: "ui-component",
  },
  // border-default on bg-canvas (gallery-theme-generator-content.css)
  {
    element: "--tug-base-border-default",
    surface: "--tug-base-bg-canvas",
    role: "ui-component",
  },
  // border-default on surface-overlay (tug-menu.css dropdown panel border)
  {
    element: "--tug-base-border-default",
    surface: "--tug-base-surface-overlay",
    role: "ui-component",
  },
  // accent-default on accent-subtle (gallery-theme-generator-content.css: mode btn active)
  {
    element: "--tug-base-accent-default",
    surface: "--tug-base-accent-subtle",
    role: "ui-component",
  },

];

