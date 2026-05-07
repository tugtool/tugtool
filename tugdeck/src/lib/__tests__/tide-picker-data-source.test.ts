/**
 * `TidePickerDataSource` — unit tests for the picker's composite
 * data source.
 *
 * Pure-class tests, no React render. The hook
 * (`useTidePickerDataSource`) is thin glue around
 * `setInputsWithoutNotify` + `notifyAll`; its behavior is exercised
 * indirectly by the picker form rewrite (Step 9) and the manual
 * smoke checklist there.
 *
 * Coverage:
 *   - Section enumeration across the four upstream input states
 *     (idle, pending, ready, error) × the two query states
 *     (empty, non-empty).
 *   - The `path-recent` exclusion rule for exact-equal recents.
 *   - The `forget-all` footer gating on `nonLiveCount > 0`.
 *   - Live `session-resume` rows preserved with `row.state`.
 *   - Role mapping: header → "header", forget-all → "footer",
 *     everything else → "cell".
 *   - `idForIndex` stability for `path-recent` and `session-resume`
 *     across recents/ledger changes.
 *   - Subscribe/unsubscribe and one-tick-per-change semantics.
 *   - `setInputsWithoutNotify` short-circuits on identity-equal
 *     inputs.
 *   - `caseInsensitiveSubstring` matching: exact, mixed-case, no-
 *     match, with attached match ranges.
 */

import { describe, expect, test } from "bun:test";

import { TidePickerDataSource } from "../tide-picker-data-source";
import type { PickerRow } from "../tide-picker-data-source";
import type { SessionRow } from "../../protocol";
import type { WorkspaceSnapshot } from "../tide-session-ledger-store";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDLE: WorkspaceSnapshot = Object.freeze({
  status: "idle",
  rows: Object.freeze([]) as readonly SessionRow[],
});

const PENDING: WorkspaceSnapshot = Object.freeze({
  status: "pending",
  rows: Object.freeze([]) as readonly SessionRow[],
});

function readyWith(rows: ReadonlyArray<SessionRow>): WorkspaceSnapshot {
  return { status: "ready", rows };
}

function errorWith(reason: string): WorkspaceSnapshot {
  return {
    status: "error",
    rows: [],
    error: { reason },
  };
}

function makeRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: overrides.session_id ?? `sid-${Math.random().toString(36).slice(2, 8)}`,
    workspace_key: overrides.workspace_key ?? "/Users/Ken/projects/foo",
    project_dir: overrides.project_dir ?? "/Users/Ken/projects/foo",
    created_at: overrides.created_at ?? 0,
    last_used_at: overrides.last_used_at ?? 0,
    turn_count: overrides.turn_count ?? 0,
    first_user_prompt: overrides.first_user_prompt ?? null,
    state: overrides.state ?? "closed",
    card_id: overrides.card_id ?? null,
  };
}

function kindsOf(ds: TidePickerDataSource): string[] {
  const out: string[] = [];
  for (let i = 0; i < ds.numberOfItems(); i += 1) {
    out.push(ds.kindForIndex(i));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section enumeration: empty inputs
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — empty inputs", () => {
  test("empty recents + empty query + idle ledger → no rows", () => {
    const ds = new TidePickerDataSource({
      recents: [],
      query: "",
      ledger: IDLE,
    });
    expect(ds.numberOfItems()).toBe(0);
  });

  test("empty recents + non-empty query + idle ledger → no rows", () => {
    // No recents to match; idle ledger means no SESSIONS/PENDING.
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: IDLE,
    });
    expect(ds.numberOfItems()).toBe(0);
  });

  test("non-empty recents + empty query + idle ledger → RECENTS only", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo", "/Users/Ken/projects/bar"],
      query: "",
      ledger: IDLE,
    });
    expect(kindsOf(ds)).toEqual([
      "header-recents",
      "path-recent",
      "path-recent",
    ]);
  });
});

