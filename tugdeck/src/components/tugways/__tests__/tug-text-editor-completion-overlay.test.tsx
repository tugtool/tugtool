/**
 * tug-text-editor-completion-overlay.test.tsx —
 * Structural smoke test for the CompletionOverlay portal migration.
 *
 * Scope: confirm that after mounting `<TugTextEditor />`, the
 * completion-menu DOM lives OUTSIDE the editor host (portaled), and
 * that no overlay-root registered means the portal target is
 * `document.body` per [D02].
 *
 * Why a structural test here (not in tug-text-editor-completion.test.ts):
 *   - That file is pure-logic — it tests `Transaction`-shaped inputs
 *     against the completion-extension's reducers. It deliberately
 *     does NOT mount components, per the file's docstring.
 *   - This file is component-shape: it mounts the substrate against
 *     happy-dom and asserts the portal landing site. Layout-fidelity
 *     assertions (popup escapes card clip rect, anchor ±2px) belong
 *     in tests/app-test/at0051 — happy-dom can't model them.
 *
 * What this catches: a regression that re-introduces the popup `<div>`
 * inside the editor host (the bug this migration fixes). If the popup
 * is mounted as a child of `[data-slot="tug-text-editor"]`, the
 * "parent is body / outside the host" assertion fails.
 */

import "../../../__tests__/setup-rtl";
import { afterEach, describe, expect, test } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import * as canvasOverlayRegistry from "@/lib/canvas-overlay-registry";
import { TugTextEditor } from "@/components/tugways/tug-text-editor";

afterEach(() => {
  cleanup();
  canvasOverlayRegistry._resetForTests();
});

function findCompletionMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-slot="tug-completion-menu"]',
  );
}

function findEditorHost(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-slot="tug-text-editor"]');
}

describe("CompletionOverlay — portal target + structural placement", () => {
  test("the completion menu mounts outside the editor host", () => {
    const { container } = render(<TugTextEditor preserveState={false} />);
    // After mount, the editor's view-creation effect runs, sets
    // `view` state, and the child <CompletionOverlay /> mounts the
    // portal. RTL's `render` flushes effects synchronously.
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    const host = findEditorHost(container);
    expect(host).not.toBeNull();
    // The popup must NOT be a descendant of the editor host. This is
    // the load-bearing invariant of the migration: in-host popup is
    // exactly the bug we fixed.
    expect(host!.contains(menu)).toBe(false);
  });

  test("with no <CanvasOverlayRoot /> registered, the popup portals to document.body", () => {
    expect(canvasOverlayRegistry.getRoot()).toBeNull();
    render(<TugTextEditor preserveState={false} />);
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    expect(menu!.parentElement).toBe(document.body);
  });

  test("when an overlay root is registered, the popup portals into it", () => {
    // Pre-register a root before mounting the editor, so the hook's
    // initial snapshot already returns the registered element.
    const root = document.createElement("div");
    root.setAttribute("data-slot", "tug-canvas-overlay-root");
    document.body.appendChild(root);
    canvasOverlayRegistry.register(root);

    render(<TugTextEditor preserveState={false} />);
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    expect(menu!.parentElement).toBe(root);

    // Cleanup: remove the synthetic root from body.
    canvasOverlayRegistry.unregister(root);
    document.body.removeChild(root);
  });

  test("the popup is initially hidden (display: none)", () => {
    render(<TugTextEditor preserveState={false} />);
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    expect(menu!.style.display).toBe("none");
  });

  test("the popup carries position: fixed inline (escapes card clip rect)", () => {
    render(<TugTextEditor preserveState={false} />);
    const menu = findCompletionMenu();
    expect(menu).not.toBeNull();
    // The CompletionOverlay sets position: fixed inline; that is
    // the canvas-escape contract. CSS provides z-index via the
    // overlay-tier token; position itself is inline.
    expect(menu!.style.position).toBe("fixed");
  });

  test("the popup unmounts when TugTextEditor unmounts", () => {
    const { unmount } = render(<TugTextEditor preserveState={false} />);
    expect(findCompletionMenu()).not.toBeNull();
    unmount();
    expect(findCompletionMenu()).toBeNull();
  });
});
