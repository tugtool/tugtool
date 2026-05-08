/**
 * Tide picker — session-list view tests.
 *
 * Covers the rich rows + Forget UX shipped by `tugplan-tide-session-ledger.md`:
 *
 * - T-TIDE-LEDGER-01: N+1 rows in `last_used_at DESC` order.
 * - T-TIDE-LEDGER-02: live row visible but disabled with the "live" pill.
 * - T-TIDE-LEDGER-03: clicking Forget routes through the confirmation panel,
 *   then dispatches `forget_session`.
 * - T-TIDE-LEDGER-04: Forget All dispatches one `forget_session` per non-live
 *   row through the same confirmation flow.
 * - T-TIDE-LEDGER-05: a `session_updated`-shaped push patches a row in place
 *   without re-mount.
 * - T-TIDE-LEDGER-06/07: live + failed row subtitles.
 * - T-TIDE-LEDGER-08: pending placeholder appears/disappears across the
 *   list_sessions request lifetime.
 * - T-TIDE-LEDGER-09: icon-only Forget button and full-prompt title attr.
 * - T-TIDE-LEDGER-10: Cancel on the confirm popover returns to the picker.
 *
 * Mirrors the setup pattern in `tide-card.test.tsx` — module mocks must
 * be installed in the consuming test file (bun-test mock hoisting), so
 * the connection / lifecycle / tugbank / settings mocks are duplicated
 * here rather than shared via a helper module.
 */
import "../../../../__tests__/setup-rtl";

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

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

import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
const fakeLifecycle = new ConnectionLifecycle();
mock.module("@/lib/connection-lifecycle", () => ({
  ConnectionLifecycle,
  getConnectionLifecycle: () => fakeLifecycle,
  registerConnectionLifecycle: () => {},
}));

const tugbankStore: Record<string, Record<string, { kind: string; value: unknown }>> = {};
const fakeTugbank = {
  get(domain: string, key: string) {
    return tugbankStore[domain]?.[key];
  },
  readDomain(domain: string) {
    return tugbankStore[domain];
  },
  onDomainChanged(_cb: (domain: string) => void) {
    return () => {};
  },
};
mock.module("@/lib/tugbank-singleton", () => ({
  getTugbankClient: () => fakeTugbank,
  setTugbankClient: () => {},
}));

import * as actualSettingsApi from "@/settings-api";
mock.module("@/settings-api", () => ({
  ...actualSettingsApi,
  putTideRecentProjects: () => {},
}));

import { TideCardContent } from "@/components/tugways/cards/tide-card";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugPanePortalContext } from "@/components/chrome/tug-pane";
import type { SessionRow } from "@/protocol";
import { CardLifecycle, CardLifecycleContext } from "@/lib/card-lifecycle";
import {
  attachTideSessionLedgerStore,
  _resetTideSessionLedgerStoreForTest,
} from "@/lib/tide-session-ledger-store";
import {
  _resetTideSessionLedgerEventsForTest,
  publishListSessionsOk,
} from "@/lib/tide-session-ledger-events";

const CARD_ID = "tide-picker-test";

function renderTideCard(cardId: string) {
  attachTideSessionLedgerStore(fakeConnection as never);
  const cardEl = document.createElement("div");
  cardEl.className = "tug-pane-chrome";
  const cardBody = document.createElement("div");
  cardBody.className = "tug-pane-body";
  cardEl.appendChild(cardBody);
  document.body.appendChild(cardEl);

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
    cleanupCard: () => {
      if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    },
  };
}

afterEach(() => {
  cleanup();
  cardSessionBindingStore.clearBinding(CARD_ID);
  sentFrames.length = 0;
  for (const domain of Object.keys(tugbankStore)) {
    delete tugbankStore[domain];
  }
  _resetTideSessionLedgerStoreForTest();
  _resetTideSessionLedgerEventsForTest();
  document.querySelectorAll(".tug-pane-chrome").forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
});

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
    card_id: partial.card_id ?? null,
  };
}

function seedLedgerForPath(path: string, sessions: SessionRow[]): void {
  act(() => {
    publishListSessionsOk({ project_dir: path, sessions });
  });
}

function clickRecent(label: string): void {
  const cells = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.tug-sheet-content [data-testid="tide-card-picker-path-recent"]',
    ),
  );
  const cell = cells.find((c) => c.textContent?.includes(label));
  expect(cell).not.toBeUndefined();
  const wrapper = cell!.closest<HTMLElement>("[data-tug-list-cell-index]");
  expect(wrapper).not.toBeNull();
  act(() => {
    fireEvent.click(wrapper!);
  });
}

