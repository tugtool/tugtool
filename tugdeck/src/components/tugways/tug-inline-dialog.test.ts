/**
 * Pure-logic tests for `tug-inline-dialog.tsx`.
 *
 * `TugInlineDialog` is a presentation primitive — its observable
 * behaviour is its prop-to-DOM mapping plus three small exported
 * helpers (`iconRoleSlot`, `resolveCancelLabel`, the
 * `TUG_INLINE_DIALOG_ICON_ROLES` enumeration). Per project policy
 * (pure-logic `bun:test` + real-app tests; no fake-DOM render tests),
 * the suite pins those helpers exhaustively. The visual layout +
 * focus-on-mount are vetted in the gallery card and HMR-vetted
 * end-to-end via the PermissionDialog adoption.
 *
 * Coverage:
 *  - `iconRoleSlot` — every declared role maps to its
 *    `--tugx-idialog-icon-{role}-color` slot.
 *  - `TUG_INLINE_DIALOG_ICON_ROLES` lists exactly the five expected
 *    roles in declaration order.
 *  - `resolveCancelLabel` — `undefined` → default; `null` →
 *    suppression; explicit string → passthrough; empty string →
 *    passthrough (the consumer's choice, not a "use default" signal).
 */

import { describe, it, expect } from "bun:test";

import {
  DEFAULT_CANCEL_LABEL,
  TUG_INLINE_DIALOG_ICON_ROLES,
  iconRoleSlot,
  partitionDialogActions,
  resolveCancelLabel,
  type TugInlineDialogIconRole,
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
// partitionDialogActions — extra-actions row-grid partition
// ---------------------------------------------------------------------------

describe("partitionDialogActions", () => {
  it("returns an empty array for n <= 0", () => {
    expect(partitionDialogActions(0)).toEqual([]);
    expect(partitionDialogActions(-1)).toEqual([]);
  });

  it("returns a single row for 1, 2, 3 buttons", () => {
    expect(partitionDialogActions(1)).toEqual([1]);
    expect(partitionDialogActions(2)).toEqual([2]);
    expect(partitionDialogActions(3)).toEqual([3]);
  });

  it("partitions 4 into 2 over 2 (avoids 3+1 dangling)", () => {
    expect(partitionDialogActions(4)).toEqual([2, 2]);
  });

  it("partitions 5 into 3 over 2", () => {
    expect(partitionDialogActions(5)).toEqual([3, 2]);
  });

  it("partitions 6 into two rows of 3", () => {
    expect(partitionDialogActions(6)).toEqual([3, 3]);
  });

  it("partitions 7 into 3 + 2 + 2 (avoids a 1-button trailing row)", () => {
    expect(partitionDialogActions(7)).toEqual([3, 2, 2]);
  });

  it("partitions 8 into 3 + 3 + 2", () => {
    expect(partitionDialogActions(8)).toEqual([3, 3, 2]);
  });

  it("partitions 9 into three rows of 3", () => {
    expect(partitionDialogActions(9)).toEqual([3, 3, 3]);
  });

  it("continues the pattern for N > 9", () => {
    // 10 = 9 + 1 → replace one 3-row with two 2-rows: [3,3,2,2].
    expect(partitionDialogActions(10)).toEqual([3, 3, 2, 2]);
    // 11 = 9 + 2 → top rows of 3 + trailing 2: [3,3,3,2].
    expect(partitionDialogActions(11)).toEqual([3, 3, 3, 2]);
    // 12 = 4 × 3.
    expect(partitionDialogActions(12)).toEqual([3, 3, 3, 3]);
  });

  it("every partition's row counts sum to n and each row holds 1..3 buttons", () => {
    for (let n = 1; n <= 20; n += 1) {
      const rows = partitionDialogActions(n);
      const total = rows.reduce((acc, c) => acc + c, 0);
      expect(total).toBe(n);
      for (const c of rows) {
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(3);
      }
    }
  });
});
