/**
 * TugPromptEntry — Step 2 scaffold + Step 3 input-delegate + Step 4
 * route-indicator bidirectional sync suite.
 *
 * Step 2 is the scaffold commit: the component mounts, subscribes to the
 * session-store snapshot, registers a responder scope with no-op SUBMIT and
 * signature-correct SELECT_VALUE handler bodies, and renders its layout
 * against a minimal `MockTugConnection`-backed store.
 *
 * Step 3 extends the file with delegate forwarding + `data-empty` tests.
 * Step 4 extends it with route-indicator ↔ input round-trip tests. Later
 * steps extend this file:
 *
 *   • Step 5 — send / interrupt / queue / errored tests.
 *
 * What this file verifies (Step 2 only):
 *
 *   1. The component renders without throwing against a fresh store.
 *   2. Root element carries `data-slot="tug-prompt-entry"` and
 *      `data-responder-id="<id>"` (the latter written by useResponder).
 *   3. Initial-phase attributes — `data-phase="idle"`,
 *      `data-can-interrupt="false"` — come straight from the initial
 *      snapshot per [D02] (#d02-data-attributes-from-snapshot).
 *   4. The submit button is NOT `aria-disabled`: the Step 2 no-op
 *      `TUG_ACTIONS.SUBMIT` handler stub is registered so TugPushButton's
 *      chain-action mode sees `nodeCanHandle(SUBMIT)` return true. This
 *      is the key assertion for Risk R04 — the transient-state fix from
 *      the plan.
 *   5. Base chrome is present — the toolbar wrapper with its class name
 *      renders, and the root element carries the `.tug-prompt-entry`
 *      class. JSDOM does not produce reliable numeric computed styles
 *      for CSS variables, so the smoke test falls back to verifying the
 *      class names + `data-*` attributes per plan task 9.
 *
 * Testing strategy:
 *   - A minimal `MockTugConnection` (from the existing session-store
 *     testing helper) is passed to a real `CodeSessionStore`; the store
 *     starts in `idle` with no frames dispatched.
 *   - A tiny `SessionMetadataStore` is built against a throwaway mock
 *     FeedStore (the metadata store is accepted for T3.4.c but unused
 *     by the Step 2 scaffold — supplying it keeps the props contract
 *     real).
 *   - `PromptHistoryStore` is instantiated directly; it needs no external
 *     wiring to construct.
 *   - A no-op `CompletionProvider` closure is passed as the file
 *     completion provider. `TugPromptInput` reads it internally — the
 *     scaffold does not exercise completion.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "../../../__tests__/setup-rtl";

import React from "react";
import { act } from "react";
import { describe, it, expect, afterEach, beforeEach, spyOn } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";

import { TugPromptEntry, type TugPromptEntryDelegate } from "@/components/tugways/tug-prompt-entry";
import { TugTextEngine } from "@/lib/tug-text-engine";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import {
  ResponderChainContext,
  type ResponderChainManager,
} from "@/components/tugways/responder-chain";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { MockTugConnection } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import type { CompletionProvider } from "@/lib/tug-text-engine";

// ---------------------------------------------------------------------------
// Minimal FeedStore shim for SessionMetadataStore
// ---------------------------------------------------------------------------
//
// SessionMetadataStore's constructor calls `feedStore.subscribe(listener)`
// once at construction. The smoke test never emits anything, so the shim
// only needs to stash the listener and implement a no-op `getSnapshot`.
// Mirrors the shape from `session-metadata-store.test.ts`.

class InertFeedStore {
  subscribe(_listener: () => void): () => void {
    return () => {};
  }
  getSnapshot(): Map<number, unknown> {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Test harness — builds a minimal set of mock services for a single render.
// ---------------------------------------------------------------------------

interface MockServices {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  historyStore: PromptHistoryStore;
  fileCompletionProvider: CompletionProvider;
}

/**
 * Construct a fresh set of mock services for one test render. Each call
 * produces independent instances — no shared module-scope state — so tests
 * cannot leak state into one another.
 */
