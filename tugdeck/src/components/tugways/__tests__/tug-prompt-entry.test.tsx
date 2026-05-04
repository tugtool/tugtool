/**
 * TugPromptEntry — composition + responder + submit + history coverage.
 *
 * Covers the CM6-backed substrate path:
 *
 *   1. Scaffold mount + markup contract (data-slot, data-responder-id,
 *      data-phase, data-can-interrupt, queue badge presence).
 *   2. Submit-button live registration (Risk R04 — chain-action SUBMIT
 *      handler must be registered so TugPushButton doesn't fall back
 *      to aria-disabled).
 *   3. data-empty bridge: starts at "true", flips on doc change, returns
 *      to "true" after clear. Drives the substrate via
 *      `view.dispatch(...)` rather than synthetic contenteditable
 *      events — happy-dom can't model contentEditable selection /
 *      `execCommand` with the fidelity CM6's reconciler expects.
 *   4. Route indicator bidirectional sync: SELECT_VALUE from the
 *      indicator updates the route state; cross-sender / non-string
 *      values are ignored; pointer click flows through
 *      indicator → entry; updates produce one entry commit.
 *   5. Submit / interrupt / queue / errored branching against a
 *      ScriptedStore stub that exposes spy-able send/interrupt and a
 *      controllable snapshot.
 *   6. localCommandHandler intercept; clear after handler returns true.
 *   7. Per-session prompt history pushes through the entry's
 *      `historyStore.push` with the picker-chosen sessionId.
 */
import "../../../__tests__/setup-rtl";

import React from "react";
import { act } from "react";
import { describe, it, expect, afterEach, beforeEach, spyOn } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  TugPromptEntry,
  type TugPromptEntryDelegate,
} from "@/components/tugways/tug-prompt-entry";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import {
  ResponderChainContext,
  type ResponderChainManager,
} from "@/components/tugways/responder-chain";
import type { CodeSessionSnapshot } from "@/lib/code-session-store/types";
import { STREAMING_PATHS } from "@/lib/code-session-store/types";
import type { AtomSegment } from "@/lib/tug-text-types";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { CodeSessionStore } from "@/lib/code-session-store";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { TugConnection } from "@/connection";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";

// ---------------------------------------------------------------------------
// Canvas 2D shim — atom rendering measures glyph widths via a 2D
// context; happy-dom doesn't implement one.
// ---------------------------------------------------------------------------

(() => {
  const probe = document.createElement("canvas");
  const proto = Object.getPrototypeOf(probe) as {
    getContext?: (type: string) => unknown;
  };
  const ctx = {
    font: "",
    measureText(text: string) {
      return { width: text.length * 7 };
    },
  };
  proto.getContext = function getContext(type: string): unknown {
    if (type === "2d") return ctx;
    return null;
  };
})();

// ---------------------------------------------------------------------------
// Minimal FeedStore shim for SessionMetadataStore
// ---------------------------------------------------------------------------

class InertFeedStore {
  subscribe(_listener: () => void): () => void {
    return () => {};
  }
  getSnapshot(): Map<number, unknown> {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Test harness — builds a minimal set of mock services for one render.
// ---------------------------------------------------------------------------

interface MockServices {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  historyStore: PromptHistoryStore;
}

function buildMockServices(): MockServices {
  const conn = new TestFrameChannel() as unknown as TugConnection;
  const codeSessionStore = new CodeSessionStore({
    conn,
    lifecycle: new ConnectionLifecycle(),
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
// Substrate bridge: locate the CM6 EditorView instance owned by the
// entry's embedded TugTextEditor.
// ---------------------------------------------------------------------------

/**
 * Find the live `EditorView` rendered by the entry. Uses CM6's
 * public `EditorView.findFromDOM` against the substrate host
 * (`[data-slot="tug-text-editor"]`).
 */
function viewFromContainer(container: HTMLElement): EditorView {
  const host = container.querySelector<HTMLElement>(
    '[data-slot="tug-text-editor"]',
  );
  expect(host).not.toBeNull();
  const view = EditorView.findFromDOM(host!);
  expect(view).not.toBeNull();
  return view!;
}

/**
 * Insert text at the editor's current selection head via CM6
 * dispatch. Mirrors what real keystrokes resolve to inside the
 * substrate.
 */
function typeText(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    userEvent: "input.type",
  });
}

/** Replace the entire doc and place the caret at end. */
function setDocText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(text.length),
    userEvent: "input.type",
  });
}

