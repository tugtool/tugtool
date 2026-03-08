/**
 * settings-api unit tests — Phase 5f Step 2.
 *
 * Tests cover:
 * - putTabState sends correct URL and body format (mock fetch)
 * - fetchDeckStateWithRetry returns null on 404
 * - fetchDeckStateWithRetry returns the string value on 200
 * - putFocusedCardId sends correct URL and body format (mock fetch)
 * - fetchTabStatesWithRetry returns populated Map for known tab IDs
 * - fetchTabStatesWithRetry skips 404 entries (tab not yet saved)
 */

import { describe, test, expect, mock, afterEach } from "bun:test";
import {
  putTabState,
  fetchDeckStateWithRetry,
  putFocusedCardId,
  fetchTabStatesWithRetry,
} from "../settings-api";
import type { TabStateBag } from "../layout-tree";

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

/** Build a minimal Response-like object for mocking fetch. */
function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// putTabState
// ---------------------------------------------------------------------------

describe("putTabState (Phase 5f Step 2)", () => {
  afterEach(() => {
    mock.restore();
  });

  test("sends PUT to correct URL with json-tagged body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init: init ?? {} });
      return makeResponse(200, {});
    };

    const tabId = "tab-abc-123";
    const bag: TabStateBag = { scroll: { x: 10, y: 50 }, content: { key: "val" } };
    putTabState(tabId, bag);

    // Give the fire-and-forget promise a tick to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      `/api/defaults/dev.tugtool.deck.tabstate/${encodeURIComponent(tabId)}`
    );
    expect(calls[0].init.method).toBe("PUT");

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.kind).toBe("json");
    expect(body.value.scroll.x).toBe(10);
    expect(body.value.scroll.y).toBe(50);
    expect((body.value.content as Record<string, string>).key).toBe("val");
  });

  test("tab ID with special characters is percent-encoded in URL", async () => {
    const calls: { url: string }[] = [];

    globalThis.fetch = async (url: string | URL | Request) => {
      calls.push({ url: url as string });
      return makeResponse(200, {});
    };

    const tabId = "tab/with spaces&chars";
    putTabState(tabId, {});
    await new Promise((r) => setTimeout(r, 0));

    expect(calls[0].url).toBe(
      `/api/defaults/dev.tugtool.deck.tabstate/${encodeURIComponent(tabId)}`
    );
  });
});

// ---------------------------------------------------------------------------
// putFocusedCardId
// ---------------------------------------------------------------------------

describe("putFocusedCardId (Phase 5f Step 2)", () => {
  afterEach(() => {
    mock.restore();
  });

  test("sends PUT to correct URL with string-tagged body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init: init ?? {} });
      return makeResponse(200, {});
    };

    putFocusedCardId("card-xyz");
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/defaults/dev.tugtool.deck.state/focusedCardId");
    expect(calls[0].init.method).toBe("PUT");

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.kind).toBe("string");
    expect(body.value).toBe("card-xyz");
  });
});

// ---------------------------------------------------------------------------
// fetchDeckStateWithRetry
// ---------------------------------------------------------------------------

describe("fetchDeckStateWithRetry (Phase 5f Step 2)", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns null on 404 (no focused card stored yet)", async () => {
    globalThis.fetch = async () => makeResponse(404, {});

    const result = await fetchDeckStateWithRetry();
    expect(result).toBeNull();
  });

  test("returns the string value on 200 with correct wire format", async () => {
    const cardId = "card-focused-789";
    globalThis.fetch = async () =>
      makeResponse(200, { kind: "string", value: cardId });

    const result = await fetchDeckStateWithRetry();
    expect(result).toBe(cardId);
  });

  test("returns null when response has unexpected tagged format", async () => {
    globalThis.fetch = async () =>
      makeResponse(200, { kind: "json", value: { not: "a string" } });

    const result = await fetchDeckStateWithRetry();
    expect(result).toBeNull();
  });

  test("fetches from correct URL", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (url: string | URL | Request) => {
      urls.push(url as string);
      return makeResponse(404, {});
    };

    await fetchDeckStateWithRetry();
    expect(urls[0]).toBe("/api/defaults/dev.tugtool.deck.state/focusedCardId");
  });
});

// ---------------------------------------------------------------------------
// fetchTabStatesWithRetry
// ---------------------------------------------------------------------------

describe("fetchTabStatesWithRetry (Phase 5f Step 2)", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns empty Map when tabIds array is empty", async () => {
    globalThis.fetch = async () => makeResponse(404, {});

    const result = await fetchTabStatesWithRetry([]);
    expect(result.size).toBe(0);
  });

  test("returns populated Map for tabs with stored state", async () => {
    const bag1: TabStateBag = { scroll: { x: 0, y: 100 } };
    const bag2: TabStateBag = { scroll: { x: 20, y: 30 }, content: "hello" };

    globalThis.fetch = async (url: string | URL | Request) => {
      const u = url as string;
      if (u.includes("tab-1")) return makeResponse(200, { kind: "json", value: bag1 });
      if (u.includes("tab-2")) return makeResponse(200, { kind: "json", value: bag2 });
      return makeResponse(404, {});
    };

    const result = await fetchTabStatesWithRetry(["tab-1", "tab-2"]);
    expect(result.size).toBe(2);
    expect(result.get("tab-1")?.scroll?.y).toBe(100);
    expect(result.get("tab-2")?.scroll?.x).toBe(20);
    expect(result.get("tab-2")?.content).toBe("hello");
  });

  test("skips 404 entries — absent tabs are not in the returned Map", async () => {
    const bag: TabStateBag = { scroll: { x: 5, y: 10 } };

    globalThis.fetch = async (url: string | URL | Request) => {
      const u = url as string;
      if (u.includes("tab-present")) return makeResponse(200, { kind: "json", value: bag });
      return makeResponse(404, {});
    };

    const result = await fetchTabStatesWithRetry(["tab-present", "tab-missing"]);
    expect(result.size).toBe(1);
    expect(result.has("tab-present")).toBe(true);
    expect(result.has("tab-missing")).toBe(false);
  });

  test("fetches each tab ID from the correct URL", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (url: string | URL | Request) => {
      urls.push(url as string);
      return makeResponse(404, {});
    };

    await fetchTabStatesWithRetry(["tab-alpha", "tab-beta"]);

    expect(urls.some((u) => u.includes("tab-alpha"))).toBe(true);
    expect(urls.some((u) => u.includes("tab-beta"))).toBe(true);
    expect(urls.every((u) => u.startsWith("/api/defaults/dev.tugtool.deck.tabstate/"))).toBe(true);
  });
});
