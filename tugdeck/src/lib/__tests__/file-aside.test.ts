/**
 * file-aside.test.ts — key derivation, parse/validate, and the
 * hash-chained aside writer, with `file-io` mocked so writes are
 * deterministic.
 */

import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test";

interface WriteCall {
  path: string;
  content: string;
  baselineSha256: string | null;
  delete: boolean;
}

const io = {
  writes: [] as WriteCall[],
  // Queue of outcomes the mocked writeFileToDisk returns, in order.
  outcomes: [] as unknown[],
  readOutcome: null as unknown,
};

mock.module("@/lib/file-io", () => ({
  readFileFromDisk: async () => io.readOutcome,
  writeFileToDisk: async (req: {
    path: string;
    content: string;
    baselineSha256: string | null;
    delete?: boolean;
  }) => {
    io.writes.push({
      path: req.path,
      content: req.content,
      baselineSha256: req.baselineSha256,
      delete: req.delete === true,
    });
    return io.outcomes.shift() ?? { ok: true, sha256: "sha-next", mtimeMs: 0 };
  },
}));

let mod: typeof import("@/lib/file-aside");
beforeAll(async () => {
  mod = await import("@/lib/file-aside");
});

beforeEach(() => {
  io.writes = [];
  io.outcomes = [];
  io.readOutcome = null;
});

function record(over?: Partial<import("@/lib/file-aside").AsideRecord>) {
  return {
    version: 1,
    path: "/abs/notes.txt",
    draftId: null,
    content: "hello\n",
    lineEnding: "LF" as const,
    baselineSha256: "base-sha",
    editedAt: 111,
    ...over,
  };
}

describe("aside key derivation", () => {
  test("is deterministic and distinct per path", () => {
    expect(mod.asidePathFor("/a/b.txt")).toBe(mod.asidePathFor("/a/b.txt"));
    expect(mod.asidePathFor("/a/b.txt")).not.toBe(mod.asidePathFor("/a/c.txt"));
    expect(mod.asidePathFor("/a/b.txt")).toMatch(
      /Autosave Information\/aside-[0-9a-f]{16}\.json$/,
    );
  });

  test("untitled keys by draftId", () => {
    expect(mod.asidePathForUntitled("draft-9")).toBe(
      "~/Library/Application Support/Tug/Autosave Information/aside-untitled-draft-9.json",
    );
  });

  test("fnv1a64 matches the known empty-string vector", () => {
    // FNV-1a 64 offset basis for the empty input.
    expect(mod.fnv1a64Hex("")).toBe("cbf29ce484222325");
  });
});

describe("parseAside", () => {
  test("accepts a well-formed record for the expected path", () => {
    const json = JSON.stringify(record());
    expect(mod.parseAside(json, { path: "/abs/notes.txt" })).not.toBeNull();
  });

  test("rejects a wrong-path payload (collision safety)", () => {
    const json = JSON.stringify(record());
    expect(mod.parseAside(json, { path: "/abs/OTHER.txt" })).toBeNull();
  });

  test("rejects a wrong version", () => {
    const json = JSON.stringify(record({ version: 2 }));
    expect(mod.parseAside(json, { path: "/abs/notes.txt" })).toBeNull();
  });

  test("rejects unparseable json and bad line endings", () => {
    expect(mod.parseAside("{not json", { path: "/x" })).toBeNull();
    const bad = JSON.stringify(record({ lineEnding: "LFCR" as never }));
    expect(mod.parseAside(bad, { path: "/abs/notes.txt" })).toBeNull();
  });

  test("matches untitled records by draftId", () => {
    const json = JSON.stringify(
      record({ path: null, draftId: "d1", baselineSha256: null }),
    );
    expect(mod.parseAside(json, { draftId: "d1" })).not.toBeNull();
    expect(mod.parseAside(json, { draftId: "d2" })).toBeNull();
  });
});

describe("readAside", () => {
  test("valid → record with the aside's own sha", async () => {
    io.readOutcome = {
      ok: true,
      file: { path: "p", content: JSON.stringify(record()), sha256: "aside-sha" },
    };
    const result = await mod.readAside("aside-path", { path: "/abs/notes.txt" });
    expect(result.kind).toBe("record");
    if (result.kind === "record") {
      expect(result.sha256).toBe("aside-sha");
      expect(result.record.content).toBe("hello\n");
    }
  });

  test("wrong-path payload → invalid (deletable)", async () => {
    io.readOutcome = {
      ok: true,
      file: { path: "p", content: JSON.stringify(record()), sha256: "s" },
    };
    const result = await mod.readAside("aside-path", { path: "/abs/OTHER.txt" });
    expect(result.kind).toBe("invalid");
  });

  test("not_found / too_large → unreadable (never delete)", async () => {
    io.readOutcome = { ok: false, error: "not_found" };
    expect((await mod.readAside("p", { path: "/x" })).kind).toBe("unreadable");
    io.readOutcome = { ok: false, error: "too_large" };
    expect((await mod.readAside("p", { path: "/x" })).kind).toBe("unreadable");
  });
});

describe("AsideWriter hash chain", () => {
  test("first write is create-new; chain carries the returned sha", async () => {
    io.outcomes = [{ ok: true, sha256: "w1", mtimeMs: 0 }];
    const writer = new mod.AsideWriter("aside-path");
    await writer.write(record());
    expect(io.writes[0].baselineSha256).toBeNull();

    io.outcomes = [{ ok: true, sha256: "w2", mtimeMs: 0 }];
    await writer.write(record({ content: "hello2\n" }));
    expect(io.writes[1].baselineSha256).toBe("w1");
  });

  test("a conflict on write retries with the reported disk hash", async () => {
    io.outcomes = [
      { ok: false, error: "conflict", diskSha256: "stale" },
      { ok: true, sha256: "w-after", mtimeMs: 0 },
    ];
    const writer = new mod.AsideWriter("aside-path");
    const outcome = await writer.write(record());
    expect(outcome.ok).toBe(true);
    expect(io.writes).toHaveLength(2);
    expect(io.writes[1].baselineSha256).toBe("stale");

    // Chain now seeded from the successful retry.
    io.outcomes = [{ ok: true, sha256: "w-next", mtimeMs: 0 }];
    await writer.write(record());
    expect(io.writes[2].baselineSha256).toBe("w-after");
  });

  test("delete is conditional and resets the chain", async () => {
    io.outcomes = [{ ok: true, sha256: "w1", mtimeMs: 0 }];
    const writer = new mod.AsideWriter("aside-path");
    await writer.write(record());

    io.outcomes = [{ ok: true, deleted: true }];
    await writer.delete();
    const del = io.writes[1];
    expect(del.delete).toBe(true);
    expect(del.baselineSha256).toBe("w1");

    // After delete, the next write is create-new again.
    io.outcomes = [{ ok: true, sha256: "w2", mtimeMs: 0 }];
    await writer.write(record());
    expect(io.writes[2].baselineSha256).toBeNull();
  });
});
