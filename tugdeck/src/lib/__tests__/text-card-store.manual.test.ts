/**
 * text-card-store.manual.test.ts — manual save mode: dirty transitions,
 * aside flush targeting, untitled buffers, and open-time aside restore.
 *
 * `file-io` is mocked with a faithful in-memory filesystem (conditional
 * writes, create-new, delete) so both the store's real-file path and the
 * aside writer's path are exercised deterministically. Reads/writes are
 * keyed by path, so a test can assert exactly which file was touched.
 */

import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test";

interface WriteCall {
  path: string;
  content: string;
  baselineSha256: string | null;
  delete: boolean;
}

const io = {
  files: new Map<string, { content: string; sha256: string; readOnly: boolean }>(),
  writes: [] as WriteCall[],
  // When set, the next non-delete write to any path fails with this
  // transport error (models a `denied`/`error`/network failure the plain
  // conditional-write fake can't otherwise produce).
  writeError: null as string | null,
};

const shaOf = (content: string): string => `sha:${content}`;

mock.module("@/lib/file-io", () => ({
  readFileFromDisk: async (path: string) => {
    const file = io.files.get(path);
    if (!file) return { ok: false, error: "not_found" };
    return {
      ok: true,
      file: {
        path,
        content: file.content,
        sha256: file.sha256,
        size: file.content.length,
        mtimeMs: 0,
        readOnly: file.readOnly,
      },
    };
  },
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
    if (io.writeError !== null && req.delete !== true) {
      const error = io.writeError;
      io.writeError = null;
      return { ok: false, error };
    }
    const existing = io.files.get(req.path);
    if (existing && req.baselineSha256 === null) {
      return { ok: false, error: "conflict", diskSha256: existing.sha256 };
    }
    if (existing && req.baselineSha256 !== existing.sha256) {
      return { ok: false, error: "conflict", diskSha256: existing.sha256 };
    }
    if (!existing && req.baselineSha256 !== null) {
      return { ok: false, error: "missing" };
    }
    if (req.delete === true) {
      io.files.delete(req.path);
      return { ok: true, sha256: "", mtimeMs: 0 };
    }
    const sha = shaOf(req.content);
    io.files.set(req.path, {
      content: req.content,
      sha256: sha,
      readOnly: existing?.readOnly ?? false,
    });
    return { ok: true, sha256: sha, mtimeMs: 0 };
  },
}));

let TextCardStore: typeof import("@/lib/text-card-store").TextCardStore;
let asidePathFor: typeof import("@/lib/file-aside").asidePathFor;
let asidePathForUntitled: typeof import("@/lib/file-aside").asidePathForUntitled;
beforeAll(async () => {
  ({ TextCardStore } = await import("@/lib/text-card-store"));
  ({ asidePathFor, asidePathForUntitled } = await import("@/lib/file-aside"));
});

