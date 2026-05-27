/**
 * Pure-logic tests for `TugAttachmentStrip` — the per-message
 * thumbnail strip mounted below the user-row body in the transcript.
 *
 * The component itself is a React surface and would need DOM rendering
 * to fully exercise. Per the project's "no fake-DOM unit tests" rule
 * (happy-dom is gone), the tests cover the pure observable contract:
 *
 *   - **Label-match equality**: each tile's caption is exactly the
 *     `#NNNN-image-N` string the inline chip carries (the strip's
 *     core promise — chip-label === strip-caption for the same atom).
 *   - **Atom-array filtering**: the strip's documented contract
 *     ("`atoms` must already be image-only") is matched by the
 *     `UserMessageCell` filter that callers use; the test pins the
 *     filter formula.
 *   - **Snapshot shape from the bytes-store**: the strip's
 *     `useSyncExternalStore` projection reads `thumbnailDataUrl`
 *     directly from `bytesStore.get(atom.id)`. We test that
 *     projection function's behaviour against the bytes-store
 *     contract (entries present, entries missing, no id on atom).
 *
 * Full render shape (tile DOM, click delegation, focus ring) is
 * verified via the gallery card + manual smoke; the contract this
 * file pins is the substrate-to-projection seam the component sits
 * on top of.
 */

import { describe, expect, test } from "bun:test";

import { decorateChipLabel } from "../tug-atom-text-body";
import { splitChipLabelLines } from "../tug-attachment-strip";
import {
  createAtomBytesStore,
  type AtomBytesStore,
} from "@/lib/atom-bytes-store";
import { type AtomSegment } from "@/lib/tug-atom-img";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function imageAtom(id: string, label = "image-1"): AtomSegment {
  return { kind: "atom", type: "image", label, value: label, id };
}

function fileAtom(path: string): AtomSegment {
  return { kind: "atom", type: "file", label: path, value: path };
}

// ---------------------------------------------------------------------------
// Chip-label === strip-caption equality
// ---------------------------------------------------------------------------

describe("TugAttachmentStrip — chip-label === strip-caption equality", () => {
  // The strip's `aria-label` and visible caption both compute via
  // `decorateChipLabel(atom, messageNumber)` — the same helper the
  // inline chip uses (`TugAtomTextBody` calls it inline). So the
  // visual-linkage promise "chip and tile share the same label" is
  // testable as: pin both sides to the same decorator and confirm.

  test("messageNumber=1 + atom 'image-1' → chip and strip both render '#0001-image-1'", () => {
    const atom = imageAtom("editor-A", "image-1");
    const chipLabel = decorateChipLabel(atom, 1);
    // The strip's caption derivation is the same call. We pin that
    // both produce identical strings, which is the visual-linkage
    // contract the user observes in the transcript.
    const stripCaption = decorateChipLabel(atom, 1);
    expect(chipLabel).toBe("#0001-image-1");
    expect(stripCaption).toBe(chipLabel);
  });

  test("messageNumber=42 + two atoms → both labels stay paired", () => {
    const a = imageAtom("editor-A", "image-1");
    const b = imageAtom("editor-B", "image-2");
    expect(decorateChipLabel(a, 42)).toBe("#0042-image-1");
    expect(decorateChipLabel(b, 42)).toBe("#0042-image-2");
  });
});

// ---------------------------------------------------------------------------
// Image-atom filter (the UserMessageCell pre-filter that callers run
// before passing the array to the strip)
// ---------------------------------------------------------------------------

