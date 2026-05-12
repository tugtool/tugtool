/**
 * `BlockFindButton` — affordance library tests.
 */

import "../../../../../__tests__/setup-rtl";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";

import { BlockFindButton } from "../block-find-button";

afterEach(() => {
  cleanup();
});

describe("BlockFindButton", () => {
  test("renders with the provided aria-label and a 'Find' visible label", () => {
    const { container } = render(
      <BlockFindButton
        aria-label="Search in file"
        onClick={() => undefined}
      />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toBe("Search in file");
    expect(btn.textContent).toContain("Find");
  });

  test("click fires the onClick callback", () => {
    const onClick = mock(() => undefined);
    const { container } = render(
      <BlockFindButton aria-label="Find" onClick={onClick} />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("disabled prevents the click handler from firing", () => {
    const onClick = mock(() => undefined);
    const { container } = render(
      <BlockFindButton aria-label="Find" onClick={onClick} disabled />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  test("button carries data-tug-focus='refuse' (TugButton baseline contract)", () => {
    const { container } = render(
      <BlockFindButton aria-label="Find" onClick={() => undefined} />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.getAttribute("data-tug-focus")).toBe("refuse");
  });

  test("onClick is read FRESH at click time (latest-ref pattern, [L07])", () => {
    // The stable click handler reads `onClick` through a latest-ref
    // mirrored via useLayoutEffect. A consumer that passes a fresh
    // `onClick` per render (deps-based) gets the LATEST callback
    // at click time, not the one bound at first render.
    const firstClick = mock(() => undefined);
    const secondClick = mock(() => undefined);
    const { container, rerender } = render(
      <BlockFindButton aria-label="Find" onClick={firstClick} />,
    );
    rerender(
      <BlockFindButton aria-label="Find" onClick={secondClick} />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(firstClick).not.toHaveBeenCalled();
    expect(secondClick).toHaveBeenCalledTimes(1);
  });

  test("uses the provided data-slot (falls back to 'block-find')", () => {
    const { container } = render(
      <BlockFindButton aria-label="Find" onClick={() => undefined} />,
    );
    expect(container.querySelector('[data-slot="block-find"]')).not.toBeNull();

    cleanup();
    const { container: c2 } = render(
      <BlockFindButton
        aria-label="Find"
        onClick={() => undefined}
        data-slot="file-search"
      />,
    );
    expect(c2.querySelector('[data-slot="file-search"]')).not.toBeNull();
  });
});
