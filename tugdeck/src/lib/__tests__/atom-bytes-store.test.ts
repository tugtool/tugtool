/**
 * `atom-bytes-store` — unit tests for the per-card image-bytes
 * side-table.
 *
 * Pure-logic coverage. The store is a `Map<string, AtomBytesEntry>`
 * with extra ceremony around snapshot / restore for state
 * preservation. These tests pin the contract specified in
 * [Spec S02](roadmap/tide-atoms.md#s02-atom-bytes-store).
 */

import { describe, expect, test } from "bun:test";

import {
  createAtomBytesStore,
  type AtomBytesEntry,
  type AtomBytesStore,
} from "../atom-bytes-store";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PNG_ENTRY: AtomBytesEntry = {
  content: "iVBORw0KGgo=",
  mediaType: "image/png",
};

const JPEG_ENTRY: AtomBytesEntry = {
  content: "/9j/4AAQSkZJ",
  mediaType: "image/jpeg",
};

const GIF_ENTRY: AtomBytesEntry = {
  content: "R0lGODlhAQABAA==",
  mediaType: "image/gif",
};

// ---------------------------------------------------------------------------
// put / get
// ---------------------------------------------------------------------------

describe("createAtomBytesStore — fresh instance", () => {
  test("starts empty", () => {
    const store = createAtomBytesStore();
    expect(store.size()).toBe(0);
    expect(store.snapshot()).toEqual({});
  });

  test("get on unknown id returns null", () => {
    const store = createAtomBytesStore();
    expect(store.get("unknown")).toBeNull();
  });
});

describe("put / get", () => {
  test("put stores an entry and get retrieves it", () => {
    const store = createAtomBytesStore();
    store.put("atom-1", PNG_ENTRY);
    expect(store.get("atom-1")).toEqual(PNG_ENTRY);
    expect(store.size()).toBe(1);
  });

  test("put is idempotent — second put with same id replaces the entry", () => {
    const store = createAtomBytesStore();
    store.put("atom-1", PNG_ENTRY);
    store.put("atom-1", JPEG_ENTRY);
    expect(store.get("atom-1")).toEqual(JPEG_ENTRY);
    expect(store.size()).toBe(1);
  });

  test("multiple distinct ids coexist", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    store.put("b", JPEG_ENTRY);
    store.put("c", GIF_ENTRY);
    expect(store.size()).toBe(3);
    expect(store.get("a")).toEqual(PNG_ENTRY);
    expect(store.get("b")).toEqual(JPEG_ENTRY);
    expect(store.get("c")).toEqual(GIF_ENTRY);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("delete", () => {
  test("delete removes a known entry; subsequent get returns null", () => {
    const store = createAtomBytesStore();
    store.put("atom-1", PNG_ENTRY);
    store.delete("atom-1");
    expect(store.get("atom-1")).toBeNull();
    expect(store.size()).toBe(0);
  });

  test("delete on unknown id is a no-op (idempotent)", () => {
    const store = createAtomBytesStore();
    store.delete("never-stored");
    store.put("atom-1", PNG_ENTRY);
    store.delete("never-stored"); // still a no-op
    expect(store.size()).toBe(1);
    expect(store.get("atom-1")).toEqual(PNG_ENTRY);
  });

  test("delete one entry leaves siblings intact", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    store.put("b", JPEG_ENTRY);
    store.delete("a");
    expect(store.get("a")).toBeNull();
    expect(store.get("b")).toEqual(JPEG_ENTRY);
  });
});

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

describe("snapshot", () => {
  test("empty store snapshot is an empty object", () => {
    const store = createAtomBytesStore();
    expect(store.snapshot()).toEqual({});
  });

  test("snapshot returns all entries keyed by id", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    store.put("b", JPEG_ENTRY);
    expect(store.snapshot()).toEqual({
      a: PNG_ENTRY,
      b: JPEG_ENTRY,
    });
  });

  test("snapshot returns a fresh object — mutations to it don't affect the store", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    const snap = store.snapshot();
    // Mutating the snapshot must not affect the live store.
    snap.a = JPEG_ENTRY;
    delete snap.a; // re-removing should still leave the live store unchanged
    snap.injected = GIF_ENTRY;
    expect(store.get("a")).toEqual(PNG_ENTRY);
    expect(store.get("injected")).toBeNull();
  });

  test("snapshot entries themselves are fresh shapes — mutating them doesn't affect the store", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    const snap = store.snapshot();
    const entry = snap.a!;
    // Direct mutation on the snapshot entry must not propagate.
    entry.content = "TAMPERED";
    expect(store.get("a")).toEqual(PNG_ENTRY);
  });

  test("snapshot is JSON-serializable", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    store.put("b", JPEG_ENTRY);
    const snap = store.snapshot();
    const round = JSON.parse(JSON.stringify(snap)) as Record<
      string,
      AtomBytesEntry
    >;
    expect(round).toEqual(snap);
  });
});

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

