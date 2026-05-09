/**
 * `TideThinkingBlock` — unit tests for the thinking-strip chrome.
 *
 * Coverage:
 *  - Static mode: initialText="" → strip is hidden (data-empty="true").
 *  - Static mode: non-empty initialText → strip mounts default-COLLAPSED
 *    (per [D14]); first-line preview computed from the text; clicking
 *    the header expands; second click collapses.
 *  - Streaming mode: with empty initial value, strip mounts hidden;
 *    after the first non-empty observation the strip becomes visible.
 *  - Streaming mode: with a non-empty initial value (G1), strip
 *    mounts visible and default-EXPANDED.
 *  - Streaming-mode preview text reflects the current store value
 *    after rAF flush; updates again on subsequent emissions.
 *  - `aria-expanded` syncs with the collapse state.
 *  - Subscription unsubscribes on unmount (subsequent store writes
 *    do not throw, no rAF queued).
 *
 * `computePreview` is exercised through the component as well as a
 * direct unit pass — it has enough branches (empty / leading blank /
 * whitespace-runs / truncation) to deserve isolated assertions.
 *
 * happy-dom test scope is appropriate: this is component markup +
 * props + DOM-attribute assertions. No focus / selection / event
 * ordering across React rerenders, so the project's RTL setup
 * (which uses happy-dom) is the right substrate.
 */

import "../../../../__tests__/setup-rtl";

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

import { initSync } from "../../../../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import { PropertyStore } from "../../property-store";

import {
  TideThinkingBlock,
  computePreview,
  PREVIEW_MAX_LENGTH,
} from "../tide-thinking-block";

// ---------------------------------------------------------------------------
// WASM init — load once. TugMarkdownBlock (composed inside
// TideThinkingBlock) uses the WASM lex/parse pipeline.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(
  __dir,
  "../../../../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm",
);

beforeAll(() => {
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
});

afterEach(() => {
  cleanup();
});

function makeThinkingStore(initialText: string): PropertyStore {
  return new PropertyStore({
    schema: [{ path: "inflight.thinking", type: "string", label: "thinking" }],
    initialValues: { "inflight.thinking": initialText },
  });
}

// ---------------------------------------------------------------------------
// `computePreview` — direct unit
// ---------------------------------------------------------------------------

