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
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import {
  ResponderChainContext,
  type ResponderChainManager,
} from "@/components/tugways/responder-chain";
import type { CodeSessionSnapshot } from "@/lib/code-session-store/types";
import { STREAMING_PATHS } from "@/lib/code-session-store/types";
import type { AtomSegment } from "@/lib/tug-text-engine";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { MockTugConnection } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";

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
  return {
    codeSessionStore,
    sessionMetadataStore,
    historyStore,
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
    // Icon button: the aria-label is the accessible name; the visible
    // children are a lucide-react SVG. The aria-label assertion above
    // already pins the canInterrupt=false branch.
    expect(submitButton!.querySelector("svg")).not.toBeNull();
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

  it("typing a character flips data-empty to \"false\" with no route atom in the text flow", () => {
    // handleInputChange uses setAttribute for data-empty (no setState on
    // the hot path). The route indicator lives in the gutter — not the
    // text flow — so typing must never introduce a route atom into the
    // editor's DOM.
    const { container } = renderEntryWithRef();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-empty")).toBe("true");

    const editor = findEditableRoot();
    expect(editor).not.toBeNull();
    placeCaretAtEnd(editor!);

    act(() => {
      document.execCommand("insertText", false, "x");
    });

    expect(root.getAttribute("data-empty")).toBe("false");
    const atoms = editor!.querySelectorAll('img[data-atom-type="route"]');
    expect(atoms.length).toBe(0);
  });

  it("deleting all typed text returns data-empty to \"true\" with no orphan atom", () => {
    // With the gutter, there is no structural atom in the editor to
    // leave behind. Emptying the editor must report an empty input.
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

    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("delete", false);
    });
    expect(root.getAttribute("data-empty")).toBe("true");
    const atoms = editor!.querySelectorAll('img[data-atom-type="route"]');
    expect(atoms.length).toBe(0);
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

// Segment icons are lucide SVGs (no text content), so the visible
// textContent of each segment is the descriptive word. Map the prefix
// char the tests pass to the textContent substring that identifies the
// segment unambiguously.
const SEGMENT_LABEL_FOR_PREFIX: Record<string, string> = {
  ">": "Prompt",
  "$": "Shell",
  ":": "Command",
};

function getSegment(container: HTMLElement, prefix: string): HTMLButtonElement {
  const label = SEGMENT_LABEL_FOR_PREFIX[prefix] ?? prefix;
  const segments = container.querySelectorAll<HTMLButtonElement>(
    'button[role="radio"]',
  );
  for (const seg of segments) {
    if (seg.textContent?.includes(label)) return seg;
  }
  throw new Error(`no segment matching "${label}" found`);
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

  it("dispatching SELECT_VALUE from the indicator updates the route state and leaves the editor text-only", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();

    // Default is ">" (Prompt). Dispatch to swap to Shell.
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: "$",
        phase: "discrete",
      });
    });

    // "$" segment flipped active; gutter no longer relies on any
    // text-flow atom to represent the route.
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");
    expect(getSegment(container, ">").getAttribute("data-state")).toBe("inactive");
    const editor = findEditableRoot();
    expect(editor).not.toBeNull();
    const routeAtoms = editor!.querySelectorAll('img[data-atom-type="route"]');
    expect(routeAtoms.length).toBe(0);
  });

  it("SELECT_VALUE from a different sender is a no-op (route state unchanged)", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: "some-other-sender",
        value: "$",
        phase: "discrete",
      });
    });

    // Route state untouched — default ">" still active.
    expect(getSegment(container, ">").getAttribute("data-state")).toBe("active");
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("inactive");
    expect(getSegment(container, ":").getAttribute("data-state")).toBe("inactive");
  });

  it("SELECT_VALUE with a non-string value is a no-op (defensive value narrowing)", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: 42 as unknown,
        phase: "discrete",
      });
    });

    expect(getSegment(container, ">").getAttribute("data-state")).toBe("active");
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("inactive");
    expect(getSegment(container, ":").getAttribute("data-state")).toBe("inactive");
  });

  it("clicking a segment dispatches SELECT_VALUE end-to-end through the indicator → entry", () => {
    const { container } = renderEntryWithManager();
    const segment = getSegment(container, ":");
    expect(segment.getAttribute("data-state")).toBe("inactive");

    act(() => {
      fireEvent.click(segment);
    });
    expect(getSegment(container, ":").getAttribute("data-state")).toBe("active");
  });

  it("SELECT_VALUE produces exactly one entry commit (single setRouteState call, no round-trip re-entry)", () => {
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
    // A single state change (">" → "$") yields exactly one commit.
    // Without the legacy setRoute round-trip via onRouteChange, no
    // redundant setRouteState call follows.
    expect(updatesAfter - updatesBefore).toBe(1);
  });

  it("route state is sticky across an editor clear (gutter persists the selection)", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();

    // Switch to Shell.
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: "$",
        phase: "discrete",
      });
    });
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");

    // Emptying the editor's DOM must not disturb the route state —
    // the route lives in the gutter, not the text flow.
    const editor = findEditableRoot();
    expect(editor).not.toBeNull();
    act(() => {
      while (editor!.firstChild) editor!.removeChild(editor!.firstChild);
      const ev = new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        inputType: "deleteContentBackward",
      });
      editor!.dispatchEvent(ev);
    });

    expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");
    expect(getSegment(container, ">").getAttribute("data-state")).toBe("inactive");
    expect(getSegment(container, ":").getAttribute("data-state")).toBe("inactive");
  });
});