describe("restore", () => {
  test("restore populates a fresh empty store", () => {
    const store = createAtomBytesStore();
    store.restore({ a: PNG_ENTRY, b: JPEG_ENTRY });
    expect(store.size()).toBe(2);
    expect(store.get("a")).toEqual(PNG_ENTRY);
    expect(store.get("b")).toEqual(JPEG_ENTRY);
  });

  test("restore is additive — existing entries with non-overlapping ids survive", () => {
    const store = createAtomBytesStore();
    store.put("live-1", GIF_ENTRY);
    store.restore({ "snap-1": PNG_ENTRY });
    expect(store.size()).toBe(2);
    expect(store.get("live-1")).toEqual(GIF_ENTRY);
    expect(store.get("snap-1")).toEqual(PNG_ENTRY);
  });

  test("restore overwrites overlapping ids", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    store.restore({ a: JPEG_ENTRY });
    expect(store.get("a")).toEqual(JPEG_ENTRY);
  });

  test("restore({}) is a no-op", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    store.restore({});
    expect(store.size()).toBe(1);
    expect(store.get("a")).toEqual(PNG_ENTRY);
  });

  test("restore filters out malformed entries — missing content", () => {
    const store = createAtomBytesStore();
    store.restore({
      good: PNG_ENTRY,
      // Type-laundered through `unknown`; mirrors a corrupt snapshot
      // that survived JSON parse but doesn't match the schema.
      missingContent: { mediaType: "image/png" } as unknown as AtomBytesEntry,
    });
    expect(store.size()).toBe(1);
    expect(store.get("good")).toEqual(PNG_ENTRY);
    expect(store.get("missingContent")).toBeNull();
  });

  test("restore filters out malformed entries — missing mediaType", () => {
    const store = createAtomBytesStore();
    store.restore({
      good: PNG_ENTRY,
      missingType: { content: "abc" } as unknown as AtomBytesEntry,
    });
    expect(store.size()).toBe(1);
    expect(store.get("good")).toEqual(PNG_ENTRY);
    expect(store.get("missingType")).toBeNull();
  });

  test("restore filters out null entries", () => {
    const store = createAtomBytesStore();
    store.restore({
      good: PNG_ENTRY,
      nulled: null as unknown as AtomBytesEntry,
    });
    expect(store.size()).toBe(1);
    expect(store.get("good")).toEqual(PNG_ENTRY);
  });
});

// ---------------------------------------------------------------------------
// snapshot → restore round-trip
// ---------------------------------------------------------------------------

describe("snapshot → restore round-trip", () => {
  test("snapshot then restore on a fresh store reproduces all entries", () => {
    const src = createAtomBytesStore();
    src.put("a", PNG_ENTRY);
    src.put("b", JPEG_ENTRY);
    src.put("c", GIF_ENTRY);
    const snap = src.snapshot();

    const dest = createAtomBytesStore();
    dest.restore(snap);

    expect(dest.size()).toBe(3);
    expect(dest.get("a")).toEqual(PNG_ENTRY);
    expect(dest.get("b")).toEqual(JPEG_ENTRY);
    expect(dest.get("c")).toEqual(GIF_ENTRY);
  });

  test("snapshot → JSON.stringify → JSON.parse → restore round-trip", () => {
    const src = createAtomBytesStore();
    src.put("a", PNG_ENTRY);
    src.put("b", JPEG_ENTRY);

    const wire = JSON.stringify(src.snapshot());
    const parsed = JSON.parse(wire) as Record<string, AtomBytesEntry>;

    const dest = createAtomBytesStore();
    dest.restore(parsed);

    expect(dest.snapshot()).toEqual(src.snapshot());
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe("clear", () => {
  test("clear drops all entries", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    store.put("b", JPEG_ENTRY);
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.get("a")).toBeNull();
    expect(store.get("b")).toBeNull();
    expect(store.snapshot()).toEqual({});
  });

  test("clear on empty store is a no-op", () => {
    const store = createAtomBytesStore();
    store.clear();
    expect(store.size()).toBe(0);
  });

  test("clear then put rebuilds normally", () => {
    const store = createAtomBytesStore();
    store.put("a", PNG_ENTRY);
    store.clear();
    store.put("a", JPEG_ENTRY);
    expect(store.get("a")).toEqual(JPEG_ENTRY);
    expect(store.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Independence of instances
// ---------------------------------------------------------------------------

describe("instance independence", () => {
  test("two stores from the same factory share no state", () => {
    const a: AtomBytesStore = createAtomBytesStore();
    const b: AtomBytesStore = createAtomBytesStore();
    a.put("x", PNG_ENTRY);
    expect(b.get("x")).toBeNull();
    expect(a.size()).toBe(1);
    expect(b.size()).toBe(0);
  });
});
