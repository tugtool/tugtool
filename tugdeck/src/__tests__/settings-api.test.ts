/**
 * settings-api unit tests.
 *
 * Tests cover:
 * - putCardState sends correct URL and body format (mock fetch)
 * - readDeckState returns null when not cached
 * - readDeckState returns the string value from cache
 * - putFocusedCardId sends correct URL and body format (mock fetch)
 * - readCardStates returns populated Map for known card IDs
 * - readCardStates skips missing entries
 */

import { describe, test, expect, mock, afterEach } from "bun:test";
import {
  putCardState,
  readDeckState,
  putFocusedCardId,
  readCardStates,
  putPromptHistory,
  getPromptHistory,
  readDevRecentProjects,
  insertDevRecentProject,
  capDurableCardState,
  boundPromptHistoryForPersist,
  MAX_PERSISTED_THUMBNAILS,
  MAX_PROMPT_HISTORY_BYTES,
  pruneOrphanedCardDefaults,
  CARD_KEYED_DOMAINS,
  DEV_RECENT_PROJECTS_MAX,
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

const CARDSTATE_DOMAIN = "dev.tugtool.deck.cardstate";

// ---------------------------------------------------------------------------
// putCardState
// ---------------------------------------------------------------------------

describe("putCardState", () => {
  afterEach(() => {
    mock.restore();
  });

  test("sends PUT to correct URL with json-tagged body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url as string, init: init ?? {} });
      return makeResponse(200, {});
    }) as unknown as typeof fetch;

    const cardId = "card-abc-123";
    const bag: CardStateBag = { scroll: { x: 10, y: 50 }, content: { key: "val" } };
    putCardState(cardId, bag);

    // Give the fire-and-forget promise a tick to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      `/api/defaults/dev.tugtool.deck.cardstate/${encodeURIComponent(cardId)}`
    );
    expect(calls[0].init.method).toBe("PUT");

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.kind).toBe("json");
    expect(body.value.scroll.x).toBe(10);
    expect(body.value.scroll.y).toBe(50);
    expect((body.value.content as Record<string, string>).key).toBe("val");
  });

  test("card ID with special characters is percent-encoded in URL", async () => {
    const calls: { url: string }[] = [];

    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push({ url: url as string });
      return makeResponse(200, {});
    }) as unknown as typeof fetch;

    const cardId = "card/with spaces&chars";
    putCardState(cardId, {});
    await new Promise((r) => setTimeout(r, 0));

    expect(calls[0].url).toBe(
      `/api/defaults/dev.tugtool.deck.cardstate/${encodeURIComponent(cardId)}`
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
// readCardStates
// ---------------------------------------------------------------------------

describe("readCardStates", () => {
  test("returns empty Map when cardIds array is empty", () => {
    const client = makeMockClient();
    const result = readCardStates(client, []);
    expect(result.size).toBe(0);
  });

  test("returns populated Map for cards with stored state", () => {
    const bag1: CardStateBag = { scroll: { x: 0, y: 100 } };
    const bag2: CardStateBag = { scroll: { x: 20, y: 30 }, content: "hello" };

    const client = makeMockClient({
      [CARDSTATE_DOMAIN]: {
        "card-1": { kind: "json", value: bag1 },
        "card-2": { kind: "json", value: bag2 },
      },
    });

    const result = readCardStates(client, ["card-1", "card-2"]);
    expect(result.size).toBe(2);
    expect(result.get("card-1")?.scroll?.y).toBe(100);
    expect(result.get("card-2")?.scroll?.x).toBe(20);
    expect(result.get("card-2")?.content).toBe("hello");
  });

  test("skips missing entries — absent cards are not in the returned Map", () => {
    const bag: CardStateBag = { scroll: { x: 5, y: 10 } };

    const client = makeMockClient({
      [CARDSTATE_DOMAIN]: {
        "card-present": { kind: "json", value: bag },
      },
    });

    const result = readCardStates(client, ["card-present", "card-missing"]);
    expect(result.size).toBe(1);
    expect(result.has("card-present")).toBe(true);
    expect(result.has("card-missing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// putPromptHistory
// ---------------------------------------------------------------------------

describe("pruneOrphanedCardDefaults", () => {
  afterEach(() => {
    mock.restore();
  });

  const tagged = (v: unknown): TaggedValue => ({ kind: "json", value: v });

  test("deletes non-live card ids across every card-keyed domain", async () => {
    // "live" is present; "dead" is orphaned. Each domain carries both.
    const store: Record<string, Record<string, TaggedValue>> = {};
    for (const domain of CARD_KEYED_DOMAINS) {
      store[domain] = { live: tagged(1), dead: tagged(1) };
    }
    const client = makeMockClient(store);

    const deletes: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") deletes.push(url as string);
      return makeResponse(200, {});
    }) as unknown as typeof fetch;

    pruneOrphanedCardDefaults(client, new Set(["live"]));
    await new Promise((r) => setTimeout(r, 0));

    // One DELETE per domain, all for "dead", none for "live".
    expect(deletes.length).toBe(CARD_KEYED_DOMAINS.length);
    for (const domain of CARD_KEYED_DOMAINS) {
      expect(deletes).toContain(`/api/defaults/${domain}/dead`);
      expect(deletes).not.toContain(`/api/defaults/${domain}/live`);
    }
  });

  test("covers cardstate, permission-mode, and model", () => {
    expect(CARD_KEYED_DOMAINS).toContain("dev.tugtool.deck.cardstate");
    expect(CARD_KEYED_DOMAINS).toContain("dev.permission-mode");
    expect(CARD_KEYED_DOMAINS).toContain("dev.model");
  });

  test("skips a domain absent from the cache", async () => {
    // Only cardstate present; the other domains return undefined → skipped.
    const client = makeMockClient({
      "dev.tugtool.deck.cardstate": { dead: tagged(1) },
    });
    const deletes: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") deletes.push(url as string);
      return makeResponse(200, {});
    }) as unknown as typeof fetch;

    pruneOrphanedCardDefaults(client, new Set());
    await new Promise((r) => setTimeout(r, 0));

    expect(deletes).toEqual(["/api/defaults/dev.tugtool.deck.cardstate/dead"]);
  });
});

describe("boundPromptHistoryForPersist", () => {
  const imgEntry = (id: string, thumbBytes: number): HistoryEntry => ({
    id,
    sessionId: "s",
    projectPath: "/p",
    route: ">",
    text: `prompt ${id}`,
    atoms: [
      {
        position: 0,
        type: "image",
        label: "img",
        value: "img",
        id: `bytes-${id}`,
        thumbnailDataUrl: "data:image/png;base64," + "A".repeat(thumbBytes),
      },
    ],
    timestamp: 0,
  });

  test("keeps thumbnails only on the most recent few image entries", () => {
    // 10 image entries, newest last. Only the newest MAX survive with a thumb.
    const entries = Array.from({ length: 10 }, (_, i) => imgEntry(`e${i}`, 100));
    const out = boundPromptHistoryForPersist(entries);
    const withThumb = out.filter((e) =>
      e.atoms.some((a) => a.thumbnailDataUrl !== undefined),
    );
    expect(withThumb.length).toBe(MAX_PERSISTED_THUMBNAILS);
    // The survivors are the newest entries (end of the array).
    const survivorIds = new Set(withThumb.map((e) => e.id));
    expect(survivorIds.has("e9")).toBe(true);
    expect(survivorIds.has("e0")).toBe(false);
    // Older entries keep their text + atom, just no thumbnail.
    const e0 = out.find((e) => e.id === "e0");
    expect(e0?.text).toBe("prompt e0");
    expect(e0?.atoms[0].thumbnailDataUrl).toBeUndefined();
    expect(e0?.atoms[0].id).toBe("bytes-e0");
  });

  test("keeps text-only history intact (nothing to strip)", () => {
    const entries: HistoryEntry[] = [
      { id: "a", sessionId: "s", projectPath: "/p", route: ">", text: "hi", atoms: [], timestamp: 0 },
    ];
    expect(boundPromptHistoryForPersist(entries)).toEqual(entries);
  });

  test("byte backstop drops oldest entries until under the cap", () => {
    // A few very large thumbnails would exceed the byte cap even after the
    // count trim — the backstop drops oldest whole entries so it fits.
    const big = Math.floor(MAX_PROMPT_HISTORY_BYTES / 2);
    const entries = Array.from({ length: 6 }, (_, i) => imgEntry(`e${i}`, big));
    const out = boundPromptHistoryForPersist(entries);
    const bytes = JSON.stringify({ kind: "json", value: out }).length;
    expect(bytes).toBeLessThanOrEqual(MAX_PROMPT_HISTORY_BYTES);
    expect(out.length).toBeLessThan(entries.length);
    // Whatever survives is the newest tail.
    expect(out[out.length - 1].id).toBe("e5");
  });
});

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
// dev recent-projects (step 4m)
// ---------------------------------------------------------------------------

describe("insertDevRecentProject", () => {
  test("prepends a new path to an empty list", () => {
    expect(insertDevRecentProject([], "/tmp")).toEqual(["/tmp"]);
  });

  test("moves an existing path to the front (dedup)", () => {
    expect(insertDevRecentProject(["/a", "/b", "/c"], "/b")).toEqual([
      "/b",
      "/a",
      "/c",
    ]);
  });

  test("caps the list at DEV_RECENT_PROJECTS_MAX", () => {
    const over = ["/a", "/b", "/c", "/d", "/e"];
    const next = insertDevRecentProject(over, "/f");
    expect(next.length).toBe(DEV_RECENT_PROJECTS_MAX);
    expect(next[0]).toBe("/f");
    // Oldest entry drops off.
    expect(next).not.toContain("/e");
  });
});

describe("readDevRecentProjects", () => {
  test("returns [] when the key is unset", () => {
    const client = makeMockClient({});
    expect(readDevRecentProjects(client)).toEqual([]);
  });

  test("returns the paths array from a json-tagged value", () => {
    const client = makeMockClient({
      "dev.tugtool.dev": {
        "recent-projects": {
          kind: "json",
          value: { paths: ["/a", "/b"] },
        } as TaggedValue,
      },
    });
    expect(readDevRecentProjects(client)).toEqual(["/a", "/b"]);
  });

  test("drops non-string entries defensively", () => {
    const client = makeMockClient({
      "dev.tugtool.dev": {
        "recent-projects": {
          kind: "json",
          value: { paths: ["/a", 42, null, "", "/b"] },
        } as TaggedValue,
      },
    });
    expect(readDevRecentProjects(client)).toEqual(["/a", "/b"]);
  });

  test("returns [] when the value shape is wrong", () => {
    const client = makeMockClient({
      "dev.tugtool.dev": {
        "recent-projects": { kind: "json", value: "not-an-object" } as TaggedValue,
      },
    });
    expect(readDevRecentProjects(client)).toEqual([]);
  });
});

// PUT behavior for `putDevRecentProjects` is covered by T-DEV-07 in
// dev-card.test.tsx (which asserts the bind effect fires it with the
// right payload). Duplicating it here would require an unmocked
// `fetch`, but dev-card.test.tsx process-globally replaces the
// exported `putDevRecentProjects` with a recorder to keep dev-card's
// bind effect from racing with other test files' fetch stubs.

describe("capDurableCardState — strip the dead cellHeights field", () => {
  test("drops cellHeights of any size, keeps anchor + scroll", () => {
    const bag: CardStateBag = {
      scroll: { x: 0, y: 9 },
      regionScroll: {
        "dev-card-transcript": {
          x: 0,
          y: 5000,
          meta: { anchor: { index: 900, offset: 2 }, cellHeights: new Array(50).fill(60) },
        },
      },
    };
    const out = capDurableCardState(bag);
    const region = out.regionScroll!["dev-card-transcript"];
    expect((region.meta as Record<string, unknown>).cellHeights).toBeUndefined();
    expect((region.meta as Record<string, unknown>).anchor).toEqual({ index: 900, offset: 2 });
    expect(region.y).toBe(5000);
    expect(out.scroll).toEqual({ x: 0, y: 9 });
    // The input bag (the in-memory copy) is NOT mutated.
    expect(
      ((bag.regionScroll!["dev-card-transcript"].meta as Record<string, unknown>)
        .cellHeights as number[]).length,
    ).toBe(50);
  });

  test("a bag with no cellHeights is returned unchanged (same reference)", () => {
    const bag: CardStateBag = {
      regionScroll: { r: { x: 0, y: 0, meta: { anchor: { index: 1, offset: 0 } } } },
    };
    expect(capDurableCardState(bag)).toBe(bag);
  });

  test("a bag with no regionScroll is returned unchanged", () => {
    const bag: CardStateBag = { scroll: { x: 0, y: 0 } };
    expect(capDurableCardState(bag)).toBe(bag);
  });

  test("strips cellHeights from every region that carries it", () => {
    const bag: CardStateBag = {
      regionScroll: {
        big: { x: 0, y: 0, meta: { cellHeights: new Array(900).fill(1) } },
        small: { x: 0, y: 0, meta: { cellHeights: new Array(3).fill(1) } },
      },
    };
    const out = capDurableCardState(bag);
    expect((out.regionScroll!.big.meta as Record<string, unknown>).cellHeights).toBeUndefined();
    expect((out.regionScroll!.small.meta as Record<string, unknown>).cellHeights).toBeUndefined();
  });
});

describe("capDurableCardState — strip in-flight attachment bytes", () => {
  test("drops content.attachmentBytes, keeps the rest of content", () => {
    const bag: CardStateBag = {
      content: {
        route: "❯",
        draft: { text: "hi", atoms: [], selection: null },
        attachmentBytes: { b1: { content: "AAAA", mediaType: "image/png" } },
      },
    };
    const out = capDurableCardState(bag);
    const content = out.content as Record<string, unknown>;
    expect(content.attachmentBytes).toBeUndefined();
    expect(content.route).toBe("❯");
    expect(content.draft).toEqual({ text: "hi", atoms: [], selection: null });
    // The input bag is not mutated — the in-memory cache keeps its bytes.
    expect(
      (bag.content as Record<string, unknown>).attachmentBytes,
    ).toBeDefined();
  });

  test("a content payload without attachmentBytes is returned unchanged", () => {
    const bag: CardStateBag = {
      content: { route: "$", draft: null },
    };
    expect(capDurableCardState(bag)).toBe(bag);
  });

  test("strips both attachmentBytes and cellHeights in one pass", () => {
    const bag: CardStateBag = {
      content: { attachmentBytes: { b: { content: "x", mediaType: "image/png" } } },
      regionScroll: { r: { x: 0, y: 0, meta: { cellHeights: [1, 2, 3] } } },
    };
    const out = capDurableCardState(bag);
    expect((out.content as Record<string, unknown>).attachmentBytes).toBeUndefined();
    expect((out.regionScroll!.r.meta as Record<string, unknown>).cellHeights).toBeUndefined();
  });
});