// ---------------------------------------------------------------------------
// Step 5: ScriptedStore — minimal CodeSessionStore stub with controllable
// snapshot and spy-able send/interrupt methods.
// ---------------------------------------------------------------------------
//
// The real CodeSessionStore derives its snapshot from the reducer's state,
// which only advances in response to outbound `send`/`interrupt` calls or
// inbound CODE_OUTPUT frames. Driving the store into specific states
// (canInterrupt=true, awaiting_approval, queuedSends=2, lastError set)
// for the step-5 responder-handler tests would require either golden-
// probe replays or carefully sequenced send/frame dance — both overkill
// for testing the component's handler-branching logic. A stub lets each
// test assert exactly the shape it cares about.

function defaultSnapshot(): CodeSessionSnapshot {
  return {
    phase: "idle",
    tugSessionId: "tug-session-id",
    claudeSessionId: null,
    displayLabel: "test",
    activeMsgId: null,
    canSubmit: true,
    canInterrupt: false,
    pendingApproval: null,
    pendingQuestion: null,
    queuedSends: 0,
    transcript: [],
    streamingPaths: STREAMING_PATHS,
    lastCost: null,
    lastError: null,
  };
}

class ScriptedStore {
  private snap: CodeSessionSnapshot;
  private listeners = new Set<() => void>();

  readonly sendCalls: Array<{ text: string; atoms: AtomSegment[] }> = [];
  readonly interruptCalls: number[] = [];

