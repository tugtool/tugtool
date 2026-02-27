/**
 * TerminalCard React component tests — Step 9
 *
 * Tests use bun's mock.module() to intercept xterm.js imports, making it
 * possible to assert on Terminal.open(), fit(), dispose(), and write() calls
 * without requiring a real browser canvas.
 *
 * Tests:
 * - Terminal card mounts xterm.js instance into a container ref
 * - Terminal card calls fit() on resize
 * - Terminal card cleans up xterm.js on unmount
 */

// NOTE: mock.module() calls must appear before any import of the module under
// test. In bun 1.3.9 the module registry is populated at parse/link time, so
// hoisting the mock registrations here ensures the mocked implementations are
// used when terminal-card.tsx is first evaluated.

import { mock } from "bun:test";

// ---- Shared mock state (mutated by each mock factory call) ----

const mockFit = mock(() => {});
const mockOpen = mock((_el: HTMLElement) => {});
const mockWrite = mock((_data: Uint8Array) => {});
const mockTerminalDispose = mock(() => {});
const mockRefresh = mock((_start: number, _end: number) => {});
const mockLoadAddon = mock((_addon: unknown) => {});

const mockOnData = mock((_cb: (data: string) => void) => ({
  dispose: mock(() => {}),
}));

const mockOnResize = mock((_cb: (size: { cols: number; rows: number }) => void) => ({
  dispose: mock(() => {}),
}));

// The Terminal constructor returns this shared instance object.
const mockTerminalInstance = {
  open: mockOpen,
  write: mockWrite,
  dispose: mockTerminalDispose,
  refresh: mockRefresh,
  loadAddon: mockLoadAddon,
  onData: mockOnData,
  onResize: mockOnResize,
  options: { fontSize: 14, theme: {}, fontFamily: "" } as Record<string, unknown>,
  rows: 24,
  cols: 80,
};

const mockFitAddonInstance = {
  fit: mockFit,
  dispose: mock(() => {}),
};

// Register module mocks before any import of terminal-card.tsx.
// bun resolves these at module link time so they intercept the component's imports.
mock.module("@xterm/xterm", () => ({
  Terminal: mock((_opts?: unknown) => mockTerminalInstance),
}));

mock.module("@xterm/addon-fit", () => ({
  FitAddon: mock(() => mockFitAddonInstance),
}));

mock.module("@xterm/addon-web-links", () => ({
  WebLinksAddon: mock(() => ({ dispose: mock(() => {}) })),
}));

mock.module("@xterm/addon-webgl", () => ({
  // Throw so the component falls back to canvas gracefully (no console error needed)
  WebglAddon: mock(() => {
    throw new Error("WebGL not available in test environment");
  }),
}));

// ---- Import test infrastructure after mock registrations ----

import "./setup-test-dom"; // sets up happy-dom globals

import { describe, it, expect, beforeEach } from "bun:test";
import { render, act } from "@testing-library/react";
import React from "react";

import { CardContextProvider } from "../../cards/card-context";
import { FeedId } from "../../protocol";
import type { TugConnection } from "../../connection";

// Import the component AFTER all mock.module() registrations
import { TerminalCard } from "./terminal-card";

// ---- Test helpers ----

function makeMockConnection(): TugConnection {
  return {
    send: mock((_feedId: number, _payload: Uint8Array) => {}),
    sendControlFrame: mock(() => {}),
  } as unknown as TugConnection;
}

interface RenderOptions {
  feedPayload?: Uint8Array;
  connection?: TugConnection | null;
  dimensions?: { width: number; height: number };
  dragState?: { isDragging: boolean } | null;
}

function renderTerminalCard(options: RenderOptions = {}) {
  const {
    feedPayload,
    connection = null,
    dimensions = { width: 0, height: 0 },
    dragState = null,
  } = options;

  const feedData = new Map<number, Uint8Array>();
  if (feedPayload !== undefined) {
    feedData.set(FeedId.TERMINAL_OUTPUT, feedPayload);
  }
  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);

  const result = render(
    <CardContextProvider
      connection={connection}
      feedData={feedData}
      dimensions={dimensions}
      dragState={dragState as any}
      containerEl={containerEl}
    >
      <TerminalCard />
    </CardContextProvider>
  );
  return { ...result, containerEl };
}

// ---- Reset mocks between tests ----

beforeEach(() => {
  mockFit.mockClear();
  mockOpen.mockClear();
  mockWrite.mockClear();
  mockTerminalDispose.mockClear();
  mockRefresh.mockClear();
  mockLoadAddon.mockClear();
  mockOnData.mockClear();
  mockOnResize.mockClear();
});

// ---- Tests: Terminal card mounts xterm.js instance into a container ref ----

