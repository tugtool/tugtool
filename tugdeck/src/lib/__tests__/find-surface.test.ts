/**
 * find-surface — the DevFindSession → FindSurface adapter's snapshot
 * mapping and [L02] identity stability.
 */

import { describe, expect, test } from "bun:test";

import { DevFindSession } from "@/lib/dev-find-session";
import { devFindSurface } from "@/lib/find-surface";
import type { FindOptions } from "@/lib/transcript-search";
import type { SegmentedFindMatch } from "@/lib/transcript-search";

const m = (row: number, start: number): SegmentedFindMatch => ({
  row,
  start,
  end: start + 1,
  segment: 0,
  segmentKind: "dom",
});

describe("devFindSurface", () => {
  test("maps session state onto the surface snapshot", () => {
    const session = new DevFindSession();
    const surface = devFindSurface(session, session.setOptions.bind(session));

    session.setQuery("abc");
    session.setMatches([m(0, 0), m(1, 2)]);
    const snap = surface.getSnapshot();
    expect(snap.count).toBe(2);
    expect(snap.activeOrdinal).toBe(0);
    expect(snap.hasQuery).toBe(true);
    expect(snap.capped).toBe(false);
  });

  test("no matches with a live query reads as a hitless query", () => {
    const session = new DevFindSession();
    const surface = devFindSurface(session, () => {});
    session.setQuery("nope");
    const snap = surface.getSnapshot();
    expect(snap.count).toBe(0);
    expect(snap.activeOrdinal).toBeNull();
    expect(snap.hasQuery).toBe(true);
  });

  test("snapshot identity is stable between changes ([L02])", () => {
    const session = new DevFindSession();
    const surface = devFindSurface(session, () => {});
    const a = surface.getSnapshot();
    const b = surface.getSnapshot();
    expect(Object.is(a, b)).toBe(true);
    session.setQuery("x");
    expect(Object.is(surface.getSnapshot(), a)).toBe(false);
  });

  test("setOptions routes through the provided write path", () => {
    const session = new DevFindSession();
    const written: FindOptions[] = [];
    const surface = devFindSurface(session, (next) => {
      written.push(next);
      session.setOptions(next);
    });
    const next = { caseSensitive: true, wholeWord: false, grep: false };
    surface.setOptions(next);
    expect(written).toEqual([next]);
    expect(surface.getSnapshot().options).toEqual(next);
  });
});
