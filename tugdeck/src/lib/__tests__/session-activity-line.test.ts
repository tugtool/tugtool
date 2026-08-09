/**
 * The activity line's rest grammar — the gallery's form.
 *
 * The turns segment always prints (zero reads `No turns`: a fresh session's line
 * is `No turns, 8 KB. Ready.`), the labeled stamp appears only for a session
 * with turns to have been updated by, an unknown size drops its segment, and
 * `Ready.` always closes the line.
 */

import { describe, expect, test } from "bun:test";

import {
  sessionActivityBeat,
  sessionActivityRestLine,
} from "@/lib/session-activity-line";

/** Aug 9 2026, 9:41 AM local — the stamp the assertions read back. */
const AT_MS = new Date(2026, 7, 9, 9, 41, 0).getTime();
const STAMP = "Aug 9, 9:41 AM";

function line(over: Parameters<typeof sessionActivityRestLine>[0]) {
  return sessionActivityRestLine(over);
}

describe("sessionActivityRestLine", () => {
  test("everything known — the full sentence", () => {
    expect(
      line({ turnCount: 7, fileSize: 49_357, lastUsedAtMs: AT_MS }),
    ).toBe(`7 turns, 48 KB. Last updated: ${STAMP}. Ready.`);
  });

  test("one turn is singular", () => {
    expect(line({ turnCount: 1, fileSize: 900, lastUsedAtMs: AT_MS })).toBe(
      `1 turn, 900 B. Last updated: ${STAMP}. Ready.`,
    );
  });

  test("a fresh session prints its zero — and no stamp, nothing to date", () => {
    expect(line({ turnCount: 0, fileSize: 8_192, lastUsedAtMs: AT_MS })).toBe(
      "No turns, 8.0 KB. Ready.",
    );
  });

  test("no size drops that segment and keeps the rest", () => {
    expect(line({ turnCount: 3, fileSize: null, lastUsedAtMs: AT_MS })).toBe(
      `3 turns. Last updated: ${STAMP}. Ready.`,
    );
  });

  test("a zero size is no size — an empty file is not a fact worth a segment", () => {
    expect(line({ turnCount: 3, fileSize: 0, lastUsedAtMs: AT_MS })).toBe(
      `3 turns. Last updated: ${STAMP}. Ready.`,
    );
  });

  test("no stamp drops the label with it", () => {
    expect(line({ turnCount: 3, fileSize: 2_048, lastUsedAtMs: null })).toBe(
      "3 turns, 2.0 KB. Ready.",
    );
  });

  test("nothing known — the count still prints and Ready still closes", () => {
    expect(line({ turnCount: 0, fileSize: null, lastUsedAtMs: null })).toBe(
      "No turns. Ready.",
    );
  });
});

describe("sessionActivityBeat", () => {
  test("the bare turn-end marker is not a beat", () => {
    expect(sessionActivityBeat({ text: "Done" })).toBeNull();
    // Whitespace around it is still the marker and nothing else.
    expect(sessionActivityBeat({ text: "  Done \n" })).toBeNull();
  });

  test("anything the voice actually said passes through, identity and all", () => {
    const beat = { text: "Reading the masthead's CSS" };
    expect(sessionActivityBeat(beat)).toBe(beat);
    // Only the bare marker: a sentence that merely contains the word is news.
    const sentence = { text: "Done with the first pass; starting the second" };
    expect(sessionActivityBeat(sentence)).toBe(sentence);
  });

  test("no beat is no beat", () => {
    expect(sessionActivityBeat(null)).toBeNull();
  });
});