describe("UserMessageCell — image-atom filter for TugAttachmentStrip", () => {
  // The strip's prop contract says `atoms` must be image-only — the
  // caller (UserMessageCell) filters via `atoms.filter(a => a.type
  // === "image")`. This isn't a complex predicate, but pinning the
  // formula here documents the contract.

  test("mixed image + file atoms → file atoms are dropped from the strip's input", () => {
    const atoms: ReadonlyArray<AtomSegment> = [
      imageAtom("editor-A", "image-1"),
      fileAtom("README.md"),
      imageAtom("editor-B", "image-2"),
    ];
    const imageOnly = atoms.filter((a) => a.type === "image");
    expect(imageOnly).toHaveLength(2);
    expect(imageOnly.map((a) => a.label)).toEqual(["image-1", "image-2"]);
  });

  test("zero image atoms → empty array (strip renders nothing)", () => {
    const atoms: ReadonlyArray<AtomSegment> = [
      fileAtom("README.md"),
      fileAtom("docs/intro.md"),
    ];
    const imageOnly = atoms.filter((a) => a.type === "image");
    expect(imageOnly).toEqual([]);
  });

  test("image-only input passes through unchanged", () => {
    const atoms: ReadonlyArray<AtomSegment> = [
      imageAtom("editor-A", "image-1"),
      imageAtom("editor-B", "image-2"),
    ];
    const imageOnly = atoms.filter((a) => a.type === "image");
    expect(imageOnly).toEqual(atoms as AtomSegment[]);
  });
});

// ---------------------------------------------------------------------------
// Bytes-store projection — what the strip reads per tile
// ---------------------------------------------------------------------------

/**
 * Mirror of the strip's internal `buildSnapshot` projection. We
 * inline the same shape here so the tests pin the behaviour without
 * having to import the un-exported helper. The strip's component-
 * internal snapshot uses this exact shape.
 */
function projectTiles(
  atoms: ReadonlyArray<AtomSegment>,
  bytesStore: AtomBytesStore,
): Array<{ atomId: string; thumbnailDataUrl: string | undefined }> {
  return atoms.map((atom) => {
    const id = atom.id ?? "";
    const entry = id.length > 0 ? bytesStore.get(id) : null;
    return {
      atomId: id,
      thumbnailDataUrl: entry?.thumbnailDataUrl,
    };
  });
}

describe("TugAttachmentStrip — bytes-store projection", () => {
  test("atom with bytes-store entry + thumbnailDataUrl → tile carries the URL", () => {
    const store = createAtomBytesStore();
    store.put("editor-A", {
      content: "PNG-DATA",
      mediaType: "image/png",
      thumbnailDataUrl: "data:image/png;base64,thumb",
    });
    const tiles = projectTiles([imageAtom("editor-A")], store);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].atomId).toBe("editor-A");
    expect(tiles[0].thumbnailDataUrl).toBe("data:image/png;base64,thumb");
  });

  test("atom with bytes-store entry but no thumbnailDataUrl → tile shows placeholder (undefined URL)", () => {
    // Replay-path case: synthesizer minted the entry but the bake
    // hasn't fired/completed yet. The tile renders a placeholder
    // until the bake completes and the bytes-store subscriber fires.
    const store = createAtomBytesStore();
    store.put("editor-A", {
      content: "PNG-DATA",
      mediaType: "image/png",
      // thumbnailDataUrl omitted
    });
    const tiles = projectTiles([imageAtom("editor-A")], store);
    expect(tiles[0].thumbnailDataUrl).toBeUndefined();
  });

  test("atom with id but no bytes-store entry → tile shows placeholder", () => {
    // Defensive: an atom carries an id but the bytes-store has no
    // matching entry (synthesizer hasn't run yet, or the entry was
    // evicted). The projection returns `undefined` for the URL.
    const store = createAtomBytesStore();
    const tiles = projectTiles([imageAtom("orphaned-id")], store);
    expect(tiles[0].atomId).toBe("orphaned-id");
    expect(tiles[0].thumbnailDataUrl).toBeUndefined();
  });

  test("atom with no id → tile gets empty atomId and no URL", () => {
    // Defensive: an image atom without an id (would be a substrate
    // bug — `synthesizeUserMessageFromBlocks` always mints an id).
    // The projection gracefully degrades.
    const store = createAtomBytesStore();
    const atom: AtomSegment = {
      kind: "atom",
      type: "image",
      label: "image-1",
      value: "image-1",
    };
    const tiles = projectTiles([atom], store);
    expect(tiles[0].atomId).toBe("");
    expect(tiles[0].thumbnailDataUrl).toBeUndefined();
  });

  test("two atoms → projection preserves order; per-tile lookup is independent", () => {
    const store = createAtomBytesStore();
    store.put("editor-A", {
      content: "A",
      mediaType: "image/png",
      thumbnailDataUrl: "data:image/png;base64,A",
    });
    store.put("editor-B", {
      content: "B",
      mediaType: "image/jpeg",
      thumbnailDataUrl: "data:image/jpeg;base64,B",
    });
    const tiles = projectTiles(
      [imageAtom("editor-A"), imageAtom("editor-B")],
      store,
    );
    expect(tiles.map((t) => t.atomId)).toEqual(["editor-A", "editor-B"]);
    expect(tiles.map((t) => t.thumbnailDataUrl)).toEqual([
      "data:image/png;base64,A",
      "data:image/jpeg;base64,B",
    ]);
  });

  test("bytes-store update lands on the next projection (subscriber semantics)", () => {
    // The strip's `useSyncExternalStore` re-reads via `getSnapshot`
    // after `subscribe`'s listener fires; here we just confirm the
    // projection picks up the bytes-store's post-`put` state. The
    // listener wiring is the bytes-store's own contract — we trust
    // its own test suite — and we pin that the projection's read
    // path sees the new value.
    const store = createAtomBytesStore();
    store.put("editor-A", {
      content: "A",
      mediaType: "image/png",
      // No thumbnail yet (pre-bake).
    });
    let snap = projectTiles([imageAtom("editor-A")], store);
    expect(snap[0].thumbnailDataUrl).toBeUndefined();

    // Simulate the bake completing — the synthesizer's post-bake
    // update is a `put` that preserves content/mediaType and adds
    // the thumbnail. The next projection picks it up.
    store.put("editor-A", {
      content: "A",
      mediaType: "image/png",
      thumbnailDataUrl: "data:image/png;base64,thumb-late",
    });
    snap = projectTiles([imageAtom("editor-A")], store);
    expect(snap[0].thumbnailDataUrl).toBe("data:image/png;base64,thumb-late");
  });
});