function buildMockServices(): MockServices {
  const conn = new MockTugConnection() as unknown as TugConnection;
  const codeSessionStore = new CodeSessionStore({
    conn,
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
  });
  const inertFeed = new InertFeedStore() as never;
  const sessionMetadataStore = new SessionMetadataStore(inertFeed, 0x40 as never);
  const historyStore = new PromptHistoryStore();
  const fileCompletionProvider: CompletionProvider = () => [];
  return {
    codeSessionStore,
    sessionMetadataStore,
    historyStore,
    fileCompletionProvider,
  };
}

/**
 * Render `<TugPromptEntry />` inside a `ResponderChainProvider` with the
 * supplied id. The provider is required because the component calls
 * `useResponder` (strict form); without a provider the hook throws by
 * design.
 */
function renderEntry(id: string = "prompt-entry-under-test") {
  const services = buildMockServices();
  const utils = render(
    <ResponderChainProvider>
      <TugPromptEntry id={id} {...services} />
    </ResponderChainProvider>,
  );
  return { ...utils, services, id };
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TugPromptEntry — Step 2 scaffold", () => {
  it("renders without throwing against a minimal MockTugConnection-backed store", () => {
    const { container } = renderEntry();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    );
    expect(root).not.toBeNull();
  });

  it("writes data-slot and data-responder-id on the root element", () => {
    const { container, id } = renderEntry("prompt-entry-r2-id");
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    );
    expect(root).not.toBeNull();
    // `data-responder-id` is written by useResponder's responderRef
    // callback. The Step 2 scaffold routes that callback through
    // `composedRootRef`, so the attribute must land on the same
    // element as `data-slot="tug-prompt-entry"`.
    expect(root!.getAttribute("data-responder-id")).toBe(id);
  });

  it("reflects initial snapshot state via data-phase / data-can-interrupt", () => {
    const { container } = renderEntry();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    // A freshly constructed CodeSessionStore starts in `idle` with
    // canInterrupt=false. See code-session-store.scaffold.test.ts for
    // the contract this assertion leans on.
    expect(root.getAttribute("data-phase")).toBe("idle");
    expect(root.getAttribute("data-can-interrupt")).toBe("false");
    // canSubmit is true in idle per the store's getSnapshot contract.
    expect(root.getAttribute("data-can-submit")).toBe("true");
    // No pendingApproval / pendingQuestion / queue / error in the
    // pristine snapshot — presence-style attributes are therefore
    // absent rather than set to "false".
    expect(root.hasAttribute("data-pending-approval")).toBe(false);
    expect(root.hasAttribute("data-pending-question")).toBe(false);
    expect(root.hasAttribute("data-queued")).toBe(false);
    expect(root.hasAttribute("data-errored")).toBe(false);
  });

  it("renders the submit button live — NOT aria-disabled — because the Step 2 no-op SUBMIT stub is registered (Risk R04 fix)", () => {
    const { container } = renderEntry();
    // Two buttons exist in the scaffold: the route-indicator segments
    // (role="radio") and the submit button (role="button", the default).
    // The submit button is the one whose parent is `.tug-prompt-entry-toolbar`
    // AND whose role defaults to "button" (not "radio"). Select by
    // aria-label for unambiguous identification — see Spec S03's JSX.
    const submitButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Send prompt"]',
    );
    expect(submitButton).not.toBeNull();
    // The whole point of the Step 2 no-op stub is that the button is
    // NOT aria-disabled. If the stub were missing, TugButton's
    // chain-action mode would see `nodeCanHandle(SUBMIT) === false`
    // and render the button with `aria-disabled="true"`.
    expect(submitButton!.getAttribute("aria-disabled")).toBeNull();
    // Defensive: HTML disabled should also be unset in idle (because
    // canSubmit=true).
    expect(submitButton!.hasAttribute("disabled")).toBe(false);
    // Label is "Send" (canInterrupt=false path).
    expect(submitButton!.textContent).toContain("Send");
  });

  it("renders the tug-prompt-entry chrome classes (class-name fallback for JSDOM computed-style unreliability)", () => {
    // Plan task 9 calls out the JSDOM computed-style fallback: when
    // numeric computed styles for CSS variables aren't reliable, the
    // smoke test verifies the class names and data-* attributes
    // instead. The presence of both class names confirms the CSS
    // module was imported and the layout rendered.
    const { container } = renderEntry();
    const root = container.querySelector<HTMLElement>(".tug-prompt-entry");
    expect(root).not.toBeNull();
    const toolbar = container.querySelector<HTMLElement>(
      ".tug-prompt-entry-toolbar",
    );
    expect(toolbar).not.toBeNull();
    // The toolbar must be a descendant of the root — the scaffold
    // nests the toolbar inside the root div.
    expect(root!.contains(toolbar!)).toBe(true);
  });

  it("omits the queue badge when snap.queuedSends === 0", () => {
    // Conditional JSX render per Spec S03: the <span
    // className="tug-prompt-entry-queue-badge"> element is only in
    // the DOM when `snap.queuedSends > 0`. Idle snapshot has
    // queuedSends === 0, so the badge must be absent.
    const { container } = renderEntry();
    const badge = container.querySelector(".tug-prompt-entry-queue-badge");
    expect(badge).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step 3: shims
// ---------------------------------------------------------------------------
//
// The keystroke-driven tests in the Step 3 suite below need to drive the
// TugTextEngine's `input` listener so the `onChange` callback (and
// therefore the entry's `handleInputChange`) fires. happy-dom does not
// implement `document.execCommand` or `HTMLCanvasElement.getContext("2d")`
// in a way that is useful to the engine's route-detection and atom-
// rendering paths, so we supply the same minimal shims used by the
// TugPromptInput Spec S04 suite. Scoped to beforeEach/afterEach of the
// Step 3 describe block.

let originalExecCommand: Document["execCommand"] | undefined;

function findEditableRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[contenteditable="true"]');
}

function installExecCommandShim() {
  originalExecCommand = document.execCommand;
  document.execCommand = function (
    command: string,
    _showUI?: boolean,
    value?: string,
  ): boolean {
    const root = findEditableRoot();
    if (!root) return true;

    if (command === "insertText" && typeof value === "string") {
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
      // Simulate a backspace: trim one character off the last text
      // node in the editor root and emit a synthetic input event so
      // the engine's `input` listener fires. We ignore the live
      // selection here — happy-dom's Selection API does not reliably
      // model a collapsed caret inside a contenteditable we've
      // populated via appendChild, and the Step 3 tests only need
      // the single-character-backspace path to flip data-empty back
      // to "true". deleteContents on a collapsed range is a no-op in
      // happy-dom, so we always trim unconditionally.
      const last = root.lastChild;
      if (last && last.nodeType === Node.TEXT_NODE) {
        const t = last as Text;
        if (t.data.length > 1) {
          t.data = t.data.slice(0, -1);
        } else {
          root.removeChild(t);
        }
      }
      const ev = new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "deleteContentBackward",
      });
      root.dispatchEvent(ev);
      return true;
    }

    if (command === "insertHTML" && typeof value === "string") {
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

interface MinimalCtx2D {
  font: string;
  measureText(text: string): { width: number };
}

let originalGetContext: HTMLCanvasElement["getContext"] | undefined;

function getCanvasProto(): { getContext: HTMLCanvasElement["getContext"] } | null {
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

/**
 * Render the entry with a forwarded ref and (optionally) a React.Profiler
 * wrapping it. Returns handles the Step 3 tests need.
 */
function renderEntryWithRef(opts: {
  id?: string;
  onRender?: React.ProfilerOnRenderCallback;
} = {}) {
  const id = opts.id ?? "prompt-entry-step3";
  const services = buildMockServices();
  const entryRef = React.createRef<TugPromptEntryDelegate>();
  const tree = (
    <ResponderChainProvider>
      <TugPromptEntry ref={entryRef} id={id} {...services} />
    </ResponderChainProvider>
  );
  const utils = render(
    opts.onRender ? (
      <React.Profiler id="entry" onRender={opts.onRender}>
        {tree}
      </React.Profiler>
    ) : tree,
  );
  return { ...utils, services, id, entryRef };
}

function placeCaretAtEnd(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("TugPromptEntry — Step 3 input delegate + data-empty", () => {
  beforeEach(() => {
    installExecCommandShim();
    installCanvas2DShim();
  });

  afterEach(() => {
    cleanup();
    uninstallExecCommandShim();
    uninstallCanvas2DShim();
  });

  it("initial mount: data-empty=\"true\" on root", () => {
    const { container } = renderEntryWithRef();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-empty")).toBe("true");
  });

  it("typing a character flips data-empty to \"false\" without re-rendering the entry", () => {
    // React.Profiler measures commits for its subtree. handleInputChange
    // uses setAttribute only (no setState), so after the initial-mount
    // commit there must be zero "update" commits in response to the
    // keystroke. If a future regression introduces setState on this
    // path, this assertion catches it immediately.
    const phases: string[] = [];
    const { container } = renderEntryWithRef({
      onRender: (_id, phase) => {
        phases.push(phase);
      },
    });
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-empty")).toBe("true");

    const editor = findEditableRoot();
    expect(editor).not.toBeNull();
    placeCaretAtEnd(editor!);

    const updatesAtStart = phases.filter((p) => p === "update").length;

    act(() => {
      document.execCommand("insertText", false, "x");
    });

    expect(root.getAttribute("data-empty")).toBe("false");
    const updatesAfter = phases.filter((p) => p === "update").length;
    expect(updatesAfter).toBe(updatesAtStart);
  });

  it("backspacing back to empty flips data-empty to \"true\"", () => {
    const { container } = renderEntryWithRef();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;

    const editor = findEditableRoot();
    expect(editor).not.toBeNull();
    placeCaretAtEnd(editor!);

    act(() => {
      document.execCommand("insertText", false, "x");
    });
    expect(root.getAttribute("data-empty")).toBe("false");

    // Re-place caret at end (the shim's insertText appends without
    // moving the selection) then issue a delete.
    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("delete", false);
    });

    expect(root.getAttribute("data-empty")).toBe("true");
  });

  it("ref.current.focus() forwards to the underlying editor element", () => {
    const { container, entryRef } = renderEntryWithRef();
    expect(entryRef.current).not.toBeNull();

    const editor = container.querySelector<HTMLElement>(
      '[contenteditable="true"]',
    );
    expect(editor).not.toBeNull();

    act(() => {
      entryRef.current!.focus();
    });

    // TugPromptInput.focus() calls `engineRef.current.root.focus()` on
    // the contenteditable element. After forwarding through the entry,
    // document.activeElement should be the editor.
    expect(document.activeElement).toBe(editor);
  });

  it("ref.current.clear() forwards to TugPromptInput.clear() → TugTextEngine.prototype.clear", () => {
    const { entryRef } = renderEntryWithRef();
    expect(entryRef.current).not.toBeNull();

    const clearSpy = spyOn(TugTextEngine.prototype, "clear");
    try {
      act(() => {
        entryRef.current!.clear();
      });
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      clearSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Step 4: helper — capture the ResponderChainManager via context
// ---------------------------------------------------------------------------
//
// The step-4 negative tests (wrong sender, wrong value type) dispatch
// SELECT_VALUE events directly rather than by clicking a segment, because
// the indicator itself can only send the one well-formed shape. A tiny
// wrapper component reads the manager from ResponderChainContext and
// stashes it in a ref the test can read after render.

function ChainCapture({ into }: { into: { current: ResponderChainManager | null } }) {
  const mgr = React.useContext(ResponderChainContext);
  into.current = mgr;
  return null;
}

function renderEntryWithManager(opts: {
  id?: string;
  onRender?: React.ProfilerOnRenderCallback;
} = {}) {
  const id = opts.id ?? "prompt-entry-step4";
  const services = buildMockServices();
  const entryRef = React.createRef<TugPromptEntryDelegate>();
  const managerRef: { current: ResponderChainManager | null } = { current: null };
  const tree = (
    <ResponderChainProvider>
      <ChainCapture into={managerRef} />
      <TugPromptEntry ref={entryRef} id={id} {...services} />
    </ResponderChainProvider>
  );
  const utils = render(
    opts.onRender ? (
      <React.Profiler id="entry" onRender={opts.onRender}>
        {tree}
      </React.Profiler>
    ) : tree,
  );
  return { ...utils, services, id, entryRef, managerRef };
}

function getSegment(container: HTMLElement, label: string): HTMLButtonElement {
  const segments = container.querySelectorAll<HTMLButtonElement>(
    'button[role="radio"]',
  );
  for (const seg of segments) {
    if (seg.textContent?.trim() === label) return seg;
  }
  throw new Error(`no segment with label "${label}" found`);
}

describe("TugPromptEntry — Step 4 route indicator bidirectional sync", () => {
  beforeEach(() => {
    installExecCommandShim();
    installCanvas2DShim();
  });

  afterEach(() => {
    cleanup();
    uninstallExecCommandShim();
    uninstallCanvas2DShim();
  });

  it("typing '>' in the input updates route state and activates the '>' segment", () => {
    const { container } = renderEntryWithManager();
    // The ">" segment starts inactive — no route selected yet.
    expect(getSegment(container, ">").getAttribute("data-state")).toBe("inactive");

    const editor = findEditableRoot();
    expect(editor).not.toBeNull();
    placeCaretAtEnd(editor!);

    act(() => {
      document.execCommand("insertText", false, ">");
    });

    // The engine's route-detection path fires onRouteChange(">"),
    // the entry's handleRouteChange calls setRouteState(">"),
    // TugChoiceGroup re-renders and marks the ">" segment active.
    expect(getSegment(container, ">").getAttribute("data-state")).toBe("active");
    // Sibling segments remain inactive.
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("inactive");
    expect(getSegment(container, ":").getAttribute("data-state")).toBe("inactive");
  });

  it("dispatching SELECT_VALUE from the indicator sets route state AND calls setRoute on the input", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();

    // Spy on the engine primitives setRoute delegates to. A call with
    // "$" confirms `promptInputRef.current.setRoute("$")` ran; the
    // clear + insertText pair is the documented delegation order.
    const insertSpy = spyOn(TugTextEngine.prototype, "insertText");
    const clearSpy = spyOn(TugTextEngine.prototype, "clear");

    try {
      act(() => {
        managerRef.current!.sendToTarget(id, {
          action: TUG_ACTIONS.SELECT_VALUE,
          sender: `${id}-route-indicator`,
          value: "$",
          phase: "discrete",
        });
      });

      // Route state updated — the "$" segment is now active.
      expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");
      // setRoute("$") routed through the engine.
      expect(insertSpy).toHaveBeenCalledWith("$");
      // clear() ran before insertText (setRoute's documented order).
      const clearOrders = clearSpy.mock.invocationCallOrder;
      const insertOrders = insertSpy.mock.invocationCallOrder;
      expect(clearOrders.length).toBeGreaterThan(0);
      expect(insertOrders.length).toBeGreaterThan(0);
      const clearOrder = clearOrders[clearOrders.length - 1];
      const insertOrder = insertOrders[insertOrders.length - 1];
      expect(clearOrder).toBeLessThan(insertOrder);
    } finally {
      insertSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it("SELECT_VALUE from a different sender is a no-op (state unchanged, setRoute not called)", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();

    const insertSpy = spyOn(TugTextEngine.prototype, "insertText");
    try {
      act(() => {
        managerRef.current!.sendToTarget(id, {
          action: TUG_ACTIONS.SELECT_VALUE,
          sender: "some-other-sender",
          value: "$",
          phase: "discrete",
        });
      });

      // Route state untouched — no segment flipped to active.
      expect(getSegment(container, ">").getAttribute("data-state")).toBe("inactive");
      expect(getSegment(container, "$").getAttribute("data-state")).toBe("inactive");
      expect(getSegment(container, ":").getAttribute("data-state")).toBe("inactive");
      // Defensive narrowing — setRoute was not called, so the engine's
      // insertText did not run for a route character.
      const called$ = insertSpy.mock.calls.some(([arg]) => arg === "$");
      expect(called$).toBe(false);
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("SELECT_VALUE with a non-string value is a no-op (defensive value narrowing)", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();

    const insertSpy = spyOn(TugTextEngine.prototype, "insertText");
    try {
      act(() => {
        managerRef.current!.sendToTarget(id, {
          action: TUG_ACTIONS.SELECT_VALUE,
          sender: `${id}-route-indicator`,
          value: 42 as unknown,
          phase: "discrete",
        });
      });

      // All segments still inactive.
      expect(getSegment(container, ">").getAttribute("data-state")).toBe("inactive");
      expect(getSegment(container, "$").getAttribute("data-state")).toBe("inactive");
      expect(getSegment(container, ":").getAttribute("data-state")).toBe("inactive");
      // No engine insertText invocation took place.
      expect(insertSpy.mock.calls.length).toBe(0);
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("clicking a segment dispatches SELECT_VALUE end-to-end through the indicator → entry → input", () => {
    const { container } = renderEntryWithManager();
    const segment = getSegment(container, ":");
    expect(segment.getAttribute("data-state")).toBe("inactive");

    const insertSpy = spyOn(TugTextEngine.prototype, "insertText");
    try {
      act(() => {
        fireEvent.click(segment);
      });
      expect(getSegment(container, ":").getAttribute("data-state")).toBe("active");
      expect(insertSpy).toHaveBeenCalledWith(":");
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("SELECT_VALUE round-trip (setRouteState → setRoute → onRouteChange → setRouteState) produces at most one entry commit — React bails on the equal value", () => {
    // React batches synchronous setState inside an event handler into a
    // single commit. The handler calls setRouteState("$") directly,
    // then calls promptInputRef.current.setRoute("$"), which fires the
    // engine's onRouteChange("$"), which calls setRouteState("$") a
    // second time with the same value. React's Object.is check bails
    // out on the redundant call; the dispatch produces one commit.
    const phases: string[] = [];
    const { id, managerRef } = renderEntryWithManager({
      onRender: (_id, phase) => {
        phases.push(phase);
      },
    });
    expect(managerRef.current).not.toBeNull();
    const updatesBefore = phases.filter((p) => p === "update").length;

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: "$",
        phase: "discrete",
      });
    });

    const updatesAfter = phases.filter((p) => p === "update").length;
    // Exactly one additional commit — the state change "" → "$" is a
    // real change so React must commit once; the *second* setRouteState
    // call (from the onRouteChange round-trip with the same value)
    // must bail out via Object.is. If a regression introduces a second
    // setState with a different value, this bumps to 2 and fails.
    expect(updatesAfter - updatesBefore).toBe(1);
  });

  it("onRouteChange(null) clears the pill (backspacing past the leading atom)", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();

    // First, dispatch SELECT_VALUE "$" to put the pill in a non-empty
    // state. This also exercises the SELECT_VALUE → setRoute path
    // which would normally have driven the pill via the engine.
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: "$",
        phase: "discrete",
      });
    });
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");

    // Now simulate the "user backspaced past the leading atom" event:
    // the engine normally fires onRouteChange(null) in that case. We
    // invoke the component's callback indirectly by dispatching
    // another SELECT_VALUE with value="" — but that's a *different*
    // path. To test the null case specifically, we call the input's
    // onRouteChange prop through the rendered TugPromptInput. The
    // simplest way is to dispatch an input event that wipes the
    // route atom; equivalent is to assert via a direct handler call,
    // which is what we do here by re-triggering through setRoute
    // with an empty string and letting the engine's detection clear.
    //
    // Practical shortcut: use the engine's clear() via the delegate
    // and then fire a synthetic input event so onRouteChange(null)
    // propagates through the normal path.
    const editor = findEditableRoot();
    expect(editor).not.toBeNull();
    act(() => {
      // Clear the editor's content. The engine's route-detection
      // runs on the next input event; firing an empty input event
      // triggers onRouteChange(null) because the leading atom is
      // gone.
      while (editor!.firstChild) editor!.removeChild(editor!.firstChild);
      const ev = new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "deleteContentBackward",
      });
      editor!.dispatchEvent(ev);
    });

    // Pill cleared — no segment is active.
    expect(getSegment(container, ">").getAttribute("data-state")).toBe("inactive");
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("inactive");
    expect(getSegment(container, ":").getAttribute("data-state")).toBe("inactive");
  });
});