function bridge(getText: () => string, onReplace?: (t: string) => void) {
  return {
    getText,
    replaceText: (t: string) => onReplace?.(t),
    getPositions: () => ({ anchor: { line: 1, ch: 0 }, scrollTop: 0 }),
    applyPositions: () => {},
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

type FrameEvent = { kind: string; path?: string; from?: string; to?: string };

/** Feed a synthetic FILESYSTEM frame to a store (paths are absolute). */
function fsFrameEvents(
  store: InstanceType<typeof TextCardStore>,
  events: FrameEvent[],
) {
  const rel = (p?: string) => (p === undefined ? undefined : p.replace(/^\//, ""));
  const payload = new TextEncoder().encode(
    JSON.stringify({
      workspace_key: "/",
      events: events.map((e) => ({
        kind: e.kind,
        path: rel(e.path),
        from: rel(e.from),
        to: rel(e.to),
      })),
    }),
  );
  (store as unknown as { _onFilesystemFrame(p: Uint8Array): void })._onFilesystemFrame(
    payload,
  );
}

/** Feed a single-event FILESYSTEM frame naming `fullPath`. */
function fsFrame(
  store: InstanceType<typeof TextCardStore>,
  fullPath: string,
  kind = "modified",
) {
  fsFrameEvents(store, [{ kind, path: fullPath }]);
}

function seedDisk(path: string, content: string, readOnly = false) {
  io.files.set(path, { content, sha256: shaOf(content), readOnly });
}
function seedAside(path: string, record: Record<string, unknown>) {
  const json = JSON.stringify(record);
  io.files.set(path, { content: json, sha256: shaOf(json), readOnly: false });
}

beforeEach(() => {
  io.files = new Map();
  io.writes = [];
  io.writeError = null;
});

describe("manual mode — dirty + aside flush target", () => {
  test("default mode is automatic; manual is opt-in", () => {
    expect(new TextCardStore().getSnapshot().saveMode).toBe("automatic");
    expect(
      new TextCardStore({ saveMode: "manual" }).getSnapshot().saveMode,
    ).toBe("manual");
  });

  test("an edit writes the aside, never the real file", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    expect(store.getSnapshot().saveState).toBe("clean");

    buf = "disk edited\n";
    store.noteEdit();
    expect(store.getSnapshot().saveState).toBe("editing");
    await store.flush();
    await tick();

    // Real file untouched; buffer stays dirty.
    expect(io.files.get("/f.txt")!.content).toBe("disk\n");
    expect(store.getSnapshot().saveState).toBe("editing");
    // Aside carries the edit + its baseline.
    const aside = io.files.get(asidePathFor("/f.txt"));
    expect(aside).toBeDefined();
    const rec = JSON.parse(aside!.content);
    expect(rec.content).toBe("disk edited\n");
    expect(rec.baselineSha256).toBe(shaOf("disk\n"));
    // The only real-path we ever touched is the aside.
    expect(io.writes.every((w) => w.path === asidePathFor("/f.txt"))).toBe(true);
  });

  test("a rebind (saveAs) preserves the manual mode", async () => {
    seedDisk("/a.txt", "content\n");
    let buf = "content\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/a.txt");
    buf = "content edited\n";
    store.noteEdit();
    await store.saveAs("/b.txt");
    expect(store.getSnapshot().saveMode).toBe("manual");
    expect(store.getSnapshot().path).toBe("/b.txt");
  });

  test("saveAs rebinds in place — phase never leaves ready (no flash)", async () => {
    seedDisk("/old.txt", "content\n");
    seedDisk("/target.txt", "existing target\n");
    let buf = "content\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/old.txt");
    buf = "content edited\n";
    store.noteEdit();
    // Record every phase the snapshot passes through during the Save As.
    // A drop to "loading"/"empty" unmounts the live editor (losing undo,
    // caret, scroll) and flashes the chooser in the card.
    const phases: string[] = [];
    const unsub = store.subscribe(() => phases.push(store.getSnapshot().phase));
    // Target exists (the NSSavePanel Replace flow): create-new conflicts,
    // the retry overwrites.
    expect(await store.saveAs("/target.txt")).toBe("ok");
    unsub();
    expect(phases.every((p) => p === "ready")).toBe(true);
    const snap = store.getSnapshot();
    expect(snap.path).toBe("/target.txt");
    expect(snap.fileName).toBe("target.txt");
    expect(snap.saveState).toBe("clean");
    expect(io.files.get("/target.txt")!.content).toBe("content edited\n");
    // The next save round-trips against the rebound baseline: one clean
    // conditional write, no spurious conflict.
    buf = "content edited more\n";
    store.noteEdit();
    expect(await store.save()).toBe("ok");
    expect(io.files.get("/target.txt")!.content).toBe("content edited more\n");
  });

  test("saveAs reports 'ok' once the buffer reaches disk", async () => {
    let buf = "hello\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openUntitled("draft-1");
    buf = "hello\n";
    store.noteEdit();
    expect(await store.saveAs("/new.txt")).toBe("ok");
    expect(io.files.get("/new.txt")!.content).toBe("hello\n");
  });

  test("saveAs surfaces a write failure instead of swallowing it", async () => {
    // A swallowed failure here is the data-loss path: a close guard that
    // reads saveAs as success would destroy the card over unsaved edits.
    let buf = "hello\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openUntitled("draft-2");
    buf = "hello\n";
    store.noteEdit();
    io.writeError = "denied";
    expect(await store.saveAs("/nope.txt")).toBe("error");
    expect(io.files.has("/nope.txt")).toBe(false);
  });

  test("a double save issues one real write, not a spurious conflict", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "edited\n";
    store.noteEdit();
    // Two concurrent saves (double ⌘S / menu racing keyboard). Without the
    // single-flight latch the second reissues a write against the stale
    // baseline the first just changed → a 409 conflict for our own bytes.
    const [r1, r2] = await Promise.all([store.save(), store.save()]);
    expect(r1).toBe("ok");
    expect(r2).toBe("ok");
    const realWrites = io.writes.filter((w) => w.path === "/f.txt" && !w.delete);
    expect(realWrites.length).toBe(1);
    expect(store.getSnapshot().conflict).toBeNull();
    expect(store.getSnapshot().saveState).toBe("clean");
  });

  test("setLineEnding during an in-flight save re-flushes, staying dirty", async () => {
    seedDisk("/f.txt", "a\nb\n");
    let buf = "a\nb\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "a\nb\nc\n";
    store.noteEdit();
    const saving = store.save(); // now in "writing"
    expect(store.getSnapshot().saveState).toBe("writing");
    store.setLineEnding("CRLF"); // must not be dropped mid-save
    await saving;
    // The write serialized the old ending, so the buffer stays dirty with
    // the new ending recorded — never clean-with-the-wrong-ending on disk.
    expect(store.getSnapshot().lineEnding).toBe("CRLF");
    expect(store.getSnapshot().saveState).toBe("editing");
  });

  test("resolveMissing recreates a deleted file", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "edited\n";
    store.noteEdit();
    io.files.delete("/f.txt");
    await store.refreshFromDisk();
    expect(store.getSnapshot().conflict?.reason).toBe("missing");
    expect(await store.resolveMissing()).toBe("ok");
    expect(io.files.get("/f.txt")!.content).toBe("edited\n");
    expect(store.getSnapshot().conflict).toBeNull();
  });

  test("resolveMissing conflicts instead of clobbering a reappeared file", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "edited\n";
    store.noteEdit();
    io.files.delete("/f.txt");
    await store.refreshFromDisk();
    expect(store.getSnapshot().conflict?.reason).toBe("missing");
    // Another process recreated the file meanwhile.
    seedDisk("/f.txt", "FOREIGN\n");
    expect(await store.resolveMissing()).toBe("conflict");
    expect(store.getSnapshot().conflict?.reason).toBe("hash");
    expect(io.files.get("/f.txt")!.content).toBe("FOREIGN\n"); // not clobbered
  });

  test("conflict reload clears the armed debounce (no aside resurrection)", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "mine\n";
    store.noteEdit();
    await store.flush();
    await tick();
    seedDisk("/f.txt", "theirs\n");
    await store.recheckOnActivation();
    expect(store.getSnapshot().conflict?.reason).toBe("hash");
    // Typing during the cancelled conflict arms the aside debounce; the
    // reload must clear it, or a late fire recreates the aside holding the
    // edits the user just discarded.
    buf = "mine plus more\n";
    store.noteEdit();
    await store.resolveConflict("reload");
    const timer = (store as unknown as { _debounceTimer: unknown })._debounceTimer;
    expect(timer).toBeNull();
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
    expect(store.getSnapshot().saveState).toBe("clean");
  });

  test("a missing conflict on a clean buffer goes dirty on the next edit", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    // File deleted under a CLEAN buffer — the watcher path sets the
    // conflict without touching saveState.
    io.files.delete("/f.txt");
    fsFrame(store, "/f.txt", "Removed");
    await tick();
    expect(store.getSnapshot().conflict?.reason).toBe("missing");
    expect(store.getSnapshot().saveState).toBe("clean");
    // The user cancels the sheet and types: the buffer must read dirty and
    // the aside must capture — otherwise the close guard sees clean and
    // destroys the edits silently.
    buf = "typed after cancel\n";
    store.noteEdit();
    expect(store.getSnapshot().saveState).toBe("editing");
    await store.flush();
    await tick();
    const aside = JSON.parse(io.files.get(asidePathFor("/f.txt"))!.content);
    expect(aside.content).toBe("typed after cancel\n");
  });

  test("resolveMissing recreates the file even from a clean buffer", async () => {
    seedDisk("/f.txt", "disk\n");
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => "disk\n"));
    await store.openPath("/f.txt");
    io.files.delete("/f.txt");
    fsFrame(store, "/f.txt", "Removed");
    await tick();
    expect(store.getSnapshot().conflict?.reason).toBe("missing");
    expect(store.getSnapshot().saveState).toBe("clean");
    // "Save" in the missing sheet means RECREATE — it must not no-op on
    // save()'s clean short-circuit.
    expect(await store.resolveMissing()).toBe("ok");
    expect(io.files.get("/f.txt")!.content).toBe("disk\n");
    expect(store.getSnapshot().conflict).toBeNull();
    expect(store.getSnapshot().saveState).toBe("clean");
  });

  test("edits during a cancelled conflict still reach the aside", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "mine\n";
    store.noteEdit();
    await store.flush();
    await tick();
    // External change raises a hash conflict; the user cancels (leaves it set).
    seedDisk("/f.txt", "theirs\n");
    await store.recheckOnActivation();
    expect(store.getSnapshot().conflict?.reason).toBe("hash");
    // The user keeps typing during the cancelled conflict.
    buf = "mine plus more\n";
    store.noteEdit();
    await store.flush();
    await tick();
    // The aside captured the new edits (crash-safety) — real file untouched.
    const aside = JSON.parse(io.files.get(asidePathFor("/f.txt"))!.content);
    expect(aside.content).toBe("mine plus more\n");
    expect(io.files.get("/f.txt")!.content).toBe("theirs\n");
  });
});

