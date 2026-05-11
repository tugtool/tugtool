/**
 * `TerminalBlock` — body-kind tests.
 *
 * Coverage:
 *  - Pure helpers: `parseTerminalLines` (split, trailing-blank drop),
 *    `formatDuration` (ms / s / m).
 *  - Static-mode rendering: empty input is hidden; populated input
 *    renders ANSI-colored line spans; footer fields render badges.
 *  - Truncation: above the retained-line cap, the indicator appears
 *    and the rendered window starts from the tail.
 *  - Virtualization mode-switch: at or below the visible threshold,
 *    flat `<pre>`; above the threshold, a self-scrolling viewport
 *    with top + bottom spacers.
 *  - Streaming: subscribes on mount (G1 sync read), re-renders on
 *    emission with rAF coalescing, unsubscribes on unmount.
 *  - Copy-to-clipboard: button writes the composed text to
 *    `navigator.clipboard.writeText` and toggles `is-copied` for the
 *    CSS feedback swap.
 */

import "../../../../__tests__/setup-rtl";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { PropertyStore } from "../../property-store";

// Path to the source `terminal-block.css` — used by the
// scrollbar-gutter regression test (happy-dom doesn't honor the CSS
// rule for `getComputedStyle`, so the assertion reads the source).
const TERMINAL_CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "terminal-block.css",
);

import {
  TerminalBlock,
  VISIBLE_THRESHOLD,
  RETAINED_LINE_CAP,
  formatDuration,
  parseTerminalLines,
  type TerminalData,
} from "../terminal-block";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("parseTerminalLines", () => {
  test("empty data → no lines", () => {
    expect(parseTerminalLines({ stdout: "", stderr: "" })).toEqual([]);
  });

  test("plain stdout splits by newline; trailing empty line dropped", () => {
    const lines = parseTerminalLines({ stdout: "a\nb\nc\n", stderr: "" });
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.source === "stdout")).toBe(true);
    expect(lines[0].html).toBe("a");
    expect(lines[2].html).toBe("c");
  });

  test("stdout + stderr concatenate in order; sources tagged", () => {
    const lines = parseTerminalLines({ stdout: "out1\nout2", stderr: "err1" });
    expect(lines.map((l) => l.source)).toEqual(["stdout", "stdout", "stderr"]);
  });

  test("ANSI escape produces a styled span on the line", () => {
    const lines = parseTerminalLines({ stdout: "\x1b[31mred\x1b[0m", stderr: "" });
    expect(lines[0].html).toContain('class="ansi-red-fg"');
  });
});

