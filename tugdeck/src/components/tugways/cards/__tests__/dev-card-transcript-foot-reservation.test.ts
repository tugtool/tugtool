/**
 * dev-card-transcript-foot-reservation.test.ts — pure decision tests
 * for the assistant-cell foot height reservation.
 *
 * Covers `shouldReserveOnDismiss` — fire the floor exactly on the
 * dialog-dismissal edge. The imperative half (the direct `store
 * .subscribe` observer, the `ResizeObserver` fill-release, and the
 * `min-height` DOM writes) is exercised in the running app, per the
 * pure-logic + real-app split.
 */

import { describe, expect, test } from "bun:test";

import { shouldReserveOnDismiss } from "../dev-card-transcript-foot-reservation";

describe("shouldReserveOnDismiss", () => {
  test("reserves on the dismissal edge (dialog was present, now gone)", () => {
    expect(
      shouldReserveOnDismiss({
        wasDialogPresent: true,
        isDialogPresent: false,
        alreadyReserved: false,
      }),
    ).toBe(true);
  });

  test("does not reserve while the dialog is still live", () => {
    expect(
      shouldReserveOnDismiss({
        wasDialogPresent: true,
        isDialogPresent: true,
        alreadyReserved: false,
      }),
    ).toBe(false);
  });

  test("does not reserve on ordinary streaming (no dialog before or now)", () => {
    // The subscriber fires on every dispatch; a notification with no
    // dialog on either side is a normal streaming tick, not a dismissal.
    expect(
      shouldReserveOnDismiss({
        wasDialogPresent: false,
        isDialogPresent: false,
        alreadyReserved: false,
      }),
    ).toBe(false);
  });

  test("does not reserve when a dialog first appears", () => {
    expect(
      shouldReserveOnDismiss({
        wasDialogPresent: false,
        isDialogPresent: true,
        alreadyReserved: false,
      }),
    ).toBe(false);
  });

  test("does not double-reserve while a floor is already held", () => {
    expect(
      shouldReserveOnDismiss({
        wasDialogPresent: true,
        isDialogPresent: false,
        alreadyReserved: true,
      }),
    ).toBe(false);
  });
});
