/**
 * TugPromptEntry — Step 2 smoke suite (plan Spec S01–S03, Step 2 tests).
 *
 * Step 2 is the scaffold commit: the component mounts, subscribes to the
 * session-store snapshot, registers a responder scope with no-op SUBMIT and
 * signature-correct SELECT_VALUE handler bodies, and renders its layout
 * against a minimal `MockTugConnection`-backed store. Later steps extend
 * this file:
 *
 *   • Step 3 — data-empty writes + delegate forwarding tests.
 *   • Step 4 — route indicator ↔ input round-trip tests.
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
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { TugPromptEntry } from "@/components/tugways/tug-prompt-entry";
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
