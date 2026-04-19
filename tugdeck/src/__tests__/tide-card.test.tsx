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
    sessionMode: "new",
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
    expect(sentFrames.length).toBe(0);
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
      sessions: {
        kind: "json",
        value: {
          "sess-old-id-abc12345": {
            projectDir: "/work/resumable",
            createdAt: 1000,
          },
        },
      },
    };

    renderTideCard(CARD_ID);
    clickRecent("/work/resumable");

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
      sessions: {
        kind: "json",
        value: {
          "sess-resume-me": {
            projectDir: "/work/resumable",
            createdAt: 1000,
          },
        },
      },
    };

    renderTideCard(CARD_ID);
    clickRecent("/work/resumable");

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
    // session id; both records live in the sessions map; the picker's
    // Resume row points at the newest (`createdAt` wins).
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/multi"] } },
      sessions: {
        kind: "json",
        value: {
          "sess-older": { projectDir: "/work/multi", createdAt: 1000 },
          "sess-newer": { projectDir: "/work/multi", createdAt: 2000 },
          // Different project — must not bleed into this picker.
          "sess-elsewhere": { projectDir: "/other/project", createdAt: 9999 },
        },
      },
    };

    renderTideCard(CARD_ID);
    clickRecent("/work/multi");

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

  it("T-TIDE-RESUME-04: switching paths re-reads the sessions record and enables/disables the Resume row", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": {
        kind: "json",
        value: { paths: ["/work/resumable", "/work/nope"] },
      },
      sessions: {
        kind: "json",
        value: {
          "sess-x": { projectDir: "/work/resumable", createdAt: 1000 },
        },
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

    // With a map entry for /work/resumable: Resume is enabled.
    clickRecent("/work/resumable");
    expect(resumeRow().disabled).toBe(false);

    // Switch to a path without an entry: Resume becomes disabled.
    clickRecent("/work/nope");
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
