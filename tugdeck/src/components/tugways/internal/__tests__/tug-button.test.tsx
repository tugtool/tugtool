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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Check, Copy } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";

// Path to the source `tug-button.css` — used by the metric-tokens
// test below. happy-dom doesn't run the actual CSS pipeline, so a
// runtime `getComputedStyle` read returns empty; reading the source
// is the right granularity for "tokens are declared and the rules
// consume them."
const TUG_BUTTON_CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "tug-button.css",
);

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

describe("TugButton — published size metrics (Phase E.2)", () => {
  test("each size publishes height / padding-inline / font-size / icon-size on `body`", () => {
    // The metric tokens are TugButton's contract with sibling
    // components that need to match its geometry without composing
    // a TugButton (e.g., `enhanceFencedCode`'s imperative Copy
    // button). Pin the per-size four-tuple here so a future refactor
    // can't accidentally drop one and let a consumer silently drift.
    const css = readFileSync(TUG_BUTTON_CSS_PATH, "utf8");
    const sizes = ["2xs", "xs", "sm", "md", "lg"] as const;
    const metrics = ["height", "padding-inline", "font-size", "icon-size"] as const;
    for (const size of sizes) {
      for (const metric of metrics) {
        const token = `--tug-button-${size}-${metric}`;
        // The token must be declared at least once (in the `body{}`
        // block) and consumed at least once (in a size-class rule).
        const declarations = css.match(
          new RegExp(`${token}\\s*:`, "g"),
        );
        expect(declarations).not.toBeNull();
        expect(declarations!.length).toBeGreaterThanOrEqual(1);
        const consumptions = css.match(
          new RegExp(`var\\(\\s*${token}\\s*[\\),]`, "g"),
        );
        expect(consumptions).not.toBeNull();
        expect(consumptions!.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("the size-class CSS rules consume the metric tokens (no rem literals)", () => {
    const css = readFileSync(TUG_BUTTON_CSS_PATH, "utf8");
    // Extract each `.tug-button-size-{N}` rule body. Each must
    // reference `var(--tug-button-{N}-*)` and must NOT contain a
    // bare `\d+rem` literal in its height/padding/font-size — those
    // would mean the rule shipped a constant the metric tokens are
    // supposed to own.
    for (const size of ["2xs", "xs", "sm", "md", "lg"] as const) {
      const re = new RegExp(`\\.tug-button-size-${size}\\s*\\{([^}]+)\\}`);
      const body = css.match(re)?.[1] ?? "";
      expect(body.length).toBeGreaterThan(0);
      expect(body).toContain(`var(--tug-button-${size}-height)`);
      expect(body).toContain(`var(--tug-button-${size}-padding-inline)`);
      // No bare-rem literals — the rule consumes tokens only.
      const remLiterals = body.match(/\b\d*\.?\d+rem\b/g) ?? [];
      expect(remLiterals).toEqual([]);
    }
  });
});
