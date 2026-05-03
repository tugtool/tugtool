/**
 * TideCardContent unit tests — sub-steps 4b and 4c coverage.
 *
 * Tests cover:
 * - T-TIDE-01: unbound card renders the picker backdrop + sheet
 * - T-TIDE-02: setBinding causes the split pane to render
 * - T-TIDE-03: clearBinding causes the picker to return
 * - T-TIDE-04: picker "Open" button sends a spawn_session CONTROL frame
 * - T-TIDE-05: card unmount sends a close_session frame and clears the binding
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

// Capture frames sent by the picker so T-TIDE-04 can assert on them.
// `onFrame` is stubbed because FeedStore's constructor calls it when
// the post-bind services effect runs. Module mock insulates us from
// any stub connection installed by another test in the suite.
interface SentFrame {
  feedId: number;
  payload: Uint8Array;
}
const sentFrames: SentFrame[] = [];

const fakeConnection = {
  send: (feedId: number, payload: Uint8Array) => {
    sentFrames.push({ feedId, payload });
  },
  onFrame: (_feedId: number, _cb: (payload: Uint8Array) => void) => () => {},
};

mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => fakeConnection,
  setConnection: () => {},
}));

// `cardServicesStore._construct` requires a `ConnectionLifecycle`
// alongside the connection. Tests never trigger transport events, so
// a fresh inert instance is sufficient.
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
const fakeLifecycle = new ConnectionLifecycle();
mock.module("@/lib/connection-lifecycle", () => ({
  ConnectionLifecycle,
  getConnectionLifecycle: () => fakeLifecycle,
  registerConnectionLifecycle: () => {},
}));

// Mock the tugbank singleton so the picker's recents list + the
// post-bind recents persist run against test-controlled state. The
// backing store is module-scoped so T-TIDE-06/07 can seed / read it.
const tugbankStore: Record<string, Record<string, { kind: string; value: unknown }>> = {};
const fakeTugbank = {
  get(domain: string, key: string) {
    return tugbankStore[domain]?.[key];
  },
  readDomain(domain: string) {
    return tugbankStore[domain];
  },
  // EditorSettingsStore subscribes to domain-change notifications on
  // construction; these tests never mutate tugbank from outside, so
  // the unsubscribe stub is sufficient.
  onDomainChanged(_cb: (domain: string) => void) {
    return () => {};
  },
};
mock.module("@/lib/tugbank-singleton", () => ({
  getTugbankClient: () => fakeTugbank,
  setTugbankClient: () => {},
}));

// Stub `putTideRecentProjects` alone from @/settings-api so the
// tide-card tests record PUT calls in a local recorder without
// triggering `fetch`. Leaving fetch unstubbed here is important: bun
// runs test files in a single process and other test files
// (settings-api.test.ts, deck-manager.test.ts) reassign
// `globalThis.fetch` concurrently. Any stray fetch call from the
// tide-card bind effect would race into whichever assignment is
// currently installed. The remaining settings-api exports (readers,
// the pure insert helper, other PUTs) are preserved from the real
// module via the `actual` spread.
import * as actualSettingsApi from "@/settings-api";
interface RecentsPut {
  paths: string[];
}
const recentsPuts: RecentsPut[] = [];
mock.module("@/settings-api", () => ({
  ...actualSettingsApi,
  putTideRecentProjects: (paths: string[]) => {
    recentsPuts.push({ paths });
  },
}));

import { TideCardContent } from "@/components/tugways/cards/tide-card";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import {
  ResponderChainContext,
  ResponderChainManager,
  type ActionEvent,
} from "@/components/tugways/responder-chain";
import { TugPanePortalContext } from "@/components/chrome/tug-pane";
import { FeedId } from "@/protocol";
import type { SessionRow } from "@/protocol";
import { CardLifecycle, CardLifecycleContext } from "@/lib/card-lifecycle";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { waitFor } from "@testing-library/react";
import {
  attachTideSessionLedgerStore,
  _resetTideSessionLedgerStoreForTest,
} from "@/lib/tide-session-ledger-store";
import {
  _resetTideSessionLedgerEventsForTest,
  publishListSessionsOk,
} from "@/lib/tide-session-ledger-events";

const CARD_ID = "tide-4bc-test";

function makeBinding(overrides: Partial<CardSessionBinding> = {}): CardSessionBinding {
  return {
    tugSessionId: "sess-4b-1",
    workspaceKey: "/work/4b",
    projectDir: "/work/4b",
    sessionMode: "new",
    ...overrides,
  };
}

/**
 * Render TideCardContent inside a ResponderChainProvider and a mock
 * TugPanePortalContext. The portal target is a detached `.tug-pane-chrome`
 * element with a `.tug-pane-body` child (required by TugSheet's inert
 * lifecycle effect). The element is attached to document.body so
 * portaled content (the picker sheet) is queryable via the DOM.
 *
 * Also attaches the tide session-ledger store to the fake connection so
 * `useSessionLedger` inside the picker has a live store the moment it
 * subscribes; tests that exercise the picker's session-list view then
 * push fixtures via `seedLedgerForPath` / `publishListSessionsOk`.
 */