describe("manual mode — open-time aside restore", () => {
  test("matching baseline restores the aside silently, dirty", async () => {
    seedDisk("/f.txt", "disk\n");
    seedAside(asidePathFor("/f.txt"), {
      version: 1,
      path: "/f.txt",
      draftId: null,
      content: "my edits\n",
      lineEnding: "LF",
      baselineSha256: shaOf("disk\n"),
      editedAt: 1,
    });
    let buf = "";
    const replaced: string[] = [];
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t) && replaced.push(t)));
    await store.openPath("/f.txt");

    expect(store.getSnapshot().saveState).toBe("editing");
    expect(store.getSnapshot().seedContent).toBe("my edits\n");
    expect(replaced).toContain("my edits\n");
  });

  test("diverged baseline surfaces pendingAsideConflict; both resolver arms", async () => {
    seedDisk("/f.txt", "disk now\n");
    seedAside(asidePathFor("/f.txt"), {
      version: 1,
      path: "/f.txt",
      draftId: null,
      content: "my edits\n",
      lineEnding: "LF",
      baselineSha256: shaOf("disk OLD\n"),
      editedAt: 1,
    });
    let buf = "";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/f.txt");

    // Buffer shows disk; the aside awaits a decision.
    expect(store.getSnapshot().saveState).toBe("clean");
    const pending = store.getSnapshot().pendingAsideConflict;
    expect(pending?.asideContent).toBe("my edits\n");

    // Keep My Changes → dirty, seeded from the aside.
    store.resolveAsideConflict("keep");
    expect(store.getSnapshot().saveState).toBe("editing");
    expect(store.getSnapshot().seedContent).toBe("my edits\n");
    expect(store.getSnapshot().pendingAsideConflict).toBeNull();
  });

  test("Use Disk Version discards the aside", async () => {
    seedDisk("/f.txt", "disk now\n");
    seedAside(asidePathFor("/f.txt"), {
      version: 1,
      path: "/f.txt",
      draftId: null,
      content: "my edits\n",
      lineEnding: "LF",
      baselineSha256: shaOf("disk OLD\n"),
      editedAt: 1,
    });
    let buf = "";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/f.txt");

    store.resolveAsideConflict("disk");
    await tick();
    expect(store.getSnapshot().pendingAsideConflict).toBeNull();
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
  });

  test("a corrupt aside is deleted; the open proceeds clean", async () => {
    seedDisk("/f.txt", "disk\n");
    // Unparseable content → corrupt → safe to delete.
    io.files.set(asidePathFor("/f.txt"), {
      content: "{ not json",
      sha256: shaOf("{ not json"),
      readOnly: false,
    });
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => "disk\n"));
    await store.openPath("/f.txt");
    await tick();
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
  });

  test("a foreign (wrong-path) aside is preserved, not deleted", async () => {
    seedDisk("/f.txt", "disk\n");
    // A valid aside keyed to a different path is a key collision belonging
    // to another document — leave it on disk, open clean, don't restore it.
    seedAside(asidePathFor("/f.txt"), {
      version: 1,
      path: "/OTHER.txt",
      draftId: null,
      content: "junk\n",
      lineEnding: "LF",
      baselineSha256: shaOf("x"),
      editedAt: 1,
    });
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => "disk\n"));
    await store.openPath("/f.txt");
    await tick();
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(true);
  });
});

