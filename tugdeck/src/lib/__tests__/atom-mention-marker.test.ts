/**
 * Pure-logic tests for {@link wrapAtomMention} +
 * {@link parseAtomMentionSegments} — the wire-text marker syntax for
 * non-image atom mentions ([Spec S03 (REVISED)]).
 *
 * The pair is the only round-trip path for non-image atoms — bare
 * substitution at submit + bare text on replay would lose every
 * `@`-mention's structural identity. These tests pin:
 *
 *   1. The forward wrap (backtick + `@` + value + backtick).
 *   2. The defensive backtick-in-value fallback.
 *   3. The reverse parse — handling no marker, one marker, multiple,
 *      adjacency, empty input, and the false-positive case (a user
 *      who literally wrote the marker syntax in plain prose).
 *   4. End-to-end round-trip: `parse(wrap(value))` recovers `value`.
 */

import { describe, expect, test } from "bun:test";

import {
  demoteUnverifiedMentions,
  parseAtomMentionSegments,
  wrapAtomMention,
  type AtomMentionSegment,
} from "../atom-mention-marker";
import { TUG_ATOM_CHAR, type AtomSegment } from "../tug-atom-img";

const C = TUG_ATOM_CHAR;

/** A recovered-mention atom looks like what `synthesizeUserMessageFromBlocks`
 *  emits from a wire marker: type `"file"`, no id. */
function mentionAtom(value: string): AtomSegment {
  return { kind: "atom", type: "file", label: value, value };
}

/** A real editor image atom — type `"image"`, has an id. */
function imageAtom(value: string, id: string): AtomSegment {
  return { kind: "atom", type: "image", label: value, value, id };
}

describe("wrapAtomMention — forward marker wrap", () => {
  test("plain filename wraps as `@filename`", () => {
    expect(wrapAtomMention("README.md")).toBe("`@README.md`");
  });

  test("path with slashes wraps verbatim inside the marker", () => {
    expect(wrapAtomMention("src/components/foo.tsx")).toBe(
      "`@src/components/foo.tsx`",
    );
  });

  test("URL wraps verbatim inside the marker", () => {
    expect(wrapAtomMention("https://example.com/x?y=1")).toBe(
      "`@https://example.com/x?y=1`",
    );
  });

  test("command name wraps verbatim inside the marker", () => {
    expect(wrapAtomMention("/help")).toBe("`@/help`");
  });

  test("backtick-in-value falls back to bare substitution", () => {
    // The marker syntax can't escape backticks; falling back to bare
    // substitution preserves the original pre-marker behaviour for
    // that one atom (lossy round-trip, no broken span).
    expect(wrapAtomMention("weird`name")).toBe("weird`name");
  });

  test("empty string wraps as the bare marker", () => {
    // Edge case — an atom with empty value shouldn't reach the
    // wrap helper in production, but pin the deterministic shape so
    // a future regression doesn't quietly emit `` `@` `` which would
    // fail to parse on replay anyway (parser requires 1+ chars).
    expect(wrapAtomMention("")).toBe("`@`");
  });
});

