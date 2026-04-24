/**
 * trace-summarize-drift.test.ts — Compile-time drift check between
 * tugdeck's `DeckTraceEvent` discriminated union and the in-app
 * harness's mirrored `DeckTraceEventShape` / `summarizeEvent` switch.
 *
 * The harness at `tests/in-app/_harness/matchers.ts` renders each
 * trace entry as a one-line label via `summarizeEvent`, with an
 * internal `never`-branch pinning exhaustiveness against its local
 * {@link HarnessKnownTraceKind} union. That local union is a
 * hand-maintained MIRROR of `DeckTraceEvent["kind"]` — if someone
 * adds a new kind to `deck-trace.ts` without touching matchers.ts,
 * the harness internal check still passes (because the mirror
 * doesn't know the new kind exists), and the next M-series failure
 * silently renders the new kind via the generic fallback.
 *
 * This test closes that loop at the tugdeck tsc boundary. It
 * imports both the real `DeckTraceEvent` and the harness-side
 * `HarnessKnownTraceKind`, and asserts at compile time that every
 * real kind is present in the harness mirror. A drift produces a
 * tsc error pointing at the `_DriftCheck` assignment below with a
 * message that names the missing kind(s) and the file to update.
 *
 * Runtime body is minimal — bun:test just needs to pick up the
 * file. The real work happens during type-check.
 */

import { describe, expect, test } from "bun:test";

import type { DeckTraceEvent } from "../deck-trace";
import type {
  DeckTraceEventShape,
  HarnessKnownTraceKind,
} from "../../../tests/in-app/_harness/matchers";

// ---------------------------------------------------------------------------
// Compile-time drift check
// ---------------------------------------------------------------------------

/**
 * If a new kind is added to {@link DeckTraceEvent} but not mirrored
 * in {@link HarnessKnownTraceKind}, `_MissingKinds` is the string-
 * literal union of those missing kinds. Otherwise it is `never`.
 *
 * The array wrapper (`[X] extends [never]`) avoids TypeScript's
 * distributive-conditional behavior on bare unions; without it a
 * `never` member would collapse the entire conditional to `never`.
 */
type _MissingKinds = Exclude<DeckTraceEvent["kind"], HarnessKnownTraceKind>;

/**
 * Evaluates to `true` when the mirror is complete. When it is not,
 * evaluates to a structural error type whose `missing` field names
 * the offending kinds — surfaced in the tsc error for the
 * `_DRIFT_CHECK` assignment below.
 */
type _DriftCheck = [_MissingKinds] extends [never]
  ? true
  : {
      error: "New DeckTraceEvent kind(s) added to tugdeck/src/deck-trace.ts — update tests/in-app/_harness/matchers.ts:HARNESS_KNOWN_TRACE_KINDS, DeckTraceEventShape, and summarizeEvent to match.";
      missing: _MissingKinds;
    };

/**
 * Mirror drift in the other direction: the harness adds a kind that
 * tugdeck doesn't emit. Less dangerous (no silent fallback), but
 * still worth flagging so the mirror doesn't grow dead branches.
 */
type _PhantomKinds = Exclude<HarnessKnownTraceKind, DeckTraceEvent["kind"]>;

type _PhantomCheck = [_PhantomKinds] extends [never]
  ? true
  : {
      error: "tests/in-app/_harness/matchers.ts lists kinds that tugdeck's DeckTraceEvent union does not emit — remove them from HARNESS_KNOWN_TRACE_KINDS and DeckTraceEventShape.";
      phantom: _PhantomKinds;
    };

/**
 * tsc fails here with an actionable message when `_DriftCheck` is
 * not `true` — i.e. when tugdeck added a kind the harness mirror
 * doesn't know about. The `true as const` narrows to `true`, which
 * only assigns to the checker's `true` branch.
 */
const _DRIFT_CHECK: _DriftCheck = true as const;
void _DRIFT_CHECK;

const _PHANTOM_CHECK: _PhantomCheck = true as const;
void _PHANTOM_CHECK;

/**
 * A structural sanity check that the harness's mirrored variant
 * shapes are subtype-compatible with tugdeck's union for each kind
 * we exercise in fixtures. If tugdeck narrows a field's type
 * (e.g. `source: SaveCallbackSource` → `source: "debounced"`),
 * `DeckTraceEventShape`'s looser typing would still assign. The
 * reverse direction is the interesting one: every tugdeck variant
 * (minus stamp fields) must fit the harness's mirror. We test it
 * on `commit-tick` (smallest variant) as a spot check — a full
 * compatibility matrix would be valuable but requires re-declaring
 * every variant.
 */
type _SpotCheckCommitTick = Extract<
  DeckTraceEvent,
  { kind: "commit-tick" }
> extends Extract<DeckTraceEventShape, { kind: "commit-tick" }> & {
  timestamp: number;
  seq: number;
  loc?: string;
  store?: unknown;
}
  ? true
  : false;

const _COMMIT_TICK_SPOT: _SpotCheckCommitTick = true;
void _COMMIT_TICK_SPOT;

// ---------------------------------------------------------------------------
// Runtime body
// ---------------------------------------------------------------------------

describe("trace-summarize drift check", () => {
  test("compile-time coupling between tugdeck and harness is intact", () => {
    // The real assertion happens at tsc time (see _DRIFT_CHECK
    // above). This runtime test exists so bun:test picks the file
    // up and any accidental runtime-level breakage of the imports
    // (missing export, stray side-effect) surfaces as a test
    // failure too.
    expect(true).toBe(true);
  });
});
