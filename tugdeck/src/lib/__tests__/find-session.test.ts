/**
 * find-session.test — the shared find controller's engine-independent
 * semantics, exercised against a stub {@link FindEngineDelegate}: query /
 * option propagation, count publication, and the ordinal-movement wrap
 * accounting that drives the shared wrap overlay identically for every
 * engine.
 */

import { describe, expect, test } from "bun:test";
import {
  FindSession,
  type FindEngineDelegate,
  type FindMatchInfo,
} from "../find-session";
import type { FindOptions } from "../transcript-search";

/** A stub engine over a fixed match count with wrap-around navigation. */
function stubEngine(count: number) {
  let active: number | null = null;
  const calls: string[] = [];
  const engine: FindEngineDelegate & { setCount: (n: number) => void } = {
    searchDidChange: (query: string, _options: FindOptions) => {
      calls.push(`search:${query}`);
      active = count > 0 && query !== "" ? 0 : null;
    },
    findNext: () => {
      if (count === 0) return;
      active = active === null ? 0 : (active + 1) % count;
    },
    findPrevious: () => {
      if (count === 0) return;
      active = active === null ? 0 : (active - 1 + count) % count;
    },
    matchInfo: (): FindMatchInfo => ({
      count,
      activeOrdinal: active,
      capped: false,
    }),
    clear: () => {
      calls.push("clear");
      active = null;
    },
    setCount: (n: number) => {
      count = n;
    },
  };
  return { engine, calls };
}

describe("FindSession", () => {
  test("query propagates to the engine and publishes its count", () => {
    const { engine, calls } = stubEngine(3);
    const session = new FindSession();
    session.setDelegate(engine);
    session.setQuery("alpha");
    expect(calls).toEqual(["search:alpha"]);
    const snap = session.getSnapshot();
    expect(snap.count).toBe(3);
    expect(snap.activeOrdinal).toBe(0);
    expect(snap.hasQuery).toBe(true);
  });

  test("setDelegate replays a standing query into a SYNCHRONOUS late-attaching engine", () => {
    // The stub resolves `matchInfo` synchronously, so the count lands on the
    // `refresh()` inside `setDelegate`. This is the CM6 `documentFindEngine`
    // shape (its search is synchronous); the debounced transcript engine is
    // covered by the async test below.
    const { engine, calls } = stubEngine(2);
    const session = new FindSession();
    session.setQuery("beta");
    expect(session.getSnapshot().count).toBe(0);
    session.setDelegate(engine);
    expect(calls).toEqual(["search:beta"]);
    expect(session.getSnapshot().count).toBe(2);
  });

  test("setDelegate replays a standing query into an ASYNC (debounced) engine", () => {
    // Faithful model of `TranscriptFindEngine`: `searchDidChange` only
    // SCHEDULES; `matchInfo` reads 0 until the debounce settles, at which
    // point the engine calls `session.refresh()` itself. So the synchronous
    // `refresh()` inside `setDelegate` must NOT invent a count — it publishes
    // 0 — and the real count only lands when the engine settles.
    let sessionRef: FindSession | null = null;
    let settledCount = 0;
    const asyncEngine: FindEngineDelegate & { settle: (n: number) => void } = {
      didAttach: (s) => {
        sessionRef = s;
      },
      searchDidChange: () => {
        // Debounced: no result yet.
      },
      matchInfo: (): FindMatchInfo => ({
        count: settledCount,
        activeOrdinal: settledCount > 0 ? 0 : null,
        capped: false,
      }),
      settle: (n: number) => {
        settledCount = n;
        sessionRef?.refresh();
      },
    };
    const session = new FindSession();
    session.setQuery("beta");
    session.setDelegate(asyncEngine);
    // Synchronous replay: the debounce has not fired, so the count is still 0.
    expect(session.getSnapshot().count).toBe(0);
    // The debounce settles and re-publishes via `refresh()`.
    asyncEngine.settle(2);
    expect(session.getSnapshot().count).toBe(2);
    expect(session.getSnapshot().activeOrdinal).toBe(0);
  });

  test("options changes re-search and fire the persistence hook", () => {
    const { engine } = stubEngine(1);
    const persisted: FindOptions[] = [];
    const session = new FindSession(undefined, {
      onOptionsChanged: (o) => persisted.push(o),
    });
    session.setDelegate(engine);
    session.setQuery("q");
    session.setOptions({ caseSensitive: true, wholeWord: false, grep: false });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.caseSensitive).toBe(true);
  });

  test("forward wrap: advancing past the last match bumps wrapSeq with direction 1", () => {
    const { engine } = stubEngine(2);
    const session = new FindSession();
    session.setDelegate(engine);
    session.setQuery("q"); // active 0
    session.next(); // 0 → 1, no wrap
    expect(session.getSnapshot().wrapped).toBe(false);
    expect(session.getSnapshot().wrapSeq).toBe(0);
    session.next(); // 1 → 0, wrap
    const snap = session.getSnapshot();
    expect(snap.wrapped).toBe(true);
    expect(snap.wrapDirection).toBe(1);
    expect(snap.wrapSeq).toBe(1);
  });

  test("backward wrap: retreating past the first match bumps wrapSeq with direction -1", () => {
    const { engine } = stubEngine(3);
    const session = new FindSession();
    session.setDelegate(engine);
    session.setQuery("q"); // active 0
    session.previous(); // 0 → 2, wrap
    const snap = session.getSnapshot();
    expect(snap.wrapped).toBe(true);
    expect(snap.wrapDirection).toBe(-1);
    expect(snap.wrapSeq).toBe(1);
  });

  test("a one-match set wraps on every navigation (consecutive wraps keep counting)", () => {
    const { engine } = stubEngine(1);
    const session = new FindSession();
    session.setDelegate(engine);
    session.setQuery("q");
    session.next();
    session.next();
    expect(session.getSnapshot().wrapSeq).toBe(2);
    expect(session.getSnapshot().wrapDirection).toBe(1);
  });

  test("query edits clear the transient wrap flag but never wrapSeq", () => {
    const { engine } = stubEngine(2);
    const session = new FindSession();
    session.setDelegate(engine);
    session.setQuery("q");
    session.next();
    session.next(); // wrap
    expect(session.getSnapshot().wrapSeq).toBe(1);
    session.setQuery("qr");
    const snap = session.getSnapshot();
    expect(snap.wrapped).toBe(false);
    expect(snap.wrapDirection).toBe(0);
    expect(snap.wrapSeq).toBe(1);
  });

  test("clear tears down the engine search and zeroes the published face", () => {
    const { engine, calls } = stubEngine(2);
    const session = new FindSession();
    session.setDelegate(engine);
    session.setQuery("q");
    session.clear();
    expect(calls).toContain("clear");
    const snap = session.getSnapshot();
    expect(snap.count).toBe(0);
    expect(snap.hasQuery).toBe(false);
    expect(snap.query).toBe("");
  });

  test("refresh preserves wrap state while re-reading the engine (async settle)", () => {
    const { engine } = stubEngine(2);
    const session = new FindSession();
    session.setDelegate(engine);
    session.setQuery("q");
    session.next();
    session.next(); // wrap; wrapSeq 1
    engine.setCount(5);
    session.refresh();
    const snap = session.getSnapshot();
    expect(snap.count).toBe(5);
    expect(snap.wrapSeq).toBe(1);
  });
});
