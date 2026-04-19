/**
 * TideCardContent — lastError banner (T3.4.c Step 6).
 *
 * Drives `CodeSessionStore` through real error transitions by
 * dispatching SESSION_STATE frames on a MockTugConnection, then
 * asserts the inline banner renders / hides / dismisses.
 *
 * Mirrors the harness structure in `tide-card.test.tsx` — setup-rtl
 * first, connection-singleton mocked to return a MockTugConnection so
 * the module-scope `cardServicesStore` constructs a real store against
 * a test-controllable wire.
 */
import "./setup-rtl";

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import { MockTugConnection } from "@/lib/code-session-store/testing/mock-feed-store";
import { FeedId } from "@/protocol";

// Single connection instance for the test file; re-used across tests
// because cardServicesStore binds to the module-scope singleton. Each
// test clears the binding in afterEach, which disposes services and
// unsubscribes the FeedStore from onFrame, so the connection can be
// reused cleanly.
const mockConnection = new MockTugConnection();

mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => mockConnection,
  setConnection: () => {},
}));

// EditorSettingsStore subscribes to tugbank on construction; stub it
// out so the tests don't hit real storage.
const fakeTugbank = {
  get(_domain: string, _key: string) {
    return undefined;
  },
  readDomain(_domain: string) {
    return undefined;
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
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugcardPortalContext } from "@/components/tugways/tug-card";

const CARD_ID = "tide-6-test";
const SESSION_ID = "sess-6-1";

function makeBinding(overrides: Partial<CardSessionBinding> = {}): CardSessionBinding {
  return {
    tugSessionId: SESSION_ID,
    workspaceKey: "/work/6",
    projectDir: "/work/6",
    sessionMode: "new",
    ...overrides,
  };
}

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

  return rtl;
}

/** Dispatch a SESSION_STATE errored frame on the mock connection. */
function dispatchSessionErrored(detail: string): void {
  mockConnection.dispatchDecoded(FeedId.SESSION_STATE, {
    tug_session_id: SESSION_ID,
    state: "errored",
    detail,
  });
}

afterEach(() => {
  cleanup();
  cardSessionBindingStore.clearBinding(CARD_ID);
  document.querySelectorAll(".tugcard").forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
});

describe("TideCardContent — lastError banner (Step 6)", () => {
  it("T-TIDE-LASTERR-01: renders the banner when lastError becomes non-null", () => {
    const { queryByTestId, getByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(queryByTestId("tide-card")).not.toBeNull();
    expect(queryByTestId("tide-card-error-banner")).toBeNull();

    act(() => {
      dispatchSessionErrored("crash_budget_exhausted");
    });

    const banner = getByTestId("tide-card-error-banner");
    expect(banner).not.toBeNull();
    expect(banner.getAttribute("data-cause")).toBe("session_state_errored");
    expect(banner.textContent ?? "").toContain("Session errored");
    expect(banner.textContent ?? "").toContain("crash_budget_exhausted");
  });

  it("T-TIDE-LASTERR-02: hides the banner when the dismiss button is clicked", () => {
    const { queryByTestId, getByTestId, getByLabelText } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
      dispatchSessionErrored("crash_budget_exhausted");
    });
    expect(getByTestId("tide-card-error-banner")).not.toBeNull();

    act(() => {
      fireEvent.click(getByLabelText("Dismiss error"));
    });

    expect(queryByTestId("tide-card-error-banner")).toBeNull();
  });

  it("T-TIDE-LASTERR-03: a dismissed error stays hidden, but a later error re-raises the banner", () => {
    const { queryByTestId, getByTestId, getByLabelText } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
      dispatchSessionErrored("crash_budget_exhausted");
    });
    const firstBanner = getByTestId("tide-card-error-banner");
    const firstMessage = firstBanner.textContent;

    act(() => {
      fireEvent.click(getByLabelText("Dismiss error"));
    });
    expect(queryByTestId("tide-card-error-banner")).toBeNull();

    // A second errored event (distinct `at` timestamp from the reducer's
    // Date.now()) must pull the banner back into view.
    act(() => {
      dispatchSessionErrored("second_failure");
    });

    const secondBanner = getByTestId("tide-card-error-banner");
    expect(secondBanner).not.toBeNull();
    expect(secondBanner.textContent).not.toBe(firstMessage);
    expect(secondBanner.textContent ?? "").toContain("second_failure");
  });
});