describe("computePreview", () => {
  test("returns '' for empty input", () => {
    expect(computePreview("")).toBe("");
  });

  test("returns the first non-empty line trimmed", () => {
    expect(computePreview("First line.\nSecond line.")).toBe("First line.");
  });

  test("skips leading empty lines", () => {
    expect(computePreview("\n\n  Real content here.\nMore.")).toBe(
      "Real content here.",
    );
  });

  test("returns '' when the input is whitespace only", () => {
    expect(computePreview("   \n\t \n  ")).toBe("");
  });

  test("collapses interior whitespace runs to single spaces", () => {
    expect(computePreview("a\t\tb   c")).toBe("a b c");
  });

  test("truncates with ellipsis above PREVIEW_MAX_LENGTH", () => {
    const long = "x".repeat(PREVIEW_MAX_LENGTH + 20);
    const out = computePreview(long);
    expect(out.length).toBe(PREVIEW_MAX_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });

  test("does not truncate when length === PREVIEW_MAX_LENGTH", () => {
    const exact = "y".repeat(PREVIEW_MAX_LENGTH);
    expect(computePreview(exact)).toBe(exact);
  });
});

// ---------------------------------------------------------------------------
// Static mode
// ---------------------------------------------------------------------------

describe("TideThinkingBlock — static mode", () => {
  test("empty initialText → strip is hidden via data-empty='true'", () => {
    const { container } = render(<TideThinkingBlock initialText="" />);
    const root = container.querySelector(
      '[data-slot="tide-thinking-block"]',
    ) as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.dataset.empty).toBe("true");
  });

  test("non-empty initialText → strip is visible and default-collapsed [D14]", () => {
    const { container } = render(
      <TideThinkingBlock initialText="Reasoning prose. Detail follows." />,
    );
    const root = container.querySelector(
      '[data-slot="tide-thinking-block"]',
    ) as HTMLElement;
    expect(root.dataset.empty).toBe("false");
    expect(root.dataset.collapsed).toBe("true");
    const button = root.querySelector(
      ".tide-thinking-block-header",
    ) as HTMLButtonElement;
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  test("preview is the computed first-line summary", () => {
    const { container } = render(
      <TideThinkingBlock initialText={"First sentence here.\nMore detail."} />,
    );
    const preview = container.querySelector(
      ".tide-thinking-block-preview",
    ) as HTMLElement;
    expect(preview.textContent).toBe("First sentence here.");
  });

  test("clicking the header toggles collapsed → expanded → collapsed", () => {
    const { container } = render(
      <TideThinkingBlock initialText="Body content." />,
    );
    const root = container.querySelector(
      '[data-slot="tide-thinking-block"]',
    ) as HTMLElement;
    const button = root.querySelector(
      ".tide-thinking-block-header",
    ) as HTMLButtonElement;

    expect(root.dataset.collapsed).toBe("true");

    act(() => {
      fireEvent.click(button);
    });
    expect(root.dataset.collapsed).toBe("false");
    expect(button.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      fireEvent.click(button);
    });
    expect(root.dataset.collapsed).toBe("true");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  test("the body composes a TugMarkdownBlock with the static text", () => {
    const { container } = render(
      <TideThinkingBlock initialText="**emphasized** thinking." />,
    );
    const body = container.querySelector(
      ".tide-thinking-block-content [data-slot='tug-markdown-block']",
    );
    expect(body).not.toBeNull();
    expect(body?.querySelector("strong")?.textContent).toBe("emphasized");
  });

  test("subsequent initialText prop changes are ignored (mount-once contract)", () => {
    const { container, rerender } = render(
      <TideThinkingBlock initialText={"first.\nrest"} />,
    );
    const preview = container.querySelector(
      ".tide-thinking-block-preview",
    ) as HTMLElement;
    expect(preview.textContent).toBe("first.");

    rerender(<TideThinkingBlock initialText={"second.\nrest"} />);
    expect(preview.textContent).toBe("first.");
    expect(preview.textContent).not.toContain("second");
  });
});

// ---------------------------------------------------------------------------
// Streaming mode — rAF instrumentation pattern matches `TugMarkdownBlock`
// tests so deltas can be flushed deterministically.
// ---------------------------------------------------------------------------

describe("TideThinkingBlock — streaming mode", () => {
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

  test("with empty initial store value, strip mounts hidden", () => {
    const store = makeThinkingStore("");
    const { container } = render(
      <TideThinkingBlock
        streamingStore={store}
        streamingPath="inflight.thinking"
      />,
    );
    const root = container.querySelector(
      '[data-slot="tide-thinking-block"]',
    ) as HTMLElement;
    expect(root.dataset.empty).toBe("true");
    expect(root.dataset.mode).toBe("streaming");
  });

  test("with non-empty initial store value (G1), strip is visible and default-EXPANDED", () => {
    const store = makeThinkingStore("Initial thinking content.");
    const { container } = render(
      <TideThinkingBlock
        streamingStore={store}
        streamingPath="inflight.thinking"
      />,
    );
    const root = container.querySelector(
      '[data-slot="tide-thinking-block"]',
    ) as HTMLElement;
    expect(root.dataset.empty).toBe("false");
    // Streaming default — opposite of static-mode default.
    expect(root.dataset.collapsed).toBe("false");
    const button = root.querySelector(
      ".tide-thinking-block-header",
    ) as HTMLButtonElement;
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  test("becomes visible after the first non-empty store emission (rAF coalesced)", () => {
    const store = makeThinkingStore("");
    const { container } = render(
      <TideThinkingBlock
        streamingStore={store}
        streamingPath="inflight.thinking"
      />,
    );
    const root = container.querySelector(
      '[data-slot="tide-thinking-block"]',
    ) as HTMLElement;
    expect(root.dataset.empty).toBe("true");

    act(() => {
      store.set("inflight.thinking", "Now thinking.", "test");
      flushRaf();
    });

    expect(root.dataset.empty).toBe("false");
    const preview = root.querySelector(
      ".tide-thinking-block-preview",
    ) as HTMLElement;
    expect(preview.textContent).toBe("Now thinking.");
  });

  test("preview text updates on subsequent emissions", () => {
    const store = makeThinkingStore("v0 line.");
    const { container } = render(
      <TideThinkingBlock
        streamingStore={store}
        streamingPath="inflight.thinking"
      />,
    );
    const preview = container.querySelector(
      ".tide-thinking-block-preview",
    ) as HTMLElement;
    expect(preview.textContent).toBe("v0 line.");

    act(() => {
      store.set("inflight.thinking", "v1 line newer.", "test");
      flushRaf();
    });
    expect(preview.textContent).toBe("v1 line newer.");
  });

  test("rapid emissions coalesce per subscriber — chrome + body each schedule one rAF", () => {
    // The component runs two independent rAF-coalesced subscriptions
    // on the same path: the chrome side (preview text + visibility)
    // and the composed `TugMarkdownBlock` body. A 3-emission burst
    // yields 2 queued rAFs total — one per subscriber — proving each
    // coalesces correctly. (A failure to coalesce would queue 6.)
    const store = makeThinkingStore("v0");
    render(
      <TideThinkingBlock
        streamingStore={store}
        streamingPath="inflight.thinking"
      />,
    );

    act(() => {
      store.set("inflight.thinking", "v1", "test");
      store.set("inflight.thinking", "v2", "test");
      store.set("inflight.thinking", "v3", "test");
    });
    expect(queuedRafCallbacks.length).toBe(2);
    act(() => {
      flushRaf();
    });
  });

  test("user can collapse a streaming block; toggle persists for the cell's lifetime", () => {
    const store = makeThinkingStore("Mid-stream content.");
    const { container } = render(
      <TideThinkingBlock
        streamingStore={store}
        streamingPath="inflight.thinking"
      />,
    );
    const root = container.querySelector(
      '[data-slot="tide-thinking-block"]',
    ) as HTMLElement;
    const button = root.querySelector(
      ".tide-thinking-block-header",
    ) as HTMLButtonElement;
    expect(root.dataset.collapsed).toBe("false");

    act(() => {
      fireEvent.click(button);
    });
    expect(root.dataset.collapsed).toBe("true");

    // Subsequent stream deltas don't override user's collapse choice.
    act(() => {
      store.set("inflight.thinking", "More content arrives.", "test");
      flushRaf();
    });
    expect(root.dataset.collapsed).toBe("true");
  });

  test("unmount unsubscribes — subsequent store writes do not throw or schedule rAF", () => {
    const store = makeThinkingStore("starting.");
    const { unmount } = render(
      <TideThinkingBlock
        streamingStore={store}
        streamingPath="inflight.thinking"
      />,
    );

    unmount();
    queuedRafCallbacks.length = 0;
    act(() => {
      store.set("inflight.thinking", "after unmount.", "test");
    });
    expect(queuedRafCallbacks.length).toBe(0);
  });
});
