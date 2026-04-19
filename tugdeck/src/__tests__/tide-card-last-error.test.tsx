/**
 * TideCardContent — lastError banner integration (TugCardBanner adoption).
 *
 * Drives `CodeSessionStore` through real error transitions by dispatching
 * SESSION_STATE frames on a MockTugConnection, then asserts the rendered
 * TugCardBanner appears, dismisses, and re-raises on new errors.
 *
 * Banner unmount is deferred to the exit animation's `.finished` — tests
 * drive the WAAPI mock to completion to deterministically observe the
 * post-animation DOM.
 *
 * Mirrors the harness structure in `tide-card.test.tsx` — setup-rtl first,
 * connection-singleton mocked to return a MockTugConnection so the
 * module-scope `cardServicesStore` constructs a real store against a
 * test-controllable wire.
 */
import "./setup-rtl";

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, act, cleanup, fireEvent, waitFor } from "@testing-library/react";

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

/** Locate the portaled TugCardBanner via its `data-slot` anchor. */
function queryBannerEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot=\"tug-card-banner\"]");
}
function getBannerEl(): HTMLElement {
  const el = queryBannerEl();
  if (el === null) throw new Error("tug-card-banner not in the DOM");
  return el;
}

/** Resolve every pending WAAPI mock animation so `.finished` promises settle. */
function resolveAllWaapiAnimations() {
  const mock = (global as unknown as {
    __waapi_mock__: { calls: Array<{ resolve: () => void }>; reset: () => void };
  }).__waapi_mock__;
  for (const call of mock.calls) call.resolve();
}

afterEach(() => {
  cleanup();
  cardSessionBindingStore.clearBinding(CARD_ID);
  document.querySelectorAll(".tugcard").forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
  const mock = (global as unknown as {
    __waapi_mock__: { reset: () => void };
  }).__waapi_mock__;
  mock.reset();
});

describe("TideCardContent — lastError TugCardBanner", () => {
  it("T-TIDE-LASTERR-01: renders the banner when lastError becomes non-null", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(queryByTestId("tide-card")).not.toBeNull();
    expect(queryBannerEl()).toBeNull();

    act(() => {
      dispatchSessionErrored("crash_budget_exhausted");
    });

    const banner = getBannerEl();
    expect(banner).not.toBeNull();
    expect(banner.getAttribute("data-variant")).toBe("error");
    expect(banner.getAttribute("data-tone")).toBe("danger");
    expect(banner.textContent ?? "").toContain("Session errored");
    expect(banner.textContent ?? "").toContain("crash_budget_exhausted");
  });

  it("T-TIDE-LASTERR-02: hides the banner when the Dismiss button is clicked", async () => {
    const { getByRole } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
      dispatchSessionErrored("crash_budget_exhausted");
    });
    expect(getBannerEl()).not.toBeNull();

    act(() => {
      fireEvent.click(getByRole("button", { name: "Dismiss" }));
    });

    // Exit animation runs; banner stays mounted until `.finished` resolves.
    await act(async () => {
      resolveAllWaapiAnimations();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(queryBannerEl()).toBeNull();
    });
  });

  it("T-TIDE-LASTERR-03: a dismissed error stays hidden, but a later error re-raises the banner", async () => {
    const { getByRole } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
      dispatchSessionErrored("crash_budget_exhausted");
    });
    const firstBanner = getBannerEl();
    const firstText = firstBanner.textContent;

    act(() => {
      fireEvent.click(getByRole("button", { name: "Dismiss" }));
    });

    // Complete the exit animation so the banner fully unmounts before the
    // second error fires.
    await act(async () => {
      resolveAllWaapiAnimations();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(queryBannerEl()).toBeNull();
    });

    // A second errored event (distinct `at` timestamp from the reducer's
    // Date.now()) must pull the banner back into view.
    act(() => {
      dispatchSessionErrored("second_failure");
    });

    const secondBanner = getBannerEl();
    expect(secondBanner).not.toBeNull();
    expect(secondBanner.textContent).not.toBe(firstText);
    expect(secondBanner.textContent ?? "").toContain("second_failure");
  });
});
