/**
 * Pure-logic tests for `tug-dialog-button.tsx`.
 *
 * `TugDialogButton` is a presentation primitive — its observable
 * behaviour is its prop-to-DOM mapping plus the small set of exported
 * helpers (`resolveDialogButtonMode`, `resolveSelectionStyle`,
 * `resolveDialogButtonRole`, `resolveDialogButtonAriaLabel`,
 * `shouldRenderTrailing`). Per project policy (pure-logic `bun:test`
 * + real-app tests; no fake-DOM render tests), this suite pins those
 * helpers exhaustively. The visual layout, focus-ring, hover/active
 * cascades, and check/radio glyph swap are vetted in the gallery
 * card and HMR-vetted end-to-end via the live `TugInlineDialog`
 * integration once the follow-on step lands.
 *
 * Coverage:
 *  - `resolveDialogButtonMode` — `undefined` → `"action"`; `true` and
 *    `false` → `"choice"` (the discriminator is presence of the prop,
 *    not its truthiness).
 *  - `resolveSelectionStyle` — action mode always returns `null`;
 *    choice mode defaults `undefined` to `"check"` and passes
 *    `"check"` / `"radio"` through.
 *  - `resolveDialogButtonRole` — `undefined` → `"action"`; explicit
 *    values pass through.
 *  - `resolveDialogButtonAriaLabel` — `undefined` falls back to label;
 *    explicit string passes through; empty string passes through
 *    (consumer's choice, not a "use default" signal).
 *  - `shouldRenderTrailing` — false in choice mode regardless of
 *    `trailing`; in action mode, false for null / undefined / false,
 *    true for any other ReactNode.
 */

import { describe, it, expect } from "bun:test";

import {
  DEFAULT_DIALOG_BUTTON_ROLE,
  DEFAULT_SELECTION_STYLE,
  resolveDialogButtonAriaLabel,
  resolveDialogButtonMode,
  resolveDialogButtonRole,
  resolveSelectionStyle,
  shouldRenderTrailing,
} from "./tug-dialog-button";

// ---------------------------------------------------------------------------
// resolveDialogButtonMode — discriminator
// ---------------------------------------------------------------------------

describe("resolveDialogButtonMode", () => {
  it("returns 'action' when `selected` is undefined", () => {
    expect(resolveDialogButtonMode(undefined)).toBe("action");
  });

  it("returns 'choice' when `selected` is true (prop present)", () => {
    expect(resolveDialogButtonMode(true)).toBe("choice");
  });

  it("returns 'choice' when `selected` is false (prop present, just unselected)", () => {
    // Critical: the discriminator is *presence* of the prop, not
    // truthiness. A `selected: false` button is a choice-mode button
    // currently in the unselected state — the selection affordance
    // still renders (as a blank placeholder for "check", as the
    // empty ring for "radio").
    expect(resolveDialogButtonMode(false)).toBe("choice");
  });
});

// ---------------------------------------------------------------------------
// resolveSelectionStyle — default + passthrough + action-mode null
// ---------------------------------------------------------------------------

describe("resolveSelectionStyle", () => {
  it("returns null in action mode regardless of selectionStyle", () => {
    // Action mode never renders a selection affordance.
    expect(resolveSelectionStyle("action", undefined)).toBeNull();
    expect(resolveSelectionStyle("action", "check")).toBeNull();
    expect(resolveSelectionStyle("action", "radio")).toBeNull();
  });

  it("defaults to 'check' in choice mode when omitted", () => {
    expect(resolveSelectionStyle("choice", undefined)).toBe("check");
    expect(DEFAULT_SELECTION_STYLE).toBe("check");
  });

  it("passes through 'check' in choice mode", () => {
    expect(resolveSelectionStyle("choice", "check")).toBe("check");
  });

  it("passes through 'radio' in choice mode", () => {
    expect(resolveSelectionStyle("choice", "radio")).toBe("radio");
  });
});

// ---------------------------------------------------------------------------
// resolveDialogButtonRole — default + passthrough
// ---------------------------------------------------------------------------

describe("resolveDialogButtonRole", () => {
  it("returns the default role when omitted", () => {
    expect(resolveDialogButtonRole(undefined)).toBe("action");
    expect(DEFAULT_DIALOG_BUTTON_ROLE).toBe("action");
  });

  it("passes through 'action'", () => {
    expect(resolveDialogButtonRole("action")).toBe("action");
  });

  it("passes through 'danger'", () => {
    expect(resolveDialogButtonRole("danger")).toBe("danger");
  });
});

// ---------------------------------------------------------------------------
// resolveDialogButtonAriaLabel — fallback + passthrough
// ---------------------------------------------------------------------------

describe("resolveDialogButtonAriaLabel", () => {
  it("falls back to `label` when ariaLabel is omitted", () => {
    expect(resolveDialogButtonAriaLabel("Allow", undefined)).toBe("Allow");
  });

  it("passes through an explicit ariaLabel", () => {
    expect(
      resolveDialogButtonAriaLabel("Allow", "Allow this command for the session"),
    ).toBe("Allow this command for the session");
  });

  it("passes through an empty string verbatim (consumer's choice, not 'use default')", () => {
    // Mirrors the contract baked into TugInlineDialog's
    // `resolveCancelLabel`: an empty string is a deliberate consumer
    // choice, not a sentinel for "use the default."
    expect(resolveDialogButtonAriaLabel("Allow", "")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// shouldRenderTrailing — choice-mode suppression + truthiness
// ---------------------------------------------------------------------------

describe("shouldRenderTrailing", () => {
  it("returns false in choice mode regardless of trailing content", () => {
    // Choice mode reserves the trailing edge for the selection
    // affordance — the trailing slot is silently ignored.
    expect(shouldRenderTrailing("choice", "anything")).toBe(false);
    expect(shouldRenderTrailing("choice", undefined)).toBe(false);
    expect(shouldRenderTrailing("choice", null)).toBe(false);
  });

  it("returns false in action mode when trailing is undefined / null / false", () => {
    expect(shouldRenderTrailing("action", undefined)).toBe(false);
    expect(shouldRenderTrailing("action", null)).toBe(false);
    expect(shouldRenderTrailing("action", false)).toBe(false);
  });

  it("returns true in action mode for any other truthy ReactNode", () => {
    expect(shouldRenderTrailing("action", "Cmd-S")).toBe(true);
    expect(shouldRenderTrailing("action", 0)).toBe(true); // 0 is a valid ReactNode (renders "0")
    expect(shouldRenderTrailing("action", "")).toBe(true); // empty string still flagged "render" — consumer's choice
  });
});
