/**
 * Persistence behavior of `LensStore` — verifies that mutations issue
 * PUT requests to the right `/api/defaults/dev.tugtool.lens/*` URL with
 * the right body shape. The reducer's pure-logic semantics are exercised
 * separately in reducer.test.ts; this test pins the wrapper's wire shape.
 *
 * Uses a stubbed `globalThis.fetch` to capture calls. The singleton has
 * no tugbank client wired in test mode, so hydrate is a no-op and
 * mutations still issue fetch via `putRaw` — which is what we check.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { lensStore } from "@/lib/lens-store/lens-store";
import { LENS_DOMAIN, LENS_KEYS } from "@/lib/lens-store/types";

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
  (lensStore as unknown as { _disposeForTest: () => void })._disposeForTest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("LensStore — persistence", () => {
  it("setWidth PUTs the widthPx key under the lens domain", async () => {
    lensStore.setWidth(555);
    await Promise.resolve();
    const put = captured.find((c) => c.method === "PUT");
    expect(put).toBeDefined();
    expect(put!.url).toBe(`/api/defaults/${LENS_DOMAIN}/${LENS_KEYS.WIDTH_PX}`);
    expect(put!.body).toEqual({ kind: "i64", value: 555 });
  });

  it("setSectionOrder PUTs a json array", async () => {
    lensStore.setSectionOrder(["telemetry", "log"]);
    await Promise.resolve();
    const put = captured.find(
      (c) => c.method === "PUT" && c.url.endsWith(`/${LENS_KEYS.SECTION_ORDER}`),
    );
    expect(put).toBeDefined();
    expect(put!.body).toEqual({ kind: "json", value: ["telemetry", "log"] });
  });

  it("setCollapsed(true) PUTs the collapsedSections json array", async () => {
    lensStore.setCollapsed("telemetry", true);
    await Promise.resolve();
    const put = captured.find(
      (c) =>
        c.method === "PUT" &&
        c.url.endsWith(`/${LENS_KEYS.COLLAPSED_SECTIONS}`),
    );
    expect(put).toBeDefined();
    expect(put!.body).toEqual({ kind: "json", value: ["telemetry"] });
  });

  it("setAnchorSide PUTs the anchorSide string", async () => {
    lensStore.setAnchorSide("left");
    await Promise.resolve();
    const put = captured.find(
      (c) => c.method === "PUT" && c.url.endsWith(`/${LENS_KEYS.ANCHOR_SIDE}`),
    );
    expect(put).toBeDefined();
    expect(put!.body).toEqual({ kind: "string", value: "left" });
  });

  it("a no-op mutation issues no PUT", async () => {
    lensStore.setCollapsed("log", false); // never collapsed → no change
    await Promise.resolve();
    expect(captured.filter((c) => c.method === "PUT").length).toBe(0);
  });
});