describe("formatDuration", () => {
  test("sub-second renders as N ms", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(428)).toBe("428 ms");
  });

  test("seconds with one decimal under 10s, rounded after", () => {
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(15_000)).toBe("15 s");
  });

  test("minutes:seconds for ≥ 1 minute", () => {
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(303_000)).toBe("5m 03s");
  });

  test("non-finite / negative → empty", () => {
    expect(formatDuration(NaN)).toBe("");
    expect(formatDuration(-1)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Static mode
// ---------------------------------------------------------------------------

describe("TerminalBlock — static mode", () => {
  test("undefined data → root has data-empty='true' (hidden via CSS)", () => {
    const { container } = render(<TerminalBlock />);
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(root.dataset.empty).toBe("true");
  });

  test("populated stdout renders a flat <pre> with one line div per line", () => {
    const data: TerminalData = { stdout: "alpha\nbeta\ngamma", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(root.dataset.empty).toBe("false");
    const pre = root.querySelector("pre.tugx-term-pre--flat");
    expect(pre).not.toBeNull();
    const lines = pre?.querySelectorAll(".tugx-term-line");
    expect(lines?.length).toBe(3);
    expect(lines?.[0].textContent).toBe("alpha");
  });

  test("ANSI red span survives sanitize and lands on the rendered line", () => {
    const data: TerminalData = {
      stdout: "\x1b[31mred line\x1b[0m\nplain",
      stderr: "",
    };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    expect(root.querySelector("span.ansi-red-fg")).not.toBeNull();
    expect(root.querySelector("span.ansi-red-fg")?.textContent).toBe("red line");
  });

  test("stderr line gets the stderr class", () => {
    const data: TerminalData = { stdout: "", stderr: "boom" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    const stderrLines = root.querySelectorAll(".tugx-term-line--stderr");
    expect(stderrLines.length).toBe(1);
    expect(stderrLines[0].textContent).toBe("boom");
  });

  test("footer renders exit-zero badge subtly", () => {
    const data: TerminalData = {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 250,
    };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    const exit = root.querySelector('[data-slot="terminal-exit"]') as HTMLElement;
    expect(exit).not.toBeNull();
    expect(exit.textContent).toBe("exit 0");
    expect(exit.classList.contains("tugx-term-exit--zero")).toBe(true);
    expect(root.querySelector('[data-slot="terminal-duration"]')?.textContent).toBe(
      "250 ms",
    );
  });

  test("footer renders exit-nonzero with the strong variant + interrupted badge", () => {
    const data: TerminalData = {
      stdout: "partial",
      stderr: "",
      exitCode: 130,
      interrupted: true,
    };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    const exit = root.querySelector('[data-slot="terminal-exit"]') as HTMLElement;
    expect(exit.classList.contains("tugx-term-exit--nonzero")).toBe(true);
    expect(exit.textContent).toBe("exit 130");
    expect(root.querySelector('[data-slot="terminal-interrupted"]')).not.toBeNull();
  });

  test("footer-only data (no stdout/stderr) still renders the footer", () => {
    const { container } = render(
      <TerminalBlock data={{ stdout: "", stderr: "", exitCode: 0 }} />,
    );
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    // Empty body, but the post-mortem badge survives so the user
    // sees a clean "exit 0" mark for the no-output success path.
    expect(root.dataset.empty).toBe("true");
    expect(root.querySelector('[data-slot="terminal-footer"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Virtualization mode-switch
// ---------------------------------------------------------------------------

describe("TerminalBlock — virtualization", () => {
  function makeLines(n: number): string {
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) out.push(`line-${i}`);
    return out.join("\n");
  }

  test("at threshold (40 lines) stays flat", () => {
    const data: TerminalData = { stdout: makeLines(VISIBLE_THRESHOLD), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    expect(root.querySelector(".tugx-term-pre--flat")).not.toBeNull();
    expect(root.querySelector(".tugx-term-scroller")).toBeNull();
  });

  test("above threshold switches to virtualized scroller with spacers", () => {
    // 200 lines is well above the threshold (40) and the overscan
    // (2 viewport heights ≈ 48 lines × 2 sides) so the windowed
    // range strictly excludes some lines from the DOM.
    const total = 200;
    const data: TerminalData = { stdout: makeLines(total), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    const scroller = root.querySelector(
      '[data-slot="terminal-scroller"]',
    ) as HTMLElement;
    expect(scroller).not.toBeNull();
    // Explicit pixel height set inline so the viewport shrink-wraps.
    expect(scroller.style.height).toMatch(/^\d+px$/);
    // Top + bottom spacer + the windowed pre live inside.
    expect(scroller.querySelector(".tugx-term-spacer--top")).not.toBeNull();
    expect(scroller.querySelector(".tugx-term-spacer--bottom")).not.toBeNull();
    expect(scroller.querySelector(".tugx-term-pre--virtualized")).not.toBeNull();
    // Only a windowed subset of lines is rendered, not all 200.
    const rendered = scroller.querySelectorAll(".tugx-term-line").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(total);
  });

  test("retention cap drops the earliest lines + shows the truncation indicator", () => {
    // Exceed the cap by 5; the first 5 should be dropped and the
    // banner should announce the count.
    const total = RETAINED_LINE_CAP + 5;
    const data: TerminalData = { stdout: makeLines(total), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    const banner = root.querySelector(
      '[data-slot="terminal-truncation"]',
    ) as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toBe("… 5 earlier lines truncated");
  });

  test("at the cap exactly, no truncation banner", () => {
    const data: TerminalData = {
      stdout: makeLines(RETAINED_LINE_CAP),
      stderr: "",
    };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    expect(root.querySelector('[data-slot="terminal-truncation"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Streaming mode
// ---------------------------------------------------------------------------

describe("TerminalBlock — streaming mode", () => {
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

  function makeStore(initial: TerminalData): PropertyStore {
    // PropertyStore's type enum doesn't include "object", but the
    // store's `_validateAndCoerce` is a pass-through for the
    // "string" type — it doesn't introspect the value, so a
    // structured `TerminalData` payload threads cleanly. The
    // descriptor type is advisory in this scenario.
    return new PropertyStore({
      schema: [{ path: "terminal", type: "string", label: "terminal" }],
      initialValues: { terminal: initial as unknown as string },
    });
  }

  test("G1 sync read on mount renders the store's current value", () => {
    const store = makeStore({ stdout: "hello stream\n", stderr: "" });
    const { container } = render(<TerminalBlock streamingStore={store} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    expect(root.dataset.empty).toBe("false");
    expect(root.textContent).toContain("hello stream");
  });

  test("subsequent emissions re-render with rAF coalescing", () => {
    const store = makeStore({ stdout: "v0", stderr: "" });
    const { container } = render(<TerminalBlock streamingStore={store} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    expect(root.textContent).toContain("v0");

    act(() => {
      store.set("terminal", { stdout: "v0\nv1\nv2", stderr: "" }, "test");
      store.set("terminal", { stdout: "v0\nv1\nv2\nv3", stderr: "" }, "test");
      store.set("terminal", { stdout: "v0\nv1\nv2\nv3\nv4", stderr: "" }, "test");
    });
    expect(queuedRafCallbacks.length).toBe(1);

    act(() => {
      flushRaf();
    });
    expect(root.textContent).toContain("v4");
    expect(root.querySelectorAll(".tugx-term-line").length).toBe(5);
  });

  test("unmount unsubscribes — subsequent store writes do not throw or schedule rAF", () => {
    const store = makeStore({ stdout: "alive", stderr: "" });
    const { unmount } = render(<TerminalBlock streamingStore={store} />);
    unmount();
    queuedRafCallbacks.length = 0;
    act(() => {
      store.set("terminal", { stdout: "after unmount", stderr: "" }, "test");
    });
    expect(queuedRafCallbacks.length).toBe(0);
  });

  test("malformed store value coerces to empty terminal without throwing", () => {
    // A misbehaving producer that stuffs a non-object into the path
    // (e.g., a stale string from an earlier protocol version) must
    // reach the `.empty=true` branch and leave the body inert
    // rather than crash.
    const store = new PropertyStore({
      schema: [{ path: "terminal", type: "string", label: "terminal" }],
      initialValues: { terminal: "not an object" },
    });
    const { container } = render(<TerminalBlock streamingStore={store} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    expect(root.dataset.empty).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Copy interaction
// ---------------------------------------------------------------------------

describe("TerminalBlock — copy button (in pinned header)", () => {
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

  test("clicking Copy writes composed stdout+stderr text and toggles is-copied", async () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const data: TerminalData = { stdout: "out1\nout2", stderr: "err1" };
    const { container } = render(<TerminalBlock data={data} />);
    // Copy lives in the pinned header now; the previous absolute-
    // positioned overlay (`.tugx-term-copy` / `[data-slot="terminal-copy"]`)
    // is retired. Query by accessible name.
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();

    btn.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("out1\nout2\nerr1");
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.classList.contains("is-copied")).toBe(true);
  });

  test("missing navigator.clipboard does not throw on click", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const data: TerminalData = { stdout: "ok", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
    expect(btn.classList.contains("is-copied")).toBe(false);
  });

  test("Copy button is always rendered (even when the terminal is empty)", () => {
    // The header is part of the React shell, not the imperative
    // body render; it is therefore present from mount, regardless of
    // whether `data` carries stdout/stderr. Users can copy an empty
    // terminal (no-op text) without the button hiding on them.
    const { container } = render(<TerminalBlock />);
    const header = container.querySelector(
      '[data-slot="terminal-header"]',
    ) as HTMLElement;
    expect(header).not.toBeNull();
    expect(
      header.querySelector('button[aria-label="Copy terminal output"]'),
    ).not.toBeNull();
  });
});

describe("TerminalBlock — pinned header + Copy button", () => {
  test("header renders as the first child of the terminal root", () => {
    // The pinned header sits at the top of the block, above the
    // `.tugx-term-content` body container. Sticky positioning needs
    // the header to be a direct child of the block root with the
    // body as a sibling below it.
    const data: TerminalData = { stdout: "ok", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(root.firstElementChild?.getAttribute("data-slot")).toBe(
      "terminal-header",
    );
    expect(
      root.querySelector('[data-slot="terminal-content"]'),
    ).not.toBeNull();
  });

  test("`headerLabel` prop renders in the header's left slot", () => {
    // Standalone gallery use: caller supplies the label (typically
    // the command). Embedded callers omit it because their wrapping
    // chrome already carries identity.
    const data: TerminalData = { stdout: "out", stderr: "" };
    const { container } = render(
      <TerminalBlock data={data} headerLabel="ls -la" />,
    );
    const label = container.querySelector(
      '[data-slot="terminal-header-label"]',
    ) as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe("ls -la");
  });

  test("no `headerLabel` → no label slot, but the Copy button still renders", () => {
    const data: TerminalData = { stdout: "out", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    expect(
      container.querySelector('[data-slot="terminal-header-label"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="Copy terminal output"]'),
    ).not.toBeNull();
  });

  test("retired Copy overlay DOM is gone — no `.tugx-term-copy` absolute element", () => {
    // Regression pin: the imperative copy overlay (`.tugx-term-copy`
    // button, with `[data-slot="terminal-copy"]`) was retired with
    // the `--tugx-term-copy-*` slot family. The Copy lives in the
    // header now; selecting by the old hook must return null. If a
    // future refactor reintroduces an overlay, this test will catch
    // the regression.
    const lines: string[] = [];
    for (let i = 0; i < 200; i += 1) lines.push(`line-${i}`);
    const data: TerminalData = { stdout: lines.join("\n"), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    expect(container.querySelector(".tugx-term-copy")).toBeNull();
    expect(
      container.querySelector('[data-slot="terminal-copy"]'),
    ).toBeNull();
  });

  test("CSS source declares `scrollbar-gutter: stable` on `.tugx-term-scroller`", () => {
    // The virtualized scroller reserves the vertical scrollbar gutter
    // in layout so the rightmost column of text doesn't reflow when
    // a streaming command's output crosses the viewport-height
    // threshold. happy-dom doesn't honor the property for
    // `getComputedStyle`, so the assertion reads the source instead —
    // sufficient to catch a regression that drops the declaration.
    const css = readFileSync(TERMINAL_CSS_PATH, "utf8");
    const scrollerRule = css.match(
      /\.tugx-term-scroller\s*\{[^}]*\}/,
    )?.[0];
    expect(scrollerRule).toBeDefined();
    expect(scrollerRule).toMatch(/scrollbar-gutter:\s*stable/);
  });

  test("CSS source declares `position: sticky` on `.tugx-term-header`", () => {
    // The Copy lives in a header that stays in view while the body
    // scrolls. The sticky declaration is the load-bearing CSS.
    // Reading the source pins it; the actual paint behavior is
    // verified in the gallery card + a manual visual check (happy-
    // dom can't exercise scrollport-driven sticky).
    const css = readFileSync(TERMINAL_CSS_PATH, "utf8");
    const headerRule = css.match(/\.tugx-term-header\s*\{[^}]*\}/)?.[0];
    expect(headerRule).toBeDefined();
    expect(headerRule).toMatch(/position:\s*sticky/);
    // Telescoping variable consumed with a `top: 0` fallback so
    // standalone (no entry-header) hosts still pin at viewport top.
    expect(headerRule).toMatch(/top:\s*var\(--tugx-pin-stack-top,\s*0\)/);
  });
});
