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
 * - migrateTabstateToCardstate (legacy tabstate → cardstate)
 */

import { describe, test, expect, mock, afterEach } from "bun:test";
import {
  putTabState,
  readDeckState,
  putFocusedCardId,
  readTabStates,
  migrateTabstateToCardstate,
  putPromptHistory,
  getPromptHistory,
  readTideRecentProjects,
  insertTideRecentProject,
  TIDE_RECENT_PROJECTS_MAX,
} from "../settings-api";
import type { CardStateBag } from "../layout-tree";
import type { TugbankClient, TaggedValue } from "../lib/tugbank-client";
import type { HistoryEntry } from "../lib/prompt-history-store";

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

/** Domains used by `migrateTabstateToCardstate` (must match settings-api). */
const LEGACY_TABSTATE_DOMAIN = "dev.tugtool.deck.tabstate";
const CARDSTATE_DOMAIN = "dev.tugtool.deck.cardstate";

/** Parse `/api/defaults/:domain/:key` paths used by tugcast defaults HTTP API. */
function parseDefaultsDomainKey(url: string): { domain: string; key: string } | null {
  const prefix = "/api/defaults/";
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const domain = rest.slice(0, slash);
  const key = decodeURIComponent(rest.slice(slash + 1));
  return { domain, key };
}

/**
 * Mutates `store` on PUT to cardstate and DELETE from legacy tabstate, mirroring server behavior.
 */
function installMigrationFetchMock(
  store: Record<string, Record<string, TaggedValue>>,
  options?: { failFirstCardstatePut?: boolean },
): { cardstatePutCount: () => number } {
  let cardstatePutSuccessCount = 0;
  let consumedFirstPutFailure = false;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const parsed = parseDefaultsDomainKey(u);
    if (!parsed) {
      return makeResponse(404, {});
    }

    if (method === "PUT" && parsed.domain === CARDSTATE_DOMAIN) {
      if (options?.failFirstCardstatePut && !consumedFirstPutFailure) {
        consumedFirstPutFailure = true;
        throw new Error("simulated PUT failure");
      }
      cardstatePutSuccessCount++;
      const body = init?.body as string;
      const tagged = JSON.parse(body) as TaggedValue;
      if (!store[parsed.domain]) store[parsed.domain] = {};
      store[parsed.domain][parsed.key] = tagged;
      return makeResponse(200, { status: "ok" });
    }

    if (method === "DELETE" && parsed.domain === LEGACY_TABSTATE_DOMAIN) {
      const domainMap = store[parsed.domain];
      if (domainMap?.[parsed.key]) {
        delete domainMap[parsed.key];
        if (Object.keys(domainMap).length === 0) {
          delete store[parsed.domain];
        }
      }
      return makeResponse(200, { status: "ok" });
    }

    return makeResponse(404, {});
  }) as unknown as typeof fetch;

  return {
    cardstatePutCount: () => cardstatePutSuccessCount,
  };
}

// ---------------------------------------------------------------------------
// migrateTabstateToCardstate
// ---------------------------------------------------------------------------

