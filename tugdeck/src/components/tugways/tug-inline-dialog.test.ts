/**
 * Pure-logic tests for `tug-inline-dialog.tsx`.
 *
 * `TugInlineDialog` is a presentation primitive — its observable
 * behaviour is its prop-to-DOM mapping plus a small set of exported
 * helpers (`iconRoleSlot`, `resolveCancelLabel`, `shouldRenderOptions`,
 * the `TUG_INLINE_DIALOG_ICON_ROLES` enumeration). Per project policy
 * (pure-logic `bun:test` + real-app tests; no fake-DOM render tests),
 * the suite pins those helpers exhaustively. The visual layout +
 * focus-on-mount + the radio-group integration with `TugDialogButton`
 * are vetted in the gallery card and HMR-vetted end-to-end via the
 * `PermissionDialog` adoption.
 *
 * Coverage:
 *  - `iconRoleSlot` — every declared role maps to its
 *    `--tugx-idialog-icon-{role}-color` slot.
 *  - `TUG_INLINE_DIALOG_ICON_ROLES` lists exactly the five expected
 *    roles in declaration order.
 *  - `resolveCancelLabel` — `undefined` → default; `null` →
 *    suppression; explicit string → passthrough; empty string →
 *    passthrough (the consumer's choice, not a "use default" signal).
 *  - `shouldRenderOptions` — `undefined` / `[]` → false; non-empty
 *    array → true.
 */

import { describe, it, expect } from "bun:test";

import {
  DEFAULT_CANCEL_LABEL,
  TUG_INLINE_DIALOG_ICON_ROLES,
  iconRoleSlot,
  resolveCancelLabel,
  shouldRenderOptions,
  type TugInlineDialogIconRole,
  type TugInlineDialogOption,
} from "./tug-inline-dialog";

// ---------------------------------------------------------------------------
// iconRoleSlot — slot-name contract
// ---------------------------------------------------------------------------

describe("iconRoleSlot", () => {
  it("maps every declared icon role to its --tugx-idialog-icon-{role}-color slot", () => {
    const expected: Record<TugInlineDialogIconRole, string> = {
      default: "--tugx-idialog-icon-default-color",
      caution: "--tugx-idialog-icon-caution-color",
      danger:  "--tugx-idialog-icon-danger-color",
      success: "--tugx-idialog-icon-success-color",
      info:    "--tugx-idialog-icon-info-color",
    };
    for (const role of TUG_INLINE_DIALOG_ICON_ROLES) {
      expect(iconRoleSlot(role)).toBe(expected[role]);
    }
  });
});

// ---------------------------------------------------------------------------
// TUG_INLINE_DIALOG_ICON_ROLES — enumeration contract
// ---------------------------------------------------------------------------

describe("TUG_INLINE_DIALOG_ICON_ROLES", () => {
  it("enumerates exactly the five declared roles in stable order", () => {
    expect(TUG_INLINE_DIALOG_ICON_ROLES).toEqual([
      "default",
      "caution",
      "danger",
      "success",
      "info",
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveCancelLabel — default / suppression / passthrough
// ---------------------------------------------------------------------------

describe("resolveCancelLabel", () => {
  it("returns the default label when the consumer omits the prop", () => {
    expect(resolveCancelLabel(undefined)).toBe(DEFAULT_CANCEL_LABEL);
    expect(DEFAULT_CANCEL_LABEL).toBe("Cancel");
  });

  it("returns null when the consumer passes null (suppress the cancel button)", () => {
    expect(resolveCancelLabel(null)).toBeNull();
  });

  it("passes through an explicit string", () => {
    expect(resolveCancelLabel("Deny")).toBe("Deny");
    expect(resolveCancelLabel("Discard")).toBe("Discard");
  });

  it("passes through an empty string verbatim (consumer's choice, not 'use default')", () => {
    expect(resolveCancelLabel("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// shouldRenderOptions — presence + non-empty
// ---------------------------------------------------------------------------

describe("shouldRenderOptions", () => {
  it("returns false when options is undefined (the no-radio path)", () => {
    expect(shouldRenderOptions(undefined)).toBe(false);
  });

  it("returns false for an empty array (consumer wired the prop but had no choices)", () => {
    // An empty array reaches the primitive when the consumer maps a
    // dynamic source (e.g. `permission_suggestions`) that resolved to
    // zero usable entries. The dialog should still render — just
    // without the options block.
    expect(shouldRenderOptions([])).toBe(false);
  });

  it("returns true for a non-empty array", () => {
    const opts: ReadonlyArray<TugInlineDialogOption> = [
      { value: "a", label: "Allow once" },
    ];
    expect(shouldRenderOptions(opts)).toBe(true);
  });
});