describe("TerminalCard – mounts xterm.js instance into container ref", () => {
  it("calls terminal.open() with the container DOM element on mount", async () => {
    const { unmount } = renderTerminalCard();
    await act(async () => {});

    expect(mockOpen.mock.calls.length).toBe(1);
    const openArg = mockOpen.mock.calls[0]?.[0];
    expect(openArg).toBeInstanceOf(HTMLElement);

    unmount();
  });

  it("renders the terminal-container element for xterm.js to mount into", async () => {
    const { container, unmount } = renderTerminalCard();
    await act(async () => {});

    const termContainer = container.querySelector("[data-testid='terminal-container']");
    expect(termContainer).not.toBeNull();
    expect(termContainer).toBeInstanceOf(HTMLElement);

    unmount();
  });

  it("loads FitAddon and WebLinksAddon via terminal.loadAddon() on mount", async () => {
    const { unmount } = renderTerminalCard();
    await act(async () => {});

    // FitAddon + WebLinksAddon = at least 2 calls (WebglAddon throws, skipped)
    expect(mockLoadAddon.mock.calls.length).toBeGreaterThanOrEqual(2);

    unmount();
  });

  it("writes incoming feed payload to the terminal instance", async () => {
    const payload = new TextEncoder().encode("hello terminal");
    const { unmount } = renderTerminalCard({ feedPayload: payload });
    await act(async () => {});

    expect(mockWrite.mock.calls.length).toBe(1);
    expect(mockWrite.mock.calls[0]?.[0]).toEqual(payload);

    unmount();
  });
});

// ---- Tests: Terminal card calls fit() on resize ----

describe("TerminalCard – calls fit() on resize", () => {
  it("calls fit() when dimensions change to non-zero values", async () => {
    const { unmount, rerender, containerEl } = renderTerminalCard({
      dimensions: { width: 0, height: 0 },
    });
    await act(async () => {});

    // Clear fit() calls from initial mount
    mockFit.mockClear();

    // Re-render with new non-zero dimensions to trigger the resize effect
    await act(async () => {
      rerender(
        <CardContextProvider
          connection={null}
          feedData={new Map()}
          dimensions={{ width: 800, height: 600 }}
          dragState={null}
          containerEl={containerEl}
        >
          <TerminalCard />
        </CardContextProvider>
      );
    });

    // Flush the requestAnimationFrame polyfill (setTimeout-based, 0ms delay)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // fit() must have been called as part of the resize debounce
    expect(mockFit.mock.calls.length).toBeGreaterThan(0);

    unmount();
  });

  it("does not call fit() when dragState.isDragging is true", async () => {
    // Start with isDragging=true from the beginning so the initial resize
    // effect is also suppressed, giving us a clean baseline.
    const { unmount, rerender, containerEl } = renderTerminalCard({
      dimensions: { width: 400, height: 300 },
      dragState: { isDragging: true },
    });
    await act(async () => {});

    // Flush any pending RAFs from mount
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    mockFit.mockClear();

    // Re-render with isDragging=true and new dimensions — still dragging
    await act(async () => {
      rerender(
        <CardContextProvider
          connection={null}
          feedData={new Map()}
          dimensions={{ width: 800, height: 600 }}
          dragState={{ isDragging: true } as any}
          containerEl={containerEl}
        >
          <TerminalCard />
        </CardContextProvider>
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // fit() must be suppressed during active drag
    expect(mockFit.mock.calls.length).toBe(0);

    unmount();
  });
});

// ---- Tests: Terminal card cleans up xterm.js on unmount ----

describe("TerminalCard – cleans up xterm.js on unmount", () => {
  it("calls terminal.dispose() when the component unmounts", async () => {
    const { unmount } = renderTerminalCard();
    await act(async () => {});

    // Confirm the terminal was opened (sanity check)
    expect(mockOpen.mock.calls.length).toBe(1);

    // Reset dispose counter so we only count the unmount call
    mockTerminalDispose.mockClear();

    unmount();

    // terminal.dispose() must be called exactly once during cleanup
    expect(mockTerminalDispose.mock.calls.length).toBe(1);
  });

  it("registers and removes the td-theme-change event listener", async () => {
    const addedListeners: string[] = [];
    const removedListeners: string[] = [];

    const origAdd = document.addEventListener.bind(document);
    const origRemove = document.removeEventListener.bind(document);

    (document as any).addEventListener = (
      type: string,
      handler: EventListener,
      opts?: unknown
    ) => {
      addedListeners.push(type);
      origAdd(type, handler, opts as any);
    };
    (document as any).removeEventListener = (
      type: string,
      handler: EventListener,
      opts?: unknown
    ) => {
      removedListeners.push(type);
      origRemove(type, handler, opts as any);
    };

    const { unmount } = renderTerminalCard();
    await act(async () => {});

    expect(addedListeners).toContain("td-theme-change");

    unmount();

    expect(removedListeners).toContain("td-theme-change");

    // Restore
    (document as any).addEventListener = origAdd;
    (document as any).removeEventListener = origRemove;
  });
});

// ---- Tests: Context integration ----

describe("TerminalCard – context integration", () => {
  it("registers terminal.onData() to capture keyboard input", async () => {
    const { unmount } = renderTerminalCard();
    await act(async () => {});

    // onData must be called once during xterm.js initialization
    expect(mockOnData.mock.calls.length).toBe(1);

    unmount();
  });

  it("registers terminal.onResize() to forward resize events to server", async () => {
    const { unmount } = renderTerminalCard();
    await act(async () => {});

    expect(mockOnResize.mock.calls.length).toBe(1);

    unmount();
  });

  it("uses FeedId.TERMINAL_OUTPUT (0x00) as its data feed", () => {
    expect(FeedId.TERMINAL_OUTPUT).toBe(0x00);
  });

  it("renders correctly with a connection provided via context", async () => {
    const conn = makeMockConnection();
    const { container, unmount } = renderTerminalCard({ connection: conn });
    await act(async () => {});

    const wrapper = container.querySelector(".terminal-card");
    expect(wrapper).not.toBeNull();

    unmount();
  });
});
