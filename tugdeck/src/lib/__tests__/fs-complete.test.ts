/**
 * fs-complete.test.ts — pure-logic coverage for the directory-completion
 * client: the request URL it builds, entry coercion, and best-effort
 * degradation to `[]` on a non-OK response or transport error.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchPathCompletions } from "@/lib/fs-complete";

function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  mock.restore();
});

describe("fetchPathCompletions", () => {
  test("encodes base + partial + kind into the query and returns valid entries", async () => {
    let calledUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      calledUrl = String(url);
      return makeResponse(200, {
        completions: [
          { label: "private/", value: "/proj/private/", isDir: true },
          { label: "public/", value: "/proj/public/", isDir: true },
        ],
      });
    }) as unknown as typeof fetch;

    const out = await fetchPathCompletions("/proj", "p i");
    expect(calledUrl).toBe(
      "/api/fs/complete?base=%2Fproj&partial=p%20i&kind=directory",
    );
    expect(out).toEqual([
      { label: "private/", value: "/proj/private/", isDir: true },
      { label: "public/", value: "/proj/public/", isDir: true },
    ]);
  });

  test("file kind is passed through and isDir defaults false when absent", async () => {
    let calledUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      calledUrl = String(url);
      return makeResponse(200, {
        completions: [{ label: "notes.md", value: "/x/notes.md" }],
      });
    }) as unknown as typeof fetch;

    const out = await fetchPathCompletions("/x", "no", "file");
    expect(calledUrl).toBe("/api/fs/complete?base=%2Fx&partial=no&kind=file");
    expect(out).toEqual([{ label: "notes.md", value: "/x/notes.md", isDir: false }]);
  });

  test("drops malformed entries and tolerates a non-array payload", async () => {
    globalThis.fetch = mock(async () =>
      makeResponse(200, {
        completions: [
          { label: "ok/", value: "/x/ok/", isDir: true },
          { label: 42, value: "/x/bad/" }, // non-string label → drop
          { value: "/x/missing-label/" }, // missing label → drop
          "nope", // not an object → drop
        ],
      }),
    ) as unknown as typeof fetch;

    expect(await fetchPathCompletions("/x", "")).toEqual([
      { label: "ok/", value: "/x/ok/", isDir: true },
    ]);

    globalThis.fetch = mock(async () =>
      makeResponse(200, { completions: "not-an-array" }),
    ) as unknown as typeof fetch;
    expect(await fetchPathCompletions("/x", "")).toEqual([]);
  });

  test("returns [] on a non-OK response or a thrown fetch", async () => {
    globalThis.fetch = mock(async () => makeResponse(500, {})) as unknown as typeof fetch;
    expect(await fetchPathCompletions("/x", "")).toEqual([]);

    globalThis.fetch = mock(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchPathCompletions("/x", "")).toEqual([]);
  });
});
