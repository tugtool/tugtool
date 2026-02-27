/**
 * SettingsCard React component tests — Step 5
 *
 * Covers all plan-required tests:
 * - Theme radio options render for all 3 themes
 * - Clicking a theme applies body class and dispatches td-theme-change on document
 * - Dev mode switch is disabled when no source tree is set
 * - Dev mode switch calls sendControlFrame on toggle
 * - Dev mode switch reverts state on timeout when bridge doesn't respond
 * - onDevModeChanged callback updates switch state
 * - Source tree path displays "(not set)" initially; updates on onSourceTreeSelected
 * - Choose button calls sendControlFrame("choose-source-tree")
 * - Bridge callbacks are cleaned up on unmount
 *
 * DOM notes (Radix UI):
 * - RadioGroupItem renders as <button role="radio" value="..." id="theme-{name}">
 * - Switch renders as <button role="switch" id="dev-mode-switch">
 * - "Choose..." renders as a plain <button> without role="radio"|"switch"
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";

import { CardContextProvider } from "../../cards/card-context";
import { SettingsCard } from "./settings-card";
import type { TugConnection } from "../../connection";

// ---- Helpers ----

function makeMockConnection() {
  const calls: Array<{ action: string; params?: Record<string, unknown> }> = [];
  const conn = {
    send: () => {},
    sendControlFrame: (action: string, params?: Record<string, unknown>) => {
      calls.push({ action, params });
    },
    _calls: calls,
  } as unknown as TugConnection & { _calls: typeof calls };
  return conn;
}

function renderSettingsCard(connection: TugConnection | null = null) {
  const cardContainer = document.createElement("div");
  document.body.appendChild(cardContainer);
  const result = render(
    <CardContextProvider
      connection={connection}
      feedData={new Map()}
      dimensions={{ width: 0, height: 0 }}
      dragState={null}
      containerEl={cardContainer}
    >
      <SettingsCard />
    </CardContextProvider>
  );
  return { ...result, cardContainer };
}

function enableBridge() {
  (window as any).webkit = {
    messageHandlers: {
      getSettings: { postMessage: mock(() => {}) },
    },
  };
  if (!(window as any).__tugBridge) {
    (window as any).__tugBridge = {};
  }
}

function disableBridge() {
  delete (window as any).webkit;
}

function fireSettingsLoaded(data: { devMode: boolean; sourceTree: string | null }) {
  (window as any).__tugBridge?.onSettingsLoaded?.(data);
}

function fireDevModeChanged(confirmed: boolean) {
  (window as any).__tugBridge?.onDevModeChanged?.(confirmed);
}

function fireSourceTreeSelected(path: string) {
  (window as any).__tugBridge?.onSourceTreeSelected?.(path);
}

/** Find the Radix RadioGroupItem button for a theme by its id attribute. */
function getThemeRadio(container: HTMLElement, theme: string): HTMLButtonElement | null {
  return container.querySelector(`button[role='radio'][id='theme-${theme}']`);
}

/** Find the dev mode Switch button. */
function getDevSwitch(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector("button[role='switch'][id='dev-mode-switch']");
}

/** Find the "Choose..." button (not a radio or switch). */
function getChooseBtn(container: HTMLElement): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => b.role !== "radio" && b.role !== "switch" && b.textContent?.includes("Choose")
  ) as HTMLButtonElement | null;
}

// ---- Tests ----

describe("SettingsCard – theme selection", () => {
  beforeEach(() => {
    document.body.classList.remove("td-theme-bluenote", "td-theme-harmony");
    disableBridge();
  });

  afterEach(() => {
    document.body.classList.remove("td-theme-bluenote", "td-theme-harmony");
    disableBridge();
  });

  it("renders radio options for all 3 themes", async () => {
    const { container, unmount } = renderSettingsCard();
    await act(async () => {});

    expect(getThemeRadio(container, "brio")).not.toBeNull();
    expect(getThemeRadio(container, "bluenote")).not.toBeNull();
    expect(getThemeRadio(container, "harmony")).not.toBeNull();

    const labels = Array.from(container.querySelectorAll("label")).map((el) =>
      el.textContent?.trim()
    );
    expect(labels).toContain("Brio");
    expect(labels).toContain("Bluenote");
    expect(labels).toContain("Harmony");

    unmount();
  });

  it("applies td-theme-bluenote class to body when Bluenote radio is clicked", async () => {
    const { container, unmount } = renderSettingsCard();
    await act(async () => {});

    const bluenoteBtn = getThemeRadio(container, "bluenote");
    expect(bluenoteBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(bluenoteBtn!);
    });

    expect(document.body.classList.contains("td-theme-bluenote")).toBe(true);
    unmount();
  });

  it("dispatches td-theme-change event on document when theme radio changes", async () => {
    const received: CustomEvent[] = [];
    const listener = (e: Event) => received.push(e as CustomEvent);
    document.addEventListener("td-theme-change", listener);

    const { container, unmount } = renderSettingsCard();
    await act(async () => {});

    const harmonyBtn = getThemeRadio(container, "harmony");
    expect(harmonyBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(harmonyBtn!);
    });

    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1].detail?.theme).toBe("harmony");

    document.removeEventListener("td-theme-change", listener);
    unmount();
  });
});

