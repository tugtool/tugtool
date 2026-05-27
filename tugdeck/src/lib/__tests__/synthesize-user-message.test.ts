/**
 * `synthesize-user-message` — unit tests for the shared content-block
 * → substrate synthesizer used by both the live submit path and the
 * JSONL replay path.
 *
 * Pins the contract documented in
 * [Step 5c](roadmap/tide-atoms.md#step-5c):
 *   - the (text, atoms) substrate is deterministic on its inputs
 *     given a stable resolver/minter;
 *   - the bytes-store side-effect lands `content` + `mediaType` for
 *     every image block, keyed by the resolved id;
 *   - the `atomIdAt` resolver is honored when present and falls
 *     through to fresh UUIDs otherwise;
 *   - the optional `bakeImage` stub completes asynchronously and
 *     updates the bytes-store entry's `thumbnailDataUrl` when it
 *     resolves with a non-null value.
 *
 * The default `bakeImage` uses a Web Worker which can't run in
 * bun:test, so every test that wants to verify thumbnail propagation
 * passes a stub baker (no Worker needed).
 */

import { describe, expect, test } from "bun:test";

import {
  synthesizeUserMessageFromBlocks,
} from "../synthesize-user-message";
import {
  createAtomBytesStore,
} from "../atom-bytes-store";
import { TUG_ATOM_CHAR } from "../tug-atom-img";
import type { ContentBlock } from "@/protocol";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const C = TUG_ATOM_CHAR;

const TEXT_HELLO: ContentBlock = { type: "text", text: "hello" };
const TEXT_A: ContentBlock = { type: "text", text: "a " };
const TEXT_B: ContentBlock = { type: "text", text: " b" };
const IMAGE_PNG: ContentBlock = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "PNG-BASE64" },
};
const IMAGE_JPG: ContentBlock = {
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: "JPG-BASE64" },
};

/** Deterministic UUID minter — returns `mock-uuid-N` so tests can
 *  pin atom ids without depending on `crypto.randomUUID()`. */
function makeCounter(): () => string {
  let n = 0;
  return () => {
    const id = `mock-uuid-${n}`;
    n += 1;
    return id;
  };
}

/** Stub `bakeImage` that resolves immediately to a canned data URL
 *  derived from the input — lets tests assert that the bake plumbed
 *  through to the bytes-store without spinning up a Web Worker. */
async function stubBake(data: string, mediaType: string): Promise<string | null> {
  return `data:${mediaType};base64,thumb-of-${data}`;
}

// ---------------------------------------------------------------------------
// Empty / trivial
// ---------------------------------------------------------------------------

