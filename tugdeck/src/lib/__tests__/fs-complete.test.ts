/**
 * fs-complete.test.ts — pure-logic coverage for the directory-completion
 * client: the request URL it builds, entry coercion, and best-effort
 * degradation to `[]` on a non-OK response or transport error.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchDirectoryCompletions } from "@/lib/fs-complete";

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

describe("fetchDirectoryCompletions", () => {
  test("encodes base + partial into the query and returns valid entries", async () => {
    let calledUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      calledUrl = String(url);
      return makeResponse(200, {
        completions: [
          { label: "private/", value: "/proj/private/" },
          { label: "public/", value: "/proj/public/" },
        ],
      });
    }) as unknown as typeof fetch;

    const out = await fetchDirectoryCompletions("/proj", "p i");
    expect(calledUrl).toBe("/api/fs/complete?base=%2Fproj&partial=p%20i");
    expect(out).toEqual([
      { label: "private/", value: "/proj/private/" },
      { label: "public/", value: "/proj/public/" },
    ]);
  });

  test("drops malformed entries and tolerates a non-array payload", async () => {
    globalThis.fetch = mock(async () =>
      makeResponse(200, {
        completions: [
          { label: "ok/", value: "/x/ok/" },
          { label: 42, value: "/x/bad/" }, // non-string label → drop
          { value: "/x/missing-label/" }, // missing label → drop
          "nope", // not an object → drop
        ],
      }),
    ) as unknown as typeof fetch;

    expect(await fetchDirectoryCompletions("/x", "")).toEqual([
      { label: "ok/", value: "/x/ok/" },
    ]);

    globalThis.fetch = mock(async () =>
      makeResponse(200, { completions: "not-an-array" }),
    ) as unknown as typeof fetch;
    expect(await fetchDirectoryCompletions("/x", "")).toEqual([]);
  });

  test("returns [] on a non-OK response or a thrown fetch", async () => {
    globalThis.fetch = mock(async () => makeResponse(500, {})) as unknown as typeof fetch;
    expect(await fetchDirectoryCompletions("/x", "")).toEqual([]);

    globalThis.fetch = mock(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchDirectoryCompletions("/x", "")).toEqual([]);
  });
});
