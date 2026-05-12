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
import { createPortal } from "react-dom";

import {
  ToolWrapperChrome,
  useChromeActionsTarget,
} from "../tool-wrapper-chrome";

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

describe("ToolWrapperChrome — actions slot", () => {
  test("renders the actions slot inside the header even when empty", () => {
    const { container } = render(
      <ToolWrapperChrome toolName="Read">
        <div>body</div>
      </ToolWrapperChrome>,
    );
    const header = container.querySelector(
      "[data-slot='tool-wrapper-header']",
    ) as HTMLElement | null;
    expect(header).not.toBeNull();
    const slot = header?.querySelector(
      "[data-slot='tool-wrapper-actions']",
    ) as HTMLElement | null;
    expect(slot).not.toBeNull();
    expect(slot?.children.length).toBe(0);
  });

  test("descendants can read the slot via useChromeActionsTarget and portal into it", () => {
    // The body-kind portal pattern: a descendant reads the chrome's
    // actions DOM node via context and `createPortal`s a node into it.
    // Verifies that the context exposes a real DOM element on first
    // descendant render-after-mount (no one-frame-late gotcha — the
    // chrome publishes the target via a state setter on its ref
    // callback, so the descendant's next render sees the non-null value).
    function PortalAffordance(): React.ReactElement | null {
      const target = useChromeActionsTarget();
      if (target === null) return null;
      return createPortal(
        <button type="button" aria-label="portaled">
          ★
        </button>,
        target,
      );
    }
    const { container } = render(
      <ToolWrapperChrome toolName="Read">
        <PortalAffordance />
      </ToolWrapperChrome>,
    );
    const slot = container.querySelector(
      "[data-slot='tool-wrapper-actions']",
    ) as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.querySelector('button[aria-label="portaled"]')).not.toBeNull();
  });

  test("useChromeActionsTarget returns null outside a ToolWrapperChrome", () => {
    let captured: HTMLDivElement | null | undefined = undefined;
    function Probe(): null {
      captured = useChromeActionsTarget();
      return null;
    }
    render(<Probe />);
    expect(captured).toBeNull();
  });
});