describe("parseAtomMentionSegments — reverse marker parse", () => {
  test("empty input returns no segments", () => {
    expect(parseAtomMentionSegments("")).toEqual([]);
  });

  test("text without markers returns a single text segment", () => {
    expect(parseAtomMentionSegments("hello world")).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "hello world" },
    ]);
  });

  test("single marker between text yields text / mention / text", () => {
    expect(
      parseAtomMentionSegments("Read `@README.md` please."),
    ).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "Read " },
      { kind: "mention", value: "README.md" },
      { kind: "text", text: " please." },
    ]);
  });

  test("multiple markers preserve document order", () => {
    expect(
      parseAtomMentionSegments("Compare `@a.ts` and `@b.ts`."),
    ).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "Compare " },
      { kind: "mention", value: "a.ts" },
      { kind: "text", text: " and " },
      { kind: "mention", value: "b.ts" },
      { kind: "text", text: "." },
    ]);
  });

  test("marker at start has no leading text segment", () => {
    expect(
      parseAtomMentionSegments("`@a.ts` and `@b.ts`"),
    ).toEqual<AtomMentionSegment[]>([
      { kind: "mention", value: "a.ts" },
      { kind: "text", text: " and " },
      { kind: "mention", value: "b.ts" },
    ]);
  });

  test("marker at end has no trailing text segment", () => {
    expect(
      parseAtomMentionSegments("Open `@file.md`"),
    ).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "Open " },
      { kind: "mention", value: "file.md" },
    ]);
  });

  test("adjacent markers with no intervening text", () => {
    expect(parseAtomMentionSegments("`@x``@y``@z`")).toEqual<AtomMentionSegment[]>([
      { kind: "mention", value: "x" },
      { kind: "mention", value: "y" },
      { kind: "mention", value: "z" },
    ]);
  });

  test("path with slashes parses verbatim", () => {
    expect(
      parseAtomMentionSegments("Read `@src/components/foo.tsx`."),
    ).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "Read " },
      { kind: "mention", value: "src/components/foo.tsx" },
      { kind: "text", text: "." },
    ]);
  });

  test("URL with query string parses verbatim", () => {
    expect(
      parseAtomMentionSegments("See `@https://example.com/x?y=1`."),
    ).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "See " },
      { kind: "mention", value: "https://example.com/x?y=1" },
      { kind: "text", text: "." },
    ]);
  });

  test("backticks without `@` prefix do NOT match", () => {
    // Markdown code spans without the `@` prefix stay text. Backticked
    // tokens are common in prose ("the `for` loop"); we'd produce
    // junk chips for all of them if the prefix wasn't required.
    expect(
      parseAtomMentionSegments("the `for` loop and `let`"),
    ).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "the `for` loop and `let`" },
    ]);
  });

  test("unmatched leading backtick parses cleanly (no match)", () => {
    // Defensive: a stray backtick with no closing pair stays as
    // literal text. The regex requires the full open + close shape.
    expect(parseAtomMentionSegments("a `@b")).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "a `@b" },
    ]);
  });

  test("false positive: user-typed `@literal` in prose parses as mention", () => {
    // Documented limitation — the wire syntax can't disambiguate
    // user-typed `` `@xyz` `` from a real `@`-mention chip. Visible
    // regression only (chip where user typed plain text); never data
    // loss.
    expect(
      parseAtomMentionSegments("I usually write `@stable` for these."),
    ).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "I usually write " },
      { kind: "mention", value: "stable" },
      { kind: "text", text: " for these." },
    ]);
  });

  test("regex lastIndex doesn't leak across calls", () => {
    // The global-regex `lastIndex` quirk: a fresh regex per call
    // means the same input yields the same output regardless of
    // call order. Pin so a refactor that hoists the regex into a
    // module constant without `new RegExp(...)` per call is caught.
    const text = "first `@a` second";
    const first = parseAtomMentionSegments(text);
    const second = parseAtomMentionSegments(text);
    expect(first).toEqual(second);
  });
});

describe("wrap + parse round-trip", () => {
  test("wrap then parse recovers the original value (plain filename)", () => {
    const wrapped = wrapAtomMention("README.md");
    const segments = parseAtomMentionSegments(wrapped);
    expect(segments).toEqual<AtomMentionSegment[]>([
      { kind: "mention", value: "README.md" },
    ]);
  });

  test("wrap inside surrounding text round-trips with text bookends preserved", () => {
    const wrapped = "Read " + wrapAtomMention("ga.txt") + " please.";
    expect(parseAtomMentionSegments(wrapped)).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "Read " },
      { kind: "mention", value: "ga.txt" },
      { kind: "text", text: " please." },
    ]);
  });

  test("backtick-in-value: wrap → plain text → parse returns text-only (lossy by design)", () => {
    // The wrap helper falls back to bare substitution for backtick-
    // containing values. On parse, the result is one text segment
    // — no chip. Lossy round-trip, no broken span.
    const wrapped = wrapAtomMention("weird`name");
    expect(wrapped).toBe("weird`name");
    expect(parseAtomMentionSegments(wrapped)).toEqual<AtomMentionSegment[]>([
      { kind: "text", text: "weird`name" },
    ]);
  });
});