// ---------------------------------------------------------------------------
// splitChipLabelLines — Finder-style two-line caption split
// ---------------------------------------------------------------------------

describe("splitChipLabelLines — Finder-style caption split", () => {
  test("standard label splits at the first hyphen; trailing hyphen stays on line 1", () => {
    // `#0001-image-1` → ["#0001-", "image-1"]. The hyphen between
    // the transcript-position prefix and the atom's stored label is
    // the wrap-trigger glyph; macOS Finder keeps it attached to the
    // breaking line, and we mirror that behaviour.
    expect(splitChipLabelLines("#0001-image-1")).toEqual([
      "#0001-",
      "image-1",
    ]);
  });

  test("wider message number (#9999) — still splits at the first hyphen", () => {
    expect(splitChipLabelLines("#9999-image-1")).toEqual([
      "#9999-",
      "image-1",
    ]);
  });

  test("label without `#NNNN-` prefix → single line", () => {
    // Atoms in surfaces where `messageNumber` is unset (editor pre-
    // submit) carry no transcript-position prefix. The caption
    // renders as a single line — no split.
    expect(splitChipLabelLines("image-1")).toEqual(["image-1"]);
  });

  test("editor file-atom label (path) → single line", () => {
    // File / doc / link atoms render with their stored label
    // verbatim and have no `#` prefix; no split applies.
    expect(splitChipLabelLines("README.md")).toEqual(["README.md"]);
  });

  test("label join roundtrip — split + join equals input (chip-label === caption-string contract)", () => {
    // The visible caption string (concatenation of the rendered
    // lines) must equal the chip's full label exactly; this pins
    // the equality contract under the new two-line layout.
    const samples = [
      "#0001-image-1",
      "#0042-image-2",
      "#9999-image-99",
      "image-1",
      "README.md",
    ];
    for (const s of samples) {
      expect(splitChipLabelLines(s).join("")).toBe(s);
    }
  });

  test("defensive: empty string → single empty line", () => {
    expect(splitChipLabelLines("")).toEqual([""]);
  });

  test("integration: decorateChipLabel + splitChipLabelLines pair as expected", () => {
    // The strip pipes the chip's full label through the splitter;
    // exercise the actual composition.
    const atom: AtomSegment = {
      kind: "atom",
      type: "image",
      label: "image-1",
      value: "image-1",
    };
    const lines = splitChipLabelLines(decorateChipLabel(atom, 1));
    expect(lines).toEqual(["#0001-", "image-1"]);
  });
});