describe("manual mode — untitled buffers", () => {
  test("untitled writes only the aside; restores by draftId", async () => {
    let buf = "";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openUntitled("d1");
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("ready");
    expect(snap.path).toBeNull();
    expect(snap.untitled).toBe(true);
    expect(snap.fileName).toBe("Untitled");

    buf = "hello\n";
    store.noteEdit();
    await store.flush();
    await tick();

    const asidePath = asidePathForUntitled("d1");
    expect(io.files.has(asidePath)).toBe(true);
    // No file anywhere but the aside.
    expect(io.writes.every((w) => w.path === asidePath)).toBe(true);

    // A fresh store restores the untitled buffer from the aside.
    let buf2 = "";
    const replaced: string[] = [];
    const store2 = new TextCardStore({ saveMode: "manual" });
    store2.attachEditor(bridge(() => buf2, (t) => replaced.push(t)));
    await store2.openUntitled("d1");
    expect(store2.getSnapshot().saveState).toBe("editing");
    expect(store2.getSnapshot().seedContent).toBe("hello\n");
    expect(replaced).toContain("hello\n");
  });
});

describe("manual mode — save verbs", () => {
  test("save() writes the real file, deletes the aside, goes clean", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");

    buf = "saved content\n";
    store.noteEdit();
    await store.flush(); // writes aside
    await tick();
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(true);

    const result = await store.save();
    expect(result).toBe("ok");
    expect(io.files.get("/f.txt")!.content).toBe("saved content\n");
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
  });

  test("save() on an untitled buffer asks the card for a path", async () => {
    const store = new TextCardStore({ saveMode: "manual" });
    let buf = "";
    store.attachEditor(bridge(() => buf));
    await store.openUntitled("d1");
    buf = "hi\n";
    store.noteEdit();
    expect(await store.save()).toBe("needs-path");
  });

  test("save() on a stale baseline yields a conflict, keeping the aside", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "my edit\n";
    store.noteEdit();
    await store.flush();
    await tick();

    // Someone else changes disk out from under us.
    seedDisk("/f.txt", "foreign\n");
    const result = await store.save();
    expect(result).toBe("conflict");
    expect(store.getSnapshot().conflict?.reason).toBe("hash");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(true);
    // Real file NOT overwritten.
    expect(io.files.get("/f.txt")!.content).toBe("foreign\n");
  });

  test("resolveConflict('overwrite') writes the REAL file, not the aside ([P12])", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "my edit\n";
    store.noteEdit();
    await store.flush();
    await tick();
    seedDisk("/f.txt", "foreign\n");
    await store.save(); // raises hash conflict
    expect(store.getSnapshot().conflict?.reason).toBe("hash");

    io.writes = []; // isolate the overwrite's writes
    await store.resolveConflict("overwrite");

    // The overwrite hit the REAL path (never the aside path).
    const realWrites = io.writes.filter(
      (w) => w.path === "/f.txt" && !w.delete,
    );
    expect(realWrites).toHaveLength(1);
    expect(io.files.get("/f.txt")!.content).toBe("my edit\n");
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
  });

  test("resolveConflict('reload') discards edits + aside, reloads disk", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/f.txt");
    buf = "my edit\n";
    store.noteEdit();
    await store.flush();
    await tick();
    seedDisk("/f.txt", "foreign\n");
    await store.save();
    await store.resolveConflict("reload");

    expect(store.getSnapshot().saveState).toBe("clean");
    expect(store.getSnapshot().conflict).toBeNull();
    expect(buf).toBe("foreign\n"); // buffer reloaded from disk
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
  });

  test("saveACopy() writes elsewhere without touching state or the aside", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/f.txt");
    buf = "my edit\n";
    store.noteEdit();
    await store.flush();
    await tick();

    expect(await store.saveACopy("/copy.txt")).toBe("ok");
    expect(io.files.get("/copy.txt")!.content).toBe("my edit\n");
    // Original binding + dirty + aside all unchanged.
    expect(store.getSnapshot().path).toBe("/f.txt");
    expect(store.getSnapshot().saveState).toBe("editing");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(true);
  });

  test("revertToSaved() drops edits and the aside", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/f.txt");
    buf = "my edit\n";
    store.noteEdit();
    await store.flush();
    await tick();

    await store.revertToSaved();
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(buf).toBe("disk\n");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
  });

  test("a watcher frame while dirty raises the conflict without a write", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/f.txt");
    buf = "my edit\n";
    store.noteEdit();
    await store.flush();
    await tick();

    // Disk changes externally; the watcher frame arrives.
    seedDisk("/f.txt", "foreign\n");
    io.writes = [];
    fsFrame(store, "/f.txt");
    await tick();

    expect(store.getSnapshot().conflict?.reason).toBe("hash");
    // No real-file write happened as a side effect.
    expect(io.writes.filter((w) => w.path === "/f.txt" && !w.delete)).toHaveLength(0);
  });
});

