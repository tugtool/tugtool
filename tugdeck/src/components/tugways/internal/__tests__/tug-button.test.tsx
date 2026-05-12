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
 * Phase E.3 inverted the `aria-disabled` contract for the confirming
 * path: the attribute is NO LONGER set during the confirming window.
 * Confirming is a transient feedback state, not a disabled state, and
 * setting `aria-disabled` was tripping the `:not([aria-disabled="true"])`
 * exclusions on rest-state hover rules and suppressing the button's
 * hover background while the user held the cursor over it. The tests
 * below pin the new contract so a future refactor can't reintroduce
 * the symptom. Phase E.3 also added `widthStabilize` for buttons whose
 * label swings between two values (e.g. the diff view-toggle's
 * "Inline" ↔ "Side by side"); tests below pin the CSS-grid structure
 * and the per-state alternate.
 *
 * Per the happy-dom scoping rule we don't assert on visual paint
 * (CSS visibility, animation) — only on the `data-tug-confirming`
 * attribute, `aria-disabled` absence/presence, and the static markup
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

  test("isConfirming={true} enters the confirmed state WITHOUT aria-disabled (Phase E.3)", () => {
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
    // Phase E.3 contract: the controlled-mode layout effect writes
    // `data-tug-confirming` but DOES NOT set `aria-disabled`.
    // Confirming is a transient feedback state, not a disabled state;
    // setting aria-disabled triggers the rest-state CSS rule
    // exclusions (`:not([aria-disabled="true"])`) and suppresses the
    // hover background while the user holds the cursor on the button.
    // Click suppression is handled by the JS `confirmingRef` guard
    // inside the click handler, not by DOM-level gating.
    expect(btn.dataset.tugConfirming).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBeNull();
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

describe("TugButton — Phase E.3 width-stabilize + confirming-hover", () => {
  test("widthStabilize renders both labels inside a single stable-label grid", () => {
    const { container } = render(
      <TugPushButton
        emphasis="ghost"
        size="2xs"
        widthStabilize={{ alternateLabel: "Side by side" }}
      >
        Inline
      </TugPushButton>,
    );
    const wrap = container.querySelector(".tug-button-stable-label");
    expect(wrap).not.toBeNull();
    const active = wrap?.querySelector('[data-tug-stable-label="active"]');
    const alternate = wrap?.querySelector(
      '[data-tug-stable-label="alternate"]',
    );
    expect(active?.textContent).toBe("Inline");
    expect(alternate?.textContent).toBe("Side by side");
    // The alternate is hidden from assistive tech so screen readers
    // don't double-announce.
    expect(alternate?.getAttribute("aria-hidden")).toBe("true");
  });

  test("widthStabilize composes with icon-text subtype (icon + grid label)", () => {
    // The view-toggle uses text subtype; Copy could opt in with
    // icon-text. Verify the grid wrapper sits inside the icon-text
    // wrapper without breaking the icon adjacency.
    const { container } = render(
      <TugPushButton
        icon={<Copy />}
        subtype="icon-text"
        emphasis="ghost"
        size="2xs"
        widthStabilize={{ alternateLabel: "Copied" }}
      >
        Copy
      </TugPushButton>,
    );
    const iconText = container.querySelector(".tug-button-icon-text");
    expect(iconText).not.toBeNull();
    expect(iconText?.querySelector(".tug-button-stable-label")).not.toBeNull();
  });

  test("CSS source declares the confirming + hover companion rule", () => {
    // Phase E.3: the rest-state hover rules exclude
    // `:not([aria-disabled="true"])` but Phase E.3 stops setting
    // aria-disabled during confirming. Without a companion hover rule
    // the rest-state hover would paint over the confirming background
    // when the user keeps the cursor on the button through the
    // "Copied" flash — the exact symptom the user reported. The
    // companion rule below ensures the confirming-hover paints at
    // equal-or-greater specificity and source-order precedence over
    // the rest-state hover rule.
    const css = readFileSync(TUG_BUTTON_CSS_PATH, "utf8");
    expect(css).toMatch(
      /\.tug-button-ghost-action\[data-tug-confirming="true"\]:hover:not\(:disabled\)\s*\{/,
    );
    // It must NOT be merely a hover-less confirming rule (the bug we
    // are fixing).
    const matches = css.match(
      /\.tug-button-ghost-action\[data-tug-confirming="true"\][^{]*\{/g,
    ) ?? [];
    const hasHoverCompanion = matches.some((m) => m.includes(":hover"));
    expect(hasHoverCompanion).toBe(true);
  });

  test("TugButton source uses data-tug-flush to revalidate selector matching on confirming clear", () => {
    // Phase E.3 forces WebKit to re-evaluate `:hover` selector
    // matching after the confirming attribute is removed. The mechanism
    // is a no-op attribute toggle (`data-tug-flush` set then unset)
    // inside the same effect that clears `data-tug-confirming`. Without
    // it, the resting hover background lags until the user moves their
    // mouse. Pin the pattern in the source so a future cleanup can't
    // accidentally drop it.
    const tsxPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "tug-button.tsx",
    );
    const src = readFileSync(tsxPath, "utf8");
    // The pattern: set then delete the same attribute in adjacent
    // statements within the controlled-mode revert branch.
    expect(src).toMatch(/dataset\.tugFlush\s*=\s*"1"/);
    expect(src).toMatch(/delete\s+\w+\.dataset\.tugFlush/);
  });

  test("TugButton source no longer sets aria-disabled in either confirming path", () => {
    // Companion to the "no aria-disabled in confirming" runtime test
    // above. Reading the source ensures NEITHER the controlled NOR
    // the uncontrolled timer path resurrects the attribute via some
    // other mechanism (a setter, a className compound, etc.) — both
    // paths must rely solely on `data-tug-confirming` for state.
    const tsxPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "tug-button.tsx",
    );
    const src = readFileSync(tsxPath, "utf8");
    // The only `aria-disabled` reference allowed is the chain-disabled
    // path via the React `ariaDisabled` variable. Confirming-related
    // imperative `setAttribute("aria-disabled", ...)` must not exist.
    expect(src).not.toMatch(/setAttribute\(\s*"aria-disabled"/);
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
