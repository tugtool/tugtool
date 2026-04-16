/**
 * TugPromptInput — `setRoute` coverage (plan Spec S04).
 *
 * This suite is the Step 1 unit-test contract for the new
 * composition-layer imperative method `setRoute(char)` that widens
 * `TugTextInputDelegate` into `TugPromptInputDelegate`. See plan
 * [Q01] for the layering rationale (the method lives on the
 * component-layer delegate, not the engine-layer delegate).
 *
 * What we test here:
 *   1. `setRoute(">")` on an empty input routes through the engine
 *      primitives `clear()` then `insertText(">")` in that order.
 *   2. `setRoute("$")` on a non-empty input wipes prior content
 *      first (same sequence — clear before insertText).
 *   3. `setRoute(">")` fires `onRouteChange(">")` exactly once via
 *      the engine's existing route-detection path, using a minimal
 *      `document.execCommand` shim so the engine's `input` listener
 *      fires under happy-dom.
 *   4. `setRoute("x")` where `"x"` is not a configured routePrefix
 *      inserts the character but does NOT fire `onRouteChange`.
 *   5. Type-level: a `RefObject<TugPromptInputDelegate>` can call
 *      both inherited `TugTextInputDelegate` members (`clear`,
 *      `insertText`, `focus`, `isEmpty`) and the new `setRoute`
 *      method — enforced by a compile-time type assertion.
 *
 * Testing strategy:
 *   - `TugTextEngine.prototype.clear` and `.insertText` are
 *     spied via `bun:test`'s `spyOn` so we can assert the
 *     mechanical delegation in `setRoute` (tests 1 and 2).
 *   - A minimal execCommand shim lets the engine's `input`
 *     listener fire and exercise the `detectRoutePrefix` path
 *     for tests 3 and 4. happy-dom does not implement
 *     `document.execCommand` meaningfully; we supply just
 *     enough behavior for the branches we care about.
 *   - `persistState={false}` on the rendered input disables the
 *     tugbank persistence hook (no workspace key needed).
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "../../../__tests__/setup-rtl";

import React, { useRef, useLayoutEffect } from "react";
import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { act } from "react";

import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugPromptInputDelegate } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/lib/tug-text-engine";
import { TugTextEngine } from "@/lib/tug-text-engine";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

// ---------------------------------------------------------------------------
// execCommand shim
// ---------------------------------------------------------------------------
//
// happy-dom does not implement `document.execCommand` in a way that
// mutates the DOM and fires synthetic `input` events. The engine's
// `insertText()` relies on this behavior for route detection. We
// install a tiny shim that:
//
//   - `"insertText"` : append the text to the editor root and fire
//                      a synthetic `input` event with
//                      `inputType: "insertText"`. This is the only
//                      branch route detection needs to see.
//   - `"delete"`     : remove the currently-selected text range.
//                      The engine's `detectRoutePrefix` calls this
//                      to consume the leading char before inserting
//                      the route atom; the shim only needs to not
//                      throw.
//   - `"insertHTML"` : append the HTML fragment to the editor root
//                      as a best-effort parse; detectRoutePrefix
//                      uses this to materialize the route atom
//                      <img>. For the tests here, we only need to
//                      avoid throwing.
//
// The shim is installed and uninstalled per-test via beforeEach /
// afterEach. It dispatches events through whatever element the
// current selection lives in; if no selection, it falls back to
// the element marked `contenteditable="true"` in the test DOM.

interface ExecCommandCallLog {
  command: string;
  value: string | undefined;
}

let execCommandCalls: ExecCommandCallLog[] = [];
let originalExecCommand: Document["execCommand"] | undefined;

function findEditableRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[contenteditable="true"]');
}

function installExecCommandShim() {
  execCommandCalls = [];
  originalExecCommand = document.execCommand;
  document.execCommand = function (
    command: string,
    _showUI?: boolean,
    value?: string,
  ): boolean {
    execCommandCalls.push({ command, value });

    const root = findEditableRoot();
    if (!root) return true;

    if (command === "insertText" && typeof value === "string") {
      // Append the text as a trailing text node so the engine's
      // getText() (which walks childNodes) sees it.
      const textNode = document.createTextNode(value);
      root.appendChild(textNode);
      const ev = new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "insertText",
        data: value,
      });
      root.dispatchEvent(ev);
      return true;
    }

    if (command === "delete") {
      // Consume the current selection's text content if one exists.
      // Do NOT dispatch a synthetic input event here — detectRoutePrefix
      // calls `delete` followed immediately by `insertHTML`, and
      // re-entering the input listener between those two calls would
      // trigger a second pass of route detection against a half-mutated
      // DOM. The real browser's execCommand coalesces the subsequent
      // insertHTML into a single input event; we approximate that by
      // suppressing the intermediate event entirely.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
      }
      return true;
    }

    if (command === "insertHTML" && typeof value === "string") {
      // Minimal HTML insertion — parse the fragment and append it.
      // detectRoutePrefix uses this to materialize a route-atom <img>.
      // Again, no synthetic input event — detectRoutePrefix's epilogue
      // sets `_hasRouteAtom = true` and fires `onRouteChange` directly,
      // so the engine does not need the input listener to fire here.
      const template = document.createElement("template");
      template.innerHTML = value;
      root.appendChild(template.content);
      return true;
    }

    return true;
  } as Document["execCommand"];
}

function uninstallExecCommandShim() {
  if (originalExecCommand) {
    document.execCommand = originalExecCommand;
    originalExecCommand = undefined;
  }
}

// ---------------------------------------------------------------------------
// Canvas 2D shim
// ---------------------------------------------------------------------------
//
// happy-dom does not implement `HTMLCanvasElement.getContext("2d")`. The
// engine's route-atom rendering path (`tug-atom-img.ts`) creates a shared
// measurement canvas to compute label widths; without a context, route
// atom generation throws mid-`detectRoutePrefix`, so `onRouteChange`
// never fires. The shim returns a minimal 2D-context-shaped object
// that provides just the surface area the atom code uses: a writable
// `font` and a `measureText(text)` that returns a plausible width.

interface MinimalCtx2D {
  font: string;
  measureText(text: string): { width: number };
}

let originalGetContext: HTMLCanvasElement["getContext"] | undefined;

function getCanvasProto(): { getContext: HTMLCanvasElement["getContext"] } | null {
  // Probe the actual prototype from a live canvas instance — whatever
  // `document.createElement("canvas")` returns is the class that the
  // engine's atom-img code also uses, so shimming that prototype covers
  // the production path exactly.
  const probe = document.createElement("canvas");
  const proto = Object.getPrototypeOf(probe);
  return proto && typeof proto.getContext === "function" ? proto : null;
}

function installCanvas2DShim() {
  const proto = getCanvasProto();
  if (!proto) return;
  originalGetContext = proto.getContext;
  proto.getContext = function (contextId: string): MinimalCtx2D | null {
    if (contextId !== "2d") return null;
    let fontState = "12px sans-serif";
    return {
      get font() { return fontState; },
      set font(v: string) { fontState = v; },
      measureText(text: string) {
        // Approximate width — one em per character is a safe upper
        // bound for the atom truncation math. The engine only uses
        // the result to decide whether to truncate the label, so
        // over-estimating is harmless.
        return { width: text.length * 8 };
      },
    };
  } as unknown as HTMLCanvasElement["getContext"];
}

function uninstallCanvas2DShim() {
  const proto = getCanvasProto();
  if (proto && originalGetContext) {
    proto.getContext = originalGetContext;
    originalGetContext = undefined;
  }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/**
 * Renders TugPromptInput with `persistState={false}` (no tugbank
 * persistence — no workspace key required) and exposes the widened
 * imperative handle as `delegateRef.current`.
 */