describe("rename-follow ([P05])", () => {
  test("an explicit Renamed{from,to} rebinds the card", async () => {
    seedDisk("/a.txt", "body\n");
    let buf = "body\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/a.txt");
    fsFrameEvents(store, [{ kind: "Renamed", from: "/a.txt", to: "/b.txt" }]);
    await tick();
    expect(store.getSnapshot().path).toBe("/b.txt");
    expect(store.getSnapshot().fileName).toBe("b.txt");
  });

  test("a Removed+Created batch adopts the hash-matching creation, preserving dirty", async () => {
    seedDisk("/a.txt", "body\n");
    let buf = "body\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/a.txt");
    // Dirty: edits live only in the buffer; the moved file still hashes
    // to the last-saved baseline.
    buf = "body edited\n";
    store.noteEdit();
    await store.flush();
    await tick();

    // macOS: the file moves to /moved.txt (same bytes, different dir).
    seedDisk("/moved.txt", "body\n");
    io.files.delete("/a.txt");
    fsFrameEvents(store, [
      { kind: "Removed", path: "/a.txt" },
      { kind: "Created", path: "/moved.txt" },
    ]);
    await tick();

    expect(store.getSnapshot().path).toBe("/moved.txt");
    expect(store.getSnapshot().saveState).toBe("editing"); // dirty preserved
    // Aside re-keyed to the new path.
    expect(io.files.has(asidePathFor("/moved.txt"))).toBe(true);
  });

  test("an ambiguous / non-matching batch falls to the missing-file flow", async () => {
    seedDisk("/a.txt", "body\n");
    let buf = "body\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/a.txt");

    // Two unrelated creations, neither hash-matching → no adoption.
    seedDisk("/x.txt", "different\n");
    seedDisk("/y.txt", "other\n");
    io.files.delete("/a.txt");
    fsFrameEvents(store, [
      { kind: "Removed", path: "/a.txt" },
      { kind: "Created", path: "/x.txt" },
      { kind: "Created", path: "/y.txt" },
    ]);
    await tick();

    expect(store.getSnapshot().path).toBe("/a.txt"); // not rebound
    expect(store.getSnapshot().conflict?.reason).toBe("missing");
  });
});

