/**
 * Pure-logic tests for `walkAtomText` — the substrate-walking helper
 * that produces the segment sequence `TugAtomTextBody` maps onto
 * interleaved text + atom-chip `<img>` elements.
 *
 * Tests pin the (text, atoms) → segments mapping across every shape
 * the transcript user-message row hands the component:
 *   - empty input,
 *   - plain text with no atoms,
 *   - one atom surrounded by text,
 *   - two atoms with text between,
 *   - mismatched count (more `U+FFFC` than atoms — the
 *     `stray-ffc` defensive branch matching `buildWirePayload`'s
 *     [Spec S03] invariant),
 *   - leading and trailing `U+FFFC` (atom at edges).
 *
 * The React mapping is mechanical: each segment maps to either a
 * `React.Fragment` (text / stray-ffc) or an `<img>` (atom). Pin the
 * substrate; the consumer renders it.
 */

import { describe, expect, test } from "bun:test";

import {
  decorateChipLabel,
  formatAtomTextForCopy,
  walkAtomText,
  type AtomTextSegment,
} from "../tug-atom-text-body";
import { TUG_ATOM_CHAR, type AtomSegment } from "@/lib/tug-atom-img";

// Sample atoms reused across cases. The `kind: "atom"` discriminator
// is what `AtomSegment` carries; the per-atom fields drive the
// rendered chip.
const ATOM_README: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "README.md",
  value: "/repo/README.md",
};

const ATOM_SCREENSHOT: AtomSegment = {
  kind: "atom",
  type: "image",
  label: "screenshot.png",
  value: "/tmp/screenshot.png",
};

describe("walkAtomText", () => {
  test("empty text + empty atoms → no segments", () => {
    expect(walkAtomText("", [])).toEqual([]);
  });

  test("plain text + no atoms → single text segment", () => {
    expect(walkAtomText("hello world", [])).toEqual([
      { kind: "text", text: "hello world" },
    ]);
  });

  test("one atom between text → text, atom, text in order", () => {
    const input = `before ${TUG_ATOM_CHAR} after`;
    expect(walkAtomText(input, [ATOM_README])).toEqual<AtomTextSegment[]>([
      { kind: "text", text: "before " },
      { kind: "atom", atom: ATOM_README },
      { kind: "text", text: " after" },
    ]);
  });

  test("two atoms with text between → atom, text, atom in order", () => {
    const input = `${TUG_ATOM_CHAR} and ${TUG_ATOM_CHAR}`;
    expect(walkAtomText(input, [ATOM_README, ATOM_SCREENSHOT])).toEqual<
      AtomTextSegment[]
    >([
      { kind: "atom", atom: ATOM_README },
      { kind: "text", text: " and " },
      { kind: "atom", atom: ATOM_SCREENSHOT },
    ]);
  });

  test("more U+FFFC than atoms → stray-ffc for the surplus", () => {
    // Two FFFC characters, only one atom supplied.
    const input = `${TUG_ATOM_CHAR} and ${TUG_ATOM_CHAR}`;
    expect(walkAtomText(input, [ATOM_README])).toEqual<AtomTextSegment[]>([
      { kind: "atom", atom: ATOM_README },
      { kind: "text", text: " and " },
      { kind: "stray-ffc" },
    ]);
  });

  test("leading U+FFFC → atom is the first segment, text follows", () => {
    const input = `${TUG_ATOM_CHAR} trailing text`;
    expect(walkAtomText(input, [ATOM_README])).toEqual<AtomTextSegment[]>([
      { kind: "atom", atom: ATOM_README },
      { kind: "text", text: " trailing text" },
    ]);
  });

  test("trailing U+FFFC → text first, atom is the last segment", () => {
    const input = `leading text ${TUG_ATOM_CHAR}`;
    expect(walkAtomText(input, [ATOM_README])).toEqual<AtomTextSegment[]>([
      { kind: "text", text: "leading text " },
      { kind: "atom", atom: ATOM_README },
    ]);
  });

  test("atom-only text (single U+FFFC) → exactly one atom segment", () => {
    expect(walkAtomText(TUG_ATOM_CHAR, [ATOM_README])).toEqual<
      AtomTextSegment[]
    >([{ kind: "atom", atom: ATOM_README }]);
  });

  test("text only, no FFFC but atoms supplied → atoms are ignored", () => {
    // The walker reads `U+FFFC` to find atom positions; an extra
    // atoms entry without a corresponding FFFC is silently dropped.
    // Mirror of the "stray-ffc" defensive branch (extra characters
    // pass through), but in the opposite direction.
    expect(walkAtomText("just plain text", [ATOM_README])).toEqual<
      AtomTextSegment[]
    >([{ kind: "text", text: "just plain text" }]);
  });
});

// A drop-style atom: browser doesn't expose paths for dropped files,
// so the atom is minted with `label === value === f.name` (see
// `drop-extension.ts:~142`). The formatter recognizes this shape
// and emits the bare label rather than a redundant link.
const ATOM_DROPPED_IMAGE: AtomSegment = {
  kind: "atom",
  type: "image",
  label: "raphael.jpeg",
  value: "raphael.jpeg",
};