// ---------------------------------------------------------------------------
// RECENTS matching
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — RECENTS section", () => {
  test("substring match narrows the section", () => {
    const ds = new TidePickerDataSource({
      recents: [
        "/Users/Alex/projects/tugtool",
        "/Users/Ben/projects/wisdom",
        "/Users/Cory/projects/atlas",
      ],
      query: "wisdom",
      ledger: PENDING, // non-empty query → PENDING also visible
    });
    expect(kindsOf(ds)).toEqual([
      "header-recents",
      "path-recent",
      "loading",
    ]);
    const matched = ds.rowAt(1) as Extract<PickerRow, { kind: "path-recent" }>;
    expect(matched.path).toBe("/Users/Ben/projects/wisdom");
  });

  test("case-insensitive match per [D13]", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Alex/projects/Tugtool"],
      query: "tugtool",
      ledger: IDLE,
    });
    expect(kindsOf(ds)).toEqual(["header-recents", "path-recent"]);
    const row = ds.rowAt(1) as Extract<PickerRow, { kind: "path-recent" }>;
    expect(row.path).toBe("/Users/Alex/projects/Tugtool");
    expect(row.matches.length).toBeGreaterThan(0);
  });

  test("path-recent carries match ranges from caseInsensitiveSubstring", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Alex/projects/tugtool"],
      query: "tug",
      ledger: IDLE,
    });
    const row = ds.rowAt(1) as Extract<PickerRow, { kind: "path-recent" }>;
    expect(row.matches).toEqual([[21, 24]]);
  });

  test("empty matches array on empty query", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Alex/projects/tugtool"],
      query: "",
      ledger: IDLE,
    });
    const row = ds.rowAt(1) as Extract<PickerRow, { kind: "path-recent" }>;
    expect(row.matches).toEqual([]);
  });

  test("recent that exactly equals query is excluded per [Spec S01]", () => {
    // Two recents, one of which is exactly the query string. The
    // exact-match recent drops out — the user has typed the full
    // path so suggesting themselves is noise.
    const ds = new TidePickerDataSource({
      recents: [
        "/Users/Alex/projects/tugtool",
        "/Users/Alex/projects/tugtool/sub",
      ],
      query: "/Users/Alex/projects/tugtool",
      ledger: IDLE,
    });
    expect(kindsOf(ds)).toEqual(["header-recents", "path-recent"]);
    const row = ds.rowAt(1) as Extract<PickerRow, { kind: "path-recent" }>;
    expect(row.path).toBe("/Users/Alex/projects/tugtool/sub");
  });

  test("RECENTS section omitted when no recent matches", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Alex/projects/tugtool"],
      query: "absent",
      ledger: IDLE,
    });
    expect(ds.numberOfItems()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SESSIONS section
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — SESSIONS section", () => {
  test("ready + non-empty query → header-sessions + session-new + resume rows", () => {
    const rows = [
      makeRow({ session_id: "s1", state: "closed" }),
      makeRow({ session_id: "s2", state: "closed" }),
    ];
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith(rows),
    });
    expect(kindsOf(ds)).toEqual([
      "header-sessions",
      "session-new",
      "session-resume",
      "session-resume",
      "forget-all",
    ]);
    // Order matches ledger order (newest-first per protocol contract).
    const r0 = ds.rowAt(2) as Extract<PickerRow, { kind: "session-resume" }>;
    const r1 = ds.rowAt(3) as Extract<PickerRow, { kind: "session-resume" }>;
    expect(r0.row.session_id).toBe("s1");
    expect(r1.row.session_id).toBe("s2");
  });

  test("ready with zero rows → header-sessions + session-new only, no forget-all", () => {
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([]),
    });
    expect(kindsOf(ds)).toEqual(["header-sessions", "session-new"]);
  });

  test("forget-all gated on non-live count > 0; all-live ledger has no footer", () => {
    const rows = [
      makeRow({ session_id: "s1", state: "live" }),
      makeRow({ session_id: "s2", state: "live" }),
    ];
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith(rows),
    });
    expect(kindsOf(ds)).toEqual([
      "header-sessions",
      "session-new",
      "session-resume",
      "session-resume",
    ]);
  });

  test("forget-all carries the non-live count", () => {
    const rows = [
      makeRow({ session_id: "s1", state: "live" }),
      makeRow({ session_id: "s2", state: "closed" }),
      makeRow({ session_id: "s3", state: "failed" }),
      makeRow({ session_id: "s4", state: "closed" }),
    ];
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith(rows),
    });
    const last = ds.rowAt(ds.numberOfItems() - 1) as Extract<
      PickerRow,
      { kind: "forget-all" }
    >;
    expect(last.kind).toBe("forget-all");
    // 3 non-live (s2, s3, s4); s1 is live.
    expect(last.nonLiveCount).toBe(3);
  });

  test("live row preserved with row.state === 'live'", () => {
    const rows = [
      makeRow({ session_id: "s1", state: "live" }),
      makeRow({ session_id: "s2", state: "closed" }),
    ];
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith(rows),
    });
    const live = ds.rowAt(2) as Extract<PickerRow, { kind: "session-resume" }>;
    expect(live.row.state).toBe("live");
  });

  test("SESSIONS omitted on empty query even when ledger is ready", () => {
    // Empty query → no SESSIONS section. (Recents would still be
    // visible if any; but here recents are empty too.)
    const ds = new TidePickerDataSource({
      recents: [],
      query: "",
      ledger: readyWith([makeRow()]),
    });
    expect(ds.numberOfItems()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PENDING section
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — PENDING section", () => {
  test("non-empty query + pending ledger → loading row", () => {
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: PENDING,
    });
    expect(kindsOf(ds)).toEqual(["loading"]);
  });

  test("PENDING omitted on empty query", () => {
    const ds = new TidePickerDataSource({
      recents: [],
      query: "",
      ledger: PENDING,
    });
    expect(ds.numberOfItems()).toBe(0);
  });

  test("PENDING and SESSIONS are mutually exclusive on ledger.status", () => {
    // Same query, swap ledger pending → ready: PENDING goes away,
    // SESSIONS comes in.
    const dsPending = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: PENDING,
    });
    const dsReady = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([]),
    });
    expect(kindsOf(dsPending)).toEqual(["loading"]);
    expect(kindsOf(dsReady)).toEqual(["header-sessions", "session-new"]);
  });
});