describe("recheckOnActivation ([P09])", () => {
  test("clean + diverged disk → silent reload", async () => {
    seedDisk("/f.txt", "v1\n");
    let buf = "v1\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/f.txt");

    seedDisk("/f.txt", "v2 external\n");
    await store.recheckOnActivation();
    expect(buf).toBe("v2 external\n");
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(store.getSnapshot().conflict).toBeNull();
  });

  test("manual + dirty + diverged disk → conflict", async () => {
    seedDisk("/f.txt", "v1\n");
    let buf = "v1\n";
    const store = new TextCardStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/f.txt");
    buf = "my edit\n";
    store.noteEdit();
    await store.flush();
    await tick();

    seedDisk("/f.txt", "external\n");
    await store.recheckOnActivation();
    expect(store.getSnapshot().conflict?.reason).toBe("hash");
    expect(buf).toBe("my edit\n"); // buffer untouched
  });
});

describe("automatic mode — unchanged", () => {
  test("an edit writes the real file and no aside", async () => {
    seedDisk("/a.txt", "x\n");
    let buf = "x\n";
    const store = new TextCardStore();
    store.attachEditor(bridge(() => buf));
    await store.openPath("/a.txt");

    buf = "x edited\n";
    store.noteEdit();
    await store.flush();
    await tick();

    expect(io.files.get("/a.txt")!.content).toBe("x edited\n");
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(io.files.has(asidePathFor("/a.txt"))).toBe(false);
  });
});
