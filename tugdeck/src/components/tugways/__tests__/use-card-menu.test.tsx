/**
 * useCardMenu — toggle reliability tests.
 *
 * Regression: pressing the title-bar `…` button cycled show → hide → no-op.
 * The third press did not present the sheet, even though the controller's
 * close ref had been cleared. These tests mount a Consumer that holds a
 * useCardMenu hook, then drive its controller through three sequential
 * toggles and assert the sheet content mounts twice.
 */
import "../../../__tests__/setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";

import { useCardMenu } from "../use-card-menu";
import { TugPanePortalContext } from "@/components/chrome/tug-pane";
import {
  ResponderChainContext,
  ResponderChainManager,
} from "@/components/tugways/responder-chain";
import {
  SheetLifecycle,
  SheetLifecycleContext,
} from "@/lib/sheet-lifecycle";
import { CardIdContext } from "@/lib/card-id-context";
import { cardMenuStore } from "@/lib/card-menu-store";

const TEST_CARD_ID = "test-card";

function renderWithChain(ui: React.ReactElement) {
  const manager = new ResponderChainManager();
  const sheetLifecycle = new SheetLifecycle();
  const cardEl = document.createElement("div");
  cardEl.className = "tug-pane-chrome";
  const cardBody = document.createElement("div");
  cardBody.className = "tug-pane-body";
  cardEl.appendChild(cardBody);
  document.body.appendChild(cardEl);

  const result = render(
    <ResponderChainContext.Provider value={manager}>
      <SheetLifecycleContext.Provider value={sheetLifecycle}>
        <CardIdContext.Provider value={TEST_CARD_ID}>
          <TugPanePortalContext.Provider value={cardEl}>
            {ui}
          </TugPanePortalContext.Provider>
        </CardIdContext.Provider>
      </SheetLifecycleContext.Provider>
    </ResponderChainContext.Provider>,
  );

  return {
    ...result,
    manager,
    cleanupCard: () => {
      if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
    },
  };
}

function getSheetContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".tug-sheet-content");
}

function resolveAllWaapiAnimations() {
  const mock = (global as unknown as {
    __waapi_mock__: { calls: Array<{ resolve: () => void }>; reset: () => void };
  }).__waapi_mock__;
  for (const call of mock.calls) {
    call.resolve();
  }
}

afterEach(() => {
  cleanup();
  document.querySelectorAll(".tug-pane-chrome").forEach((el) => {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
  const mock = (global as unknown as {
    __waapi_mock__: { reset: () => void };
  }).__waapi_mock__;
  mock?.reset();
});

describe("useCardMenu — toggle reliability", () => {
  it("toggle() on a fresh consumer cycles open → close → open across three presses", async () => {
    function Consumer() {
      const { renderSheet } = useCardMenu({
        cardId: TEST_CARD_ID,
        title: "Settings",
        render: (close) => (
          <button type="button" onClick={() => close()} data-testid="ok">
            OK
          </button>
        ),
      });
      return <>{renderSheet()}</>;
    }

    const { cleanupCard } = renderWithChain(<Consumer />);

    expect(getSheetContent()).toBeNull();

    // Press 1 — open.
    await act(async () => {
      cardMenuStore.getController(TEST_CARD_ID)?.toggle();
      await Promise.resolve();
    });
    expect(getSheetContent()).not.toBeNull();

    // Press 2 — close. Run the exit animation to completion so the
    // OLD sheet's `mounted` flips false and its DOM is removed.
    await act(async () => {
      cardMenuStore.getController(TEST_CARD_ID)?.toggle();
      // Drain microtasks for the showSheet promise's .finally and
      // any resolveHook microtasks so our close ref clears.
      await Promise.resolve();
      await Promise.resolve();
      // Run exit animation to completion.
      resolveAllWaapiAnimations();
      await Promise.resolve();
      await Promise.resolve();
    });
    // After close: the close ref was cleared by .finally, so a
    // fresh toggle should open the sheet again. Whether the OLD
    // sheet's DOM is fully removed by this point depends on
    // animation flushing; we don't assert on it — we just assert
    // the toggle reopens.

    // Press 3 — open again.
    await act(async () => {
      cardMenuStore.getController(TEST_CARD_ID)?.toggle();
      await Promise.resolve();
    });
    // Press 3 should produce a visible sheet. With the bug, the
    // controller's close-ref is non-null (or the showSheet hook
    // is in a stale state) and the third press doesn't open.
    expect(getSheetContent()).not.toBeNull();

    cleanupCard();
  });

  it("toggle() reads the store synchronously: rapid show→close→show inside one tick reopens the sheet", async () => {
    function Consumer() {
      const { renderSheet } = useCardMenu({
        cardId: TEST_CARD_ID,
        title: "Settings",
        render: () => <div data-testid="body">body</div>,
      });
      return <>{renderSheet()}</>;
    }

    const { cleanupCard } = renderWithChain(<Consumer />);

    // Three toggle calls in the same React `act` batch — no
    // microtasks drain between them. With a ref-based source-of-
    // truth that's only cleared in `.finally`, press 3 sees a
    // stale "open" view and dismisses again instead of opening.
    // With the store as the source-of-truth, press 3 correctly
    // sees "closed" (because press 2's close set it synchronously)
    // and opens fresh.
    await act(async () => {
      const ctl = cardMenuStore.getController(TEST_CARD_ID)!;
      ctl.toggle(); // open
      ctl.toggle(); // close
      ctl.toggle(); // open again
      await Promise.resolve();
    });

    // After the batch, the store must reflect "open" — the third
    // toggle in the rapid sequence reopened the menu.
    expect(cardMenuStore.isOpen(TEST_CARD_ID)).toBe(true);
    expect(getSheetContent()).not.toBeNull();

    cleanupCard();
  });
});
