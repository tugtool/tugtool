/**
 * TideCardContent — transportState rendering (Step 6 of
 * tugplan-tide-connection-health).
 *
 * Drives a real `CodeSessionStore` through close → reconnect →
 * settle via the production lifecycle wiring, then asserts that the
 * card flips between `TideCardBody` and `TideRestoring`, and that the
 * status-row hint surfaces "Reconnecting…" while the wire is offline.
 *
 * Mirrors the harness structure in `tide-card-last-error.test.tsx` —
 * setup-rtl first, connection-singleton + connection-lifecycle mocked
 * so the module-scope `cardServicesStore` constructs real services
 * against test-controllable infrastructure.
 */
import "./setup-rtl";

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";

const mockConnection = new TestFrameChannel();

mock.module("@/lib/connection-singleton", () => ({
  getConnection: () => mockConnection,
  setConnection: () => {},
}));

// Shared lifecycle so the test can drive transport events into the
// per-card store via `notifyConnectionDidClose` /
// `notifyConnectionDidOpen`. Re-export the real class so other
// imports (e.g., the gallery card) keep their type contract.
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
const sharedLifecycle = new ConnectionLifecycle();
mock.module("@/lib/connection-lifecycle", () => ({
  ConnectionLifecycle,
  getConnectionLifecycle: () => sharedLifecycle,
  registerConnectionLifecycle: () => {},
}));

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
import { TugPanePortalContext } from "@/components/chrome/tug-pane";
import { cardServicesStore } from "@/lib/card-services-store";

const CARD_ID = "tide-transport-test";
const SESSION_ID = "sess-transport-1";

function makeBinding(overrides: Partial<CardSessionBinding> = {}): CardSessionBinding {
  return {
    tugSessionId: SESSION_ID,
    workspaceKey: "/work/transport",
    projectDir: "/work/transport",
    sessionMode: "new",
    ...overrides,
  };
}

function renderTideCard(cardId: string) {
  const cardEl = document.createElement("div");
  cardEl.className = "tug-pane-chrome";
  const cardBody = document.createElement("div");
  cardBody.className = "tug-pane-body";
  cardEl.appendChild(cardBody);
  document.body.appendChild(cardEl);

  const rtl = render(
    <ResponderChainProvider>
      <TugPanePortalContext value={cardEl}>
        <TideCardContent cardId={cardId} />
      </TugPanePortalContext>
    </ResponderChainProvider>,
  );

  return rtl;
}

/**
 * Prime the shared lifecycle so the next `notifyConnectionDidOpen`
 * fires `connectionDidReconnect` ([D08] requires both `everOpened`
 * and `sawCloseSinceLastOpen`). Tests in this file run in the same
 * file scope, so we cannot rely on a previous test having set
 * `everOpened`; this helper is idempotent.
 */
function primeLifecycleForReconnect(): void {
  if (!sharedLifecycle.isOpen()) {
    sharedLifecycle.notifyConnectionDidOpen();
  }
  sharedLifecycle.notifyConnectionDidClose();
}

afterEach(() => {
  cleanup();
  cardSessionBindingStore.clearBinding(CARD_ID);
  document.querySelectorAll(".tug-pane-chrome").forEach((el) => el.remove());
});

