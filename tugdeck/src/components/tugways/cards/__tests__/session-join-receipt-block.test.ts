/**
 * The join and release receipts' parsers, against the exact strings the Rust
 * formatters assert. The literals are copied verbatim from
 * `format_join_summary_names_the_dash_the_base_and_the_rounds` and
 * `format_release_summary_lists_the_round_subjects` — that copy is the point:
 * it is what keeps the two ends pinned to one format, and it fails loudly if
 * either end drifts.
 */

import { describe, expect, it } from "bun:test";

import {
  matchesJoinReceipt,
  matchesReleaseReceipt,
  parseJoinReceipt,
  parseReleaseReceipt,
} from "@/components/tugways/cards/session-join-receipt-block";

describe("matchesJoinReceipt / matchesReleaseReceipt", () => {
  it("claims the two verbs and nothing that merely starts like them", () => {
    expect(matchesJoinReceipt("/dash-join")).toBe(true);
    expect(matchesJoinReceipt("/dash-join spike")).toBe(true);
    expect(matchesJoinReceipt("/dash-joins")).toBe(false);
    expect(matchesJoinReceipt("/join")).toBe(false);
    expect(matchesReleaseReceipt("/dash-release")).toBe(true);
    expect(matchesReleaseReceipt("/dash-released")).toBe(false);
  });
});

describe("parseJoinReceipt", () => {
  it("round-trips the exact S01 summary the server writes", () => {
    const out =
      "joined 0123456789 · join-lane → main · 5 round(s)\n" +
      "tugdash(join-lane): land the join surface";
    expect(parseJoinReceipt(out)).toEqual({
      sha: "0123456789",
      dash: "join-lane",
      base: "main",
      rounds: 5,
      message: "tugdash(join-lane): land the join surface",
    });
  });

  it("keeps a multi-line message whole", () => {
    const out =
      "joined abcdef0123 · d → trunk · 1 round(s)\n" +
      "Subject line\n\nA longer body paragraph.";
    expect(parseJoinReceipt(out)?.message).toBe(
      "Subject line\n\nA longer body paragraph.",
    );
  });

  it("returns null for a legacy or truncated row", () => {
    expect(parseJoinReceipt("")).toBe(null);
    expect(parseJoinReceipt("joined join-lane into main")).toBe(null);
    // A hand-typed hyphen where the U+2192 arrow belongs is not a receipt.
    expect(parseJoinReceipt("joined 0123456789 · d -> main · 1 round(s)\nm")).toBe(null);
  });
});

describe("parseReleaseReceipt", () => {
  it("round-trips the exact S02 summary, files and subjects included", () => {
    const out =
      "released spike · discarded 2 round(s), 3 file(s)\n" +
      "first round\nsecond round";
    expect(parseReleaseReceipt(out)).toEqual({
      dash: "spike",
      rounds: 2,
      files: 3,
      subjects: ["first round", "second round"],
    });
  });

  it("reads a clean dash's one-line summary", () => {
    expect(parseReleaseReceipt("released spike · discarded 0 round(s)")).toEqual({
      dash: "spike",
      rounds: 0,
      files: 0,
      subjects: [],
    });
  });

  it("returns null for a row that is not an S02 summary", () => {
    expect(parseReleaseReceipt("released spike")).toBe(null);
    expect(parseReleaseReceipt("discarded spike · 2 round(s)")).toBe(null);
  });
});