describe("synthesizeUserMessageFromBlocks — empty / trivial", () => {
  test("empty blocks produce empty substrate", () => {
    const store = createAtomBytesStore();
    const { text, atoms } = synthesizeUserMessageFromBlocks([], store);
    expect(text).toBe("");
    expect(atoms).toEqual([]);
    expect(store.size()).toBe(0);
  });

  test("single text block produces text + no atoms", () => {
    const store = createAtomBytesStore();
    const { text, atoms } = synthesizeUserMessageFromBlocks(
      [TEXT_HELLO],
      store,
    );
    expect(text).toBe("hello");
    expect(atoms).toEqual([]);
  });

  test("consecutive text blocks coalesce in the substrate", () => {
    // Two text blocks produce one substrate string concatenation —
    // the substrate has no notion of "blocks", only `U+FFFC` slots
    // for atoms. Pre-image-block runs of text concatenate.
    const store = createAtomBytesStore();
    const { text, atoms } = synthesizeUserMessageFromBlocks(
      [TEXT_A, TEXT_B],
      store,
    );
    expect(text).toBe("a  b");
    expect(atoms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Interleaved text + image
// ---------------------------------------------------------------------------

describe("synthesizeUserMessageFromBlocks — interleaved text + image", () => {
  test("text/image/text produces 'a ￼ b' + one atom", () => {
    const store = createAtomBytesStore();
    const { text, atoms } = synthesizeUserMessageFromBlocks(
      [TEXT_A, IMAGE_PNG, TEXT_B],
      store,
      { mintAtomId: makeCounter(), bakeImage: stubBake },
    );
    expect(text).toBe(`a ${C} b`);
    expect(atoms).toHaveLength(1);
    expect(atoms[0]).toEqual({
      kind: "atom",
      type: "image",
      label: "image-1",
      value: "image-1",
      id: "mock-uuid-0",
    });
    // Bytes-store landed under the minted id with content + mediaType.
    expect(store.get("mock-uuid-0")).toEqual({
      content: "PNG-BASE64",
      mediaType: "image/png",
    });
  });

  test("consecutive image blocks produce '￼￼' + two atoms", () => {
    const store = createAtomBytesStore();
    const { text, atoms } = synthesizeUserMessageFromBlocks(
      [IMAGE_PNG, IMAGE_JPG],
      store,
      { mintAtomId: makeCounter(), bakeImage: stubBake },
    );
    expect(text).toBe(`${C}${C}`);
    expect(atoms).toHaveLength(2);
    expect(atoms[0].label).toBe("image-1");
    expect(atoms[1].label).toBe("image-2");
  });

  test("image-only produces '￼' + one atom", () => {
    const store = createAtomBytesStore();
    const { text, atoms } = synthesizeUserMessageFromBlocks(
      [IMAGE_PNG],
      store,
      { mintAtomId: makeCounter(), bakeImage: stubBake },
    );
    expect(text).toBe(C);
    expect(atoms).toHaveLength(1);
    expect(atoms[0].label).toBe("image-1");
  });
});

// ---------------------------------------------------------------------------
// atomIdAt resolver behaviour
// ---------------------------------------------------------------------------

describe("synthesizeUserMessageFromBlocks — atomIdAt resolver", () => {
  test("live path resolver: atoms reuse editor ids; bytes-store under those ids", () => {
    const store = createAtomBytesStore();
    const ids = ["editor-id-A", "editor-id-B"];
    const { atoms } = synthesizeUserMessageFromBlocks(
      [IMAGE_PNG, IMAGE_JPG],
      store,
      { atomIdAt: (i) => ids[i], mintAtomId: makeCounter(), bakeImage: stubBake },
    );
    expect(atoms.map((a) => a.id)).toEqual(["editor-id-A", "editor-id-B"]);
    expect(store.get("editor-id-A")?.content).toBe("PNG-BASE64");
    expect(store.get("editor-id-B")?.content).toBe("JPG-BASE64");
  });

  test("replay path (no resolver): atoms get freshly-minted ids", () => {
    const store = createAtomBytesStore();
    const { atoms } = synthesizeUserMessageFromBlocks(
      [IMAGE_PNG, IMAGE_JPG],
      store,
      { mintAtomId: makeCounter(), bakeImage: stubBake },
    );
    expect(atoms.map((a) => a.id)).toEqual(["mock-uuid-0", "mock-uuid-1"]);
  });

  test("resolver returns undefined for some indices → fresh UUIDs for those", () => {
    // Defensive against a partially-populated editor substrate: the
    // resolver returns an id for image-block 0 but not for 1; the
    // synthesizer falls through to the minter for the unresolved
    // index. Confirms no crash, no orphaned id.
    const store = createAtomBytesStore();
    const { atoms } = synthesizeUserMessageFromBlocks(
      [IMAGE_PNG, IMAGE_JPG],
      store,
      {
        atomIdAt: (i) => (i === 0 ? "editor-id-A" : undefined),
        mintAtomId: makeCounter(),
      },
    );
    expect(atoms[0].id).toBe("editor-id-A");
    expect(atoms[1].id).toBe("mock-uuid-0");
    expect(store.get("editor-id-A")?.content).toBe("PNG-BASE64");
    expect(store.get("mock-uuid-0")?.content).toBe("JPG-BASE64");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("synthesizeUserMessageFromBlocks — determinism", () => {
  test("two calls with the same inputs and resolver produce byte-identical substrate", () => {
    const blocks = [TEXT_A, IMAGE_PNG, TEXT_B];
    const ids = ["editor-id-A"];
    const a = synthesizeUserMessageFromBlocks(
      blocks,
      createAtomBytesStore(),
      { atomIdAt: (i) => ids[i], mintAtomId: makeCounter(), bakeImage: stubBake },
    );
    const b = synthesizeUserMessageFromBlocks(
      blocks,
      createAtomBytesStore(),
      { atomIdAt: (i) => ids[i], mintAtomId: makeCounter(), bakeImage: stubBake },
    );
    expect(a.text).toBe(b.text);
    expect(a.atoms).toEqual(b.atoms);
  });

  test("without a resolver, substrate text matches; only ids differ (documented seam)", () => {
    const blocks = [IMAGE_PNG];
    const minterA = makeCounter();
    const minterB = (() => {
      let n = 0;
      return () => `B-uuid-${n++}`;
    })();
    const a = synthesizeUserMessageFromBlocks(
      blocks,
      createAtomBytesStore(),
      { mintAtomId: minterA, bakeImage: stubBake },
    );
    const b = synthesizeUserMessageFromBlocks(
      blocks,
      createAtomBytesStore(),
      { mintAtomId: minterB, bakeImage: stubBake },
    );
    expect(a.text).toBe(b.text);
    expect(a.atoms[0]?.label).toBe(b.atoms[0]?.label);
    expect(a.atoms[0]?.id).not.toBe(b.atoms[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// Thumbnail bake
// ---------------------------------------------------------------------------

describe("synthesizeUserMessageFromBlocks — thumbnail bake", () => {
  test("fires a bake on the replay path when no existing thumbnail; updates entry", async () => {
    const store = createAtomBytesStore();
    const { atoms, thumbnailBake } = synthesizeUserMessageFromBlocks(
      [IMAGE_PNG],
      store,
      { mintAtomId: makeCounter(), bakeImage: stubBake },
    );
    // Before bake settles: entry has no thumbnail.
    const id = atoms[0].id!;
    expect(store.get(id)?.thumbnailDataUrl).toBeUndefined();
    await thumbnailBake;
    // After bake: entry's thumbnail is the stub's data URL,
    // content + mediaType unchanged.
    const updated = store.get(id);
    expect(updated?.content).toBe("PNG-BASE64");
    expect(updated?.mediaType).toBe("image/png");
    expect(updated?.thumbnailDataUrl).toBe("data:image/png;base64,thumb-of-PNG-BASE64");
  });

  test("does NOT re-bake when bytes-store entry already carries a thumbnail (live-path drop case)", async () => {
    // Live path: drop / paste pre-populated bytes-store with a
    // thumbnail. The synthesizer's idempotent put must preserve it
    // and skip the bake.
    const store = createAtomBytesStore();
    store.put("live-id", {
      content: "PNG-BASE64",
      mediaType: "image/png",
      thumbnailDataUrl: "data:image/png;base64,drop-time-thumbnail",
    });
    let bakeCalled = false;
    const { atoms, thumbnailBake } = synthesizeUserMessageFromBlocks(
      [IMAGE_PNG],
      store,
      {
        atomIdAt: () => "live-id",
        mintAtomId: makeCounter(),
        bakeImage: async () => {
          bakeCalled = true;
          return "data:should-not-appear";
        },
      },
    );
    await thumbnailBake;
    expect(bakeCalled).toBe(false);
    expect(atoms[0].id).toBe("live-id");
    expect(store.get("live-id")?.thumbnailDataUrl).toBe(
      "data:image/png;base64,drop-time-thumbnail",
    );
  });

  test("bake failure leaves entry without thumbnail (soft degradation)", async () => {
    const store = createAtomBytesStore();
    const { atoms, thumbnailBake } = synthesizeUserMessageFromBlocks(
      [IMAGE_PNG],
      store,
      {
        mintAtomId: makeCounter(),
        bakeImage: async () => null,
      },
    );
    await thumbnailBake;
    expect(store.get(atoms[0].id!)?.thumbnailDataUrl).toBeUndefined();
  });

  test("thumbnailBake resolves immediately when there are no image blocks", async () => {
    const store = createAtomBytesStore();
    const { thumbnailBake } = synthesizeUserMessageFromBlocks(
      [TEXT_HELLO],
      store,
    );
    // No bakes were fired; the promise resolves immediately.
    await thumbnailBake;
  });
});

// ---------------------------------------------------------------------------
// Round-trip integration with buildWirePayload
// ---------------------------------------------------------------------------

import { buildWirePayload } from "../build-wire-payload";
import type { AtomSegment } from "../tug-atom-img";

describe("synthesizeUserMessageFromBlocks + buildWirePayload round-trip", () => {
  test("editor's (text, atoms) → blocks → synthesized substrate preserves image positions and reuses ids", () => {
    // Editor substrate: prose around two image atoms with distinct ids.
    const store = createAtomBytesStore();
    store.put("editor-A", { content: "PNG-A", mediaType: "image/png" });
    store.put("editor-B", { content: "JPG-B", mediaType: "image/jpeg" });
    const editorText = `look ${C} and ${C} please`;
    const editorAtoms: AtomSegment[] = [
      { kind: "atom", type: "image", label: "raphael.jpeg", value: "raphael.jpeg", id: "editor-A" },
      { kind: "atom", type: "image", label: "cat.png", value: "cat.png", id: "editor-B" },
    ];

    const wire = buildWirePayload(editorText, editorAtoms, store);
    const synth = synthesizeUserMessageFromBlocks(wire.content, store, {
      atomIdAt: wire.atomIdAt,
      mintAtomId: makeCounter(),
      bakeImage: stubBake,
    });

    // Substrate retains image positions; labels are `image-N`, not
    // the editor's filenames (those are gone at the submit boundary).
    expect(synth.text).toBe(`look ${C} and ${C} please`);
    expect(synth.atoms).toHaveLength(2);
    expect(synth.atoms[0]).toEqual({
      kind: "atom",
      type: "image",
      label: "image-1",
      value: "image-1",
      id: "editor-A",
    });
    expect(synth.atoms[1]).toEqual({
      kind: "atom",
      type: "image",
      label: "image-2",
      value: "image-2",
      id: "editor-B",
    });
    // Bytes-store entries stayed under the editor's ids — no orphans
    // from a freshly-minted UUID.
    expect(store.get("editor-A")?.content).toBe("PNG-A");
    expect(store.get("editor-B")?.content).toBe("JPG-B");
  });

  test("bytes-less editor atom is skipped on the wire; resolver doesn't count it as an image block", () => {
    const store = createAtomBytesStore();
    store.put("editor-good", { content: "PNG", mediaType: "image/png" });
    // Two editor atoms; only one has bytes. The wire emits a single
    // image block and the resolver pins it to the bytes-bearing id.
    const editorText = `${C} ${C}`;
    const editorAtoms: AtomSegment[] = [
      { kind: "atom", type: "image", label: "missing.png", value: "missing.png", id: "editor-evicted" },
      { kind: "atom", type: "image", label: "good.png", value: "good.png", id: "editor-good" },
    ];

    const wire = buildWirePayload(editorText, editorAtoms, store);
    const synth = synthesizeUserMessageFromBlocks(wire.content, store, {
      atomIdAt: wire.atomIdAt,
      mintAtomId: makeCounter(),
      bakeImage: stubBake,
    });

    // Only one atom in the synthesized substrate; its id is the
    // bytes-bearing editor id (no mismatch).
    expect(synth.atoms).toHaveLength(1);
    expect(synth.atoms[0].id).toBe("editor-good");
  });
});