describe("TideCardContent — transportState rendering (Step 6)", () => {
  it("online: renders TideCardBody with the prompt entry, no transport hint", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(queryByTestId("tide-card")).not.toBeNull();
    expect(queryByTestId("tide-card-restoring")).toBeNull();
    expect(queryByTestId("tide-card-transport-hint")).toBeNull();

    // Sanity: store snapshot reports online.
    const services = cardServicesStore.getServices(CARD_ID);
    expect(services?.codeSessionStore.getSnapshot().transportState).toBe(
      "online",
    );
  });

  it("offline: renders TideCardBody with a Reconnecting status banner and canSubmit=false", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(queryByTestId("tide-card")).not.toBeNull();

    act(() => {
      sharedLifecycle.notifyConnectionDidClose();
    });

    // Body still mounts (transportState=offline does not flip to
    // TideRestoring), and the transport banner is the visible cue.
    expect(queryByTestId("tide-card")).not.toBeNull();
    expect(queryByTestId("tide-card-restoring")).toBeNull();

    // Locate the transport banner: TugPaneBanner with
    // `variant="status"` is what Step 6 renders for offline. The
    // error-variant banner from `lastError` is hidden because
    // idle + transport_close leaves lastError null per [D06].
    const banners = document.querySelectorAll<HTMLElement>(
      "[data-slot=\"tug-pane-banner\"][data-variant=\"status\"]",
    );
    expect(banners.length).toBe(1);
    expect(banners[0].getAttribute("data-visible")).toBe("true");
    expect(banners[0].textContent ?? "").toMatch(/reconnect/i);

    // canSubmit is the ([idle ∨ errored] ∧ online) conjunction; offline
    // clamps it. The store is the source of truth — assert via snapshot.
    const services = cardServicesStore.getServices(CARD_ID);
    const snap = services!.codeSessionStore.getSnapshot();
    expect(snap.transportState).toBe("offline");
    expect(snap.canSubmit).toBe(false);
  });

  it("restoring: routes to TideRestoring placeholder", () => {
    const { queryByTestId, getByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    expect(queryByTestId("tide-card")).not.toBeNull();

    // Drive offline → restoring via the lifecycle. [D08] requires a
    // prior open before reconnect fires; the lifecycle is fresh here,
    // so prime it first.
    act(() => {
      primeLifecycleForReconnect();
      sharedLifecycle.notifyConnectionDidOpen();
    });

    // The body unmounts; the placeholder takes its place.
    expect(queryByTestId("tide-card")).toBeNull();
    expect(queryByTestId("tide-card-restoring")).not.toBeNull();

    // Project label rides through the placeholder.
    expect(getByTestId("tide-card-restoring-project").textContent).toBe(
      "/work/transport",
    );

    const services = cardServicesStore.getServices(CARD_ID);
    expect(services?.codeSessionStore.getSnapshot().transportState).toBe(
      "restoring",
    );
  });

  it("walks online → offline → restoring → online via the lifecycle, body returns once settled", () => {
    const { queryByTestId } = renderTideCard(CARD_ID);

    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });
    const services = cardServicesStore.getServices(CARD_ID);
    expect(services).not.toBeNull();
    const store = services!.codeSessionStore;

    // online
    expect(queryByTestId("tide-card")).not.toBeNull();
    expect(queryByTestId("tide-card-restoring")).toBeNull();
    expect(store.getSnapshot().transportState).toBe("online");

    // offline
    act(() => {
      sharedLifecycle.notifyConnectionDidClose();
    });
    expect(queryByTestId("tide-card")).not.toBeNull();
    expect(
      document.querySelector(
        "[data-slot=\"tug-pane-banner\"][data-variant=\"status\"][data-visible=\"true\"]",
      ),
    ).not.toBeNull();
    expect(store.getSnapshot().transportState).toBe("offline");

    // restoring (the lifecycle's prior open + the close above arm
    // connectionDidReconnect on the next open)
    act(() => {
      sharedLifecycle.notifyConnectionDidOpen();
    });
    expect(queryByTestId("tide-card")).toBeNull();
    expect(queryByTestId("tide-card-restoring")).not.toBeNull();
    expect(store.getSnapshot().transportState).toBe("restoring");

    // settled: notifyTransportSettled flips back to online; the body
    // returns and the placeholder unmounts.
    act(() => {
      store.notifyTransportSettled();
    });
    expect(queryByTestId("tide-card")).not.toBeNull();
    expect(queryByTestId("tide-card-restoring")).toBeNull();
    expect(store.getSnapshot().transportState).toBe("online");
    expect(store.getSnapshot().canSubmit).toBe(true);
  });

  it("snapshot reference is stable across no-op renders ([L02])", () => {
    renderTideCard(CARD_ID);
    act(() => {
      cardSessionBindingStore.setBinding(CARD_ID, makeBinding());
    });

    const services = cardServicesStore.getServices(CARD_ID);
    expect(services).not.toBeNull();
    const store = services!.codeSessionStore;

    const snapBefore = store.getSnapshot();
    // A redundant settled dispatch (already online) is a reducer no-op
    // — the store should hand back the same snapshot reference.
    act(() => {
      store.notifyTransportSettled();
    });
    expect(store.getSnapshot()).toBe(snapBefore);
  });
});