describe("migrateTabstateToCardstate", () => {
  afterEach(() => {
    mock.restore();
  });

  test("empty legacy tabstate and empty cardstate → zero summary", async () => {
    const store: Record<string, Record<string, TaggedValue>> = {};
    installMigrationFetchMock(store);
    const client = makeMockClient(store);

    const summary = await migrateTabstateToCardstate(client);
    expect(summary).toEqual({ migrated: 0, skipped: 0, unchanged: 0 });
  });

  test("three legacy rows, no cardstate → migrated verbatim; legacy domain cleared", async () => {
    const bag1: CardStateBag = { scroll: { x: 0, y: 1 } };
    const bag2: CardStateBag = { scroll: { x: 2, y: 3 }, content: { n: 4 } };
    const bag3: CardStateBag = { scroll: { x: 5, y: 6 } };

    const store: Record<string, Record<string, TaggedValue>> = {
      [LEGACY_TABSTATE_DOMAIN]: {
        "legacy-a": { kind: "json", value: bag1 },
        "legacy-b": { kind: "json", value: bag2 },
        "legacy-c": { kind: "json", value: bag3 },
      },
    };
    installMigrationFetchMock(store);
    const client = makeMockClient(store);

    const summary = await migrateTabstateToCardstate(client);
    expect(summary).toEqual({ migrated: 3, skipped: 0, unchanged: 0 });

    expect(store[LEGACY_TABSTATE_DOMAIN]).toBeUndefined();
    expect(store[CARDSTATE_DOMAIN]?.["legacy-a"]?.value).toEqual(bag1);
    expect(store[CARDSTATE_DOMAIN]?.["legacy-b"]?.value).toEqual(bag2);
    expect(store[CARDSTATE_DOMAIN]?.["legacy-c"]?.value).toEqual(bag3);
  });

  test("row in both domains → cardstate value kept; legacy row removed (skipped)", async () => {
    const legacyOnly: CardStateBag = { scroll: { x: 99, y: 99 } };
    const winner: CardStateBag = { scroll: { x: 1, y: 2 } };

    const store: Record<string, Record<string, TaggedValue>> = {
      [LEGACY_TABSTATE_DOMAIN]: {
        "dup-1": { kind: "json", value: legacyOnly },
        "dup-2": { kind: "json", value: { scroll: { x: 0, y: 0 } } },
      },
      [CARDSTATE_DOMAIN]: {
        "dup-1": { kind: "json", value: winner },
        "dup-2": { kind: "json", value: { scroll: { x: 7, y: 8 } } },
      },
    };
    installMigrationFetchMock(store);
    const client = makeMockClient(store);

    const summary = await migrateTabstateToCardstate(client);
    expect(summary).toEqual({ migrated: 0, skipped: 2, unchanged: 0 });

    expect(store[LEGACY_TABSTATE_DOMAIN]).toBeUndefined();
    expect(store[CARDSTATE_DOMAIN]?.["dup-1"]?.value).toEqual(winner);
    expect((store[CARDSTATE_DOMAIN]?.["dup-2"]?.value as CardStateBag).scroll?.y).toBe(8);
  });

  test("row only in cardstate → unchanged count; no PUT or legacy DELETE", async () => {
    const bag: CardStateBag = { scroll: { x: 3, y: 4 } };
    const store: Record<string, Record<string, TaggedValue>> = {
      [CARDSTATE_DOMAIN]: {
        "only-card": { kind: "json", value: bag },
      },
    };
    const { cardstatePutCount } = installMigrationFetchMock(store);
    const client = makeMockClient(store);

    const summary = await migrateTabstateToCardstate(client);
    expect(summary).toEqual({ migrated: 0, skipped: 0, unchanged: 1 });
    expect(cardstatePutCount()).toBe(0);
    expect(store[CARDSTATE_DOMAIN]?.["only-card"]?.value).toEqual(bag);
  });

  test("first cardstate PUT fails → that legacy row remains; other rows still migrate", async () => {
    const keep: CardStateBag = { scroll: { x: 1, y: 1 } };
    const moved: CardStateBag = { scroll: { x: 2, y: 2 } };

    const store: Record<string, Record<string, TaggedValue>> = {
      [LEGACY_TABSTATE_DOMAIN]: {
        "fail-first": { kind: "json", value: keep },
        "ok-second": { kind: "json", value: moved },
      },
    };
    installMigrationFetchMock(store, { failFirstCardstatePut: true });
    const client = makeMockClient(store);

    const summary = await migrateTabstateToCardstate(client);
    expect(summary.migrated).toBe(1);
    expect(store[LEGACY_TABSTATE_DOMAIN]?.["fail-first"]).toBeDefined();
    expect(store[LEGACY_TABSTATE_DOMAIN]?.["ok-second"]).toBeUndefined();
    expect(store[CARDSTATE_DOMAIN]?.["ok-second"]?.value).toEqual(moved);
    expect(store[CARDSTATE_DOMAIN]?.["fail-first"]).toBeUndefined();
  });

  test("running twice yields stable store and second pass is a no-op on legacy rows", async () => {
    const bag: CardStateBag = { scroll: { x: 9, y: 8 } };
    const store: Record<string, Record<string, TaggedValue>> = {
      [LEGACY_TABSTATE_DOMAIN]: {
        "once": { kind: "json", value: bag },
      },
    };
    installMigrationFetchMock(store);
    const client = makeMockClient(store);

    const first = await migrateTabstateToCardstate(client);
    expect(first).toEqual({ migrated: 1, skipped: 0, unchanged: 0 });
    const afterFirst = JSON.stringify(store);

    const second = await migrateTabstateToCardstate(client);
    expect(second).toEqual({ migrated: 0, skipped: 0, unchanged: 1 });
    expect(JSON.stringify(store)).toBe(afterFirst);
  });
});

// ---------------------------------------------------------------------------
// putTabState
// ---------------------------------------------------------------------------

describe("putTabState", () => {
  afterEach(() => {
    mock.restore();
  });

  test("sends PUT to correct URL with json-tagged body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init: init ?? {} });
      return makeResponse(200, {});
    }) as unknown as typeof fetch;

    const tabId = "tab-abc-123";
    const bag: CardStateBag = { scroll: { x: 10, y: 50 }, content: { key: "val" } };
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

    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push({ url: url as string });
      return makeResponse(200, {});
    }) as unknown as typeof fetch;

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

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init: init ?? {} });
      return makeResponse(200, {});
    }) as unknown as typeof fetch;

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
    const bag1: CardStateBag = { scroll: { x: 0, y: 100 } };
    const bag2: CardStateBag = { scroll: { x: 20, y: 30 }, content: "hello" };

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
    const bag: CardStateBag = { scroll: { x: 5, y: 10 } };

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

