/**
 * `tug-prompt-entry-submit-button` — the pure projection from a
 * `TideSubmitButtonMode` onto the prompt-entry submit / stop button's
 * view.
 *
 * The submit button is a single `<button>` DOM node whose appearance
 * and behaviour are entirely a function of the lifecycle-derived
 * `submitButtonMode` ([L26] — one node across every mode; only the
 * label / icon / `disabled` / `data-mode` change, never the element).
 * `resolveSubmitButtonView` is that function: it maps the six
 * `submitButtonMode` kinds onto the `data-mode` attribute CSS keys
 * off ([L06]), the per-mode `aria-label`, the `disabled` flag, the
 * icon glyph, and the danger-role flag.
 *
 * Pure module — no DOM, no React. The button component in
 * `tug-prompt-entry.tsx` consumes this; the derivation is unit-tested
 * in isolation.
 *
 * @module components/tugways/tug-prompt-entry-submit-button
 */

import type { TideSubmitButtonMode } from "@/lib/code-session-store/lifecycle-state";

/** The submit button's view for one `submitButtonMode` kind. */
export interface SubmitButtonView {
  /**
   * `data-mode` attribute value — CSS keys the per-mode visual
   * treatment off this. Kebab-cased (the `submitButtonMode` kinds are
   * snake-cased).
   */
  dataMode:
    | "submit"
    | "stop"
    | "awaiting-user"
    | "stopping"
    | "reconnecting"
    | "restoring";
  /** `aria-label` for the icon-only button — the mode's accessible name. */
  ariaLabel: string;
  /**
   * Native `disabled`. True for the four inert modes; a native-disabled
   * `<button>` rejects click AND keyboard activation AND the chain
   * action-dispatch, and leaves the tab order — so this single flag is
   * the whole "keyboard activation respects disabled modes" contract
   * for the button. (The `submit` kind is never disabled here; its
   * "disabled when the prompt is empty" is editor-draft emptiness,
   * carried separately by the `data-empty` attribute + CSS.)
   */
  disabled: boolean;
  /** Which glyph the icon-only button shows. */
  icon: "submit" | "stop";
  /** `role="danger"` (the stop family) vs `role="action"` (everything else). */
  danger: boolean;
}

/**
 * Project a `submitButtonMode` onto the submit button's view.
 *
 * The `submit` kind's `queued` flag is read through but does not
 * change the view — a queued Submit renders as an ordinary Submit;
 * its distinct "will send on idle" visual is a deferred design.
 */
export function resolveSubmitButtonView(
  mode: TideSubmitButtonMode,
): SubmitButtonView {
  switch (mode.kind) {
    case "submit":
      return {
        dataMode: "submit",
        ariaLabel: "Send prompt",
        disabled: false,
        icon: "submit",
        danger: false,
      };
    case "stop":
      return {
        dataMode: "stop",
        ariaLabel: "Stop turn",
        disabled: false,
        icon: "stop",
        danger: true,
      };
    case "awaiting_user":
      return {
        dataMode: "awaiting-user",
        ariaLabel: "Awaiting your input",
        disabled: true,
        icon: "submit",
        danger: false,
      };
    case "stopping":
      return {
        dataMode: "stopping",
        ariaLabel: "Stopping turn",
        disabled: true,
        icon: "stop",
        danger: true,
      };
    case "reconnecting":
      return {
        dataMode: "reconnecting",
        ariaLabel: "Reconnecting",
        disabled: true,
        icon: "submit",
        danger: false,
      };
    case "restoring":
      return {
        dataMode: "restoring",
        ariaLabel: "Restoring session",
        disabled: true,
        icon: "submit",
        danger: false,
      };
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}
