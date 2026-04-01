/**
 * settings-api unit tests.
 *
 * Tests cover:
 * - putTabState sends correct URL and body format (mock fetch)
 * - readDeckState returns null when not cached
 * - readDeckState returns the string value from cache
 * - putFocusedCardId sends correct URL and body format (mock fetch)
 * - readTabStates returns populated Map for known tab IDs
 * - readTabStates skips missing entries
 */

import { describe, test, expect, mock, afterEach } from "bun:test";
import {
  putTabState,
  readDeckState,
  putFocusedCardId,
  readTabStates,
} from "../settings-api";
import type { TabStateBag } from "../layout-tree";
import type { TugbankClient, TaggedValue } from "../lib/tugbank-client";

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
// TugbankClient mock helpers
// ---------------------------------------------------------------------------

/** Create a minimal TugbankClient mock with a backing store. */
function makeMockClient(
  store: Record<string, Record<string, TaggedValue>> = {}
): TugbankClient {
  return {
    get(domain: string, key: string): TaggedValue | undefined {
      return store[domain]?.[key];
    },
    readDomain(domain: string): Record<string, TaggedValue> | undefined {
      return store[domain];
    },
  } as TugbankClient;
}

// ---------------------------------------------------------------------------
// putTabState
// ---------------------------------------------------------------------------

describe("putTabState", () => {
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

describe("putFocusedCardId", () => {
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
// readDeckState
// ---------------------------------------------------------------------------

describe("readDeckState", () => {
  test("returns null when domain is not cached", () => {
    const client = makeMockClient();
    expect(readDeckState(client)).toBeNull();
  });

  test("returns the string value from cache", () => {
    const cardId = "card-focused-789";
    const client = makeMockClient({
      "dev.tugtool.deck.state": {
        focusedCardId: { kind: "string", value: cardId },
      },
    });
    expect(readDeckState(client)).toBe(cardId);
  });

  test("returns null when entry has unexpected tagged format", () => {
    const client = makeMockClient({
      "dev.tugtool.deck.state": {
        focusedCardId: { kind: "json", value: { not: "a string" } },
      },
    });
    expect(readDeckState(client)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readTabStates
// ---------------------------------------------------------------------------

describe("readTabStates", () => {
  test("returns empty Map when tabIds array is empty", () => {
    const client = makeMockClient();
    const result = readTabStates(client, []);
    expect(result.size).toBe(0);
  });

  test("returns populated Map for tabs with stored state", () => {
    const bag1: TabStateBag = { scroll: { x: 0, y: 100 } };
    const bag2: TabStateBag = { scroll: { x: 20, y: 30 }, content: "hello" };

    const client = makeMockClient({
      "dev.tugtool.deck.tabstate": {
        "tab-1": { kind: "json", value: bag1 },
        "tab-2": { kind: "json", value: bag2 },
      },
    });

    const result = readTabStates(client, ["tab-1", "tab-2"]);
    expect(result.size).toBe(2);
    expect(result.get("tab-1")?.scroll?.y).toBe(100);
    expect(result.get("tab-2")?.scroll?.x).toBe(20);
    expect(result.get("tab-2")?.content).toBe("hello");
  });

  test("skips missing entries — absent tabs are not in the returned Map", () => {
    const bag: TabStateBag = { scroll: { x: 5, y: 10 } };

    const client = makeMockClient({
      "dev.tugtool.deck.tabstate": {
        "tab-present": { kind: "json", value: bag },
      },
    });

    const result = readTabStates(client, ["tab-present", "tab-missing"]);
    expect(result.size).toBe(1);
    expect(result.has("tab-present")).toBe(true);
    expect(result.has("tab-missing")).toBe(false);
  });
});