describe("formatAtomTextForCopy", () => {
  test("plain text without atoms passes through verbatim", () => {
    expect(formatAtomTextForCopy("hello world", [])).toBe("hello world");
  });

  test("one path-bearing atom (value ≠ label) → angle-bracket markdown link", () => {
    expect(
      formatAtomTextForCopy(`before ${TUG_ATOM_CHAR} after`, [ATOM_README]),
    ).toBe("before [README.md](</repo/README.md>) after");
  });

  test("two path-bearing atoms → two markdown links, order preserved", () => {
    expect(
      formatAtomTextForCopy(`${TUG_ATOM_CHAR} and ${TUG_ATOM_CHAR}`, [
        ATOM_README,
        ATOM_SCREENSHOT,
      ]),
    ).toBe("[README.md](</repo/README.md>) and [screenshot.png](</tmp/screenshot.png>)");
  });

  test("dropped-file atom (value === label) → bare label, no markdown link", () => {
    // Browser-dropped files have no path; emitting `[name](name)`
    // would be a redundant pair carrying no info beyond the label.
    expect(
      formatAtomTextForCopy(`describe ${TUG_ATOM_CHAR}`, [ATOM_DROPPED_IMAGE]),
    ).toBe("describe raphael.jpeg");
  });

  test("mixed: dropped-file atom + path-bearing atom", () => {
    expect(
      formatAtomTextForCopy(
        `${TUG_ATOM_CHAR} versus ${TUG_ATOM_CHAR}`,
        [ATOM_DROPPED_IMAGE, ATOM_README],
      ),
    ).toBe("raphael.jpeg versus [README.md](</repo/README.md>)");
  });

  test("stray U+FFFC (atom missing) passes through verbatim", () => {
    // One FFFC supplied an atom; the second has no atom — render
    // the character itself so the bug is visible rather than silent.
    expect(
      formatAtomTextForCopy(`${TUG_ATOM_CHAR} and ${TUG_ATOM_CHAR}`, [
        ATOM_README,
      ]),
    ).toBe(`[README.md](</repo/README.md>) and ${TUG_ATOM_CHAR}`);
  });

  test("atom at the start → link is the first character", () => {
    expect(
      formatAtomTextForCopy(`${TUG_ATOM_CHAR} trailing text`, [ATOM_README]),
    ).toBe("[README.md](</repo/README.md>) trailing text");
  });

  test("atom at the end → link is the last character", () => {
    expect(
      formatAtomTextForCopy(`leading text ${TUG_ATOM_CHAR}`, [ATOM_README]),
    ).toBe("leading text [README.md](</repo/README.md>)");
  });

  test("empty text → empty string", () => {
    expect(formatAtomTextForCopy("", [])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// decorateChipLabel — Step 5c's transcript-vs-editor chip rendering
// ---------------------------------------------------------------------------

// Synthesized image atom — what the post-Step-5c synthesizer produces
// for an image content block. Label and value are both `image-N` (the
// editor's filename is gone at the submit boundary by design).
const ATOM_IMAGE_1: AtomSegment = {
  kind: "atom",
  type: "image",
  label: "image-1",
  value: "image-1",
};

describe("decorateChipLabel", () => {
  test("messageNumber set + image atom → `#NNNN-image-N` prefix", () => {
    // The transcript-side rendering: the chip's displayed label
    // carries the per-message transcript position so the per-message
    // attachment strip ([Step 6]) can pair it via matching captions.
    expect(decorateChipLabel(ATOM_IMAGE_1, 1)).toBe("#0001-image-1");
  });

  test("messageNumber=999 still pads to 4 digits", () => {
    expect(decorateChipLabel(ATOM_IMAGE_1, 999)).toBe("#0999-image-1");
  });

  test("messageNumber=10000 grows naturally past 4 digits", () => {
    // `formatSequenceNumber` pads only when needed.
    expect(decorateChipLabel(ATOM_IMAGE_1, 10000)).toBe("#10000-image-1");
  });

  test("messageNumber unset → image atom's stored label verbatim (editor case)", () => {
    // The editor's pre-submit rendering: no transcript position to
    // encode. The chip carries the atom's stored label as-is. Pre-
    // submit, that's still the user's filename (e.g. `raphael.jpeg`);
    // post-submit through the synthesizer, that's `image-N`. Either
    // way: no decoration when `messageNumber` is undefined.
    expect(decorateChipLabel(ATOM_IMAGE_1, undefined)).toBe("image-1");
  });

  test("non-image atom (file): no decoration even when messageNumber is set", () => {
    // File / doc / link / command atoms carry no per-message linkage
    // (their `value` is a path or URL, displayed verbatim). The
    // prefix would be misleading here, so the decorator skips it.
    const fileAtom: AtomSegment = {
      kind: "atom",
      type: "file",
      label: "README.md",
      value: "README.md",
    };
    expect(decorateChipLabel(fileAtom, 1)).toBe("README.md");
  });

  test("non-image atom (link): no decoration", () => {
    const linkAtom: AtomSegment = {
      kind: "atom",
      type: "link",
      label: "https://example.com",
      value: "https://example.com",
    };
    expect(decorateChipLabel(linkAtom, 42)).toBe("https://example.com");
  });

  test("editor case for synthesized atom: label === value === 'image-1' renders verbatim", () => {
    // The post-Step-5c synthesizer lands a substrate whose image
    // atoms carry `label: "image-1"`, `value: "image-1"`. In the
    // editor's pre-submit surface, where `messageNumber` is unset,
    // the chip renders the raw label — confirming the synthesizer's
    // output is renderable as-is when the transcript context is
    // absent.
    expect(decorateChipLabel(ATOM_IMAGE_1, undefined)).toBe("image-1");
  });
});
