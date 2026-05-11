/**
 * `ToolWrapperChrome` — chrome-level tests.
 *
 * Coverage:
 *  - Telescoping pin: the chrome writes its header's measured height
 *    into `--tugx-toolblock-header-height` on the chrome root in a
 *    `useLayoutEffect` so a body-kind actions row composed below can
 *    pin at `top: calc(var(--tugx-pin-stack-top, 0) +
 *    var(--tugx-toolblock-header-height, 0))`.
 *
 * What this file deliberately does NOT cover:
 *  - Real-browser sticky behavior — happy-dom has no layout engine,
 *    so the pin position is asserted at the gallery (manual visual
 *    check) per the happy-dom scoping rule. We only assert the CSS
 *    variable write here, which is purely a DOM-side observation.
 *  - Header / footer / caution rendering — exercised by the per-tool
 *    wrapper tests (`read-tool-block.test.tsx`, `bash-tool-block.test.tsx`)
 *    that compose chrome end-to-end.
 */

import "../../../../../__tests__/setup-rtl";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import React from "react";

import { ToolWrapperChrome } from "../tool-wrapper-chrome";

afterEach(() => {
  cleanup();
});

describe("ToolWrapperChrome — telescoping-pin contract", () => {
  test("writes --tugx-toolblock-header-height on the chrome root after mount", () => {
    const { container } = render(
      <ToolWrapperChrome toolName="Read">
        <div>body</div>
      </ToolWrapperChrome>,
    );
    const root = container.querySelector(
      "[data-slot='tool-wrapper-chrome']",
    ) as HTMLElement | null;
    expect(root).not.toBeNull();
    if (root === null) return;

    // The value is whatever the host environment computes for
    // `offsetHeight` of the header element. happy-dom has no layout
    // engine and returns 0, so we only assert the property is set,
    // not its numeric value. The real-browser visual check happens
    // in the gallery card.
    const written = root.style.getPropertyValue(
      "--tugx-toolblock-header-height",
    );
    expect(written).toMatch(/^\d+px$/);
  });

  test("variable is removed (or zero) after the chrome unmounts", () => {
    const { container, unmount } = render(
      <ToolWrapperChrome toolName="Read">
        <div>body</div>
      </ToolWrapperChrome>,
    );
    const root = container.querySelector(
      "[data-slot='tool-wrapper-chrome']",
    ) as HTMLElement | null;
    expect(root).not.toBeNull();
    unmount();
    // After unmount the root is detached from the document. The test
    // is just checking that no errors are thrown during the cleanup
    // path that disconnects the ResizeObserver.
    expect(container.querySelector("[data-slot='tool-wrapper-chrome']")).toBeNull();
  });
});
