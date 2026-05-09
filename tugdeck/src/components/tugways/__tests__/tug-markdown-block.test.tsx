/**
 * `TugMarkdownBlock` — natural-flow per-cell markdown renderer tests.
 *
 * Covers:
 *  - Static `initialText` mode renders sanitized HTML before paint.
 *  - Static mode does not internally introduce a scroll container.
 *  - Streaming mode mounts non-empty when the store already holds content (G1).
 *  - Streaming mode re-renders on subsequent emissions (rAF coalesced).
 *  - Streaming mode unsubscribes on unmount.
 *
 * WASM init mirrors the helper unit-test pattern: load the `.wasm`
 * bytes once at module scope and `initSync` before any test runs.
 */

import "../../../__tests__/setup-rtl";

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

import { initSync } from "../../../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import { PropertyStore } from "../property-store";

import { TugMarkdownBlock } from "../tug-markdown-block";

// ---------------------------------------------------------------------------
// WASM initialisation — load once
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(__dir, "../../../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm");

beforeAll(() => {
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStreamingStore(path: string, initialText: string): PropertyStore {
  return new PropertyStore({
    schema: [{ path, type: "string", label: "text" }],
    initialValues: { [path]: initialText },
  });
}

// ---------------------------------------------------------------------------
// Static `initialText` mode
// ---------------------------------------------------------------------------

describe("TugMarkdownBlock — static initialText mode", () => {
  test("renders simple emphasis markdown", () => {
    const { container } = render(
      <TugMarkdownBlock initialText="**bold** and *italic*" />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root).not.toBeNull();
    expect(root?.querySelector("strong")?.textContent).toBe("bold");
    expect(root?.querySelector("em")?.textContent).toBe("italic");
  });

  test("renders heading + paragraph as two block divs", () => {
    const { container } = render(
      <TugMarkdownBlock initialText={"# Title\n\nBody paragraph."} />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    const blocks = root?.querySelectorAll(".tugx-md-block");
    expect(blocks?.length).toBe(2);
    expect(blocks?.[0].querySelector("h1")?.textContent).toBe("Title");
    expect(blocks?.[1].textContent).toContain("Body paragraph.");
  });

  test("synchronous mount-render — content present immediately after render() returns", () => {
    // The mount-render happens in `useLayoutEffect`, which RTL's
    // `render()` flushes synchronously before returning. Querying
    // immediately afterwards finds the rendered HTML.
    const { container } = render(
      <TugMarkdownBlock initialText="Inline content." />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root?.children.length).toBeGreaterThan(0);
    expect(root?.textContent).toContain("Inline content.");
  });

  test("subsequent initialText prop changes are ignored (mount-once contract)", () => {
    const { container, rerender } = render(
      <TugMarkdownBlock initialText="first" />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root?.textContent).toContain("first");

    rerender(<TugMarkdownBlock initialText="second" />);
    expect(root?.textContent).toContain("first");
    expect(root?.textContent).not.toContain("second");
  });

  test("does not introduce an internal scroll container", () => {
    const { container } = render(
      <TugMarkdownBlock initialText="content" />,
    );
    expect(
      container.querySelector(".tugx-md-scroll-container"),
    ).toBeNull();
  });

  test("dangerous markup is sanitized", () => {
    const { container } = render(
      <TugMarkdownBlock initialText='<script>alert(1)</script>Hello' />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root?.querySelector("script")).toBeNull();
    expect(root?.textContent).not.toContain("alert(1)");
  });

  test("forwarded className is appended to the base class", () => {
    const { container } = render(
      <TugMarkdownBlock initialText="x" className="extra-class" />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root?.classList.contains("tug-markdown-block")).toBe(true);
    expect(root?.classList.contains("extra-class")).toBe(true);
  });

  test("empty initialText renders an empty container with no block divs", () => {
    const { container } = render(<TugMarkdownBlock initialText="" />);
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root).not.toBeNull();
    expect(root?.querySelectorAll(".tugx-md-block").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Streaming `streamingStore` mode
// ---------------------------------------------------------------------------

describe("TugMarkdownBlock — streaming streamingStore mode", () => {
  // The setup-rtl polyfill schedules rAF via `setTimeout(0)`, which
  // doesn't drain inside a synchronous `act()` block. Override the
  // global with a queue we can drain on demand so test assertions
  // run AFTER the streaming-mode flush has applied to the DOM.
  let originalRAF: typeof globalThis.requestAnimationFrame;
  let originalCancelRAF: typeof globalThis.cancelAnimationFrame;
  let queuedRafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    queuedRafCallbacks = [];
    originalRAF = globalThis.requestAnimationFrame;
    originalCancelRAF = globalThis.cancelAnimationFrame;
    (globalThis as unknown as {
      requestAnimationFrame: (cb: FrameRequestCallback) => number;
    }).requestAnimationFrame = (cb: FrameRequestCallback) => {
      queuedRafCallbacks.push(cb);
      return queuedRafCallbacks.length;
    };
    (globalThis as unknown as {
      cancelAnimationFrame: (id: number) => void;
    }).cancelAnimationFrame = () => undefined;
  });

  afterEach(() => {
    (globalThis as unknown as {
      requestAnimationFrame: typeof globalThis.requestAnimationFrame;
    }).requestAnimationFrame = originalRAF;
    (globalThis as unknown as {
      cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
    }).cancelAnimationFrame = originalCancelRAF;
  });

  function flushRaf(): void {
    while (queuedRafCallbacks.length > 0) {
      const cb = queuedRafCallbacks.shift();
      cb?.(performance.now());
    }
  }

  test("mounts non-empty when the store already holds content (G1)", () => {
    const store = makeStreamingStore("text", "**Hello** stream");
    const { container } = render(
      <TugMarkdownBlock streamingStore={store} streamingPath="text" />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root).not.toBeNull();
    // Content from `store.get("text")` is visible synchronously after
    // mount — `PropertyStore.observe` does not fire on subscribe, so
    // without the G1 sync read the cell would be empty.
    expect(root?.textContent).toContain("Hello stream");
    expect(root?.querySelector("strong")?.textContent).toBe("Hello");
  });

  test("re-renders on subsequent store updates", () => {
    const store = makeStreamingStore("text", "first");
    const { container } = render(
      <TugMarkdownBlock streamingStore={store} streamingPath="text" />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root?.textContent).toContain("first");

    act(() => {
      store.set("text", "second", "test");
      flushRaf();
    });

    expect(root?.textContent).toContain("second");
    expect(root?.textContent).not.toContain("first");
  });

  test("rapid emissions coalesce into one render per paint frame", () => {
    const store = makeStreamingStore("text", "v0");
    const { container } = render(
      <TugMarkdownBlock streamingStore={store} streamingPath="text" />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root?.textContent).toContain("v0");

    // Three quick `set` calls schedule exactly ONE rAF — the
    // listener checks `pendingRaf !== null` and skips re-scheduling
    // for subsequent emissions in the same burst. After flushing,
    // the DOM reflects the cumulative final value.
    act(() => {
      store.set("text", "v1", "test");
      store.set("text", "v2", "test");
      store.set("text", "v3", "test");
    });
    expect(queuedRafCallbacks.length).toBe(1);

    act(() => {
      flushRaf();
    });
    expect(root?.textContent).toContain("v3");
  });

  test("uses the configured streamingPath (default: text)", () => {
    const store = new PropertyStore({
      schema: [{ path: "body", type: "string", label: "body" }],
      initialValues: { body: "from body path" },
    });
    const { container } = render(
      <TugMarkdownBlock streamingStore={store} streamingPath="body" />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root?.textContent).toContain("from body path");
  });

  test("undefined store value renders empty, then updates fill content", () => {
    const store = new PropertyStore({
      schema: [{ path: "text", type: "string", label: "text" }],
      initialValues: { text: undefined },
    });
    const { container } = render(
      <TugMarkdownBlock streamingStore={store} streamingPath="text" />,
    );
    const root = container.querySelector('[data-slot="tug-markdown-block"]');
    expect(root?.querySelectorAll(".tugx-md-block").length).toBe(0);

    act(() => {
      store.set("text", "now there is content", "test");
      flushRaf();
    });

    expect(root?.textContent).toContain("now there is content");
  });

  test("unmount unsubscribes — subsequent store writes do not throw", () => {
    const store = makeStreamingStore("text", "alive");
    const { unmount } = render(
      <TugMarkdownBlock streamingStore={store} streamingPath="text" />,
    );
    unmount();
    expect(() => {
      store.set("text", "after unmount", "test");
    }).not.toThrow();
  });
});