  constructor(initial: Partial<CodeSessionSnapshot> = {}) {
    this.snap = { ...defaultSnapshot(), ...initial };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CodeSessionSnapshot => this.snap;

  send = (text: string, atoms: AtomSegment[]): void => {
    this.sendCalls.push({ text, atoms });
  };

  interrupt = (): void => {
    this.interruptCalls.push(Date.now());
  };

  setSnapshot(partial: Partial<CodeSessionSnapshot>): void {
    this.snap = { ...this.snap, ...partial };
    for (const l of this.listeners) l();
  }
}

function renderEntryWithStore(opts: {
  id?: string;
  store?: ScriptedStore;
  localCommandHandler?: (
    route: string | null,
    atoms: ReadonlyArray<AtomSegment>,
  ) => boolean;
  onRender?: React.ProfilerOnRenderCallback;
} = {}) {
  const id = opts.id ?? "prompt-entry-step5";
  const store = opts.store ?? new ScriptedStore();
  const services = buildMockServices();
  // Swap in the scripted store while keeping the other real-ish services.
  const scripted = {
    ...services,
    codeSessionStore: store as unknown as CodeSessionStore,
  };
  const entryRef = React.createRef<TugPromptEntryDelegate>();
  const managerRef: { current: ResponderChainManager | null } = { current: null };
  const tree = (
    <ResponderChainProvider>
      <ChainCapture into={managerRef} />
      <TugPromptEntry
        ref={entryRef}
        id={id}
        {...scripted}
        localCommandHandler={opts.localCommandHandler}
      />
    </ResponderChainProvider>
  );
  const utils = render(
    opts.onRender ? (
      <React.Profiler id="entry" onRender={opts.onRender}>
        {tree}
      </React.Profiler>
    ) : tree,
  );
  return { ...utils, store, services: scripted, id, entryRef, managerRef };
}

describe("TugPromptEntry — Step 5 submit / interrupt / queue / errored", () => {
  beforeEach(() => {
    installExecCommandShim();
    installCanvas2DShim();
  });

  afterEach(() => {
    cleanup();
    uninstallExecCommandShim();
    uninstallCanvas2DShim();
  });

  it("SUBMIT with canInterrupt=false sends the input text and clears it", () => {
    const { id, store, managerRef } = renderEntryWithStore();
    expect(managerRef.current).not.toBeNull();

    // Type "hello" into the editor via the execCommand shim so
    // input.getText() returns it when the handler reads.
    const editor = findEditableRoot();
    expect(editor).not.toBeNull();
    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("insertText", false, "hello");
    });

    const clearSpy = spyOn(TugTextEngine.prototype, "clear");
    try {
      act(() => {
        managerRef.current!.sendToTarget(id, {
          action: TUG_ACTIONS.SUBMIT,
          phase: "discrete",
        });
      });

      expect(store.sendCalls.length).toBe(1);
      // The route indicator lives in the gutter — not the text flow —
      // so the sent text is exactly what the user typed, with no atom
      // placeholder prefix.
      const sentText = store.sendCalls[0].text;
      expect(sentText).toContain("hello");
      expect(sentText).not.toContain(TUG_ATOM_CHAR);
      // interrupt was NOT the branch taken.
      expect(store.interruptCalls.length).toBe(0);
      // Input was cleared after the send.
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it("SUBMIT with canInterrupt=true calls interrupt(); send is not invoked", () => {
    const store = new ScriptedStore({
      phase: "streaming",
      canSubmit: false,
      canInterrupt: true,
    });
    const { id, managerRef } = renderEntryWithStore({ store });
    expect(managerRef.current).not.toBeNull();

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });

    expect(store.interruptCalls.length).toBe(1);
    expect(store.sendCalls.length).toBe(0);
  });

  it("SUBMIT with canSubmit=false && canInterrupt=false is a no-op (awaiting_approval)", () => {
    const store = new ScriptedStore({
      phase: "awaiting_approval",
      canSubmit: false,
      canInterrupt: false,
    });
    const { id, managerRef } = renderEntryWithStore({ store });

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });

    expect(store.sendCalls.length).toBe(0);
    expect(store.interruptCalls.length).toBe(0);
  });

  it("localCommandHandler returning true suppresses send but still clears the input", () => {
    const handler = (_route: string | null, _atoms: ReadonlyArray<AtomSegment>) => true;
    const { id, store, managerRef } = renderEntryWithStore({
      localCommandHandler: handler,
    });
    expect(managerRef.current).not.toBeNull();

    const editor = findEditableRoot();
    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("insertText", false, ":save");
    });

    const clearSpy = spyOn(TugTextEngine.prototype, "clear");
    try {
      act(() => {
        managerRef.current!.sendToTarget(id, {
          action: TUG_ACTIONS.SUBMIT,
          phase: "discrete",
        });
      });

      expect(store.sendCalls.length).toBe(0);
      // Input cleared regardless: the user sees a reset entry even when
      // the local handler short-circuits.
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it("localCommandHandler returning false falls through to store.send", () => {
    let received: { route: string | null; atomCount: number } | null = null;
    const handler = (route: string | null, atoms: ReadonlyArray<AtomSegment>) => {
      received = { route, atomCount: atoms.length };
      return false;
    };
    const { id, store, managerRef } = renderEntryWithStore({
      localCommandHandler: handler,
    });

    const editor = findEditableRoot();
    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("insertText", false, "hi");
    });

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });

    expect(store.sendCalls.length).toBe(1);
    // Route lives in the gutter; sent text is exactly the user's input.
    const sentText = store.sendCalls[0].text;
    expect(sentText).toContain("hi");
    expect(sentText).not.toContain(TUG_ATOM_CHAR);
    // Handler was called with a defined route/atoms shape. The entry's
    // default route (Prompt) is active, so the handler receives "❯".
    // The null branch of the signature is still reachable by future
    // callers that expose a "no route" state — the entry no longer
    // takes that branch.
    expect(received).not.toBeNull();
    expect(received!.route).toBe("❯");
  });

  it("omitting localCommandHandler is equivalent to returning false (send is called)", () => {
    const { id, store, managerRef } = renderEntryWithStore();

    const editor = findEditableRoot();
    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("insertText", false, "hi");
    });

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });

    expect(store.sendCalls.length).toBe(1);
    const sentText = store.sendCalls[0].text;
    expect(sentText).toContain("hi");
    expect(sentText).not.toContain(TUG_ATOM_CHAR);
  });

  it("queuedSends=2 adds data-queued and renders the badge with text '2'", () => {
    const store = new ScriptedStore({ queuedSends: 2 });
    const { container } = renderEntryWithStore({ store });

    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.hasAttribute("data-queued")).toBe(true);
    const badge = container.querySelector<HTMLElement>(
      ".tug-prompt-entry-queue-badge",
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent?.trim()).toBe("2");
  });

  it("queuedSends=0 removes data-queued and the badge", () => {
    const store = new ScriptedStore({ queuedSends: 2 });
    const { container } = renderEntryWithStore({ store });

    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.hasAttribute("data-queued")).toBe(true);

    act(() => {
      store.setSnapshot({ queuedSends: 0 });
    });

    expect(root.hasAttribute("data-queued")).toBe(false);
    expect(
      container.querySelector(".tug-prompt-entry-queue-badge"),
    ).toBeNull();
  });

  it("lastError !== null sets data-errored on the root (session_state errored flow)", () => {
    const store = new ScriptedStore();
    const { container } = renderEntryWithStore({ store });

    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.hasAttribute("data-errored")).toBe(false);

    act(() => {
      store.setSnapshot({
        phase: "errored",
        canSubmit: true,
        canInterrupt: false,
        lastError: {
          cause: "session_state_errored",
          message: "boom",
          at: Date.now(),
        },
      });
    });

    expect(root.hasAttribute("data-errored")).toBe(true);
    expect(root.getAttribute("data-phase")).toBe("errored");
  });

  it("submit button aria-label flips between 'Send prompt' and 'Stop turn' as canInterrupt toggles", () => {
    const { container, store } = renderEntryWithStore();
    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Send prompt"]',
    );
    expect(sendButton).not.toBeNull();
    // Icon-only button: accessible name is the aria-label; the visible
    // glyph is a lucide-react SVG.
    expect(sendButton!.querySelector("svg")).not.toBeNull();

    act(() => {
      store.setSnapshot({
        phase: "streaming",
        canSubmit: false,
        canInterrupt: true,
      });
    });

    const stopButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop turn"]',
    );
    expect(stopButton).not.toBeNull();
    expect(stopButton!.querySelector("svg")).not.toBeNull();
  });

  it("phase transitions flip data-phase with exactly one commit per snapshot update (no internal useState in the entry path)", () => {
    const phases: string[] = [];
    const store = new ScriptedStore();
    const { container } = renderEntryWithStore({
      store,
      onRender: (_id, phase) => {
        phases.push(phase);
      },
    });

    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-phase")).toBe("idle");

    const updatesBefore1 = phases.filter((p) => p === "update").length;
    act(() => {
      store.setSnapshot({ phase: "submitting", canSubmit: false, canInterrupt: true });
    });
    expect(root.getAttribute("data-phase")).toBe("submitting");
    expect(root.getAttribute("data-can-interrupt")).toBe("true");
    const updatesAfter1 = phases.filter((p) => p === "update").length;
    expect(updatesAfter1 - updatesBefore1).toBe(1);

    const updatesBefore2 = phases.filter((p) => p === "update").length;
    act(() => {
      store.setSnapshot({ phase: "streaming" });
    });
    expect(root.getAttribute("data-phase")).toBe("streaming");
    const updatesAfter2 = phases.filter((p) => p === "update").length;
    expect(updatesAfter2 - updatesBefore2).toBe(1);
  });

  it("awaiting_approval phase applies the dim class selector via CSS (data-phase drives the selector)", () => {
    // Pure DOM check: the CSS selector
    // `.tug-prompt-entry[data-phase="awaiting_approval"] > :first-child`
    // only matches when `data-phase` is set to that value. Happy-dom
    // doesn't evaluate computed styles reliably for CSS variables, but
    // it does apply attribute selectors — so we verify the attribute
    // is wired correctly. The CSS rule itself is exercised by the
    // token-audit lint in the plan's checkpoint.
    const store = new ScriptedStore({
      phase: "awaiting_approval",
      canSubmit: false,
      canInterrupt: false,
      pendingApproval: {} as unknown as CodeSessionSnapshot["pendingApproval"],
    });
    const { container } = renderEntryWithStore({ store });
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-phase")).toBe("awaiting_approval");
    expect(root.hasAttribute("data-pending-approval")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-session prompt history keys on `claudeSessionId`, not on the routing
// `tugSessionId`. Two regressions live here:
//
// 1. Cache poisoning. The provider cache used to key on `route` only;
//    when `claudeSessionId` changed (e.g. resume → silent fresh fallback)
//    the cached provider returned the old session's entries even though
//    `snap.claudeSessionId` had moved on. Verified by changing the
//    snapshot's `claudeSessionId` mid-session and asserting `push()`
//    targets the new id (proving a fresh provider was created).
//
// 2. Push key. `performSubmit` previously pushed under
//    `snap.tugSessionId`; that orphaned the entry from the on-disk
//    claude session file (which is named after the claude id, the
//    only string `--resume` can find). Verified by inspecting the
//    `sessionId` field on the pushed entry.
// ---------------------------------------------------------------------------

describe("TugPromptEntry — per-session prompt history keys on claudeSessionId", () => {
  beforeEach(() => {
    installExecCommandShim();
    installCanvas2DShim();
  });

  afterEach(() => {
    cleanup();
    uninstallExecCommandShim();
    uninstallCanvas2DShim();
  });

  it("push uses claudeSessionId (not tugSessionId) as the entry's session id", () => {
    const store = new ScriptedStore({
      tugSessionId: "tug-routing-id",
      claudeSessionId: "claude-real-id",
    });
    const { id, managerRef, services } = renderEntryWithStore({ store });
    const pushSpy = spyOn(services.historyStore, "push");

    const editor = findEditableRoot();
    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("insertText", false, "hello");
    });

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const entry = pushSpy.mock.calls[0]![0] as { sessionId: string; id: string };
    expect(entry.sessionId).toBe("claude-real-id");
    // The composite entry id should be derived from claudeSessionId too,
    // not tugSessionId — otherwise dedup on re-load mis-matches.
    expect(entry.id.startsWith("claude-real-id-")).toBe(true);
  });

  // R-CHAIN-05: submit during the spawn-handshake window (Step 4.5.5
  // Phase D). Before D, a submit while `claudeSessionId === null` was
  // silently dropped — F5 in the audit. After D, the entry is buffered
  // and flushed under the freshly-arrived claude id on the first
  // non-null transition.
  it("buffers a push when claudeSessionId is null and flushes it on the first session_init (R-CHAIN-05)", () => {
    const store = new ScriptedStore({
      tugSessionId: "tug-routing-id",
      claudeSessionId: null,
    });
    const { id, managerRef, services } = renderEntryWithStore({ store });
    const pushSpy = spyOn(services.historyStore, "push");

    const editor = findEditableRoot();
    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("insertText", false, "hello");
    });

    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });

    // No push yet — claude hasn't emitted session_init.
    expect(pushSpy).not.toHaveBeenCalled();

    // session_init arrives with claude's id. Buffered entry flushes
    // under the freshly-arrived id.
    act(() => {
      store.setSnapshot({ claudeSessionId: "claude-arrived-late" });
    });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const entry = pushSpy.mock.calls[0]![0] as {
      sessionId: string;
      text: string;
    };
    expect(entry.sessionId).toBe("claude-arrived-late");
    expect(entry.text).toBe("hello");
  });

  it("provider cache invalidates when claudeSessionId changes (resume → silent fresh fallback)", () => {
    const store = new ScriptedStore({
      tugSessionId: "tug-routing-id",
      claudeSessionId: "claude-old-id",
    });
    const { id, managerRef, services } = renderEntryWithStore({ store });
    const pushSpy = spyOn(services.historyStore, "push");

    // First submit: pushes under the old id.
    const editor = findEditableRoot();
    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("insertText", false, "first");
    });
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect((pushSpy.mock.calls[0]![0] as { sessionId: string }).sessionId).toBe(
      "claude-old-id",
    );

    // Simulate a resume_failed → fresh fallback: claude assigns a new id,
    // CodeSessionStore's snapshot updates. The provider cache must NOT
    // hand back the stale provider; the next push must target the new id.
    act(() => {
      store.setSnapshot({ claudeSessionId: "claude-new-id" });
    });

    placeCaretAtEnd(editor!);
    act(() => {
      document.execCommand("insertText", false, "second");
    });
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });

    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect((pushSpy.mock.calls[1]![0] as { sessionId: string }).sessionId).toBe(
      "claude-new-id",
    );
  });
});