// ---------------------------------------------------------------------------
// Step 2 — Scaffold tests
// ---------------------------------------------------------------------------

describe("TugPromptEntry — scaffold + markup", () => {
  it("renders without throwing against a minimal TestFrameChannel-backed store", () => {
    const { container } = renderEntry();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    );
    expect(root).not.toBeNull();
  });

  it("writes data-slot and data-responder-id on the root element", () => {
    const { container, id } = renderEntry();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-responder-id")).toBe(id);
  });

  it("reflects initial snapshot state via data-phase / data-can-interrupt", () => {
    const { container } = renderEntry();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-phase")).toBe("idle");
    expect(root.getAttribute("data-can-interrupt")).toBe("false");
  });

  it("renders the submit button live — NOT aria-disabled — because the SUBMIT chain-action handler is registered (Risk R04)", () => {
    const { container } = renderEntry();
    const submitButton = container.querySelector<HTMLButtonElement>(
      ".tug-prompt-entry-submit-button",
    );
    expect(submitButton).not.toBeNull();
    expect(submitButton!.hasAttribute("aria-disabled")).toBe(false);
  });

  it("omits the queue badge when snap.queuedSends === 0", () => {
    const { container } = renderEntry();
    const badge = container.querySelector(".tug-prompt-entry-queue-badge");
    expect(badge).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step 3 — input-delegate + data-empty
// ---------------------------------------------------------------------------

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

describe("TugPromptEntry — substrate delegate + data-empty bridge", () => {
  it("initial mount: data-empty=\"true\" on root", () => {
    const { container } = renderEntryWithRef();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-empty")).toBe("true");
  });

  it("dispatching text into the editor flips data-empty to \"false\"", () => {
    const { container } = renderEntryWithRef();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    expect(root.getAttribute("data-empty")).toBe("true");
    const view = viewFromContainer(container);
    act(() => typeText(view, "x"));
    expect(root.getAttribute("data-empty")).toBe("false");
  });

  it("clearing the doc returns data-empty to \"true\"", () => {
    const { container } = renderEntryWithRef();
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-prompt-entry"]',
    )!;
    const view = viewFromContainer(container);
    act(() => typeText(view, "x"));
    expect(root.getAttribute("data-empty")).toBe("false");
    act(() => setDocText(view, ""));
    expect(root.getAttribute("data-empty")).toBe("true");
  });

  it("ref.current.focus() forwards to the substrate's contentDOM", () => {
    const { container, entryRef } = renderEntryWithRef();
    expect(entryRef.current).not.toBeNull();
    const view = viewFromContainer(container);
    act(() => {
      entryRef.current!.focus();
    });
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it("ref.current.clear() empties the substrate's doc", () => {
    const { container, entryRef } = renderEntryWithRef();
    const view = viewFromContainer(container);
    act(() => typeText(view, "hello"));
    expect(view.state.doc.length).toBe(5);
    act(() => {
      entryRef.current!.clear();
    });
    expect(view.state.doc.length).toBe(0);
  });

  it("ref.current.getEditorElement() returns the CM6 contentDOM", () => {
    const { container, entryRef } = renderEntryWithRef();
    const view = viewFromContainer(container);
    expect(entryRef.current!.getEditorElement()).toBe(view.contentDOM);
  });
});

// ---------------------------------------------------------------------------
// Step 4 — route indicator bidirectional sync
// ---------------------------------------------------------------------------

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

const SEGMENT_LABEL_FOR_VALUE: Record<string, string> = {
  "❯": "Code",
  "$": "Shell",
  ":": "Command",
};

function getSegment(container: HTMLElement, value: string): HTMLButtonElement {
  const label = SEGMENT_LABEL_FOR_VALUE[value] ?? value;
  const segments = container.querySelectorAll<HTMLButtonElement>(
    'button[role="radio"]',
  );
  for (const seg of segments) {
    if (seg.textContent?.includes(label)) return seg;
  }
  throw new Error(`no segment matching "${label}" found`);
}

describe("TugPromptEntry — route indicator bidirectional sync", () => {
  it("dispatching SELECT_VALUE from the indicator updates the route state", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: "$",
        phase: "discrete",
      });
    });
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");
    expect(getSegment(container, "❯").getAttribute("data-state")).toBe("inactive");
  });

  it("SELECT_VALUE from a different sender is a no-op", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: "some-other-sender",
        value: "$",
        phase: "discrete",
      });
    });
    expect(getSegment(container, "❯").getAttribute("data-state")).toBe("active");
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("inactive");
  });

  it("SELECT_VALUE with a non-string value is a no-op", () => {
    const { container, id, managerRef } = renderEntryWithManager();
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: 42 as unknown,
        phase: "discrete",
      });
    });
    expect(getSegment(container, "❯").getAttribute("data-state")).toBe("active");
  });

  it("clicking a segment dispatches SELECT_VALUE end-to-end", () => {
    const { container } = renderEntryWithManager();
    const segment = getSegment(container, ":");
    expect(segment.getAttribute("data-state")).toBe("inactive");
    act(() => {
      fireEvent.click(segment);
    });
    expect(getSegment(container, ":").getAttribute("data-state")).toBe("active");
  });

  it("typing a route prefix at offset 0 flips the route once (one-shot detection)", () => {
    // Prefix detection lives in createRoutePrefixExtension. Typing
    // `$` into an empty editor flips the route to "$" (Shell). The
    // character stays in the doc per [Q05]=a.
    const { container, id, managerRef } = renderEntryWithManager();
    expect(managerRef.current).not.toBeNull();
    expect(getSegment(container, "❯").getAttribute("data-state")).toBe("active");
    const view = viewFromContainer(container);
    act(() => typeText(view, "$"));
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");
    expect(view.state.doc.toString()).toBe("$");
  });

  it("deleting the leading prefix character does NOT flip the route ([Q06]=b)", () => {
    const { container } = renderEntryWithManager();
    const view = viewFromContainer(container);
    // Type `$` to flip to Shell.
    act(() => typeText(view, "$"));
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");
    // Delete the leading character.
    act(() => {
      view.dispatch({
        changes: { from: 0, to: 1, insert: "" },
        selection: EditorSelection.cursor(0),
        userEvent: "delete.backward",
      });
    });
    // Route stays on Shell — deletion is a no-op for prefix detection.
    expect(getSegment(container, "$").getAttribute("data-state")).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// Step 5 — submit / interrupt / queue / errored branching
// ---------------------------------------------------------------------------

function defaultSnapshot(): CodeSessionSnapshot {
  return {
    phase: "idle",
    transportState: "online",
    tugSessionId: "tug-session-id",
    displayLabel: "test",
    activeMsgId: null,
    canSubmit: true,
    canInterrupt: false,
    pendingApproval: null,
    pendingQuestion: null,
    queuedSends: 0,
    transcript: [],
    inflightUserMessage: null,
    streamingPaths: STREAMING_PATHS,
    lastCost: null,
    lastError: null,
    lastReplayResult: null,
    replayPreflightActive: false,
    replaySoftBudgetElapsed: false,
    replayTimeoutDwellActive: false,
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
  onAfterSubmit?: () => void;
  onRender?: React.ProfilerOnRenderCallback;
} = {}) {
  const id = opts.id ?? "prompt-entry-step5";
  const store = opts.store ?? new ScriptedStore();
  const services = buildMockServices();
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
        onAfterSubmit={opts.onAfterSubmit}
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

describe("TugPromptEntry — submit / interrupt / queue / errored", () => {
  it("SUBMIT with canInterrupt=false sends the input text and clears it", () => {
    const { container, id, store, managerRef } = renderEntryWithStore();
    const view = viewFromContainer(container);
    act(() => typeText(view, "hello"));
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(store.sendCalls.length).toBe(1);
    expect(store.sendCalls[0].text).toBe("hello");
    expect(store.interruptCalls.length).toBe(0);
    expect(view.state.doc.length).toBe(0);
  });

  it("SUBMIT with canInterrupt=true calls interrupt(); send is not invoked", () => {
    const store = new ScriptedStore({
      phase: "streaming",
      canSubmit: false,
      canInterrupt: true,
    });
    const { id, managerRef } = renderEntryWithStore({ store });
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(store.interruptCalls.length).toBe(1);
    expect(store.sendCalls.length).toBe(0);
  });

  it("onAfterSubmit fires after a successful send (post-clear)", () => {
    const calls: number[] = [];
    const { container, id, store, managerRef } = renderEntryWithStore({
      onAfterSubmit: () => calls.push(Date.now()),
    });
    const view = viewFromContainer(container);
    act(() => typeText(view, "hello"));
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(store.sendCalls.length).toBe(1);
    expect(calls.length).toBe(1);
  });

  it("onAfterSubmit does NOT fire on the canInterrupt (Stop) branch", () => {
    const store = new ScriptedStore({
      phase: "streaming",
      canSubmit: false,
      canInterrupt: true,
    });
    const calls: number[] = [];
    const { id, managerRef } = renderEntryWithStore({
      store,
      onAfterSubmit: () => calls.push(Date.now()),
    });
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(store.interruptCalls.length).toBe(1);
    expect(calls.length).toBe(0);
  });

  it("SUBMIT with canSubmit=false && canInterrupt=false is a no-op", () => {
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
    const { container, id, store, managerRef } = renderEntryWithStore({
      localCommandHandler: handler,
    });
    const view = viewFromContainer(container);
    act(() => typeText(view, ":save"));
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(store.sendCalls.length).toBe(0);
    expect(view.state.doc.length).toBe(0);
  });

  it("localCommandHandler returning false falls through to store.send", () => {
    let received: { route: string | null; atomCount: number } | null = null;
    const handler = (route: string | null, atoms: ReadonlyArray<AtomSegment>) => {
      received = { route, atomCount: atoms.length };
      return false;
    };
    const { container, id, store, managerRef } = renderEntryWithStore({
      localCommandHandler: handler,
    });
    const view = viewFromContainer(container);
    act(() => typeText(view, "hi"));
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(store.sendCalls.length).toBe(1);
    expect(store.sendCalls[0].text).toBe("hi");
    expect(received).not.toBeNull();
    // Default route is `❯` (Prompt).
    expect(received!.route).toBe("❯");
  });

  it("submit-time strip removes the leading prefix character that matches the active route ([Q09]=a)", () => {
    // Default route is `❯` (Prompt). Typing `>` (alias for chevron)
    // would flip the route via the prefix extension; here the route
    // is already `❯`, so type `> hello` and submit. The `>` prefix
    // matches the active route, so the submitted text is `" hello"`.
    const { container, id, store, managerRef } = renderEntryWithStore();
    const view = viewFromContainer(container);
    // The first `>` typed at offset 0 is one-shot detected as a
    // route prefix and (since route is already `❯`) is a no-op
    // route-flip; the character stays in the doc.
    act(() => typeText(view, "> hello"));
    expect(view.state.doc.toString()).toBe("> hello");
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(store.sendCalls[0].text).toBe(" hello");
  });

  it("submit-time strip is a no-op when doc[0] doesn't match the active route ([Q09]=a)", () => {
    // Type `> hello` (one-shot detection flips the route to `❯`),
    // then click the Shell segment to manually set the route to `$`
    // while the doc still leads with `>`. Submitting in this state
    // sends the doc verbatim — `>` doesn't map to `$`.
    const { container, id, store, managerRef } = renderEntryWithStore();
    const view = viewFromContainer(container);
    // Start by switching off the default `❯` so the prefix detector
    // observably re-flips below.
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: ":",
        phase: "discrete",
      });
    });
    act(() => typeText(view, "> hello"));
    // Now manually flip to Shell — this leaves doc[0]=">" but the
    // active route is "$".
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SELECT_VALUE,
        sender: `${id}-route-indicator`,
        value: "$",
        phase: "discrete",
      });
    });
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(store.sendCalls[0].text).toBe("> hello");
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

  it("lastError !== null sets data-errored on the root", () => {
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
    expect(
      container.querySelector('button[aria-label="Send prompt"]'),
    ).not.toBeNull();
    act(() => {
      store.setSnapshot({
        phase: "streaming",
        canSubmit: false,
        canInterrupt: true,
      });
    });
    expect(
      container.querySelector('button[aria-label="Stop turn"]'),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-session prompt history
// ---------------------------------------------------------------------------

describe("TugPromptEntry — per-session prompt history", () => {
  beforeEach(() => {
    // no-op — canvas shim runs at module scope, no per-test setup
  });

  it("push uses tugSessionId (the picker-chosen id) as the entry's session id", () => {
    const store = new ScriptedStore({
      tugSessionId: "session-id-from-picker",
    });
    const { container, id, managerRef, services } = renderEntryWithStore({ store });
    const pushSpy = spyOn(services.historyStore, "push");
    const view = viewFromContainer(container);
    act(() => typeText(view, "hello"));
    act(() => {
      managerRef.current!.sendToTarget(id, {
        action: TUG_ACTIONS.SUBMIT,
        phase: "discrete",
      });
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const entry = pushSpy.mock.calls[0]![0] as {
      sessionId: string;
      id: string;
    };
    expect(entry.sessionId).toBe("session-id-from-picker");
    expect(entry.id.startsWith("session-id-from-picker-")).toBe(true);
  });
});
