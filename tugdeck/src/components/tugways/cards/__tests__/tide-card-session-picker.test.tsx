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
 * - T-TIDE-LEDGER-10: Cancel on the confirmation panel returns to the picker.
 * - T-TIDE-LEDGER-11/12: Backspace shortcut wires through the same
 *   confirmation flow; Backspace on Start-fresh is a no-op.
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
    card_id_live: partial.card_id_live ?? null,
  };
}

function seedLedgerForPath(path: string, sessions: SessionRow[]): void {
  act(() => {
    publishListSessionsOk({ project_dir: path, sessions });
  });
}

function clickRecent(label: string): void {
  const btn = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".tug-sheet-content button"),
  ).find((b) => b.textContent?.trim() === label);
  expect(btn).not.toBeUndefined();
  act(() => {
    fireEvent.click(btn!);
  });
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

    const radios = document.querySelectorAll<HTMLButtonElement>(
      '.tug-sheet-content [role="radio"]',
    );
    expect(radios.length).toBe(4);
    expect(radios[0]!.textContent).toContain("Start fresh");
    const firstResumeSubtitle = radios[1]!.querySelector(
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
        card_id_live: "other-card",
      }),
    ]);

    const radios = document.querySelectorAll<HTMLButtonElement>(
      '.tug-sheet-content [role="radio"]',
    );
    expect(radios.length).toBe(2);
    expect(radios[1]!.disabled).toBe(true);
    expect(radios[1]!.textContent).toContain("live");
  });

  it("T-TIDE-LEDGER-03: clicking Forget routes through the confirmation panel; affirm dispatches forget_session", () => {
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

    const confirmButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="tide-card-picker-forget-confirm-button"]',
    );
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

  it("T-TIDE-LEDGER-04: Forget all routes through confirmation; one forget_session per non-live row", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/all"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/all");
    seedLedgerForPath("/work/all", [
      makeSessionRow({
        session_id: "sess-1",
        project_dir: "/work/all",
        last_used_at: 1000,
      }),
      makeSessionRow({
        session_id: "sess-2",
        project_dir: "/work/all",
        last_used_at: 2000,
      }),
      makeSessionRow({
        session_id: "sess-live",
        project_dir: "/work/all",
        last_used_at: 3000,
        state: "live",
        card_id_live: "other",
      }),
    ]);
    sentFrames.length = 0;

    const forgetAll = document.querySelector<HTMLButtonElement>(
      '[data-testid="tide-card-picker-forget-all"]',
    );
    expect(forgetAll).not.toBeNull();
    act(() => {
      fireEvent.click(forgetAll!);
    });
    expect(sentFrames.length).toBe(0);

    const confirmAll = document.querySelector<HTMLButtonElement>(
      '[data-testid="tide-card-picker-forget-confirm-button"]',
    );
    act(() => {
      fireEvent.click(confirmAll!);
    });

    expect(sentFrames.length).toBe(2);
    const ids = sentFrames
      .map(
        (f) =>
          (
            JSON.parse(new TextDecoder().decode(f.payload)) as {
              session_id: string;
            }
          ).session_id,
      )
      .sort();
    expect(ids).toEqual(["sess-1", "sess-2"]);
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
        card_id_live: "other-card",
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

  it("T-TIDE-LEDGER-10: Cancel on the confirmation panel returns to the picker without dispatching a frame", () => {
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
    expect(
      document.querySelector('[data-testid="tide-card-picker-forget-confirm"]'),
    ).not.toBeNull();

    const cancelButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="tide-card-picker-forget-cancel"]',
    );
    act(() => {
      fireEvent.click(cancelButton!);
    });

    expect(sentFrames.length).toBe(0);
    expect(
      document.querySelector('[data-testid="tide-card-picker-forget-confirm"]'),
    ).toBeNull();
    expect(
      document.querySelectorAll('.tug-sheet-content [role="radio"]').length,
    ).toBeGreaterThan(0);
    expect(
      document.querySelector('[data-testid="tide-card-picker-resume-subtitle"]'),
    ).not.toBeNull();
  });

  it("T-TIDE-LEDGER-11: Backspace on a focused resume row opens the confirmation panel; confirm dispatches forget_session", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/kbd"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/kbd");
    seedLedgerForPath("/work/kbd", [
      makeSessionRow({
        session_id: "sess-kbd-target",
        project_dir: "/work/kbd",
        last_used_at: 1000,
      }),
    ]);
    sentFrames.length = 0;

    const radios = document.querySelectorAll<HTMLButtonElement>(
      '.tug-sheet-content [role="radio"]',
    );
    const resumeRadio = radios[1]!;
    act(() => {
      fireEvent.keyDown(resumeRadio, { key: "Backspace" });
    });

    expect(
      document.querySelector('[data-testid="tide-card-picker-forget-confirm"]'),
    ).not.toBeNull();
    const confirmButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="tide-card-picker-forget-confirm-button"]',
    );
    act(() => {
      fireEvent.click(confirmButton!);
    });

    expect(sentFrames.length).toBe(1);
    const decoded = JSON.parse(new TextDecoder().decode(sentFrames[0]!.payload)) as {
      action: string;
      session_id: string;
    };
    expect(decoded).toEqual({
      action: "forget_session",
      session_id: "sess-kbd-target",
    });
  });

  it("T-TIDE-LEDGER-12: Backspace on the Start-fresh row is a no-op (nothing to forget)", () => {
    tugbankStore["dev.tugtool.tide"] = {
      "recent-projects": { kind: "json", value: { paths: ["/work/kbd2"] } },
    };
    renderTideCard(CARD_ID);
    clickRecent("/work/kbd2");
    seedLedgerForPath("/work/kbd2", [
      makeSessionRow({
        session_id: "sess-not-target",
        project_dir: "/work/kbd2",
        last_used_at: 1000,
      }),
    ]);
    sentFrames.length = 0;

    const radios = document.querySelectorAll<HTMLButtonElement>(
      '.tug-sheet-content [role="radio"]',
    );
    const startFresh = radios[0]!;
    act(() => {
      fireEvent.keyDown(startFresh, { key: "Backspace" });
    });

    expect(
      document.querySelector('[data-testid="tide-card-picker-forget-confirm"]'),
    ).toBeNull();
    expect(sentFrames.length).toBe(0);
  });
});