// ---------------------------------------------------------------------------
// Error ledger state
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — error ledger", () => {
  test("error status produces no SESSIONS and no PENDING", () => {
    // The picker's notice banner ([D11]) surfaces the error
    // separately. The data source treats "error" as no rows worth
    // showing — same effect as "idle" for body content.
    //
    // `query` is a substring of the recent so RECENTS is visible;
    // the test pins that SESSIONS / PENDING stay absent under
    // ledger.status === "error".
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo"],
      query: "foo",
      ledger: errorWith("server unavailable"),
    });
    // RECENTS present (substring match), no SESSIONS / PENDING.
    expect(kindsOf(ds)).toEqual(["header-recents", "path-recent"]);
  });
});

// ---------------------------------------------------------------------------
// Role mapping
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — roleForIndex", () => {
  test("headers return 'header'", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo"],
      query: "/Users/Ken/projects/foo-not-quite",
      ledger: readyWith([makeRow()]),
    });
    const indices = kindsOf(ds);
    for (let i = 0; i < indices.length; i += 1) {
      const k = indices[i];
      if (k === "header-recents" || k === "header-sessions") {
        expect(ds.roleForIndex(i)).toBe("header");
      }
    }
  });

  test("forget-all returns 'footer'", () => {
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([makeRow({ state: "closed" })]),
    });
    const last = ds.numberOfItems() - 1;
    expect(ds.kindForIndex(last)).toBe("forget-all");
    expect(ds.roleForIndex(last)).toBe("footer");
  });

  test("everything else returns 'cell'", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo"],
      query: "tug",
      ledger: readyWith([makeRow({ state: "closed" })]),
    });
    const indices = kindsOf(ds);
    for (let i = 0; i < indices.length; i += 1) {
      const k = indices[i];
      if (k === "path-recent" || k === "session-new" || k === "session-resume") {
        expect(ds.roleForIndex(i)).toBe("cell");
      }
    }
  });

  test("loading returns 'cell' (it's a placeholder, not a header/footer)", () => {
    const ds = new TidePickerDataSource({
      recents: [],
      query: "tug",
      ledger: PENDING,
    });
    expect(ds.kindForIndex(0)).toBe("loading");
    expect(ds.roleForIndex(0)).toBe("cell");
  });
});