function renderTideCard(cardId: string) {
  // Attach before render so the picker's useSyncExternalStore subscribe
  // callback registers a real listener (rather than a no-op when the
  // store would otherwise be null).
  attachTideSessionLedgerStore(fakeConnection as never);
  const cardEl = document.createElement("div");
  cardEl.className = "tug-pane-chrome";
  const cardBody = document.createElement("div");
  cardBody.className = "tug-pane-body";
  cardEl.appendChild(cardBody);
  document.body.appendChild(cardEl);

  // Under 11.6.1b the picker only presents on `cardDidActivate`. Build
  // a minimal CardLifecycle whose store reports this card as the
  // focused/first-responder, then fire the construction + activation
  // notifications so `useCardDelegate`'s initial-sync delivers
  // `cardDidActivate` to the picker and it shows its sheet.
  const lifecycleStore = {
    focusCard() {},
    getFocusedCardId: () => cardId,
    getFirstResponderCardId: () => cardId,
  };
  const lifecycle = new CardLifecycle(lifecycleStore);
  lifecycle.notifyCardDidFinishConstruction(cardId);

  const rtl = render(
    <CardLifecycleContext.Provider value={lifecycle}>
      <ResponderChainProvider>
        <TugPanePortalContext value={cardEl}>
          <TideCardContent cardId={cardId} />
        </TugPanePortalContext>
      </ResponderChainProvider>
    </CardLifecycleContext.Provider>,
  );

  return {
    ...rtl,
    cardEl,
    lifecycle,
    cleanupCard: () => {
      if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    },
  };
}


afterEach(() => {
  cleanup();
  cardSessionBindingStore.clearBinding(CARD_ID);
  sentFrames.length = 0;
  recentsPuts.length = 0;
  for (const domain of Object.keys(tugbankStore)) {
    delete tugbankStore[domain];
  }
  _resetTideSessionLedgerStoreForTest();
  _resetTideSessionLedgerEventsForTest();
  document.querySelectorAll(".tug-pane-chrome").forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
});

/**
 * Build a `SessionRow` for picker tests with sensible defaults. Caller
 * supplies the `session_id` + `project_dir` (the picker's lookup key) and
 * any fields under test (state, last_used_at for ordering, etc.).
 */
function makeSessionRow(partial: Partial<SessionRow> & { session_id: string }): SessionRow {
  return {
    session_id: partial.session_id,
    workspace_key: partial.workspace_key ?? partial.project_dir ?? "/proj",
    project_dir: partial.project_dir ?? "/proj",
    created_at: partial.created_at ?? 1000,
    last_used_at: partial.last_used_at ?? partial.created_at ?? 1000,
    turn_count: partial.turn_count ?? 0,
    first_user_prompt: partial.first_user_prompt ?? null,
    state: partial.state ?? "closed",
    card_id_live: partial.card_id_live ?? null,
  };
}