/** All session cells (Start fresh + each Resume row) in render order. */
function sessionCells(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.tug-sheet-content [data-testid="tide-card-picker-session-new"], .tug-sheet-content [data-testid="tide-card-picker-session-resume"]',
    ),
  );
}

/** Resume cells only (excludes Start fresh) in render order. */
function resumeCells(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.tug-sheet-content [data-testid="tide-card-picker-session-resume"]',
    ),
  );
}

/** Resume cell wrappers (the elements `TugListView` makes focusable). */
function resumeCellWrappers(): HTMLElement[] {
  return resumeCells().map((cell) => {
    const wrapper = cell.closest<HTMLElement>("[data-tug-list-cell-index]");
    if (wrapper === null) throw new Error("session-resume wrapper missing");
    return wrapper;
  });
}

/**
 * Find a button rendered inside an open `TugConfirmPopover` by exact
 * text content. The popover content is portaled to `document.body`,
 * outside the picker's sheet. Returns null when the button isn't
 * rendered (popover closed or portal not mounted).
 */
function popoverButtonByText(label: string): HTMLButtonElement | null {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    ".tug-confirm-popover button",
  );
  for (const btn of buttons) {
    if (btn.textContent?.trim() === label) return btn;
  }
  return null;
}

/** Start-fresh cell wrapper. */
function startFreshWrapper(): HTMLElement {
  const cell = document.querySelector<HTMLElement>(
    '.tug-sheet-content [data-testid="tide-card-picker-session-new"]',
  );
  if (cell === null) throw new Error("session-new cell missing");
  const wrapper = cell.closest<HTMLElement>("[data-tug-list-cell-index]");
  if (wrapper === null) throw new Error("session-new wrapper missing");
  return wrapper;
}

