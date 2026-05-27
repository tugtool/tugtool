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
