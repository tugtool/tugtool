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
  // CodeSessionStore subscribes via `onClose` for transport-close
  // routing; tests never trigger a close so the returned unsubscribe
  // stub is sufficient.
  onClose: (_cb: () => void) => () => {},
};

mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => fakeConnection,
  setConnection: () => {},
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
import { TugcardPortalContext } from "@/components/tugways/tug-card";
import { FeedId } from "@/protocol";

const CARD_ID = "tide-4bc-test";

function makeBinding(overrides: Partial<CardSessionBinding> = {}): CardSessionBinding {
  return {
    tugSessionId: "sess-4b-1",
    workspaceKey: "/work/4b",
    projectDir: "/work/4b",
    ...overrides,
  };
}

/**
 * Render TideCardContent inside a ResponderChainProvider and a mock
 * TugcardPortalContext. The portal target is a detached `.tugcard`
 * element with a `.tugcard-body` child (required by TugSheet's inert
 * lifecycle effect). The element is attached to document.body so
 * portaled content (the picker sheet) is queryable via the DOM.
 */
function renderTideCard(cardId: string) {
  const cardEl = document.createElement("div");
  cardEl.className = "tugcard";
  const cardBody = document.createElement("div");
  cardBody.className = "tugcard-body";
  cardEl.appendChild(cardBody);
  document.body.appendChild(cardEl);

  const rtl = render(
    <ResponderChainProvider>
      <TugcardPortalContext value={cardEl}>
        <TideCardContent cardId={cardId} />
      </TugcardPortalContext>
    </ResponderChainProvider>,
  );

  return {
    ...rtl,
    cardEl,
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
  document.querySelectorAll(".tugcard").forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
});

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

  it("T-TIDE-05: card unmount sends a close_session frame and clears the binding", () => {
    const rtl = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(rtl.queryByTestId("tide-card")).not.toBeNull();
    expect(cardSessionBindingStore.getBinding(CARD_ID)).not.toBeUndefined();

    // Reset sent-frame log — mount + bind don't send frames on their
    // own, but any prior test residue should be ignored.
    sentFrames.length = 0;

    act(() => {
      rtl.unmount();
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
  });

  it("T-TIDE-06: a recent-project quick-pick button sends spawn_session with that path in one click", () => {
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

    expect(sentFrames.length).toBe(1);
    const [frame] = sentFrames;
    expect(frame.feedId).toBe(FeedId.CONTROL);
    const payload = JSON.parse(new TextDecoder().decode(frame.payload)) as {
      action: string;
      project_dir: string;
    };
    expect(payload.action).toBe("spawn_session");
    expect(payload.project_dir).toBe("/u/src/tugtool");
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