describe("Tide picker — session-list view (ledger-backed)", () => {
  it("T-TIDE-LEDGER-01: picker renders N+1 rows in last_used_at DESC order", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/multi"] } },
    };

    renderTideCard(CARD_ID);
    clickRecent("/work/multi");
    seedLedgerForPath("/work/multi", [
      makeSessionRow({
        session_id: "sess-c-newest",
        project_dir: "/work/multi",
        last_used_at: 3000,
      }),
      makeSessionRow({
        session_id: "sess-b-mid",
        project_dir: "/work/multi",
        last_used_at: 2000,
      }),
      makeSessionRow({
        session_id: "sess-a-oldest",
        project_dir: "/work/multi",
        last_used_at: 1000,
      }),
    ]);

    const cells = sessionCells();
    expect(cells.length).toBe(4);
    expect(cells[0]!.getAttribute("data-testid")).toBe(
      "tide-card-picker-session-new",
    );
    expect(cells[0]!.textContent).toContain("New session");
    // Resume rows in newest-first order: cells[1] is sess-c-newest.
    const firstResumeSubtitle = cells[1]!.querySelector(
      '[data-testid="tide-card-picker-resume-subtitle"]',
    );
    expect(firstResumeSubtitle?.textContent).toContain("sess-c-n");
  });

  it("T-TIDE-LEDGER-02: live row is rendered but disabled and shows the live pill", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/live"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/live");
    seedLedgerForPath("/work/live", [
      makeSessionRow({
        session_id: "sess-live-row",
        project_dir: "/work/live",
        last_used_at: 1000,
        state: "live",
        card_id: "other-card",
      }),
    ]);

    const cells = sessionCells();
    expect(cells.length).toBe(2);
    expect(cells[1]!.getAttribute("data-disabled")).toBe("true");
    expect(cells[1]!.textContent).toContain("live");
  });

  it("T-TIDE-LEDGER-03: clicking Forget opens the confirm popover; Forget there dispatches forget_session", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/forget"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/forget");
    seedLedgerForPath("/work/forget", [
      makeSessionRow({
        session_id: "sess-doomed",
        project_dir: "/work/forget",
        last_used_at: 1000,
      }),
    ]);
    sentFrames.length = 0;

    const forgetButton = document.querySelector<HTMLButtonElement>(
      ".tide-card-picker-session-forget",
    );
    expect(forgetButton).not.toBeNull();
    act(() => {
      fireEvent.click(forgetButton!);
    });
    expect(sentFrames.length).toBe(0);

    const confirmButton = popoverButtonByText("Forget");
    expect(confirmButton).not.toBeNull();
    act(() => {
      fireEvent.click(confirmButton!);
    });

    expect(sentFrames.length).toBe(1);
    const decoded = JSON.parse(new TextDecoder().decode(sentFrames[0]!.payload)) as {
      action: string;
      session_id: string;
    };
    expect(decoded).toEqual({ action: "forget_session", session_id: "sess-doomed" });
  });

  it("T-TIDE-LEDGER-05: a session_updated push patches a row in place without re-mount", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/patch"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/patch");
    seedLedgerForPath("/work/patch", [
      makeSessionRow({
        session_id: "sess-patch",
        project_dir: "/work/patch",
        last_used_at: 1000,
        turn_count: 0,
      }),
    ]);
    act(() => {
      publishListSessionsOk({
        project_dir: "/work/patch",
        sessions: [
          makeSessionRow({
            session_id: "sess-patch",
            project_dir: "/work/patch",
            last_used_at: 2000,
            turn_count: 5,
          }),
        ],
      });
    });

    const subtitle = document.querySelector(
      '[data-testid="tide-card-picker-resume-subtitle"]',
    );
    expect(subtitle?.textContent).toContain("5 turns");
  });

  it("T-TIDE-LEDGER-06: live row subtitle reads 'Live in another card'", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/live"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/live");
    seedLedgerForPath("/work/live", [
      makeSessionRow({
        session_id: "sess-live",
        project_dir: "/work/live",
        last_used_at: 1000,
        state: "live",
        card_id: "other-card",
      }),
    ]);

    const subtitle = document.querySelector(
      '[data-testid="tide-card-picker-resume-subtitle"]',
    );
    expect(subtitle?.textContent).toBe("Live in another card");
  });

  it("T-TIDE-LEDGER-07: failed row subtitle reads 'Couldn't resume — JSONL missing'", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/failed"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/failed");
    seedLedgerForPath("/work/failed", [
      makeSessionRow({
        session_id: "sess-failed",
        project_dir: "/work/failed",
        last_used_at: 1000,
        state: "failed",
      }),
    ]);

    const subtitle = document.querySelector(
      '[data-testid="tide-card-picker-resume-subtitle"]',
    );
    expect(subtitle?.textContent).toBe("Couldn't resume — JSONL missing");
  });

  it("T-TIDE-LEDGER-08: pending status renders the 'checking…' placeholder under the path field", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/pending"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/pending");

    const placeholder = document.querySelector(
      '[data-testid="tide-card-picker-pending-placeholder"]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain("checking");

    seedLedgerForPath("/work/pending", []);
    expect(
      document.querySelector('[data-testid="tide-card-picker-pending-placeholder"]'),
    ).toBeNull();
  });

  it("T-TIDE-LEDGER-09: forget button is icon-only with aria-label; snippet has title carrying the full prompt", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/long-prompt"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/long-prompt");
    const longPrompt = "a".repeat(120);
    seedLedgerForPath("/work/long-prompt", [
      makeSessionRow({
        session_id: "sess-1234abcd",
        project_dir: "/work/long-prompt",
        last_used_at: 1000,
        first_user_prompt: longPrompt,
      }),
    ]);

    const forgetButton = document.querySelector<HTMLButtonElement>(
      ".tide-card-picker-session-forget",
    );
    expect(forgetButton).not.toBeNull();
    expect(forgetButton!.getAttribute("aria-label")).toBe(
      "Forget session sess-123",
    );
    expect(forgetButton!.querySelector("svg")).not.toBeNull();

    const titleSpans = document.querySelectorAll<HTMLElement>(
      ".tide-card-picker-session-option-title",
    );
    expect(titleSpans.length).toBe(2);
    const resumeTitle = titleSpans[1]!;
    expect(resumeTitle.getAttribute("title")).toBe(longPrompt);
    expect(resumeTitle.getAttribute("aria-label")).toBe(longPrompt);
  });

  it("T-TIDE-LEDGER-10: Cancel on the confirm popover dismisses without dispatching a frame", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/cancel"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/cancel");
    seedLedgerForPath("/work/cancel", [
      makeSessionRow({
        session_id: "sess-cancel",
        project_dir: "/work/cancel",
        last_used_at: 1000,
      }),
    ]);
    sentFrames.length = 0;

    const forgetButton = document.querySelector<HTMLButtonElement>(
      ".tide-card-picker-session-forget",
    );
    act(() => {
      fireEvent.click(forgetButton!);
    });

    const cancelButton = popoverButtonByText("Cancel");
    expect(cancelButton).not.toBeNull();
    act(() => {
      fireEvent.click(cancelButton!);
    });

    expect(sentFrames.length).toBe(0);
    // Picker rows still rendered: at least New session + the resume row.
    expect(sessionCells().length).toBeGreaterThan(0);
    expect(
      document.querySelector('[data-testid="tide-card-picker-resume-subtitle"]'),
    ).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Phase 2 picker rewrite — select-then-Open, navigation, selection
  // invalidation, arrow-key navigation. References tide-picker-redesign
  // [D03], [D04], [D05], [D06], [D10] and [Spec S01], [S02], [S03].
  // ---------------------------------------------------------------------------

  it("T-TIDE-PICKER-D06: SESSIONS first appears with Start fresh auto-selected", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/auto"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/auto");
    seedLedgerForPath("/work/auto", [
      makeSessionRow({
        session_id: "sess-1",
        project_dir: "/work/auto",
        last_used_at: 1000,
      }),
    ]);

    const startFreshCell = document.querySelector<HTMLElement>(
      '.tug-sheet-content [data-testid="tide-card-picker-session-new"]',
    );
    expect(startFreshCell?.getAttribute("data-selected")).toBe("true");
  });

  it("T-TIDE-PICKER-D04: clicking a live resume row does NOT promote it to selected", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/live2"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/live2");
    seedLedgerForPath("/work/live2", [
      makeSessionRow({
        session_id: "sess-live",
        project_dir: "/work/live2",
        last_used_at: 1000,
        state: "live",
        card_id: "other",
      }),
    ]);

    const resumeWrapper = resumeCellWrappers()[0];
    act(() => {
      fireEvent.click(resumeWrapper);
    });

    const resumeCell = resumeCells()[0];
    expect(resumeCell.getAttribute("data-selected")).not.toBe("true");
    // Start fresh stays selected per [D06].
    const startFreshCell = document.querySelector<HTMLElement>(
      '.tug-sheet-content [data-testid="tide-card-picker-session-new"]',
    );
    expect(startFreshCell?.getAttribute("data-selected")).toBe("true");
  });

  it("T-TIDE-PICKER-S03: when the selected session vanishes, selection snaps back to Start fresh", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/snap"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/snap");
    seedLedgerForPath("/work/snap", [
      makeSessionRow({
        session_id: "sess-vanish",
        project_dir: "/work/snap",
        last_used_at: 1000,
      }),
    ]);

    // Select the resume row.
    act(() => {
      fireEvent.click(resumeCellWrappers()[0]);
    });
    expect(resumeCells()[0].getAttribute("data-selected")).toBe("true");

    // Ledger ticks with the row removed (the user forgot it from
    // another card, or the workspace was deleted server-side).
    act(() => {
      publishListSessionsOk({ project_dir: "/work/snap", sessions: [] });
    });

    // Selection invalidation per [Spec S03] — snap back to Start fresh.
    const startFreshCell = document.querySelector<HTMLElement>(
      '.tug-sheet-content [data-testid="tide-card-picker-session-new"]',
    );
    expect(startFreshCell?.getAttribute("data-selected")).toBe("true");
  });

  it("T-TIDE-PICKER-D10: ArrowDown moves selection across selectable rows; ArrowUp wraps", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/nav"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/nav");
    seedLedgerForPath("/work/nav", [
      makeSessionRow({
        session_id: "sess-a",
        project_dir: "/work/nav",
        last_used_at: 2000,
      }),
      makeSessionRow({
        session_id: "sess-live",
        project_dir: "/work/nav",
        last_used_at: 1500,
        state: "live",
        card_id: "other",
      }),
      makeSessionRow({
        session_id: "sess-b",
        project_dir: "/work/nav",
        last_used_at: 1000,
      }),
    ]);

    // Start fresh is the default selection.
    const startFresh = startFreshWrapper();

    // ArrowDown from Start fresh → first non-live resume (sess-a).
    act(() => {
      fireEvent.keyDown(startFresh, { key: "ArrowDown" });
    });
    expect(resumeCells()[0].getAttribute("data-selected")).toBe("true");

    // ArrowDown again — skips the live row, lands on sess-b.
    act(() => {
      fireEvent.keyDown(startFresh, { key: "ArrowDown" });
    });
    // resumeCells()[1] is sess-live (rendered but disabled);
    // resumeCells()[2] is sess-b (the next non-live).
    expect(resumeCells()[1].getAttribute("data-selected")).not.toBe("true");
    expect(resumeCells()[2].getAttribute("data-selected")).toBe("true");

    // ArrowDown again — wraps to Start fresh.
    act(() => {
      fireEvent.keyDown(startFresh, { key: "ArrowDown" });
    });
    const startFreshCell = document.querySelector<HTMLElement>(
      '.tug-sheet-content [data-testid="tide-card-picker-session-new"]',
    );
    expect(startFreshCell?.getAttribute("data-selected")).toBe("true");

    // ArrowUp from Start fresh wraps to last selectable (sess-b).
    act(() => {
      fireEvent.keyDown(startFresh, { key: "ArrowUp" });
    });
    expect(resumeCells()[2].getAttribute("data-selected")).toBe("true");
  });
});