describe("demoteUnverifiedMentions", () => {
  test("verified mention stays as a chip (text + atom preserved)", () => {
    const result = demoteUnverifiedMentions(
      `Read ${C} please`,
      [mentionAtom("ga.txt")],
      () => true,
    );
    expect(result.text).toBe(`Read ${C} please`);
    expect(result.atoms).toEqual([mentionAtom("ga.txt")]);
  });

  test("unverified mention demotes to `@value` text", () => {
    const result = demoteUnverifiedMentions(
      `fake ${C}`,
      [mentionAtom("foobar")],
      () => false,
    );
    expect(result.text).toBe("fake @foobar");
    expect(result.atoms).toEqual([]);
  });

  test("mixed: one verified, one unverified — only the unverified demotes", () => {
    const verifier = (v: string) => v === "ga.txt";
    const result = demoteUnverifiedMentions(
      `Read ${C} and ${C} please`,
      [mentionAtom("ga.txt"), mentionAtom("foobar")],
      verifier,
    );
    expect(result.text).toBe(`Read ${C} and @foobar please`);
    expect(result.atoms).toEqual([mentionAtom("ga.txt")]);
  });

  test("image atoms pass through unchanged regardless of verifier", () => {
    // Image atoms carry an id and aren't recovered mentions; the
    // verifier doesn't apply.
    const verifier = () => false;
    const result = demoteUnverifiedMentions(
      `Look ${C}`,
      [imageAtom("shot.png", "id-1")],
      verifier,
    );
    expect(result.text).toBe(`Look ${C}`);
    expect(result.atoms).toEqual([imageAtom("shot.png", "id-1")]);
  });

  test("empty atoms array returns input verbatim", () => {
    const result = demoteUnverifiedMentions(
      "no atoms here",
      [],
      () => false,
    );
    expect(result.text).toBe("no atoms here");
    expect(result.atoms).toEqual([]);
  });

  test("text with no U+FFFC and atoms array passes through (defensive)", () => {
    // Misaligned substrate — there are atoms in the array but no
    // placeholders in the text. The walker doesn't consume any
    // atoms; the input passes through verbatim.
    const result = demoteUnverifiedMentions(
      "just text",
      [mentionAtom("foo")],
      () => false,
    );
    expect(result.text).toBe("just text");
    expect(result.atoms).toEqual([]);
  });

  test("stray U+FFFC with no paired atom passes through verbatim", () => {
    // Mirrors `walkAtomText`'s defensive `stray-ffc` branch and
    // `buildWirePayload`'s "atoms.length < count(U+FFFC)" handling.
    const result = demoteUnverifiedMentions(
      `text ${C}${C} more`,
      [mentionAtom("foo")],
      () => true,
    );
    // First U+FFFC consumes the atom (verified → kept); second
    // U+FFFC is stray and passes through as the literal character.
    expect(result.text).toBe(`text ${C}${C} more`);
    expect(result.atoms).toEqual([mentionAtom("foo")]);
  });

  test("demoted mention preserves surrounding text exactly", () => {
    // The replacement is exactly `@${value}` — no extra whitespace,
    // no backticks. What the user typed.
    const result = demoteUnverifiedMentions(
      `before ${C} after`,
      [mentionAtom("x")],
      () => false,
    );
    expect(result.text).toBe("before @x after");
    expect(result.atoms).toEqual([]);
  });

  test("multiple unverified mentions all demote, document order preserved", () => {
    const result = demoteUnverifiedMentions(
      `${C} ${C} ${C}`,
      [mentionAtom("a"), mentionAtom("b"), mentionAtom("c")],
      () => false,
    );
    expect(result.text).toBe("@a @b @c");
    expect(result.atoms).toEqual([]);
  });

  test("verifier receives the atom's value (not the label) — same in our model but pin it", () => {
    const seen: string[] = [];
    demoteUnverifiedMentions(
      `${C} ${C}`,
      [mentionAtom("ga.txt"), mentionAtom("config.js")],
      (value) => {
        seen.push(value);
        return true;
      },
    );
    expect(seen).toEqual(["ga.txt", "config.js"]);
  });
});
