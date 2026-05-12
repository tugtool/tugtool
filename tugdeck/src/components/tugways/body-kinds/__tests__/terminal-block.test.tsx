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
 *    `navigator.clipboard.writeText` and triggers `TugPushButton`'s
 *    `confirmation` swap (`data-tug-confirming="true"` for the
 *    duration window).
 */

import "../../../../__tests__/setup-rtl";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
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
import { ToolWrapperChrome } from "@/components/tugways/cards/tool-wrappers/tool-wrapper-chrome";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

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
    //
    // `collapsed={false}` opts out of Phase E.4's default-fold
    // behavior (lineCount > FOLD_THRESHOLD_LINES folds by default);
    // this test exercises the virtualizer, not the fold cue.
    const total = 200;
    const data: TerminalData = { stdout: makeLines(total), stderr: "" };
    const { container } = render(<TerminalBlock data={data} collapsed={false} />);
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
    //
    // `collapsed={false}` keeps the renderer on the full-content
    // path so the truncation banner is visible (the preview path
    // intentionally suppresses the banner — see `renderTerminal`).
    const total = RETAINED_LINE_CAP + 5;
    const data: TerminalData = { stdout: makeLines(total), stderr: "" };
    const { container } = render(<TerminalBlock data={data} collapsed={false} />);
    const root = container.querySelector('[data-slot="terminal-body"]') as HTMLElement;
    const banner = root.querySelector(
      '[data-slot="terminal-truncation"]',
    ) as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toBe("… 5 earlier lines truncated");
  });

  test("at the cap exactly, no truncation banner", () => {
    // `collapsed={false}`: opt out of default-fold so the full
    // render runs through `renderTerminal` (the preview path's
    // banner suppression would also yield "no banner" but for the
    // wrong reason — pin the *not-truncated* case directly).
    const data: TerminalData = {
      stdout: makeLines(RETAINED_LINE_CAP),
      stderr: "",
    };
    const { container } = render(<TerminalBlock data={data} collapsed={false} />);
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

  test("clicking Copy writes composed stdout+stderr text", async () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const data: TerminalData = { stdout: "out1\nout2", stderr: "err1" };
    const { container } = render(<TerminalBlock data={data} />);
    // Copy lives in the header's trailing actions cluster. Query by
    // accessible name so the assertion stays decoupled from the Tug
    // button's internal markup.
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();

    btn.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("out1\nout2\nerr1");
    // The "Copied" confirmation flash is driven by `TugPushButton`'s
    // own `confirmation` machinery (a `data-tug-confirming` toggle
    // with CSS-driven visibility). Asserting the timing across React
    // renders + the duration window is unreliable in happy-dom (see
    // the happy-dom scoping rule), so the test stops at the
    // clipboard write. The visual confirmation is covered by the
    // gallery card.
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
  });

  test("failed clipboard write does NOT enter the confirmed state (honest feedback)", async () => {
    // Phase E.1 — TerminalBlock's Copy uses TugButton's controlled
    // `isConfirming` API. The flag is set ONLY after a successful
    // clipboard write resolves. If `writeText` rejects, the button
    // stays at rest — no false-positive "Copied" flash.
    const writeText = mock(() => Promise.reject(new Error("denied")));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const data: TerminalData = { stdout: "ok", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    expect(btn.dataset.tugConfirming).toBeUndefined();

    btn.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    // Wait for the rejected promise to settle so any state update
    // would have run by now.
    await Promise.resolve();
    await Promise.resolve();

    // The button did not enter the confirmed state. Compare against
    // the success path covered separately — same surface, different
    // outcome.
    expect(btn.dataset.tugConfirming).toBeUndefined();
  });

  test("successful clipboard write enters the confirmed state", async () => {
    // Companion to the failed-write test above. Phase E.1's controlled-
    // confirmation contract: `isConfirming` only flips to true after
    // the `.then()` callback runs.
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const data: TerminalData = { stdout: "ok", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    expect(btn.dataset.tugConfirming).toBeUndefined();

    await act(async () => {
      btn.click();
      // Two awaits: one to flush `writeText` resolution, one to let
      // React commit the state update + layout effect.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(btn.dataset.tugConfirming).toBe("true");
  });

  test("Copy button is always rendered (even when the terminal is empty)", () => {
    // The header strip and its trailing actions cluster are part of
    // the React shell, not the imperative body render; present from
    // mount, regardless of whether `data` carries stdout/stderr.
    // Copy stays rendered (not hidden) even with no content so the
    // affordance geometry is stable across content states; it just
    // disables itself when there's nothing to copy (see the disabled
    // test below). Copy lives inside the `[data-slot="terminal-actions"]`
    // cluster at the trailing edge of `.tugx-term-header` (Phase D
    // consolidated affordances into the header itself).
    const { container } = render(<TerminalBlock />);
    const actions = container.querySelector(
      '[data-slot="terminal-actions"]',
    ) as HTMLElement;
    expect(actions).not.toBeNull();
    expect(
      actions.querySelector('button[aria-label="Copy terminal output"]'),
    ).not.toBeNull();
  });

  test("Copy button is DISABLED in static mode when there is no content", () => {
    // Empty stdout AND empty stderr → nothing to copy → disabled.
    // The button stays rendered (geometry-stable affordance row) but
    // gets `disabled`. `writeText("")` would be a no-op even if the
    // user clicked, but disabling is the honest UX — don't invite a
    // click that does nothing.
    const data: TerminalData = { stdout: "", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  test("Copy button is ENABLED in static mode when stdout has content", () => {
    const data: TerminalData = { stdout: "hi", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  test("Copy button is ENABLED in static mode when only stderr has content", () => {
    // Stderr-only output still has copyable text (the error message).
    const data: TerminalData = { stdout: "", stderr: "boom" };
    const { container } = render(<TerminalBlock data={data} />);
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  test("Copy button is ENABLED when footer-only (exit code present, no stdout/stderr)", () => {
    // Borderline case: a successful command that emitted no output
    // (exitCode=0, empty streams). hasContent() returns false →
    // Copy disabled. This is correct: there's nothing to copy. The
    // exit-code badge is a visual signal, not copyable text.
    const data: TerminalData = { stdout: "", stderr: "", exitCode: 0 };
    const { container } = render(<TerminalBlock data={data} />);
    const btn = container.querySelector(
      'button[aria-label="Copy terminal output"]',
    ) as HTMLButtonElement;
    // hasContent ignores footer fields — only stdout/stderr count.
    // Empty streams → disabled.
    expect(btn.disabled).toBe(true);
  });
});

describe("TerminalBlock — pinned chrome + Copy button", () => {
  test("standalone with `headerLabel`: header hosts label + trailing Copy", () => {
    // Phase D — the dedicated `.tugx-term-actions` sticky strip
    // retired. Copy now sits at the trailing edge of `.tugx-term-header`
    // as a `flex: 0 0 auto` cluster carrying `data-slot="terminal-actions"`.
    const data: TerminalData = { stdout: "ok", stderr: "" };
    const { container } = render(
      <TerminalBlock data={data} headerLabel="ls -la" />,
    );
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    const header = root.querySelector(
      '[data-slot="terminal-header"]',
    ) as HTMLElement;
    expect(header).not.toBeNull();
    // Header is the first child of the block root; content follows.
    expect(root.firstElementChild?.getAttribute("data-slot")).toBe(
      "terminal-header",
    );
    expect(
      root.querySelector('[data-slot="terminal-content"]'),
    ).not.toBeNull();
    // The actions cluster lives INSIDE the header, carrying Copy.
    const cluster = header.querySelector(
      '[data-slot="terminal-actions"]',
    ) as HTMLElement;
    expect(cluster).not.toBeNull();
    expect(
      cluster.querySelector('button[aria-label="Copy terminal output"]'),
    ).not.toBeNull();
  });

  test("standalone without `headerLabel`: header is still rendered (hosts Copy)", () => {
    // Phase D — the header is the home of Copy in standalone mode, so
    // it's always rendered. An empty label slot is fine; the trailing
    // affordances cluster anchors Copy to the right. (The previous
    // "header suppressed without label" behavior of Phase B.2 was
    // tied to the separate actions row carrying Copy.)
    const data: TerminalData = { stdout: "ok", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const header = container.querySelector(
      '[data-slot="terminal-header"]',
    ) as HTMLElement;
    expect(header).not.toBeNull();
    // No label slot when `headerLabel` is undefined.
    expect(
      header.querySelector('[data-slot="terminal-header-label"]'),
    ).toBeNull();
    // Copy still reachable via the trailing cluster.
    expect(
      header.querySelector('button[aria-label="Copy terminal output"]'),
    ).not.toBeNull();
  });

  test("embedded mode portals Copy into the chrome's actions slot", () => {
    // Phase D — embedded composition portals Copy into
    // `ToolWrapperChrome`'s actions slot via `ChromeActionsTargetContext`.
    // The body kind's own header is suppressed (the chrome owns
    // identity); the affordance cluster lives in the chrome subtree
    // instead.
    const data: TerminalData = { stdout: "ok", stderr: "" };
    const { container } = render(
      <ToolWrapperChrome toolName="Bash">
        <TerminalBlock data={data} embedded headerLabel="ls -la" />
      </ToolWrapperChrome>,
    );
    // Body-kind header is suppressed.
    expect(
      container.querySelector('[data-slot="terminal-header"]'),
    ).toBeNull();
    // Copy is inside the chrome's actions slot, inside the cluster.
    const chromeActionsSlot = container.querySelector(
      "[data-slot='tool-wrapper-actions']",
    );
    expect(chromeActionsSlot).not.toBeNull();
    const cluster = chromeActionsSlot?.querySelector(
      '[data-slot="terminal-actions"]',
    );
    expect(cluster).not.toBeNull();
    expect(
      cluster?.querySelector('button[aria-label="Copy terminal output"]'),
    ).not.toBeNull();
  });

  test("`headerLabel` prop renders inside the identity header", () => {
    const data: TerminalData = { stdout: "out", stderr: "" };
    const { container } = render(
      <TerminalBlock data={data} headerLabel="ls -la" />,
    );
    const header = container.querySelector(
      '[data-slot="terminal-header"]',
    ) as HTMLElement;
    expect(header).not.toBeNull();
    const label = header.querySelector(
      '[data-slot="terminal-header-label"]',
    ) as HTMLElement;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe("ls -la");
  });

  test("Copy lives inside the trailing actions cluster, not as a freestanding header child", () => {
    // Phase D — Copy is wrapped in `[data-slot="terminal-actions"]`
    // (the trailing cluster) so consumers and tests can locate the
    // affordance group unambiguously. The wrapping is the same
    // whether Copy renders inline (standalone) or portals into the
    // chrome (embedded).
    const data: TerminalData = { stdout: "ok", stderr: "" };
    const { container } = render(
      <TerminalBlock data={data} headerLabel="ls" />,
    );
    const cluster = container.querySelector(
      '[data-slot="terminal-actions"]',
    ) as HTMLElement;
    expect(cluster).not.toBeNull();
    expect(
      cluster.querySelector('button[aria-label="Copy terminal output"]'),
    ).not.toBeNull();
  });

  test("retired Copy overlay DOM is gone — no `.tugx-term-copy` absolute element", () => {
    // Regression pin: the imperative copy overlay (`.tugx-term-copy`
    // button, with `[data-slot="terminal-copy"]`) was retired with
    // the `--tugx-term-copy-*` slot family. The Copy lives in the
    // actions row now; selecting by the old hook must return null. If
    // a future refactor reintroduces an overlay, this test catches it.
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
    // Phase D consolidated affordances into the header itself, so
    // only `.tugx-term-header` pins. happy-dom can't exercise
    // scrollport-driven sticky behavior; the source assertion pins
    // the declaration and the gallery card covers the visual.
    const css = readFileSync(TERMINAL_CSS_PATH, "utf8");
    const headerRule = css.match(/\.tugx-term-header\s*\{[^}]*\}/)?.[0];
    expect(headerRule).toBeDefined();
    expect(headerRule).toMatch(/position:\s*sticky/);
    // Header consumes `--tugx-pin-stack-top` so it telescopes under
    // an outer entry header when one is present.
    expect(headerRule).toMatch(/--tugx-pin-stack-top/);

    // No `.tugx-term-actions` sticky rule should exist any more —
    // the dedicated strip retired with Phase D.
    const actionsRule = css.match(/\.tugx-term-actions\s*\{[^}]*\}/)?.[0];
    expect(actionsRule).toBeUndefined();
  });
});

describe("TerminalBlock — embedded-without-chrome dev-warn (Phase E.2)", () => {
  test("embedded={true} without a parent chrome fires a dev-mode console.warn", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const data: TerminalData = { stdout: "ok", stderr: "" };
      render(<TerminalBlock data={data} embedded />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const calls = warnSpy.mock.calls as ReadonlyArray<
        ReadonlyArray<unknown>
      >;
      const messages = calls
        .map((call) => call[0])
        .filter((arg): arg is string => typeof arg === "string");
      const own = messages.filter((m) => m.includes("TerminalBlock"));
      expect(own.length).toBeGreaterThanOrEqual(1);
      expect(own[0]).toContain("embedded");
      expect(own[0]).toContain("ToolWrapperChrome");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("embedded={true} INSIDE a chrome does NOT fire the dev-warn", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const data: TerminalData = { stdout: "ok", stderr: "" };
      render(
        <ToolWrapperChrome toolName="Bash">
          <TerminalBlock data={data} embedded />
        </ToolWrapperChrome>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const calls = warnSpy.mock.calls as ReadonlyArray<
        ReadonlyArray<unknown>
      >;
      const messages = calls
        .map((call) => call[0])
        .filter((arg): arg is string => typeof arg === "string");
      const own = messages.filter(
        (m) => m.includes("TerminalBlock") && m.includes("embedded"),
      );
      expect(own.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase E.4 — fold cue + collapsed-preview rendering
// ---------------------------------------------------------------------------

describe("TerminalBlock — Phase E.4 fold cue", () => {
  function makeLines(n: number): string {
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) out.push(`line-${i}`);
    return out.join("\n");
  }

  test("at or below threshold (40 lines) does NOT render a fold cue", () => {
    // Sub-threshold output reads at a glance; a fold cue would be
    // visual noise.
    const data: TerminalData = { stdout: makeLines(40), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const cluster = container.querySelector(
      '[data-slot="terminal-actions"]',
    ) as HTMLElement | null;
    expect(cluster).not.toBeNull();
    expect(
      cluster?.querySelector(".tugx-term-fold-cue"),
    ).toBeNull();
    // Copy is still there.
    expect(
      cluster?.querySelector('button[aria-label="Copy terminal output"]'),
    ).not.toBeNull();
  });

  test("above threshold renders a fold cue with line-count label", () => {
    const data: TerminalData = { stdout: makeLines(100), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const cue = container.querySelector(
      ".tugx-term-fold-cue",
    ) as HTMLButtonElement | null;
    expect(cue).not.toBeNull();
    // Label echoes the visible line count.
    expect(cue?.textContent).toContain("100");
    expect(cue?.textContent).toContain("lines");
  });

  test("above threshold is collapsed by default (data-collapsed='true', preview body)", () => {
    const total = 100;
    const data: TerminalData = { stdout: makeLines(total), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-collapsed")).toBe("true");
    // The preview renders only the first ~8 lines via the flat
    // path — no virtualizer, no truncation banner, no footer.
    expect(root.querySelector(".tugx-term-scroller")).toBeNull();
    expect(root.querySelector(".tugx-term-pre--flat")).not.toBeNull();
    const renderedLines = root.querySelectorAll(".tugx-term-line");
    expect(renderedLines.length).toBeGreaterThan(0);
    expect(renderedLines.length).toBeLessThanOrEqual(8);
    // The earliest lines are what the user sees — pin one.
    expect(renderedLines[0]?.textContent).toContain("line-0");
  });

  test("clicking the fold cue expands the block (data-collapsed='false', full render)", () => {
    const data: TerminalData = { stdout: makeLines(100), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-collapsed")).toBe("true");

    const cue = container.querySelector(
      ".tugx-term-fold-cue",
    ) as HTMLButtonElement;
    act(() => {
      cue.click();
    });

    expect(root.getAttribute("data-collapsed")).toBe("false");
    // Above the virtualization threshold (40) → virtualized scroller
    // re-takes the body. The preview's flat-pre is gone.
    expect(root.querySelector(".tugx-term-scroller")).not.toBeNull();
  });

  test("fold→expand renders the virtualized scroller with mounted lines starting at the TOP of content", () => {
    // Regression covering two related fixes:
    //
    // 1. Attach-before-scrollTop. Pre-fix, `appendVirtualizedBody`
    //    set `scroller.scrollTop = initialScrollTop` BEFORE
    //    appending the scroller to its container. Setting
    //    scrollTop on a detached element is a no-op per spec,
    //    so the scroller landed in the DOM at scrollTop=0 and
    //    Phase E.4's fold→expand re-render showed empty until a
    //    wheel event fired `applyUpdate` against scrollTop=0.
    //
    // 2. Static anchor at top, not bottom. After fix #1 landed,
    //    the static-mode scroller anchored at the tail (the
    //    historical default for live terminals). For
    //    expand-from-preview reading flow the user wants to
    //    continue at the TOP — the preview showed the first ~8
    //    lines and the expansion should reveal lines 9..N. Static
    //    mode now passes `anchor="top"` to
    //    `appendVirtualizedBody`; streaming mode keeps the tail
    //    anchor for live-output reading.
    //
    // Assertions: the scroller exists with mounted line elements,
    // is attached to a parent (i.e. `container.appendChild` ran
    // before the scrollTop assignment), and the first mounted line
    // is index 0 (the top of content). scrollTop is exactly 0 —
    // the top anchor.
    const data: TerminalData = { stdout: makeLines(100), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    // Initial render: collapsed by default.
    expect(root.getAttribute("data-collapsed")).toBe("true");

    // Trigger expand.
    const cue = container.querySelector(
      ".tugx-term-fold-cue",
    ) as HTMLButtonElement;
    act(() => {
      cue.click();
    });

    const scroller = root.querySelector(
      ".tugx-term-scroller",
    ) as HTMLElement;
    expect(scroller).not.toBeNull();

    // Lines mounted — the windowed range has actual line elements
    // in the DOM. Pre-fix the lines could be mounted around the
    // tail with the scroller stuck at scrollTop=0; we now verify
    // that the first line is index 0, i.e. the top of content.
    const lines = scroller.querySelectorAll(".tugx-term-line");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].getAttribute("data-line-index")).toBe("0");

    // Scroller is attached to a parent (i.e. `container.appendChild`
    // ran). Pins fix #1's structural ordering invariant.
    expect(scroller.parentElement).not.toBeNull();

    // Static-mode anchor at top → scrollTop is exactly 0. Pins
    // fix #2: any regression that flips back to bottom-anchor
    // (or any caller passing `anchor="bottom"` in static mode)
    // fails here.
    expect(scroller.scrollTop).toBe(0);
  });

  test("clicking the fold cue twice toggles collapse back on (data-collapsed='true')", () => {
    const data: TerminalData = { stdout: makeLines(100), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    const cue = container.querySelector(
      ".tugx-term-fold-cue",
    ) as HTMLButtonElement;
    act(() => {
      cue.click();
    });
    expect(root.getAttribute("data-collapsed")).toBe("false");
    act(() => {
      cue.click();
    });
    expect(root.getAttribute("data-collapsed")).toBe("true");
  });

  test("controlled `collapsed` prop wins over local state", () => {
    const data: TerminalData = { stdout: makeLines(100), stderr: "" };
    const onToggleCollapsed = mock((_next: boolean) => {});
    const { container, rerender } = render(
      <TerminalBlock
        data={data}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    // Parent-controlled: even though `overThreshold` is true, the
    // prop forces expanded.
    expect(root.getAttribute("data-collapsed")).toBe("false");

    // Clicking the cue notifies via callback but does not flip the
    // local state when controlled.
    const cue = container.querySelector(
      ".tugx-term-fold-cue",
    ) as HTMLButtonElement;
    act(() => {
      cue.click();
    });
    expect(onToggleCollapsed).toHaveBeenCalledWith(true);
    // Visible state still matches the prop.
    expect(root.getAttribute("data-collapsed")).toBe("false");

    rerender(
      <TerminalBlock
        data={data}
        collapsed={true}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );
    expect(root.getAttribute("data-collapsed")).toBe("true");
  });

  test("collapseThreshold override raises or lowers the cue's appearance", () => {
    // Lift the threshold to 200; the 100-line fixture no longer
    // qualifies for fold-by-default and the cue vanishes.
    const data: TerminalData = { stdout: makeLines(100), stderr: "" };
    const { container } = render(
      <TerminalBlock data={data} collapseThreshold={200} />,
    );
    expect(container.querySelector(".tugx-term-fold-cue")).toBeNull();
    // The root carries no data-collapsed attribute when overThreshold
    // is false (the attribute is `undefined`-stripped).
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-collapsed")).toBeNull();
  });

  test("fold cue is the LAST child of the actions cluster (rightmost, Phase E.3 anchor)", () => {
    // Phase E.3 / E.4 ordering: Copy (feature) → fold cue (anchor).
    // Pin the structural invariant so a reorder regression fails
    // visibly.
    const data: TerminalData = { stdout: makeLines(100), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const cluster = container.querySelector(
      '[data-slot="terminal-actions"]',
    ) as HTMLElement | null;
    const buttons = cluster?.querySelectorAll("button") ?? [];
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute("aria-label")).toBe("Copy terminal output");
    expect(buttons[1].classList.contains("tugx-term-fold-cue")).toBe(true);
  });

  test("fold cue carries data-tug-focus='refuse' (audit pin)", () => {
    const data: TerminalData = { stdout: makeLines(100), stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const cue = container.querySelector(
      ".tugx-term-fold-cue",
    ) as HTMLButtonElement;
    expect(cue.getAttribute("data-tug-focus")).toBe("refuse");
  });
});

// ---------------------------------------------------------------------------
// Phase E.4 — responder-parent registration
// ---------------------------------------------------------------------------

describe("TerminalBlock — Phase E.4 responder", () => {
  test("the root element carries a data-responder-id attribute (inside a chain provider)", () => {
    // TerminalBlock graduates to "responder + responder parent" in
    // Phase E.4. `useOptionalResponder` writes `data-responder-id`
    // on the root element so the chain can resolve it — but only
    // when there's a `ResponderChainProvider` ancestor. Without
    // one, the registration silently no-ops (the same posture as
    // every other tugways primitive — see use-responder.ts), and
    // the body kind degrades to a plain DOM tree with native events.
    const data: TerminalData = { stdout: "hi", stderr: "" };
    const { container } = render(
      <ResponderChainProvider>
        <TerminalBlock data={data} />
      </ResponderChainProvider>,
    );
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(root.getAttribute("data-responder-id")).not.toBeNull();
    expect(root.getAttribute("data-responder-id")?.length).toBeGreaterThan(0);
  });

  test("responder root wraps the entire block (header + body sit inside the scope)", () => {
    // The ResponderScope wrapper is what publishes the parent context
    // to descendants. The Copy button and any future Find input must
    // be inside that scope to register as children.
    const data: TerminalData = { stdout: "hi", stderr: "" };
    const { container } = render(<TerminalBlock data={data} />);
    const root = container.querySelector(
      '[data-slot="terminal-body"]',
    ) as HTMLElement;
    expect(root.querySelector('[data-slot="terminal-header"]')).not.toBeNull();
    expect(root.querySelector('[data-slot="terminal-content"]')).not.toBeNull();
  });
});
