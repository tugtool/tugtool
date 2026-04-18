/**
 * TideCardContent unit tests — sub-step 4b coverage.
 *
 * Tests cover:
 * - T-TIDE-01: unbound card renders the placeholder
 * - T-TIDE-02: setBinding causes the split pane to render
 * - T-TIDE-03: clearBinding causes the placeholder to return
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

// Force `getConnection()` to return null so the services effect skips
// FileTreeStore construction. 4b is testing the binding gate, not the
// live-connection stack — 4e–g introduce those. Another test in the
// suite may have installed a stub connection in the singleton; this
// module mock isolates us from that cross-test state.
mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => null,
  setConnection: () => {},
}));

import { TideCardContent } from "@/components/tugways/cards/tide-card";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

function renderTideCard(cardId: string) {
  return render(
    <ResponderChainProvider>
      <TideCardContent cardId={cardId} />
    </ResponderChainProvider>,
  );
}

const CARD_ID = "tide-4b-test";

function makeBinding(overrides: Partial<CardSessionBinding> = {}): CardSessionBinding {
  return {
    tugSessionId: "sess-4b-1",
    workspaceKey: "/work/4b",
    projectDir: "/work/4b",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  // Best-effort teardown — individual tests may have cleared already.
  cardSessionBindingStore.clearBinding(CARD_ID);
});

describe("TideCardContent – sub-step 4b binding gate", () => {
  it("T-TIDE-01: renders the pending placeholder when unbound", () => {
    const { container, queryByTestId } = renderTideCard(CARD_ID);
    expect(container.querySelector(".tide-card-picker-pending")).not.toBeNull();
    expect(queryByTestId("tide-card")).toBeNull();
  });

  it("T-TIDE-02: renders the split pane once a binding appears", () => {
    const { container, queryByTestId } = renderTideCard(CARD_ID);
    expect(container.querySelector(".tide-card-picker-pending")).not.toBeNull();

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    expect(container.querySelector(".tide-card-picker-pending")).toBeNull();
    expect(queryByTestId("tide-card")).not.toBeNull();
  });

  it("T-TIDE-03: reverts to the placeholder when the binding clears", () => {
    const { container, queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(queryByTestId("tide-card")).not.toBeNull();

    act(() => {
      cardSessionBindingStore.clearBinding(CARD_ID);
    });

    expect(container.querySelector(".tide-card-picker-pending")).not.toBeNull();
    expect(queryByTestId("tide-card")).toBeNull();
  });
});
