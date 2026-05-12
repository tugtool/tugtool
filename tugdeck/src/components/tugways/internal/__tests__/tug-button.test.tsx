/**
 * TugButton — primitive tests.
 *
 * Scope: contracts that have to hold regardless of how a higher-level
 * variant (TugPushButton, TugIconButton, TugPopupButton) composes the
 * button. The full emphasis × role × size matrix is exercised
 * visually in the gallery card; this file pins the behavioral
 * contracts that aren't safe to defer to manual checks.
 *
 * Phase E.1 introduced controlled-confirmation: `isConfirming` lets
 * a parent drive the confirmed-state lifecycle instead of relying on
 * the button's internal `confirmation.duration` timer. The tests in
 * this file cover that mode end-to-end so a future refactor can't
 * accidentally break the "honest async feedback" contract that
 * TerminalBlock's Copy depends on.
 *
 * Per the happy-dom scoping rule we don't assert on visual paint
 * (CSS visibility, animation) — only on the `data-tug-confirming`
 * attribute and `aria-disabled`, which are appearance-zone DOM mutations
 * the primitive owns directly.
 */

import "../../../../__tests__/setup-rtl";

import React from "react";
import {
  afterEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { Check, Copy } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";

afterEach(() => {
  cleanup();
});

describe("TugButton — uncontrolled confirmation (existing behavior)", () => {
  test("click enters the confirmed state via the internal timer", () => {
    const { container } = render(
      <TugPushButton
        icon={<Copy />}
        subtype="icon-text"
        emphasis="ghost"
        size="2xs"
        aria-label="Copy"
        onClick={() => undefined}
        confirmation={{
          icon: <Check />,
          label: "Copied",
          duration: 1000,
        }}
      >
        Copy
      </TugPushButton>,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.dataset.tugConfirming).toBeUndefined();
    fireEvent.click(btn);
    // The uncontrolled path sets the attribute synchronously inside
    // the click handler.
    expect(btn.dataset.tugConfirming).toBe("true");
  });
});

describe("TugButton — controlled confirmation (Phase E.1)", () => {
  test("isConfirming={false} leaves the button in the rest state, even on click", () => {
    const onClick = mock(() => undefined);
    const { container } = render(
      <TugPushButton
        icon={<Copy />}
        subtype="icon-text"
        emphasis="ghost"
        size="2xs"
        aria-label="Copy"
        onClick={onClick}
        confirmation={{ icon: <Check />, label: "Copied" }}
        isConfirming={false}
      >
        Copy
      </TugPushButton>,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.dataset.tugConfirming).toBeUndefined();
    fireEvent.click(btn);
    // The click fires the onClick callback (so the parent can run
    // its async logic) but the button does NOT enter the confirmed
    // state on its own. The parent is responsible for flipping
    // `isConfirming` to true once the operation actually succeeds.
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn.dataset.tugConfirming).toBeUndefined();
  });

  test("isConfirming={true} enters the confirmed state with aria-disabled", () => {
    const { container } = render(
      <TugPushButton
        icon={<Copy />}
        subtype="icon-text"
        emphasis="ghost"
        size="2xs"
        aria-label="Copy"
        onClick={() => undefined}
        confirmation={{ icon: <Check />, label: "Copied" }}
        isConfirming={true}
      >
        Copy
      </TugPushButton>,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    // The controlled-mode useLayoutEffect runs at mount and writes
    // the attribute. aria-disabled is part of the confirmed shape
    // so screen readers announce the locked state during the flash.
    expect(btn.dataset.tugConfirming).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  test("flipping isConfirming false → true → false drives the attribute exactly", () => {
    function Harness({ isConfirming }: { isConfirming: boolean }) {
      return (
        <TugPushButton
          icon={<Copy />}
          subtype="icon-text"
          emphasis="ghost"
          size="2xs"
          aria-label="Copy"
          onClick={() => undefined}
          confirmation={{ icon: <Check />, label: "Copied" }}
          isConfirming={isConfirming}
        >
          Copy
        </TugPushButton>
      );
    }
    const { container, rerender } = render(<Harness isConfirming={false} />);
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.dataset.tugConfirming).toBeUndefined();

    rerender(<Harness isConfirming={true} />);
    expect(btn.dataset.tugConfirming).toBe("true");

    rerender(<Harness isConfirming={false} />);
    expect(btn.dataset.tugConfirming).toBeUndefined();
  });

  test("isConfirming + confirmation.duration fires a dev-mode warning", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <TugPushButton
          icon={<Copy />}
          subtype="icon-text"
          emphasis="ghost"
          size="2xs"
          aria-label="Copy"
          onClick={() => undefined}
          confirmation={{
            icon: <Check />,
            label: "Copied",
            duration: 1500,
          }}
          isConfirming={false}
        >
          Copy
        </TugPushButton>,
      );
      // The mount-time effect surfaces the conflicting-prop warning.
      const calls = warnSpy.mock.calls as ReadonlyArray<
        ReadonlyArray<unknown>
      >;
      const messages = calls
        .map((call) => call[0])
        .filter((arg): arg is string => typeof arg === "string");
      // Filter to messages from this component — other unrelated
      // warns shouldn't fail the test.
      const own = messages.filter((m) => m.includes("TugButton"));
      expect(own.length).toBe(1);
      expect(own[0]).toContain("isConfirming");
      expect(own[0]).toContain("confirmation.duration");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
