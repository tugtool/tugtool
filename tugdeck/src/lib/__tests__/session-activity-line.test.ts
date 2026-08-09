/**
 * The activity line's rest grammar.
 *
 * Every segment is conditional, and the interesting cases are the ones where a
 * segment drops: a session the scanner has never seen must not print `0 turns`,
 * and a session on disk with no card open must not claim to be `Ready.`
 */

import { describe, expect, test } from "bun:test";

import { sessionActivityRestLine } from "@/lib/session-activity-line";

/** Aug 9 2026, 9:41 AM local — the stamp the assertions read back. */
const AT_MS = new Date(2026, 7, 9, 9, 41, 0).getTime();
const STAMP = "Aug 9, 9:41 AM";

function line(over: Parameters<typeof sessionActivityRestLine>[0]) {
  return sessionActivityRestLine(over);
}

describe("sessionActivityRestLine", () => {
  test("everything known, card bound — the full sentence", () => {
    expect(
      line({
        turnCount: 7,
        fileSize: 49_357,
        lastUsedAtMs: AT_MS,
        hasCard: true,
      }),
    ).toBe(`7 turns, 48 KB. Last updated: ${STAMP}. Ready.`);
  });

  test("one turn is singular", () => {
    expect(
      line({ turnCount: 1, fileSize: 900, lastUsedAtMs: AT_MS, hasCard: true }),
    ).toBe(`1 turn, 900 B. Last updated: ${STAMP}. Ready.`);
  });

  test("no turns drops the count AND the stamp — nothing to date", () => {
    expect(
      line({ turnCount: 0, fileSize: null, lastUsedAtMs: AT_MS, hasCard: true }),
    ).toBe("Ready.");
  });

  test("a size with no turns still says something true about the file", () => {
    expect(
      line({ turnCount: 0, fileSize: 8_192, lastUsedAtMs: null, hasCard: false }),
    ).toBe("8.0 KB.");
  });

  test("no size drops that segment and keeps the rest", () => {
    expect(
      line({ turnCount: 3, fileSize: null, lastUsedAtMs: AT_MS, hasCard: true }),
    ).toBe(`3 turns. Last updated: ${STAMP}. Ready.`);
  });

  test("a zero size is no size — an empty file is not a fact worth a segment", () => {
    expect(
      line({ turnCount: 3, fileSize: 0, lastUsedAtMs: AT_MS, hasCard: true }),
    ).toBe(`3 turns. Last updated: ${STAMP}. Ready.`);
  });

  test("no stamp drops the label with it", () => {
    expect(
      line({ turnCount: 3, fileSize: 2_048, lastUsedAtMs: null, hasCard: true }),
    ).toBe("3 turns, 2.0 KB. Ready.");
  });

  test("a closed session is not Ready — it is a file on disk", () => {
    expect(
      line({
        turnCount: 12,
        fileSize: 100_000,
        lastUsedAtMs: AT_MS,
        hasCard: false,
      }),
    ).toBe(`12 turns, 98 KB. Last updated: ${STAMP}.`);
  });

  test("the two degenerate cases", () => {
    // Nothing known, card bound: exactly `Ready.`
    expect(
      line({
        turnCount: 0,
        fileSize: null,
        lastUsedAtMs: null,
        hasCard: true,
      }),
    ).toBe("Ready.");
    // Nothing known, no card: the empty string. The description row's stamp
    // rung is what keeps such a row from looking hollow.
    expect(
      line({
        turnCount: 0,
        fileSize: null,
        lastUsedAtMs: null,
        hasCard: false,
      }),
    ).toBe("");
  });
});
