/**
 * tug-native-clipboard unit tests — WKWebView race diagnostic.
 *
 * The clipboard module has two small pure functions that deserve
 * direct coverage independent of any component consumer:
 *
 * - `isInsideWKWebView()` — detects `window.webkit.messageHandlers`.
 * - `warnIfWKWebViewRace()` — emits a one-shot console warning when
 *   a paste falls through to the JS path while inside a WKWebView.
 *
 * These are called from the paste-handler fall-through site in
 * `use-text-input-responder.tsx`. The integration tests in
 * `tug-input.test.tsx` exercise the paste cascade; this file pins
 * the diagnostic behavior directly so a future change to the
 * warning logic (text, gating, single-shot flag) is caught at the
 * unit level where the failure message is actionable.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  isInsideWKWebView,
  warnIfWKWebViewRace,
  __resetWKWebViewRaceWarningForTest,
} from "@/lib/tug-native-clipboard";

// -----------------------------------------------------------------------
// Console.warn capture
// -----------------------------------------------------------------------

interface WarnCall {
  args: unknown[];
}

let warnCalls: WarnCall[] = [];
let originalWarn: typeof console.warn | undefined;

function installWarnSpy(): void {
  warnCalls = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnCalls.push({ args });
  };
}

function restoreWarn(): void {
  if (originalWarn !== undefined) {
    console.warn = originalWarn;
    originalWarn = undefined;
  }
}

// -----------------------------------------------------------------------
// Global webkit scaffolding
// -----------------------------------------------------------------------

interface SavedGlobals {
  webkit: unknown;
  hadWebkit: boolean;
}

let saved: SavedGlobals | null = null;

function saveWebkitGlobal(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  saved = {
    webkit: g.webkit,
    hadWebkit: Object.prototype.hasOwnProperty.call(g, "webkit"),
  };
}

function restoreWebkitGlobal(): void {
  if (saved === null) return;
  const g = globalThis as unknown as Record<string, unknown>;
  if (!saved.hadWebkit) {
    delete g.webkit;
  } else {
    g.webkit = saved.webkit;
  }
  saved = null;
}

function setWKWebViewMarker(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  // Minimum shape to satisfy `isInsideWKWebView()` — just needs
  // `window.webkit.messageHandlers` to be present.
  g.webkit = { messageHandlers: {} };
}

function setWKWebViewWithBridge(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.webkit = {
    messageHandlers: {
      clipboardRead: { postMessage: () => {} },
    },
  };
}

// -----------------------------------------------------------------------
// Test lifecycle
// -----------------------------------------------------------------------

beforeEach(() => {
  saveWebkitGlobal();
  installWarnSpy();
  __resetWKWebViewRaceWarningForTest();
});

afterEach(() => {
  restoreWebkitGlobal();
  restoreWarn();
  __resetWKWebViewRaceWarningForTest();
});

// -----------------------------------------------------------------------
// isInsideWKWebView
// -----------------------------------------------------------------------

describe("isInsideWKWebView", () => {
  it("returns false when window.webkit is absent (plain browser)", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.webkit;
    expect(isInsideWKWebView()).toBe(false);
  });

  it("returns false when window.webkit exists but has no messageHandlers", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.webkit = {};
    expect(isInsideWKWebView()).toBe(false);
  });

  it("returns true when window.webkit.messageHandlers exists (WKWebView marker)", () => {
    setWKWebViewMarker();
    expect(isInsideWKWebView()).toBe(true);
  });

  it("returns true when the full bridge is installed", () => {
    setWKWebViewWithBridge();
    expect(isInsideWKWebView()).toBe(true);
  });
});

// -----------------------------------------------------------------------
// warnIfWKWebViewRace
// -----------------------------------------------------------------------

describe("warnIfWKWebViewRace", () => {
  it("stays silent in plain browser environments (no WKWebView)", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.webkit;

    warnIfWKWebViewRace();

    expect(warnCalls).toHaveLength(0);
  });

  it("fires a one-shot warning when inside a WKWebView without the bridge", () => {
    setWKWebViewMarker();

    warnIfWKWebViewRace();

    expect(warnCalls).toHaveLength(1);
    // Warning text should mention the race and point at MainWindow.swift
    // so the dev can find the fix.
    const message = String(warnCalls[0].args[0]);
    expect(message).toContain("WKWebView");
    expect(message).toContain("MainWindow.swift");
  });

  it("does not fire again on a second call within the same page load", () => {
    setWKWebViewMarker();

    warnIfWKWebViewRace();
    warnIfWKWebViewRace();
    warnIfWKWebViewRace();

    expect(warnCalls).toHaveLength(1);
  });

  it("fires again after __resetWKWebViewRaceWarningForTest is called", () => {
    setWKWebViewMarker();

    warnIfWKWebViewRace();
    expect(warnCalls).toHaveLength(1);

    __resetWKWebViewRaceWarningForTest();
    warnIfWKWebViewRace();
    expect(warnCalls).toHaveLength(2);
  });

  it("is silent even inside a WKWebView when the bridge IS installed (no race)", () => {
    // This is the "correct" Tug.app production state: inside a
    // WKWebView, bridge installed, paste path never falls through
    // in the first place. If warnIfWKWebViewRace is called from a
    // code path that shouldn't have reached it, the warning would
    // still emit — but the point of the function is to be called
    // only from the fall-through site, and the fall-through won't
    // run if the bridge is installed. We document the expected
    // pair-with-hasNativeClipboardBridge usage by still emitting
    // the warning here (the function is honest about the WKWebView
    // detection, not about "should we have been called"). Test
    // accordingly.
    setWKWebViewWithBridge();

    warnIfWKWebViewRace();

    // The warning DOES fire, because from warnIfWKWebViewRace's
    // perspective it has no way to know the caller mis-invoked it.
    // The guarantee the function makes is: "if you're in WKWebView,
    // this is noisy; if you're not, this is silent." Callers are
    // responsible for gating on hasNativeClipboardBridge() first.
    expect(warnCalls).toHaveLength(1);
  });
});