// ---------------------------------------------------------------------------
// idForIndex stability
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — idForIndex stability", () => {
  test("session-resume id is the session_id, stable across reordering", () => {
    const r1 = makeRow({ session_id: "alpha", state: "closed" });
    const r2 = makeRow({ session_id: "beta", state: "closed" });
    const ds = new TidePickerDataSource({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([r1, r2]),
    });
    expect(ds.idForIndex(2)).toBe("session:resume:alpha");
    expect(ds.idForIndex(3)).toBe("session:resume:beta");

    // Swap ledger order; ids stay tied to their session_ids.
    ds.setInputsWithoutNotify({
      recents: [],
      query: "/Users/Ken/projects/foo",
      ledger: readyWith([r2, r1]),
    });
    expect(ds.idForIndex(2)).toBe("session:resume:beta");
    expect(ds.idForIndex(3)).toBe("session:resume:alpha");
  });

  test("path-recent id is the path string", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo", "/Users/Ken/projects/bar"],
      query: "",
      ledger: IDLE,
    });
    expect(ds.idForIndex(1)).toBe("recents:/Users/Ken/projects/foo");
    expect(ds.idForIndex(2)).toBe("recents:/Users/Ken/projects/bar");
  });

  test("singleton kinds use literal kind names as ids", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo"],
      query: "/Users/Ken/projects/foo-other",
      ledger: readyWith([makeRow({ state: "closed" })]),
    });
    const kinds = kindsOf(ds);
    for (let i = 0; i < kinds.length; i += 1) {
      const k = kinds[i];
      if (k === "header-recents") {
        expect(ds.idForIndex(i)).toBe("header-recents");
      } else if (k === "header-sessions") {
        expect(ds.idForIndex(i)).toBe("header-sessions");
      } else if (k === "session-new") {
        expect(ds.idForIndex(i)).toBe("session:new");
      } else if (k === "forget-all") {
        expect(ds.idForIndex(i)).toBe("forget-all");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// setInputsWithoutNotify + notifyAll
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — setInputsWithoutNotify", () => {
  test("identical inputs short-circuit; returns false", () => {
    const recents = ["/Users/Ken/projects/foo"];
    const ledger = IDLE;
    const ds = new TidePickerDataSource({
      recents,
      query: "",
      ledger,
    });
    const v1 = ds.getVersion();
    const changed = ds.setInputsWithoutNotify({
      recents,
      query: "",
      ledger,
    });
    expect(changed).toBe(false);
    expect(Object.is(v1, ds.getVersion())).toBe(true);
  });

  test("different recents identity → recompute, version bumps, returns true", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo"],
      query: "",
      ledger: IDLE,
    });
    const v1 = ds.getVersion();
    const changed = ds.setInputsWithoutNotify({
      recents: ["/Users/Ken/projects/foo", "/Users/Ken/projects/bar"],
      query: "",
      ledger: IDLE,
    });
    expect(changed).toBe(true);
    expect(Object.is(v1, ds.getVersion())).toBe(false);
    expect(ds.numberOfItems()).toBe(3); // header + 2 paths
  });

  test("different query → recompute", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo", "/Users/Ken/projects/bar"],
      query: "",
      ledger: IDLE,
    });
    const changed = ds.setInputsWithoutNotify({
      recents: ["/Users/Ken/projects/foo", "/Users/Ken/projects/bar"],
      query: "foo",
      ledger: IDLE,
    });
    expect(changed).toBe(true);
    expect(kindsOf(ds)).toEqual(["header-recents", "path-recent"]);
  });

  test("setInputsWithoutNotify does NOT fire listeners", () => {
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo"],
      query: "",
      ledger: IDLE,
    });
    let ticks = 0;
    ds.subscribe(() => {
      ticks += 1;
    });
    ds.setInputsWithoutNotify({
      recents: ["/Users/Ken/projects/foo", "/Users/Ken/projects/bar"],
      query: "",
      ledger: IDLE,
    });
    expect(ticks).toBe(0);
  });

  test("notifyAll fires all subscribers", () => {
    const ds = new TidePickerDataSource({
      recents: [],
      query: "",
      ledger: IDLE,
    });
    let aTicks = 0;
    let bTicks = 0;
    ds.subscribe(() => {
      aTicks += 1;
    });
    ds.subscribe(() => {
      bTicks += 1;
    });
    ds.notifyAll();
    expect(aTicks).toBe(1);
    expect(bTicks).toBe(1);
  });

  test("unsubscribe stops a listener firing", () => {
    const ds = new TidePickerDataSource({
      recents: [],
      query: "",
      ledger: IDLE,
    });
    let ticks = 0;
    const unsub = ds.subscribe(() => {
      ticks += 1;
    });
    ds.notifyAll();
    expect(ticks).toBe(1);
    unsub();
    ds.notifyAll();
    expect(ticks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// rowAt
// ---------------------------------------------------------------------------

describe("TidePickerDataSource — rowAt", () => {
  test("rowAt returns the typed PickerRow", () => {
    const row = makeRow({ session_id: "s1", state: "closed" });
    const ds = new TidePickerDataSource({
      recents: ["/Users/Ken/projects/foo"],
      query: "tug",
      ledger: readyWith([row]),
    });
    // Discriminated union — exhaustively cover one of each kind.
    const seen = new Set<string>();
    for (let i = 0; i < ds.numberOfItems(); i += 1) {
      const r = ds.rowAt(i);
      seen.add(r.kind);
    }
    // RECENTS (header + path) and SESSIONS (header + new + resume + footer).
    expect(seen.has("header-recents")).toBe(false); // "tug" doesn't match path "foo"
    expect(seen.has("header-sessions")).toBe(true);
    expect(seen.has("session-new")).toBe(true);
    expect(seen.has("session-resume")).toBe(true);
  });
});