// ---------------------------------------------------------------------------
// putPromptHistory
// ---------------------------------------------------------------------------

describe("putPromptHistory", () => {
  afterEach(() => {
    mock.restore();
  });

  test("sends PUT to correct URL with json-tagged body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init: init ?? {} });
      return makeResponse(200, {});
    }) as unknown as typeof fetch;

    const sessionId = "session-abc-123";
    const entries: HistoryEntry[] = [
      {
        id: "entry-1",
        sessionId,
        projectPath: "/home/user/proj",
        route: ">",
        text: "hello world",
        atoms: [],
        timestamp: 1700000000000,
      },
    ];

    putPromptHistory(sessionId, entries);
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      `/api/defaults/dev.tugtool.prompt.history/${encodeURIComponent(sessionId)}`
    );
    expect(calls[0].init.method).toBe("PUT");

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.kind).toBe("json");
    expect(Array.isArray(body.value)).toBe(true);
    expect(body.value.length).toBe(1);
    expect(body.value[0].id).toBe("entry-1");
    expect(body.value[0].text).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// getPromptHistory
// ---------------------------------------------------------------------------

describe("getPromptHistory", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns parsed entries array on 200 response", async () => {
    const sessionId = "session-xyz-456";
    const entries: HistoryEntry[] = [
      {
        id: "entry-a",
        sessionId,
        projectPath: "/home/user/proj",
        route: "$",
        text: "ls -la",
        atoms: [],
        timestamp: 1700000001000,
      },
      {
        id: "entry-b",
        sessionId,
        projectPath: "/home/user/proj",
        route: ">",
        text: "what is this file",
        atoms: [{ position: 15, type: "file", label: "readme.md", value: "/readme.md" }],
        timestamp: 1700000002000,
      },
    ];

    globalThis.fetch = (async () =>
      makeResponse(200, { kind: "json", value: entries })) as unknown as typeof fetch;

    const result = await getPromptHistory(sessionId);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe("entry-a");
    expect(result[1].id).toBe("entry-b");
    expect(result[1].atoms.length).toBe(1);
    expect(result[1].atoms[0].type).toBe("file");
  });

  test("returns empty array on 404 response", async () => {
    globalThis.fetch = (async () => makeResponse(404, null)) as unknown as typeof fetch;

    const result = await getPromptHistory("session-no-history");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tide recent-projects (step 4m)
// ---------------------------------------------------------------------------

describe("insertTideRecentProject", () => {
  test("prepends a new path to an empty list", () => {
    expect(insertTideRecentProject([], "/tmp")).toEqual(["/tmp"]);
  });

  test("moves an existing path to the front (dedup)", () => {
    expect(insertTideRecentProject(["/a", "/b", "/c"], "/b")).toEqual([
      "/b",
      "/a",
      "/c",
    ]);
  });

  test("caps the list at TIDE_RECENT_PROJECTS_MAX", () => {
    const over = ["/a", "/b", "/c", "/d", "/e"];
    const next = insertTideRecentProject(over, "/f");
    expect(next.length).toBe(TIDE_RECENT_PROJECTS_MAX);
    expect(next[0]).toBe("/f");
    // Oldest entry drops off.
    expect(next).not.toContain("/e");
  });
});

describe("readTideRecentProjects", () => {
  test("returns [] when the key is unset", () => {
    const client = makeMockClient({});
    expect(readTideRecentProjects(client)).toEqual([]);
  });

  test("returns the paths array from a json-tagged value", () => {
    const client = makeMockClient({
      "dev.tugtool.tide": {
        "recent-projects": {
          kind: "json",
          value: { paths: ["/a", "/b"] },
        } as TaggedValue,
      },
    });
    expect(readTideRecentProjects(client)).toEqual(["/a", "/b"]);
  });

  test("drops non-string entries defensively", () => {
    const client = makeMockClient({
      "dev.tugtool.tide": {
        "recent-projects": {
          kind: "json",
          value: { paths: ["/a", 42, null, "", "/b"] },
        } as TaggedValue,
      },
    });
    expect(readTideRecentProjects(client)).toEqual(["/a", "/b"]);
  });

  test("returns [] when the value shape is wrong", () => {
    const client = makeMockClient({
      "dev.tugtool.tide": {
        "recent-projects": { kind: "json", value: "not-an-object" } as TaggedValue,
      },
    });
    expect(readTideRecentProjects(client)).toEqual([]);
  });
});

// PUT behavior for `putTideRecentProjects` is covered by T-TIDE-07 in
// tide-card.test.tsx (which asserts the bind effect fires it with the
// right payload). Duplicating it here would require an unmocked
// `fetch`, but tide-card.test.tsx process-globally replaces the
// exported `putTideRecentProjects` with a recorder to keep tide-card's
// bind effect from racing with other test files' fetch stubs.
