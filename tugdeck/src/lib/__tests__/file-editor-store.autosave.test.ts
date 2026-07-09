/**
 * file-editor-store.autosave.test.ts — the in-flight-write reflush.
 *
 * An edit (or a line-ending change) that lands while a write is in
 * flight must NOT be lost: the in-flight write snapshotted stale
 * content, so on settle the store re-flushes the current buffer instead
 * of reporting "clean". Verified deterministically by mocking `file-io`
 * so the test controls exactly when each write resolves.
 */

import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test";

interface PendingWrite {
  content: string;
  baselineSha256: string | null;
  resolve: (outcome: unknown) => void;
}

const io = {
  writes: [] as PendingWrite[],
  readContent: "one two\n",
};

mock.module("@/lib/file-io", () => ({
  readFileFromDisk: async (path: string) => ({
    ok: true,
    file: {
      path,
      content: io.readContent,
      sha256: "sha-read",
      size: io.readContent.length,
      mtimeMs: 0,
      readOnly: false,
    },
  }),
  writeFileToDisk: (req: { content: string; baselineSha256: string | null }) =>
    new Promise<unknown>((resolve) => {
      io.writes.push({ content: req.content, baselineSha256: req.baselineSha256, resolve });
    }),
}));

let FileEditorStore: typeof import("@/lib/file-editor-store").FileEditorStore;
beforeAll(async () => {
  ({ FileEditorStore } = await import("@/lib/file-editor-store"));
});

function bridge(getText: () => string) {
  return {
    getText,
    replaceText: () => {},
    getPositions: () => ({ anchor: { line: 1, ch: 0 }, scrollTop: 0 }),
    applyPositions: () => {},
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("FileEditorStore in-flight-write reflush", () => {
  beforeEach(() => {
    io.writes = [];
  });

  test("an edit during an in-flight write is re-flushed, not lost", async () => {
    let buf = "one two\n";
    io.readContent = buf;
    const store = new FileEditorStore();
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");

    // Edit → flush → write #1 in flight (captured "…THREE\n").
    buf = "one two THREE\n";
    store.noteEdit();
    void store.flush();
    await tick();
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0].content).toBe("one two THREE\n");

    // A second edit lands WHILE write #1 is still pending.
    buf = "one two THREE four\n";
    store.noteEdit();

    // Resolve #1 → the store must re-flush the current buffer as #2,
    // conditioned on #1's returned hash — not report "clean".
    io.writes[0].resolve({ ok: true, sha256: "sha1", mtimeMs: 1 });
    await tick();
    expect(io.writes).toHaveLength(2);
    expect(io.writes[1].content).toBe("one two THREE four\n");
    expect(io.writes[1].baselineSha256).toBe("sha1");

    io.writes[1].resolve({ ok: true, sha256: "sha2", mtimeMs: 2 });
    await tick();
    expect(store.getSnapshot().saveState).toBe("clean");
    store.dispose();
  });

  test("setLineEnding during an in-flight write re-serializes on settle", async () => {
    let buf = "a\nb\n";
    io.readContent = buf;
    const store = new FileEditorStore();
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt"); // detects LF

    buf = "a\nb\nc\n";
    store.noteEdit();
    void store.flush();
    await tick();
    expect(io.writes[0].content).toBe("a\nb\nc\n");

    // Change the line ending while write #1 is pending.
    store.setLineEnding("CRLF");

    io.writes[0].resolve({ ok: true, sha256: "sha1", mtimeMs: 1 });
    await tick();
    expect(io.writes).toHaveLength(2);
    expect(io.writes[1].content).toBe("a\r\nb\r\nc\r\n");

    io.writes[1].resolve({ ok: true, sha256: "sha2", mtimeMs: 2 });
    await tick();
    expect(store.getSnapshot().lineEnding).toBe("CRLF");
    expect(store.getSnapshot().saveState).toBe("clean");
    store.dispose();
  });
});
