/**
 * file-editor-store.manual.test.ts — manual save mode: dirty transitions,
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

let FileEditorStore: typeof import("@/lib/file-editor-store").FileEditorStore;
let asidePathFor: typeof import("@/lib/file-aside").asidePathFor;
let asidePathForUntitled: typeof import("@/lib/file-aside").asidePathForUntitled;
beforeAll(async () => {
  ({ FileEditorStore } = await import("@/lib/file-editor-store"));
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
  store: InstanceType<typeof FileEditorStore>,
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
  store: InstanceType<typeof FileEditorStore>,
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
});

describe("manual mode — dirty + aside flush target", () => {
  test("default mode is automatic; manual is opt-in", () => {
    expect(new FileEditorStore().getSnapshot().saveMode).toBe("automatic");
    expect(
      new FileEditorStore({ saveMode: "manual" }).getSnapshot().saveMode,
    ).toBe("manual");
  });

  test("an edit writes the aside, never the real file", async () => {
    seedDisk("/f.txt", "disk\n");
    let buf = "disk\n";
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf));
    await store.openPath("/a.txt");
    buf = "content edited\n";
    store.noteEdit();
    await store.saveAs("/b.txt");
    expect(store.getSnapshot().saveMode).toBe("manual");
    expect(store.getSnapshot().path).toBe("/b.txt");
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => buf, (t) => (buf = t)));
    await store.openPath("/f.txt");

    store.resolveAsideConflict("disk");
    await tick();
    expect(store.getSnapshot().pendingAsideConflict).toBeNull();
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
  });

  test("an invalid aside is deleted; the open proceeds clean", async () => {
    seedDisk("/f.txt", "disk\n");
    // Aside keyed to a different path → invalid on read.
    seedAside(asidePathFor("/f.txt"), {
      version: 1,
      path: "/OTHER.txt",
      draftId: null,
      content: "junk\n",
      lineEnding: "LF",
      baselineSha256: shaOf("x"),
      editedAt: 1,
    });
    const store = new FileEditorStore({ saveMode: "manual" });
    store.attachEditor(bridge(() => "disk\n"));
    await store.openPath("/f.txt");
    await tick();
    expect(store.getSnapshot().saveState).toBe("clean");
    expect(io.files.has(asidePathFor("/f.txt"))).toBe(false);
  });
});

describe("manual mode — untitled buffers", () => {
  test("untitled writes only the aside; restores by draftId", async () => {
    let buf = "";
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store2 = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore({ saveMode: "manual" });
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
    const store = new FileEditorStore();
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