interface HarnessProps {
  onRouteChange?: (route: string | null) => void;
  routePrefixes?: string[];
  captureDelegate: (delegate: TugPromptInputDelegate | null) => void;
}

function Harness({ onRouteChange, routePrefixes, captureDelegate }: HarnessProps) {
  const ref = useRef<TugPromptInputDelegate | null>(null);
  useLayoutEffect(() => {
    captureDelegate(ref.current);
    return () => captureDelegate(null);
  }, [captureDelegate]);
  return (
    <TugPromptInput
      ref={ref}
      persistState={false}
      routePrefixes={routePrefixes}
      onRouteChange={onRouteChange}
    />
  );
}

/**
 * Render the harness inside a `ResponderChainProvider`. `TugPromptInput`
 * registers as a chain participant via `useResponder`, which requires
 * a provider in scope; supplying one here keeps the harness minimal
 * and matches the component's production usage.
 */
function renderHarness(props: HarnessProps) {
  return render(
    <ResponderChainProvider>
      <Harness {...props} />
    </ResponderChainProvider>
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

// Engine-prototype spies are installed on demand — only the
// delegation tests (which don't need the engine to do real work)
// install them. The route-detection tests rely on the real
// `insertText` routing through `document.execCommand("insertText")`
// so the input listener fires; spying on the prototype would
// short-circuit that path and break the assertion.
let clearSpy: ReturnType<typeof spyOn> | null = null;
let insertTextSpy: ReturnType<typeof spyOn> | null = null;

function installEngineSpies() {
  clearSpy = spyOn(TugTextEngine.prototype, "clear");
  insertTextSpy = spyOn(TugTextEngine.prototype, "insertText");
}

function restoreEngineSpies() {
  clearSpy?.mockRestore();
  insertTextSpy?.mockRestore();
  clearSpy = null;
  insertTextSpy = null;
}

beforeEach(() => {
  installExecCommandShim();
  installCanvas2DShim();
});

afterEach(() => {
  cleanup();
  uninstallExecCommandShim();
  uninstallCanvas2DShim();
  restoreEngineSpies();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TugPromptInput.setRoute — delegation (Spec S04)", () => {
  it("setRoute('>') on an empty input calls engine.clear() then engine.insertText('>') in that order", () => {
    let delegate: TugPromptInputDelegate | null = null;
    renderHarness({
      routePrefixes: [">", "$", ":"],
      captureDelegate: (d) => { delegate = d; },
    });
    expect(delegate).not.toBeNull();

    // Install spies after render so engine construction is not
    // counted; the setRoute call under test is the only expected
    // invocation of clear() and insertText().
    installEngineSpies();

    act(() => {
      delegate!.setRoute(">");
    });

    expect(clearSpy!).toHaveBeenCalledTimes(1);
    expect(insertTextSpy!).toHaveBeenCalledTimes(1);
    expect(insertTextSpy!).toHaveBeenCalledWith(">");

    // clear() must precede insertText() so the leading character is
    // the route char, not appended to prior content.
    const clearCall = clearSpy!.mock.invocationCallOrder[0];
    const insertCall = insertTextSpy!.mock.invocationCallOrder[0];
    expect(clearCall).toBeLessThan(insertCall);
  });

  it("setRoute('$') on a non-empty input still calls clear() before insertText('$') (wipes prior content)", () => {
    let delegate: TugPromptInputDelegate | null = null;
    renderHarness({
      routePrefixes: [">", "$", ":"],
      captureDelegate: (d) => { delegate = d; },
    });
    expect(delegate).not.toBeNull();

    // Prime the input with prior content via the delegate's own
    // insertText (which routes through the same engine primitive).
    act(() => {
      delegate!.insertText("hello world");
    });

    // Install spies after priming so only the setRoute path is
    // observed. This also avoids conflating the priming insertText
    // call with the setRoute insertText call.
    installEngineSpies();

    act(() => {
      delegate!.setRoute("$");
    });

    expect(clearSpy!).toHaveBeenCalledTimes(1);
    expect(insertTextSpy!).toHaveBeenCalledTimes(1);
    expect(insertTextSpy!).toHaveBeenCalledWith("$");
    const clearCall = clearSpy!.mock.invocationCallOrder[0];
    const insertCall = insertTextSpy!.mock.invocationCallOrder[0];
    expect(clearCall).toBeLessThan(insertCall);
  });
});

describe("TugPromptInput.setRoute — route detection integration (Spec S04)", () => {
  it("setRoute('>') fires onRouteChange('>') exactly once via the engine's existing detection path", () => {
    const onRouteChange = mock<(route: string | null) => void>(() => {});
    let delegate: TugPromptInputDelegate | null = null;
    renderHarness({
      routePrefixes: [">", "$", ":"],
      onRouteChange,
      captureDelegate: (d) => { delegate = d; },
    });
    expect(delegate).not.toBeNull();

    act(() => {
      delegate!.setRoute(">");
    });

    // detectRoutePrefix runs in the engine's input listener and
    // invokes onRouteChange synchronously with the prefix char.
    const prefixCalls = onRouteChange.mock.calls.filter(
      ([r]) => r === ">",
    );
    expect(prefixCalls.length).toBe(1);
  });

  it("setRoute('x') with 'x' not in routePrefixes does NOT fire onRouteChange", () => {
    const onRouteChange = mock<(route: string | null) => void>(() => {});
    let delegate: TugPromptInputDelegate | null = null;
    renderHarness({
      routePrefixes: [">", "$", ":"],
      onRouteChange,
      captureDelegate: (d) => { delegate = d; },
    });
    expect(delegate).not.toBeNull();

    act(() => {
      delegate!.setRoute("x");
    });

    // No call with a non-null route value. (onRouteChange may be
    // called with null if the engine clears a prior route atom
    // that didn't exist — but it must never be called with "x".)
    const routeCalls = onRouteChange.mock.calls.filter(
      ([r]) => typeof r === "string",
    );
    expect(routeCalls).toEqual([]);
  });
});

describe("TugPromptInput.setRoute — type surface (Spec S04)", () => {
  it("TugPromptInputDelegate exposes both inherited TugTextInputDelegate methods and setRoute", () => {
    // Compile-time assertion: the widened delegate must be assignable
    // to TugTextInputDelegate (supertype) and must have a `setRoute`
    // of the documented signature. If the widening regresses (e.g.,
    // someone accidentally narrows `forwardRef` back to
    // `TugTextInputDelegate`), this block will fail to type-check
    // and `bun run check` will error out before tests even run.
    const assertType = <T,>(_t: T): void => { /* no-op */ };

    // The supertype relationship — TugPromptInputDelegate extends
    // TugTextInputDelegate.
    type IsSupertype = TugPromptInputDelegate extends TugTextInputDelegate
      ? true
      : false;
    const _isSuper: IsSupertype = true;
    assertType<true>(_isSuper);

    // The new method's signature.
    type SetRouteSig = TugPromptInputDelegate["setRoute"];
    type ExpectedSig = (char: string) => void;
    type IsExactMatch = SetRouteSig extends ExpectedSig
      ? ExpectedSig extends SetRouteSig ? true : false
      : false;
    const _isExact: IsExactMatch = true;
    assertType<true>(_isExact);

    // A runtime sanity check that the above compile-time assertions
    // are paired with a real expectation so the test is recognized
    // as passing rather than empty.
    expect(_isSuper).toBe(true);
    expect(_isExact).toBe(true);
  });
});
