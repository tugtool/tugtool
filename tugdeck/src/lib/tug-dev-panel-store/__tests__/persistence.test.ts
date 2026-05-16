/**
 * Persistence behavior of `TugDevPanelStore` — verifies that mutations
 * issue PUT requests to the right `/api/defaults/dev.tugtool.dev-panel/*`
 * URL with the right body shape.
 *
 * Uses a stubbed `globalThis.fetch` to capture calls. The reducer's
 * pure-logic semantics are exercised separately in reducer.test.ts;
 * this test pins the wrapper's HTTP wire shape.
 *
 * Note: the singleton store has lazy init wired to `getTugbankClient()`.
 * Because the singleton has no client wired in test mode, the hydrate
 * path is a no-op (the test isn't checking hydrate), and mutations
 * still issue fetch calls via `putRaw` — which is what we're checking.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  DEV_PANEL_DOMAIN,
  DEV_PANEL_KEYS,
  tugDevPanelStore,
} from "@/lib/tug-dev-panel-store/tug-dev-panel-store";

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

let captured: CapturedRequest[] = [];
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  captured = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    captured.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body !== undefined ? JSON.parse(String(init.body)) : null,
    });
    return new Response(null, { status: 200 });
  }) as typeof globalThis.fetch;
  // Reset the singleton's internal state between tests.
  (tugDevPanelStore as unknown as { _disposeForTest: () => void })._disposeForTest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TugDevPanelStore — persistence", () => {
  it("setOpen(true) PUTs the open key under the dev-panel domain", async () => {
    tugDevPanelStore.setOpen(true);
    // Yield once so the fetch microtask runs.
    await Promise.resolve();
    const put = captured.find((c) => c.method === "PUT");
    expect(put).toBeDefined();
    expect(put!.url).toBe(
      `/api/defaults/${DEV_PANEL_DOMAIN}/${DEV_PANEL_KEYS.OPEN}`,
    );
    expect(put!.body).toEqual({ kind: "bool", value: true });
  });

  it("selectTab(telemetry) is a no-op when already on the default tab", async () => {
    tugDevPanelStore.selectTab("telemetry");
    await Promise.resolve();
    const puts = captured.filter((c) => c.method === "PUT");
    expect(puts.length).toBe(0);
  });

  it("selectCard PUTs the selectedCardId key with the right shape", async () => {
    tugDevPanelStore.selectCard("card-xyz");
    await Promise.resolve();
    const put = captured.find(
      (c) =>
        c.method === "PUT" &&
        c.url.endsWith(`/${DEV_PANEL_KEYS.SELECTED_CARD_ID}`),
    );
    expect(put).toBeDefined();
    expect(put!.body).toEqual({ kind: "string", value: "card-xyz" });
  });

  it("selectCard(null) writes a null-typed entry, not a missing one", async () => {
    tugDevPanelStore.selectCard("a");
    tugDevPanelStore.selectCard(null);
    await Promise.resolve();
    const puts = captured.filter(
      (c) =>
        c.method === "PUT" &&
        c.url.endsWith(`/${DEV_PANEL_KEYS.SELECTED_CARD_ID}`),
    );
    // Last PUT is the clear.
    const lastPut = puts[puts.length - 1];
    expect(lastPut.body).toEqual({ kind: "null", value: null });
  });

  it("notifyCardGone(matching) persists the cleared selection", async () => {
    tugDevPanelStore.selectCard("card-a");
    captured = []; // ignore the initial select
    tugDevPanelStore.notifyCardGone("card-a");
    await Promise.resolve();
    const puts = captured.filter((c) => c.method === "PUT");
    expect(puts.length).toBe(1);
    expect(puts[0].body).toEqual({ kind: "null", value: null });
  });

  it("notifyCardGone(unrelated) is a no-op — no PUT", async () => {
    tugDevPanelStore.selectCard("card-a");
    captured = [];
    tugDevPanelStore.notifyCardGone("card-b");
    await Promise.resolve();
    expect(captured.length).toBe(0);
  });
});