/**
 * Seed the picker's ledger snapshot for a project_dir by simulating the
 * server's `list_sessions_ok` push. Call after `clickRecent(path)` /
 * typing the path so the picker's `useSessionLedger(path)` is already
 * subscribed; the store's listener tick wakes React via
 * `useSyncExternalStore`.
 */
function seedLedgerForPath(path: string, sessions: SessionRow[]): void {
  act(() => {
    publishListSessionsOk({ project_dir: path, sessions });
  });
}

describe("TideCardContent – binding gate and project picker", () => {
  it("T-TIDE-01: renders the picker backdrop and sheet when unbound", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);
    expect(queryByTestId("tide-card-picker")).not.toBeNull();
    expect(queryByTestId("tide-card")).toBeNull();
    // Sheet portal into the mock card.
    expect(document.querySelector(".tug-sheet-content")).not.toBeNull();
  });

  it("T-TIDE-02: renders the split pane once a binding appears", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);
    expect(queryByTestId("tide-card-picker")).not.toBeNull();

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    expect(queryByTestId("tide-card-picker")).toBeNull();
    expect(queryByTestId("tide-card")).not.toBeNull();
  });

  // Focus behavior (auto-focus on key-card transitions, re-focus after
  // submit, Cmd+K, Ctrl+K native) is exercised live. happy-dom's
  // document.activeElement semantics diverge enough from the browser
  // that asserting on it here produces megabyte-scale failure dumps
  // without catching real regressions. Leave focus to manual smoke
  // and the per-component tests that target the delegate directly.

  it("T-TIDE-03: reverts to the picker when the binding clears", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(queryByTestId("tide-card")).not.toBeNull();

    act(() => {
      cardSessionBindingStore.clearBinding(CARD_ID);
    });

    expect(queryByTestId("tide-card-picker")).not.toBeNull();
    expect(queryByTestId("tide-card")).toBeNull();
  });

  it("T-TIDE-05: card-removal triggers close_session via the cardServicesStore deck-manager subscription", async () => {
    const { cardServicesStore } = await import("../lib/card-services-store");
    const rtl = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(rtl.queryByTestId("tide-card")).not.toBeNull();
    expect(cardSessionBindingStore.getBinding(CARD_ID)).not.toBeUndefined();

    // Mount + bind don't send frames on their own. The wire close
    // fires when the deck removes the card. In production
    // `cardServicesStore.attachDeckManager(deck)` (in main.tsx) wires
    // the deck-manager subscription that triggers close on
    // present→absent transitions; here we exercise the underlying
    // close path directly via the test seam.
    sentFrames.length = 0;

    act(() => {
      cardServicesStore.closeCardForTest(CARD_ID);
    });

    expect(sentFrames.length).toBe(1);
    const [frame] = sentFrames;
    expect(frame.feedId).toBe(FeedId.CONTROL);
    const payload = JSON.parse(new TextDecoder().decode(frame.payload)) as {
      action: string;
      card_id: string;
      tug_session_id: string;
    };
    expect(payload.action).toBe("close_session");
    expect(payload.card_id).toBe(CARD_ID);
    expect(payload.tug_session_id).toBe("sess-4b-1");
    expect(cardSessionBindingStore.getBinding(CARD_ID)).toBeUndefined();

    rtl.unmount();
  });

  it("T-TIDE-05b: bare unmount does NOT send a close_session frame", () => {
    const rtl = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(rtl.queryByTestId("tide-card")).not.toBeNull();

    sentFrames.length = 0;

    act(() => {
      rtl.unmount();
    });

    // No frame on bare unmount. The binding remains in the store
    // (cleanup is the deck-canvas user-close path's responsibility).
    expect(sentFrames.length).toBe(0);
    cardSessionBindingStore.clearBinding(CARD_ID);
  });

  it("T-TIDE-RESUME-06: a recent-project button fills the path input without sending a frame (4.5 regression from 4m)", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/u/src/tugtool", "/tmp"] } },
    };

    renderTideCard(CARD_ID);

    const recentButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".tug-sheet-content button"),
    ).find((b) => b.textContent?.trim() === "/u/src/tugtool");
    expect(recentButton).not.toBeUndefined();

    act(() => {
      fireEvent.click(recentButton!);
    });

    // 4.5 replaced the single-click spawn with a fill-the-input gesture so
    // every path flows through the Start-fresh / Resume-last radio group.
    // The picker's `useSessionLedger` does dispatch a `list_sessions`
    // CONTROL request when the path becomes non-empty — that's expected;
    // the regression we guard against is `spawn_session`.
    const spawnFrames = sentFrames.filter((f) => {
      try {
        const decoded = JSON.parse(new TextDecoder().decode(f.payload)) as {
          action?: string;
        };
        return decoded.action === "spawn_session";
      } catch {
        return false;
      }
    });
    expect(spawnFrames.length).toBe(0);
    const input = document.querySelector<HTMLInputElement>(
      '.tug-sheet-content input[type="text"]',
    );
    expect(input?.value).toBe("/u/src/tugtool");
  });

  // The picker wires path changes through React's onChange, which does not
  // fire synthetically via fireEvent.change under bun-test + happy-dom (see
  // the debug trace in the commit that landed these tests). Tests that need
  // to change the typed path do so by clicking a recents button — that path
  // goes through React's onClick, which DOES fire cleanly under this setup.
  function clickRecent(label: string): void {
    const btn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".tug-sheet-content button"),
    ).find((b) => b.textContent?.trim() === label);
    expect(btn).not.toBeUndefined();
    act(() => {
      fireEvent.click(btn!);
    });
  }

  it("T-TIDE-RESUME-01: picker with no map entry renders both rows, with Resume disabled", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/fresh-only"] } },
    };

    renderTideCard(CARD_ID);

    clickRecent("/work/fresh-only");

    const radios = document.querySelectorAll<HTMLButtonElement>(
      '.tug-sheet-content [role="radio"]',
    );
    expect(radios.length).toBe(2);
    expect(radios[0]!.textContent).toContain("Start fresh");
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    expect(radios[0]!.disabled).toBe(false);
    expect(radios[1]!.textContent).toContain("Resume last session");
    expect(radios[1]!.getAttribute("aria-checked")).toBe("false");
    expect(radios[1]!.disabled).toBe(true);
    // Subtitle explains why the row is inactive.
    const subtitle = document.querySelector(
      '[data-testid="tide-card-picker-resume-subtitle"]',
    );
    expect(subtitle?.textContent).toContain("No prior session");
  });

  it("T-TIDE-RESUME-02: picker with a session record for the typed path renders both rows; Start-fresh is selected by default", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/resumable"] } },
    };

    renderTideCard(CARD_ID);
    clickRecent("/work/resumable");
    seedLedgerForPath("/work/resumable", [
      makeSessionRow({
        session_id: "sess-old-id-abc12345",
        project_dir: "/work/resumable",
        last_used_at: 1000,
      }),
    ]);

    const radios = document.querySelectorAll<HTMLButtonElement>(
      '.tug-sheet-content [role="radio"]',
    );
    expect(radios.length).toBe(2);
    expect(radios[0]!.textContent).toContain("Start fresh");
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    expect(radios[1]!.textContent).toContain("Resume last session");
    expect(radios[1]!.getAttribute("aria-checked")).toBe("false");
    const subtitle = document.querySelector(
      '[data-testid="tide-card-picker-resume-subtitle"]',
    );
    expect(subtitle?.textContent).toContain("sess-old");
  });

  it("T-TIDE-RESUME-03: selecting Resume-last + Open sends spawn_session with sessionMode=resume and the picked session id", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/resumable"] } },
    };

    renderTideCard(CARD_ID);
    clickRecent("/work/resumable");
    seedLedgerForPath("/work/resumable", [
      makeSessionRow({
        session_id: "sess-resume-me",
        project_dir: "/work/resumable",
        last_used_at: 1000,
      }),
    ]);
    // The store's `list_sessions` request itself lands in sentFrames as
    // a CONTROL frame. Tests that assert spawn-frame contents need to
    // ignore the request frame.
    sentFrames.length = 0;

    const resumeRadio = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.tug-sheet-content [role="radio"]',
      ),
    ).find((b) => b.textContent?.includes("Resume last session"));
    expect(resumeRadio).not.toBeUndefined();
    act(() => {
      fireEvent.click(resumeRadio!);
    });

    const openButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".tug-sheet-content button"),
    ).find((b) => b.textContent?.trim().toLowerCase() === "open");
    act(() => {
      fireEvent.click(openButton!);
    });

    expect(sentFrames.length).toBe(1);
    const payload = JSON.parse(new TextDecoder().decode(sentFrames[0]!.payload)) as {
      action: string;
      project_dir: string;
      session_mode: string;
      tug_session_id: string;
    };
    expect(payload.action).toBe("spawn_session");
    expect(payload.project_dir).toBe("/work/resumable");
    expect(payload.session_mode).toBe("resume");
    // Resume must forward the picked session id — not mint a new one.
    expect(payload.tug_session_id).toBe("sess-resume-me");
  });

  it("T-TIDE-RESUME-04b: two sessions on the same project coexist; picker offers the newest", () => {
    // The session — not the project — is the primary identifier.
    // Two concurrent cards on the same project each hold their own
    // session id; both rows live in the ledger; the picker's Resume
    // row points at the newest (`last_used_at` wins).
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/multi"] } },
    };

    renderTideCard(CARD_ID);
    clickRecent("/work/multi");
    seedLedgerForPath("/work/multi", [
      makeSessionRow({
        session_id: "sess-newer",
        project_dir: "/work/multi",
        last_used_at: 2000,
      }),
      makeSessionRow({
        session_id: "sess-older",
        project_dir: "/work/multi",
        last_used_at: 1000,
      }),
    ]);
    sentFrames.length = 0;

    const subtitle = document.querySelector(
      '[data-testid="tide-card-picker-resume-subtitle"]',
    );
    expect(subtitle?.textContent).toContain("sess-new");

    // Pick Resume and submit; the frame must carry the newest id.
    const resumeRadio = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.tug-sheet-content [role="radio"]',
      ),
    ).find((b) => b.textContent?.includes("Resume last session"));
    act(() => {
      fireEvent.click(resumeRadio!);
    });
    const openButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".tug-sheet-content button"),
    ).find((b) => b.textContent?.trim().toLowerCase() === "open");
    act(() => {
      fireEvent.click(openButton!);
    });

    const payload = JSON.parse(new TextDecoder().decode(sentFrames[0]!.payload)) as {
      tug_session_id: string;
    };
    expect(payload.tug_session_id).toBe("sess-newer");
  });

  it("T-TIDE-RESUME-04: switching paths re-reads the ledger and enables/disables the Resume row", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": {
        kind: "json",
        value: { paths: ["/work/resumable", "/work/nope"] },
      },
    };

    renderTideCard(CARD_ID);

    function resumeRow(): HTMLButtonElement {
      const radios = document.querySelectorAll<HTMLButtonElement>(
        '.tug-sheet-content [role="radio"]',
      );
      expect(radios.length).toBe(2);
      return radios[1]!;
    }

    // With a ledger row for /work/resumable: Resume is enabled.
    clickRecent("/work/resumable");
    act(() => {
      publishListSessionsOk({
        project_dir: "/work/resumable",
        sessions: [
          makeSessionRow({
            session_id: "sess-x",
            project_dir: "/work/resumable",
            last_used_at: 1000,
          }),
        ],
      });
    });
    expect(resumeRow().disabled).toBe(false);

    // Switch to a path with no rows: Resume becomes disabled.
    clickRecent("/work/nope");
    act(() => {
      publishListSessionsOk({ project_dir: "/work/nope", sessions: [] });
    });
    expect(resumeRow().disabled).toBe(true);
  });


  it("T-TIDE-07: bind success persists the project path to recent-projects", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/old/path"] } },
    };

    renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(
        CARD_ID,
        makeBinding({ projectDir: "/new/path" }),
      );
    });

    // putTideRecentProjects is stubbed to push into `recentsPuts`; the
    // services effect invokes it synchronously during the setBinding
    // commit, so no async flush is required.
    expect(recentsPuts.length).toBe(1);
    // New path first, old path retained (dedup, cap did not kick in).
    // Path is the single identifier — what tugcode keys session-id
    // persistence by, what the picker looks up, what the wire carries.
    expect(recentsPuts[0].paths).toEqual(["/new/path", "/old/path"]);
  });

  it("T-TIDE-04: Open button sends a spawn_session CONTROL frame", () => {
    renderTideCard(CARD_ID);

    const input = document.querySelector<HTMLInputElement>(
      '.tug-sheet-content input[type="text"]',
    );
    expect(input).not.toBeNull();

    act(() => {
      fireEvent.change(input!, { target: { value: "/work/gamma" } });
    });

    // Sheet portals into document.body; find the Open button there.
    const openButton = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".tug-sheet-content button",
    )).find((b) => b.textContent?.trim().toLowerCase() === "open");
    expect(openButton).not.toBeUndefined();

    act(() => {
      fireEvent.click(openButton!);
    });

    expect(sentFrames.length).toBe(1);
    const [frame] = sentFrames;
    expect(frame.feedId).toBe(FeedId.CONTROL);
    const payload = JSON.parse(new TextDecoder().decode(frame.payload)) as {
      action: string;
      card_id: string;
      tug_session_id: string;
      project_dir: string;
    };
    expect(payload.action).toBe("spawn_session");
    expect(payload.card_id).toBe(CARD_ID);
    expect(payload.project_dir).toBe("/work/gamma");
    expect(typeof payload.tug_session_id).toBe("string");
    expect(payload.tug_session_id.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T-TIDE-08: Cancel-cascade dispatches CLOSE via sendToTarget(cardId)
// ---------------------------------------------------------------------------

/**
 * Regression test for the cancel-cascade bug surfaced after the
 * `tugplan-tide-popup-bindings.md` Step 2 sheet portal migration:
 * canceling the picker no longer reliably closed the host card.
 *
 * Per `tugplan-tide-overlay-framework.md` [D02], the cascade dispatch
 * captures the target id at sheet-open time and dispatches via
 * `sendToTarget(cardId, ...)` — independent of `firstResponderId`,
 * which settles unpredictably after FocusScope unmount and the
 * responder unregister fallback. This test asserts:
 *
 *   1. The picker's `onClosed("cancel")` path dispatches via
 *      `manager.sendToTarget(CARD_ID, { action: CLOSE, ... })` — NOT
 *      `sendToFirstResponder`.
 *   2. The dispatched action lands on a registered handler in the
 *      cardId → parent walk (proving the chain reaches the pane's
 *      CLOSE handler in production where `parentId` re-parents
 *      cardId onto the pane's `stackId`).
 */

/**
 * Resolve every captured WAAPI animation. Mirrors the helper in
 * tug-sheet.test.tsx — the shared mock in setup-rtl.ts records
 * animations but does not auto-resolve `.finished`.
 */
function resolveAllWaapiAnimations() {
  const mock = (
    global as unknown as {
      __waapi_mock__: { calls: Array<{ resolve: () => void }>; reset: () => void };
    }
  ).__waapi_mock__;
  for (const call of mock.calls) {
    call.resolve();
  }
}

describe("TideProjectPicker – cancel-cascade dispatches via sendToTarget", () => {
  afterEach(() => {
    const mock = (
      global as unknown as { __waapi_mock__: { reset: () => void } }
    ).__waapi_mock__;
    mock.reset();
  });

  it("T-TIDE-08: Cancel button fires manager.sendToTarget(cardId, { CLOSE }) after exit animation", async () => {
    const cardEl = document.createElement("div");
    cardEl.className = "tug-pane-chrome";
    const cardBody = document.createElement("div");
    cardBody.className = "tug-pane-body";
    cardEl.appendChild(cardBody);
    document.body.appendChild(cardEl);

    // Custom manager so we can spy on sendToTarget. Pre-register the
    // card responder with a stub CLOSE handler — the production
    // CardHost would normally register it under `parentId =
    // hostStackId`, and the chain walk from cardId would land on the
    // pane's CLOSE handler. For this unit test we collapse that into a
    // single registered responder so the dispatch's terminal handler
    // fires inside the test.
    const manager = new ResponderChainManager();
    const closeHandlerCalls: Array<{ action: string }> = [];
    manager.register({
      id: CARD_ID,
      parentId: null,
      actions: {
        [TUG_ACTIONS.CLOSE]: (event) => {
          closeHandlerCalls.push({ action: event.action });
        },
      },
    });

    // Spy on sendToTarget. We wrap the bound method so we record every
    // call and still delegate to the real implementation. This is the
    // load-bearing assertion — pre-fix tide-card called
    // `sendToFirstResponder`, post-fix it calls `sendToTarget(cardId, …)`.
    const sendToTargetCalls: Array<{
      targetId: string;
      action: string;
      sender: unknown;
    }> = [];
    const originalSendToTarget = manager.sendToTarget.bind(manager) as (
      targetId: string,
      event: Omit<ActionEvent, "phase">,
    ) => boolean;
    manager.sendToTarget = ((
      targetId: string,
      event: Omit<ActionEvent, "phase">,
    ): boolean => {
      sendToTargetCalls.push({
        targetId,
        action: event.action,
        sender: event.sender,
      });
      return originalSendToTarget(targetId, event);
    }) as typeof manager.sendToTarget;

    // Spy on sendToFirstResponder too, so we can assert the picker
    // does NOT use the pre-fix dispatch path.
    const sendToFirstResponderCalls: Array<{ action: string; sender: unknown }> = [];
    const originalSendToFR = manager.sendToFirstResponder.bind(manager) as (
      event: Omit<ActionEvent, "phase">,
    ) => boolean;
    manager.sendToFirstResponder = ((
      event: Omit<ActionEvent, "phase">,
    ): boolean => {
      sendToFirstResponderCalls.push({
        action: event.action,
        sender: event.sender,
      });
      return originalSendToFR(event);
    }) as typeof manager.sendToFirstResponder;

    // Lifecycle harness identical to renderTideCard's; needed because
    // the picker only presents on `cardDidActivate`.
    const lifecycleStore = {
      focusCard() {},
      getFocusedCardId: () => CARD_ID,
      getFirstResponderCardId: () => CARD_ID,
    };
    const lifecycle = new CardLifecycle(lifecycleStore);
    lifecycle.notifyCardDidFinishConstruction(CARD_ID);

    const rtl = render(
      <CardLifecycleContext.Provider value={lifecycle}>
        <ResponderChainContext.Provider value={manager}>
          <TugPanePortalContext value={cardEl}>
            <TideCardContent cardId={CARD_ID} />
          </TugPanePortalContext>
        </ResponderChainContext.Provider>
      </CardLifecycleContext.Provider>,
    );

    // The picker sheet must be mounted before we can click Cancel.
    await waitFor(() => {
      expect(document.querySelector(".tug-sheet-content")).not.toBeNull();
    });

    const cancelButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.trim() === "Cancel");
    expect(cancelButton).toBeDefined();

    act(() => {
      fireEvent.click(cancelButton!);
    });

    // The hook's close path resolves the promise immediately, then
    // dispatches cancelDialog through the chain. The sheet's handler
    // flips internal open false, the exit animation runs, and once
    // `g.finished` resolves, `mounted` flips false and `onClosed`
    // fires — which is where the cascade dispatch lives.
    await act(async () => {
      resolveAllWaapiAnimations();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        sendToTargetCalls.some(
          (c) => c.targetId === CARD_ID && c.action === TUG_ACTIONS.CLOSE,
        ),
      ).toBe(true);
    });

    // The CLOSE handler we registered fires — the walk reached its
    // terminus inside the chain.
    expect(
      closeHandlerCalls.some((e) => e.action === TUG_ACTIONS.CLOSE),
    ).toBe(true);

    // Pre-fix path is gone: the consumer must not use
    // sendToFirstResponder for this dispatch (per [D02]).
    expect(
      sendToFirstResponderCalls.some((c) => c.action === TUG_ACTIONS.CLOSE),
    ).toBe(false);

    rtl.unmount();
    if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
  });

  it("T-TIDE-08b: 'open' result does NOT dispatch the cascade close", async () => {
    // Sanity: the cascade must remain gated on result. Selecting a
    // project ('open') leaves the card mounted so the binding can
    // flip it into the split-pane body when `spawn_session_ok`
    // arrives. Asserting via the same sendToTarget spy.
    const cardEl = document.createElement("div");
    cardEl.className = "tug-pane-chrome";
    const cardBody = document.createElement("div");
    cardBody.className = "tug-pane-body";
    cardEl.appendChild(cardBody);
    document.body.appendChild(cardEl);

    const manager = new ResponderChainManager();
    manager.register({
      id: CARD_ID,
      parentId: null,
      actions: {
        [TUG_ACTIONS.CLOSE]: () => {},
      },
    });

    const sendToTargetCalls: Array<{ targetId: string; action: string }> = [];
    const originalSendToTarget = manager.sendToTarget.bind(manager) as (
      targetId: string,
      event: Omit<ActionEvent, "phase">,
    ) => boolean;
    manager.sendToTarget = ((
      targetId: string,
      event: Omit<ActionEvent, "phase">,
    ): boolean => {
      sendToTargetCalls.push({ targetId, action: event.action });
      return originalSendToTarget(targetId, event);
    }) as typeof manager.sendToTarget;

    const lifecycleStore = {
      focusCard() {},
      getFocusedCardId: () => CARD_ID,
      getFirstResponderCardId: () => CARD_ID,
    };
    const lifecycle = new CardLifecycle(lifecycleStore);
    lifecycle.notifyCardDidFinishConstruction(CARD_ID);

    const rtl = render(
      <CardLifecycleContext.Provider value={lifecycle}>
        <ResponderChainContext.Provider value={manager}>
          <TugPanePortalContext value={cardEl}>
            <TideCardContent cardId={CARD_ID} />
          </TugPanePortalContext>
        </ResponderChainContext.Provider>
      </CardLifecycleContext.Provider>,
    );

    await waitFor(() => {
      expect(document.querySelector(".tug-sheet-content")).not.toBeNull();
    });

    // Type a project path and submit so the picker calls
    // `close("open")`. The Open path requires a valid path; the
    // submit button reads from the controlled input.
    const input = document.querySelector<HTMLInputElement>("input[type='text']");
    expect(input).not.toBeNull();
    act(() => {
      fireEvent.change(input!, { target: { value: "/work/test-open" } });
    });

    const openButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.trim() === "Open");
    expect(openButton).toBeDefined();

    act(() => {
      fireEvent.click(openButton!);
    });

    await act(async () => {
      resolveAllWaapiAnimations();
      await Promise.resolve();
    });

    // `open` must NOT trigger the cascade CLOSE — only "cancel"
    // (and Escape/Cmd+. which arrive as undefined) do.
    await waitFor(() => {
      // wait long enough for any onClosed to have fired
      expect(document.querySelector(".tug-sheet-content")).toBeNull();
    });
    expect(
      sendToTargetCalls.some(
        (c) => c.targetId === CARD_ID && c.action === TUG_ACTIONS.CLOSE,
      ),
    ).toBe(false);

    rtl.unmount();
    if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
  });
});