describe("SettingsCard – dev mode switch", () => {
  afterEach(() => {
    disableBridge();
  });

  it("switch is disabled initially when bridge is unavailable", async () => {
    disableBridge();
    const { container, unmount } = renderSettingsCard();
    await act(async () => {});

    const devSwitch = getDevSwitch(container);
    expect(devSwitch).not.toBeNull();
    expect(devSwitch?.disabled).toBe(true);

    unmount();
  });

  it("switch is disabled when source tree is null after settings load", async () => {
    enableBridge();
    const { container, unmount } = renderSettingsCard();
    await act(async () => {});

    await act(async () => {
      fireSettingsLoaded({ devMode: false, sourceTree: null });
    });

    const devSwitch = getDevSwitch(container);
    expect(devSwitch).not.toBeNull();
    expect(devSwitch?.disabled).toBe(true);

    unmount();
    disableBridge();
  });

  it("calls sendControlFrame('set-dev-mode') when switch is toggled", async () => {
    enableBridge();
    const conn = makeMockConnection();
    const { container, unmount } = renderSettingsCard(conn);
    await act(async () => {});

    await act(async () => {
      fireSettingsLoaded({ devMode: false, sourceTree: "/path/to/tug" });
    });

    const devSwitch = getDevSwitch(container);
    expect(devSwitch).not.toBeNull();
    expect(devSwitch?.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(devSwitch!);
    });

    const devModeCall = conn._calls.find((c) => c.action === "set-dev-mode");
    expect(devModeCall).not.toBeUndefined();
    expect(typeof devModeCall?.params?.enabled).toBe("boolean");

    unmount();
    disableBridge();
  });

  it("onDevModeChanged callback updates switch checked state", async () => {
    enableBridge();
    const conn = makeMockConnection();
    const { container, unmount } = renderSettingsCard(conn);
    await act(async () => {});

    await act(async () => {
      fireSettingsLoaded({ devMode: false, sourceTree: "/path/to/tug" });
    });

    const devSwitch = getDevSwitch(container);
    expect(devSwitch).not.toBeNull();
    expect(devSwitch?.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      fireDevModeChanged(true);
    });

    expect(devSwitch?.getAttribute("aria-checked")).toBe("true");

    unmount();
    disableBridge();
  });

  it("switch reverts state on 3-second timeout when bridge doesn't respond", async () => {
    enableBridge();
    const conn = makeMockConnection();
    const { container, unmount } = renderSettingsCard(conn);
    await act(async () => {});

    await act(async () => {
      fireSettingsLoaded({ devMode: false, sourceTree: "/path/to/tug" });
    });

    const devSwitch = getDevSwitch(container);
    expect(devSwitch?.getAttribute("aria-checked")).toBe("false");

    // Toggle (optimistic update: checked → true)
    await act(async () => {
      fireEvent.click(devSwitch!);
    });
    expect(devSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(devSwitch?.disabled).toBe(true);

    // Wait past the 3-second timeout — no bridge response
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3100));
    });

    // Reverted: back to unchecked, re-enabled
    expect(devSwitch?.getAttribute("aria-checked")).toBe("false");
    expect(devSwitch?.disabled).toBe(false);

    unmount();
    disableBridge();
  });
});

describe("SettingsCard – source tree", () => {
  afterEach(() => {
    disableBridge();
  });

  it("displays '(not set)' when bridge available but no source tree loaded", async () => {
    enableBridge();
    const { container, unmount } = renderSettingsCard();
    await act(async () => {});

    await act(async () => {
      fireSettingsLoaded({ devMode: false, sourceTree: null });
    });

    const spans = Array.from(container.querySelectorAll("span"));
    const pathSpan = spans.find((el) => el.textContent?.includes("not set"));
    expect(pathSpan).not.toBeNull();

    unmount();
    disableBridge();
  });

  it("updates source tree display when onSourceTreeSelected fires", async () => {
    enableBridge();
    const { container, unmount } = renderSettingsCard();
    await act(async () => {});

    await act(async () => {
      fireSettingsLoaded({ devMode: false, sourceTree: null });
    });

    await act(async () => {
      fireSourceTreeSelected("/Users/ken/src/tug");
    });

    const spans = Array.from(container.querySelectorAll("span"));
    const pathSpan = spans.find((el) =>
      el.textContent?.includes("/Users/ken/src/tug")
    );
    expect(pathSpan).not.toBeNull();

    unmount();
    disableBridge();
  });

  it("calls sendControlFrame('choose-source-tree') when Choose button is clicked", async () => {
    enableBridge();
    const conn = makeMockConnection();
    const { container, unmount } = renderSettingsCard(conn);
    await act(async () => {});

    const chooseBtn = getChooseBtn(container);
    expect(chooseBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(chooseBtn!);
    });

    const call = conn._calls.find((c) => c.action === "choose-source-tree");
    expect(call).not.toBeUndefined();

    unmount();
    disableBridge();
  });
});

describe("SettingsCard – bridge cleanup", () => {
  afterEach(() => {
    disableBridge();
  });

  it("clears all bridge callbacks on unmount", async () => {
    enableBridge();
    const { unmount } = renderSettingsCard();
    await act(async () => {});

    // Callbacks are registered after mount
    expect(typeof (window as any).__tugBridge?.onSettingsLoaded).toBe("function");
    expect(typeof (window as any).__tugBridge?.onDevModeChanged).toBe("function");
    expect(typeof (window as any).__tugBridge?.onDevModeError).toBe("function");
    expect(typeof (window as any).__tugBridge?.onSourceTreeSelected).toBe("function");

    await act(async () => {
      unmount();
    });

    expect((window as any).__tugBridge?.onSettingsLoaded).toBeUndefined();
    expect((window as any).__tugBridge?.onDevModeChanged).toBeUndefined();
    expect((window as any).__tugBridge?.onDevModeError).toBeUndefined();
    expect((window as any).__tugBridge?.onSourceTreeSelected).toBeUndefined();

    disableBridge();
  });
});
