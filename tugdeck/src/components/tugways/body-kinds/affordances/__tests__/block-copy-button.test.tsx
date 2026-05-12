/**
 * `BlockCopyButton` — affordance library tests.
 *
 * Pins the contract that future body kinds compose against: click
 * → clipboard write of the `getText` return value, success → flash
 * (controlled `isConfirming` flips to true), failure → no flash,
 * empty getText → no-op click. The visual layer (uppercase + 0.06em
 * letter-spacing, ghost emphasis, 2xs scale, width-stabilize for
 * Copy→Copied) is exercised at the TugButton level; here we focus
 * on the affordance's own behavior.
 */

import "../../../../../__tests__/setup-rtl";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";

import { BlockCopyButton } from "../block-copy-button";

afterEach(() => {
  cleanup();
});

describe("BlockCopyButton", () => {
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  });

  afterEach(() => {
    if (originalClipboard !== undefined) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (navigator as any).clipboard;
    }
  });

  test("renders as a button with the provided aria-label and a Copy label", () => {
    const { container } = render(
      <BlockCopyButton aria-label="Copy thing" getText={() => "hi"} />,
    );
    const btn = container.querySelector(
      'button[aria-label="Copy thing"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // The rest content's label is "Copy". The button's textContent
    // includes both the rest label and the width-stabilize alternate
    // ("Copied"), which is fine — we just verify the rest label is
    // present.
    expect(btn.textContent).toContain("Copy");
  });

  test("uses the provided data-slot (falls back to 'block-copy')", () => {
    const { container: defaultSlot } = render(
      <BlockCopyButton aria-label="Copy" getText={() => "hi"} />,
    );
    expect(
      defaultSlot.querySelector('[data-slot="block-copy"]'),
    ).not.toBeNull();

    cleanup();
    const { container: explicitSlot } = render(
      <BlockCopyButton
        aria-label="Copy"
        getText={() => "hi"}
        data-slot="file-copy"
      />,
    );
    expect(
      explicitSlot.querySelector('[data-slot="file-copy"]'),
    ).not.toBeNull();
  });

  test("clicking writes the getText() return value to the clipboard", () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { container } = render(
      <BlockCopyButton
        aria-label="Copy"
        getText={() => "line one\nline two"}
      />,
    );
    const btn = container.querySelector(
      'button[aria-label="Copy"]',
    ) as HTMLButtonElement;
    btn.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("line one\nline two");
  });

  test("empty getText() return is a no-op (does NOT call writeText)", () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { container } = render(
      <BlockCopyButton aria-label="Copy" getText={() => ""} />,
    );
    const btn = container.querySelector(
      'button[aria-label="Copy"]',
    ) as HTMLButtonElement;
    btn.click();
    expect(writeText).not.toHaveBeenCalled();
  });

  test("missing navigator.clipboard does not throw on click", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const { container } = render(
      <BlockCopyButton aria-label="Copy" getText={() => "hi"} />,
    );
    const btn = container.querySelector(
      'button[aria-label="Copy"]',
    ) as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
  });

  test("disabled prevents the click handler from firing", () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { container } = render(
      <BlockCopyButton
        aria-label="Copy"
        getText={() => "hi"}
        disabled
      />,
    );
    const btn = container.querySelector(
      'button[aria-label="Copy"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(writeText).not.toHaveBeenCalled();
  });

  test("failed clipboard write does NOT flip the confirmed state (honest feedback)", async () => {
    const writeText = mock(() => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { container } = render(
      <BlockCopyButton aria-label="Copy" getText={() => "hi"} />,
    );
    const btn = container.querySelector(
      'button[aria-label="Copy"]',
    ) as HTMLButtonElement;
    expect(btn.dataset.tugConfirming).toBeUndefined();

    btn.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    // Two awaits — one for writeText to reject, one for React to
    // process any state update. Neither produces a confirmed state.
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.dataset.tugConfirming).toBeUndefined();
  });

  test("getText is read FRESH at click time (latest-ref pattern)", () => {
    // Pre-fix bug: a `useCallback([])` click handler closed over
    // the FIRST getText prop. A consumer that passes a fresh
    // closure on every render (very common — `() => ref.current`)
    // would have the click write a stale value. The
    // BlockCopyButton mirrors getText into a layout-effect-updated
    // ref so the click handler reads the current closure.
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    let textSnapshot = "initial";
    const { container, rerender } = render(
      <BlockCopyButton aria-label="Copy" getText={() => textSnapshot} />,
    );

    // Update the source-of-truth between renders.
    textSnapshot = "updated";
    rerender(
      <BlockCopyButton aria-label="Copy" getText={() => textSnapshot} />,
    );

    const btn = container.querySelector(
      'button[aria-label="Copy"]',
    ) as HTMLButtonElement;
    btn.click();
    expect(writeText).toHaveBeenCalledWith("updated");
  });

  test("button carries data-tug-focus='refuse' (TugButton baseline contract)", () => {
    const { container } = render(
      <BlockCopyButton aria-label="Copy" getText={() => "hi"} />,
    );
    const btn = container.querySelector(
      'button[aria-label="Copy"]',
    ) as HTMLButtonElement;
    expect(btn.getAttribute("data-tug-focus")).toBe("refuse");
  });

  test("width-stabilize wraps both rest and alternate labels", () => {
    // The button's intrinsic width must be invariant across the
    // Copy→Copied swap. The wrapper paints both labels into the
    // same grid cell (one visible, one `visibility: hidden`).
    const { container } = render(
      <BlockCopyButton aria-label="Copy" getText={() => "hi"} />,
    );
    const stable = container.querySelector(".tug-button-stable-label");
    expect(stable).not.toBeNull();
    const active = stable?.querySelector('[data-tug-stable-label="active"]');
    const alternate = stable?.querySelector(
      '[data-tug-stable-label="alternate"]',
    );
    expect(active?.textContent).toBe("Copy");
    expect(alternate?.textContent).toBe("Copied");
  });
});
