/**
 * tide-interactive-dialog.test.ts — pure-logic tests for the
 * `TideInteractiveDialog` input-form primitive.
 *
 * Coverage:
 *  - `DEFAULT_CANCEL_ROLE` is the family's outlined-danger vocabulary.
 *  - `resolveCancelRole` defaults to `DEFAULT_CANCEL_ROLE` when the
 *    caller omits the prop, and returns the caller's value otherwise.
 *  - Calling the component as a function produces a `TugInlineDialog`
 *    React element with:
 *      - the resolved `cancelRole` (default substitution applied),
 *      - the caller's `cancelRole` honoured when present (carve-out
 *        path for `PermissionDialog`'s `Deny`),
 *      - `confirmDisabled` passed through unchanged (Spec S01),
 *      - the `tide-interactive-dialog` className composed onto any
 *        consumer-supplied `className`.
 *
 * No fake-DOM rendering — these tests inspect React-element data
 * structures directly (the result of calling the function component
 * with props). Per project policy: pure-logic `bun:test` + real-app
 * tests only.
 */

import { describe, it, expect } from "bun:test";

import {
  DEFAULT_CANCEL_ROLE,
  TideInteractiveDialog,
  type TideInteractiveDialogProps,
  resolveCancelRole,
} from "./tide-interactive-dialog";
import { TugInlineDialog } from "./tug-inline-dialog";

// ---------------------------------------------------------------------------
// Shared fixture — valid prop bag with every required `TugInlineDialog` prop.
// ---------------------------------------------------------------------------

/** Build a minimal valid props object. The test's interesting field
 * overrides on top. */
function baseProps(
  overrides: Partial<TideInteractiveDialogProps> = {},
): TideInteractiveDialogProps {
  return {
    icon: null,
    title: "Test title",
    description: "Test description",
    confirmLabel: "Confirm",
    onConfirm: () => {},
    onCancel: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DEFAULT_CANCEL_ROLE — the family vocabulary.
// ---------------------------------------------------------------------------

describe("DEFAULT_CANCEL_ROLE", () => {
  it("is the outlined-danger family vocabulary [D03]", () => {
    expect(DEFAULT_CANCEL_ROLE).toBe("danger");
  });
});

// ---------------------------------------------------------------------------
// resolveCancelRole — pure helper.
// ---------------------------------------------------------------------------

describe("resolveCancelRole", () => {
  it("defaults to DEFAULT_CANCEL_ROLE when the caller omits the prop", () => {
    expect(resolveCancelRole(undefined)).toBe(DEFAULT_CANCEL_ROLE);
    expect(resolveCancelRole(undefined)).toBe("danger");
  });

  it("returns the caller's value when present — 'action' override", () => {
    // The PermissionDialog `Deny` carve-out path: caller passes
    // `cancelRole="action"` explicitly to opt out of the family
    // danger-tone default.
    expect(resolveCancelRole("action")).toBe("action");
  });

  it("returns the caller's value when present — 'danger' echo", () => {
    // Explicit "danger" matches the family default; the helper still
    // returns the caller's value rather than coalescing.
    expect(resolveCancelRole("danger")).toBe("danger");
  });
});

// ---------------------------------------------------------------------------
// TideInteractiveDialog as a function — React-element inspection.
// ---------------------------------------------------------------------------

describe("TideInteractiveDialog (function component)", () => {
  it("renders a TugInlineDialog element (composition target)", () => {
    const element = TideInteractiveDialog(baseProps());
    // `React.FC` returns a `React.ReactNode`; a successful function
    // call here produces a React element whose `type` is the
    // composed-on `TugInlineDialog`. Narrow the union before
    // inspecting `.props` so the test fails clearly on a shape
    // change rather than throwing on a property access.
    expect(element).not.toBeNull();
    expect(typeof element).toBe("object");
    expect((element as { type: unknown }).type).toBe(TugInlineDialog);
  });

  it("defaults `cancelRole` to 'danger' when the caller omits it", () => {
    const element = TideInteractiveDialog(baseProps()) as {
      props: { cancelRole: string };
    };
    expect(element.props.cancelRole).toBe("danger");
    expect(element.props.cancelRole).toBe(DEFAULT_CANCEL_ROLE);
  });

  it("`cancelRole='action'` from the caller overrides the default", () => {
    const element = TideInteractiveDialog(
      baseProps({ cancelRole: "action" }),
    ) as { props: { cancelRole: string } };
    expect(element.props.cancelRole).toBe("action");
  });

  it("`confirmDisabled` passes through to TugInlineDialog unchanged", () => {
    const trueElement = TideInteractiveDialog(
      baseProps({ confirmDisabled: true }),
    ) as { props: { confirmDisabled: boolean | undefined } };
    expect(trueElement.props.confirmDisabled).toBe(true);

    const falseElement = TideInteractiveDialog(
      baseProps({ confirmDisabled: false }),
    ) as { props: { confirmDisabled: boolean | undefined } };
    expect(falseElement.props.confirmDisabled).toBe(false);

    const omittedElement = TideInteractiveDialog(baseProps()) as {
      props: { confirmDisabled: boolean | undefined };
    };
    expect(omittedElement.props.confirmDisabled).toBeUndefined();
  });

  it("composes the `tide-interactive-dialog` className onto consumer classes", () => {
    // No consumer className — the family class is the only entry.
    const bare = TideInteractiveDialog(baseProps()) as {
      props: { className: string };
    };
    expect(bare.props.className).toContain("tide-interactive-dialog");

    // Consumer className present — both classes are present so the
    // outer scope (e.g., `.tide-question-dialog`) and the family
    // scope coexist in the cascade.
    const composed = TideInteractiveDialog(
      baseProps({ className: "tide-question-dialog" }),
    ) as { props: { className: string } };
    expect(composed.props.className).toContain("tide-interactive-dialog");
    expect(composed.props.className).toContain("tide-question-dialog");
  });

  it("passes the family className first so consumer classes can override", () => {
    // CSS cascade is order-independent for class selectors of equal
    // specificity, but consumer-supplied classes appearing *after*
    // the family class makes the intent legible in the markup. This
    // test pins the order to catch accidental reversals.
    const composed = TideInteractiveDialog(
      baseProps({ className: "tide-question-dialog" }),
    ) as { props: { className: string } };
    const familyIdx = composed.props.className.indexOf(
      "tide-interactive-dialog",
    );
    const consumerIdx = composed.props.className.indexOf(
      "tide-question-dialog",
    );
    expect(familyIdx).toBeGreaterThanOrEqual(0);
    expect(consumerIdx).toBeGreaterThanOrEqual(0);
    expect(familyIdx).toBeLessThan(consumerIdx);
  });
});
